import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { stat, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

import { FlowError } from "./workflow-run.js";

const exec = promisify(execFile);
const defaultStartupTimeoutMs = 30_000;
const defaultSettlementTimeoutMs = 120_000;
const defaultReadTimeoutMs = 30_000;
const defaultCloseTimeoutMs = 30_000;
const maxDiagnosticBytes = 16_384;

export type HerdrLifecycleState =
  "working" | "idle" | "done" | "blocked" | "unknown";

export type HerdrTransportState =
  "settled" | "blocked" | "unknown" | "timed-out" | "disappeared";

export type HerdrObservedState =
  HerdrLifecycleState | "timed-out" | "disappeared";

export interface HerdrCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string;
}

export type HerdrCommandRunner = (
  executable: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<HerdrCommandResult>;

export interface HerdrExecutionHandle {
  paneId: string;
  agentName: string;
  agentKind: "codex";
  cwd: string;
}

export interface HerdrAdapterOptions {
  executable?: string;
  runner?: HerdrCommandRunner;
  maxDiagnosticBytes?: number;
}

export interface HerdrSmokeOptions {
  agent: "codex";
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  executable?: string;
  runner?: HerdrCommandRunner;
  startupTimeoutMs?: number;
  settlementTimeoutMs?: number;
  readTimeoutMs?: number;
  closeTimeoutMs?: number;
  keepPane?: boolean;
  outputFile?: string;
  randomBytes?: (size: number) => Buffer;
}

export interface HerdrSmokeReport {
  ok: boolean;
  result: "passed" | "failed";
  version?: string;
  requestedCwd: string;
  callerPaneId: string;
  owned: {
    paneId?: string;
    agentName: string;
    agentKind: "codex";
  };
  lifecycle?: {
    observed?: HerdrObservedState;
    transport?: HerdrTransportState;
  };
  challenge: {
    nonce: string;
    delivered: boolean;
    outputContainsNonce: boolean;
    outputContainsCwd: boolean;
  };
  cleanup: {
    status: "closed" | "skipped" | "failed" | "not-attempted";
    paneId?: string;
    error?: string;
  };
  timings: Record<string, number>;
  error?: {
    operation: string;
    message: string;
    stderr?: string;
    exitCode?: number;
    transport?: HerdrTransportState;
    arguments?: string[];
  };
  cleanupError?: HerdrSmokeReport["error"];
}

function bounded(value: string, limit: number): string {
  if (Buffer.byteLength(value, "utf8") <= limit) return value;
  const bytes = Buffer.from(value, "utf8");
  return `…${bytes.subarray(Math.max(0, bytes.length - limit + 3)).toString("utf8")}`;
}

const defaultRunner: HerdrCommandRunner = async (
  executable,
  args,
  timeoutMs,
) => {
  try {
    const result = await exec(executable, [...args], {
      timeout: timeoutMs,
      maxBuffer: maxDiagnosticBytes * 2,
      encoding: "utf8",
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: string | number;
      signal?: string;
    };
    const exitCode =
      typeof failure.code === "number"
        ? failure.code
        : failure.code === "ETIMEDOUT"
          ? 124
          : 1;
    return {
      stdout: typeof failure.stdout === "string" ? failure.stdout : "",
      stderr:
        typeof failure.stderr === "string" ? failure.stderr : failure.message,
      exitCode,
      ...(typeof failure.signal === "string" ? { signal: failure.signal } : {}),
    };
  }
};

function protocolError(operation: string, message: string): FlowError {
  return new FlowError(
    `Herdr ${operation} response is incompatible: ${message}`,
    1,
    "HERDR_PROTOCOL_ERROR",
    { operation, message },
  );
}

function invocationError(
  operation: string,
  result: HerdrCommandResult,
  args: readonly string[],
): FlowError {
  const reason =
    result.exitCode === 124 ? "timed out" : `exited with ${result.exitCode}`;
  const transport =
    result.exitCode === 124
      ? "timed-out"
      : result.exitCode === 137 ||
          result.signal === "SIGKILL" ||
          result.signal === "SIGHUP" ||
          (operation.startsWith("agent ") &&
            /(?:disappeared|no such agent|agent.+(?:gone|exited|terminated))/i.test(
              result.stderr,
            ))
        ? "disappeared"
        : undefined;
  return new FlowError(
    `Herdr ${operation} ${reason}`,
    1,
    operation === "agent start" &&
      /(?:collision|already exists|already running|in use)/i.test(result.stderr)
      ? "HERDR_AGENT_COLLISION"
      : "HERDR_INVOCATION_ERROR",
    {
      operation,
      exitCode: result.exitCode,
      stderr: bounded(result.stderr, maxDiagnosticBytes),
      ...(transport === undefined ? {} : { transport }),
      arguments: safeArguments(args),
    },
  );
}

function safeArguments(args: readonly string[]): string[] {
  return args.map((argument, index) =>
    args[0] === "agent" && args[1] === "prompt" && index === 3
      ? "<redacted-prompt>"
      : argument,
  );
}

function parseJson(operation: string, output: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(output);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("an object was required");
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw protocolError(
      operation,
      error instanceof Error ? error.message : "invalid JSON",
    );
  }
}

function nested(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function stringField(value: unknown, ...paths: string[][]): string | undefined {
  for (const path of paths) {
    const candidate = nested(value, ...path);
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return undefined;
}

function stringFieldAllowEmpty(
  value: unknown,
  ...paths: string[][]
): string | undefined {
  for (const path of paths) {
    const candidate = nested(value, ...path);
    if (typeof candidate === "string") return candidate;
  }
  return undefined;
}

function validateAgentIdentity(
  operation: string,
  response: Record<string, unknown>,
  handle: HerdrExecutionHandle,
): void {
  const returnedName = stringField(
    response,
    ["result", "agent", "name"],
    ["result", "agent", "agent_name"],
    ["agent", "name"],
  );
  const returnedPane = stringField(
    response,
    ["result", "agent", "pane_id"],
    ["result", "agent", "paneId"],
    ["agent", "pane_id"],
  );
  if (returnedName !== undefined && returnedName !== handle.agentName)
    throw protocolError(operation, "returned an unexpected agent name");
  if (returnedPane !== undefined && returnedPane !== handle.paneId)
    throw protocolError(operation, "returned an unexpected pane");
}

function lifecycleField(value: unknown): HerdrObservedState | undefined {
  const state = stringField(
    value,
    ["result", "agent", "state"],
    ["result", "agent", "status"],
    ["result", "state"],
    ["state"],
  );
  if (!state) return undefined;
  if (["working", "idle", "done", "blocked", "unknown"].includes(state))
    return state as HerdrLifecycleState;
  if (["timed-out", "timed_out", "timeout"].includes(state)) return "timed-out";
  if (["disappeared", "process-disappeared", "gone"].includes(state))
    return "disappeared";
  return undefined;
}

function transportState(state: HerdrObservedState): HerdrTransportState {
  if (state === "idle" || state === "done") return "settled";
  if (state === "blocked" || state === "unknown") return state;
  if (state === "timed-out" || state === "disappeared") return state;
  return "unknown";
}

export function normalizeAgentName(identity: string): string {
  const normalized = identity
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, 32);
  if (!normalized || !/^[a-z][a-z0-9_-]{0,31}$/.test(normalized))
    throw new FlowError(
      "Unable to derive a valid Herdr agent name",
      2,
      "INVALID_ARGUMENT",
    );
  return normalized;
}

export class HerdrAdapter {
  readonly executable: string;
  private readonly runner: HerdrCommandRunner;
  private readonly maxBytes: number;

  constructor(options: HerdrAdapterOptions = {}) {
    this.executable =
      options.executable ?? process.env.HERDR_BIN_PATH ?? "herdr";
    this.runner = options.runner ?? defaultRunner;
    this.maxBytes = options.maxDiagnosticBytes ?? maxDiagnosticBytes;
  }

  private async invoke(
    operation: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<HerdrCommandResult> {
    const result = await this.runner(this.executable, args, timeoutMs);
    if (result.exitCode !== 0) throw invocationError(operation, result, args);
    return {
      stdout: bounded(result.stdout, this.maxBytes),
      stderr: bounded(result.stderr, this.maxBytes),
      exitCode: result.exitCode,
    };
  }

  async version(timeoutMs = defaultReadTimeoutMs): Promise<string> {
    const result = await this.invoke("version", ["--version"], timeoutMs);
    const text = result.stdout.trim();
    if (!text) throw protocolError("version", "missing version");
    if (/^(?:\{|\[)/.test(text)) {
      const parsed = parseJson("version", text);
      const version = stringField(parsed, ["version"], ["result", "version"]);
      if (!version) throw protocolError("version", "missing version field");
      return version;
    }
    return text.split(/\r?\n/, 1)[0] ?? text;
  }

  async splitSibling(
    callerPaneId: string,
    cwd: string,
    timeoutMs = defaultReadTimeoutMs,
  ): Promise<string> {
    const result = await this.invoke(
      "pane split",
      [
        "pane",
        "split",
        "--pane",
        callerPaneId,
        "--direction",
        "right",
        "--cwd",
        cwd,
        "--no-focus",
      ],
      timeoutMs,
    );
    const parsed = parseJson("pane split", result.stdout);
    const paneId = stringField(
      parsed,
      ["result", "pane", "pane_id"],
      ["result", "pane", "paneId"],
      ["pane_id"],
    );
    if (!paneId)
      throw protocolError("pane split", "missing result.pane.pane_id");
    void callerPaneId;
    return paneId;
  }

  async start(
    handle: HerdrExecutionHandle,
    timeoutMs = defaultStartupTimeoutMs,
  ): Promise<HerdrObservedState | undefined> {
    const result = await this.invoke(
      "agent start",
      [
        "agent",
        "start",
        handle.agentName,
        "--kind",
        handle.agentKind,
        "--pane",
        handle.paneId,
        "--timeout",
        String(timeoutMs),
      ],
      timeoutMs,
    );
    const parsed = parseJson("agent start", result.stdout);
    const returnedName = stringField(
      parsed,
      ["result", "agent", "name"],
      ["result", "agent", "agent_name"],
    );
    const returnedPane = stringField(
      parsed,
      ["result", "agent", "pane_id"],
      ["result", "agent", "paneId"],
    );
    if (!returnedName)
      throw protocolError("agent start", "missing result.agent.name");
    if (!returnedPane)
      throw protocolError("agent start", "missing result.agent.pane_id");
    const returnedKind = stringField(
      parsed,
      ["result", "agent", "kind"],
      ["result", "agent", "agent_kind"],
    );
    if (returnedKind !== undefined && returnedKind !== handle.agentKind)
      throw protocolError("agent start", "returned an unexpected agent kind");
    if (returnedName !== handle.agentName)
      throw protocolError("agent start", "returned an unexpected agent name");
    if (returnedPane !== handle.paneId)
      throw protocolError("agent start", "returned an unexpected pane");
    return lifecycleField(parsed);
  }

  /** Create and start one owned agent without inferring either identity. */
  async launch(
    callerPaneId: string,
    cwd: string,
    agentName: string,
    agentKind: "codex" = "codex",
    startupTimeoutMs = defaultStartupTimeoutMs,
  ): Promise<HerdrExecutionHandle> {
    const paneId = await this.splitSibling(callerPaneId, cwd, startupTimeoutMs);
    const handle: HerdrExecutionHandle = { paneId, agentName, agentKind, cwd };
    try {
      await this.start(handle, startupTimeoutMs);
    } catch (error) {
      try {
        await this.close(handle);
      } catch {
        // Preserve the startup failure; callers still have the owned handle.
      }
      throw error;
    }
    return handle;
  }

  async prompt(
    handle: HerdrExecutionHandle,
    prompt: string,
    timeoutMs = defaultSettlementTimeoutMs,
  ): Promise<HerdrObservedState> {
    const result = await this.invoke(
      "agent prompt",
      [
        "agent",
        "prompt",
        handle.agentName,
        prompt,
        "--wait",
        "--timeout",
        String(timeoutMs),
      ],
      timeoutMs,
    );
    const parsed = parseJson("agent prompt", result.stdout);
    validateAgentIdentity("agent prompt", parsed, handle);
    const state = lifecycleField(parsed);
    if (!state)
      throw protocolError("agent prompt", "missing supported lifecycle state");
    return state;
  }

  async wait(
    handle: HerdrExecutionHandle,
    timeoutMs = defaultSettlementTimeoutMs,
  ): Promise<HerdrObservedState> {
    const result = await this.invoke(
      "agent wait",
      [
        "agent",
        "wait",
        handle.agentName,
        "--until",
        "idle",
        "--until",
        "done",
        "--timeout",
        String(timeoutMs),
      ],
      timeoutMs,
    );
    const parsed = parseJson("agent wait", result.stdout);
    validateAgentIdentity("agent wait", parsed, handle);
    const state = lifecycleField(parsed);
    if (!state)
      throw protocolError("agent wait", "missing supported lifecycle state");
    return state;
  }

  async read(
    handle: HerdrExecutionHandle,
    timeoutMs = defaultReadTimeoutMs,
  ): Promise<string> {
    const result = await this.invoke(
      "agent read",
      [
        "agent",
        "read",
        handle.agentName,
        "--source",
        "recent-unwrapped",
        "--lines",
        "120",
      ],
      timeoutMs,
    );
    const parsed = parseJson("agent read", result.stdout.trim());
    validateAgentIdentity("agent read", parsed, handle);
    const text = stringFieldAllowEmpty(
      parsed,
      ["result", "read", "text"],
      ["result", "text"],
      ["text"],
    );
    if (text === undefined)
      throw protocolError("agent read", "missing diagnostic text");
    return text;
  }

  async close(
    handle: HerdrExecutionHandle,
    timeoutMs = defaultCloseTimeoutMs,
  ): Promise<void> {
    await this.invoke(
      "pane close",
      ["pane", "close", handle.paneId],
      timeoutMs,
    );
  }
}

function now(): number {
  return Date.now();
}

function challengePrompt(nonce: string, cwd: string): string {
  return [
    "Herdr smoke challenge.",
    `Nonce: ${nonce}`,
    "Do not invoke the $implement skill.",
    "Reply with the nonce and your current working directory.",
    `Expected working directory: ${cwd}`,
  ].join("\n");
}

function failureDetails(
  operation: string,
  error: unknown,
): HerdrSmokeReport["error"] {
  if (error instanceof FlowError) {
    const details = error.details;
    return {
      operation,
      message: error.message,
      ...(typeof details?.stderr === "string"
        ? { stderr: details.stderr }
        : {}),
      ...(typeof details?.exitCode === "number"
        ? { exitCode: details.exitCode }
        : {}),
      ...(details?.transport === "timed-out" ||
      details?.transport === "disappeared"
        ? { transport: details.transport }
        : {}),
      ...(Array.isArray(details?.arguments)
        ? {
            arguments: details.arguments.filter(
              (value): value is string => typeof value === "string",
            ),
          }
        : {}),
    };
  }
  return {
    operation,
    message: error instanceof Error ? error.message : String(error),
  };
}

function errorTransport(error: unknown): HerdrTransportState | undefined {
  if (!(error instanceof FlowError)) return undefined;
  const transport = error.details?.transport;
  return transport === "timed-out" || transport === "disappeared"
    ? transport
    : undefined;
}

function lifecycleFailure(state: HerdrObservedState): FlowError {
  const transport = transportState(state);
  return new FlowError(
    `Herdr agent reported ${state}; settlement was not established`,
    1,
    "HERDR_LIFECYCLE_FAILED",
    { operation: "lifecycle", lifecycle: state, transport },
  );
}

export async function runHerdrSmoke(
  options: HerdrSmokeOptions,
): Promise<HerdrSmokeReport> {
  const environment = options.environment ?? process.env;
  const requestedCwd = options.cwd ?? process.cwd();
  if (!isAbsolute(requestedCwd))
    throw new FlowError("Smoke working directory must be absolute", 2);
  const cwd = resolve(requestedCwd);
  const callerPaneId =
    environment.HERDR_PANE_ID ?? environment.HERDR_ACTIVE_PANE_ID;
  if (environment.HERDR_ENV !== "1" || !callerPaneId) {
    throw new FlowError(
      "Herdr smoke requires a genuine Herdr-managed caller pane (HERDR_ENV=1 and HERDR_PANE_ID)",
      3,
      "HERDR_CONTEXT_REQUIRED",
    );
  }
  try {
    if (!(await stat(cwd)).isDirectory())
      throw new Error("path is not a directory");
  } catch (error) {
    throw new FlowError(
      `Smoke working directory is unavailable: ${cwd}`,
      3,
      "HERDR_CWD_UNAVAILABLE",
      { cwd, reason: error instanceof Error ? error.message : String(error) },
    );
  }
  const nonce = `${now().toString(36)}-${(options.randomBytes ?? randomBytes)(8).toString("hex")}`;
  const agentName = normalizeAgentName(`flow-smoke-${nonce}`);
  const adapter = new HerdrAdapter({
    ...(options.executable === undefined
      ? {}
      : { executable: options.executable }),
    ...(options.runner === undefined ? {} : { runner: options.runner }),
  });
  const report: HerdrSmokeReport = {
    ok: false,
    result: "failed",
    requestedCwd: cwd,
    callerPaneId,
    owned: { agentName, agentKind: options.agent },
    challenge: {
      nonce,
      delivered: false,
      outputContainsNonce: false,
      outputContainsCwd: false,
    },
    cleanup: { status: "not-attempted" },
    timings: {},
  };
  let handle: HerdrExecutionHandle | undefined;
  let operation = "version";
  let cleanupAttempted = false;
  const timed = async <T>(
    name: string,
    action: () => Promise<T>,
  ): Promise<T> => {
    const started = now();
    try {
      return await action();
    } finally {
      report.timings[name] = now() - started;
    }
  };
  try {
    operation = "version";
    report.version = await timed("version", () => adapter.version());
    operation = "pane split";
    const paneId = await timed("paneCreation", () =>
      adapter.splitSibling(callerPaneId, cwd),
    );
    handle = { paneId, agentName, agentKind: options.agent, cwd };
    report.owned.paneId = paneId;
    report.lifecycle = {};
    operation = "agent start";
    const startupState = await timed("agentStartup", () =>
      adapter.start(
        handle!,
        options.startupTimeoutMs ?? defaultStartupTimeoutMs,
      ),
    );
    if (startupState !== undefined) {
      report.lifecycle = {
        observed: startupState,
        transport: transportState(startupState),
      };
      if (transportState(startupState) !== "settled")
        throw lifecycleFailure(startupState);
    }
    const prompt = challengePrompt(nonce, cwd);
    operation = "agent prompt";
    const state = await timed("promptSettlement", () =>
      adapter.prompt(
        handle!,
        prompt,
        options.settlementTimeoutMs ?? defaultSettlementTimeoutMs,
      ),
    );
    report.lifecycle = { observed: state, transport: transportState(state) };
    report.challenge.delivered = true;
    if (report.lifecycle.transport !== "settled") throw lifecycleFailure(state);
    operation = "agent read";
    const output = await timed("diagnosticRead", () =>
      adapter.read(handle!, options.readTimeoutMs ?? defaultReadTimeoutMs),
    );
    report.challenge.outputContainsNonce = output.includes(nonce);
    report.challenge.outputContainsCwd = output.includes(cwd);
    if (
      !report.challenge.outputContainsNonce ||
      !report.challenge.outputContainsCwd
    )
      throw new FlowError(
        "Herdr smoke challenge evidence did not settle or match",
        1,
        "HERDR_SMOKE_FAILED",
      );
    if (options.keepPane) {
      report.cleanup = { status: "skipped", paneId };
      report.error = {
        operation: "cleanup",
        message: "Pane retention was requested; smoke evidence is incomplete",
      };
      return report;
    }
    operation = "pane close";
    cleanupAttempted = true;
    await timed("cleanup", () =>
      adapter.close(handle!, options.closeTimeoutMs ?? defaultCloseTimeoutMs),
    );
    report.cleanup = { status: "closed", paneId };
    report.ok = true;
    report.result = "passed";
    return report;
  } catch (error) {
    Object.assign(report, {
      error: failureDetails(operation, error),
    });
    const transport = errorTransport(error);
    if (transport !== undefined)
      report.lifecycle = {
        ...(report.lifecycle ?? {}),
        transport,
      };
    if (handle) {
      if (operation === "pane close") {
        const cleanupDetails = failureDetails("pane close", error);
        report.cleanup = {
          status: "failed",
          paneId: handle.paneId,
          error: cleanupDetails?.message ?? String(error),
        };
        report.cleanupError = cleanupDetails;
      }
      if (report.cleanup.status === "not-attempted")
        report.cleanup = { status: "not-attempted", paneId: handle.paneId };
      if (!options.keepPane && !cleanupAttempted) {
        try {
          await timed("cleanup", () =>
            adapter.close(
              handle!,
              options.closeTimeoutMs ?? defaultCloseTimeoutMs,
            ),
          );
          report.cleanup = { status: "closed", paneId: handle.paneId };
        } catch (cleanupError) {
          const cleanupDetails = failureDetails("pane close", cleanupError);
          report.cleanup = {
            status: "failed",
            paneId: handle.paneId,
            error: cleanupDetails?.message ?? String(cleanupError),
          };
          report.cleanupError = cleanupDetails;
        }
      } else if (options.keepPane)
        report.cleanup = { status: "skipped", paneId: handle.paneId };
    }
    return report;
  } finally {
    if (options.outputFile)
      await writeFile(
        options.outputFile,
        `${JSON.stringify(report)}\n`,
        "utf8",
      );
  }
}

export const herdrSmokeDefaults = {
  startupTimeoutMs: defaultStartupTimeoutMs,
  settlementTimeoutMs: defaultSettlementTimeoutMs,
  readTimeoutMs: defaultReadTimeoutMs,
  closeTimeoutMs: defaultCloseTimeoutMs,
};
