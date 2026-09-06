import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  HerdrAdapter,
  normalizeAgentName,
  type HerdrExecutionHandle,
  type HerdrObservedState,
} from "./herdr.js";
import { launchSkillAwareWorker } from "./worker.js";
import { readOrchestrationConfig } from "./setup.js";
import {
  executionRecordSchema,
  workerResultSchema,
  type ExecutionRecord,
  type StateSnapshot,
  type WorkerResult,
} from "./schema.js";
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
import {
  inspectCheckpoint,
  validateCheckpoint,
  validateWorktree,
} from "./git-worktree.js";

const exec = promisify(execFile);
const attemptPattern = /^attempt-(\d+)$/;
const maxDiagnosticBytes = 32 * 1024;

export interface ExecuteWorkerOptions {
  repository?: string;
  runId: string;
  ticket: string;
  dependencies?: RunDependencies;
  adapter?: HerdrAdapter;
  /** Internal retry seam: use a previously persisted immutable input. */
  ticketSnapshot?: TicketInput;
  retryLineage?: {
    previousAttemptId: string;
    previousExecutionId?: string;
    previousInputHash: string;
    refreshed: boolean;
  };
  forceNewAttempt?: boolean;
  automaticRetry?: boolean;
}

export interface WorkerExecutionReport {
  status: "accepted";
  executionId: string;
  runId: string;
  ticketId: string;
  attemptId: string;
  result: WorkerResult;
  artifacts: {
    directory: string;
    input: string;
    record: string;
    output: string;
  };
  previousValidatedHead: string;
  acceptedCommit: string;
  snapshot: StateSnapshot;
}

export interface ReconcileWorkerOptions {
  repository?: string;
  runId: string;
  ticketId?: string;
  attemptId?: string;
  executionId?: string;
  dependencies?: RunDependencies;
  adapter?: HerdrAdapter;
}

export interface RetryWorkerOptions {
  repository?: string;
  runId: string;
  ticket?: string;
  attemptId?: string;
  executionId?: string;
  refreshTicket?: string;
  dependencies?: RunDependencies;
  adapter?: HerdrAdapter;
}

export interface WorkerReconciliationReport {
  status: "accepted" | "blocked" | "failed";
  outcome: "accepted" | "reconciliation-required" | "conclusive-failure";
  code:
    | "WORKER_ATTEMPT_ACCEPTED"
    | "WORKER_RECONCILIATION_REQUIRED"
    | "WORKER_EXECUTION_FAILED";
  exitCode: 0 | 1 | 4;
  runId: string;
  ticketId: string;
  attemptId: string;
  executionId?: string;
  result?: WorkerResult;
  reason?: string;
  evidence: {
    result: "completed" | "blocked" | "failed" | "missing" | "invalid";
    currentHead?: string;
    baselineHead?: string;
    clean?: boolean;
    commit?: string;
  };
  cleanup: {
    status: "not-required" | "closed" | "failed";
    paneId?: string;
    error?: string;
  };
  artifacts: {
    directory: string;
    input: string;
    record: string;
    output: string;
  };
  retry?: {
    eligible: boolean;
    attempt: number;
    maxAttempts: number;
    reason?: string;
  };
  snapshot: StateSnapshot;
}

interface TicketInput {
  id: string;
  source: string;
  contents: string;
  hash: string;
}

interface AttemptArtifacts {
  directory: string;
  inputDirectory: string;
  outputDirectory: string;
  input: string;
  record: string;
  output: string;
}

interface ExecutionRecordData {
  schemaVersion: 1;
  executionId: string;
  runId: string;
  ticketId: string;
  attemptId: string;
  attempt: number;
  status:
    "prepared" | "running" | "reconciling" | "accepted" | "blocked" | "failed";
  role: "worker";
  agentProfile: string;
  agentKind: "codex";
  skill: "implement";
  ticket: { source: string; input: string; hash: string };
  worktree: string;
  artifacts: {
    directory: string;
    input: string;
    record: string;
    output: string;
  };
  promptHash: string;
  promptDelivery?: "not-started" | "unknown" | "confirmed";
  retry?: {
    previousAttemptId: string;
    previousExecutionId?: string;
    previousInputHash: string;
    inputHash: string;
    refreshed: boolean;
  };
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
    lifecycle?: HerdrObservedState;
  };
  cleanup?: {
    status: "not-attempted" | "closed" | "failed";
    error?: string;
  };
  diagnostics?: { output?: string; truncated?: boolean };
}

