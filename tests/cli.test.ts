import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, expect, test } from "vitest";

import { prepareWorktree } from "../src/git-worktree.js";
import {
  acquireRunLock,
  FlowError,
  inspectRun,
  releaseRunLock,
} from "../src/workflow-run.js";

const run = promisify(execFile);
const executable = fileURLToPath(new URL("../scripts/flow", import.meta.url));
const outsideInstallationRoot = fileURLToPath(new URL(".", import.meta.url));
const temporaryDirectories: string[] = [];

async function createTargetRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "flow-target-"));
  temporaryDirectories.push(repository);
  await run("git", ["init", "--quiet", repository]);
  await mkdir(join(repository, "specs"));
  await writeFile(join(repository, "specs", "feature.md"), "# Feature\n");
  return repository;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("flow displays usage when invoked without arguments", async () => {
  const { stderr, stdout } = await run(executable, [], {
    cwd: outsideInstallationRoot,
  });

  expect(stdout).toContain("Usage: flow");
  expect(stderr).toBe("");
});

test("flow --help displays usage", async () => {
  const { stderr, stdout } = await run(executable, ["--help"], {
    cwd: outsideInstallationRoot,
  });

  expect(stdout).toContain("Usage: flow");
  expect(stderr).toBe("");
});

test("flow --version displays the package version", async () => {
  const { stderr, stdout } = await run(executable, ["--version"], {
    cwd: outsideInstallationRoot,
  });

  expect(stdout).toBe("0.1.0\n");
  expect(stderr).toBe("");
});

test("flow rejects unsupported arguments", async () => {
  await expect(
    run(executable, ["--unknown"], {
      cwd: outsideInstallationRoot,
    }),
  ).rejects.toMatchObject({
    code: 1,
    stderr: "Unsupported argument: --unknown\n",
    stdout: "",
  });
});

