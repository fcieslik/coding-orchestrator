import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, expect, test } from "vitest";

import { integrateWorkflowRun } from "../src/integration.js";
import { prepareWorktree } from "../src/git-worktree.js";
import { setupRepository } from "../src/setup.js";
import { createRun, inspectRun, mutateRun } from "../src/workflow-run.js";

const run = promisify(execFile);
const executable = fileURLToPath(new URL("../scripts/flow", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function git(repository: string, args: string[]): Promise<string> {
  const result = await run("git", ["-C", repository, ...args], {
    encoding: "utf8",
  });
  return result.stdout.trim();
}

async function createCompletedRun(): Promise<{
  repository: string;
  packageDirectory: string;
  runId: string;
  featureWorktree: string;
  featureHead: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "flow-integrate-"));
  temporaryDirectories.push(directory);
  const repository = await realpath(directory);
  await run("git", ["init", "--quiet", "-b", "main", repository]);
  await run("git", [
    "-C",
    repository,
    "config",
    "user.email",
    "test@example.com",
  ]);
  await run("git", ["-C", repository, "config", "user.name", "Test"]);
  const packageDirectory = join(repository, "feature");
  await mkdir(join(packageDirectory, "issues"), { recursive: true });
  await writeFile(join(packageDirectory, "spec.md"), "# Feature\n");
  await writeFile(join(packageDirectory, "issues", "01-first.md"), "# First\n");
  await setupRepository({ repository });
  await writeFile(
    join(repository, ".orchestrator", "config.yaml"),
    `version: 1

agents:
  codex:
    kind: codex

roles:
  worker:
    agent: codex
    skill: implement

workflow:
  workerTimeoutSeconds: 1800
  maxWorkerAttempts: 2
  validation:
    test: "true"
    lint: "true"
    typecheck: "true"
    formatCheck: "true"
    build: "true"
    timeoutSeconds: 60
`,
  );
  await run("git", ["-C", repository, "add", "."]);
  await run("git", ["-C", repository, "commit", "--quiet", "-m", "initial"]);

  const runId = await createRun({
    repository,
    specification: "feature/spec.md",
    runId: "run_20260909T120000Z_012345abcdef",
  });
  const prepared = await prepareWorktree({ repository, runId });
  const featureWorktree = prepared.snapshot.git!.featureWorktree;
  await writeFile(join(featureWorktree, "implementation.txt"), "done\n");
  await git(featureWorktree, ["add", "implementation.txt"]);
  await git(featureWorktree, ["commit", "--quiet", "-m", "implementation"]);
  const featureHead = await git(featureWorktree, ["rev-parse", "HEAD"]);
  const inputRoot = join(
    repository,
    ".orchestrator",
    "runs",
    runId,
    "input",
    "package",
  );
  await mkdir(join(inputRoot, "issues"), { recursive: true });
  await writeFile(join(inputRoot, "spec.md"), "# Feature\n");
  await writeFile(join(inputRoot, "issues", "01-first.md"), "# First\n");
  await mutateRun({
    repository,
    runId,
    event: "checkpoint",
    preserveLifecycle: true,
    historyEventType: "workflow.ticket.accepted",
    updateSnapshot: (snapshot) => ({
      phase: "completed",
      workflowPackage: {
        source: "feature",
        snapshot: inputRoot,
        specification: join(inputRoot, "spec.md"),
      },
      tickets: {
        "01-first": {
          status: "accepted",
          input: join(inputRoot, "issues", "01-first.md"),
          commit: featureHead,
        },
      },
      git: { ...snapshot.git!, validatedHead: featureHead },
    }),
  });
  return { repository, packageDirectory, runId, featureWorktree, featureHead };
}

