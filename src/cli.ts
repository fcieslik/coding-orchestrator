import packageMetadata from "../package.json" with { type: "json" };

import {
  cleanupWorktree,
  prepareWorktree,
  validateCheckpoint,
  validateWorktree,
} from "./git-worktree.js";
import { runHerdrSmoke } from "./herdr.js";
import { setupRepository } from "./setup.js";
import { executeWorker, reconcileWorker } from "./worker-execution.js";
import { createRun, FlowError, inspectRun, selectRun } from "./workflow-run.js";

const arguments_ = process.argv.slice(2);
const [argument] = arguments_;
const structuredRequest =
  ((argument === "status" ||
    argument === "history" ||
    (argument === "worktree" &&
      (arguments_[1] === "prepare" ||
        arguments_[1] === "validate" ||
        arguments_[1] === "cleanup")) ||
    (argument === "checkpoint" && arguments_[1] === "validate")) &&
    arguments_.includes("--json")) ||
  (argument === "herdr" &&
    arguments_[1] === "smoke" &&
    arguments_.includes("--json")) ||
  (argument === "worker" &&
    (arguments_[1] === "execute" || arguments_[1] === "reconcile") &&
    arguments_.includes("--json"));
const setupStructuredRequest =
  argument === "setup" && arguments_.includes("--json");

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
    }
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
      if (report.reason) console.log(`Reason: ${report.reason}`);
    }
    if (report.exitCode !== 0) process.exitCode = report.exitCode;
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
      structuredRequest || setupStructuredRequest
        ? JSON.stringify(error.toStructuredError())
        : error.message,
    );
    process.exitCode = error.exitCode;
  } else {
    throw error;
  }
}
