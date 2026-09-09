import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
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

export interface PreparePullRequestOptions {
  package: string;
  repository?: string;
  dependencies?: RunDependencies;
}

export interface PullRequestReport {
  status: DeliveryResult["status"];
  runId: string;
  channel: "github";
  implementationComplete: boolean;
  v1Complete: boolean;
  validatedHead: string;
  integrationTargetBranch: string;
  delivery: DeliveryResult;
  snapshot: StateSnapshot;
}

interface PullRequestIdentity {
  [key: string]: unknown;
  number: number;
  url: string;
  state: "open" | "merged" | "closed";
}

function workflowState(snapshot: StateSnapshot): WorkflowSnapshot {
  return snapshot as WorkflowSnapshot;
}

function refusal(
  message: string,
  code: string,
  details?: Record<string, unknown>,
): FlowError {
  return new FlowError(message, 4, code, details);
}

function errorText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const value = error as { stderr?: unknown; message?: unknown };
  return `${typeof value.stderr === "string" ? value.stderr : ""}\n${typeof value.message === "string" ? value.message : ""}`.trim();
}

function isUnsupported(error: unknown): boolean {
  return /unsupported|unknown (command|flag)|not a gh command/i.test(
    errorText(error),
  );
}

async function gitOutput(
  repository: string,
  args: string[],
  code = "GIT_COMMAND_FAILED",
): Promise<string> {
  try {
    const result = await run("git", args, {
      cwd: repository,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return result.stdout.trim();
  } catch (error) {
    throw new FlowError(errorText(error) || "Git command failed", 3, code, {
      repository,
      command: ["git", ...args],
    });
  }
}

async function toolOutput(
  tool: string,
  repository: string,
  args: string[],
): Promise<string> {
  const result = await run(tool, args, {
    cwd: repository,
    encoding: "utf8",
    env: process.env,
  });
  return result.stdout.trim();
}

async function commandAvailable(
  tool: string,
  repository: string,
): Promise<boolean> {
  try {
    await toolOutput(tool, repository, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

interface GitHubTool {
  primary: "gh-axi" | "gh";
  fallback?: "gh";
}

async function githubPreflight(repository: string): Promise<GitHubTool> {
  try {
    await gitOutput(
      repository,
      ["remote", "get-url", "origin"],
      "ORIGIN_REMOTE_MISSING",
    );
  } catch (error) {
    if (error instanceof FlowError && error.code === "ORIGIN_REMOTE_MISSING")
      throw refusal(
        "GitHub delivery requires an origin remote; add the repository's GitHub remote and retry",
        "ORIGIN_REMOTE_MISSING",
      );
    throw error;
  }
  const hasAxi = await commandAvailable("gh-axi", repository);
  const hasGh = await commandAvailable("gh", repository);
  if (!hasAxi && !hasGh)
    throw refusal(
      "GitHub delivery requires user-installed gh-axi or gh; install one and authenticate it before retrying",
      "GITHUB_TOOL_MISSING",
    );
  const primary = hasAxi ? "gh-axi" : "gh";
  try {
    await toolOutput(primary, repository, ["auth", "status"]);
  } catch (error) {
    if (primary === "gh-axi" && hasGh && isUnsupported(error)) {
      try {
        await toolOutput("gh", repository, ["auth", "status"]);
        return { primary, fallback: "gh" };
      } catch (fallbackError) {
        throw refusal(
          "GitHub delivery requires an authenticated GitHub CLI session; run its auth status/login flow yourself and retry",
          "GITHUB_AUTHENTICATION_FAILED",
          { tool: "gh", error: errorText(fallbackError) },
        );
      }
    }
    throw refusal(
      "GitHub delivery requires an authenticated GitHub CLI session; run its auth status/login flow yourself and retry",
      "GITHUB_AUTHENTICATION_FAILED",
      { tool: primary, error: errorText(error) },
    );
  }
  return {
    primary,
    ...(primary === "gh-axi" && hasGh ? { fallback: "gh" } : {}),
  };
}

async function githubOutput(
  tool: GitHubTool,
  repository: string,
  args: string[],
): Promise<string> {
  try {
    return await toolOutput(tool.primary, repository, args);
  } catch (error) {
    if (!tool.fallback || !isUnsupported(error)) throw error;
    await toolOutput(tool.fallback, repository, ["auth", "status"]);
    return toolOutput(tool.fallback, repository, args);
  }
}

async function findMatchingRuns(
  repository: string,
  source: string,
): Promise<WorkflowSnapshot[]> {
  let entries;
  try {
    entries = await readdir(join(repository, ".orchestrator", "runs"), {
      withFileTypes: true,
    });
  } catch {
    return [];
  }
  const matches: WorkflowSnapshot[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const snapshot = await inspectRun(repository, entry.name)
      .then((found) => workflowState(found.snapshot))
      .catch(() => undefined);
    if (snapshot?.workflowPackage?.source === source) matches.push(snapshot);
  }
  return matches;
}

async function selectCompletedRun(
  repository: string,
  packageData: ValidatedPackage,
): Promise<WorkflowSnapshot> {
  const matches = await findMatchingRuns(repository, packageData.source);
  if (matches.length === 0)
    throw new FlowError(
      `No Workflow run matches this Workflow package: ${packageData.source}`,
      3,
      "RUN_NOT_FOUND",
    );
  if (matches.length > 1)
    throw new FlowError(
      "Multiple Workflow runs match this Workflow package. Pull Request delivery refuses to guess.",
      3,
      "AMBIGUOUS_WORKFLOW_RUN",
      { runIds: matches.map((state) => state.runId) },
    );
  const selected = matches[0];
  if (!selected)
    throw new Error("Run selection unexpectedly produced no candidate");
  if (selected.phase !== "completed")
    throw refusal(
      `Workflow run ${selected.runId} has not completed its Ticket queue`,
      "WORKFLOW_NOT_COMPLETED",
    );
  return selected;
}

async function readPassingValidation(
  repository: string,
  state: WorkflowSnapshot,
): Promise<boolean> {
  const git = gitStateSchema.safeParse(state.git);
  if (
    !git.success ||
    !git.data.validatedHead ||
    state.validation?.status !== "passed" ||
    state.validation.validatedHead !== git.data.validatedHead ||
    state.validation.result !== validationFileName
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
    const result = validationResultSchema.parse(JSON.parse(contents));
    return (
      result.runId === state.runId &&
      result.status === "passed" &&
      result.validatedHead === git.data.validatedHead &&
      result.git?.headAfterValidation === git.data.validatedHead &&
      result.git.cleanAfterValidation
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
  dependencies: RunDependencies,
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
      `Workflow validation failed for ${report.validatedHead}; Pull Request delivery did not mutate Git`,
      1,
      "VALIDATION_FAILED",
      { runId: report.runId, checks: report.checks },
    );
  return workflowState((await inspectRun(repository, state.runId)).snapshot);
}

async function assertFeatureFacts(
  repository: string,
  state: WorkflowSnapshot,
  validatedHead: string,
): Promise<{ featureBranch: string; runBase: string }> {
  const git = gitStateSchema.safeParse(state.git);
  if (
    !git.success ||
    git.data.worktreeStatus !== "ready" ||
    git.data.validatedHead !== validatedHead
  )
    throw refusal(
      "Validation does not match a ready Feature worktree",
      "STALE_VALIDATION",
    );
  await validateWorktree({ repository, runId: state.runId });
  const branchHead = await gitOutput(repository, [
    "rev-parse",
    "--verify",
    `refs/heads/${git.data.featureBranch}^{commit}`,
  ]);
  if (branchHead !== validatedHead)
    throw refusal(
      "Feature branch no longer points at the validated HEAD",
      "STALE_VALIDATION",
    );
  try {
    await gitOutput(repository, [
      "merge-base",
      "--is-ancestor",
      git.data.runBase,
      validatedHead,
    ]);
  } catch {
    throw refusal(
      "Validated Feature HEAD does not descend from the immutable Run base",
      "DIVERGENT_FEATURE_HISTORY",
    );
  }
  return { featureBranch: git.data.featureBranch, runBase: git.data.runBase };
}

function deliveryRecord(
  state: WorkflowSnapshot,
  status: DeliveryResult["status"],
  validatedHead: string,
  integrationTargetBranch: string,
  extra: Partial<DeliveryResult> = {},
): DeliveryResult {
  return deliveryResultSchema.parse({
    schemaVersion: 1,
    channel: "github",
    status,
    validatedHead,
    integrationTargetBranch,
    at: new Date().toISOString(),
    ...extra,
  });
}

async function publishDelivery(
  repository: string,
  state: WorkflowSnapshot,
  lock: RunLock,
  delivery: DeliveryResult,
  dependencies: RunDependencies,
): Promise<WorkflowSnapshot> {
  const updated = await mutateRun(
    {
      repository,
      runId: state.runId,
      event: "checkpoint",
      preserveLifecycle: true,
      historyEventType: `workflow.delivery.${delivery.status}`,
      data: { delivery },
      updateSnapshot: () => ({ delivery }),
      lock,
    },
    dependencies,
  );
  return workflowState(updated.snapshot);
}

async function reconcileHistory(
  repository: string,
  current: ReadRunResult,
  lock: RunLock,
  dependencies: RunDependencies,
): Promise<ReadRunResult> {
  if (current.audit.synchronized || !current.snapshot.delivery) return current;
  return mutateRun(
    {
      repository,
      runId: current.snapshot.runId,
      event: "checkpoint",
      historyOnly: true,
      historyEventType: `workflow.delivery.${current.snapshot.delivery.status}`,
      data: { delivery: current.snapshot.delivery },
      lock,
    },
    dependencies,
  );
}

function reportFrom(state: WorkflowSnapshot): PullRequestReport {
  if (!state.delivery)
    throw new Error("Pull Request report requires a persisted Delivery result");
  return {
    status: state.delivery.status,
    runId: state.runId,
    channel: "github",
    implementationComplete: state.phase === "completed",
    v1Complete:
      state.phase === "completed" && state.delivery.status === "completed",
    validatedHead: state.delivery.validatedHead,
    integrationTargetBranch: state.delivery.integrationTargetBranch,
    delivery: state.delivery,
    snapshot: state,
  };
}

async function remoteFeatureHead(
  repository: string,
  featureBranch: string,
): Promise<string | undefined> {
  const output = await gitOutput(
    repository,
    ["ls-remote", "--heads", "origin", `refs/heads/${featureBranch}`],
    "REMOTE_FEATURE_LOOKUP_FAILED",
  );
  if (output.length === 0) return undefined;
  const lines = output.split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1)
    throw refusal(
      "Remote Feature branch lookup is ambiguous",
      "REMOTE_FEATURE_AMBIGUOUS",
    );
  const [head, ref] = lines[0]!.split(/\s+/);
  if (
    !head ||
    ref !== `refs/heads/${featureBranch}` ||
    !/^[0-9a-f]{40,64}$/.test(head)
  )
    throw refusal(
      "Remote Feature branch lookup returned malformed evidence",
      "REMOTE_FEATURE_AMBIGUOUS",
    );
  return head;
}

function parsePullRequest(item: unknown): PullRequestIdentity {
  if (!item || typeof item !== "object")
    throw refusal(
      "Pull Request lookup returned malformed evidence",
      "PULL_REQUEST_AMBIGUOUS",
    );
  const value = item as Record<string, unknown>;
  const number = value.number;
  const url = value.url;
  const rawState =
    typeof value.state === "string" ? value.state.toLowerCase() : "";
  const state = value.mergedAt
    ? "merged"
    : rawState === "open"
      ? "open"
      : rawState === "merged"
        ? "merged"
        : rawState === "closed"
          ? "closed"
          : undefined;
  if (
    !Number.isInteger(number) ||
    (number as number) <= 0 ||
    typeof url !== "string" ||
    !state
  )
    throw refusal(
      "Pull Request lookup returned malformed identity",
      "PULL_REQUEST_AMBIGUOUS",
    );
  return { number: number as number, url, state };
}

function parsePullRequests(output: string): PullRequestIdentity[] {
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed))
    throw refusal(
      "Pull Request lookup returned malformed evidence",
      "PULL_REQUEST_AMBIGUOUS",
    );
  return parsed.map(parsePullRequest);
}

function normalizeChecks(
  output: string,
): NonNullable<DeliveryResult["checks"]> {
  try {
    const parsed: unknown = JSON.parse(output);
    if (!Array.isArray(parsed) || parsed.length === 0) return "unavailable";
    const values = parsed.flatMap((item) =>
      item && typeof item === "object"
        ? [
            String(
              (item as Record<string, unknown>).bucket ??
                (item as Record<string, unknown>).state ??
                (item as Record<string, unknown>).conclusion ??
                "",
            ).toLowerCase(),
          ]
        : [],
    );
    if (
      values.length !== parsed.length ||
      values.some((value) => value.length === 0)
    )
      return "unavailable";
    if (values.some((value) => /fail|error|cancel|timed.out/.test(value)))
      return "failed";
    if (
      values.every((value) => /pass|success|neutral|skipp|complete/.test(value))
    )
      return "passed";
    if (
      values.some((value) =>
        /pending|queued|in.progress|waiting|requested/.test(value),
      )
    )
      return "pending";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

function pullRequestTitle(packageData: ValidatedPackage): string {
  const heading = packageData.specification.contents
    .match(/^#\s+(.+?)\s*$/m)?.[1]
    ?.trim();
  return heading && heading.length > 0 ? heading : basename(packageData.source);
}

function pullRequestBody(
  state: WorkflowSnapshot,
  packageData: ValidatedPackage,
  validatedHead: string,
): string {
  const tickets = Object.entries(state.tickets ?? {})
    .filter(([, ticket]) => ticket.status === "accepted")
    .map(([id]) => id)
    .join(", ");
  const validation = state.validation?.status ?? "unknown";
  return [
    `Workflow run: ${state.runId}`,
    `Specification: ${packageData.source}/spec.md`,
    `Accepted tickets: ${tickets || "none"}`,
    `Validated HEAD: ${validatedHead}`,
    `Validation: ${validation} (test, lint, typecheck, format check, build)`,
  ].join("\n");
}

async function lookupPullRequests(
  tool: GitHubTool,
  repository: string,
  featureBranch: string,
  base: string,
): Promise<PullRequestIdentity[]> {
  return parsePullRequests(
    await githubOutput(tool, repository, [
      "pr",
      "list",
      "--head",
      featureBranch,
      "--base",
      base,
      "--state",
      "all",
      "--json",
      "number,url,state,mergedAt",
    ]),
  );
}

async function createPullRequest(
  tool: GitHubTool,
  repository: string,
  featureBranch: string,
  base: string,
  title: string,
  body: string,
): Promise<PullRequestIdentity> {
  try {
    return parsePullRequest(
      JSON.parse(
        await githubOutput(tool, repository, [
          "pr",
          "create",
          "--head",
          featureBranch,
          "--base",
          base,
          "--title",
          title,
          "--body",
          body,
          "--json",
          "number,url,state,mergedAt",
        ]),
      ),
    );
  } catch (error) {
    if (error instanceof FlowError) throw error;
    throw refusal(
      "Pull Request creation returned ambiguous identity evidence",
      "PULL_REQUEST_AMBIGUOUS",
    );
  }
}

async function observeChecks(
  tool: GitHubTool,
  repository: string,
  number: number,
): Promise<NonNullable<DeliveryResult["checks"]>> {
  try {
    return normalizeChecks(
      await githubOutput(tool, repository, [
        "pr",
        "checks",
        String(number),
        "--json",
        "name,state,bucket,conclusion",
      ]),
    );
  } catch {
    return "unavailable";
  }
}

/** Validate a completed run when required, then publish its Feature branch as one idempotent Pull Request. */
export async function preparePullRequest(
  options: PreparePullRequestOptions,
): Promise<PullRequestReport> {
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
    if (state.delivery && state.delivery.channel !== "github")
      throw new FlowError(
        `Workflow run ${state.runId} already selected the ${state.delivery.channel} Delivery channel`,
        4,
        "DELIVERY_CHANNEL_CONFLICT",
        { requestedChannel: "github", existingChannel: state.delivery.channel },
      );
    if (state.delivery?.status === "completed") return reportFrom(state);

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
    const git = gitStateSchema.safeParse(state.git);
    const validatedHead = git.success ? git.data.validatedHead : undefined;
    const base = git.success ? git.data.integrationTargetBranch : undefined;
    if (!validatedHead || !base)
      throw refusal(
        "Workflow run has no saved validated Feature HEAD and Integration target branch",
        "INTEGRATION_TARGET_BRANCH_MISSING",
      );
    const feature = await assertFeatureFacts(repository, state, validatedHead);
    const tool = await githubPreflight(repository);
    const remoteHead = await remoteFeatureHead(
      repository,
      feature.featureBranch,
    );
    const existing = state.delivery;
    if (remoteHead && remoteHead !== validatedHead) {
      if (!existing)
        throw refusal(
          "Remote Feature branch points at a different commit; resolve it manually without force-pushing",
          "REMOTE_FEATURE_CONFLICT",
          { remoteHead, validatedHead },
        );
      state = await publishDelivery(
        repository,
        state,
        lock,
        deliveryRecord(state, "blocked", validatedHead, base, {
          remoteFeatureBranch: feature.featureBranch,
          reason: "Remote Feature branch points at a different commit",
        }),
        dependencies,
      );
      return reportFrom(state);
    }
    if (!existing || existing.status === "blocked")
      state = await publishDelivery(
        repository,
        state,
        lock,
        deliveryRecord(state, "prepared", validatedHead, base, {
          remoteFeatureBranch: feature.featureBranch,
        }),
        dependencies,
      );
    if (!remoteHead)
      await gitOutput(
        repository,
        [
          "push",
          "origin",
          `${feature.featureBranch}:refs/heads/${feature.featureBranch}`,
        ],
        "PUSH_FAILED",
      );

    let matches: PullRequestIdentity[];
    try {
      matches = await lookupPullRequests(
        tool,
        repository,
        feature.featureBranch,
        base,
      );
    } catch (error) {
      if (error instanceof FlowError) {
        state = await publishDelivery(
          repository,
          state,
          lock,
          deliveryRecord(state, "blocked", validatedHead, base, {
            remoteFeatureBranch: feature.featureBranch,
            reason: error.message,
          }),
          dependencies,
        );
        return reportFrom(state);
      }
      throw error;
    }
    if (
      matches.length > 1 ||
      matches.some((match) => match.state === "closed")
    ) {
      state = await publishDelivery(
        repository,
        state,
        lock,
        deliveryRecord(state, "blocked", validatedHead, base, {
          remoteFeatureBranch: feature.featureBranch,
          reason:
            matches.length > 1
              ? "Multiple Pull Requests match this head and base"
              : "A matching Pull Request was closed without merging",
        }),
        dependencies,
      );
      return reportFrom(state);
    }
    const pullRequest =
      matches[0] ??
      (await createPullRequest(
        tool,
        repository,
        feature.featureBranch,
        base,
        pullRequestTitle(packageData),
        pullRequestBody(state, packageData, validatedHead),
      ));
    if (pullRequest.state === "closed") {
      state = await publishDelivery(
        repository,
        state,
        lock,
        deliveryRecord(state, "blocked", validatedHead, base, {
          remoteFeatureBranch: feature.featureBranch,
          pullRequest,
          reason: "A matching Pull Request was closed without merging",
        }),
        dependencies,
      );
      return reportFrom(state);
    }
    const checks = await observeChecks(tool, repository, pullRequest.number);
    state = await publishDelivery(
      repository,
      state,
      lock,
      deliveryRecord(state, "completed", validatedHead, base, {
        remoteFeatureBranch: feature.featureBranch,
        pullRequest,
        checks,
        ...(pullRequest.state === "merged" ? { externallyMerged: true } : {}),
      }),
      dependencies,
    );
    return reportFrom(state);
  } finally {
    await releaseRunLock(lock);
  }
}
