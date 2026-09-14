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
  retryWorker,
  type WorkerExecutionReport,
} from "./worker-execution.js";
import { executeFixer, type FixerExecutionReport } from "./fixer-execution.js";
import {
  FlowError,
  createRun,
  inspectRun,
  mutateRun,
  type RunDependencies,
} from "./workflow-run.js";
import {
  runIdSchema,
  type StateSnapshot,
  type WorkerReview,
} from "./schema.js";

const terminalPhases = new Set(["failed", "cancelled", "completed"]);

interface PackageTicket {
  id: string;
  filename: string;
  source: string;
  contents: string;
  hash: string;
}

export interface ValidatedPackage {
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
  /** Explicitly create a new run instead of reusing a terminal matching run. */
  newRun?: boolean;
  /** Explicit user decision for a durable Review attention handoff. */
  resolution?: string;
}

interface WorkflowStepReportCommon {
  runId: string;
  ticketId: string;
  nextTicket?: string;
  snapshot: StateSnapshot;
  execution?: WorkerExecutionReport;
  fixer?: FixerExecutionReport;
  /** Phase 6 deterministic validation is intentionally outside this step. */
  phase6?: "not-run";
}

export type WorkflowStepReport =
  | (WorkflowStepReportCommon & {
      status: "accepted" | "noop";
      acceptedCommit: string;
    })
  | (WorkflowStepReportCommon & {
      status: "attention";
      candidateCommit: string;
      review: Extract<WorkerReview, { status: "attention" }>;
    })
  | (WorkflowStepReportCommon & {
      status: "blocked";
      candidateCommit: string;
      review: Extract<WorkerReview, { status: "attention" }>;
      fixer: FixerExecutionReport;
    });

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

