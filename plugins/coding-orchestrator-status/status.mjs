import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = process.env.HERDR_PLUGIN_ROOT
  ? resolve(process.env.HERDR_PLUGIN_ROOT)
  : dirname(fileURLToPath(import.meta.url));
const defaultFlowPath = resolve(pluginRoot, "../../scripts/flow");
const flowPath = process.env.ORCHESTRATOR_FLOW_PATH ?? defaultFlowPath;
const refreshIntervalMs = boundedInteger(
  process.env.CODING_ORCHESTRATOR_REFRESH_MS,
  1_000,
  1,
  60_000,
);
const metadataTtlMs = boundedInteger(
  process.env.CODING_ORCHESTRATOR_METADATA_TTL_MS,
  3_500,
  Math.max(refreshIntervalMs + 1, 1),
  86_400_000,
);
const metadataSource = "coding-orchestrator-status";
const maxDisplayText = 300;
const once = process.argv.includes("--once");

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
    return fallback;
  return parsed;
}

function cleanText(value, limit = maxDisplayText) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function contextObject() {
  const raw = process.env.HERDR_PLUGIN_CONTEXT_JSON;
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

function stringValue(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function contextWorkspace(context) {
  return record(context?.workspace);
}

function contextWorkspaceId(context) {
  return (
    stringValue(process.env.HERDR_WORKSPACE_ID) ??
    stringValue(context?.workspace_id) ??
    stringValue(contextWorkspace(context)?.workspace_id) ??
    stringValue(contextWorkspace(context)?.id)
  );
}

function pathCandidate(value) {
  const candidate = stringValue(value);
  if (!candidate || candidate.includes("\n")) return undefined;
  return candidate;
}

function contextRepository(context) {
  const workspace = contextWorkspace(context);
  const focusedPane = record(context?.focused_pane) ?? record(context?.pane);
  const worktree = record(context?.worktree);
  const explicitPaths = [
    workspace?.repository,
    workspace?.repository_path,
    workspace?.repo,
    workspace?.repo_path,
    worktree?.repository,
    worktree?.repository_path,
    context?.repository,
    context?.repository_path,
    context?.workspace_repository,
    context?.workspace_repository_path,
  ]
    .map(pathCandidate)
    .filter((value) => value !== undefined);
  const uniqueExplicitPaths = [...new Set(explicitPaths)];
  if (uniqueExplicitPaths.length > 1) return undefined;
  if (uniqueExplicitPaths.length === 1) return uniqueExplicitPaths[0];

  const workspacePaths = [
    workspace?.cwd,
    workspace?.path,
    workspace?.root,
    context?.workspace_cwd,
    context?.workspace_path,
    context?.workspace_root,
  ]
    .map(pathCandidate)
    .filter((value) => value !== undefined);
  const uniqueWorkspacePaths = [...new Set(workspacePaths)];
  if (uniqueWorkspacePaths.length > 1) return undefined;
  if (uniqueWorkspacePaths.length === 1) return uniqueWorkspacePaths[0];

  const worktreePaths = [worktree?.cwd, worktree?.path, worktree?.root]
    .map(pathCandidate)
    .filter((value) => value !== undefined);
  const uniqueWorktreePaths = [...new Set(worktreePaths)];
  if (uniqueWorktreePaths.length > 1) return undefined;
  if (uniqueWorktreePaths.length === 1) return uniqueWorktreePaths[0];

  const panePaths = [
    focusedPane?.cwd,
    focusedPane?.path,
    context?.focused_pane_cwd,
    context?.focused_pane_path,
  ]
    .map(pathCandidate)
    .filter((value) => value !== undefined);
  const uniquePanePaths = [...new Set(panePaths)];
  return uniquePanePaths.length === 1 ? uniquePanePaths[0] : undefined;
}

function flowExecutableAvailable() {
  return access(flowPath).then(
    () => true,
    () => false,
  );
}

function runCommand(command, arguments_, options = {}) {
  return new Promise((resolveResult) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) =>
      resolveResult({ error, stdout, stderr, exitCode: undefined }),
    );
    child.on("close", (exitCode, signal) =>
      resolveResult({ stdout, stderr, exitCode, signal }),
    );
  });
}

function structuredError(result) {
  const lines = result.stderr.trim().split(/\r?\n/).filter(Boolean);
  for (const line of lines.reverse()) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object") return value;
    } catch {
      // The public CLI may be unavailable and emit ordinary process text.
    }
  }
  return undefined;
}

