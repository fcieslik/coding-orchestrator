import { execFile } from "node:child_process";
import { mkdir, open, lstat, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  orchestrationConfigSchema,
  type OrchestrationConfig,
} from "./schema.js";
import { FlowError } from "./workflow-run.js";

const run = promisify(execFile);
const runtimeDirectory = ".orchestrator";
const runsDirectory = ".orchestrator/runs/";

export const defaultOrchestrationConfig = `version: 1

agents:
  codex:
    kind: codex

roles:
  worker:
    agent: codex
    skill: implement

workflow:
  workerTimeoutSeconds: 1800
  maxWorkerAttempts: 2
`;

export const orchestrationReadme = `# Orchestration contract

This directory contains the repository-local contract used by the Coding Workflow Orchestrator.

- \`.orchestrator/config.yaml\` is shared project policy. It selects the Worker role, Agent profile, downstream engineering skill, timeout, and attempt budget.
- \`.orchestrator/runs/\` contains ephemeral Workflow state and is intentionally ignored by Git.
- Workers may write only their assigned Feature worktree and their preallocated result output directory. They must not modify Workflow state or the execution record.

The version 1 default Worker uses the Codex Agent profile and the \`implement\` skill. Timeout values are limited to 60–7,200 seconds and the attempt budget is bounded. Agent process arguments are deliberately not configurable in version 1.
`;

export interface SetupOptions {
  repository?: string;
}
export interface SetupReport {
  repository: string;
  configPath: string;
  readmePath: string;
  runtimePath: string;
  ignorePath: string;
  created: string[];
  preserved: string[];
  config: OrchestrationConfig;
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function invalidConfiguration(
  path: string,
  message: string,
  details?: Record<string, unknown>,
): FlowError {
  return new FlowError(
    `Invalid orchestration configuration at ${path}: ${message}`,
    2,
    "INVALID_CONFIGURATION",
    { path, ...(details ?? {}) },
  );
}

function stripComment(value: string): string {
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if ((character === "'" || character === '"') && value[index - 1] !== "\\")
      quote = quote === character ? undefined : character;
    else if (character === "#" && quote === undefined)
      return value.slice(0, index).trimEnd();
  }
  return value.trimEnd();
}

function parseScalar(value: string, line: number): unknown {
  if (value.length === 0) return {};
  if (value.startsWith("[") || value.startsWith("{"))
    throw new Error(
      `line ${line}: sequences and inline maps are not supported`,
    );
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`line ${line}: invalid double-quoted scalar`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2)
      throw new Error(`line ${line}: invalid single-quoted scalar`);
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^[^\s:#]+$/.test(value)) return value;
  throw new Error(`line ${line}: unsupported scalar`);
}

export function parseOrchestrationYaml(contents: string): unknown {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; object: Record<string, unknown> }> = [
    { indent: -1, object: root },
  ];
  const lines = contents.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const [lineIndex, rawLine] of lines.entries()) {
    if (rawLine.includes("\t"))
      throw new Error(`line ${lineIndex + 1}: tabs are not supported`);
    const uncommented = stripComment(rawLine);
    if (uncommented.trim().length === 0) continue;
    const indent = uncommented.length - uncommented.trimStart().length;
    if (indent % 2 !== 0)
      throw new Error(
        `line ${lineIndex + 1}: indentation must use pairs of spaces`,
      );
    const content = uncommented.trim();
    if (content === "---" || content === "...") continue;
    if (content.startsWith("- ") || !content.includes(":"))
      throw new Error(`line ${lineIndex + 1}: a mapping entry is required`);
    const separator = content.indexOf(":");
    const key = content.slice(0, separator).trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key))
      throw new Error(`line ${lineIndex + 1}: invalid key ${key}`);
    const valueText = content.slice(separator + 1).trim();
    while (stack.length > 1 && indent <= stack.at(-1)!.indent) stack.pop();
    const parent = stack.at(-1)!.object;
    if (Object.hasOwn(parent, key))
      throw new Error(`line ${lineIndex + 1}: duplicate key ${key}`);
    const value = parseScalar(valueText, lineIndex + 1);
    parent[key] = value;
    if (valueText.length === 0)
      stack.push({ indent, object: value as Record<string, unknown> });
  }
  return root;
}

async function resolveRepository(repository?: string): Promise<string> {
  const requested = resolve(repository ?? process.cwd());
  try {
    const { stdout } = await run("git", [
      "-C",
      requested,
      "rev-parse",
      "--show-toplevel",
    ]);
    const root = await realpath(stdout.trim());
    const { stdout: bare } = await run("git", [
      "-C",
      root,
      "rev-parse",
      "--is-bare-repository",
    ]);
    if (bare.trim() === "true") throw new Error("bare repository");
    return root;
  } catch (error) {
    if (error instanceof FlowError) throw error;
    throw new FlowError(
      `Target repository is not a valid Git checkout: ${requested}`,
      3,
      "INVALID_REPOSITORY",
      { repository: requested },
    );
  }
}

