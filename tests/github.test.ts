import { execFile } from "node:child_process";
import {
  chmod,
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

import { inspectRun } from "../src/workflow-run.js";

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
  return (
    await run("git", ["-C", repository, ...args], { encoding: "utf8" })
  ).stdout.trim();
}

async function completedRunWithOrigin(): Promise<{
  repository: string;
  runId: string;
  featureHead: string;
  featureBranch: string;
  toolDirectory: string;
  commandLog: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "flow-pr-"));
  temporaryDirectories.push(directory);
  const repository = await realpath(directory);
  const remote = join(directory, "origin.git");
  const toolDirectory = join(directory, "tools");
  const commandLog = join(directory, "gh-commands.log");
  await run("git", ["init", "--quiet", "-b", "main", repository]);
  await run("git", ["init", "--bare", "--quiet", remote]);
  await run("git", [
    "-C",
    repository,
    "config",
    "user.email",
    "test@example.com",
  ]);
  await run("git", ["-C", repository, "config", "user.name", "Test"]);
  await mkdir(join(repository, "feature", "issues"), { recursive: true });
  await writeFile(
    join(repository, "feature", "spec.md"),
    "# Publish feature\n",
  );
  await writeFile(
    join(repository, "feature", "issues", "01-first.md"),
    "# First\n",
  );
  await writeFile(join(repository, ".gitignore"), ".orchestrator/\n");
  await writeFile(join(repository, ".orchestrator-config"), "placeholder\n");
  await git(repository, ["add", "."]);
  await git(repository, ["commit", "--quiet", "-m", "initial"]);
  await git(repository, ["remote", "add", "origin", remote]);

  const { createRun } = await import("../src/workflow-run.js");
  const { prepareWorktree } = await import("../src/git-worktree.js");
  const { setupRepository } = await import("../src/setup.js");
  const { mutateRun } = await import("../src/workflow-run.js");
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
  await writeFile(join(inputRoot, "spec.md"), "# Publish feature\n");
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
  await mkdir(toolDirectory);
  await writeFile(
    join(toolDirectory, "gh-axi"),
    `#!/bin/sh
echo "gh-axi $*" >> "$FAKE_GH_LOG"
case "$1 $2" in
  "--version ") echo 'gh-axi test' ;;
  "auth status") exit 0 ;;
  "pr list") if [ "$FAKE_AXI_UNSUPPORTED" = "yes" ]; then echo 'unsupported command' >&2; exit 1; fi; if [ "$FAKE_FAIL_LIST" = "yes" ]; then exit 1; fi; printf '%s\n' "$FAKE_PR_LIST" ;;
  "pr create") echo '{"number":42,"url":"https://example.test/pr/42","state":"OPEN","mergedAt":null}' ;;
  "pr checks") printf '%s\n' "$FAKE_CHECKS" ;;
  *) echo "unsupported command: $*" >&2; exit 1 ;;
esac
`,
    { mode: 0o755 },
  );
  await chmod(join(toolDirectory, "gh-axi"), 0o755);
  await writeFile(
    join(toolDirectory, "gh"),
    `#!/bin/sh
echo "gh $*" >> "$FAKE_GH_LOG"
case "$1 $2" in
  "--version ") echo 'gh test' ;;
  "auth status") exit 0 ;;
  "pr list") printf '%s\n' "$FAKE_PR_LIST" ;;
  "pr create") echo '{"number":42,"url":"https://example.test/pr/42","state":"OPEN","mergedAt":null}' ;;
  "pr checks") printf '%s\n' "$FAKE_CHECKS" ;;
  *) exit 1 ;;
esac
`,
    { mode: 0o755 },
  );
  await chmod(join(toolDirectory, "gh"), 0o755);
  return {
    repository,
    runId,
    featureHead,
    featureBranch: prepared.snapshot.git!.featureBranch,
    toolDirectory,
    commandLog,
  };
}

async function executePr(
  context: Awaited<ReturnType<typeof completedRunWithOrigin>>,
  environment: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string }> {
  return run(
    executable,
    ["pr", "feature", "--repo", context.repository, "--json"],
    {
      cwd: context.repository,
      env: {
        ...process.env,
        PATH: `${context.toolDirectory}:${process.env.PATH}`,
        FAKE_GH_LOG: context.commandLog,
        FAKE_FAIL_LIST: "",
        FAKE_AXI_UNSUPPORTED: "",
        FAKE_PR_LIST: "[]",
        FAKE_CHECKS: '[{"name":"test","state":"SUCCESS","bucket":"pass"}]',
        ...environment,
      },
    },
  );
}

