import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  type RunEvent,
  runEventSchema,
  runIdSchema,
  type StateSnapshot,
  stateSnapshotSchema,
} from "./schema.js";

const run = promisify(execFile);
const runtimeDirectoryName = ".orchestrator";
const runsDirectoryName = "runs";
const terminalPhases = new Set(["failed", "cancelled", "completed"]);

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
    if (this.details === undefined)
      return { code: this.code, message: this.message };
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

export interface RunAudit {
  synchronized: boolean;
  warning?: string;
}

export interface ReadRunResult {
  snapshot: StateSnapshot;
  operationalHistory: RunEvent[];
  audit: RunAudit;
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

function runtimeUnsafe(path: string, reason: string): FlowError {
  return new FlowError(
    `Unsafe workflow runtime path ${path}: ${reason}`,
    4,
    "UNSAFE_RUNTIME_PATH",
    { path, reason },
  );
}

/** Reject symlinks in every existing component of a repo-local runtime path. */
async function assertNoSymlink(path: string): Promise<void> {
  const absolute = resolve(path);
  const components = absolute.split(sep).filter(Boolean);
  let current = absolute.startsWith(sep) ? sep : "";
  for (const component of components) {
    current = join(current, component);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) {
        throw runtimeUnsafe(current, "symbolic links are not permitted");
      }
    } catch (error) {
      if (error instanceof FlowError) throw error;
      if (isNodeError(error, "ENOENT")) return;
      throw error;
    }
  }
}