test("flow creates an explicit Workflow run", async () => {
  const repository = await createTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";

  const { stderr, stdout } = await run(executable, [
    "run",
    "create",
    "--repo",
    repository,
    "--spec",
    "specs/feature.md",
    "--run",
    runId,
  ]);

  expect(stderr).toBe("");
  expect(stdout).toContain(`Created run ${runId}`);

  const runDirectory = join(repository, ".orchestrator", "runs", runId);
  const snapshot = JSON.parse(
    await readFile(join(runDirectory, "state.json"), "utf8"),
  );
  expect(snapshot).toMatchObject({
    schemaVersion: 1,
    runId,
    revision: 1,
    phase: "created",
    specification: "specs/feature.md",
  });
  expect(snapshot.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  expect(snapshot.updatedAt).toBe(snapshot.createdAt);

  const history = (await readFile(join(runDirectory, "history.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    schemaVersion: 1,
    runId,
    sequence: 1,
    stateRevision: 1,
    timestamp: snapshot.createdAt,
    type: "run.created",
    data: { specification: "specs/feature.md" },
  });
  expect(history[0].eventId).toEqual(expect.any(String));
});

test("flow bootstraps ignored runtime state without replacing existing ignore rules", async () => {
  const repository = await createTargetRepository();
  const existingIgnore = "dist/\n# keep this rule\n";
  await writeFile(join(repository, ".gitignore"), existingIgnore);

  await createExplicitRun(repository, "run_20260904T120000Z_012345abcdef");

  expect(await readFile(join(repository, ".gitignore"), "utf8")).toBe(
    `${existingIgnore}.orchestrator/runs/\n`,
  );
  await expect(
    run("git", [
      "-C",
      repository,
      "check-ignore",
      "--quiet",
      "--no-index",
      "--",
      ".orchestrator/runs/probe",
    ]),
  ).resolves.toBeDefined();
});

test("flow rejects a specification symlink that escapes the Target repository", async () => {
  const repository = await createTargetRepository();
  const externalDirectory = await temporaryDirectory();
  const externalSpecification = join(externalDirectory, "external.md");
  await writeFile(externalSpecification, "# External\n");
  await symlink(externalSpecification, join(repository, "specs", "linked.md"));

  await expect(
    run(executable, [
      "run",
      "create",
      "--repo",
      repository,
      "--spec",
      "specs/linked.md",
      "--run",
      "run_20260904T120000Z_012345abcdef",
    ]),
  ).rejects.toMatchObject({ code: 3, stdout: "" });
});

test("flow rejects a redirected runtime directory before reading or writing", async () => {
  const repository = await createTargetRepository();
  const redirected = await temporaryDirectory();
  await symlink(redirected, join(repository, ".orchestrator"));

  await expect(
    run(executable, [
      "run",
      "create",
      "--repo",
      repository,
      "--spec",
      "specs/feature.md",
      "--run",
      "run_20260904T120000Z_012345abcdef",
    ]),
  ).rejects.toMatchObject({ code: 4, stdout: "" });
});

test.each([
  ["non-Git repository", async () => temporaryDirectory(), "specs/feature.md"],
  ["bare repository", createBareRepository, "specs/feature.md"],
  ["missing specification", createTargetRepository, "specs/missing.md"],
  ["non-file specification", createTargetRepository, "specs"],
])(
  "flow rejects a %s with repository-data exit status",
  async (_, setup, spec) => {
    const repository = await setup();

    await expect(
      run(executable, [
        "run",
        "create",
        "--repo",
        repository,
        "--spec",
        spec,
        "--run",
        "run_20260904T120000Z_012345abcdef",
      ]),
    ).rejects.toMatchObject({ code: 3, stdout: "" });
  },
);

test("flow rejects a specification outside the Target repository", async () => {
  const repository = await createTargetRepository();
  const externalDirectory = await temporaryDirectory();
  const specification = join(externalDirectory, "external.md");
  await writeFile(specification, "# External\n");

  await expect(
    run(executable, [
      "run",
      "create",
      "--repo",
      repository,
      "--spec",
      specification,
      "--run",
      "run_20260904T120000Z_012345abcdef",
    ]),
  ).rejects.toMatchObject({ code: 3, stdout: "" });
});

test.each(["feature-one", "run_20269999T999999Z_012345abcdef"])(
  "flow rejects invalid caller-supplied run ID %s",
  async (runId) => {
    const repository = await createTargetRepository();

    await expect(
      run(executable, [
        "run",
        "create",
        "--repo",
        repository,
        "--spec",
        "specs/feature.md",
        "--run",
        runId,
      ]),
    ).rejects.toMatchObject({ code: 2, stdout: "" });
  },
);

test.each([
  [
    "a flag in place of a value",
    [
      "run",
      "create",
      "--repo",
      "--spec",
      "specs/feature.md",
      "--run",
      "run_20260904T120000Z_012345abcdef",
    ],
  ],
  [
    "an unknown option",
    [
      "status",
      "--repo",
      "/tmp",
      "--run",
      "run_20260904T120000Z_012345abcdef",
      "--bogus",
    ],
  ],
  [
    "a duplicate option",
    [
      "history",
      "--repo",
      "/tmp",
      "--repo",
      "/tmp",
      "--run",
      "run_20260904T120000Z_012345abcdef",
    ],
  ],
])("flow rejects %s for a recognized command", async (_, arguments_) => {
  await expect(run(executable, arguments_)).rejects.toMatchObject({
    code: 2,
    stdout: "",
  });
});

test("flow allows repository and run ID to be inferred", async () => {
  const repository = await createTargetRepository();

  await expect(
    run(
      executable,
      ["run", "create", "--repo", repository, "--spec", "specs/feature.md"],
      { cwd: repository },
    ),
  ).resolves.toMatchObject({ stdout: expect.stringContaining("Created run") });
});

test("flow generates a sortable cryptographically random run ID", async () => {
  const repository = await createTargetRepository();

  const { stderr, stdout } = await run(
    executable,
    ["run", "create", "--spec", "specs/feature.md"],
    { cwd: repository },
  );

  expect(stderr).toBe("");
  expect(stdout).toMatch(/^Created run run_\d{8}T\d{6}Z_[0-9a-f]{12}\n$/);
  const runId = stdout.trim().slice("Created run ".length);
  expect(
    (await readdir(join(repository, ".orchestrator", "runs"))).sort(),
  ).toEqual([runId]);
});

test("flow retries an explicit run creation safely", async () => {
  const repository = await createTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);
  const runDirectory = join(repository, ".orchestrator", "runs", runId);
  const before = await Promise.all([
    readFile(join(runDirectory, "state.json"), "utf8"),
    readFile(join(runDirectory, "history.jsonl"), "utf8"),
  ]);

  const { stderr, stdout } = await run(executable, [
    "run",
    "create",
    "--repo",
    repository,
    "--spec",
    "specs/feature.md",
    "--run",
    runId,
  ]);

  expect(stderr).toBe("");
  expect(stdout).toContain(`Created run ${runId}`);
  expect(
    await Promise.all([
      readFile(join(runDirectory, "state.json"), "utf8"),
      readFile(join(runDirectory, "history.jsonl"), "utf8"),
    ]),
  ).toEqual(before);
});

test("flow refuses a retry for a different specification without changing the run", async () => {
  const repository = await createTargetRepository();
  await writeFile(join(repository, "specs", "other.md"), "# Other\n");
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);
  const runDirectory = join(repository, ".orchestrator", "runs", runId);
  const before = await readFile(join(runDirectory, "state.json"), "utf8");

  await expect(
    run(executable, [
      "run",
      "create",
      "--repo",
      repository,
      "--spec",
      "specs/other.md",
      "--run",
      runId,
    ]),
  ).rejects.toMatchObject({ code: 3, stdout: "" });

  expect(await readFile(join(runDirectory, "state.json"), "utf8")).toBe(before);
});

