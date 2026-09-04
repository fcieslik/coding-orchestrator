import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { randomBytes } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
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
    readonly code = flowErrorCode(exitCode),
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }

  toStructuredError(): {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    if (this.details === undefined) {
      return { code: this.code, message: this.message };
    }
    return { code: this.code, message: this.message, details: this.details };
  }
}

export interface CreateRunOptions {
  repository?: string;
  specification: string;
  runId?: string;
}

export interface RunDependencies {
  clock?: () => Date;
  randomBytes?: (size: number) => Buffer;
}

function flowErrorCode(exitCode: number): string {
  switch (exitCode) {
    case 2:
      return "INVALID_ARGUMENT";
    case 3:
      return "REPOSITORY_OR_RUN_NOT_FOUND";
    case 4:
      return "CORRUPT_RUN";
    case 5:
      return "LOCK_CONTENTION";
    default:
      return "INTERNAL_ERROR";
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

async function resolveRepository(repository?: string): Promise<string> {
  const repositoryPath = repository ?? process.cwd();
  try {
    const { stdout: rootOutput } = await run("git", [
      "-C",
      repositoryPath,
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
      throw new FlowError(
        `Target repository is bare: ${repositoryPath}`,
        3,
        "INVALID_REPOSITORY",
      );
    }
    return root;
  } catch (error) {
    if (error instanceof FlowError) throw error;
    throw new FlowError(
      `Target repository is not a Git checkout: ${repositoryPath}`,
      3,
      "INVALID_REPOSITORY",
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
      "INVALID_SPECIFICATION",
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
      "INVALID_SPECIFICATION",
    );
  }
  return reference.split(sep).join("/");
}

function formatRunTimestamp(date: Date): string {
  const timestamp = date.toISOString();
  return `${timestamp.slice(0, 4)}${timestamp.slice(5, 7)}${timestamp.slice(8, 10)}T${timestamp.slice(11, 19).replaceAll(":", "")}Z`;
}

function generateRunId(timestamp: string, source: (size: number) => Buffer) {
  return `run_${formatRunTimestamp(new Date(timestamp))}_${source(6).toString("hex")}`;
}

async function readRunAt(
  repository: string,
  runId: string,
): Promise<{ snapshot: StateSnapshot; operationalHistory: RunEvent[] }> {
  const runDirectory = resolve(repository, ".orchestrator", "runs", runId);
  try {
    const directory = await stat(runDirectory);
    if (!directory.isDirectory()) {
      throw new Error("run path is not a directory");
    }
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new FlowError(
        `Workflow run was not found: ${runId}`,
        3,
        "RUN_NOT_FOUND",
      );
    }
    throw new FlowError(
      `Workflow run is corrupted or incompatible: ${runId}`,
      4,
      "CORRUPT_RUN",
      { runId },
    );
  }

  try {
    const [snapshotJson, historyJsonl] = await Promise.all([
      readFile(resolve(runDirectory, "state.json"), "utf8"),
      readFile(resolve(runDirectory, "history.jsonl"), "utf8"),
    ]);
    const snapshot = stateSnapshotSchema.parse(JSON.parse(snapshotJson));
    const operationalHistory = historyJsonl
      .trim()
      .split("\n")
      .map((line) => runEventSchema.parse(JSON.parse(line)));
    return { snapshot, operationalHistory };
  } catch {
    throw new FlowError(
      `Workflow run is corrupted or incompatible: ${runId}`,
      4,
      "CORRUPT_RUN",
      { runId },
    );
  }
}

async function createRunFiles(
  repository: string,
  runId: string,
  specificationReference: string,
  timestamp: string,
): Promise<void> {
  const snapshot = stateSnapshotSchema.parse({
    schemaVersion: 1,
    runId,
    revision: 1,
    phase: "created",
    specification: specificationReference,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const event = runEventSchema.parse({
    schemaVersion: 1,
    eventId: `event_${randomUUID()}`,
    runId,
    sequence: 1,
    stateRevision: 1,
    timestamp,
    type: "run.created",
    data: { specification: specificationReference },
  });
  const runDirectory = resolve(repository, ".orchestrator", "runs", runId);
  await writeFile(
    resolve(runDirectory, "state.json"),
    `${JSON.stringify(snapshot, null, 2)}\n`,
  );
  await writeFile(
    resolve(runDirectory, "history.jsonl"),
    `${JSON.stringify(event)}\n`,
  );
}

export async function createRun(
  options: CreateRunOptions,
  dependencies: RunDependencies = {},
): Promise<string> {
  if (
    options.runId !== undefined &&
    !runIdSchema.safeParse(options.runId).success
  ) {
    throw new FlowError(
      `Invalid run ID: ${options.runId}`,
      2,
      "INVALID_RUN_ID",
    );
  }
  const repository = await resolveRepository(options.repository);
  const specificationReference = await resolveSpecification(
    repository,
    options.specification,
  );
  const timestamp = (dependencies.clock ?? (() => new Date()))().toISOString();
  const randomSource = dependencies.randomBytes ?? randomBytes;
  const runsDirectory = resolve(repository, ".orchestrator", "runs");
  await mkdir(runsDirectory, { recursive: true });

  while (true) {
    const runId = options.runId ?? generateRunId(timestamp, randomSource);
    const runDirectory = resolve(runsDirectory, runId);
    try {
      await mkdir(runDirectory);
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
      if (options.runId !== undefined) {
        const existing = await readRunAt(repository, runId);
        if (existing.snapshot.specification === specificationReference) {
          return runId;
        }
        throw new FlowError(
          `Workflow run ${runId} already references specification ${existing.snapshot.specification}`,
          3,
          "RUN_SPECIFICATION_CONFLICT",
          {
            runId,
            existingSpecification: existing.snapshot.specification,
            requestedSpecification: specificationReference,
          },
        );
      }
      continue;
    }

    await createRunFiles(repository, runId, specificationReference, timestamp);
    return runId;
  }
}

export async function inspectRun(
  repositoryPath: string | undefined,
  runId: string,
): Promise<{ snapshot: StateSnapshot; operationalHistory: RunEvent[] }> {
  if (!runIdSchema.safeParse(runId).success) {
    throw new FlowError(`Invalid run ID: ${runId}`, 2, "INVALID_RUN_ID");
  }
  const repository = await resolveRepository(repositoryPath);
  return readRunAt(repository, runId);
}

const terminalPhases = new Set(["failed", "cancelled", "completed"]);

async function listRunIds(repository: string): Promise<string[]> {
  const runsDirectory = resolve(repository, ".orchestrator", "runs");
  try {
    const entries = await readdir(runsDirectory, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() && runIdSchema.safeParse(entry.name).success,
      )
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return [];
    throw new FlowError(
      `Unable to inspect workflow runs in ${repository}`,
      3,
      "RUNS_DIRECTORY_UNAVAILABLE",
    );
  }
}

export async function selectRun(
  repositoryPath?: string,
  requestedRunId?: string,
): Promise<{ repository: string; runId: string }> {
  if (requestedRunId !== undefined) {
    if (!runIdSchema.safeParse(requestedRunId).success) {
      throw new FlowError(
        `Invalid run ID: ${requestedRunId}`,
        2,
        "INVALID_RUN_ID",
      );
    }
    const repository = await resolveRepository(repositoryPath);
    await readRunAt(repository, requestedRunId);
    return { repository, runId: requestedRunId };
  }

  const repository = await resolveRepository(repositoryPath);
  const runIds = await listRunIds(repository);
  const runs = await Promise.all(
    runIds.map(async (runId) => ({
      runId,
      snapshot: (await readRunAt(repository, runId)).snapshot,
    })),
  );
  const activeRuns = runs.filter(
    ({ snapshot }) => !terminalPhases.has(snapshot.phase),
  );
  const candidates = activeRuns.length > 0 ? activeRuns : runs;
  if (candidates.length === 0) {
    throw new FlowError(
      "No workflow runs found. Create one with: flow run create --spec <file>",
      3,
      "RUN_NOT_FOUND",
      { repository },
    );
  }
  if (candidates.length > 1) {
    const candidateRunIds = candidates.map(({ runId }) => runId);
    throw new FlowError(
      `Multiple eligible workflow runs found: ${candidateRunIds.join(", ")}. Specify one with --run <id>.`,
      3,
      "AMBIGUOUS_RUN",
      { runIds: candidateRunIds },
    );
  }
  const selected = candidates[0];
  if (!selected)
    throw new Error("Run selection unexpectedly produced no candidate");
  return { repository, runId: selected.runId };
}