test("detached HEAD is rejected before a Workflow run is created", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-detached-"));
  temporaryDirectories.push(directory);
  const repository = await realpath(directory);
  await run("git", ["init", "--quiet", "-b", "main", repository]);
  await run("git", [
    "-C",
    repository,
    "config",
    "user.email",
    "test@example.com",
  ]);
  await run("git", ["-C", repository, "config", "user.name", "Test"]);
  await writeFile(join(repository, "spec.md"), "# Feature\n");
  await run("git", ["-C", repository, "add", "spec.md"]);
  await run("git", ["-C", repository, "commit", "--quiet", "-m", "initial"]);
  await run("git", [
    "-C",
    repository,
    "checkout",
    "--quiet",
    "--detach",
    "HEAD",
  ]);

  await expect(
    createRun({ repository, specification: "spec.md" }),
  ).rejects.toMatchObject({ code: "DETACHED_HEAD" });
  await expect(
    readFile(join(repository, ".orchestrator", "runs")),
  ).rejects.toMatchObject({
    code: "ENOENT",
  });
});

test("local integration validates, fast-forwards, preserves Feature resources, and is idempotent", async () => {
  const context = await createCompletedRun();

  const first = JSON.parse(
    (
      await run(
        executable,
        ["integrate", "feature", "--repo", context.repository, "--json"],
        { cwd: context.repository },
      )
    ).stdout,
  ) as Awaited<ReturnType<typeof integrateWorkflowRun>>;
  expect(first).toMatchObject({
    status: "completed",
    channel: "local",
    delivery: {
      channel: "local",
      status: "completed",
      validatedHead: context.featureHead,
      integrationTargetBranch: "main",
      integratedCommit: context.featureHead,
    },
  });
  expect(await git(context.repository, ["rev-parse", "main"])).toBe(
    context.featureHead,
  );
  expect(await git(context.repository, ["rev-parse", "HEAD"])).toBe(
    context.featureHead,
  );

  const afterFirst = await inspectRun(context.repository, context.runId);
  const historyLength = afterFirst.operationalHistory.length;
  const second = await integrateWorkflowRun({
    repository: context.repository,
    package: "feature",
  });
  expect(second.delivery).toEqual(first.delivery);
  const afterSecond = await inspectRun(context.repository, context.runId);
  expect(afterSecond.operationalHistory).toHaveLength(historyLength);
  expect(
    await git(context.repository, ["worktree", "list", "--porcelain"]),
  ).toContain(context.featureWorktree);
  expect(
    await git(context.repository, [
      "show-ref",
      "--verify",
      `refs/heads/${afterSecond.snapshot.git!.featureBranch}`,
    ]),
  ).toContain(context.featureHead);
});

test("a moved Integration target is refused before Delivery intent is persisted", async () => {
  const context = await createCompletedRun();
  await writeFile(join(context.repository, "target-change.txt"), "moved\n");
  await git(context.repository, ["add", "target-change.txt"]);
  await git(context.repository, ["commit", "--quiet", "-m", "move target"]);
  const movedHead = await git(context.repository, ["rev-parse", "HEAD"]);

  await expect(
    integrateWorkflowRun({
      repository: context.repository,
      package: "feature",
    }),
  ).rejects.toMatchObject({ code: "TARGET_MOVED_OR_DIVERGED" });
  const state = await inspectRun(context.repository, context.runId);
  expect(state.snapshot.delivery).toBeUndefined();
  expect(await git(context.repository, ["rev-parse", "HEAD"])).toBe(movedHead);
  expect(
    await git(context.repository, [
      "rev-parse",
      "refs/heads/" + state.snapshot.git!.featureBranch,
    ]),
  ).toBe(context.featureHead);
});

test("a prepared local Delivery can recover after an interrupted fast-forward attempt", async () => {
  const context = await createCompletedRun();
  await expect(
    integrateWorkflowRun({
      repository: context.repository,
      package: "feature",
      dependencies: {
        gitRunner: async () => {
          throw new Error("interrupted before Git mutation");
        },
      },
    }),
  ).rejects.toThrow("interrupted before Git mutation");
  expect(
    (await inspectRun(context.repository, context.runId)).snapshot.delivery,
  ).toMatchObject({
    channel: "local",
    status: "prepared",
  });

  const recovered = await integrateWorkflowRun({
    repository: context.repository,
    package: "feature",
  });
  expect(recovered.delivery).toMatchObject({
    status: "completed",
    integratedCommit: context.featureHead,
  });
});
