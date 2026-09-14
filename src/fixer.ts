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
import { codexWorkerArguments, quotePromptPath } from "./worker.js";

export interface LogicalFixerExecution {
  role: "fixer";
  agentProfile: string;
  agentKind: "codex";
  runId: string;
  ticketId: string;
  briefPath: string;
  worktree: string;
  candidateCommit: string;
  resultPath: string;
  commitRequired: boolean;
}

export interface RenderedFixerPrompt {
  prompt: string;
  promptHash: string;
}

export interface LaunchFixerOptions extends LogicalFixerExecution {
  callerPaneId: string;
  agentName: string;
  adapter?: HerdrAdapter;
  outputDirectory?: string;
  executable?: string;
  runner?: HerdrCommandRunner;
  startupTimeoutMs?: number;
  settlementTimeoutMs?: number;
  onLaunched?: (handle: HerdrExecutionHandle) => void | Promise<void>;
}

export interface LaunchedFixer {
  handle: HerdrExecutionHandle;
  rendered: RenderedFixerPrompt;
  startupState?: HerdrObservedState;
}

const fixerSafeguardsAssetPath = fileURLToPath(
  new URL("../assets/prompts/fixer-safeguards.md", import.meta.url),
);

function invalid(message: string): FlowError {
  return new FlowError(message, 2, "INVALID_ARGUMENT");
}

function path(value: string, label: string): void {
  if (!isAbsolute(value) || value.includes("\0") || /[\r\n]/.test(value))
    throw invalid(
      `${label} must be an absolute path without control characters`,
    );
}

function safeguards(): string {
  try {
    const value = readFileSync(fixerSafeguardsAssetPath, "utf8");
    if (!value.trim()) throw new Error("the file is empty");
    return value;
  } catch (error) {
    throw new FlowError(
      `Fixer safeguards policy is missing or unreadable at ${fixerSafeguardsAssetPath}; reinstall the Orchestrator skill (${error instanceof Error ? error.message : String(error)})`,
      4,
      "RUNTIME_ASSET_UNAVAILABLE",
      { path: fixerSafeguardsAssetPath },
    );
  }
}

export function renderFixerPrompt(
  execution: LogicalFixerExecution,
): RenderedFixerPrompt {
  if (execution.role !== "fixer") throw invalid("role must be fixer");
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(execution.agentProfile))
    throw invalid("agentProfile must be a lowercase workflow identifier");
  if (!runIdSchema.safeParse(execution.runId).success)
    throw invalid("runId must be a valid Workflow run identifier");
  if (!execution.ticketId || execution.ticketId.includes("/"))
    throw invalid("ticketId must be a single path component");
  path(execution.briefPath, "briefPath");
  path(execution.worktree, "worktree");
  path(execution.resultPath, "resultPath");
  if (!/^[0-9a-f]{40,64}$/.test(execution.candidateCommit))
    throw invalid("candidateCommit must be a full commit identifier");
  const result = (value: string) =>
    JSON.stringify(
      value === "completed"
        ? {
            schemaVersion: 1,
            ticketId: execution.ticketId,
            status: value,
            commit: "<full correction commit SHA>",
            summary: "<concise summary>",
          }
        : value === "blocked"
          ? {
              schemaVersion: 1,
              ticketId: execution.ticketId,
              status: value,
              summary: "<concise summary>",
              blocker: {
                type: "<type>",
                requiredDecision: "<smallest required decision>",
              },
            }
          : {
              schemaVersion: 1,
              ticketId: execution.ticketId,
              status: value,
              summary: "<concise summary>",
              diagnostics: { message: "<failure message>" },
            },
    );
  const prompt = [
    "You are a bounded Fixer execution.",
    "",
    "Orchestration contract:",
    "",
    `- Run: ${execution.runId}`,
    `- Ticket: ${execution.ticketId}`,
    `- Candidate commit to preserve in ancestry: ${execution.candidateCommit}`,
    `- Fix brief: ${quotePromptPath(execution.briefPath)}`,
    `- Worktree: ${quotePromptPath(execution.worktree)}`,
    `- Write the structured result to: ${quotePromptPath(execution.resultPath)}`,
    `- Commit required: ${execution.commitRequired}`,
    "- Read the Fix brief and apply only its explicit resolution within the original ticket scope.",
    "- Do not reopen, prompt, or rely on the original Worker context.",
    "- Preserve the candidate commit and create at least one separate correction commit.",
    `- Completed result: ${result("completed")}`,
    `- Blocked result: ${result("blocked")}`,
    `- Failed result: ${result("failed")}`,
    "- Publish exactly one result atomically through a temporary file in the output directory, then rename it to the result path.",
    "- If the resolution expands scope or is unsafe, write blocked and stop without guessing.",
    "",
    "Fixer safeguards:",
    "",
    safeguards(),
  ].join("\n");
  return {
    prompt,
    promptHash: createHash("sha256").update(prompt, "utf8").digest("hex"),
  };
}

export async function launchSkillAwareFixer(
  options: LaunchFixerOptions,
): Promise<LaunchedFixer> {
  const rendered = renderFixerPrompt(options);
  const outputDirectory = resolve(
    options.outputDirectory ?? dirname(options.resultPath),
  );
  const resultRelative = relative(outputDirectory, resolve(options.resultPath));
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
    options.worktree,
    options.agentName,
    "codex",
    options.startupTimeoutMs,
    validateChildAgentArguments(
      codexWorkerArguments(options.worktree, outputDirectory),
    ),
  );
  await options.onLaunched?.(handle);
  const startupState = await adapter.prompt(
    handle,
    rendered.prompt,
    options.settlementTimeoutMs,
  );
  return { handle, rendered, startupState };
}
