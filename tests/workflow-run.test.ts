import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, expect, test } from "vitest";

import {
  acquireGitOperationLock,
  acquireRunLock,
  createRun,
  inspectRun,
  mutateRun,
  releaseRunLock,
  releaseGitOperationLock,
} from "../src/workflow-run.js";

const run = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("createRun accepts injected time and randomness and retries generated collisions", async () => {
  const repository = await mkdtemp(join(tmpdir(), "flow-run-"));
  temporaryDirectories.push(repository);
  await run("git", ["init", "--quiet", repository]);
  await mkdir(join(repository, "specs"));
  await writeFile(join(repository, "specs", "feature.md"), "# Feature\n");

  const collidingRunId = "run_20260904T120000Z_012345abcdef";
  const replacementRunId = "run_20260904T120000Z_fedcba987654";
  await createRun({
    repository,
    specification: "specs/feature.md",
    runId: collidingRunId,
  });

  const randomValues = [
    Buffer.from("012345abcdef", "hex"),
    Buffer.from("fedcba987654", "hex"),
  ];
  let randomCalls = 0;
  const generatedRunId = await createRun(
    { repository, specification: "specs/feature.md" },
    {
      clock: () => new Date("2026-09-04T12:00:00.123Z"),
      randomBytes: () => {
        const value = randomValues[randomCalls];
        randomCalls += 1;
        if (!value) throw new Error("random source exhausted");
        return value;
      },
    },
  );

  expect(generatedRunId).toBe(replacementRunId);
  expect(randomCalls).toBe(2);
  const snapshot = JSON.parse(
    await readFile(
      join(repository, ".orchestrator", "runs", replacementRunId, "state.json"),
      "utf8",
    ),
  );
  expect(snapshot.createdAt).toBe("2026-09-04T12:00:00.123Z");
});

async function createTestRun(
  repository: string,
  suffix: string,
  clock?: () => Date,
): Promise<string> {
  await mkdir(join(repository, "specs"), { recursive: true });
  await writeFile(join(repository, "specs", "feature.md"), "# Feature\n");
  const runId = `run_20260904T120000Z_${suffix}`;
  await createRun(
    {
      repository,
      specification: "specs/feature.md",
      runId,
    },
    clock === undefined ? {} : { clock },
  );
  return runId;
}

test("mutateRun publishes one linked snapshot and history revision", async () => {
  const repository = await mkdtemp(join(tmpdir(), "flow-mutation-"));
  temporaryDirectories.push(repository);
  await run("git", ["init", "--quiet", repository]);
  const runId = await createTestRun(
    repository,
    "111111111111",
    () => new Date("2026-09-04T12:00:00.000Z"),
  );

  const result = await mutateRun(
    { repository, runId, event: { type: "prepare" } },
    {
      clock: () => new Date("2026-09-04T11:00:00.000Z"),
      randomBytes: () => Buffer.alloc(16, 1),
    },
  );

  expect(result.snapshot).toMatchObject({
    phase: "preparing",
    revision: 2,
    updatedAt: "2026-09-04T12:00:00.000Z",
  });
  expect(result.operationalHistory.at(-1)).toMatchObject({
    sequence: 2,
    stateRevision: 2,
    timestamp: "2026-09-04T12:00:00.000Z",
    type: "run.preparation.started",
  });
  expect(result.audit.synchronized).toBe(true);
});

test("mutateRun persists review and check fixer continuations and cleans them up", async () => {
  const repository = await mkdtemp(join(tmpdir(), "flow-mutation-"));
  temporaryDirectories.push(repository);
  await run("git", ["init", "--quiet", repository]);
  const runId = await createTestRun(
    repository,
    "555555555555",
    () => new Date("2026-09-04T12:00:00.000Z"),
  );
  const events = [
    "prepare",
    "implement",
    "review",
    "review.fail",
    "block",
    "resume",
    "fix.complete",
    "check",
    "check.fail",
    "block",
    "resume",
    "fix.complete",
    "complete",
  ] as const;

  let result = await mutateRun({ repository, runId, event: events[0] });
  for (const event of events.slice(1)) {
    result = await mutateRun({ repository, runId, event });
  }

  expect(result.snapshot.phase).toBe("completed");
  expect(result.snapshot).not.toHaveProperty("interruptedPhase");
  expect(result.snapshot).not.toHaveProperty("fixReturnPhase");
  expect(result.snapshot.revision).toBe(14);
  expect(result.operationalHistory).toHaveLength(14);
  expect(result.operationalHistory.at(-1)).toMatchObject({
    sequence: 14,
    stateRevision: 14,
    type: "run.completed",
  });
});

test("a snapshot publication failure leaves the old complete state visible", async () => {
  const repository = await mkdtemp(join(tmpdir(), "flow-mutation-"));
  temporaryDirectories.push(repository);
  await run("git", ["init", "--quiet", repository]);
  const runId = await createTestRun(repository, "222222222222");

  await expect(
    mutateRun(
      { repository, runId, event: "prepare" },
      {
        beforeSnapshotPublication: () => Promise.reject(new Error("injected")),
      },
    ),
  ).rejects.toThrow("injected");
  const result = await inspectRun(repository, runId);
  expect(result.snapshot.revision).toBe(1);
  expect(result.snapshot.phase).toBe("created");
  expect(result.operationalHistory).toHaveLength(1);
});

