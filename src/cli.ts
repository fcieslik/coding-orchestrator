import packageMetadata from "../package.json" with { type: "json" };

import {
  cleanupWorktree,
  prepareWorktree,
  validateCheckpoint,
  validateWorktree,
} from "./git-worktree.js";
import { runHerdrSmoke } from "./herdr.js";
import { setupRepository } from "./setup.js";
import { validateWorkflowRun } from "./validation.js";
import { integrateWorkflowRun } from "./integration.js";
import { preparePullRequest } from "./github.js";
import { executeWorkflowStep } from "./workflow-step.js";
import {
  executeWorker,
  reconcileWorker,
  retryWorker,
} from "./worker-execution.js";
import {
  createRun,
  FlowError,
  inspectRun,
  mutateRun,
  selectRun,
} from "./workflow-run.js";

const arguments_ = process.argv.slice(2);
const [argument] = arguments_;
const structuredRequest =
  ((argument === "status" ||
    argument === "history" ||
    argument === "validate" ||
    argument === "integrate" ||
    argument === "pr" ||
    (argument === "worktree" &&
      (arguments_[1] === "prepare" ||
        arguments_[1] === "validate" ||
        arguments_[1] === "cleanup")) ||
    (argument === "checkpoint" && arguments_[1] === "validate")) &&
    arguments_.includes("--json")) ||
  (argument === "run" &&
    arguments_[1] === "resume" &&
    arguments_.includes("--json")) ||
  (argument === "herdr" &&
    arguments_[1] === "smoke" &&
    arguments_.includes("--json")) ||
  (argument === "worker" &&
    (arguments_[1] === "execute" ||
      arguments_[1] === "reconcile" ||
      arguments_[1] === "retry") &&
    arguments_.includes("--json"));
const setupStructuredRequest =
  argument === "setup" && arguments_.includes("--json");
const workflowStepStructuredRequest =
  argument === "orchestrate" && arguments_.includes("--json");

function parseOptions(
  tokens: string[],
  valueOptions: readonly string[],
  flagOptions: readonly string[] = [],
): { values: Map<string, string>; flags: Set<string> } {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token && flagOptions.includes(token)) {
      if (flags.has(token)) {
        throw new FlowError(`Duplicate option: ${token}`, 2);
      }
      flags.add(token);
      continue;
    }
    if (!token || !valueOptions.includes(token) || values.has(token)) {
      throw new FlowError(`Invalid option: ${token ?? ""}`, 2);
    }
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) {
      throw new FlowError(`Option requires a value: ${token}`, 2);
    }
    values.set(token, value);
    index += 1;
  }
  return { values, flags };
}