/** Validate one local Workflow package (spec.md + issues/*.md) owned by the Target repository. */
export async function validatePackage(
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

function contentHash(contents: string): string {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

async function readOwnedPackageFile(
  path: string,
  label: string,
): Promise<string> {
  await assertNoSymlink(path);
  let entry;
  try {
    entry = await lstat(path);
  } catch {
    throw new FlowError(
      `Workflow run package snapshot is missing: ${label}`,
      4,
      "CORRUPT_RUN",
      { path },
    );
  }
  if (!entry.isFile())
    throw new FlowError(
      `Workflow run package snapshot is not a regular file: ${label}`,
      4,
      "CORRUPT_RUN",
      { path },
    );
  return readFile(path, "utf8");
}

/** Refuse source-package changes while an existing run still owns the work. */
export async function assertWorkflowPackageUnchanged(
  snapshot: StateSnapshot,
  packageData: ValidatedPackage,
): Promise<void> {
  const state = workflowState(snapshot);
  const captured = state.workflowPackage;
  const queue = state.tickets;
  if (!captured || !queue)
    throw new FlowError(
      `Workflow run ${state.runId} has no complete immutable package snapshot`,
      4,
      "CORRUPT_RUN",
    );

  const capturedSpecification = await readOwnedPackageFile(
    captured.specification,
    "spec.md",
  );
  const specificationChanged =
    captured.source !== packageData.source ||
    contentHash(capturedSpecification) !== packageData.specification.hash;
  const packageTicketIds = packageData.tickets.map((ticket) => ticket.id);
  const capturedTicketIds = Object.keys(queue);
  if (
    specificationChanged ||
    capturedTicketIds.length !== packageTicketIds.length ||
    capturedTicketIds.some((id, index) => id !== packageTicketIds[index])
  )
    throw new FlowError(
      "Workflow package changed after this run captured its immutable input; prepare a new package and start an explicit new run",
      3,
      "WORKFLOW_PACKAGE_CHANGED",
      { source: packageData.source },
    );

  for (const ticket of packageData.tickets) {
    const entry = queue[ticket.id];
    if (!entry)
      throw new FlowError(
        `Workflow run package snapshot is missing ticket ${ticket.id}`,
        4,
        "CORRUPT_RUN",
      );
    const capturedTicket = await readOwnedPackageFile(
      entry.input,
      `issues/${ticket.filename}`,
    );
    if (contentHash(capturedTicket) !== ticket.hash)
      throw new FlowError(
        "Workflow package changed after this run captured its immutable input; prepare a new package and start an explicit new run",
        3,
        "WORKFLOW_PACKAGE_CHANGED",
        { source: packageData.source, ticketId: ticket.id },
      );
  }
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

  if (options.newRun && state !== undefined && !terminalPhases.has(state.phase))
    throw new FlowError(
      "An unfinished Workflow run already matches this package; complete or resolve it before starting a new run",
      3,
      "WORKFLOW_RUN_EXISTS",
      { runId: state.runId },
    );
  if (options.newRun && state !== undefined) state = undefined;

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
  if (!terminalPhases.has(state.phase))
    await assertWorkflowPackageUnchanged(state, packageData);
  if (state.git?.worktreeStatus !== "ready") {
    const prepared = await prepareWorktree(
      { repository, runId: state.runId },
      options.dependencies,
    );
    state = workflowState(prepared.snapshot);
  }
  if (state === undefined)
    throw new FlowError(
      "Workflow run could not be initialized",
      4,
      "CORRUPT_RUN",
    );

  const tickets = state.tickets;
  if (!tickets)
    throw new FlowError(
      "Workflow run has no durable Ticket queue",
      4,
      "CORRUPT_RUN",
    );
  const specification = state.workflowPackage?.specification;
  if (!specification)
    throw new FlowError(
      "Workflow run has no immutable specification snapshot",
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
      ...(next === undefined ? { phase6: "not-run" as const } : {}),
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
  const resumingBlockedTicket =
    state.phase === "blocked" &&
    selected.status === "active" &&
    activeTicket === options.ticket;
  if (state.reviewAttention !== undefined) {
    if (
      state.reviewAttention.ticketId !== options.ticket ||
      selected.status !== "active"
    )
      throw new FlowError(
        `Workflow run ${state.runId} contains Review attention for ${state.reviewAttention.ticketId}; later tickets are unavailable`,
        4,
        "WORKFLOW_BLOCKED",
        { activeTicket: state.reviewAttention.ticketId },
      );
    const review = {
      status: "attention" as const,
      findings: state.reviewAttention.findings,
    };
    if (options.resolution === undefined) {
      return {
        status: "attention",
        runId: state.runId,
        ticketId: options.ticket,
        candidateCommit: state.reviewAttention.candidateCommit,
        review,
        snapshot: state,
      };
    }
    const fixer = await executeFixer({
      repository,
      runId: state.runId,
      ticketId: options.ticket,
      ticketInput: selected.input,
      specification,
      resolution: options.resolution,
      ...(options.dependencies === undefined
        ? {}
        : { dependencies: options.dependencies }),
      ...(options.adapter === undefined ? {} : { adapter: options.adapter }),
    });
    if (fixer.status !== "accepted")
      return {
        status: "blocked",
        runId: state.runId,
        ticketId: options.ticket,
        candidateCommit: state.reviewAttention.candidateCommit,
        review,
        fixer,
        snapshot: fixer.snapshot,
      };
    const fixerState = workflowState(fixer.snapshot);
    const remaining = Object.entries(fixerState.tickets ?? {}).filter(
      ([id, ticket]) => id !== options.ticket && ticket.status === "pending",
    );
    const completed = remaining.length === 0;
    const finalized = await mutateRun(
      {
        repository,
        runId: fixerState.runId,
        event: "checkpoint",
        preserveLifecycle: true,
        historyEventType: "workflow.ticket.accepted",
        data: {
          ticketId: options.ticket,
          acceptedCommit: fixer.acceptedCommit,
        },
        updateSnapshot: () => ({
          phase: completed ? "completed" : "implementing",
          reviewAttention: undefined,
          tickets: {
            ...(fixerState.tickets ?? {}),
            [options.ticket]: {
              ...selected,
              status: "accepted",
              commit: fixer.acceptedCommit,
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
      acceptedCommit: fixer.acceptedCommit!,
      snapshot: finalState,
      fixer,
      ...(next === undefined ? {} : { nextTicket: next }),
      ...(next === undefined ? { phase6: "not-run" as const } : {}),
    };
  }
  if (resumingBlockedTicket) {
    const execution = await retryWorker({
      repository,
      runId: state.runId,
      ticket: selected.input,
      ...(options.dependencies === undefined
        ? {}
        : { dependencies: options.dependencies }),
      ...(options.adapter === undefined ? {} : { adapter: options.adapter }),
    });
    if (execution.status === "attention")
      return {
        status: "attention",
        runId: state.runId,
        ticketId: options.ticket,
        candidateCommit: execution.candidateCommit,
        review: execution.review,
        snapshot: execution.snapshot,
        execution,
      };
    state = workflowState(execution.snapshot);
    const retryState = state;
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
            ...(retryState.tickets ?? {}),
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
      ...(next === undefined ? { phase6: "not-run" as const } : {}),
    };
  }
  if (selected.status === "active" && activeTicket === options.ticket)
    throw new FlowError(
      `Workflow ticket ${options.ticket} is already active; wait for the owning invocation to finish`,
      5,
      "WORKFLOW_STEP_IN_PROGRESS",
      {
        runId: state.runId,
        ticketId: options.ticket,
        ...(state.activeExecution === undefined
          ? {}
          : {
              executionId: state.activeExecution.executionId,
              attemptId: state.activeExecution.attemptId,
            }),
        requiredAction:
          "Wait for the existing Workflow step to finish; do not invoke the ticket again while it is active.",
      },
    );
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
      specification,
      ...(options.dependencies === undefined
        ? {}
        : { dependencies: options.dependencies }),
      ...(options.adapter === undefined ? {} : { adapter: options.adapter }),
    });
  } catch (error) {
    const current = await inspectRun(repository, state.runId).catch(
      () => undefined,
    );
    if (current?.snapshot.phase !== "blocked")
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
  if (execution.status === "attention")
    return {
      status: "attention",
      runId: state.runId,
      ticketId: options.ticket,
      candidateCommit: execution.candidateCommit,
      review: execution.review,
      snapshot: execution.snapshot,
      execution,
    };
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
    ...(next === undefined ? { phase6: "not-run" as const } : {}),
  };
}
