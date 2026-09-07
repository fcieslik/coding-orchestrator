import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

import { prepareWorktree } from "./git-worktree.js";
import { type HerdrAdapter } from "./herdr.js";
import { setupRepository } from "./setup.js";
import {
  executeWorker,
  type WorkerExecutionReport,
} from "./worker-execution.js";
import {
  FlowError,
  createRun,
  inspectRun,
  mutateRun,
  type RunDependencies,
} from "./workflow-run.js";
import { runIdSchema, type StateSnapshot } from "./schema.js";

const terminalPhases = new Set(["failed", "cancelled", "completed"]);

interface PackageTicket {
  id: string;
  filename: string;
  source: string;
  contents: string;
  hash: string;
}

interface ValidatedPackage {
  directory: string;
  source: string;
  specification: PackageTicket;
  tickets: PackageTicket[];
}

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

export interface WorkflowStepOptions {
  package: string;
  ticket: string;
  repository?: string;
  dependencies?: RunDependencies;
  adapter?: HerdrAdapter;
}

export interface WorkflowStepReport {
  status: "accepted" | "noop";
  runId: string;
  ticketId: string;
  acceptedCommit: string;
  nextTicket?: string;
  snapshot: StateSnapshot;
  execution?: WorkerExecutionReport;
}

function invalid(
  message: string,
  code = "INVALID_WORKFLOW_PACKAGE",
): FlowError {
  return new FlowError(message, 2, code);
}