async function assertDirectory(path: string): Promise<void> {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || !entry.isDirectory())
      throw new Error("unsafe");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw new FlowError(
      `Orchestration path is unsafe: ${path}`,
      4,
      "UNSAFE_RUNTIME_PATH",
      { path },
    );
  }
}

async function readExistingFile(path: string): Promise<string | undefined> {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error("unsafe");
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw new FlowError(
      `Orchestration path is unsafe: ${path}`,
      4,
      "UNSAFE_RUNTIME_PATH",
      { path },
    );
  }
}

function validateConfiguration(
  contents: string,
  path: string,
): OrchestrationConfig {
  let parsed: unknown;
  try {
    parsed = parseOrchestrationYaml(contents);
  } catch (error) {
    throw invalidConfiguration(
      path,
      error instanceof Error ? error.message : "invalid YAML",
    );
  }
  const result = orchestrationConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    const summary = issues
      .map((issue) => `${issue.path || "config"}: ${issue.message}`)
      .join("; ");
    throw invalidConfiguration(path, `schema validation failed (${summary})`, {
      issues,
    });
  }
  return result.data;
}

async function createExclusive(path: string, contents: string): Promise<void> {
  const handle = await open(path, "wx", 0o644);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function appendExisting(path: string, contents: string): Promise<void> {
  const handle = await open(path, "a");
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function ignoreRuleState(contents: string): "present" | "conflict" | "missing" {
  const lines = contents.split(/\r?\n/).map((line) => line.trim());
  const normalized = (line: string) =>
    line.startsWith("!")
      ? `!${line.slice(1).replace(/^\//, "")}`
      : line.replace(/^\//, "");
  if (
    lines.some(
      (line) =>
        normalized(line) === `!${runsDirectory}` ||
        normalized(line) === "!.orchestrator/",
    )
  )
    return "conflict";
  if (
    lines.some(
      (line) =>
        normalized(line) === runsDirectory ||
        normalized(line) === ".orchestrator/" ||
        normalized(line) === ".orchestrator/runs",
    )
  )
    return "present";
  return "missing";
}

export async function setupRepository(
  options: SetupOptions = {},
): Promise<SetupReport> {
  const repository = await resolveRepository(options.repository);
  const orchestrationPath = join(repository, runtimeDirectory);
  await assertDirectory(orchestrationPath);
  const runsPath = join(repository, runsDirectory);
  await assertDirectory(runsPath);

  const configPath = join(orchestrationPath, "config.yaml");
  const readmePath = join(orchestrationPath, "README.md");
  const ignorePath = join(repository, ".gitignore");
  const existingConfig = await readExistingFile(configPath);
  const existingReadme = await readExistingFile(readmePath);
  const existingIgnoreContents = await readExistingFile(ignorePath);
  const existingIgnore = existingIgnoreContents ?? "";
  const config =
    existingConfig === undefined
      ? orchestrationConfigSchema.parse(
          parseOrchestrationYaml(defaultOrchestrationConfig),
        )
      : validateConfiguration(existingConfig, configPath);
  const ignoreState = ignoreRuleState(existingIgnore);
  if (ignoreState === "conflict")
    throw new FlowError(
      `Git ignore rules conflict with required runtime rule ${runsDirectory}`,
      2,
      "INVALID_CONFIGURATION",
      { path: ignorePath, rule: runsDirectory },
    );

  await mkdir(orchestrationPath, { recursive: true });
  await mkdir(runsPath, { recursive: true });
  const created: string[] = [];
  const preserved: string[] = [];
  if (existingConfig === undefined) {
    await createExclusive(configPath, defaultOrchestrationConfig);
    created.push(".orchestrator/config.yaml");
  } else preserved.push(".orchestrator/config.yaml");
  if (existingReadme === undefined) {
    await createExclusive(readmePath, orchestrationReadme);
    created.push(".orchestrator/README.md");
  } else preserved.push(".orchestrator/README.md");
  if (ignoreState === "missing") {
    const separator =
      existingIgnore.length > 0 && !existingIgnore.endsWith("\n") ? "\n" : "";
    const addition = `${separator}${runsDirectory}\n`;
    if (existingIgnoreContents === undefined)
      await createExclusive(ignorePath, addition);
    else await appendExisting(ignorePath, addition);
    created.push(".orchestrator/runs/ ignore rule");
  } else preserved.push(".gitignore");
  return {
    repository,
    configPath,
    readmePath,
    runtimePath: runsPath,
    ignorePath,
    created,
    preserved,
    config,
  };
}

/** Read the repository-local worker contract without creating or changing it. */
export async function readOrchestrationConfig(
  repositoryPath?: string,
): Promise<{ repository: string; path: string; config: OrchestrationConfig }> {
  const repository = await resolveRepository(repositoryPath);
  const path = join(repository, runtimeDirectory, "config.yaml");
  const contents = await readExistingFile(path);
  if (contents === undefined)
    throw new FlowError(
      `Orchestration configuration was not found: ${path}. Run flow setup first.`,
      3,
      "CONFIGURATION_NOT_FOUND",
      { path },
    );
  return { repository, path, config: validateConfiguration(contents, path) };
}