test("flow uses the sole nonterminal run for implicit status and history", async () => {
  const repository = await createTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);

  const status = await run(executable, ["status", "--repo", repository]);
  expect(status.stdout).toContain(`Run: ${runId}\n`);

  const history = await run(executable, [
    "history",
    "--repo",
    repository,
    "--json",
  ]);
  expect(JSON.parse(history.stdout)).toHaveLength(1);
});

test("flow falls back to the sole terminal run for implicit status", async () => {
  const repository = await createTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);
  const statePath = join(
    repository,
    ".orchestrator",
    "runs",
    runId,
    "state.json",
  );
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.phase = "completed";
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

  const { stdout } = await run(executable, ["status", "--repo", repository]);
  expect(stdout).toContain(`Run: ${runId}\n`);
  expect(stdout).toContain("Phase: completed\n");
});

test("flow refuses ambiguous implicit selection and reports candidate IDs", async () => {
  const repository = await createTargetRepository();
  const runIds = [
    "run_20260904T120000Z_012345abcdef",
    "run_20260904T120001Z_012345abcdee",
  ];
  for (const runId of runIds) await createExplicitRun(repository, runId);

  await expect(
    run(executable, ["status", "--repo", repository]),
  ).rejects.toMatchObject({
    code: 3,
    stdout: "",
    stderr: expect.stringContaining(runIds[0]!),
  });

  await expect(
    run(executable, ["status", "--repo", repository, "--json"]),
  ).rejects.toMatchObject({
    code: 3,
    stdout: "",
    stderr: expect.stringMatching(
      new RegExp(`"code":"[A-Z_]+".*${runIds[0]!}.*${runIds[1]!}`),
    ),
  });
});

