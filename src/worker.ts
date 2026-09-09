import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HerdrAdapter,
  type HerdrCommandRunner,
  type HerdrExecutionHandle,
  type HerdrObservedState,
  validateChildAgentArguments,
} from "./herdr.js";
import { runIdSchema } from "./schema.js";
import { FlowError } from "./workflow-run.js";

export type WorkerAgentKind = "codex" | "claude-code" | "pi";

export interface LogicalWorkerExecution {
  role: "worker";
  agentProfile: string;
  agentKind: WorkerAgentKind;
  skill: string;
  input: string;
  specification?: string;
  runId: string;
  ticketId: string;
  worktree: string;
  resultPath: string;
  commitRequired: boolean;
}

export interface RenderedWorkerPrompt {
  prompt: string;
  promptHash: string;
  skillInvocation: string;
}

export interface LaunchWorkerOptions extends Omit<
  LogicalWorkerExecution,
  "agentKind"
> {
  agentKind?: WorkerAgentKind;
  callerPaneId: string;
  agentName: string;
  adapter?: HerdrAdapter;
  outputDirectory?: string;
  executable?: string;
  runner?: HerdrCommandRunner;
  startupTimeoutMs?: number;
  settlementTimeoutMs?: number;
  /** Called immediately after Herdr creates the owned pane, before prompt delivery. */
  onLaunched?: (handle: HerdrExecutionHandle) => void | Promise<void>;
}

export interface LaunchedWorker {
  handle: HerdrExecutionHandle;
  rendered: RenderedWorkerPrompt;
  startupState?: HerdrObservedState;
}

const identifierPattern = /^[a-z][a-z0-9_-]{0,63}$/;
const ticketPattern = /^[^/\\]+$/;
const workerSafeguardsAssetPath = fileURLToPath(
  new URL("../assets/prompts/worker-safeguards.md", import.meta.url),
);

function invalid(
  message: string,
  details?: Record<string, unknown>,
): FlowError {
  return new FlowError(message, 2, "INVALID_ARGUMENT", details);
}

function validateIdentifier(value: string, label: string): string {
  if (!identifierPattern.test(value))
    throw invalid(`${label} must be a lowercase workflow identifier`, {
      [label]: value,
    });
  return value;
}

function validatePath(value: string, label: string): string {
  if (!isAbsolute(value) || value.includes("\0") || /[\r\n]/.test(value))
    throw invalid(
      `${label} must be an absolute path without control characters`,
      {
        [label]: value,
      },
    );
  return value;
}

/** Return a JSON string literal suitable for human-readable prompt text. */
export function quotePromptPath(path: string): string {
  validatePath(path, "path");
  return JSON.stringify(path);
}

export function validateLogicalWorkerExecution(
  execution: LogicalWorkerExecution,
): LogicalWorkerExecution {
  if (execution.role !== "worker") throw invalid("role must be worker");
  validateIdentifier(execution.agentProfile, "agentProfile");
  if (!isSupportedAgentKind(execution.agentKind))
    throw invalid(`unsupported agent kind: ${execution.agentKind}`);
  validateIdentifier(execution.skill, "skill");
  if (execution.skill !== "implement")
    throw invalid("Phase 4 worker skill must be implement");
  if (!runIdSchema.safeParse(execution.runId).success)
    throw invalid("runId must be a valid Workflow run identifier", {
      runId: execution.runId,
    });
  if (!execution.ticketId || !ticketPattern.test(execution.ticketId))
    throw invalid("ticketId must be a single path component");
  validatePath(execution.input, "input");
  if (execution.specification !== undefined)
    validatePath(execution.specification, "specification");
  validatePath(execution.worktree, "worktree");
  validatePath(execution.resultPath, "resultPath");
  if (typeof execution.commitRequired !== "boolean")
    throw invalid("commitRequired must be boolean");
  return execution;
}

function isSupportedAgentKind(value: string): value is WorkerAgentKind {
  return value === "codex" || value === "claude-code" || value === "pi";
}

export function renderSkillInvocation(
  skill: string,
  input: string,
  agentKind: WorkerAgentKind,
): string {
  validateIdentifier(skill, "skill");
  validatePath(input, "input");
  if (!isSupportedAgentKind(agentKind))
    throw invalid(`unsupported agent kind: ${agentKind}`);
  const prefix = agentKind === "codex" ? "$" : "/";
  return `${prefix}${skill} ${quotePromptPath(input)}`;
}

function readWorkerSafeguards(): string {
  try {
    const safeguards = readFileSync(workerSafeguardsAssetPath, "utf8");
    if (safeguards.trim().length === 0) throw new Error("the file is empty");
    return safeguards;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new FlowError(
      `Worker safeguards policy is missing or unreadable at ${workerSafeguardsAssetPath}; reinstall the Orchestrator skill (${reason})`,
      4,
      "RUNTIME_ASSET_UNAVAILABLE",
      { path: workerSafeguardsAssetPath },
    );
  }
}

