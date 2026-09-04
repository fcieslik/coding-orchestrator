import packageMetadata from "../package.json" with { type: "json" };

import { createRun, FlowError, inspectRun, selectRun } from "./workflow-run.js";

const arguments_ = process.argv.slice(2);
const [argument] = arguments_;
const structuredRequest =
  (argument === "status" || argument === "history") &&
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
    const { operationalHistory, snapshot } = await inspectRun(
      selected.repository,
      selected.runId,
    );
    const lastEvent = operationalHistory.at(-1);
    const operationalHistoryMetadata = {
      lastSequence: lastEvent?.sequence ?? 0,
      lastStateRevision: lastEvent?.stateRevision ?? 0,
      synchronized: lastEvent?.stateRevision === snapshot.revision,
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
      console.log(
        `History: ${operationalHistoryMetadata.synchronized ? "synchronized" : "out of sync"}`,
      );
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