test("flow reports no run candidates with structured guidance", async () => {
  const repository = await createTargetRepository();

  await expect(
    run(executable, ["history", "--repo", repository, "--json"]),
  ).rejects.toMatchObject({
    code: 3,
    stdout: "",
    stderr: expect.stringMatching(/"code":"[A-Z_]+".*"message":".*run/i),
  });
});

test("flow displays explicit run status in human and structured forms", async () => {
  const repository = await createTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);

  const human = await run(executable, [
    "status",
    "--repo",
    repository,
    "--run",
    runId,
  ]);
  expect(human.stderr).toBe("");
  expect(human.stdout).toContain(`Run: ${runId}\n`);
  expect(human.stdout).toContain("Phase: created\n");
  expect(human.stdout).toContain("Specification: specs/feature.md\n");
  expect(human.stdout).toContain("Revision: 1\n");
  expect(human.stdout).toContain("History: synchronized\n");

  const structured = await run(executable, [
    "status",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  expect(structured.stderr).toBe("");
  expect(JSON.parse(structured.stdout)).toMatchObject({
    schemaVersion: 1,
    runId,
    revision: 1,
    phase: "created",
    specification: "specs/feature.md",
    history: {
      lastSequence: 1,
      lastStateRevision: 1,
      synchronized: true,
    },
  });
});

test("flow reports a one-revision interrupted audit without modifying persisted bytes", async () => {
  const repository = await createTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);
  const statePath = join(
    repository,
    ".orchestrator",
    "runs",
    runId,
    "state.json",
  );
  const historyPath = join(
    repository,
    ".orchestrator",
    "runs",
    runId,
    "history.jsonl",
  );
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.revision = 2;
  const stateBytes = `${JSON.stringify(state, null, 2)}\n`;
  const historyBytes = await readFile(historyPath, "utf8");
  await writeFile(statePath, stateBytes);

  const human = await run(executable, [
    "status",
    "--repo",
    repository,
    "--run",
    runId,
  ]);
  expect(human.stdout).toContain("interrupted audit");
  const structured = await run(executable, [
    "status",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  expect(JSON.parse(structured.stdout).history).toMatchObject({
    synchronized: false,
    warning: expect.stringContaining("one revision behind"),
  });
  expect(await readFile(statePath, "utf8")).toBe(stateBytes);
  expect(await readFile(historyPath, "utf8")).toBe(historyBytes);
});

test("flow rejects malformed history with corruption status and preserves bytes", async () => {
  const repository = await createTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);
  const historyPath = join(
    repository,
    ".orchestrator",
    "runs",
    runId,
    "history.jsonl",
  );
  const original = await readFile(historyPath, "utf8");
  await writeFile(historyPath, `${original}\n`);

  await expect(
    run(executable, ["status", "--repo", repository, "--run", runId, "--json"]),
  ).rejects.toMatchObject({
    code: 4,
    stdout: "",
    stderr: expect.stringMatching(/CORRUPT_RUN/),
  });
  expect(await readFile(historyPath, "utf8")).toBe(`${original}\n`);
});

test("flow displays explicit run history in human and structured forms", async () => {
  const repository = await createTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);
  const persistedEvent = JSON.parse(
    (
      await readFile(
        join(repository, ".orchestrator", "runs", runId, "history.jsonl"),
        "utf8",
      )
    ).trim(),
  );

  const human = await run(executable, [
    "history",
    "--repo",
    repository,
    "--run",
    runId,
  ]);
  expect(human.stderr).toBe("");
  expect(human.stdout).toBe(
    `${persistedEvent.timestamp}  1  run.created  revision 1\n`,
  );

  const structured = await run(executable, [
    "history",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  expect(structured.stderr).toBe("");
  expect(JSON.parse(structured.stdout)).toEqual([persistedEvent]);
});

test("flow prepares and inspects a default Feature worktree", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);

  const prepared = await run(executable, [
    "worktree",
    "prepare",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  const result = JSON.parse(prepared.stdout);
  expect(result).toMatchObject({
    runId,
    phase: "implementing",
    git: {
      worktreeStatus: "ready",
      featureBranch: `orchestrator/${runId}`,
    },
  });
  expect(result.git.runBase).toMatch(/^[0-9a-f]{40,64}$/);
  expect(result.git.validatedHead).toBe(result.git.runBase);
  expect(result.git.featureWorktree).toMatch(
    new RegExp(`${runId.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}$`),
  );
  expect(result.warnings).toEqual([
    expect.stringContaining("excluded from the Run base"),
  ]);
  await expect(
    run("git", ["-C", repository, "symbolic-ref", "--short", "HEAD"]),
  ).resolves.toMatchObject({ stdout: "master\n" });
  await expect(
    run("git", ["-C", result.git.featureWorktree, "status", "--porcelain"]),
  ).resolves.toMatchObject({ stdout: "" });

  const status = await run(executable, [
    "status",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  expect(JSON.parse(status.stdout)).toMatchObject({
    runId,
    phase: "implementing",
    git: result.git,
  });
  const humanStatus = await run(executable, [
    "status",
    "--repo",
    repository,
    "--run",
    runId,
  ]);
  expect(humanStatus.stdout).toContain(`Run base: ${result.git.runBase}\n`);
  expect(humanStatus.stdout).toContain(
    `Feature branch: ${result.git.featureBranch}\n`,
  );
  expect(humanStatus.stdout).toContain(
    `Feature worktree: ${result.git.featureWorktree}\n`,
  );
  const history = await run(executable, [
    "history",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  const events = JSON.parse(history.stdout) as Array<{
    type: string;
    stateRevision: number;
    data: Record<string, unknown>;
  }>;
  expect(events.map((event) => event.type)).toEqual([
    "run.created",
    "git.preparation.started",
    "git.worktree.prepared",
  ]);
  expect(events.map((event) => event.stateRevision)).toEqual([1, 2, 3]);
  expect(events[1]?.data).toMatchObject({
    runBase: result.git.runBase,
    featureBranch: result.git.featureBranch,
    featureWorktree: result.git.featureWorktree,
    worktreeStatus: "planned",
  });
});

test("flow retries an interrupted preparation from persisted intent", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_898989898989";
  await createExplicitRun(repository, runId);
  let failOnce = true;
  await expect(
    prepareWorktree(
      { repository, runId },
      {
        afterHistoryPublication: () => {
          if (failOnce) {
            failOnce = false;
            throw new Error("interrupt after intent");
          }
        },
      },
    ),
  ).rejects.toThrow("interrupt after intent");

  const interrupted = await inspectRun(repository, runId);
  expect(interrupted.snapshot).toMatchObject({
    phase: "preparing",
    git: { worktreeStatus: "planned" },
  });
  expect(interrupted.operationalHistory).toHaveLength(2);

  const retried = await run(executable, [
    "worktree",
    "prepare",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  expect(JSON.parse(retried.stdout)).toMatchObject({
    runId,
    phase: "implementing",
    git: { worktreeStatus: "ready" },
  });
  const history = JSON.parse(
    await run(executable, [
      "history",
      "--repo",
      repository,
      "--run",
      runId,
      "--json",
    ]).then(({ stdout }) => stdout),
  ) as Array<{ type: string }>;
  expect(history.map((event) => event.type)).toEqual([
    "run.created",
    "git.preparation.started",
    "git.worktree.prepared",
  ]);
});

test("flow validates a healthy Feature worktree baseline in human and JSON output", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_121212121212";
  await createExplicitRun(repository, runId);
  const prepared = JSON.parse(
    (
      await run(executable, [
        "worktree",
        "prepare",
        "--repo",
        repository,
        "--run",
        runId,
        "--json",
      ])
    ).stdout,
  ) as { git: { featureWorktree: string } };

  const structured = await run(executable, [
    "worktree",
    "validate",
    "--repo",
    repository,
    "--json",
  ]);
  const report = JSON.parse(structured.stdout);
  expect(report).toMatchObject({
    runId,
    valid: true,
    git: { worktreeStatus: "ready" },
    checks: {
      repository: { valid: true },
      registration: { valid: true },
      path: { valid: true },
      branch: { valid: true },
      head: { valid: true },
      cleanliness: { valid: true },
    },
  });
  expect(report.git.featureWorktree).toBe(prepared.git.featureWorktree);

  const human = await run(executable, [
    "worktree",
    "validate",
    "--repo",
    repository,
    "--run",
    runId,
  ]);
  expect(human.stdout).toContain("repository: valid");
  expect(human.stdout).toContain("registration: valid");
  expect(human.stdout).toContain("cleanliness: valid");
  expect(human.stdout).toContain("Result: valid");
});

test("flow accepts a new Git checkpoint and exposes its audit event", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_232323232323";
  await createExplicitRun(repository, runId);
  const prepared = JSON.parse(
    (
      await run(executable, [
        "worktree",
        "prepare",
        "--repo",
        repository,
        "--run",
        runId,
        "--json",
      ])
    ).stdout,
  ) as { git: { featureWorktree: string }; revision: number };
  const feature = prepared.git.featureWorktree;
  await writeFile(join(feature, "checkpoint.txt"), "checkpoint\n");
  await run("git", ["-C", feature, "add", "checkpoint.txt"]);
  await run("git", ["-C", feature, "commit", "--quiet", "-m", "checkpoint"]);
  const commit = (
    await run("git", ["-C", feature, "rev-parse", "HEAD"])
  ).stdout.trim();

  const accepted = await run(executable, [
    "checkpoint",
    "validate",
    "--repo",
    repository,
    "--run",
    runId,
    "--commit",
    commit,
    "--json",
  ]);
  expect(JSON.parse(accepted.stdout)).toMatchObject({
    runId,
    revision: prepared.revision + 1,
    phase: "implementing",
    git: { validatedHead: commit },
    previousValidatedHead: expect.any(String),
    acceptedCommit: commit,
  });
  const history = JSON.parse(
    (
      await run(executable, [
        "history",
        "--repo",
        repository,
        "--run",
        runId,
        "--json",
      ])
    ).stdout,
  ) as Array<{ type: string; stateRevision: number }>;
  expect(history.at(-1)).toMatchObject({
    type: "git.checkpoint.accepted",
    stateRevision: prepared.revision + 1,
  });
});

test("flow rejects stale and dirty checkpoint candidates without mutation", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_242424242424";
  await createExplicitRun(repository, runId);
  const prepared = JSON.parse(
    (
      await run(executable, [
        "worktree",
        "prepare",
        "--repo",
        repository,
        "--run",
        runId,
        "--json",
      ])
    ).stdout,
  ) as { git: { featureWorktree: string; runBase: string }; revision: number };
  const feature = prepared.git.featureWorktree;
  await writeFile(join(feature, "next.txt"), "next\n");
  await run("git", ["-C", feature, "add", "next.txt"]);
  await run("git", ["-C", feature, "commit", "--quiet", "-m", "next"]);
  const current = (
    await run("git", ["-C", feature, "rev-parse", "HEAD"])
  ).stdout.trim();
  const before = await inspectRun(repository, runId);

  await expect(
    run(executable, [
      "checkpoint",
      "validate",
      "--repo",
      repository,
      "--run",
      runId,
      "--commit",
      prepared.git.runBase,
      "--json",
    ]),
  ).rejects.toMatchObject({
    code: 4,
    stderr: expect.stringContaining("CHECKPOINT_STALE"),
  });
  const afterStale = await inspectRun(repository, runId);
  expect(afterStale.snapshot).toEqual(before.snapshot);
  expect(afterStale.operationalHistory).toEqual(before.operationalHistory);

  await writeFile(join(feature, "dirty.txt"), "dirty\n");
  await expect(
    run(executable, [
      "checkpoint",
      "validate",
      "--repo",
      repository,
      "--run",
      runId,
      "--commit",
      current,
      "--json",
    ]),
  ).rejects.toMatchObject({
    code: 4,
    stderr: expect.stringContaining("UNTRACKED_WORKTREE"),
  });
  const afterDirty = await inspectRun(repository, runId);
  expect(afterDirty.snapshot).toEqual(before.snapshot);
  expect(afterDirty.operationalHistory).toEqual(before.operationalHistory);
});

test.each([
  [
    "missing Feature worktree",
    "FEATURE_WORKTREE_NOT_FOUND",
    async (path: string) => {
      await run("git", ["-C", path, "worktree", "remove", path]);
    },
  ],
  [
    "missing registration",
    "WORKTREE_REGISTRATION_NOT_FOUND",
    async (path: string) => {
      await run("git", ["-C", path, "worktree", "remove", path]);
    },
  ],
  [
    "detached HEAD",
    "WORKTREE_INVARIANT_VIOLATION",
    async (path: string) => {
      await run("git", ["-C", path, "checkout", "--detach", "--quiet"]);
    },
  ],
  [
    "advanced HEAD",
    "WORKTREE_INVARIANT_VIOLATION",
    async (path: string) => {
      await writeFile(join(path, "advanced.txt"), "advanced\n");
      await run("git", ["-C", path, "add", "advanced.txt"]);
      await run("git", ["-C", path, "commit", "--quiet", "-m", "advanced"]);
    },
  ],
  [
    "missing Feature branch",
    "FEATURE_BRANCH_NOT_FOUND",
    async (path: string, branch: string) => {
      await run("git", ["-C", path, "checkout", "--detach", "--quiet"]);
      await run("git", ["-C", path, "branch", "-D", branch]);
    },
  ],
  [
    "wrong Feature branch",
    "WORKTREE_INVARIANT_VIOLATION",
    async (path: string) => {
      await run("git", [
        "-C",
        path,
        "checkout",
        "-b",
        "other-feature",
        "--quiet",
      ]);
    },
  ],
  [
    "tracked changes",
    "DIRTY_WORKTREE",
    async (path: string) => {
      await writeFile(join(path, "specs", "feature.md"), "changed\n");
    },
  ],
  [
    "non-ignored untracked files",
    "UNTRACKED_WORKTREE",
    async (path: string) => {
      await writeFile(join(path, "untracked.txt"), "untracked\n");
    },
  ],
] as const)(
  "flow rejects %s without repairing persisted state",
  async (_label, code, mutate) => {
    const repository = await createCommittedTargetRepository();
    const runId = "run_20260904T120000Z_131313131313";
    await createExplicitRun(repository, runId);
    const prepared = JSON.parse(
      (
        await run(executable, [
          "worktree",
          "prepare",
          "--repo",
          repository,
          "--run",
          runId,
          "--json",
        ])
      ).stdout,
    ) as { git: { featureWorktree: string; featureBranch: string } };
    const statePath = join(
      repository,
      ".orchestrator",
      "runs",
      runId,
      "state.json",
    );
    const historyPath = join(
      repository,
      ".orchestrator",
      "runs",
      runId,
      "history.jsonl",
    );
    const beforeState = await readFile(statePath, "utf8");
    const beforeHistory = await readFile(historyPath, "utf8");
    await mutate(prepared.git.featureWorktree, prepared.git.featureBranch);
    if (_label === "missing registration")
      await mkdir(prepared.git.featureWorktree, { recursive: true });

    await expect(
      run(executable, [
        "worktree",
        "validate",
        "--repo",
        repository,
        "--run",
        runId,
        "--json",
      ]),
    ).rejects.toMatchObject({
      code:
        _label === "missing Feature worktree" ||
        _label === "missing registration" ||
        _label === "missing Feature branch"
          ? 3
          : 4,
      stdout: "",
      stderr: expect.stringContaining(code),
    });
    expect(await readFile(statePath, "utf8")).toBe(beforeState);
    expect(await readFile(historyPath, "utf8")).toBe(beforeHistory);
  },
);

test("flow permits ignored files during baseline validation", async () => {
  const repository = await createCommittedTargetRepository();
  await writeFile(join(repository, ".gitignore"), "ignored.txt\n");
  await run("git", ["-C", repository, "add", ".gitignore"]);
  await run("git", ["-C", repository, "commit", "--quiet", "-m", "ignore"]);
  const runId = "run_20260904T120000Z_141414141414";
  await createExplicitRun(repository, runId);
  const prepared = JSON.parse(
    (
      await run(executable, [
        "worktree",
        "prepare",
        "--repo",
        repository,
        "--run",
        runId,
        "--json",
      ])
    ).stdout,
  ) as { git: { featureWorktree: string } };
  await writeFile(
    join(prepared.git.featureWorktree, "ignored.txt"),
    "ignored\n",
  );

  const { stdout } = await run(executable, [
    "worktree",
    "validate",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  expect(JSON.parse(stdout)).toMatchObject({
    valid: true,
    checks: { cleanliness: { valid: true } },
  });
});

test("flow reports a Feature worktree from a different Git repository", async () => {
  const repository = await createCommittedTargetRepository();
  const otherRepository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_151515151515";
  await createExplicitRun(repository, runId);
  const prepared = JSON.parse(
    (
      await run(executable, [
        "worktree",
        "prepare",
        "--repo",
        repository,
        "--run",
        runId,
        "--json",
      ])
    ).stdout,
  ) as { git: { featureWorktree: string } };
  await writeFile(
    join(prepared.git.featureWorktree, ".git"),
    `gitdir: ${join(otherRepository, ".git")}\n`,
  );

  await expect(
    run(executable, [
      "worktree",
      "validate",
      "--repo",
      repository,
      "--run",
      runId,
      "--json",
    ]),
  ).rejects.toMatchObject({
    code: 4,
    stdout: "",
    stderr: expect.stringContaining("GIT_INVARIANT_VIOLATION"),
  });
});

test("flow validates without acquiring the run mutation lock", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_161616161616";
  await createExplicitRun(repository, runId);
  const prepared = JSON.parse(
    (
      await run(executable, [
        "worktree",
        "prepare",
        "--repo",
        repository,
        "--run",
        runId,
        "--json",
      ])
    ).stdout,
  );
  const lock = await acquireRunLock(repository, runId);
  try {
    const { stdout } = await run(executable, [
      "worktree",
      "validate",
      "--repo",
      repository,
      "--run",
      runId,
      "--json",
    ]);
    expect(JSON.parse(stdout)).toMatchObject({
      runId,
      valid: true,
      git: prepared.git,
    });
  } finally {
    await releaseRunLock(lock);
  }
});

test("failed Git execution preserves the synchronized preparation intent", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_909090909090";
  await createExplicitRun(repository, runId);

  await expect(
    prepareWorktree(
      { repository, runId },
      {
        gitRunner: async () => {
          throw new FlowError(
            "injected worktree failure",
            3,
            "WORKTREE_CREATION_FAILED",
          );
        },
      },
    ),
  ).rejects.toMatchObject({ code: "WORKTREE_CREATION_FAILED", exitCode: 3 });

  const interrupted = await inspectRun(repository, runId);
  expect(interrupted.snapshot).toMatchObject({
    phase: "preparing",
    git: { worktreeStatus: "planned" },
  });
  expect(interrupted.operationalHistory).toHaveLength(2);
});

test("flow persists explicit base, branch, and caller-relative worktree inputs", async () => {
  const repository = await createCommittedTargetRepository();
  const caller = await temporaryDirectory();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);
  const base = await gitOutput(repository, ["rev-parse", "HEAD"]);

  const { stdout } = await run(
    executable,
    [
      "worktree",
      "prepare",
      "--repo",
      repository,
      "--run",
      runId,
      "--base",
      "HEAD",
      "--branch",
      "feature/custom",
      "--worktree",
      "relative-feature-worktree",
      "--json",
    ],
    { cwd: caller },
  );

  const canonicalCaller = await realpath(caller);
  expect(JSON.parse(stdout)).toMatchObject({
    git: {
      runBase: base,
      featureBranch: "feature/custom",
      featureWorktree: join(canonicalCaller, "relative-feature-worktree"),
    },
  });
});

test("flow supports SHA-256 Target repositories without truncating commits", async () => {
  const repository = await temporaryDirectory();
  await run("git", ["init", "--quiet", "--object-format=sha256", repository]);
  await run("git", [
    "-C",
    repository,
    "config",
    "user.email",
    "test@example.com",
  ]);
  await run("git", ["-C", repository, "config", "user.name", "Test User"]);
  await mkdir(join(repository, "specs"));
  await writeFile(join(repository, "specs", "feature.md"), "# Feature\n");
  await run("git", ["-C", repository, "add", "."]);
  await run("git", ["-C", repository, "commit", "--quiet", "-m", "initial"]);
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);

  const { stdout } = await run(executable, [
    "worktree",
    "prepare",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  const result = JSON.parse(stdout);
  expect(result.git.runBase).toMatch(/^[0-9a-f]{64}$/);
  expect(result.git.validatedHead).toBe(result.git.runBase);
});

test("flow refuses an unborn Target repository before preparing", async () => {
  const repository = await createTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);

  await expect(
    run(executable, [
      "worktree",
      "prepare",
      "--repo",
      repository,
      "--run",
      runId,
    ]),
  ).rejects.toMatchObject({
    code: 4,
    stdout: "",
    stderr: expect.stringContaining("unborn"),
  });
});

test("flow refuses a Target repository checked out as a submodule", async () => {
  const superproject = await createCommittedTargetRepository();
  const child = await createCommittedTargetRepository();
  await run("git", [
    "-C",
    superproject,
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    "--quiet",
    child,
    "vendor/child",
  ]);
  await run("git", ["-C", superproject, "add", "."]);
  await run("git", [
    "-C",
    superproject,
    "commit",
    "--quiet",
    "-m",
    "submodule",
  ]);
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(join(superproject, "vendor", "child"), runId);

  await expect(
    run(executable, [
      "worktree",
      "prepare",
      "--repo",
      join(superproject, "vendor", "child"),
      "--run",
      runId,
    ]),
  ).rejects.toMatchObject({
    code: 4,
    stdout: "",
    stderr: expect.stringContaining("submodule"),
  });
});

test("flow refuses branch and worktree collisions before persisting preparation", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);
  await run("git", ["-C", repository, "branch", "existing"]);
  const statePath = join(
    repository,
    ".orchestrator",
    "runs",
    runId,
    "state.json",
  );
  const before = await readFile(statePath, "utf8");

  await expect(
    run(executable, [
      "worktree",
      "prepare",
      "--repo",
      repository,
      "--run",
      runId,
      "--branch",
      "existing",
    ]),
  ).rejects.toMatchObject({ code: 3, stdout: "" });
  expect(await readFile(statePath, "utf8")).toBe(before);

  const registeredPath = await temporaryDirectory();
  await run("git", [
    "-C",
    repository,
    "worktree",
    "add",
    "--quiet",
    "--detach",
    registeredPath,
  ]);
  const secondRunId = "run_20260904T120001Z_012345abcdee";
  await createExplicitRun(repository, secondRunId);
  await expect(
    run(executable, [
      "worktree",
      "prepare",
      "--repo",
      repository,
      "--run",
      secondRunId,
      "--worktree",
      join(registeredPath, "nested"),
    ]),
  ).rejects.toMatchObject({ code: 4, stdout: "" });
});

test("flow refuses symlinked Feature worktree path components", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);
  const caller = await temporaryDirectory();
  const redirected = await temporaryDirectory();
  await symlink(redirected, join(caller, "redirected"));

  await expect(
    run(
      executable,
      [
        "worktree",
        "prepare",
        "--repo",
        repository,
        "--run",
        runId,
        "--worktree",
        "redirected/feature",
      ],
      { cwd: caller },
    ),
  ).rejects.toMatchObject({
    code: 4,
    stdout: "",
    stderr: expect.stringContaining("symbolic link"),
  });
});

