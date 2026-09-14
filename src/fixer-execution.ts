import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  open,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  HerdrAdapter,
  normalizeAgentName,
  type HerdrExecutionHandle,
} from "./herdr.js";
import { launchSkillAwareFixer } from "./fixer.js";
import { readOrchestrationConfig } from "./setup.js";
import {
  executionRecordSchema,
  fixerResultSchema,
  type FixerResult,
  type ReviewAttention,
  type StateSnapshot,
} from "./schema.js";
import { inspectCheckpoint, validateCheckpoint } from "./git-worktree.js";
import {
  acquireRunLock,
  FlowError,
  inspectRun,
  mutateRun,
  releaseRunLock,
  selectRun,
  type ReadRunResult,
  type RunDependencies,
} from "./workflow-run.js";

const exec = promisify(execFile);
const fixerAttemptId = "fixer-attempt-01";
const maxDiagnosticBytes = 32 * 1024;

export interface ExecuteFixerOptions {
  repository?: string;
  runId: string;
  ticketId: string;
  ticketInput: string;
  specification: string;
  resolution: string;
  dependencies?: RunDependencies;
  adapter?: HerdrAdapter;
}

export interface FixerExecutionReport {
  status: "accepted" | "blocked" | "failed";
  outcome: "accepted" | "blocked" | "failed";
  code:
    | "FIXER_ATTEMPT_ACCEPTED"
    | "FIXER_ATTEMPT_BLOCKED"
    | "FIXER_EXECUTION_FAILED";
  exitCode: 0 | 1 | 4;
  runId: string;
  ticketId: string;
  attemptId: string;
  executionId?: string;
  candidateCommit: string;
  acceptedCommit?: string;
  result?: FixerResult;
  reason?: string;
  artifacts: {
    directory: string;
    brief: string;
    record: string;
    output: string;
  };
  snapshot: StateSnapshot;
}

interface FixerArtifacts {
  directory: string;
  brief: string;
  record: string;
  outputDirectory: string;
  output: string;
}

interface FixerRecord {
  schemaVersion: 1;
  executionId: string;
  runId: string;
  ticketId: string;
  attemptId: string;
  attempt: 1;
  status:
    "prepared" | "running" | "reconciling" | "accepted" | "blocked" | "failed";
  role: "fixer";
  agentProfile: string;
  agentKind: "codex";
  skill: "bounded-fixer";
  ticket: { source: string; input: string; hash: string };
  specification: string;
  worktree: string;
  artifacts: {
    directory: string;
    input: string;
    record: string;
    output: string;
    brief: string;
  };
  promptHash: string;
  promptDelivery: "not-started" | "unknown" | "confirmed";
  checkpoint?: {
    previousValidatedHead: string;
    acceptedCommit: string;
  };
  timestamps: {
    preparedAt: string;
    startedAt?: string;
    settledAt?: string;
    finalizedAt?: string;
  };
  herdr?: {
    callerPaneId: string;
    paneId?: string;
    agentName: string;
    version?: string;
    lifecycle?: string;
  };
  cleanup?: { status: "not-attempted" | "closed" | "failed"; error?: string };
  diagnostics?: { output?: string; truncated?: boolean };
}

interface FixBrief {
  schemaVersion: 1;
  runId: string;
  ticketId: string;
  ticket: { input: string; specification: string };
  candidateCommit: string;
  findings: ReviewAttention["findings"];
  resolution: string;
  allowedScope: string;
  safeguards: string[];
  resultPath: string;
  commitRequired: true;
  outputRequirements: string[];
}