async function readStatus() {
  const context = contextObject();
  // Herdr 0.8.2 does not inject HERDR_PLUGIN_CONTEXT_JSON into plugin panes.
  // The pane cwd is the explicit Target context supplied when opening the pane.
  const repository = context
    ? contextRepository(context)
    : pathCandidate(process.cwd());
  const workspaceId = contextWorkspaceId(context);
  if (!repository) {
    return {
      kind: "error",
      code: "INVALID_CONTEXT",
      message: "Herdr context does not identify one Target repository.",
      repository,
      workspaceId,
    };
  }
  if (!(await flowExecutableAvailable())) {
    return {
      kind: "error",
      code: "SKILL_UNAVAILABLE",
      message:
        "The Installed Orchestrator skill is unavailable. Configure ORCHESTRATOR_FLOW_PATH.",
      repository,
      workspaceId,
    };
  }

  const result = await runCommand(
    flowPath,
    ["status", "--repo", repository, "--json"],
    {
      cwd: repository,
    },
  );
  if (result.error) {
    return {
      kind: "error",
      code: "STATUS_UNAVAILABLE",
      message: `The public status command could not be started: ${cleanText(result.error.message)}`,
      repository,
      workspaceId,
    };
  }
  if (result.exitCode !== 0) {
    const error = structuredError(result);
    const code = stringValue(error?.code) ?? "STATUS_UNAVAILABLE";
    const message = cleanText(error?.message ?? result.stderr);
    return {
      kind: "error",
      code,
      message: message || "The public status command failed.",
      repository,
      workspaceId,
    };
  }
  try {
    const value = JSON.parse(result.stdout);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("not an object");
    return { kind: "status", snapshot: value, repository, workspaceId };
  } catch {
    return {
      kind: "error",
      code: "INVALID_STATUS",
      message: "The public status command returned invalid structured data.",
      repository,
      workspaceId,
    };
  }
}

function tickets(snapshot) {
  return Object.entries(record(snapshot.tickets) ?? {}).map(([id, value]) => ({
    id,
    status: stringValue(record(value)?.status) ?? "pending",
  }));
}

function activeTicket(snapshot, entries) {
  const activeExecution = record(snapshot.activeExecution);
  return (
    stringValue(activeExecution?.ticketId) ??
    entries.find((ticket) => ticket.status === "active")?.id
  );
}

function nextTicket(snapshot, entries) {
  if (activeTicket(snapshot, entries)) return undefined;
  return entries.find((ticket) => ticket.status === "pending")?.id;
}

function packageName(snapshot) {
  const packageData = record(snapshot.workflowPackage);
  return cleanText(
    packageData?.source ??
      packageData?.snapshot ??
      snapshot.specification ??
      "unavailable",
    120,
  );
}

function summary(snapshot) {
  const entries = tickets(snapshot);
  const accepted = entries.filter(
    (ticket) => ticket.status === "accepted",
  ).length;
  const current = activeTicket(snapshot, entries);
  const next = nextTicket(snapshot, entries);
  const review = record(snapshot.reviewAttention);
  const lastExecution = record(snapshot.lastExecution);
  return {
    package: packageName(snapshot),
    ticket: cleanText(current ?? next ?? (entries.length ? "none" : "-"), 80),
    step: cleanText(
      review?.status === "attention"
        ? "review attention"
        : current
          ? `working: ${current}`
          : next
            ? `next: ${next}`
            : (snapshot.phase ?? "unknown"),
      80,
    ),
    progress: `${accepted}/${entries.length}`,
    entries,
    accepted,
    current,
    next,
    review,
    lastExecution,
  };
}

function statusLabel(value, fallback) {
  return cleanText(value ?? fallback, 160);
}