test("flow prepares a run whose Target repository is a linked worktree", async () => {
  const mainRepository = await createCommittedTargetRepository();
  const linkedRepository = join(await temporaryDirectory(), "linked-target");
  await run("git", [
    "-C",
    mainRepository,
    "worktree",
    "add",
    "--quiet",
    linkedRepository,
  ]);
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(linkedRepository, runId);

  const { stdout } = await run(executable, [
    "worktree",
    "prepare",
    "--repo",
    linkedRepository,
    "--run",
    runId,
    "--json",
  ]);
  expect(JSON.parse(stdout)).toMatchObject({
    runId,
    phase: "implementing",
    git: { worktreeStatus: "ready" },
  });
});

async function createExplicitRun(
  repository: string,
  runId: string,
): Promise<void> {
  await run(executable, [
    "run",
    "create",
    "--repo",
    repository,
    "--spec",
    "specs/feature.md",
    "--run",
    runId,
  ]);
}

async function createCommittedTargetRepository(): Promise<string> {
  const repository = await createTargetRepository();
  await run("git", [
    "-C",
    repository,
    "config",
    "user.email",
    "test@example.com",
  ]);
  await run("git", ["-C", repository, "config", "user.name", "Test User"]);
  await run("git", ["-C", repository, "add", "."]);
  await run("git", ["-C", repository, "commit", "--quiet", "-m", "initial"]);
  return repository;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "flow-invalid-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function createBareRepository(): Promise<string> {
  const repository = await temporaryDirectory();
  await run("git", ["init", "--quiet", "--bare", repository]);
  return repository;
}

async function gitOutput(repository: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", repository, ...args]);
  return stdout.trim();
}