function executionError(
  message: string,
  code = "WORKER_EXECUTION_FAILED",
  exitCode = 4,
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

async function assertNoSymlinkComponents(path: string): Promise<void> {
  const absolute = resolve(path);
  const components = absolute.split(sep).filter(Boolean);
  let current = absolute.startsWith(sep) ? sep : "";
  for (const component of components) {
    current = resolve(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw executionError(
          `Worker path traverses a symbolic link: ${current}`,
          "UNSAFE_RUNTIME_PATH",
        );
    } catch (error) {
      if (error instanceof FlowError) throw error;
      if (isNodeError(error, "ENOENT")) return;
      throw error;
    }
  }
}

async function atomicWrite(path: string, contents: string, mode = 0o600) {
  await assertNoSymlinkComponents(dirname(path));
  await assertNoSymlinkComponents(path);
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporary, "wx", mode);
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

async function readJson(path: string): Promise<unknown> {
  const entry = await lstat(path).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT"))
      throw executionError(
        `Worker result was not published: ${path}`,
        "RESULT_NOT_FOUND",
        3,
      );
    throw error;
  });
  if (entry.isSymbolicLink() || !entry.isFile())
    throw executionError(
      `Worker result is not a regular file: ${path}`,
      "INVALID_RESULT",
      4,
    );
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw executionError(
      `Worker result is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      "INVALID_RESULT",
      4,
    );
  }
}

async function resolveTicket(
  repository: string,
  requested: string,
): Promise<TicketInput> {
  if (!requested || requested.includes("\0") || /[\r\n]/.test(requested))
    throw executionError(
      "Ticket path contains an unsafe value",
      "INVALID_ARGUMENT",
      2,
    );
  const candidate = resolve(repository, requested);
  await assertNoSymlinkComponents(candidate);
  const entry = await lstat(candidate).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT"))
      throw executionError(
        `Ticket was not found: ${requested}`,
        "TICKET_NOT_FOUND",
        3,
      );
    throw error;
  });
  if (!entry.isFile())
    throw executionError(
      `Assigned ticket is not a regular file: ${requested}`,
      "INVALID_TICKET",
      2,
    );
  if (!/\.md$/i.test(candidate))
    throw executionError(
      `Assigned ticket must be a Markdown file: ${requested}`,
      "INVALID_TICKET",
      2,
    );
  const canonical = await realpath(candidate);
  const pathRelative = relative(repository, canonical);
  if (
    !pathRelative ||
    pathRelative === ".." ||
    pathRelative.startsWith(`..${sep}`) ||
    isAbsolute(pathRelative)
  )
    throw executionError(
      "Assigned ticket must be inside the Target repository",
      "INVALID_TICKET",
      2,
    );
  const contents = await readFile(candidate, "utf8");
  const id = basename(candidate).replace(/\.md$/i, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id))
    throw executionError(
      "Ticket filename does not produce a safe canonical ticket ID",
      "INVALID_TICKET",
      2,
      { ticket: requested, ticketId: id },
    );
  return {
    id,
    source: pathRelative.split(sep).join("/"),
    contents,
    hash: createHash("sha256").update(contents, "utf8").digest("hex"),
  };
}

async function nextAttempt(
  repository: string,
  runId: string,
  ticketId: string,
): Promise<{ number: number; id: string; artifacts: AttemptArtifacts }> {
  const workers = resolve(
    repository,
    ".orchestrator",
    "runs",
    runId,
    "workers",
  );
  const ticketDirectory = resolve(workers, ticketId);
  await assertNoSymlinkComponents(workers);
  await mkdir(ticketDirectory, { recursive: true, mode: 0o700 });
  await assertNoSymlinkComponents(ticketDirectory);
  const entries = await readdir(ticketDirectory, { withFileTypes: true });
  const used = entries.flatMap((entry) => {
    const match = attemptPattern.exec(entry.name);
    return match && entry.isDirectory() ? [Number(match[1])] : [];
  });
  const number = (used.length > 0 ? Math.max(...used) : 0) + 1;
  const id = `attempt-${String(number).padStart(2, "0")}`;
  const directory = resolve(ticketDirectory, id);
  await mkdir(directory, { mode: 0o700 });
  const inputDirectory = resolve(directory, "input");
  const outputDirectory = resolve(directory, "output");
  await mkdir(inputDirectory, { mode: 0o700 });
  await mkdir(outputDirectory, { mode: 0o700 });
  return {
    number,
    id,
    artifacts: {
      directory,
      inputDirectory,
      outputDirectory,
      input: resolve(inputDirectory, "ticket.md"),
      record: resolve(directory, "execution.json"),
      output: resolve(outputDirectory, "result.json"),
    },
  };
}

async function writeExecution(
  recordPath: string,
  record: ExecutionRecordData | ExecutionRecord,
): Promise<void> {
  const checked = executionRecordSchema.parse(record);
  await atomicWrite(recordPath, `${JSON.stringify(checked, null, 2)}\n`);
  await chmod(recordPath, 0o600);
}

async function git(repository: string, args: string[]): Promise<string> {
  try {
    const result = await exec("git", args, {
      cwd: repository,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return result.stdout.trim();
  } catch (error) {
    throw executionError(
      `Git command failed: git ${args.join(" ")}: ${error instanceof Error ? error.message : String(error)}`,
      "GIT_INVARIANT_VIOLATION",
      4,
    );
  }
}

async function hasNoWorkerEffects(
  worktree: string,
  baseline: string | undefined,
  resultPath: string,
): Promise<boolean> {
  if (!baseline) return false;
  try {
    const currentHead = await git(worktree, ["rev-parse", "HEAD"]);
    if (currentHead !== baseline) return false;
    const dirty = await git(worktree, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
    if (dirty.length > 0) return false;
    const resultEntry = await lstat(resultPath).catch((error: unknown) => {
      if (isNodeError(error, "ENOENT")) return undefined;
      throw error;
    });
    return resultEntry === undefined;
  } catch {
    return false;
  }
}

function promptWasAttempted(error: unknown): boolean {
  if (!(error instanceof FlowError)) return true;
  const operation = error.details?.operation;
  if (typeof operation !== "string") return true;
  return operation === "agent prompt";
}

async function mutateExecutionState(
  repository: string,
  runId: string,
  eventType: string,
  data: Record<string, unknown>,
  updateSnapshot: (snapshot: StateSnapshot) => Record<string, unknown>,
  dependencies: RunDependencies,
): Promise<ReadRunResult> {
  const lock = await acquireRunLock(repository, runId, dependencies);
  try {
    return await mutateRun(
      {
        repository,
        runId,
        event: "checkpoint",
        preserveLifecycle: true,
        historyEventType: eventType,
        data,
        updateSnapshot,
        lock,
      },
      dependencies,
    );
  } finally {
    await releaseRunLock(lock);
  }
}

function executionReference(
  executionId: string,
  ticketId: string,
  attemptId: string,
  recordPath: string,
) {
  return { executionId, ticketId, attemptId, path: recordPath };
}

async function assertReadyRun(
  repository: string,
  run: ReadRunResult,
  runId: string,
): Promise<string> {
  if (run.snapshot.phase !== "implementing") {
    const guidance =
      run.snapshot.phase === "preparing"
        ? "Complete Git preparation with flow worktree prepare first."
        : "Use an existing implementing Workflow run; terminal and blocked runs cannot execute a worker.";
    throw executionError(
      `Workflow run ${runId} is not ready for worker execution (${run.snapshot.phase}). ${guidance}`,
      "RUN_NOT_EXECUTABLE",
      4,
      { phase: run.snapshot.phase },
    );
  }
  const worktree = run.snapshot.git;
  if (
    !worktree ||
    worktree.worktreeStatus !== "ready" ||
    !worktree.validatedHead
  )
    throw executionError(
      `Workflow run ${runId} does not have a ready Feature worktree. Run flow worktree prepare first.`,
      "WORKTREE_NOT_READY",
      4,
    );
  await validateWorktree({ repository, runId });
  return worktree.featureWorktree;
}

function parseCompletedResult(
  value: unknown,
  ticketId: string,
): Extract<WorkerResult, { status: "completed" }> {
  const parsed = workerResultSchema.safeParse(value);
  if (!parsed.success)
    throw executionError(
      "Worker result does not satisfy the version 1 schema",
      "INVALID_RESULT",
      4,
      {
        issues: parsed.error.issues,
      },
    );
  if (parsed.data.ticketId !== ticketId)
    throw executionError(
      `Worker result ticket ID does not match the assigned ticket: ${parsed.data.ticketId}`,
      "RESULT_TICKET_MISMATCH",
      4,
    );
  if (parsed.data.status !== "completed")
    throw executionError(
      `Worker did not complete the assigned ticket (${parsed.data.status})`,
      "WORKER_NOT_COMPLETED",
      4,
    );
  return parsed.data;
}

async function recordFailure(
  repository: string,
  runId: string,
  recordPath: string,
  record: ExecutionRecordData,
  error: unknown,
  dependencies: RunDependencies,
): Promise<void> {
  const failure = error instanceof Error ? error.message : String(error);
  const failed = {
    ...record,
    status: "failed" as const,
    timestamps: {
      ...record.timestamps,
      finalizedAt: new Date().toISOString(),
    },
  };
  await writeExecution(recordPath, failed).catch(() => undefined);
  await mutateExecutionState(
    repository,
    runId,
    "worker.attempt.failed",
    {
      executionId: record.executionId,
      ticketId: record.ticketId,
      attemptId: record.attemptId,
      error: failure,
    },
    () => ({
      lastExecution: executionReference(
        record.executionId,
        record.ticketId,
        record.attemptId,
        recordPath,
      ),
      activeExecution: undefined,
    }),
    dependencies,
  ).catch(() => undefined);
}

function attemptNumber(attemptId: string): number {
  const match = attemptPattern.exec(attemptId);
  if (!match)
    throw executionError(
      `Invalid Worker attempt ID: ${attemptId}`,
      "INVALID_ATTEMPT",
      2,
    );
  return Number(match[1]);
}

function validateTicketId(ticketId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(ticketId))
    throw executionError(
      `Invalid Worker ticket ID: ${ticketId}`,
      "INVALID_TICKET",
      2,
    );
  return ticketId;
}

function attemptArtifacts(
  repository: string,
  runId: string,
  ticketId: string,
  attemptId: string,
): AttemptArtifacts {
  const directory = resolve(
    repository,
    ".orchestrator",
    "runs",
    runId,
    "workers",
    ticketId,
    attemptId,
  );
  const inputDirectory = resolve(directory, "input");
  const outputDirectory = resolve(directory, "output");
  return {
    directory,
    inputDirectory,
    outputDirectory,
    input: resolve(inputDirectory, "ticket.md"),
    record: resolve(directory, "execution.json"),
    output: resolve(outputDirectory, "result.json"),
  };
}

async function readExecutionRecord(
  path: string,
): Promise<{ value?: unknown; record?: ExecutionRecord; error?: string }> {
  try {
    await assertNoSymlinkComponents(path);
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink())
      return { error: "Execution record is not a regular file" };
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    const parsed = executionRecordSchema.safeParse(value);
    if (!parsed.success)
      return { value, error: "Execution record does not satisfy its schema" };
    return { value, record: parsed.data };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? `Execution record could not be read: ${error.message}`
          : "Execution record could not be read",
    };
  }
}

async function locateAttempt(
  repository: string,
  runId: string,
  run: ReadRunResult,
  options: ReconcileWorkerOptions,
): Promise<{
  ticketId: string;
  attemptId: string;
  artifacts: AttemptArtifacts;
}> {
  if (options.attemptId !== undefined) attemptNumber(options.attemptId);
  const active = run.snapshot.activeExecution;
  const reference = active ?? run.snapshot.lastExecution;
  const referenceMatchesExecution =
    options.executionId === undefined ||
    reference?.executionId === options.executionId;
  const requestedTicket =
    options.ticketId === undefined
      ? undefined
      : validateTicketId(options.ticketId);
  const referenceMatchesTicket =
    requestedTicket === undefined || reference?.ticketId === requestedTicket;

  let ticketId = referenceMatchesExecution
    ? (requestedTicket ??
      (reference?.ticketId === undefined || !referenceMatchesTicket
        ? undefined
        : validateTicketId(reference.ticketId)))
    : undefined;
  let attemptId =
    referenceMatchesExecution && referenceMatchesTicket
      ? (options.attemptId ?? reference?.attemptId)
      : undefined;
  const workers = resolve(
    repository,
    ".orchestrator",
    "runs",
    runId,
    "workers",
  );
  await assertNoSymlinkComponents(workers);

  if (ticketId && attemptId) {
    const artifacts = attemptArtifacts(repository, runId, ticketId, attemptId);
    await assertNoSymlinkComponents(artifacts.directory);
    return { ticketId, attemptId, artifacts };
  }

  const ticketEntries = await readdir(workers, { withFileTypes: true }).catch(
    (error: unknown) => {
      if (isNodeError(error, "ENOENT"))
        throw executionError(
          `No Worker attempts exist for run ${runId}`,
          "ATTEMPT_NOT_FOUND",
          3,
        );
      throw error;
    },
  );
  const candidates: Array<{
    ticketId: string;
    attemptId: string;
    number: number;
  }> = [];
  for (const ticketEntry of ticketEntries) {
    if (!ticketEntry.isDirectory() || ticketEntry.isSymbolicLink()) continue;
    validateTicketId(ticketEntry.name);
    const ticketDirectory = resolve(workers, ticketEntry.name);
    await assertNoSymlinkComponents(ticketDirectory);
    const attempts = await readdir(ticketDirectory, { withFileTypes: true });
    for (const attemptEntry of attempts) {
      if (!attemptEntry.isDirectory() || attemptEntry.isSymbolicLink())
        continue;
      if (!attemptPattern.test(attemptEntry.name)) continue;
      candidates.push({
        ticketId: ticketEntry.name,
        attemptId: attemptEntry.name,
        number: attemptNumber(attemptEntry.name),
      });
    }
  }
  let candidate = options.attemptId
    ? candidates.find((entry) => entry.attemptId === options.attemptId)
    : undefined;
  if (options.executionId) {
    for (const entry of candidates) {
      const candidateRecord = await readExecutionRecord(
        attemptArtifacts(repository, runId, entry.ticketId, entry.attemptId)
          .record,
      );
      if (candidateRecord.record?.executionId === options.executionId) {
        candidate = entry;
        break;
      }
    }
  }
  if (options.attemptId || options.executionId) {
    if (candidate) {
      ticketId = candidate.ticketId;
      attemptId = candidate.attemptId;
    }
  } else if (candidates.length > 0) {
    const scopedCandidates = requestedTicket
      ? candidates.filter((entry) => entry.ticketId === requestedTicket)
      : candidates;
    const candidate = scopedCandidates.sort((a, b) => b.number - a.number)[0];
    if (!candidate) {
      throw executionError(
        `Worker attempt was not found for ticket ${requestedTicket}`,
        "ATTEMPT_NOT_FOUND",
        3,
      );
    }
    ticketId = candidate.ticketId;
    attemptId = candidate.attemptId;
  }
  if (!ticketId || !attemptId)
    throw executionError(
      `Worker attempt was not found for run ${runId}`,
      "ATTEMPT_NOT_FOUND",
      3,
    );
  return {
    ticketId,
    attemptId,
    artifacts: attemptArtifacts(repository, runId, ticketId, attemptId),
  };
}

function reconciliationEvidence(
  result: WorkerReconciliationReport["evidence"]["result"],
  baselineHead?: string,
): WorkerReconciliationReport["evidence"] {
  return {
    result,
    ...(baselineHead === undefined ? {} : { baselineHead }),
  };
}

function reportFor(
  status: WorkerReconciliationReport["status"],
  run: ReadRunResult,
  ticketId: string,
  attemptId: string,
  artifacts: AttemptArtifacts,
  evidence: WorkerReconciliationReport["evidence"],
  cleanup: WorkerReconciliationReport["cleanup"],
  extras: {
    executionId?: string;
    result?: WorkerResult;
    reason?: string;
    retry?: WorkerReconciliationReport["retry"];
  } = {},
): WorkerReconciliationReport {
  const outcome =
    status === "accepted"
      ? "accepted"
      : status === "failed"
        ? "conclusive-failure"
        : "reconciliation-required";
  return {
    status,
    outcome,
    code:
      status === "accepted"
        ? "WORKER_ATTEMPT_ACCEPTED"
        : status === "failed"
          ? "WORKER_EXECUTION_FAILED"
          : "WORKER_RECONCILIATION_REQUIRED",
    exitCode: status === "accepted" ? 0 : status === "failed" ? 1 : 4,
    runId: run.snapshot.runId,
    ticketId,
    attemptId,
    ...(extras.executionId === undefined
      ? {}
      : { executionId: extras.executionId }),
    ...(extras.result === undefined ? {} : { result: extras.result }),
    ...(extras.reason === undefined ? {} : { reason: extras.reason }),
    ...(extras.retry === undefined ? {} : { retry: extras.retry }),
    evidence,
    cleanup,
    artifacts: {
      directory: artifacts.directory,
      input: artifacts.input,
      record: artifacts.record,
      output: artifacts.output,
    },
    snapshot: run.snapshot,
  };
}

async function acceptedExecutionReport(
  repository: string,
  runId: string,
  reference: NonNullable<StateSnapshot["lastExecution"]>,
  dependencies: RunDependencies,
  adapter?: HerdrAdapter,
): Promise<WorkerExecutionReport | undefined> {
  const recordRead = await readExecutionRecord(reference.path);
  if (recordRead.record?.status !== "accepted") return undefined;
  const reconciled = await reconcileWorker({
    repository,
    runId,
    ticketId: reference.ticketId,
    attemptId: reference.attemptId,
    executionId: reference.executionId,
    dependencies,
    ...(adapter === undefined ? {} : { adapter }),
  });
  if (
    reconciled.status !== "accepted" ||
    reconciled.result?.status !== "completed"
  )
    return undefined;
  return {
    status: "accepted",
    executionId: reconciled.executionId ?? reference.executionId,
    runId,
    ticketId: reconciled.ticketId,
    attemptId: reconciled.attemptId,
    result: reconciled.result,
    artifacts: reconciled.artifacts,
    previousValidatedHead:
      recordRead.record?.checkpoint?.previousValidatedHead ??
      reconciled.evidence.baselineHead ??
      reconciled.result.commit,
    acceptedCommit: reconciled.result.commit,
    snapshot: reconciled.snapshot,
  };
}

async function updateAttemptOutcome(
  repository: string,
  runId: string,
  record: ExecutionRecord | undefined,
  recordPath: string,
  ticketId: string,
  attemptId: string,
  outcome: "blocked" | "failed",
  reason: string,
  dependencies: RunDependencies,
  terminal: boolean,
): Promise<ReadRunResult> {
  if (record) {
    await writeExecution(recordPath, {
      ...record,
      status: outcome,
      timestamps: {
        ...record.timestamps,
        finalizedAt: new Date().toISOString(),
      },
    });
  }
  const current = await inspectRun(repository, runId);
  const event = terminal
    ? "fail"
    : outcome === "blocked"
      ? "block"
      : "checkpoint";
  return mutateRun(
    {
      repository,
      runId,
      event,
      preserveLifecycle: event === "checkpoint",
      historyEventType: `worker.attempt.${outcome}`,
      data: {
        ...(record === undefined ? {} : { executionId: record.executionId }),
        ticketId,
        attemptId,
        reason,
        ...(terminal ? { attemptsExhausted: true } : {}),
      },
      updateSnapshot: () => ({
        ...(record === undefined
          ? {}
          : {
              lastExecution: executionReference(
                record.executionId,
                ticketId,
                attemptId,
                recordPath,
              ),
            }),
        activeExecution: undefined,
      }),
    },
    dependencies,
  ).catch((error) => {
    if (current.snapshot.phase === "blocked" && outcome === "blocked")
      return inspectRun(repository, runId);
    throw error;
  });
}

/** Inspect and reconcile one existing Worker attempt without launching or prompting an agent. */
export async function reconcileWorker(
  options: ReconcileWorkerOptions,
): Promise<WorkerReconciliationReport> {
  const selected = await selectRun(options.repository, options.runId);
  const repository = selected.repository;
  const run = await inspectRun(repository, options.runId);
  const located = await locateAttempt(repository, options.runId, run, options);
  const { ticketId, attemptId, artifacts } = located;
  const recordRead = await readExecutionRecord(artifacts.record);
  const record = recordRead.record;
  let reconciledRecord = record;
  const baseline = run.snapshot.git?.validatedHead;
  let evidence = reconciliationEvidence("invalid", baseline);
  let result: WorkerResult | undefined;
  let reason = recordRead.error;
  let cleanup: WorkerReconciliationReport["cleanup"] = {
    status: "not-required",
  };

  const validRecord =
    record &&
    record.runId === options.runId &&
    record.ticketId === ticketId &&
    record.attemptId === attemptId &&
    record.attempt === attemptNumber(attemptId) &&
    resolve(record.artifacts.directory) === artifacts.directory &&
    resolve(record.artifacts.input) === artifacts.input &&
    resolve(record.artifacts.record) === artifacts.record &&
    resolve(record.artifacts.output) === artifacts.output &&
    record.ticket.input === artifacts.input &&
    record.ticketId === ticketId &&
    run.snapshot.git !== undefined &&
    resolve(record.worktree) === resolve(run.snapshot.git.featureWorktree) &&
    (run.snapshot.activeExecution === undefined ||
      (run.snapshot.activeExecution.executionId === record.executionId &&
        run.snapshot.activeExecution.ticketId === ticketId &&
        run.snapshot.activeExecution.attemptId === attemptId &&
        resolve(run.snapshot.activeExecution.path) === artifacts.record));
  if (!validRecord)
    reason ??= "Execution record does not match the selected attempt";

  if (validRecord) {
    try {
      await assertNoSymlinkComponents(artifacts.input);
      const input = await readFile(artifacts.input, "utf8");
      const inputHash = createHash("sha256")
        .update(input, "utf8")
        .digest("hex");
      if (inputHash !== record.ticket.hash)
        reason =
          "Ticket input snapshot hash does not match the Execution record";
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
  }

  if (validRecord && reason === undefined) {
    try {
      await assertNoSymlinkComponents(artifacts.output);
      const rawResult = await readJson(artifacts.output);
      const parsed = workerResultSchema.safeParse(rawResult);
      if (!parsed.success) {
        reason = "Worker result does not satisfy the version 1 schema";
        evidence = reconciliationEvidence("invalid", baseline);
      } else if (parsed.data.ticketId !== ticketId) {
        reason = "Worker result ticket ID does not match the selected attempt";
        evidence = reconciliationEvidence("invalid", baseline);
      } else {
        result = parsed.data;
        evidence = reconciliationEvidence(parsed.data.status, baseline);
      }
    } catch (error) {
      if (error instanceof FlowError && error.code === "RESULT_NOT_FOUND") {
        evidence = reconciliationEvidence("missing", baseline);
        reason = error.message;
      } else {
        evidence = reconciliationEvidence("invalid", baseline);
        reason = error instanceof Error ? error.message : String(error);
      }
    }
  }

  let currentHead: string | undefined;
  let clean: boolean | undefined;
  let gitFailure: string | undefined;
  if (validRecord && run.snapshot.git) {
    try {
      currentHead = await git(record.worktree, ["rev-parse", "HEAD"]);
      clean =
        (
          await git(record.worktree, [
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
          ])
        ).length === 0;
    } catch (error) {
      gitFailure = error instanceof Error ? error.message : String(error);
    }
  }
  if (validRecord && gitFailure === undefined) {
    try {
      if (
        result?.status === "completed" &&
        !(record.status === "accepted" && result.commit === baseline)
      ) {
        await inspectCheckpoint({
          repository,
          runId: options.runId,
          commit: result.commit,
        });
      } else {
        await validateWorktree({ repository, runId: options.runId });
      }
    } catch (error) {
      gitFailure = error instanceof Error ? error.message : String(error);
    }
  }
  evidence = {
    ...evidence,
    ...(currentHead === undefined ? {} : { currentHead }),
    ...(clean === undefined ? {} : { clean }),
    ...(result?.status === "completed" ? { commit: result.commit } : {}),
  };

  if (
    reconciledRecord?.herdr?.paneId &&
    reconciledRecord.cleanup?.status !== "closed"
  ) {
    const adapter = options.adapter ?? new HerdrAdapter({ maxDiagnosticBytes });
    const handle: HerdrExecutionHandle = {
      paneId: reconciledRecord.herdr.paneId,
      agentName: reconciledRecord.herdr.agentName,
      agentKind: "codex",
      cwd: reconciledRecord.worktree,
    };
    try {
      const diagnostic = await adapter.read(handle);
      const boundedDiagnostic = diagnostic.slice(-maxDiagnosticBytes);
      reconciledRecord = {
        ...reconciledRecord,
        diagnostics: {
          output: boundedDiagnostic,
          truncated: Buffer.byteLength(diagnostic, "utf8") > maxDiagnosticBytes,
        },
      };
      await writeExecution(artifacts.record, reconciledRecord);
    } catch {
      // A vanished agent is still reconciled from durable and Git evidence.
    }
    try {
      await adapter.close(handle);
      cleanup = { status: "closed", paneId: handle.paneId };
      reconciledRecord = {
        ...reconciledRecord,
        cleanup: { status: "closed" },
      };
      await writeExecution(artifacts.record, reconciledRecord);
    } catch (error) {
      cleanup = {
        status: "failed",
        paneId: handle.paneId,
        error: error instanceof Error ? error.message : String(error),
      };
      reconciledRecord = {
        ...reconciledRecord,
        cleanup: {
          status: "failed",
          error: cleanup.error ?? "Herdr pane cleanup failed",
        },
      };
      await writeExecution(artifacts.record, reconciledRecord).catch(
        () => undefined,
      );
    }
  } else if (reconciledRecord?.cleanup?.status === "closed") {
    cleanup = {
      status: "closed",
      ...(reconciledRecord.herdr?.paneId === undefined
        ? {}
        : { paneId: reconciledRecord.herdr.paneId }),
    };
  } else if (reconciledRecord?.cleanup?.status === "failed") {
    cleanup = {
      status: "failed",
      ...(reconciledRecord.herdr?.paneId === undefined
        ? {}
        : { paneId: reconciledRecord.herdr.paneId }),
      ...(reconciledRecord.cleanup.error === undefined
        ? {}
        : { error: reconciledRecord.cleanup.error }),
    };
  }

  const gitHasEffects =
    currentHead !== undefined &&
    baseline !== undefined &&
    currentHead !== baseline;
  const dirty = clean === false;
  const cleanupFailed =
    cleanup.status === "failed" ||
    reconciledRecord?.cleanup?.status === "failed";
  const invalidEvidence =
    !validRecord ||
    (reason !== undefined && evidence.result !== "missing") ||
    gitFailure !== undefined;
  const completedResult = result?.status === "completed" ? result : undefined;
  const completedMatchesGit =
    completedResult !== undefined &&
    currentHead === completedResult.commit &&
    clean === true &&
    !gitFailure;

  if (
    record?.status === "accepted" &&
    completedMatchesGit &&
    !invalidEvidence &&
    !cleanupFailed &&
    baseline === currentHead
  ) {
    return reportFor(
      "accepted",
      run,
      ticketId,
      attemptId,
      artifacts,
      evidence,
      cleanup,
      { executionId: record.executionId, result: completedResult! },
    );
  }

  if (completedMatchesGit && !invalidEvidence && !cleanupFailed) {
    try {
      const accepted = await validateCheckpoint({
        repository,
        runId: options.runId,
        commit: completedResult!.commit,
        ...(options.dependencies === undefined
          ? {}
          : { dependencies: options.dependencies }),
        finalization: {
          historyEventType: "worker.attempt.accepted",
          data: {
            executionId: reconciledRecord!.executionId,
            ticketId,
            attemptId,
          },
          updateSnapshot: () => ({
            lastExecution: executionReference(
              reconciledRecord!.executionId,
              ticketId,
              attemptId,
              artifacts.record,
            ),
            activeExecution: undefined,
          }),
        },
      });
      await writeExecution(artifacts.record, {
        ...reconciledRecord!,
        status: "accepted",
        cleanup:
          cleanup.status === "closed"
            ? { status: "closed" }
            : reconciledRecord!.cleanup,
        timestamps: {
          ...reconciledRecord!.timestamps,
          finalizedAt: new Date().toISOString(),
        },
      });
      return reportFor(
        "accepted",
        accepted.run,
        ticketId,
        attemptId,
        artifacts,
        evidence,
        cleanup,
        {
          executionId: reconciledRecord!.executionId,
          result: completedResult!,
        },
      );
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
  }

  const blocked =
    cleanupFailed ||
    invalidEvidence ||
    evidence.result === "invalid" ||
    result?.status === "blocked" ||
    (result === undefined &&
      ["blocked", "unknown", "timed-out", "disappeared"].includes(
        reconciledRecord?.herdr?.lifecycle ?? "",
      )) ||
    gitHasEffects ||
    dirty ||
    (result?.status === "completed" && !completedMatchesGit);
  const status: "blocked" | "failed" = blocked ? "blocked" : "failed";
  const currentConfig = await readOrchestrationConfig(repository);
  const terminal =
    status === "failed" &&
    attemptNumber(attemptId) >= currentConfig.config.workflow.maxWorkerAttempts;
  const finalReason =
    reason ??
    gitFailure ??
    (blocked
      ? "Worker attempt requires reconciliation"
      : "Worker execution failed without Git effects");
  const finalRun = await updateAttemptOutcome(
    repository,
    options.runId,
    reconciledRecord,
    artifacts.record,
    ticketId,
    attemptId,
    status,
    finalReason,
    options.dependencies ?? {},
    terminal,
  );
  const retryEligible =
    status === "failed" &&
    !terminal &&
    clean === true &&
    currentHead === baseline &&
    (evidence.result === "missing" || evidence.result === "failed") &&
    !cleanupFailed;
  return reportFor(
    status,
    finalRun,
    ticketId,
    attemptId,
    artifacts,
    evidence,
    cleanup,
    {
      ...(reconciledRecord?.executionId === undefined
        ? {}
        : { executionId: reconciledRecord.executionId }),
      ...(result === undefined ? {} : { result }),
      reason: finalReason,
      retry: {
        eligible: retryEligible,
        attempt: attemptNumber(attemptId),
        maxAttempts: currentConfig.config.workflow.maxWorkerAttempts,
        ...(retryEligible
          ? {}
          : { reason: terminal ? "attempt budget exhausted" : finalReason }),
      },
    },
  );
}

/** Execute one explicitly assigned ticket through a fresh skill-aware worker. */
export async function executeWorker(
  options: ExecuteWorkerOptions,
): Promise<WorkerExecutionReport> {
  const selected = await selectRun(options.repository, options.runId);
  const repository = selected.repository;
  const run = await inspectRun(repository, options.runId);
  const worktree = await assertReadyRun(repository, run, options.runId);
  const { config } = await readOrchestrationConfig(repository);
  const profile = config.agents[config.roles.worker.agent];
  if (!profile || profile.kind !== "codex")
    throw executionError(
      "Configured Worker Agent profile is not live Codex",
      "INVALID_CONFIGURATION",
      2,
    );
  const ticket =
    options.ticketSnapshot ?? (await resolveTicket(repository, options.ticket));
  if (
    !options.forceNewAttempt &&
    run.snapshot.lastExecution?.ticketId === ticket.id
  ) {
    const accepted = await acceptedExecutionReport(
      repository,
      options.runId,
      run.snapshot.lastExecution,
      options.dependencies ?? {},
      options.adapter,
    );
    if (accepted) return accepted;
  }
  if (run.snapshot.activeExecution)
    throw executionError(
      `Workflow run ${options.runId} already has an active Worker execution: ${run.snapshot.activeExecution.executionId}`,
      "EXECUTION_ALREADY_ACTIVE",
      5,
    );

  const dependencies = options.dependencies ?? {};
  const lock = await acquireRunLock(repository, options.runId, dependencies);
  let attempt!: Awaited<ReturnType<typeof nextAttempt>>;
  let execution!: ExecutionRecordData;
  let existingAcceptedReference: StateSnapshot["lastExecution"];
  try {
    const current = await inspectRun(repository, options.runId);
    if (
      !options.forceNewAttempt &&
      current.snapshot.lastExecution?.ticketId === ticket.id
    ) {
      const existing = await readExecutionRecord(
        current.snapshot.lastExecution.path,
      );
      if (existing.record?.status === "accepted")
        existingAcceptedReference = current.snapshot.lastExecution;
    }
    if (existingAcceptedReference === undefined) {
      if (current.snapshot.activeExecution)
        throw executionError(
          `Workflow run ${options.runId} already has an active Worker execution: ${current.snapshot.activeExecution.executionId}`,
          "EXECUTION_ALREADY_ACTIVE",
          5,
        );
      attempt = await nextAttempt(repository, options.runId, ticket.id);
      await atomicWrite(attempt.artifacts.input, ticket.contents, 0o600);
      execution = {
        schemaVersion: 1,
        executionId: `exec_${randomUUID()}`,
        runId: options.runId,
        ticketId: ticket.id,
        attemptId: attempt.id,
        attempt: attempt.number,
        status: "prepared",
        role: "worker",
        agentProfile: config.roles.worker.agent,
        agentKind: "codex",
        skill: config.roles.worker.skill,
        ticket: {
          source: ticket.source,
          input: attempt.artifacts.input,
          hash: ticket.hash,
        },
        worktree: resolve(worktree),
        artifacts: {
          directory: attempt.artifacts.directory,
          input: attempt.artifacts.input,
          record: attempt.artifacts.record,
          output: attempt.artifacts.output,
        },
        promptHash: "0".repeat(64),
        ...(options.retryLineage === undefined
          ? {}
          : {
              retry: {
                ...options.retryLineage,
                inputHash: ticket.hash,
              },
            }),
        promptDelivery: "not-started" as const,
        timestamps: { preparedAt: new Date().toISOString() },
      };
      await writeExecution(attempt.artifacts.record, execution);
      await mutateRun(
        {
          repository,
          runId: options.runId,
          event: "checkpoint",
          preserveLifecycle: true,
          historyEventType: "worker.attempt.prepared",
          data: {
            executionId: execution.executionId,
            ticketId: ticket.id,
            attemptId: attempt.id,
            inputHash: ticket.hash,
          },
          updateSnapshot: () => ({
            activeExecution: executionReference(
              execution.executionId,
              ticket.id,
              attempt.id,
              attempt.artifacts.record,
            ),
          }),
          lock,
        },
        dependencies,
      );
    }
  } finally {
    await releaseRunLock(lock);
  }

  if (existingAcceptedReference !== undefined) {
    const accepted = await acceptedExecutionReport(
      repository,
      options.runId,
      existingAcceptedReference,
      dependencies,
      options.adapter,
    );
    if (accepted) return accepted;
    throw executionError(
      "Previously accepted Worker execution could not be revalidated",
      "UNTRUSTED_ARTIFACT",
      4,
    );
  }

  const callerPaneId =
    process.env.HERDR_PANE_ID ?? process.env.HERDR_ACTIVE_PANE_ID;
  if (!callerPaneId)
    throw executionError(
      "Worker execution requires a genuine Herdr-managed caller pane (HERDR_PANE_ID)",
      "HERDR_CONTEXT_REQUIRED",
      3,
    );
  const agentName = normalizeAgentName(
    `${options.runId}-${ticket.id}-${attempt!.id}`,
  );
  const adapter = options.adapter ?? new HerdrAdapter({ maxDiagnosticBytes });
  let handle: HerdrExecutionHandle | undefined;
  try {
    const version = await adapter.version();
    execution = {
      ...execution!,
      status: "running",
      promptDelivery: "unknown",
      timestamps: {
        ...execution!.timestamps,
        startedAt: new Date().toISOString(),
      },
      herdr: { callerPaneId, agentName, version },
    };
    await writeExecution(attempt!.artifacts.record, execution);
    await mutateExecutionState(
      repository,
      options.runId,
      "worker.attempt.started",
      {
        executionId: execution.executionId,
        ticketId: ticket.id,
        attemptId: attempt.id,
      },
      (snapshot) => ({ activeExecution: snapshot.activeExecution }),
      dependencies,
    );
    const launched = await launchSkillAwareWorker({
      role: "worker",
      agentProfile: config.roles.worker.agent,
      agentKind: "codex",
      skill: config.roles.worker.skill,
      input: attempt!.artifacts.input,
      runId: options.runId,
      ticketId: ticket.id,
      worktree: resolve(worktree),
      resultPath: attempt!.artifacts.output,
      commitRequired: true,
      callerPaneId,
      agentName,
      adapter,
      outputDirectory: attempt!.artifacts.outputDirectory,
      settlementTimeoutMs: config.workflow.workerTimeoutSeconds * 1000,
    });
    handle = launched.handle;
    execution = {
      ...execution!,
      status: "reconciling",
      promptDelivery: "confirmed",
      promptHash: launched.rendered.promptHash,
      timestamps: {
        ...execution!.timestamps,
        settledAt: new Date().toISOString(),
      },
      herdr: {
        callerPaneId,
        paneId: launched.handle.paneId,
        agentName,
        version,
        ...(launched.startupState === undefined
          ? {}
          : { lifecycle: launched.startupState }),
      },
    };
    await writeExecution(attempt!.artifacts.record, execution);
    const diagnostic = await adapter.read(launched.handle);
    execution = {
      ...execution,
      diagnostics: {
        output: diagnostic.slice(-maxDiagnosticBytes),
        truncated: Buffer.byteLength(diagnostic, "utf8") > maxDiagnosticBytes,
      },
    };
    await writeExecution(attempt!.artifacts.record, execution);
    const workerResult = parseCompletedResult(
      await readJson(attempt!.artifacts.output),
      ticket.id,
    );
    const currentHead = await git(worktree, ["rev-parse", "HEAD"]);
    if (workerResult.commit !== currentHead)
      throw executionError(
        "Worker result commit does not match the current Feature worktree HEAD",
        "CHECKPOINT_COMMIT_MISMATCH",
        4,
        { reported: workerResult.commit, currentHead },
      );
    const dirty = await git(worktree, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
    if (dirty.length > 0)
      throw executionError(
        "Feature worktree is not clean after Worker execution",
        "DIRTY_WORKTREE",
        4,
        {
          status: dirty,
        },
      );
    await inspectCheckpoint({
      repository,
      runId: options.runId,
      commit: workerResult.commit,
    });
    await adapter.close(launched.handle);
    execution.cleanup = { status: "closed" };
    await writeExecution(attempt!.artifacts.record, execution);

    const accepted = await validateCheckpoint({
      repository,
      runId: options.runId,
      commit: workerResult.commit,
      dependencies,
      finalization: {
        historyEventType: "worker.attempt.accepted",
        data: {
          executionId: execution.executionId,
          ticketId: ticket.id,
          attemptId: attempt.id,
        },
        updateSnapshot: () => ({
          lastExecution: executionReference(
            execution.executionId,
            ticket.id,
            attempt.id,
            attempt.artifacts.record,
          ),
          activeExecution: undefined,
        }),
      },
    });
    execution = {
      ...execution,
      status: "accepted",
      checkpoint: {
        previousValidatedHead: accepted.previousValidatedHead,
        acceptedCommit: accepted.acceptedCommit,
      },
      timestamps: {
        ...execution.timestamps,
        finalizedAt: new Date().toISOString(),
      },
    };
    await writeExecution(attempt.artifacts.record, execution);
    return {
      status: "accepted",
      executionId: execution.executionId,
      runId: options.runId,
      ticketId: ticket.id,
      attemptId: attempt.id,
      result: workerResult,
      artifacts: execution.artifacts,
      previousValidatedHead: accepted.previousValidatedHead,
      acceptedCommit: accepted.acceptedCommit,
      snapshot: accepted.snapshot,
    };
  } catch (error) {
    if (handle && !execution!.cleanup) {
      try {
        await adapter.close(handle);
        execution!.cleanup = { status: "closed" };
      } catch (cleanupError) {
        execution!.cleanup = {
          status: "failed",
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        };
      }
    }
    const maxAttempts = (await readOrchestrationConfig(repository)).config
      .workflow.maxWorkerAttempts;
    const automaticRetry =
      options.automaticRetry !== false &&
      attempt!.number < maxAttempts &&
      execution!.promptDelivery !== "confirmed" &&
      !promptWasAttempted(error) &&
      execution!.cleanup?.status !== "failed" &&
      (await hasNoWorkerEffects(
        execution!.worktree,
        (await inspectRun(repository, options.runId)).snapshot.git
          ?.validatedHead,
        attempt!.artifacts.output,
      ));
    await recordFailure(
      repository,
      options.runId,
      attempt!.artifacts.record,
      execution!,
      error,
      dependencies,
    );
    if (automaticRetry) {
      return executeWorker({
        repository,
        runId: options.runId,
        ticket: ticket.source,
        ticketSnapshot: ticket,
        forceNewAttempt: true,
        automaticRetry: false,
        retryLineage: {
          previousAttemptId: attempt!.id,
          previousExecutionId: execution!.executionId,
          previousInputHash: ticket.hash,
          refreshed: false,
        },
        dependencies,
        ...(options.adapter === undefined ? {} : { adapter: options.adapter }),
      });
    }
    throw error;
  }
}

/** Reconcile the prior attempt and explicitly create one fresh retry attempt. */
export async function retryWorker(
  options: RetryWorkerOptions,
): Promise<WorkerExecutionReport> {
  const selected = await selectRun(options.repository, options.runId);
  const repository = selected.repository;
  const run = await inspectRun(repository, options.runId);
  let ticketId: string | undefined;
  if (options.ticket !== undefined) {
    ticketId = (await resolveTicket(repository, options.ticket)).id;
  }
  const located = await locateAttempt(repository, options.runId, run, {
    runId: options.runId,
    ...(ticketId === undefined ? {} : { ticketId }),
    ...(options.attemptId === undefined
      ? {}
      : { attemptId: options.attemptId }),
    ...(options.executionId === undefined
      ? {}
      : { executionId: options.executionId }),
  });
  const priorRead = await readExecutionRecord(located.artifacts.record);
  const prior = priorRead.record;
  if (!prior)
    throw executionError(
      priorRead.error ?? "Prior Worker execution record is unavailable",
      "RETRY_REQUIRES_RECONCILIATION",
      4,
    );

  const maxAttempts = (await readOrchestrationConfig(repository)).config
    .workflow.maxWorkerAttempts;
  if (run.snapshot.phase !== "implementing") {
    if (attemptNumber(located.attemptId) >= maxAttempts) {
      throw executionError(
        `Worker attempt budget exhausted (${attemptNumber(located.attemptId)}/${maxAttempts})`,
        "ATTEMPT_BUDGET_EXHAUSTED",
        4,
        { attempt: attemptNumber(located.attemptId), maxAttempts },
      );
    }
    throw executionError(
      `Workflow run ${options.runId} is not ready for Worker retry (${run.snapshot.phase}). Resume a blocked run after resolving its evidence first.`,
      "RUN_NOT_EXECUTABLE",
      4,
      { phase: run.snapshot.phase },
    );
  }

  const reconciled = await reconcileWorker({
    repository,
    runId: options.runId,
    ticketId: located.ticketId,
    attemptId: located.attemptId,
    executionId: prior.executionId,
    ...(options.dependencies === undefined
      ? {}
      : { dependencies: options.dependencies }),
    ...(options.adapter === undefined ? {} : { adapter: options.adapter }),
  });
  if (
    reconciled.status === "accepted" &&
    reconciled.result?.status === "completed"
  ) {
    return {
      status: "accepted",
      executionId: reconciled.executionId ?? prior.executionId,
      runId: options.runId,
      ticketId: located.ticketId,
      attemptId: located.attemptId,
      result: reconciled.result,
      artifacts: reconciled.artifacts,
      previousValidatedHead:
        reconciled.evidence.baselineHead ?? reconciled.result.commit,
      acceptedCommit: reconciled.result.commit,
      snapshot: reconciled.snapshot,
    };
  }

  const number = attemptNumber(located.attemptId);
  if (number >= maxAttempts) {
    throw executionError(
      `Worker attempt budget exhausted (${number}/${maxAttempts})`,
      "ATTEMPT_BUDGET_EXHAUSTED",
      4,
      { attempt: number, maxAttempts },
    );
  }
  const safeToRetry =
    reconciled.status === "failed" &&
    reconciled.evidence.clean === true &&
    reconciled.evidence.currentHead === reconciled.evidence.baselineHead &&
    (reconciled.evidence.result === "missing" ||
      reconciled.evidence.result === "failed") &&
    reconciled.cleanup.status !== "failed";
  if (!safeToRetry) {
    throw executionError(
      "Worker retry is unsafe until reconciliation proves that no side effects remain",
      "RETRY_REQUIRES_RECONCILIATION",
      4,
      {
        attempt: number,
        evidence: reconciled.evidence,
        cleanup: reconciled.cleanup,
      },
    );
  }

  let snapshot: TicketInput;
  let refreshed = false;
  if (options.refreshTicket !== undefined) {
    const current = await resolveTicket(repository, options.refreshTicket);
    if (current.id !== prior.ticketId)
      throw executionError(
        "Refreshed ticket must retain the prior canonical ticket ID",
        "TICKET_REFRESH_MISMATCH",
        2,
        { previousTicketId: prior.ticketId, refreshedTicketId: current.id },
      );
    snapshot = current;
    refreshed = true;
  } else {
    await assertNoSymlinkComponents(prior.ticket.input);
    const contents = await readFile(prior.ticket.input, "utf8");
    snapshot = {
      id: prior.ticketId,
      source: prior.ticket.source,
      contents,
      hash: createHash("sha256").update(contents, "utf8").digest("hex"),
    };
    if (snapshot.hash !== prior.ticket.hash)
      throw executionError(
        "Prior ticket input snapshot changed; explicit reconciliation is required",
        "UNTRUSTED_ARTIFACT",
        4,
      );
  }

  return executeWorker({
    repository,
    runId: options.runId,
    ticket: snapshot.source,
    ticketSnapshot: snapshot,
    forceNewAttempt: true,
    retryLineage: {
      previousAttemptId: prior.attemptId,
      previousExecutionId: prior.executionId,
      previousInputHash: prior.ticket.hash,
      refreshed,
    },
    ...(options.dependencies === undefined
      ? {}
      : { dependencies: options.dependencies }),
    ...(options.adapter === undefined ? {} : { adapter: options.adapter }),
  });
}
