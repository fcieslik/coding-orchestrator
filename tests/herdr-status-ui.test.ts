import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, expect, test } from "vitest";

import { createRun, mutateRun } from "../src/workflow-run.js";

const run = promisify(execFile);
const pluginEntry = fileURLToPath(
  new URL("../plugins/coding-orchestrator-status/status.mjs", import.meta.url),
);
const flowExecutable = fileURLToPath(
  new URL("../scripts/flow", import.meta.url),
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function targetRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "flow-status-ui-"));
  temporaryDirectories.push(repository);
  await run("git", ["init", "--quiet", repository]);
  await writeFile(join(repository, "spec.md"), "# Status UI\n");
  return repository;
}

async function metadataReporter(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "flow-status-herdr-"));
  temporaryDirectories.push(directory);
  const executable = join(directory, "herdr");
  const log = join(directory, "metadata.jsonl");
  await writeFile(
    executable,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.METADATA_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
`,
  );
  await chmod(executable, 0o755);
  return `${executable}\0${log}`;
}

function pluginEnvironment(
  repository: string,
  herdr: string,
  log: string,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HERDR_PLUGIN_ROOT: join(repository, "plugin-root"),
    HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
      workspace: { workspace_id: "workspace:test", cwd: repository },
    }),
    HERDR_WORKSPACE_ID: "workspace:test",
    HERDR_BIN_PATH: herdr,
    METADATA_LOG: log,
    ORCHESTRATOR_FLOW_PATH: flowExecutable,
    ...extra,
  };
}

async function invokePlugin(
  repository: string,
  extra: Record<string, string> = {},
): Promise<{ stdout: string; metadata: string[][] }> {
  const reporter = await metadataReporter();
  const [herdr, log] = reporter.split("\0");
  if (!herdr || !log) throw new Error("metadata reporter paths are missing");
  const result = await run(process.execPath, [pluginEntry, "--once"], {
    cwd: repository,
    env: pluginEnvironment(repository, herdr, log, extra),
  });
  const contents = await readFile(log, "utf8").catch(() => "");
  return {
    stdout: result.stdout,
    metadata: contents
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]),
  };
}

async function createWorkflowStatus(repository: string): Promise<string> {
  return createWorkflowStatusWithId(
    repository,
    "run_20260916T120000Z_012345abcdef",
  );
}

async function createWorkflowStatusWithId(
  repository: string,
  runId: string,
): Promise<string> {
  await createRun({ repository, specification: "spec.md", runId });
  await mutateRun({
    repository,
    runId,
    event: "checkpoint",
    preserveLifecycle: true,
    updateSnapshot: () => ({
      workflowPackage: {
        source: "feature/status-ui",
        snapshot: "/tmp/package-snapshot",
        specification: "/tmp/package-snapshot/spec.md",
      },
      tickets: {
        "01-first": { status: "accepted", input: "/tmp/01.md" },
        "02-current": { status: "active", input: "/tmp/02.md" },
        "03-next": { status: "pending", input: "/tmp/03.md" },
      },
    }),
  });
  await mutateRun({ repository, runId, event: "prepare" });
  await mutateRun({ repository, runId, event: "implement" });
  await mutateRun({
    repository,
    runId,
    event: "checkpoint",
    preserveLifecycle: true,
    updateSnapshot: () => ({
      activeExecution: {
        executionId: "execution-current",
        ticketId: "02-current",
        attemptId: "attempt-1",
        path: "/tmp/execution.json",
      },
    }),
  });
  return runId;
}

test("real plugin entrypoint renders public status and publishes bounded metadata", async () => {
  const repository = await targetRepository();
  const runId = await createWorkflowStatus(repository);
  const before = await Promise.all([
    readFile(
      join(repository, ".orchestrator", "runs", runId, "state.json"),
      "utf8",
    ),
    readFile(
      join(repository, ".orchestrator", "runs", runId, "history.jsonl"),
      "utf8",
    ),
  ]);

  const result = await invokePlugin(repository);
  expect(result.stdout).toContain("Package: feature/status-ui");
  expect(result.stdout).toContain(`Run: ${runId}`);
  expect(result.stdout).toContain("Phase: implementing");
  expect(result.stdout).toContain("Progress: 1/3 tickets accepted");
  expect(result.stdout).toContain("Current/next: 02-current");
  expect(result.stdout).toContain("[x] 01-first (accepted)");
  expect(result.stdout).toContain("[>] 02-current (active)");
  expect(result.stdout).toContain("[ ] 03-next (pending)");
  expect(result.stdout).toContain("Validation: not run");
  expect(result.stdout).toContain("Delivery: not recorded");

  const metadata = result.metadata.at(-1);
  expect(metadata).toBeDefined();
  expect(metadata).toContain("workspace:test");
  expect(metadata).toContain("--ttl-ms");
  expect(metadata).toContain("--token");
  expect(metadata).toContain("package=feature/status-ui");
  expect(metadata).toContain("ticket=02-current");
  expect(metadata).toContain("progress=1/3");
  expect(metadata).toContain("step=working: 02-current");
  expect(
    await Promise.all([
      readFile(
        join(repository, ".orchestrator", "runs", runId, "state.json"),
        "utf8",
      ),
      readFile(
        join(repository, ".orchestrator", "runs", runId, "history.jsonl"),
        "utf8",
      ),
    ]),
  ).toEqual(before);
});

test("review attention and technical failure remain distinct and bounded", async () => {
  const repository = await targetRepository();
  const runId = await createWorkflowStatus(repository);
  await mutateRun({
    repository,
    runId,
    event: "checkpoint",
    preserveLifecycle: true,
    updateSnapshot: () => ({
      reviewAttention: {
        status: "attention",
        ticketId: "02-current",
        executionId: "execution-current",
        attemptId: "attempt-1",
        candidateCommit: "0123456789abcdef0123456789abcdef01234567",
        findings: [
          {
            axis: "spec",
            summary: "The candidate needs a product decision.",
            requiredDecision: "Choose the intended behavior.",
          },
        ],
      },
    }),
  });
  const review = await invokePlugin(repository);
  expect(review.stdout).toContain(
    "Review attention: 02-current requires a decision.",
  );
  expect(review.stdout).toContain(
    "Finding: The candidate needs a product decision.",
  );
  expect(review.stdout).not.toContain("Technical failure:");

  await mutateRun({ repository, runId, event: "block" });
  await mutateRun({
    repository,
    runId,
    event: "checkpoint",
    preserveLifecycle: true,
    updateSnapshot: () => ({
      reviewAttention: undefined,
      lastExecution: {
        executionId: "execution-failed",
        ticketId: "02-current",
        attemptId: "attempt-1",
        path: "/tmp/diagnostic-execution.json",
        failureReason: "agent start failed (exit 23)",
      },
    }),
  });
  const failure = await invokePlugin(repository);
  expect(failure.stdout).toContain("Phase: blocked");
  expect(failure.stdout).toContain(
    "Technical failure: agent start failed (exit 23)",
  );
  expect(failure.stdout).toContain(
    "Diagnostic: /tmp/diagnostic-execution.json",
  );
  expect(failure.stdout).not.toContain("SECRET_TRANSCRIPT");
});

test.each([
  ["missing run", {}, "State: No workflow run"],
  [
    "invalid context",
    {
      HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
        workspace: { workspace_id: "workspace:test" },
      }),
    },
    "State: Context unavailable",
  ],
  [
    "invalid repository",
    {
      HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
        workspace: { workspace_id: "workspace:test", cwd: tmpdir() },
      }),
    },
    "State: Target repository is invalid",
  ],
  [
    "missing skill",
    { ORCHESTRATOR_FLOW_PATH: "/not/a/flow" },
    "State: Orchestrator unavailable",
  ],
])("renders a clear read-only state for %s", async (_name, extra, expected) => {
  const repository = await targetRepository();
  const result = await invokePlugin(repository, extra);
  expect(result.stdout).toContain(expected);
  expect(result.stdout).toContain(
    "Read-only panel: no workflow operation is available.",
  );
});

test("reports ambiguous public run selection without guessing", async () => {
  const repository = await targetRepository();
  await createWorkflowStatusWithId(
    repository,
    "run_20260916T120000Z_012345abcdef",
  );
  await createWorkflowStatusWithId(
    repository,
    "run_20260916T120001Z_abcdef012345",
  );
  const result = await invokePlugin(repository);
  expect(result.stdout).toContain("State: Run selection is ambiguous");
  expect(result.stdout).toContain("Specify one with --run");
});

test("refreshes metadata with TTL and exits cleanly on q", async () => {
  const repository = await targetRepository();
  await createWorkflowStatus(repository);
  const reporter = await metadataReporter();
  const [herdr, log] = reporter.split("\0");
  if (!herdr || !log) throw new Error("metadata reporter paths are missing");
  const child = spawn(process.execPath, [pluginEntry], {
    cwd: repository,
    env: pluginEnvironment(repository, herdr, log, {
      CODING_ORCHESTRATOR_REFRESH_MS: "40",
      CODING_ORCHESTRATOR_METADATA_TTL_MS: "120",
    }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  const exitPromise = new Promise<number>((resolve, reject) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", reject);
  });
  let closeRequested = false;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("plugin did not render")),
      3_000,
    );
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (output.includes("Coding Workflow Status") && !closeRequested) {
        closeRequested = true;
        clearTimeout(timeout);
        setTimeout(() => child.stdin.write("q"), 900);
        resolve();
      }
    });
    child.on("error", reject);
  });
  const exit = await exitPromise;
  expect(exit).toBe(0);
  expect(output).toContain("Read-only panel. Press q or Esc to close.");
  const reports = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
  expect(reports.length).toBeGreaterThanOrEqual(2);
  const ttlValues = reports.map(
    (report) => report[report.indexOf("--ttl-ms") + 1],
  );
  expect(new Set(ttlValues)).toEqual(new Set(["120"]));
  const sequences = reports.map((report) =>
    Number(report[report.indexOf("--seq") + 1]),
  );
  expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
});
