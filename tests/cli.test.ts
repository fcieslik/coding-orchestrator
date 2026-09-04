import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("flow requires every explicit create option", async () => {
  const repository = await createTargetRepository();

  await expect(
    run(executable, [
      "run",
      "create",
      "--repo",
      repository,
      "--spec",
      "specs/feature.md",
    ]),
  ).rejects.toMatchObject({ code: 2, stdout: "" });
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