export function renderWorkerPrompt(
  execution: LogicalWorkerExecution,
): RenderedWorkerPrompt {
  const checked = validateLogicalWorkerExecution(execution);
  const safeguards = readWorkerSafeguards();
  const skillInvocation = renderSkillInvocation(
    checked.skill,
    checked.input,
    checked.agentKind,
  );
  const completedResult = JSON.stringify({
    schemaVersion: 1,
    ticketId: checked.ticketId,
    status: "completed",
    commit: "<full commit SHA>",
    summary: "<concise summary>",
    commands: [
      { command: "git status --short", status: "passed", exitCode: 0 },
    ],
  });
  const blockedResult = JSON.stringify({
    schemaVersion: 1,
    ticketId: checked.ticketId,
    status: "blocked",
    summary: "<concise summary>",
    blocker: {
      type: "<type>",
      requiredDecision: "<smallest required decision>",
    },
  });
  const failedResult = JSON.stringify({
    schemaVersion: 1,
    ticketId: checked.ticketId,
    status: "failed",
    summary: "<concise summary>",
    diagnostics: { message: "<failure message>" },
  });
  const prompt = [
    `${skillInvocation}`,
    "",
    "Orchestration contract:",
    "",
    `- Run: ${checked.runId}`,
    `- Ticket: ${checked.ticketId}`,
    ...(checked.specification === undefined
      ? []
      : [
          `- Specification: ${quotePromptPath(checked.specification)}`,
          "- Use the specification as read-only context and common constraints; the assigned ticket remains the only implementation scope.",
        ]),
    `- Worktree: ${quotePromptPath(checked.worktree)}`,
    `- Write the structured execution result to: ${quotePromptPath(checked.resultPath)}`,
    `- Commit required: ${checked.commitRequired}`,
    "- Implement only the assigned ticket and work only in the provided worktree.",
    "- The assigned ticket input is immutable; do not modify it.",
    "- Global Orchestrator workflow state is read-only.",
    "- Write exactly one JSON object using the camelCase fields in one of the following shapes; do not use snake_case aliases.",
    `- Completed: ${completedResult}`,
    `- Blocked: ${blockedResult}`,
    `- Failed: ${failedResult}`,
    "- Publish the result atomically by writing a temporary file in the output directory, then renaming it to the result path.",
    "- On a product, architecture, security, destructive-operation, credential, or human-decision blocker, do not guess. Write a blocked result with the smallest required decision, then stop.",
    "- On technical failure, write a failed result with relevant diagnostics, then stop.",
    "",
    "Worker safeguards (canonical policy):",
    "",
    safeguards,
  ].join("\n");
  return {
    prompt,
    promptHash: createHash("sha256").update(prompt, "utf8").digest("hex"),
    skillInvocation,
  };
}

export const renderWorker = renderWorkerPrompt;

/** Fixed Codex policy for a Phase 4 worker; repository config cannot override it. */
export function codexWorkerArguments(
  worktree: string,
  outputDirectory: string,
): string[] {
  validatePath(worktree, "worktree");
  validatePath(outputDirectory, "outputDirectory");
  return validateChildAgentArguments([
    "-C",
    worktree,
    "--add-dir",
    outputDirectory,
    "--approve-for-me",
  ]);
}

/** Render and launch one fresh Codex worker through the opaque Herdr boundary. */
export async function launchSkillAwareWorker(
  options: LaunchWorkerOptions,
): Promise<LaunchedWorker> {
  const execution: LogicalWorkerExecution = {
    role: options.role,
    agentProfile: options.agentProfile,
    agentKind: options.agentKind ?? "codex",
    skill: options.skill,
    input: options.input,
    ...(options.specification === undefined
      ? {}
      : { specification: options.specification }),
    runId: options.runId,
    ticketId: options.ticketId,
    worktree: options.worktree,
    resultPath: options.resultPath,
    commitRequired: options.commitRequired,
  };
  const checked = validateLogicalWorkerExecution(execution);
  if (checked.agentKind !== "codex")
    throw invalid("live Phase 4 workers support only the codex Agent profile");
  if (checked.agentProfile !== "codex")
    throw invalid(
      "live Phase 4 workers require the configured codex Agent profile",
    );
  if (!options.callerPaneId || !options.agentName)
    throw invalid("callerPaneId and agentName are required");
  const rendered = renderWorkerPrompt(checked);
  const outputDirectory = resolve(
    options.outputDirectory ?? dirname(checked.resultPath),
  );
  const resultRelative = relative(outputDirectory, resolve(checked.resultPath));
  if (
    !resultRelative ||
    resultRelative === ".." ||
    resultRelative.startsWith(`..${sep}`) ||
    isAbsolute(resultRelative)
  )
    throw invalid("resultPath must be inside outputDirectory");
  const adapter =
    options.adapter ??
    new HerdrAdapter({
      ...(options.executable === undefined
        ? {}
        : { executable: options.executable }),
      ...(options.runner === undefined ? {} : { runner: options.runner }),
    });
  const handle = await adapter.launch(
    options.callerPaneId,
    checked.worktree,
    options.agentName,
    "codex",
    options.startupTimeoutMs,
    codexWorkerArguments(checked.worktree, outputDirectory),
  );
  await options.onLaunched?.(handle);
  const startupState = await adapter.prompt(
    handle,
    rendered.prompt,
    options.settlementTimeoutMs,
  );
  return {
    handle,
    rendered,
    ...(startupState === undefined ? {} : { startupState }),
  };
}

export const renderLogicalWorker = renderWorkerPrompt;
export const buildWorkerPrompt = renderWorkerPrompt;
export const createCodexLaunchArguments = codexWorkerArguments;
export const launchWorker = launchSkillAwareWorker;