function renderError(view) {
  const labels = {
    INVALID_CONTEXT: "Context unavailable",
    SKILL_UNAVAILABLE: "Orchestrator unavailable",
    RUN_NOT_FOUND: "No workflow run",
    AMBIGUOUS_RUN: "Run selection is ambiguous",
    INVALID_REPOSITORY: "Target repository is invalid",
    STATUS_UNAVAILABLE: "Status unavailable",
    INVALID_STATUS: "Status unavailable",
  };
  return [
    "Coding Workflow Status",
    "=======================",
    `State: ${labels[view.code] ?? "Read-only status unavailable"}`,
    `Reason: ${cleanText(view.message)}`,
    view.repository ? `Target: ${cleanText(view.repository, 180)}` : undefined,
    "",
    "Read-only panel: no workflow operation is available.",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function ticketMarker(status) {
  if (status === "accepted") return "[x]";
  if (status === "active") return "[>]";
  return "[ ]";
}

function renderStatus(snapshot) {
  const data = summary(snapshot);
  const reviewAttention = data.review?.status === "attention";
  const validation = record(snapshot.validation);
  const delivery = record(snapshot.delivery);
  const lastExecution = data.lastExecution;
  const lines = [
    "Coding Workflow Status",
    "=======================",
    `Package: ${data.package}`,
    `Run: ${cleanText(snapshot.runId, 100)}`,
    `Phase: ${cleanText(snapshot.phase ?? "unknown", 80)}`,
    `Progress: ${data.accepted}/${data.entries.length} tickets accepted`,
    `Current/next: ${cleanText(data.current ?? data.next ?? "none", 100)}`,
    "",
    "Tickets:",
    ...data.entries.map(
      (ticket) =>
        `  ${ticketMarker(ticket.status)} ${cleanText(ticket.id, 100)} (${ticket.status})`,
    ),
    data.entries.length === 0 ? "  [ ] no tickets captured" : undefined,
    "",
    `Validation: ${validation ? `${statusLabel(validation.status, "unknown")} — ${statusLabel(validation.result, "no result")}` : "not run"}`,
    `Delivery: ${delivery ? `${statusLabel(delivery.channel, "unknown")} / ${statusLabel(delivery.status, "unknown")}${delivery.reason ? ` — ${statusLabel(delivery.reason)}` : ""}` : "not recorded"}`,
    reviewAttention
      ? `Review attention: ${cleanText(data.review.ticketId, 100)} requires a decision.`
      : undefined,
    reviewAttention
      ? `  Finding: ${cleanText(record(data.review.findings?.[0])?.summary ?? "see the bounded review finding", 220)}`
      : undefined,
    snapshot.phase === "blocked" && lastExecution?.failureReason
      ? `Technical failure: ${cleanText(lastExecution.failureReason, 220)}`
      : undefined,
    snapshot.phase === "blocked" && lastExecution?.path
      ? `Diagnostic: ${cleanText(lastExecution.path, 220)}`
      : undefined,
    "",
    "Read-only panel. Press q or Esc to close.",
  ];
  return lines.filter((line) => line !== undefined).join("\n");
}

function render(view) {
  const body =
    view.kind === "status" ? renderStatus(view.snapshot) : renderError(view);
  process.stdout.write(process.stdout.isTTY ? "\u001b[2J\u001b[H" : "");
  process.stdout.write(`${body}\n`);
}

function metadataValues(view) {
  if (view.kind !== "status") {
    const unavailable = view.code === "RUN_NOT_FOUND" ? "none" : "unavailable";
    return {
      package: unavailable,
      ticket: "-",
      step: "unavailable",
      progress: "-",
    };
  }
  const data = summary(view.snapshot);
  return {
    package: data.package,
    ticket: data.ticket,
    step: data.step,
    progress: data.progress,
  };
}

async function reportMetadata(view, sequence) {
  const workspaceId = view.workspaceId;
  const herdr = process.env.HERDR_BIN_PATH ?? "herdr";
  if (!workspaceId) return;
  const values = metadataValues(view);
  const arguments_ = [
    "workspace",
    "report-metadata",
    workspaceId,
    "--source",
    metadataSource,
    "--seq",
    String(sequence),
    "--ttl-ms",
    String(metadataTtlMs),
  ];
  for (const [name, value] of Object.entries(values))
    arguments_.push("--token", `${name}=${cleanText(value, 80)}`);
  await runCommand(herdr, arguments_);
}

let stopping = false;
let refreshInFlight = false;
let sequence = 0;
let timer;

async function refresh() {
  if (stopping || refreshInFlight) return;
  refreshInFlight = true;
  try {
    const view = await readStatus();
    sequence += 1;
    render(view);
    await reportMetadata(view, sequence);
    if (once) stop();
  } finally {
    refreshInFlight = false;
    if (stopping) process.exit(0);
  }
}

function stop() {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.removeListener("data", onInput);
  process.stdin.pause();
  if (!refreshInFlight) process.exit(0);
}

function onInput(chunk) {
  const input = String(chunk);
  if (input.includes("q") || input.includes("Q") || input.includes("\u001b"))
    stop();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.stdin.on("data", onInput);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();

await refresh();
if (!once && !stopping)
  timer = setInterval(() => void refresh(), refreshIntervalMs);
