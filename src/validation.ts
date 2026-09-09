import { execFile, spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { validateWorktree } from "./git-worktree.js";
import { readOrchestrationConfig } from "./setup.js";
import {
  validationResultSchema,
  type OrchestrationConfig,
  type StateSnapshot,
  type ValidationCheckOutcome,
  type ValidationCheckStatus,
  type ValidationResult,
  type ValidationStatus,
} from "./schema.js";
import {
  assertWorkflowPackageUnchanged,
  validatePackage,
} from "./workflow-step.js";
import {
  acquireRunLock,
  FlowError,
  inspectRun,
  mutateRun,
  releaseRunLock,
  writeSynchronizedFile,
  type RunDependencies,
} from "./workflow-run.js";

const run = promisify(execFile);

const resultFileName = "validation.json";
const maxDiagnosticCharacters = 20_000;

interface QueueEntry {
  [key: string]: unknown;
  status: "pending" | "active" | "accepted";
  input: string;
  commit?: string;
}

interface WorkflowSnapshot extends StateSnapshot {
  workflowPackage?: {
    source: string;
    snapshot: string;
    specification: string;
  };
  tickets?: Record<string, QueueEntry>;
}

export interface ValidateRunOptions {
  package: string;
  repository?: string;
  dependencies?: RunDependencies;
}

export type ValidationReport = ValidationResult & {
  repository: string;
  result: string;
};

interface CommandOutcome {
  status: ValidationCheckStatus;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
}

function workflowState(snapshot: StateSnapshot): WorkflowSnapshot {
  return snapshot as WorkflowSnapshot;
}

function validationFailure(
  message: string,
  code: string,
  exitCode: number,
  details?: Record<string, unknown>,
): FlowError {
  return new FlowError(message, exitCode, code, details);
}

async function findMatchingRuns(
  repository: string,
  source: string,
): Promise<WorkflowSnapshot[]> {
  const runsPath = join(repository, ".orchestrator", "runs");
  let entries;
  try {
    entries = await readdir(runsPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const matches: WorkflowSnapshot[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const state = await inspectRun(repository, entry.name)
      .then((found) => workflowState(found.snapshot))
      .catch(() => undefined);
    if (state?.workflowPackage?.source === source) matches.push(state);
  }
  return matches;
}

function assertCompletedQueue(state: WorkflowSnapshot): {
  validatedHead: string;
  featureWorktree: string;
} {
  const tickets = state.tickets;
  if (!tickets || Object.keys(tickets).length === 0)
    throw validationFailure(
      `Workflow run ${state.runId} has no durable Ticket queue`,
      "CORRUPT_RUN",
      4,
    );
  const entries = Object.entries(tickets);
  const unaccepted = entries
    .filter(([, ticket]) => ticket.status !== "accepted")
    .map(([id]) => id);
  if (unaccepted.length > 0)
    throw validationFailure(
      `Workflow run ${state.runId} has not accepted every ticket in its queue: ${unaccepted.join(", ")}`,
      "WORKFLOW_INCOMPLETE",
      4,
      { runId: state.runId, unacceptedTickets: unaccepted },
    );
  const gitState = state.git;
  if (
    !gitState ||
    gitState.worktreeStatus !== "ready" ||
    !gitState.validatedHead
  )
    throw validationFailure(
      `Workflow run ${state.runId} does not have a ready Feature worktree`,
      "WORKTREE_NOT_READY",
      4,
      { runId: state.runId },
    );
  const lastAcceptedCommit = entries.at(-1)?.[1].commit;
  if (!lastAcceptedCommit || lastAcceptedCommit !== gitState.validatedHead)
    throw validationFailure(
      `Workflow run ${state.runId} validated HEAD does not match the final accepted Git checkpoint`,
      "CHECKPOINT_MISMATCH",
      4,
      {
        runId: state.runId,
        validatedHead: gitState.validatedHead,
        lastAcceptedCommit: lastAcceptedCommit ?? null,
      },
    );
  return {
    validatedHead: gitState.validatedHead,
    featureWorktree: gitState.featureWorktree,
  };
}

function boundedDiagnostics(value: string): string | undefined {
  if (value.length === 0) return undefined;
  if (value.length <= maxDiagnosticCharacters) return value;
  return `${value.slice(0, maxDiagnosticCharacters)}\n[truncated]`;
}

function executeValidationCommand(
  command: string,
  cwd: string,
  timeoutSeconds: number,
): Promise<CommandOutcome> {
  return new Promise((settle) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(command, {
      shell: true,
      cwd,
      env: process.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid === undefined) return;
      try {
        // Validation commands may spawn their own processes. Kill the owned
        // process group so descendants cannot outlive the configured timeout.
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }, timeoutSeconds * 1_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      settle({
        status: "failed",
        exitCode: null,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr: `${stderr}${error.message}\n`,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      settle({
        status: timedOut ? "timed_out" : code === 0 ? "passed" : "failed",
        exitCode: timedOut ? null : code,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });
  });
}

async function gitOutput(
  cwd: string,
  args: string[],
): Promise<string | undefined> {
  try {
    const { stdout } = await run("git", args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

function readValidationCommands(config: OrchestrationConfig): {
  test: string;
  lint: string;
  typecheck: string;
  formatCheck: string;
  build: string;
  timeoutSeconds: number;
} {
  const validation = config.workflow.validation;
  if (validation === undefined)
    throw validationFailure(
      "Orchestration configuration does not define workflow.validation; add the test, lint, typecheck, formatCheck, and build commands with one timeoutSeconds to .orchestrator/config.yaml",
      "VALIDATION_NOT_CONFIGURED",
      2,
    );
  return {
    test: validation.test,
    lint: validation.lint,
    typecheck: validation.typecheck,
    formatCheck: validation.formatCheck,
    build: validation.build,
    timeoutSeconds: validation.timeoutSeconds,
  };
}

/**
 * Resolve the completed Workflow run owning a Workflow package, execute its
 * configured validation commands in the Feature worktree, and durably record
 * whether that exact HEAD passed every check.
 */
export async function validateWorkflowRun(
  options: ValidateRunOptions,
): Promise<ValidationReport> {
  const clock = options.dependencies?.clock ?? (() => new Date());
  const { repository, config } = await readOrchestrationConfig(
    options.repository,
  );
  const validationConfig = readValidationCommands(config);
  const packageData = await validatePackage(repository, options.package);
  const matchingRuns = await findMatchingRuns(repository, packageData.source);
  if (matchingRuns.length === 0)
    throw validationFailure(
      `No Workflow run matches this Workflow package: ${packageData.source}`,
      "RUN_NOT_FOUND",
      3,
      { package: packageData.source },
    );
  if (matchingRuns.length > 1)
    throw validationFailure(
      `Multiple Workflow runs match this Workflow package: ${matchingRuns
        .map((state) => state.runId)
        .join(
          ", ",
        )}. Validation refuses to guess which implementation to validate.`,
      "AMBIGUOUS_WORKFLOW_RUN",
      3,
      { runIds: matchingRuns.map((state) => state.runId) },
    );
  const completedRuns = matchingRuns.filter(
    (state) => state.phase === "completed",
  );
  if (completedRuns.length === 0)
    throw validationFailure(
      `Workflow run ${matchingRuns[0]?.runId} has not completed its Ticket queue (phase: ${matchingRuns[0]?.phase})`,
      "WORKFLOW_NOT_COMPLETED",
      4,
      {
        runIds: matchingRuns.map((state) => state.runId),
        phases: matchingRuns.map((state) => state.phase),
      },
    );
  const selectedRun = completedRuns[0];
  if (!selectedRun)
    throw validationFailure(
      "Run selection unexpectedly produced no candidate",
      "INTERNAL_ERROR",
      4,
    );
  const runId = selectedRun.runId;

  const lock = await acquireRunLock(repository, runId, options.dependencies);
  try {
    const current = await inspectRun(repository, runId);
    if (!current.audit.synchronized)
      throw validationFailure(
        `Workflow run ${runId} has an unresolved history audit gap`,
        "AUDIT_GAP",
        4,
        { runId, warning: current.audit.warning },
      );
    const state = workflowState(current.snapshot);
    if (state.phase !== "completed")
      throw validationFailure(
        `Workflow run ${runId} has not completed implementation (phase: ${state.phase})`,
        "WORKFLOW_NOT_COMPLETED",
        4,
        { runId, phase: state.phase },
      );
    await assertWorkflowPackageUnchanged(state, packageData);
    const { validatedHead, featureWorktree } = assertCompletedQueue(state);

    // Precondition Git gate: available registered worktree, Orchestrator-owned
    // branch, clean baseline, and HEAD equal to the final accepted checkpoint.
    await validateWorktree({ repository, runId });

    const startedAt = clock().toISOString();
    const outcomes: ValidationCheckOutcome[] = [];
    const checkCommands = [
      { name: "test", command: validationConfig.test },
      { name: "lint", command: validationConfig.lint },
      { name: "typecheck", command: validationConfig.typecheck },
      { name: "formatCheck", command: validationConfig.formatCheck },
      { name: "build", command: validationConfig.build },
    ] as const;
    for (const { name, command } of checkCommands) {
      const outcome = await executeValidationCommand(
        command,
        featureWorktree,
        validationConfig.timeoutSeconds,
      );
      const stdout = boundedDiagnostics(outcome.stdout);
      const stderr = boundedDiagnostics(outcome.stderr);
      outcomes.push({
        name,
        command,
        status: outcome.status,
        exitCode: outcome.exitCode,
        durationMs: outcome.durationMs,
        ...(stdout === undefined ? {} : { stdout }),
        ...(stderr === undefined ? {} : { stderr }),
      });
    }

    // Post-command Git gate: a command-created commit or non-ignored change
    // fails validation. The Orchestrator never resets or deletes the mutation.
    const headAfterValidation = await gitOutput(featureWorktree, [
      "rev-parse",
      "HEAD",
    ]);
    const statusAfterValidation = await gitOutput(featureWorktree, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
    const cleanAfterValidation =
      (statusAfterValidation ?? "dirty").length === 0;
    const gitReasons: string[] = [];
    if (headAfterValidation !== validatedHead)
      gitReasons.push(
        headAfterValidation === undefined
          ? "Feature worktree HEAD could not be resolved after validation"
          : "Feature worktree HEAD changed during validation",
      );
    if (!cleanAfterValidation)
      gitReasons.push(
        "Feature worktree is not clean after validation; validation commands changed project files",
      );
    const status: ValidationStatus =
      outcomes.every((outcome) => outcome.status === "passed") &&
      gitReasons.length === 0
        ? "passed"
        : "failed";
    const finishedAt = clock().toISOString();
    const result: ValidationResult = validationResultSchema.parse({
      schemaVersion: 1,
      runId,
      validatedHead,
      status,
      startedAt,
      finishedAt,
      checks: outcomes,
      git: {
        ...(headAfterValidation === undefined ? {} : { headAfterValidation }),
        cleanAfterValidation,
        ...(gitReasons.length === 0 ? {} : { reason: gitReasons.join("; ") }),
      },
    });

    // Publish the complete result before any state references it.
    const resultPath = join(
      repository,
      ".orchestrator",
      "runs",
      runId,
      resultFileName,
    );
    await writeSynchronizedFile(
      resultPath,
      `${JSON.stringify(result, null, 2)}\n`,
    );
    await mutateRun(
      {
        repository,
        runId,
        event: "checkpoint",
        preserveLifecycle: true,
        historyEventType: "workflow.validation.completed",
        data: {
          status,
          validatedHead,
          result: resultFileName,
          checks: outcomes.map((outcome) => ({
            name: outcome.name,
            status: outcome.status,
            exitCode: outcome.exitCode,
            durationMs: outcome.durationMs,
          })),
        },
        updateSnapshot: () => ({
          validation: {
            status,
            validatedHead,
            result: resultFileName,
            at: finishedAt,
          },
        }),
        lock,
      },
      options.dependencies,
    );
    return {
      ...result,
      runId,
      repository,
      result: resultPath,
    };
  } finally {
    await releaseRunLock(lock);
  }
}
