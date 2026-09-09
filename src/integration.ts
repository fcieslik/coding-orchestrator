import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  deliveryResultSchema,
  gitStateSchema,
  validationResultSchema,
  type DeliveryResult,
  type StateSnapshot,
} from "./schema.js";
import { validateWorktree } from "./git-worktree.js";
import {
  assertWorkflowPackageUnchanged,
  validatePackage,
  type ValidatedPackage,
} from "./workflow-step.js";
import {
  acquireRunLock,
  FlowError,
  inspectRun,
  mutateRun,
  releaseRunLock,
  type ReadRunResult,
  type RunDependencies,
  type RunLock,
} from "./workflow-run.js";
import { validateWorkflowRun } from "./validation.js";
import { readOrchestrationConfig } from "./setup.js";

const run = promisify(execFile);
const validationFileName = "validation.json";

interface WorkflowSnapshot extends StateSnapshot {
  workflowPackage?: {
    source: string;
    snapshot: string;
    specification: string;
  };
  tickets?: Record<
    string,
    {
      status: "pending" | "active" | "accepted";
      input: string;
      commit?: string;
    }
  >;
}

export type IntegrationGitRunner = (
  repository: string,
  args: string[],
  missingCode?: string,
) => Promise<string>;

export interface IntegrateRunOptions {
  package: string;
  repository?: string;
  dependencies?: IntegrationDependencies;
}

export interface IntegrationDependencies extends RunDependencies {
  /** Test seam for the single permitted fast-forward mutation. */
  gitRunner?: IntegrationGitRunner;
}

export interface LocalIntegrationReport {
  status: DeliveryResult["status"];
  runId: string;
  channel: "local";
  implementationComplete: boolean;
  v1Complete: boolean;
  validatedHead: string;
  integrationTargetBranch: string;
  delivery: DeliveryResult;
  snapshot: StateSnapshot;
}

function workflowState(snapshot: StateSnapshot): WorkflowSnapshot {
  return snapshot as WorkflowSnapshot;
}

function refusal(
  message: string,
  code = "DELIVERY_PREFLIGHT_REFUSED",
  details?: Record<string, unknown>,
): FlowError {
  return new FlowError(message, 4, code, details);
}

