import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  type RunEvent,
  runEventSchema,
  runIdSchema,
  type StateSnapshot,
  stateSnapshotSchema,
} from "./schema.js";

const run = promisify(execFile);

export class FlowError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
  }
}

export interface CreateRunOptions {
  repository: string;
  specification: string;
  runId: string;
}

async function resolveRepository(repository: string): Promise<string> {
  try {
    const { stdout: rootOutput } = await run("git", [
      "-C",
      repository,
      "rev-parse",
      "--show-toplevel",
    ]);
    const root = await realpath(rootOutput.trim());
    const { stdout: bareOutput } = await run("git", [
      "-C",
      root,
      "rev-parse",
      "--is-bare-repository",
    ]);
    if (bareOutput.trim() === "true") {
      throw new FlowError(`Target repository is bare: ${repository}`, 3);
    }
    return root;
  } catch (error) {
    if (error instanceof FlowError) throw error;
    throw new FlowError(
      `Target repository is not a Git checkout: ${repository}`,
      3,
    );
  }
}

async function resolveSpecification(
  repository: string,
  specification: string,
): Promise<string> {
  const candidate = isAbsolute(specification)
    ? specification
    : resolve(repository, specification);
  let path: string;
  try {
    path = await realpath(candidate);
    if (!(await stat(path)).isFile()) throw new Error("not a file");
  } catch {
    throw new FlowError(
      `Specification is missing or not a regular file: ${specification}`,
      3,
    );
  }

  const reference = relative(repository, path);
  if (
    reference === ".." ||
    reference.startsWith(`..${sep}`) ||
    isAbsolute(reference)
  ) {
    throw new FlowError(
      `Specification is outside the Target repository: ${specification}`,
      3,
    );
  }
  return reference.split(sep).join("/");
}

export async function createRun(options: CreateRunOptions): Promise<string> {
  if (!runIdSchema.safeParse(options.runId).success) {
    throw new FlowError(`Invalid run ID: ${options.runId}`, 2);
  }
  const repository = await resolveRepository(options.repository);
  const specificationReference = await resolveSpecification(
    repository,
    options.specification,
  );
  const timestamp = new Date().toISOString();
  const snapshot = stateSnapshotSchema.parse({
    schemaVersion: 1,
    runId: options.runId,
    revision: 1,
    phase: "created",
    specification: specificationReference,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const event = runEventSchema.parse({
    schemaVersion: 1,
    eventId: `event_${randomUUID()}`,
    runId: options.runId,
    sequence: 1,
    stateRevision: 1,
    timestamp,
    type: "run.created",
    data: { specification: specificationReference },
  });
  const runDirectory = resolve(
    repository,
    ".orchestrator",
    "runs",
    options.runId,
  );
  await mkdir(runDirectory, { recursive: true });
  await writeFile(
    resolve(runDirectory, "state.json"),
    `${JSON.stringify(snapshot, null, 2)}\n`,
  );
  await writeFile(
    resolve(runDirectory, "history.jsonl"),
    `${JSON.stringify(event)}\n`,
  );
  return options.runId;
}

export async function inspectRun(
  repositoryPath: string,
  runId: string,
): Promise<{ snapshot: StateSnapshot; operationalHistory: RunEvent[] }> {
  if (!runIdSchema.safeParse(runId).success) {
    throw new FlowError(`Invalid run ID: ${runId}`, 2);
  }
  const repository = await resolveRepository(repositoryPath);
  const runDirectory = resolve(repository, ".orchestrator", "runs", runId);
  try {
    const [snapshotJson, historyJsonl] = await Promise.all([
      readFile(resolve(runDirectory, "state.json"), "utf8"),
      readFile(resolve(runDirectory, "history.jsonl"), "utf8"),
    ]);
    return {
      snapshot: stateSnapshotSchema.parse(JSON.parse(snapshotJson)),
      operationalHistory: historyJsonl
        .trim()
        .split("\n")
        .map((line) => runEventSchema.parse(JSON.parse(line))),
    };
  } catch {
    throw new FlowError(`Workflow run was not found: ${runId}`, 3);
  }
}
