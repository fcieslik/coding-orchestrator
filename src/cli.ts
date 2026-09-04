import packageMetadata from "../package.json" with { type: "json" };

import { prepareWorktree } from "./git-worktree.js";
import { createRun, FlowError, inspectRun, selectRun } from "./workflow-run.js";

const arguments_ = process.argv.slice(2);
const [argument] = arguments_;
const structuredRequest =
  (argument === "status" ||
    argument === "history" ||
    (argument === "worktree" && arguments_[1] === "prepare")) &&
  arguments_.includes("--json");

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
  } else {
    const label = arguments_.length === 1 ? "argument" : "arguments";
    console.error(`Unsupported ${label}: ${arguments_.join(" ")}`);
    process.exitCode = 1;
  }
} catch (error) {
  if (error instanceof FlowError) {
    console.error(
      structuredRequest
        ? JSON.stringify(error.toStructuredError())
        : error.message,
    );
    process.exitCode = error.exitCode;
  } else {
    throw error;
  }
}
