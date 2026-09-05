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
  status: "prepared" | "running" | "reconciling" | "accepted" | "failed";
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
  record: ExecutionRecordData,
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
  const ticket = await resolveTicket(repository, options.ticket);
  if (run.snapshot.activeExecution)
    throw executionError(
      `Workflow run ${options.runId} already has an active Worker execution: ${run.snapshot.activeExecution.executionId}`,
      "EXECUTION_ALREADY_ACTIVE",
      5,
    );

  const dependencies = options.dependencies ?? {};
  const lock = await acquireRunLock(repository, options.runId, dependencies);
  let attempt: Awaited<ReturnType<typeof nextAttempt>>;
  let execution: ExecutionRecordData;
  try {
    const current = await inspectRun(repository, options.runId);
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
  } finally {
    await releaseRunLock(lock);
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
    await recordFailure(
      repository,
      options.runId,
      attempt!.artifacts.record,
      execution!,
      error,
      dependencies,
    );
    throw error;
  }
}