async function assertNoSymlink(path: string): Promise<void> {
  const absolute = resolve(path);
  const components = absolute.split(sep).filter(Boolean);
  let current = absolute.startsWith(sep) ? sep : "";
  for (const component of components) {
    current = join(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw invalid(
          `Workflow package path traverses a symbolic link: ${current}`,
        );
    } catch (error) {
      if (error instanceof FlowError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function regularFile(path: string, label: string): Promise<void> {
  await assertNoSymlink(path);
  let entry;
  try {
    entry = await lstat(path);
  } catch {
    throw invalid(`${label} is missing: ${path}`);
  }
  if (!entry.isFile())
    throw invalid(`${label} must be a regular file: ${path}`);
}

function packageSource(repository: string, directory: string): string {
  const reference = relative(repository, directory);
  if (
    reference === "" ||
    reference === ".." ||
    reference.startsWith(`..${sep}`)
  )
    return ".";
  return reference.split(sep).join("/");
}

async function validatePackage(
  repository: string,
  requested: string,
): Promise<ValidatedPackage> {
  const candidate = resolve(repository, requested);
  await assertNoSymlink(candidate);
  let directory: string;
  try {
    directory = await realpath(candidate);
  } catch {
    throw invalid(`Workflow package is missing: ${requested}`);
  }
  const reference = relative(repository, directory);
  if (reference === ".." || reference.startsWith(`..${sep}`))
    throw invalid(
      "Workflow package must be inside the Target repository",
      "PACKAGE_OUTSIDE_REPOSITORY",
    );
  const directoryEntry = await lstat(directory);
  if (!directoryEntry.isDirectory())
    throw invalid("Workflow package must be a directory");

  const specificationPath = join(directory, "spec.md");
  await regularFile(specificationPath, "Workflow package specification");
  const specificationContents = await readFile(specificationPath, "utf8");
  if (specificationContents.trim().length === 0)
    throw invalid("Workflow package specification must not be empty");

  const issuesPath = join(directory, "issues");
  await assertNoSymlink(issuesPath);
  let issuesEntry;
  try {
    issuesEntry = await lstat(issuesPath);
  } catch {
    throw invalid("Workflow package issues directory is missing");
  }
  if (!issuesEntry.isDirectory())
    throw invalid("Workflow package issues must be a directory");
  const entries = (await readdir(issuesPath, { withFileTypes: true })).sort(
    (left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  if (entries.length === 0)
    throw invalid("Workflow package issues directory is empty");
  const tickets: PackageTicket[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink())
      throw invalid(
        `Workflow package ticket is a symbolic link: ${entry.name}`,
      );
    if (!entry.isFile() || !entry.name.endsWith(".md"))
      throw invalid(
        `Workflow package issues may contain only regular Markdown files: ${entry.name}`,
      );
    const id = basename(entry.name, ".md");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id))
      throw invalid(
        `Workflow package ticket filename produces an unsafe ticket ID: ${entry.name}`,
      );
    const path = join(issuesPath, entry.name);
    await regularFile(path, `Workflow package ticket ${entry.name}`);
    const contents = await readFile(path, "utf8");
    if (contents.trim().length === 0)
      throw invalid(`Workflow package ticket is empty: ${entry.name}`);
    tickets.push({
      id,
      filename: entry.name,
      source: path,
      contents,
      hash: createHash("sha256").update(contents, "utf8").digest("hex"),
    });
  }
  const specification: PackageTicket = {
    id: "spec",
    filename: "spec.md",
    source: specificationPath,
    contents: specificationContents,
    hash: createHash("sha256")
      .update(specificationContents, "utf8")
      .digest("hex"),
  };
  return {
    directory,
    source: packageSource(repository, directory),
    specification,
    tickets,
  };
}

async function copyPackage(
  repository: string,
  runId: string,
  packageData: ValidatedPackage,
): Promise<{
  snapshot: string;
  specification: string;
  tickets: Record<string, QueueEntry>;
}> {
  const root = join(
    repository,
    ".orchestrator",
    "runs",
    runId,
    "input",
    "package",
  );
  const issues = join(root, "issues");
  await mkdir(issues, { recursive: true, mode: 0o700 });
  await writeFile(join(root, "spec.md"), packageData.specification.contents, {
    mode: 0o600,
  });
  const tickets: Record<string, QueueEntry> = {};
  for (const ticket of packageData.tickets) {
    const input = join(issues, ticket.filename);
    await writeFile(input, ticket.contents, { mode: 0o600 });
    tickets[ticket.id] = { status: "pending", input };
  }
  return { snapshot: root, specification: join(root, "spec.md"), tickets };
}

function workflowState(snapshot: StateSnapshot): WorkflowSnapshot {
  return snapshot as WorkflowSnapshot;
}

async function findMatchingRun(
  repository: string,
  source: string,
): Promise<WorkflowSnapshot | undefined> {
  const runsPath = join(repository, ".orchestrator", "runs");
  let entries;
  try {
    entries = await readdir(runsPath, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const matches: WorkflowSnapshot[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !runIdSchema.safeParse(entry.name).success)
      continue;
    const run = await inspectRun(repository, entry.name);
    const state = workflowState(run.snapshot);
    if (state.workflowPackage?.source === source) matches.push(state);
  }
  const unfinished = matches.filter((run) => !terminalPhases.has(run.phase));
  if (unfinished.length > 1)
    throw new FlowError(
      "Multiple unfinished Workflow runs match this package",
      3,
      "AMBIGUOUS_WORKFLOW_RUN",
      {
        runIds: unfinished.map((run) => run.runId),
      },
    );
  return unfinished[0] ?? matches[0];
}

function nextPending(state: WorkflowSnapshot): string | undefined {
  return Object.entries(state.tickets ?? {}).find(
    ([, ticket]) => ticket.status === "pending",
  )?.[0];
}

/** Execute one explicit ticket from a validated local Workflow package. */
export async function executeWorkflowStep(
  options: WorkflowStepOptions,
): Promise<WorkflowStepReport> {
  const setup = await setupRepository(
    options.repository === undefined ? {} : { repository: options.repository },
  );
  const repository = setup.repository;
  const packageData = await validatePackage(repository, options.package);
  let state = await findMatchingRun(repository, packageData.source);

  if (state === undefined) {
    const runId = await createRun({
      repository,
      specification: packageData.specification.source,
    });
    const copied = await copyPackage(repository, runId, packageData);
    const initialized = await mutateRun(
      {
        repository,
        runId,
        event: "checkpoint",
        preserveLifecycle: true,
        historyEventType: "workflow.package.captured",
        data: {
          package: packageData.source,
          tickets: packageData.tickets.map((ticket) => ticket.id),
        },
        updateSnapshot: () => ({
          workflowPackage: {
            source: packageData.source,
            snapshot: copied.snapshot,
            specification: copied.specification,
          },
          tickets: copied.tickets,
        }),
      },
      options.dependencies,
    );
    state = workflowState(initialized.snapshot);
  }
  if (state.git?.worktreeStatus !== "ready") {
    const prepared = await prepareWorktree(
      { repository, runId: state.runId },
      options.dependencies,
    );
    state = workflowState(prepared.snapshot);
  }

  const tickets = state.tickets;
  if (!tickets)
    throw new FlowError(
      "Workflow run has no durable Ticket queue",
      4,
      "CORRUPT_RUN",
    );
  const selected = tickets[options.ticket];
  if (!selected)
    throw invalid(
      `Unknown exact ticket ID: ${options.ticket}`,
      "UNKNOWN_TICKET",
    );
  if (selected.status === "accepted") {
    const next = nextPending(state);
    return {
      status: "noop",
      runId: state.runId,
      ticketId: options.ticket,
      acceptedCommit: selected.commit!,
      snapshot: state,
      ...(next === undefined ? {} : { nextTicket: next }),
    };
  }
  const activeTicket = Object.entries(tickets).find(
    ([, ticket]) => ticket.status === "active",
  )?.[0];
  if (activeTicket !== undefined && activeTicket !== options.ticket)
    throw new FlowError(
      `Workflow ticket ${activeTicket} is unresolved; later tickets are unavailable`,
      4,
      "WORKFLOW_BLOCKED",
      { activeTicket },
    );
  const expected = nextPending(state);
  if (expected !== options.ticket)
    throw new FlowError(
      `Ticket ${options.ticket} is not the first pending ticket; expected ${expected ?? "none"}`,
      2,
      "TICKET_NOT_NEXT",
      {
        expectedTicket: expected,
        requestedTicket: options.ticket,
      },
    );

  const active = await mutateRun(
    {
      repository,
      runId: state.runId,
      event: "checkpoint",
      preserveLifecycle: true,
      historyEventType: "workflow.ticket.started",
      data: { ticketId: options.ticket },
      updateSnapshot: () => ({
        tickets: {
          ...tickets,
          [options.ticket]: { ...selected, status: "active" },
        },
      }),
    },
    options.dependencies,
  );
  state = workflowState(active.snapshot);
  let execution: WorkerExecutionReport;
  try {
    execution = await executeWorker({
      repository,
      runId: state.runId,
      ticket: selected.input,
      ...(options.dependencies === undefined
        ? {}
        : { dependencies: options.dependencies }),
      ...(options.adapter === undefined ? {} : { adapter: options.adapter }),
    });
  } catch (error) {
    await mutateRun(
      {
        repository,
        runId: state.runId,
        event: "block",
        historyEventType: "workflow.ticket.blocked",
        data: { ticketId: options.ticket },
        updateSnapshot: () => ({
          tickets: {
            ...(state.tickets ?? {}),
            [options.ticket]: { ...selected, status: "active" },
          },
        }),
      },
      options.dependencies,
    ).catch(() => undefined);
    throw error;
  }
  const remaining = Object.entries(state.tickets ?? {}).filter(
    ([id, ticket]) => id !== options.ticket && ticket.status === "pending",
  );
  const completed = remaining.length === 0;
  const finalized = await mutateRun(
    {
      repository,
      runId: state.runId,
      event: "checkpoint",
      preserveLifecycle: true,
      historyEventType: "workflow.ticket.accepted",
      data: {
        ticketId: options.ticket,
        acceptedCommit: execution.acceptedCommit,
      },
      updateSnapshot: () => ({
        phase: completed ? "completed" : "implementing",
        tickets: {
          ...(state.tickets ?? {}),
          [options.ticket]: {
            ...selected,
            status: "accepted",
            commit: execution.acceptedCommit,
          },
        },
      }),
    },
    options.dependencies,
  );
  const finalState = workflowState(finalized.snapshot);
  const next = nextPending(finalState);
  return {
    status: "accepted",
    runId: state.runId,
    ticketId: options.ticket,
    acceptedCommit: execution.acceptedCommit,
    snapshot: finalState,
    execution,
    ...(next === undefined ? {} : { nextTicket: next }),
  };
}