async function gitOutput(
  repository: string,
  args: string[],
  missingCode = "GIT_RESOURCE_NOT_FOUND",
): Promise<string> {
  try {
    const result = await run("git", args, {
      cwd: repository,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return result.stdout.trim();
  } catch (error) {
    const details = error && typeof error === "object" ? error : undefined;
    const stderr =
      details && "stderr" in details && typeof details.stderr === "string"
        ? details.stderr.trim()
        : "Git command failed";
    throw new FlowError(stderr || "Git command failed", 3, missingCode, {
      repository,
      command: ["git", ...args],
    });
  }
}

async function canonicalCommit(
  repository: string,
  revision: string,
): Promise<string> {
  return gitOutput(repository, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${revision}^{commit}`,
  ]);
}

async function currentBranch(repository: string): Promise<string> {
  try {
    return await gitOutput(repository, [
      "symbolic-ref",
      "--quiet",
      "--short",
      "HEAD",
    ]);
  } catch {
    throw refusal(
      "Local integration requires the primary checkout to have a named Integration target branch",
      "INTEGRATION_TARGET_BRANCH_MISSING",
    );
  }
}

async function cleanCheckout(repository: string): Promise<void> {
  const status = await gitOutput(repository, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (status.length > 0)
    throw refusal(
      "Primary checkout is not clean; local integration made no mutation",
      "DIRTY_TARGET_CHECKOUT",
      {
        status: status.split(/\r?\n/),
      },
    );
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

async function selectCompletedRun(
  repository: string,
  packageData: ValidatedPackage,
): Promise<WorkflowSnapshot> {
  const matchingRuns = await findMatchingRuns(repository, packageData.source);
  if (matchingRuns.length === 0)
    throw new FlowError(
      `No Workflow run matches this Workflow package: ${packageData.source}`,
      3,
      "RUN_NOT_FOUND",
      { package: packageData.source },
    );
  if (matchingRuns.length > 1)
    throw new FlowError(
      `Multiple Workflow runs match this Workflow package: ${matchingRuns.map((state) => state.runId).join(", ")}. Integration refuses to guess which implementation to deliver.`,
      3,
      "AMBIGUOUS_WORKFLOW_RUN",
      { runIds: matchingRuns.map((state) => state.runId) },
    );
  const selected = matchingRuns[0];
  if (!selected)
    throw new Error("Run selection unexpectedly produced no candidate");
  if (selected.phase !== "completed")
    throw refusal(
      `Workflow run ${selected.runId} has not completed its Ticket queue (phase: ${selected.phase})`,
      "WORKFLOW_NOT_COMPLETED",
      { runId: selected.runId, phase: selected.phase },
    );
  return selected;
}

async function readPassingValidation(
  repository: string,
  state: WorkflowSnapshot,
): Promise<boolean> {
  const gitState = gitStateSchema.safeParse(state.git);
  const validation = state.validation;
  if (
    !gitState.success ||
    !gitState.data.validatedHead ||
    !validation ||
    validation.status !== "passed" ||
    validation.validatedHead !== gitState.data.validatedHead ||
    validation.result !== validationFileName
  )
    return false;
  try {
    const contents = await readFile(
      join(
        repository,
        ".orchestrator",
        "runs",
        state.runId,
        validationFileName,
      ),
      "utf8",
    );
    const parsed = validationResultSchema.parse(JSON.parse(contents));
    return (
      parsed.runId === state.runId &&
      parsed.status === "passed" &&
      parsed.validatedHead === gitState.data.validatedHead &&
      parsed.git?.headAfterValidation === gitState.data.validatedHead &&
      parsed.git.cleanAfterValidation === true
    );
  } catch {
    return false;
  }
}

async function ensurePassingValidation(
  repository: string,
  packageData: ValidatedPackage,
  state: WorkflowSnapshot,
  lock: RunLock,
  dependencies: IntegrationDependencies,
): Promise<WorkflowSnapshot> {
  if (await readPassingValidation(repository, state)) return state;
  const report = await validateWorkflowRun({
    package: packageData.source,
    repository,
    dependencies,
    lock,
  });
  if (report.status !== "passed")
    throw new FlowError(
      `Workflow validation failed for ${report.validatedHead}; local integration did not mutate Git`,
      1,
      "VALIDATION_FAILED",
      {
        runId: report.runId,
        validatedHead: report.validatedHead,
        checks: report.checks,
      },
    );
  return workflowState((await inspectRun(repository, state.runId)).snapshot);
}

async function reconcileHistory(
  repository: string,
  current: ReadRunResult,
  lock: RunLock,
  dependencies: IntegrationDependencies,
): Promise<ReadRunResult> {
  const delivery = current.snapshot.delivery;
  if (current.audit.synchronized || delivery === undefined) return current;
  const eventType = `workflow.delivery.${delivery.status}`;
  return mutateRun(
    {
      repository,
      runId: current.snapshot.runId,
      event: "checkpoint",
      historyOnly: true,
      historyEventType: eventType,
      data: { delivery },
      lock,
    },
    dependencies,
  );
}

async function targetFacts(repository: string): Promise<{
  branch: string;
  head: string;
  clean: boolean;
}> {
  const branch = await currentBranch(repository);
  const head = await canonicalCommit(repository, "HEAD");
  const status = await gitOutput(repository, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  return { branch, head, clean: status.length === 0 };
}

async function assertFeatureFacts(
  repository: string,
  state: WorkflowSnapshot,
  validatedHead: string,
): Promise<void> {
  const gitState = gitStateSchema.safeParse(state.git);
  if (!gitState.success || gitState.data.worktreeStatus !== "ready")
    throw refusal(
      "Workflow run does not have a ready Feature worktree",
      "WORKTREE_NOT_READY",
    );
  if (gitState.data.validatedHead !== validatedHead)
    throw refusal(
      "Validation does not match the current Feature checkpoint",
      "STALE_VALIDATION",
    );
  await validateWorktree({ repository, runId: state.runId });
  try {
    await gitOutput(repository, [
      "merge-base",
      "--is-ancestor",
      gitState.data.runBase,
      validatedHead,
    ]);
  } catch {
    throw refusal(
      "Validated Feature HEAD does not descend from the immutable Run base",
      "DIVERGENT_FEATURE_HISTORY",
    );
  }
}

function deliveryRecord(
  state: WorkflowSnapshot,
  status: DeliveryResult["status"],
  validatedHead: string,
  integrationTargetBranch: string,
  clock: () => Date,
  extra: Partial<DeliveryResult> = {},
): DeliveryResult {
  return deliveryResultSchema.parse({
    schemaVersion: 1,
    channel: "local",
    status,
    validatedHead,
    integrationTargetBranch,
    at: clock().toISOString(),
    ...extra,
  });
}

async function publishDelivery(
  repository: string,
  state: WorkflowSnapshot,
  lock: RunLock,
  delivery: DeliveryResult,
  historyEventType: string,
  dependencies: IntegrationDependencies,
): Promise<WorkflowSnapshot> {
  const updated = await mutateRun(
    {
      repository,
      runId: state.runId,
      event: "checkpoint",
      preserveLifecycle: true,
      historyEventType,
      data: { delivery },
      updateSnapshot: () => ({ delivery }),
      lock,
    },
    dependencies,
  );
  return workflowState(updated.snapshot);
}

function reportFrom(state: WorkflowSnapshot): LocalIntegrationReport {
  if (!state.delivery)
    throw new Error(
      "Local integration report requires a persisted Delivery result",
    );
  return {
    status: state.delivery.status,
    runId: state.runId,
    channel: "local",
    implementationComplete: state.phase === "completed",
    v1Complete:
      state.phase === "completed" && state.delivery.status === "completed",
    validatedHead: state.delivery.validatedHead,
    integrationTargetBranch: state.delivery.integrationTargetBranch,
    delivery: state.delivery,
    snapshot: state,
  };
}

/** Validate and safely fast-forward the saved local Integration target branch. */
export async function integrateWorkflowRun(
  options: IntegrateRunOptions,
): Promise<LocalIntegrationReport> {
  const dependencies = options.dependencies ?? {};
  const { repository } = await readOrchestrationConfig(options.repository);
  const packageData = await validatePackage(repository, options.package);
  const selected = await selectCompletedRun(repository, packageData);
  const lock = await acquireRunLock(repository, selected.runId, dependencies);
  try {
    let current = await reconcileHistory(
      repository,
      await inspectRun(repository, selected.runId),
      lock,
      dependencies,
    );
    let state = workflowState(current.snapshot);
    const existing = state.delivery;
    if (existing && existing.channel !== "local")
      throw new FlowError(
        `Workflow run ${state.runId} already selected the ${existing.channel} Delivery channel`,
        4,
        "DELIVERY_CHANNEL_CONFLICT",
        { requestedChannel: "local", existingChannel: existing.channel },
      );
    if (existing?.status === "completed") return reportFrom(state);

    state = await ensurePassingValidation(
      repository,
      packageData,
      state,
      lock,
      dependencies,
    );
    current = await inspectRun(repository, state.runId);
    state = workflowState(current.snapshot);
    await assertWorkflowPackageUnchanged(state, packageData);

    const gitState = gitStateSchema.safeParse(state.git);
    if (!gitState.success || gitState.data.worktreeStatus !== "ready")
      throw refusal(
        "Workflow run does not have a ready Feature worktree",
        "WORKTREE_NOT_READY",
      );
    const validatedHead = gitState.data.validatedHead;
    const integrationTargetBranch = gitState.data.integrationTargetBranch;
    if (!validatedHead)
      throw refusal(
        "Workflow run has no validated Feature HEAD",
        "WORKTREE_NOT_READY",
      );
    if (!integrationTargetBranch)
      throw refusal(
        "This Workflow run has no saved Integration target branch; create a new run to enable automated local delivery",
        "INTEGRATION_TARGET_BRANCH_MISSING",
      );

    await assertFeatureFacts(repository, state, validatedHead);
    const target = await targetFacts(repository);
    const targetIsBase = target.head === gitState.data.runBase;
    const targetIsIntegrated = target.head === validatedHead;
    const wasPrepared = state.delivery?.status === "prepared";
    const wasBlocked = state.delivery?.status === "blocked";
    const targetMatchesIntent =
      target.branch === integrationTargetBranch && target.clean;

    if (!targetMatchesIntent) {
      if (wasPrepared) {
        state = await publishDelivery(
          repository,
          state,
          lock,
          deliveryRecord(
            state,
            "blocked",
            validatedHead,
            integrationTargetBranch,
            dependencies.clock ?? (() => new Date()),
            {
              reason:
                "Primary checkout no longer matches the saved Integration target intent",
            },
          ),
          "workflow.delivery.blocked",
          dependencies,
        );
        return reportFrom(state);
      }
      if (wasBlocked) return reportFrom(state);
      await cleanCheckout(repository);
      throw refusal(
        target.branch !== integrationTargetBranch
          ? `Primary checkout is on ${target.branch}, expected saved Integration target branch ${integrationTargetBranch}`
          : "Primary checkout is not clean; local integration made no mutation",
        target.branch !== integrationTargetBranch
          ? "WRONG_INTEGRATION_TARGET_BRANCH"
          : "DIRTY_TARGET_CHECKOUT",
        {
          expectedBranch: integrationTargetBranch,
          actualBranch: target.branch,
        },
      );
    }

    if (!existing && !targetIsBase)
      throw refusal(
        targetIsIntegrated
          ? "Integration target already points at the validated Feature HEAD before Delivery intent was recorded"
          : "Integration target HEAD moved or diverged from the immutable Run base",
        targetIsIntegrated
          ? "DELIVERY_INTENT_MISSING"
          : "TARGET_MOVED_OR_DIVERGED",
        { expectedHead: gitState.data.runBase, actualHead: target.head },
      );

    if ((wasPrepared || wasBlocked) && !targetIsBase && !targetIsIntegrated) {
      if (wasBlocked) return reportFrom(state);
      state = await publishDelivery(
        repository,
        state,
        lock,
        deliveryRecord(
          state,
          "blocked",
          validatedHead,
          integrationTargetBranch,
          dependencies.clock ?? (() => new Date()),
          {
            reason:
              "Integration target HEAD is neither the Run base nor the validated Feature HEAD",
          },
        ),
        "workflow.delivery.blocked",
        dependencies,
      );
      return reportFrom(state);
    }

    if (!existing || wasBlocked) {
      state = await publishDelivery(
        repository,
        state,
        lock,
        deliveryRecord(
          state,
          "prepared",
          validatedHead,
          integrationTargetBranch,
          dependencies.clock ?? (() => new Date()),
        ),
        "workflow.delivery.prepared",
        dependencies,
      );
    }

    if (targetIsIntegrated) {
      state = await publishDelivery(
        repository,
        state,
        lock,
        deliveryRecord(
          state,
          "completed",
          validatedHead,
          integrationTargetBranch,
          dependencies.clock ?? (() => new Date()),
          { integratedCommit: validatedHead },
        ),
        "workflow.delivery.completed",
        dependencies,
      );
      return reportFrom(state);
    }

    try {
      await (dependencies.gitRunner ?? gitOutput)(
        repository,
        ["merge", "--ff-only", "--quiet", "--", validatedHead],
        "DELIVERY_MUTATION_FAILED",
      );
    } catch (error) {
      const after = await targetFacts(repository).catch(() => undefined);
      if (
        after?.head === validatedHead &&
        after.clean &&
        after.branch === integrationTargetBranch
      ) {
        state = await publishDelivery(
          repository,
          state,
          lock,
          deliveryRecord(
            state,
            "completed",
            validatedHead,
            integrationTargetBranch,
            dependencies.clock ?? (() => new Date()),
            { integratedCommit: validatedHead },
          ),
          "workflow.delivery.completed",
          dependencies,
        );
        return reportFrom(state);
      }
      if (
        after &&
        after.head !== gitState.data.runBase &&
        after.head !== validatedHead
      ) {
        state = await publishDelivery(
          repository,
          state,
          lock,
          deliveryRecord(
            state,
            "blocked",
            validatedHead,
            integrationTargetBranch,
            dependencies.clock ?? (() => new Date()),
            {
              reason:
                "Fast-forward outcome is ambiguous because Integration target HEAD changed",
            },
          ),
          "workflow.delivery.blocked",
          dependencies,
        );
        return reportFrom(state);
      }
      throw error;
    }
    state = await publishDelivery(
      repository,
      state,
      lock,
      deliveryRecord(
        state,
        "completed",
        validatedHead,
        integrationTargetBranch,
        dependencies.clock ?? (() => new Date()),
        { integratedCommit: validatedHead },
      ),
      "workflow.delivery.completed",
      dependencies,
    );
    return reportFrom(state);
  } finally {
    await releaseRunLock(lock);
  }
}