test("flow pr pushes once, creates a Pull Request, and persists its checks observation", async () => {
  const context = await completedRunWithOrigin();
  const { stdout } = await executePr(context);
  const report = JSON.parse(stdout) as { delivery: Record<string, unknown> };
  expect(report.delivery).toMatchObject({
    channel: "github",
    status: "completed",
    validatedHead: context.featureHead,
    integrationTargetBranch: "main",
    remoteFeatureBranch: context.featureBranch,
    pullRequest: {
      number: 42,
      url: "https://example.test/pr/42",
      state: "open",
    },
    checks: "passed",
  });
  expect(
    await git(context.repository, [
      "rev-parse",
      `refs/remotes/origin/${context.featureBranch}`,
    ]),
  ).toBe(context.featureHead);
  expect(await readFile(context.commandLog, "utf8")).toContain("pr create");
  expect(
    (await inspectRun(context.repository, context.runId)).snapshot.delivery,
  ).toMatchObject(report.delivery);
});

test("a completed GitHub delivery is idempotent and does not create another Pull Request", async () => {
  const context = await completedRunWithOrigin();
  await executePr(context);
  const historyLength = (await inspectRun(context.repository, context.runId))
    .operationalHistory.length;
  const { stdout } = await executePr(context);
  expect(JSON.parse(stdout)).toMatchObject({ status: "completed" });
  expect(
    (await inspectRun(context.repository, context.runId)).operationalHistory,
  ).toHaveLength(historyLength);
  expect(
    (await readFile(context.commandLog, "utf8")).match(/pr create/g),
  ).toHaveLength(1);
});

test("preflight refusal for a missing origin does not select the GitHub channel", async () => {
  const context = await completedRunWithOrigin();
  await git(context.repository, ["remote", "remove", "origin"]);
  await expect(executePr(context)).rejects.toMatchObject({
    stderr: expect.stringContaining('"code":"ORIGIN_REMOTE_MISSING"'),
  });
  expect(
    (await inspectRun(context.repository, context.runId)).snapshot.delivery,
  ).toBeUndefined();
});

test("a conflicting remote Feature branch is refused without a force-push or channel selection", async () => {
  const context = await completedRunWithOrigin();
  await git(context.repository, [
    "push",
    "origin",
    `main:refs/heads/${context.featureBranch}`,
  ]);
  await expect(executePr(context)).rejects.toMatchObject({
    stderr: expect.stringContaining('"code":"REMOTE_FEATURE_CONFLICT"'),
  });
  expect(
    (await inspectRun(context.repository, context.runId)).snapshot.delivery,
  ).toBeUndefined();
  expect(
    await git(context.repository, [
      "rev-parse",
      `refs/remotes/origin/${context.featureBranch}`,
    ]),
  ).not.toBe(context.featureHead);
});

test("an existing open Pull Request is reused and failed checks remain a completed handoff", async () => {
  const context = await completedRunWithOrigin();
  const { stdout } = await executePr(context, {
    FAKE_PR_LIST:
      '[{"number":9,"url":"https://example.test/pr/9","state":"OPEN","mergedAt":null}]',
    FAKE_CHECKS: '[{"name":"test","state":"FAILURE","bucket":"fail"}]',
  });
  expect(JSON.parse(stdout)).toMatchObject({
    status: "completed",
    delivery: { pullRequest: { number: 9, state: "open" }, checks: "failed" },
  });
  expect(await readFile(context.commandLog, "utf8")).not.toContain("pr create");
});

test("an interruption after push leaves prepared intent and a repeat creates only one Pull Request", async () => {
  const context = await completedRunWithOrigin();
  await expect(
    executePr(context, { FAKE_FAIL_LIST: "yes" }),
  ).rejects.toBeDefined();
  expect(
    (await inspectRun(context.repository, context.runId)).snapshot.delivery,
  ).toMatchObject({
    channel: "github",
    status: "prepared",
  });
  const { stdout } = await executePr(context);
  expect(JSON.parse(stdout)).toMatchObject({ status: "completed" });
  expect(
    (await readFile(context.commandLog, "utf8")).match(/pr create/g),
  ).toHaveLength(1);
});

test("an unsupported gh-axi operation falls back to authenticated official gh", async () => {
  const context = await completedRunWithOrigin();
  const { stdout } = await executePr(context, { FAKE_AXI_UNSUPPORTED: "yes" });
  expect(JSON.parse(stdout)).toMatchObject({ status: "completed" });
  const commands = await readFile(context.commandLog, "utf8");
  expect(commands).toContain("gh-axi pr list");
  expect(commands).toContain("gh auth status");
  expect(commands).toContain("gh pr list");
  expect(commands).toContain("gh-axi pr create");
});