try {
  if (
    arguments_.length === 0 ||
    (arguments_.length === 1 && argument === "--help")
  ) {
    console.log("Usage: flow [options]");
  } else if (arguments_.length === 1 && argument === "--version") {
    console.log(packageMetadata.version);
  } else if (argument === "setup" && arguments_.includes("--help")) {
    console.log("Usage: flow setup [--repo <path>] [--json]");
    console.log(
      "Create and validate the repository-local orchestration contract.",
    );
    console.log(
      "Existing policy and documentation are preserved; conflicts fail closed.",
    );
  } else if (argument === "setup") {
    const { flags, values } = parseOptions(
      arguments_.slice(1),
      ["--repo"],
      ["--json"],
    );
    const repository = values.get("--repo");
    const report = await setupRepository(
      repository === undefined ? {} : { repository },
    );
    if (flags.has("--json")) {
      console.log(JSON.stringify(report));
    } else {
      console.log(
        `Orchestration setup: ${report.created.length > 0 ? "updated" : "already initialized"}`,
      );
      console.log(`Repository: ${report.repository}`);
      for (const path of report.created) console.log(`Created: ${path}`);
      for (const path of report.preserved) console.log(`Preserved: ${path}`);
      console.log(
        `Worker: ${report.config.roles.worker.agent} / ${report.config.roles.worker.skill}`,
      );
      console.log(`Timeout: ${report.config.workflow.workerTimeoutSeconds}s`);
      console.log(
        `Maximum attempts: ${report.config.workflow.maxWorkerAttempts}`,
      );
      const validation = report.config.workflow.validation;
      if (validation === undefined) console.log("Validation: not configured");
      else
        console.log(
          `Validation: ${validation.test} / ${validation.lint} / ${validation.typecheck} / ${validation.formatCheck} / ${validation.build} (${validation.timeoutSeconds}s timeout per command)`,
        );
    }
  } else if (argument === "orchestrate" && arguments_.includes("--help")) {
    console.log(
      "Usage: flow orchestrate <workflow-package> <ticket-id> [--repo <path>] [--new-run] [--json]",
    );
    console.log(
      "Execute one explicit ticket from a local spec.md + issues/*.md Workflow package.",
    );
  } else if (argument === "orchestrate") {
    const values = new Map<string, string>();
    const flags = new Set<string>();
    const positional: string[] = [];
    const valueOptions = new Set(["--repo", "--package", "--ticket"]);
    for (let index = 1; index < arguments_.length; index += 1) {
      const token = arguments_[index];
      if (!token) continue;
      if (token === "--json" || token === "--new-run") {
        if (flags.has(token))
          throw new FlowError(`Duplicate option: ${token}`, 2);
        flags.add(token);
      } else if (valueOptions.has(token)) {
        if (values.has(token))
          throw new FlowError(`Duplicate option: ${token}`, 2);
        const value = arguments_[index + 1];
        if (!value || value.startsWith("--"))
          throw new FlowError(`Option requires a value: ${token}`, 2);
        values.set(token, value);
        index += 1;
      } else if (token.startsWith("--")) {
        throw new FlowError(`Invalid option: ${token}`, 2);
      } else positional.push(token);
    }
    const packageReference = values.get("--package") ?? positional[0];
    const ticketId = values.get("--ticket") ?? positional[1];
    if (!packageReference || !ticketId || positional.length > 2)
      throw new FlowError(
        "Usage: flow orchestrate <workflow-package> <ticket-id> [--repo <path>] [--new-run] [--json]",
        2,
      );
    const repository = values.get("--repo");
    const report = await executeWorkflowStep({
      package: packageReference,
      ticket: ticketId,
      ...(flags.has("--new-run") ? { newRun: true } : {}),
      ...(repository === undefined ? {} : { repository }),
    });
    if (flags.has("--json")) console.log(JSON.stringify(report));
    else {
      console.log(`Workflow step: ${report.status}`);
      console.log(`Run: ${report.runId}`);
      console.log(`Ticket: ${report.ticketId}`);
      console.log(`Accepted Git checkpoint: ${report.acceptedCommit}`);
      console.log(
        `Next ticket: ${report.nextTicket ?? "none (implementation complete)"}`,
      );
      if (report.snapshot.phase === "completed")
        console.log("Phase 6 deterministic validation has not run.");
    }
  } else if (argument === "validate" && arguments_.includes("--help")) {
    console.log(
      "Usage: flow validate <workflow-package> [--repo <path>] [--json]",
    );
    console.log(
      "Resolve the completed Workflow run for a package, run the configured test, lint, typecheck, formatCheck, and build commands in the Feature worktree, and record the durable validation result.",
    );
  } else if (argument === "validate") {
    const values = new Map<string, string>();
    const flags = new Set<string>();
    const positional: string[] = [];
    const valueOptions = new Set(["--repo", "--package"]);
    for (let index = 1; index < arguments_.length; index += 1) {
      const token = arguments_[index];
      if (!token) continue;
      if (token === "--json") {
        if (flags.has(token))
          throw new FlowError(`Duplicate option: ${token}`, 2);
        flags.add(token);
      } else if (valueOptions.has(token)) {
        if (values.has(token))
          throw new FlowError(`Duplicate option: ${token}`, 2);
        const value = arguments_[index + 1];
        if (!value || value.startsWith("--"))
          throw new FlowError(`Option requires a value: ${token}`, 2);
        values.set(token, value);
        index += 1;
      } else if (token.startsWith("--")) {
        throw new FlowError(`Invalid option: ${token}`, 2);
      } else positional.push(token);
    }
    const packageReference = values.get("--package") ?? positional[0];
    if (!packageReference || positional.length > 1)
      throw new FlowError(
        "Usage: flow validate <workflow-package> [--repo <path>] [--json]",
        2,
      );
    const repository = values.get("--repo");
    const report = await validateWorkflowRun(
      repository === undefined
        ? { package: packageReference }
        : { package: packageReference, repository },
    );
    if (flags.has("--json")) console.log(JSON.stringify(report));
    else {
      console.log(`Workflow validation: ${report.status}`);
      console.log(`Run: ${report.runId}`);
      console.log(`Validated HEAD: ${report.validatedHead}`);
      for (const check of report.checks)
        console.log(
          `${check.name}: ${check.status} (exit ${check.exitCode ?? "signal"}, ${check.durationMs}ms)`,
        );
      console.log(`Result: ${report.result}`);
    }
    if (report.status !== "passed") process.exitCode = 1;
  } else if (argument === "integrate" && arguments_.includes("--help")) {
    console.log(
      "Usage: flow integrate <workflow-package> [--repo <path>] [--json]",
    );
    console.log(
      "Validate the completed Workflow run when needed and fast-forward its saved local Integration target branch.",
    );
  } else if (argument === "integrate") {
    const values = new Map<string, string>();
    const flags = new Set<string>();
    const positional: string[] = [];
    const valueOptions = new Set(["--repo", "--package"]);
    for (let index = 1; index < arguments_.length; index += 1) {
      const token = arguments_[index];
      if (!token) continue;
      if (token === "--json") {
        if (flags.has(token))
          throw new FlowError(`Duplicate option: ${token}`, 2);
        flags.add(token);
      } else if (valueOptions.has(token)) {
        if (values.has(token))
          throw new FlowError(`Duplicate option: ${token}`, 2);
        const value = arguments_[index + 1];
        if (!value || value.startsWith("--"))
          throw new FlowError(`Option requires a value: ${token}`, 2);
        values.set(token, value);
        index += 1;
      } else if (token.startsWith("--")) {
        throw new FlowError(`Invalid option: ${token}`, 2);
      } else positional.push(token);
    }
    const packageReference = values.get("--package") ?? positional[0];
    if (!packageReference || positional.length > 1)
      throw new FlowError(
        "Usage: flow integrate <workflow-package> [--repo <path>] [--json]",
        2,
      );
    const repository = values.get("--repo");
    const report = await integrateWorkflowRun(
      repository === undefined
        ? { package: packageReference }
        : { package: packageReference, repository },
    );
    if (flags.has("--json")) console.log(JSON.stringify(report));
    else {
      console.log(`Local integration: ${report.status}`);
      console.log(`Run: ${report.runId}`);
      console.log("Implementation: complete");
      console.log(`V1: ${report.v1Complete ? "complete" : "incomplete"}`);
      console.log(`Target branch: ${report.integrationTargetBranch}`);
      console.log(`Validated HEAD: ${report.validatedHead}`);
      if (report.delivery.integratedCommit)
        console.log(`Integrated commit: ${report.delivery.integratedCommit}`);
      if (report.delivery.reason)
        console.log(`Reason: ${report.delivery.reason}`);
    }
    if (report.status !== "completed") process.exitCode = 1;
  } else if (argument === "pr" && arguments_.includes("--help")) {
    console.log("Usage: flow pr <workflow-package> [--repo <path>] [--json]");
    console.log(
      "Validate the completed Workflow run when needed, then push its Feature branch and create or reuse one GitHub Pull Request.",
    );
  } else if (argument === "pr") {
    const values = new Map<string, string>();
    const flags = new Set<string>();
    const positional: string[] = [];
    const valueOptions = new Set(["--repo", "--package"]);
    for (let index = 1; index < arguments_.length; index += 1) {
      const token = arguments_[index];
      if (!token) continue;
      if (token === "--json") {
        if (flags.has(token))
          throw new FlowError(`Duplicate option: ${token}`, 2);
        flags.add(token);
      } else if (valueOptions.has(token)) {
        if (values.has(token))
          throw new FlowError(`Duplicate option: ${token}`, 2);
        const value = arguments_[index + 1];
        if (!value || value.startsWith("--"))
          throw new FlowError(`Option requires a value: ${token}`, 2);
        values.set(token, value);
        index += 1;
      } else if (token.startsWith("--"))
        throw new FlowError(`Invalid option: ${token}`, 2);
      else positional.push(token);
    }
    const packageReference = values.get("--package") ?? positional[0];
    if (!packageReference || positional.length > 1)
      throw new FlowError(
        "Usage: flow pr <workflow-package> [--repo <path>] [--json]",
        2,
      );
    const repository = values.get("--repo");
    const report = await preparePullRequest(
      repository === undefined
        ? { package: packageReference }
        : { package: packageReference, repository },
    );
    if (flags.has("--json")) console.log(JSON.stringify(report));
    else {
      console.log(`GitHub Pull Request delivery: ${report.status}`);
      console.log(`Run: ${report.runId}`);
      console.log(`Target branch: ${report.integrationTargetBranch}`);
      console.log(`Validated HEAD: ${report.validatedHead}`);
      if (report.delivery.pullRequest)
        console.log(
          `Pull Request: ${report.delivery.pullRequest.url} (${report.delivery.pullRequest.state})`,
        );
      if (report.delivery.checks)
        console.log(`Checks: ${report.delivery.checks}`);
      if (report.delivery.reason)
        console.log(`Reason: ${report.delivery.reason}`);
    }
    if (report.status !== "completed") process.exitCode = 1;
  } else if (argument === "run" && arguments_[1] === "create") {
    const { values } = parseOptions(arguments_.slice(2), [
      "--repo",
      "--spec",
      "--run",
    ]);
    const repository = values.get("--repo");
    const specification = values.get("--spec");
    const runId = values.get("--run");
    if (!specification) {
      throw new FlowError(
        "Usage: flow run create [--repo <path>] --spec <file> [--run <id>]",
        2,
      );
    }
    const createdRunId = await createRun({
      specification,
      ...(repository === undefined ? {} : { repository }),
      ...(runId === undefined ? {} : { runId }),
    });
    console.log(`Created run ${createdRunId}`);
  } else if (argument === "run" && arguments_[1] === "resume") {
    const { flags, values } = parseOptions(
      arguments_.slice(2),
      ["--repo", "--run"],
      ["--json"],
    );
    const runId = values.get("--run");
    if (!runId)
      throw new FlowError(
        "Usage: flow run resume --run <id> [--repo <path>] [--json]",
        2,
      );
    const repository = values.get("--repo");
    const resumed = await mutateRun({
      runId,
      event: "resume",
      ...(repository === undefined ? {} : { repository }),
    });
    if (flags.has("--json")) console.log(JSON.stringify(resumed.snapshot));
    else {
      console.log(`Run: ${resumed.snapshot.runId}`);
      console.log(`Phase: ${resumed.snapshot.phase}`);
    }
  } else if (
    argument === "worker" &&
    arguments_[1] === "execute" &&
    arguments_.includes("--help")
  ) {
    console.log(
      "Usage: flow worker execute --run <id> --ticket <file> [--repo <path>] [--json]",
    );
    console.log(
      "Execute one explicit Markdown ticket in the ready Feature worktree through a fresh Codex worker.",
    );
  } else if (argument === "worker" && arguments_[1] === "execute") {
    const { flags, values } = parseOptions(
      arguments_.slice(2),
      ["--repo", "--run", "--ticket"],
      ["--json"],
    );
    const runId = values.get("--run");
    const ticket = values.get("--ticket");
    if (!runId || !ticket)
      throw new FlowError(
        "Usage: flow worker execute --run <id> --ticket <file> [--repo <path>] [--json]",
        2,
      );
    const repository = values.get("--repo");
    const report = await executeWorker(
      repository === undefined
        ? { runId, ticket }
        : { repository, runId, ticket },
    );
    if (flags.has("--json")) console.log(JSON.stringify(report));
    else {
      console.log(`Worker execution: ${report.status}`);
      console.log(`Run: ${report.runId}`);
      console.log(`Ticket: ${report.ticketId}`);
      console.log(`Attempt: ${report.attemptId}`);
      console.log(`Execution: ${report.executionId}`);
      console.log(`Accepted Git checkpoint: ${report.acceptedCommit}`);
      console.log(`Execution record: ${report.artifacts.record}`);
      console.log(`Worker result: ${report.artifacts.output}`);
    }
  } else if (
    argument === "worker" &&
    arguments_[1] === "reconcile" &&
    arguments_.includes("--help")
  ) {
    console.log(
      "Usage: flow worker reconcile --run <id> [--ticket <id>] [--attempt <id> | --execution <id>] [--repo <path>] [--json]",
    );
    console.log(
      "Inspect an existing Worker attempt without prompting or launching an agent.",
    );
  } else if (argument === "worker" && arguments_[1] === "reconcile") {
    const { flags, values } = parseOptions(
      arguments_.slice(2),
      ["--repo", "--run", "--ticket", "--attempt", "--execution"],
      ["--json"],
    );
    const runId = values.get("--run");
    if (!runId)
      throw new FlowError(
        "Usage: flow worker reconcile --run <id> [--ticket <id>] [--attempt <id> | --execution <id>] [--repo <path>] [--json]",
        2,
      );
    if (values.has("--attempt") && values.has("--execution"))
      throw new FlowError("Choose either --attempt or --execution", 2);
    const repository = values.get("--repo");
    const ticketId = values.get("--ticket");
    const attemptId = values.get("--attempt");
    const executionId = values.get("--execution");
    const report = await reconcileWorker({
      ...(repository === undefined ? {} : { repository }),
      runId,
      ...(ticketId === undefined ? {} : { ticketId }),
      ...(attemptId === undefined ? {} : { attemptId }),
      ...(executionId === undefined ? {} : { executionId }),
    });
    if (flags.has("--json")) console.log(JSON.stringify(report));
    else {
      console.log(`Worker reconciliation: ${report.outcome}`);
      console.log(`Run: ${report.runId}`);
      console.log(`Ticket: ${report.ticketId}`);
      console.log(`Attempt: ${report.attemptId}`);
      if (report.executionId) console.log(`Execution: ${report.executionId}`);
      console.log(`Result evidence: ${report.evidence.result}`);
      if (report.evidence.currentHead)
        console.log(`Current HEAD: ${report.evidence.currentHead}`);
      console.log(
        `Worktree clean: ${report.evidence.clean === true ? "yes" : "no"}`,
      );
      console.log(`Cleanup: ${report.cleanup.status}`);
      if (report.retry) {
        console.log(
          `Retry: ${report.retry.eligible ? "eligible" : "not eligible"} (${report.retry.attempt}/${report.retry.maxAttempts})`,
        );
        if (report.retry.reason)
          console.log(`Retry reason: ${report.retry.reason}`);
      }
      if (report.reason) console.log(`Reason: ${report.reason}`);
    }
    if (report.exitCode !== 0) process.exitCode = report.exitCode;
  } else if (
    argument === "worker" &&
    arguments_[1] === "retry" &&
    arguments_.includes("--help")
  ) {
    console.log(
      "Usage: flow worker retry --run <id> [--ticket <file>] [--attempt <id> | --execution <id>] [--refresh-ticket <file>] [--repo <path>] [--json]",
    );
    console.log(
      "Reconcile the prior Worker attempt, then explicitly launch one bounded fresh retry.",
    );
  } else if (argument === "worker" && arguments_[1] === "retry") {
    const { flags, values } = parseOptions(
      arguments_.slice(2),
      [
        "--repo",
        "--run",
        "--ticket",
        "--attempt",
        "--execution",
        "--refresh-ticket",
      ],
      ["--json"],
    );
    const runId = values.get("--run");
    if (!runId)
      throw new FlowError(
        "Usage: flow worker retry --run <id> [--ticket <file>] [--attempt <id> | --execution <id>] [--refresh-ticket <file>] [--repo <path>] [--json]",
        2,
      );
    if (values.has("--attempt") && values.has("--execution"))
      throw new FlowError("Choose either --attempt or --execution", 2);
    const retryOptions = { runId } as Parameters<typeof retryWorker>[0];
    const repository = values.get("--repo");
    const ticket = values.get("--ticket");
    const attemptId = values.get("--attempt");
    const executionId = values.get("--execution");
    const refreshTicket = values.get("--refresh-ticket");
    if (repository !== undefined) retryOptions.repository = repository;
    if (ticket !== undefined) retryOptions.ticket = ticket;
    if (attemptId !== undefined) retryOptions.attemptId = attemptId;
    if (executionId !== undefined) retryOptions.executionId = executionId;
    if (refreshTicket !== undefined) retryOptions.refreshTicket = refreshTicket;
    const report = await retryWorker(retryOptions);
    if (flags.has("--json")) console.log(JSON.stringify(report));
    else {
      console.log(`Worker retry: ${report.status}`);
      console.log(`Run: ${report.runId}`);
      console.log(`Ticket: ${report.ticketId}`);
      console.log(`Attempt: ${report.attemptId}`);
      console.log(`Execution: ${report.executionId}`);
      console.log(`Accepted Git checkpoint: ${report.acceptedCommit}`);
      console.log(`Execution record: ${report.artifacts.record}`);
      console.log(`Worker result: ${report.artifacts.output}`);
    }
  } else if (argument === "status") {
    const { flags, values } = parseOptions(
      arguments_.slice(1),
      ["--repo", "--run"],
      ["--json"],
    );
    const repository = values.get("--repo");
    const runId = values.get("--run");
    const selected = await selectRun(repository, runId);
    const { operationalHistory, snapshot, audit } = await inspectRun(
      selected.repository,
      selected.runId,
    );
    const lastEvent = operationalHistory.at(-1);
    const operationalHistoryMetadata = {
      lastSequence: lastEvent?.sequence ?? 0,
      lastStateRevision: lastEvent?.stateRevision ?? 0,
      synchronized: audit.synchronized,
      ...(audit.warning === undefined ? {} : { warning: audit.warning }),
      ...(selected.diagnostics ?? {}),
    };
    if (flags.has("--json")) {
      console.log(
        JSON.stringify({ ...snapshot, history: operationalHistoryMetadata }),
      );
    } else {
      console.log(`Run: ${snapshot.runId}`);
      console.log(`Phase: ${snapshot.phase}`);
      console.log(`Specification: ${snapshot.specification}`);
      console.log(`Revision: ${snapshot.revision}`);
      console.log(`Created: ${snapshot.createdAt}`);
      console.log(`Updated: ${snapshot.updatedAt}`);
      if (snapshot.git) {
        console.log(`Run base: ${snapshot.git.runBase}`);
        console.log(`Feature branch: ${snapshot.git.featureBranch}`);
        console.log(`Feature worktree: ${snapshot.git.featureWorktree}`);
        console.log(`Worktree: ${snapshot.git.worktreeStatus}`);
        if (snapshot.git.validatedHead)
          console.log(`Validated HEAD: ${snapshot.git.validatedHead}`);
      }
      console.log(
        `History: ${operationalHistoryMetadata.synchronized ? "synchronized" : `interrupted audit (${audit.warning})`}`,
      );
      if (selected.diagnostics?.stagingDirectories.length) {
        console.log(
          `Diagnostics: interrupted creation staging directories remain (${selected.diagnostics.stagingDirectories.join(", ")})`,
        );
      }
    }
  } else if (argument === "history") {
    const { flags, values } = parseOptions(
      arguments_.slice(1),
      ["--repo", "--run"],
      ["--json"],
    );
    const repository = values.get("--repo");
    const runId = values.get("--run");
    const selected = await selectRun(repository, runId);
    const { operationalHistory } = await inspectRun(
      selected.repository,
      selected.runId,
    );
    if (flags.has("--json")) {
      console.log(JSON.stringify(operationalHistory));
    } else {
      for (const event of operationalHistory) {
        console.log(
          `${event.timestamp}  ${event.sequence}  ${event.type}  revision ${event.stateRevision}`,
        );
      }
    }
  } else if (argument === "worktree" && arguments_[1] === "prepare") {
    const { flags, values } = parseOptions(
      arguments_.slice(2),
      [
        "--repo",
        "--run",
        "--base",
        "--base-revision",
        "--base-ref",
        "--branch",
        "--feature-branch",
        "--worktree",
        "--path",
        "--feature-worktree",
      ],
      ["--json"],
    );
    const repository = values.get("--repo");
    const requestedRunId = values.get("--run");
    const selected = await selectRun(repository, requestedRunId);
    const base =
      values.get("--base") ??
      values.get("--base-revision") ??
      values.get("--base-ref");
    const branch = values.get("--branch") ?? values.get("--feature-branch");
    const worktree =
      values.get("--worktree") ??
      values.get("--path") ??
      values.get("--feature-worktree");
    const prepared = await prepareWorktree({
      repository: selected.repository,
      runId: selected.runId,
      ...(base === undefined ? {} : { base }),
      ...(branch === undefined ? {} : { branch }),
      ...(worktree === undefined ? {} : { worktree }),
    });
    const gitState = prepared.snapshot.git;
    if (!gitState) throw new Error("Prepared run did not contain Git state");
    if (flags.has("--json")) {
      console.log(
        JSON.stringify({
          ...prepared.snapshot,
          ...(prepared.warnings === undefined
            ? {}
            : { warnings: prepared.warnings }),
        }),
      );
    } else {
      console.log(`Run: ${prepared.snapshot.runId}`);
      console.log(`Run base: ${gitState.runBase}`);
      console.log(`Feature branch: ${gitState.featureBranch}`);
      console.log(`Feature worktree: ${gitState.featureWorktree}`);
      console.log(`Phase: ${prepared.snapshot.phase}`);
      console.log(`Worktree: ${gitState.worktreeStatus}`);
      for (const warning of prepared.warnings ?? [])
        console.log(`Warning: ${warning}`);
    }
  } else if (argument === "worktree" && arguments_[1] === "validate") {
    const { flags, values } = parseOptions(
      arguments_.slice(2),
      ["--repo", "--run"],
      ["--json"],
    );
    const selected = await selectRun(values.get("--repo"), values.get("--run"));
    const report = await validateWorktree(selected);
    if (flags.has("--json")) console.log(JSON.stringify(report));
    else {
      console.log(`Run: ${report.runId}`);
      console.log(`Repository: ${report.repository}`);
      console.log(`Run base: ${report.git.runBase}`);
      console.log(`Feature branch: ${report.git.featureBranch}`);
      console.log(`Feature worktree: ${report.git.featureWorktree}`);
      for (const [name, check] of Object.entries(report.checks))
        console.log(`${name}: ${check.valid ? "valid" : "invalid"}`);
      console.log(`Result: ${report.valid ? "valid" : "invalid"}`);
    }
  } else if (argument === "worktree" && arguments_[1] === "cleanup") {
    const { flags, values } = parseOptions(
      arguments_.slice(2),
      ["--repo", "--run"],
      ["--json"],
    );
    const selected = await selectRun(values.get("--repo"), values.get("--run"));
    const cleaned = await cleanupWorktree(selected);
    if (flags.has("--json")) console.log(JSON.stringify(cleaned.snapshot));
    else {
      console.log(`Run: ${cleaned.snapshot.runId}`);
      console.log(`Feature branch: ${cleaned.snapshot.git?.featureBranch}`);
      console.log(`Feature worktree: ${cleaned.snapshot.git?.featureWorktree}`);
      console.log(`Worktree: ${cleaned.snapshot.git?.worktreeStatus}`);
      console.log(`Phase: ${cleaned.snapshot.phase}`);
    }
  } else if (argument === "checkpoint" && arguments_[1] === "validate") {
    const { flags, values } = parseOptions(
      arguments_.slice(2),
      ["--repo", "--run", "--commit"],
      ["--json"],
    );
    const commit = values.get("--commit");
    if (!commit)
      throw new FlowError(
        "Usage: flow checkpoint validate --commit <commit> [--repo <path>] [--run <id>]",
        2,
      );
    const selected = await selectRun(values.get("--repo"), values.get("--run"));
    const accepted = await validateCheckpoint({
      repository: selected.repository,
      runId: selected.runId,
      commit,
    });
    if (flags.has("--json"))
      console.log(
        JSON.stringify({
          ...accepted.snapshot,
          previousValidatedHead: accepted.previousValidatedHead,
          acceptedCommit: accepted.acceptedCommit,
        }),
      );
    else {
      console.log(`Run: ${accepted.snapshot.runId}`);
      console.log(`Previous validated HEAD: ${accepted.previousValidatedHead}`);
      console.log(`Accepted Git checkpoint: ${accepted.acceptedCommit}`);
      console.log(`Revision: ${accepted.snapshot.revision}`);
      console.log(`Phase: ${accepted.snapshot.phase}`);
    }
  } else if (
    argument === "herdr" &&
    arguments_[1] === "smoke" &&
    arguments_.includes("--help")
  ) {
    console.log(
      "Usage: flow herdr smoke --agent codex [--json] [--output <file>] [--keep-pane]",
    );
    console.log(
      "Launches Codex in a fresh Herdr sibling pane; requires a genuine managed caller and may incur normal agent usage.",
    );
    console.log(
      "--keep-pane retains only this invocation's pane for diagnostics and can never pass the complete gate.",
    );
  } else if (argument === "herdr" && arguments_[1] === "smoke") {
    const { flags, values } = parseOptions(
      arguments_.slice(2),
      ["--agent", "--output"],
      ["--json", "--keep-pane"],
    );
    const agent = values.get("--agent");
    if (agent !== "codex") {
      throw new FlowError(
        "Usage: flow herdr smoke --agent codex [--json] [--output <file>] [--keep-pane]",
        2,
      );
    }
    const outputFile = values.get("--output");
    const report = await runHerdrSmoke({
      agent,
      ...(outputFile === undefined ? {} : { outputFile }),
      ...(flags.has("--keep-pane") ? { keepPane: true } : {}),
    });
    if (flags.has("--json")) {
      console.log(JSON.stringify(report));
    } else {
      console.log(`Herdr smoke: ${report.ok ? "passed" : "failed"}`);
      console.log(`Version: ${report.version ?? "unknown"}`);
      console.log(`Working directory: ${report.requestedCwd}`);
      console.log(`Agent: ${report.owned.agentName}`);
      console.log(`Pane: ${report.owned.paneId ?? "not created"}`);
      if (report.lifecycle?.transport)
        console.log(`Lifecycle: ${report.lifecycle.transport}`);
      console.log(
        `Challenge nonce: ${report.challenge.outputContainsNonce ? "matched" : "missing"}`,
      );
      console.log(
        `Challenge cwd: ${report.challenge.outputContainsCwd ? "matched" : "missing"}`,
      );
      console.log(`Cleanup: ${report.cleanup.status}`);
      if (report.cleanup.status === "skipped")
        console.log(
          `Diagnostic: pane ${report.cleanup.paneId ?? "unknown"} was retained; this is not a complete gate pass`,
        );
      if (report.cleanup.status === "failed")
        console.log(
          `Manual recovery: close owned pane ${report.cleanup.paneId ?? "unknown"} in Herdr; no broader cleanup was attempted`,
        );
      if (report.error) console.log(`Error: ${report.error.message}`);
      if (report.reportExport)
        console.log(
          `Report export: failed for ${report.reportExport.path} (${report.reportExport.error.message})`,
        );
    }
    if (!report.ok) process.exitCode = 1;
  } else {
    const label = arguments_.length === 1 ? "argument" : "arguments";
    console.error(`Unsupported ${label}: ${arguments_.join(" ")}`);
    process.exitCode = 1;
  }
} catch (error) {
  if (error instanceof FlowError) {
    console.error(
      structuredRequest ||
        setupStructuredRequest ||
        workflowStepStructuredRequest
        ? JSON.stringify(error.toStructuredError())
        : error.message,
    );
    process.exitCode = error.exitCode;
  } else {
    throw error;
  }
}
