import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, expect, test } from "vitest";

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