async function assertExistingRegularFile(path: string): Promise<void> {
  await assertNoSymlink(path);
  let entry;
  try {
    entry = await lstat(path);
  } catch (error) {
    throw runtimeUnsafe(
      path,
      isNodeError(error, "ENOENT")
        ? "path is missing"
        : "path cannot be inspected",
    );
  }
  if (!entry.isFile()) throw runtimeUnsafe(path, "a regular file is required");
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeSynchronizedFile(
  path: string,
  contents: string,
): Promise<void> {
  const directory = resolve(path, "..");
  await assertNoSymlink(directory);
  await assertNoSymlink(path);
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await syncDirectory(directory);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
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
    const repositoryEntry = await stat(root);
    if (!repositoryEntry.isDirectory())
      throw new Error("repository root is not a directory");
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
    const entry = await stat(path);
    if (!entry.isFile()) throw new Error("not a file");
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

async function gitIgnoresRuns(repository: string): Promise<boolean> {
  try {
    await run("git", [
      "-C",
      repository,
      "check-ignore",
      "--quiet",
      "--no-index",
      "--",
      ".orchestrator/runs/.probe",
    ]);
    return true;
  } catch {
    return false;
  }
}

async function bootstrapRuntime(repository: string): Promise<string> {
  const runtimeDirectory = join(repository, runtimeDirectoryName);
  const runsDirectory = join(runtimeDirectory, runsDirectoryName);
  await assertNoSymlink(runtimeDirectory);
  try {
    const runtimeEntry = await lstat(runtimeDirectory);
    if (!runtimeEntry.isDirectory())
      throw runtimeUnsafe(runtimeDirectory, "a directory is required");
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
  try {
    const runsEntry = await lstat(runsDirectory);
    if (runsEntry.isSymbolicLink() || !runsEntry.isDirectory())
      throw runtimeUnsafe(runsDirectory, "a directory is required");
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
  try {
    await mkdir(runsDirectory, { recursive: true });
  } catch (error) {
    if (isNodeError(error, "EEXIST") || isNodeError(error, "ENOTDIR")) {
      throw runtimeUnsafe(runsDirectory, "a directory is required");
    }
    throw error;
  }
  await assertNoSymlink(runtimeDirectory);
  await assertNoSymlink(runsDirectory);
  const runtimeEntry = await lstat(runtimeDirectory);
  const runsEntry = await lstat(runsDirectory);
  if (!runtimeEntry.isDirectory())
    throw runtimeUnsafe(runtimeDirectory, "a directory is required");
  if (!runsEntry.isDirectory())
    throw runtimeUnsafe(runsDirectory, "a directory is required");

  const ignoreFile = join(repository, ".gitignore");
  await assertNoSymlink(ignoreFile);
  if (!(await gitIgnoresRuns(repository))) {
    let existing = "";
    try {
      existing = await readFile(ignoreFile, "utf8");
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
    const rules = existing.split(/\r?\n/).map((line) => line.trim());
    if (
      !rules.includes(".orchestrator/runs/") &&
      !rules.includes(".orchestrator/")
    ) {
      const separator =
        existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
      await writeFile(
        ignoreFile,
        `${existing}${separator}.orchestrator/runs/\n`,
        "utf8",
      );
    }
  }
  if (!(await gitIgnoresRuns(repository))) {
    throw new FlowError(
      "Unable to prove that .orchestrator/runs is ignored by Git; refusing to create a Workflow run",
      3,
      "RUNTIME_NOT_IGNORED",
      { repository, path: ".orchestrator/runs" },
    );
  }
  return runsDirectory;
}

function formatRunTimestamp(date: Date): string {
  const timestamp = date.toISOString();
  return `${timestamp.slice(0, 4)}${timestamp.slice(5, 7)}${timestamp.slice(8, 10)}T${timestamp.slice(11, 19).replaceAll(":", "")}Z`;
}

function generateRunId(
  timestamp: string,
  source: (size: number) => Buffer,
): string {
  return `run_${formatRunTimestamp(new Date(timestamp))}_${source(6).toString("hex")}`;
}

function corruption(runId: string, reason: string): FlowError {
  return new FlowError(
    `Workflow run is corrupted or incompatible: ${runId} (${reason})`,
    4,
    "CORRUPT_RUN",
    { runId, reason },
  );
}

export function validateHistory(
  snapshot: StateSnapshot,
  history: RunEvent[],
  requestedRunId: string,
): RunAudit {
  if (snapshot.runId !== requestedRunId)
    throw corruption(
      requestedRunId,
      "snapshot run ID does not match directory",
    );
  if (history.length === 0)
    throw corruption(requestedRunId, "history is empty");
  let previousRevision = 0;
  for (const [index, event] of history.entries()) {
    if (event.runId !== requestedRunId)
      throw corruption(
        requestedRunId,
        `history event ${event.sequence} has a mismatched run ID`,
      );
    if (event.sequence !== index + 1)
      throw corruption(requestedRunId, "history sequences are not contiguous");
    if (
      event.stateRevision < 1 ||
      event.stateRevision < previousRevision ||
      event.stateRevision - previousRevision > 1
    ) {
      throw corruption(
        requestedRunId,
        `history event ${event.sequence} has an invalid state revision`,
      );
    }
    if (event.stateRevision > snapshot.revision)
      throw corruption(
        requestedRunId,
        "history is ahead of the state snapshot",
      );
    previousRevision = event.stateRevision;
  }
  if (previousRevision === snapshot.revision) return { synchronized: true };
  if (previousRevision === snapshot.revision - 1) {
    return {
      synchronized: false,
      warning: `History is one revision behind the state snapshot (history ${previousRevision}, snapshot ${snapshot.revision}); the last audit write may have been interrupted.`,
    };
  }
  throw corruption(requestedRunId, "history revision gap is larger than one");
}

async function readRunAt(
  repository: string,
  runId: string,
): Promise<ReadRunResult> {
  const runtimeDirectory = join(repository, runtimeDirectoryName);
  const runsDirectory = join(runtimeDirectory, runsDirectoryName);
  const runDirectory = join(runsDirectory, runId);
  try {
    await assertNoSymlink(runtimeDirectory);
    await assertNoSymlink(runsDirectory);
    const directory = await lstat(runDirectory);
    if (directory.isSymbolicLink() || !directory.isDirectory())
      throw new Error("run path is not a directory");
    for (const lockName of ["lock", ".lock", "run.lock", "mutation.lock"]) {
      await assertNoSymlink(join(runDirectory, lockName));
    }
    await assertExistingRegularFile(join(runDirectory, "state.json"));
    await assertExistingRegularFile(join(runDirectory, "history.jsonl"));
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new FlowError(
        `Workflow run was not found: ${runId}`,
        3,
        "RUN_NOT_FOUND",
      );
    }
    if (error instanceof FlowError && error.exitCode === 4) throw error;
    throw corruption(
      runId,
      "runtime paths are missing, redirected, or not regular files",
    );
  }

  try {
    const [snapshotJson, historyJsonl] = await Promise.all([
      readFile(join(runDirectory, "state.json"), "utf8"),
      readFile(join(runDirectory, "history.jsonl"), "utf8"),
    ]);
    const snapshot = stateSnapshotSchema.parse(JSON.parse(snapshotJson));
    if (snapshot.runId !== runId) throw new Error("snapshot run ID mismatch");
    if (historyJsonl.trim().length === 0) throw new Error("empty history");
    const lines = historyJsonl.endsWith("\n")
      ? historyJsonl.slice(0, -1).split("\n")
      : historyJsonl.split("\n");
    if (lines.some((line) => line.trim().length === 0))
      throw new Error("blank history record");
    const history = lines.map((line) => runEventSchema.parse(JSON.parse(line)));
    const audit = validateHistory(snapshot, history, runId);
    return { snapshot, operationalHistory: history, audit };
  } catch (error) {
    if (error instanceof FlowError) throw error;
    throw corruption(
      runId,
      "snapshot or history failed runtime/coherence validation",
    );
  }
}

async function createRunFiles(
  runDirectory: string,
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
  await writeSynchronizedFile(
    join(runDirectory, "state.json"),
    `${JSON.stringify(snapshot, null, 2)}\n`,
  );
  await writeSynchronizedFile(
    join(runDirectory, "history.jsonl"),
    `${JSON.stringify(event)}\n`,
  );
  await syncDirectory(runDirectory);
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
  const runsDirectory = await bootstrapRuntime(repository);

  while (true) {
    const runId = options.runId ?? generateRunId(timestamp, randomSource);
    const runDirectory = join(runsDirectory, runId);
    const stagingDirectory = join(
      runsDirectory,
      `.creating-${runId}-${randomUUID()}`,
    );
    try {
      await assertNoSymlink(runDirectory);
      await mkdir(stagingDirectory);
      await assertNoSymlink(stagingDirectory);
      await createRunFiles(
        stagingDirectory,
        runId,
        specificationReference,
        timestamp,
      );
      await rename(stagingDirectory, runDirectory);
      await syncDirectory(runsDirectory);
      return runId;
    } catch (error) {
      await rm(stagingDirectory, { force: true, recursive: true }).catch(
        () => undefined,
      );
      if (isNodeError(error, "EEXIST") || isNodeError(error, "ENOTEMPTY")) {
        if (options.runId !== undefined) {
          const existing = await readRunAt(repository, runId);
          if (existing.snapshot.specification === specificationReference)
            return runId;
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
      throw error;
    }
  }
}

export async function inspectRun(
  repositoryPath: string | undefined,
  runId: string,
): Promise<ReadRunResult> {
  if (!runIdSchema.safeParse(runId).success)
    throw new FlowError(`Invalid run ID: ${runId}`, 2, "INVALID_RUN_ID");
  const repository = await resolveRepository(repositoryPath);
  return readRunAt(repository, runId);
}

interface RunListing {
  runIds: string[];
  stagingDirectories: string[];
  unexpectedEntries: string[];
}

async function listRunIds(repository: string): Promise<RunListing> {
  const runsDirectory = join(
    repository,
    runtimeDirectoryName,
    runsDirectoryName,
  );
  try {
    await assertNoSymlink(join(repository, runtimeDirectoryName));
    await assertNoSymlink(runsDirectory);
    const entries = await readdir(runsDirectory, { withFileTypes: true });
    const stagingDirectories = entries
      .filter((entry) => entry.name.startsWith(".creating-"))
      .map((entry) => entry.name)
      .sort();
    const candidates = entries.filter(
      (entry) => !entry.name.startsWith(".creating-"),
    );
    return {
      runIds: candidates
        .filter((entry) => runIdSchema.safeParse(entry.name).success)
        .map((entry) => entry.name)
        .sort(),
      stagingDirectories,
      unexpectedEntries: candidates
        .filter((entry) => !runIdSchema.safeParse(entry.name).success)
        .map((entry) => entry.name)
        .sort(),
    };
  } catch (error) {
    if (isNodeError(error, "ENOENT"))
      return { runIds: [], stagingDirectories: [], unexpectedEntries: [] };
    if (error instanceof FlowError) throw error;
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
): Promise<{
  repository: string;
  runId: string;
  diagnostics?: { stagingDirectories: string[] };
}> {
  if (
    requestedRunId !== undefined &&
    !runIdSchema.safeParse(requestedRunId).success
  ) {
    throw new FlowError(
      `Invalid run ID: ${requestedRunId}`,
      2,
      "INVALID_RUN_ID",
    );
  }
  const repository = await resolveRepository(repositoryPath);
  if (requestedRunId !== undefined) {
    await readRunAt(repository, requestedRunId);
    return { repository, runId: requestedRunId };
  }
  const listing = await listRunIds(repository);
  if (listing.unexpectedEntries.length > 0) {
    throw corruption(
      listing.unexpectedEntries.join(", "),
      "unexpected entries were found in the runs directory",
    );
  }
  const runs = await Promise.all(
    listing.runIds.map(async (runId) => ({
      runId,
      snapshot: (await readRunAt(repository, runId)).snapshot,
    })),
  );
  const activeRuns = runs.filter(
    ({ snapshot }) => !terminalPhases.has(snapshot.phase),
  );
  const candidates = activeRuns.length > 0 ? activeRuns : runs;
  const diagnostics =
    listing.stagingDirectories.length > 0
      ? { stagingDirectories: listing.stagingDirectories }
      : undefined;
  if (candidates.length === 0) {
    const staging = diagnostics
      ? ` Interrupted creation staging directories remain: ${listing.stagingDirectories.join(", ")}.`
      : "";
    throw new FlowError(
      `No workflow runs found.${staging} Create one with: flow run create --spec <file>`,
      3,
      "RUN_NOT_FOUND",
      { repository, ...(diagnostics ?? {}) },
    );
  }
  if (candidates.length > 1) {
    const candidateRunIds = candidates.map(({ runId }) => runId);
    throw new FlowError(
      `Multiple eligible workflow runs found: ${candidateRunIds.join(", ")}. Specify one with --run <id>.`,
      3,
      "AMBIGUOUS_RUN",
      { runIds: candidateRunIds, ...(diagnostics ?? {}) },
    );
  }
  const selected = candidates[0];
  if (!selected)
    throw new Error("Run selection unexpectedly produced no candidate");
  return {
    repository,
    runId: selected.runId,
    ...(diagnostics ? { diagnostics } : {}),
  };
}