function fixerError(
  message: string,
  code = "FIXER_EXECUTION_FAILED",
  exitCode: number = 4,
  details?: Record<string, unknown>,
): FlowError {
  return new FlowError(message, exitCode, code, details);
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    await rename(temporary, path);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeRecord(path: string, record: FixerRecord): Promise<void> {
  const checked = executionRecordSchema.parse(record);
  await atomicWrite(path, `${JSON.stringify(checked, null, 2)}\n`);
  await chmod(path, 0o600);
}

async function readRecord(
  path: string,
): Promise<{ record?: FixerRecord; error?: string }> {
  try {
    const parsed = executionRecordSchema.safeParse(
      JSON.parse(await readFile(path, "utf8")),
    );
    if (!parsed.success)
      return { error: "Fixer execution record is malformed" };
    if (parsed.data.role !== "fixer")
      return { error: "Execution record is not a Fixer record" };
    return { record: parsed.data as FixerRecord };
  } catch (error) {
    return {
      error: isNodeError(error, "ENOENT")
        ? "Fixer execution record is missing"
        : error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

async function readResult(path: string): Promise<FixerResult | undefined> {
  try {
    const parsed = fixerResultSchema.safeParse(
      JSON.parse(await readFile(path, "utf8")),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function git(worktree: string, args: string[]): Promise<string> {
  try {
    const result = await exec("git", args, {
      cwd: worktree,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return result.stdout.trim();
  } catch (error) {
    throw fixerError(
      `Git command failed: git ${args.join(" ")}: ${error instanceof Error ? error.message : String(error)}`,
      "GIT_INVARIANT_VIOLATION",
    );
  }
}

async function isAncestor(
  worktree: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  try {
    await exec("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: worktree,
      encoding: "utf8",
    });
    return true;
  } catch {
    return false;
  }
}

function artifactsFor(
  repository: string,
  runId: string,
  ticketId: string,
): FixerArtifacts {
  const directory = resolve(
    repository,
    ".orchestrator",
    "runs",
    runId,
    "fixers",
    ticketId,
    fixerAttemptId,
  );
  const outputDirectory = join(directory, "output");
  return {
    directory,
    brief: join(directory, "fix-brief.json"),
    record: join(directory, "execution.json"),
    outputDirectory,
    output: join(outputDirectory, "result.json"),
  };
}

function executionReference(
  executionId: string,
  ticketId: string,
  attemptId: string,
  path: string,
) {
  return { executionId, ticketId, attemptId, path };
}

function fixerAttemptState(
  execution: FixerRecord,
  resolution: string,
  status: "prepared" | "running" | "blocked" | "failed" | "accepted",
  acceptedCommit?: string,
) {
  return {
    executionId: execution.executionId,
    attemptId: execution.attemptId,
    path: execution.artifacts.record,
    status,
    resolution,
    ...(acceptedCommit === undefined ? {} : { acceptedCommit }),
  };
}

async function updateFixerState(
  repository: string,
  runId: string,
  execution: FixerRecord,
  attention: ReviewAttention,
  resolution: string,
  status: "prepared" | "running" | "blocked" | "failed" | "accepted",
  dependencies: RunDependencies,
  acceptedCommit?: string,
  active = false,
): Promise<ReadRunResult> {
  const lock = await acquireRunLock(repository, runId, dependencies);
  try {
    return await mutateRun(
      {
        repository,
        runId,
        event: "checkpoint",
        preserveLifecycle: true,
        historyEventType:
          status === "prepared"
            ? "fixer.attempt.prepared"
            : status === "running"
              ? "fixer.attempt.started"
              : `fixer.attempt.${status}`,
        data: {
          executionId: execution.executionId,
          ticketId: execution.ticketId,
          attemptId: execution.attemptId,
          resolution,
          ...(acceptedCommit === undefined ? {} : { acceptedCommit }),
        },
        updateSnapshot: () => ({
          reviewAttention: {
            ...attention,
            resolution,
            fixerAttempt: fixerAttemptState(
              execution,
              resolution,
              status,
              acceptedCommit,
            ),
          },
          ...(active
            ? {
                activeExecution: executionReference(
                  execution.executionId,
                  execution.ticketId,
                  execution.attemptId,
                  execution.artifacts.record,
                ),
              }
            : {
                activeExecution: undefined,
                lastExecution: executionReference(
                  execution.executionId,
                  execution.ticketId,
                  execution.attemptId,
                  execution.artifacts.record,
                ),
              }),
        }),
        lock,
      },
      dependencies,
    );
  } finally {
    await releaseRunLock(lock);
  }
}

function report(
  status: FixerExecutionReport["status"],
  snapshot: StateSnapshot,
  execution: FixerRecord,
  artifacts: FixerArtifacts,
  candidateCommit: string,
  extras: {
    result?: FixerResult;
    reason?: string;
    acceptedCommit?: string;
  } = {},
): FixerExecutionReport {
  return {
    status,
    outcome: status,
    code:
      status === "accepted"
        ? "FIXER_ATTEMPT_ACCEPTED"
        : status === "blocked"
          ? "FIXER_ATTEMPT_BLOCKED"
          : "FIXER_EXECUTION_FAILED",
    exitCode: status === "accepted" ? 0 : status === "failed" ? 1 : 4,
    runId: execution.runId,
    ticketId: execution.ticketId,
    attemptId: execution.attemptId,
    executionId: execution.executionId,
    candidateCommit,
    ...(extras.acceptedCommit === undefined
      ? {}
      : { acceptedCommit: extras.acceptedCommit }),
    ...(extras.result === undefined ? {} : { result: extras.result }),
    ...(extras.reason === undefined ? {} : { reason: extras.reason }),
    artifacts: {
      directory: artifacts.directory,
      brief: artifacts.brief,
      record: artifacts.record,
      output: artifacts.output,
    },
    snapshot,
  };
}

async function closeOwnedPane(
  execution: FixerRecord,
  adapter: HerdrAdapter,
): Promise<{ status: "closed" | "failed"; error?: string }> {
  if (!execution.herdr?.paneId) return { status: "closed" };
  try {
    await adapter.close({
      paneId: execution.herdr.paneId,
      agentName: execution.herdr.agentName,
      agentKind: "codex",
      cwd: execution.worktree,
    });
    return { status: "closed" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function completeFixer(
  options: ExecuteFixerOptions,
  execution: FixerRecord,
  artifacts: FixerArtifacts,
  attention: ReviewAttention,
  candidateCommit: string,
  result: FixerResult,
  adapter: HerdrAdapter,
): Promise<FixerExecutionReport> {
  if (result.status !== "completed")
    throw fixerError("Internal Fixer completion requires a completed result");
  const head = await git(execution.worktree, ["rev-parse", "HEAD"]);
  const dirty = await git(execution.worktree, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (head !== result.commit || dirty.length > 0)
    throw fixerError(
      "Fixer result does not match a clean Feature worktree HEAD",
      "CHECKPOINT_COMMIT_MISMATCH",
    );
  if (result.commit === candidateCommit)
    throw fixerError(
      "Fixer must create a separate correction commit",
      "FIXER_COMMIT_NOT_SEPARATE",
    );
  if (!(await isAncestor(execution.worktree, candidateCommit, result.commit)))
    throw fixerError(
      "Fixer correction commit does not preserve candidate ancestry",
      "CHECKPOINT_DIVERGED",
    );
  await inspectCheckpoint({
    ...(options.repository === undefined
      ? {}
      : { repository: options.repository }),
    runId: options.runId,
    commit: result.commit,
  });
  const cleanup = await closeOwnedPane(execution, adapter);
  execution.cleanup = cleanup;
  if (cleanup.status === "failed")
    throw fixerError(
      `Fixer pane cleanup failed: ${cleanup.error ?? "unknown error"}`,
      "CLEANUP_FAILED",
    );
  execution.status = "reconciling";
  const accepted = await validateCheckpoint({
    ...(options.repository === undefined
      ? {}
      : { repository: options.repository }),
    runId: options.runId,
    commit: result.commit,
    ...(options.dependencies === undefined
      ? {}
      : { dependencies: options.dependencies }),
    finalization: {
      historyEventType: "fixer.attempt.accepted",
      data: {
        executionId: execution.executionId,
        ticketId: execution.ticketId,
        attemptId: execution.attemptId,
        candidateCommit,
      },
      updateSnapshot: (snapshot) => ({
        reviewAttention:
          snapshot.reviewAttention === undefined
            ? undefined
            : {
                ...snapshot.reviewAttention,
                resolution: options.resolution,
                fixerAttempt: fixerAttemptState(
                  execution,
                  options.resolution,
                  "accepted",
                  result.commit,
                ),
              },
        lastExecution: executionReference(
          execution.executionId,
          execution.ticketId,
          execution.attemptId,
          execution.artifacts.record,
        ),
        activeExecution: undefined,
      }),
    },
  });
  execution.status = "accepted";
  execution.checkpoint = {
    previousValidatedHead: accepted.previousValidatedHead,
    acceptedCommit: accepted.acceptedCommit,
  };
  execution.timestamps.finalizedAt = new Date().toISOString();
  await writeRecord(artifacts.record, execution);
  return report(
    "accepted",
    accepted.snapshot,
    execution,
    artifacts,
    candidateCommit,
    {
      result,
      acceptedCommit: result.commit,
    },
  );
}

async function finishNonCompleted(
  options: ExecuteFixerOptions,
  execution: FixerRecord,
  artifacts: FixerArtifacts,
  attention: ReviewAttention,
  resolution: string,
  result: FixerResult | undefined,
  reason: string,
  adapter?: HerdrAdapter,
): Promise<FixerExecutionReport> {
  if (adapter !== undefined && execution.cleanup?.status !== "closed")
    execution.cleanup = await closeOwnedPane(execution, adapter);
  const status = result?.status === "failed" ? "failed" : "blocked";
  execution.status = status;
  execution.timestamps.finalizedAt = new Date().toISOString();
  await writeRecord(artifacts.record, execution).catch(() => undefined);
  const current = await updateFixerState(
    resolve(options.repository ?? process.cwd()),
    options.runId,
    execution,
    attention,
    resolution,
    status,
    options.dependencies ?? {},
  );
  return report(
    status,
    current.snapshot,
    execution,
    artifacts,
    attention.candidateCommit,
    {
      ...(result === undefined ? {} : { result }),
      reason,
    },
  );
}

async function reconcileExisting(
  options: ExecuteFixerOptions,
  repository: string,
  run: ReadRunResult,
  attention: ReviewAttention,
): Promise<FixerExecutionReport> {
  const attempt = attention.fixerAttempt;
  if (!attempt)
    throw fixerError(
      "Review attention has no Fixer attempt evidence",
      "UNTRUSTED_ARTIFACT",
    );
  const artifacts = {
    directory: dirname(attempt.path),
    brief: join(dirname(attempt.path), "fix-brief.json"),
    record: attempt.path,
    outputDirectory: join(dirname(attempt.path), "output"),
    output: join(dirname(attempt.path), "output", "result.json"),
  };
  const recordRead = await readRecord(artifacts.record);
  if (!recordRead.record)
    return {
      status: "blocked",
      outcome: "blocked",
      code: "FIXER_ATTEMPT_BLOCKED",
      exitCode: 4,
      runId: options.runId,
      ticketId: options.ticketId,
      attemptId: attempt.attemptId,
      candidateCommit: attention.candidateCommit,
      reason: recordRead.error ?? "Fixer record is unavailable",
      artifacts,
      snapshot: run.snapshot,
    };
  const execution = recordRead.record;
  const result = await readResult(artifacts.output);
  if (execution.status === "accepted" && result?.status === "completed")
    return report(
      "accepted",
      run.snapshot,
      execution,
      artifacts,
      attention.candidateCommit,
      {
        result,
        acceptedCommit: result.commit,
      },
    );
  if (result?.status === "completed") {
    try {
      return await completeFixer(
        options,
        execution,
        artifacts,
        attention,
        attention.candidateCommit,
        result,
        options.adapter ?? new HerdrAdapter({ maxDiagnosticBytes }),
      );
    } catch (error) {
      return finishNonCompleted(
        options,
        execution,
        artifacts,
        attention,
        options.resolution,
        result,
        error instanceof Error ? error.message : String(error),
        options.adapter ?? new HerdrAdapter({ maxDiagnosticBytes }),
      );
    }
  }
  if (execution.status === "blocked" || execution.status === "failed")
    return report(
      execution.status,
      run.snapshot,
      execution,
      artifacts,
      attention.candidateCommit,
      {
        ...(result === undefined ? {} : { result }),
        reason: "The single Fixer attempt has already settled",
      },
    );
  return finishNonCompleted(
    options,
    execution,
    artifacts,
    attention,
    options.resolution,
    result,
    "The existing Fixer attempt has not published a completed result; no second attempt is allowed",
    options.adapter ?? new HerdrAdapter({ maxDiagnosticBytes }),
  );
}

export async function executeFixer(
  options: ExecuteFixerOptions,
): Promise<FixerExecutionReport> {
  const selected = await selectRun(options.repository, options.runId);
  const repository = selected.repository;
  const run = await inspectRun(repository, options.runId);
  const attention = run.snapshot.reviewAttention;
  if (!attention || attention.ticketId !== options.ticketId)
    throw fixerError(
      "The requested ticket has no matching Review attention state",
      "REVIEW_ATTENTION_NOT_FOUND",
      4,
    );
  const resolution = options.resolution.trim();
  if (!resolution)
    throw fixerError(
      "An explicit resolution is required before launching a Fixer",
      "FIXER_RESOLUTION_REQUIRED",
      4,
    );
  if (attention.resolution !== undefined && attention.resolution !== resolution)
    throw fixerError(
      "A different Fixer resolution was supplied for the existing attempt",
      "FIXER_RESOLUTION_MISMATCH",
      4,
    );
  if (attention.fixerAttempt)
    return reconcileExisting(
      { ...options, resolution },
      repository,
      run,
      attention,
    );
  if (run.snapshot.activeExecution)
    throw fixerError(
      `Workflow run ${options.runId} already has an active execution: ${run.snapshot.activeExecution.executionId}`,
      "EXECUTION_ALREADY_ACTIVE",
      5,
    );
  const worktree = run.snapshot.git?.featureWorktree;
  if (!worktree || run.snapshot.git?.worktreeStatus !== "ready")
    throw fixerError("Feature worktree is not ready", "WORKTREE_NOT_READY");
  await inspectCheckpoint({
    repository,
    runId: options.runId,
    commit: attention.candidateCommit,
  });
  const callerPaneId =
    process.env.HERDR_PANE_ID ?? process.env.HERDR_ACTIVE_PANE_ID;
  if (!callerPaneId)
    throw fixerError(
      "Fixer execution requires a genuine Herdr-managed caller pane (HERDR_PANE_ID)",
      "HERDR_CONTEXT_REQUIRED",
      3,
    );
  const artifacts = artifactsFor(repository, options.runId, options.ticketId);
  const parent = dirname(artifacts.directory);
  const existing = await readdir(parent, { withFileTypes: true }).catch(
    (error: unknown) =>
      isNodeError(error, "ENOENT") ? [] : Promise.reject(error),
  );
  if (existing.some((entry) => entry.isDirectory()))
    throw fixerError(
      "The single Fixer attempt has already been allocated; reconcile it instead of launching another",
      "FIXER_ATTEMPT_EXHAUSTED",
      4,
    );
  await mkdir(artifacts.outputDirectory, { recursive: true, mode: 0o700 });
  const config = await readOrchestrationConfig(repository);
  const execution: FixerRecord = {
    schemaVersion: 1,
    executionId: `fix_${randomUUID()}`,
    runId: options.runId,
    ticketId: options.ticketId,
    attemptId: fixerAttemptId,
    attempt: 1,
    status: "prepared",
    role: "fixer",
    agentProfile: config.config.roles.worker.agent,
    agentKind: "codex",
    skill: "bounded-fixer",
    ticket: {
      source: options.ticketInput,
      input: options.ticketInput,
      hash: createHash("sha256")
        .update(await readFile(options.ticketInput, "utf8"), "utf8")
        .digest("hex"),
    },
    specification: options.specification,
    worktree: resolve(worktree),
    artifacts: {
      directory: artifacts.directory,
      input: options.ticketInput,
      record: artifacts.record,
      output: artifacts.output,
      brief: artifacts.brief,
    },
    promptHash: "0".repeat(64),
    promptDelivery: "not-started",
    timestamps: { preparedAt: new Date().toISOString() },
  };
  const brief: FixBrief = {
    schemaVersion: 1,
    runId: options.runId,
    ticketId: options.ticketId,
    ticket: {
      input: options.ticketInput,
      specification: options.specification,
    },
    candidateCommit: attention.candidateCommit,
    findings: attention.findings,
    resolution,
    allowedScope:
      "Resolve the listed finding inside the original ticket scope only.",
    safeguards: [
      "Use only the existing Feature worktree.",
      "Preserve the candidate commit in ancestry.",
      "Do not modify the primary checkout or Integration target branch.",
      "Do not expand the ticket or specification scope.",
    ],
    resultPath: artifacts.output,
    commitRequired: true,
    outputRequirements: [
      "Create at least one separate correction commit.",
      "Write exactly one atomic JSON result to resultPath.",
      "Use completed, blocked, or failed status.",
    ],
  };
  await atomicWrite(artifacts.brief, `${JSON.stringify(brief, null, 2)}\n`);
  await writeRecord(artifacts.record, execution);
  await updateFixerState(
    repository,
    options.runId,
    execution,
    attention,
    resolution,
    "prepared",
    options.dependencies ?? {},
    undefined,
    true,
  );
  const adapter = options.adapter ?? new HerdrAdapter({ maxDiagnosticBytes });
  let handle: HerdrExecutionHandle | undefined;
  try {
    const version = await adapter.version();
    execution.status = "running";
    execution.herdr = {
      callerPaneId,
      agentName: normalizeAgentName(
        `${options.ticketId}-${fixerAttemptId}-${options.runId}-fixer`,
      ),
      version,
    };
    execution.timestamps.startedAt = new Date().toISOString();
    await writeRecord(artifacts.record, execution);
    await updateFixerState(
      repository,
      options.runId,
      execution,
      attention,
      resolution,
      "running",
      options.dependencies ?? {},
      undefined,
      true,
    );
    const launched = await launchSkillAwareFixer({
      role: "fixer",
      agentProfile: execution.agentProfile,
      agentKind: "codex",
      runId: options.runId,
      ticketId: options.ticketId,
      briefPath: artifacts.brief,
      worktree: execution.worktree,
      candidateCommit: attention.candidateCommit,
      resultPath: artifacts.output,
      commitRequired: true,
      callerPaneId,
      agentName: execution.herdr.agentName,
      adapter,
      outputDirectory: artifacts.outputDirectory,
      settlementTimeoutMs: config.config.workflow.workerTimeoutSeconds * 1000,
      onLaunched: async (launchedHandle) => {
        handle = launchedHandle;
        execution.herdr = {
          ...execution.herdr!,
          paneId: launchedHandle.paneId,
        };
        await writeRecord(artifacts.record, execution);
      },
    });
    handle = launched.handle;
    execution.status = "reconciling";
    execution.promptDelivery = "confirmed";
    execution.promptHash = launched.rendered.promptHash;
    execution.timestamps.settledAt = new Date().toISOString();
    execution.herdr = {
      ...execution.herdr!,
      paneId: launched.handle.paneId,
      ...(launched.startupState === undefined
        ? {}
        : { lifecycle: launched.startupState }),
    };
    const diagnostic = await adapter.read(launched.handle);
    const bounded = Buffer.from(diagnostic, "utf8");
    execution.diagnostics = {
      output: bounded.subarray(-maxDiagnosticBytes).toString("utf8"),
      truncated: bounded.byteLength > maxDiagnosticBytes,
    };
    await writeRecord(artifacts.record, execution);
    const result = await readResult(artifacts.output);
    if (!result)
      return finishNonCompleted(
        options,
        execution,
        artifacts,
        attention,
        resolution,
        undefined,
        "Fixer result is missing or malformed",
        adapter,
      );
    if (result.ticketId !== options.ticketId)
      return finishNonCompleted(
        options,
        execution,
        artifacts,
        attention,
        resolution,
        result,
        "Fixer result ticket ID does not match the assigned ticket",
        adapter,
      );
    if (result.status !== "completed")
      return finishNonCompleted(
        options,
        execution,
        artifacts,
        attention,
        resolution,
        result,
        result.status === "blocked"
          ? (result.blocker.requiredDecision ?? result.blocker.decision!)
          : result.diagnostics.message,
        adapter,
      );
    return await completeFixer(
      options,
      execution,
      artifacts,
      attention,
      attention.candidateCommit,
      result,
      adapter,
    );
  } catch (error) {
    if (handle && execution.cleanup?.status !== "closed") {
      const cleanup = await closeOwnedPane(execution, adapter);
      execution.cleanup = cleanup;
    }
    return finishNonCompleted(
      options,
      execution,
      artifacts,
      attention,
      resolution,
      undefined,
      error instanceof Error ? error.message : String(error),
      adapter,
    );
  }
}