test("a history publication failure leaves a readable audit gap that blocks mutation", async () => {
  const repository = await mkdtemp(join(tmpdir(), "flow-mutation-"));
  temporaryDirectories.push(repository);
  await run("git", ["init", "--quiet", repository]);
  const runId = await createTestRun(repository, "333333333333");

  await expect(
    mutateRun(
      { repository, runId, event: "prepare" },
      { afterSnapshotPublication: () => Promise.reject(new Error("injected")) },
    ),
  ).rejects.toThrow("injected");
  const result = await inspectRun(repository, runId);
  expect(result.snapshot.revision).toBe(2);
  expect(result.snapshot.phase).toBe("preparing");
  expect(result.audit.synchronized).toBe(false);
  await expect(
    mutateRun({ repository, runId, event: "implement" }),
  ).rejects.toMatchObject({ code: "AUDIT_GAP", exitCode: 4 });
});

test("a failure after history publication leaves the complete new state readable", async () => {
  const repository = await mkdtemp(join(tmpdir(), "flow-mutation-"));
  temporaryDirectories.push(repository);
  await run("git", ["init", "--quiet", repository]);
  const runId = await createTestRun(repository, "777777777777");

  await expect(
    mutateRun(
      { repository, runId, event: "prepare" },
      { afterHistoryPublication: () => Promise.reject(new Error("injected")) },
    ),
  ).rejects.toThrow("injected");
  const result = await inspectRun(repository, runId);
  expect(result.snapshot).toMatchObject({ phase: "preparing", revision: 2 });
  expect(result.operationalHistory).toHaveLength(2);
  expect(result.audit.synchronized).toBe(true);
});

test("run locks expose safe owner details, refuse contention, and require the owner token", async () => {
  const repository = await mkdtemp(join(tmpdir(), "flow-lock-"));
  temporaryDirectories.push(repository);
  await run("git", ["init", "--quiet", repository]);
  const runId = await createTestRun(repository, "444444444444");
  const first = await acquireRunLock(repository, runId, {
    clock: () => new Date("2026-09-04T12:01:00.000Z"),
    hostname: () => "test-host",
    randomBytes: () => Buffer.alloc(16, 4),
  });

  await expect(acquireRunLock(repository, runId)).rejects.toMatchObject({
    code: "LOCK_CONTENTION",
    exitCode: 5,
    details: {
      owner: {
        pid: process.pid,
        hostname: "test-host",
        acquiredAt: "2026-09-04T12:01:00.000Z",
      },
    },
  });
  await expect(
    releaseRunLock({ ...first, ownerToken: "not-the-owner" }),
  ).rejects.toMatchObject({ code: "LOCK_RELEASE_FAILED" });
  await releaseRunLock(first);
  const second = await acquireRunLock(repository, runId);
  await releaseRunLock(second);
});

test("a concurrent subprocess holding the lock is refused immediately", async () => {
  const repository = await mkdtemp(join(tmpdir(), "flow-lock-process-"));
  temporaryDirectories.push(repository);
  await run("git", ["init", "--quiet", repository]);
  const runId = await createTestRun(repository, "666666666666");
  const lockPath = join(repository, ".orchestrator", "runs", runId, "lock");
  const holder = spawn(
    process.execPath,
    [
      "-e",
      `const fs = require("node:fs"); const path = process.argv[1]; const fd = fs.openSync(path, "wx", 0o600); fs.writeSync(fd, JSON.stringify({ pid: process.pid, hostname: "subprocess-host", acquiredAt: "2026-09-04T12:02:00.000Z", ownerToken: "subprocess-token" })); console.log("ready"); setTimeout(() => { fs.closeSync(fd); fs.unlinkSync(path); }, 1000);`,
      lockPath,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  await new Promise<void>((resolve, reject) => {
    holder.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("ready")) resolve();
    });
    holder.once("error", reject);
    holder.stderr.on("data", (chunk: Buffer) => {
      if (chunk.length > 0) reject(new Error(chunk.toString()));
    });
  });
  try {
    await expect(acquireRunLock(repository, runId)).rejects.toMatchObject({
      code: "LOCK_CONTENTION",
      exitCode: 5,
      details: { owner: { hostname: "subprocess-host" } },
    });
  } finally {
    await new Promise<void>((resolve) => holder.once("close", () => resolve()));
  }
});

test("repository Git-operation locks serialize owners and preserve stale locks", async () => {
  const repository = await mkdtemp(join(tmpdir(), "flow-git-lock-"));
  temporaryDirectories.push(repository);
  await run("git", ["init", "--quiet", repository]);
  await createTestRun(repository, "888888888888");

  const first = await acquireGitOperationLock(repository, {
    clock: () => new Date("2026-09-04T12:03:00.000Z"),
    hostname: () => "git-owner",
    randomBytes: () => Buffer.alloc(16, 8),
  });
  await expect(acquireGitOperationLock(repository)).rejects.toMatchObject({
    code: "LOCK_CONTENTION",
    exitCode: 5,
    details: { owner: { hostname: "git-owner" } },
  });
  await expect(
    releaseGitOperationLock({ ...first, ownerToken: "wrong-token" }),
  ).rejects.toMatchObject({ code: "LOCK_RELEASE_FAILED" });
  await releaseGitOperationLock(first);
  const second = await acquireGitOperationLock(repository);
  await releaseGitOperationLock(second);
});
