import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, expect, test } from "vitest";

import {
  normalizeAgentName,
  runHerdrSmoke,
  type HerdrCommandRunner,
} from "../src/herdr.js";

const exec = promisify(execFile);
const flow = fileURLToPath(new URL("../scripts/flow", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("agent names are deterministic and Herdr-safe", () => {
  expect(normalizeAgentName("Run/42 — Codex")).toBe("run-42-codex");
  expect(normalizeAgentName("Run/42 — Codex")).toBe(
    normalizeAgentName("Run/42 — Codex"),
  );
  expect(normalizeAgentName("Run/42 — Codex")).toMatch(
    /^[a-z][a-z0-9_-]{0,31}$/,
  );
});

test("smoke forwards the multiline prompt byte-for-byte and cleans its pane", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "herdr-smoke-"));
  temporaryDirectories.push(cwd);
  const calls: string[][] = [];
  let submittedPrompt = "";
  const runner: HerdrCommandRunner = async (_executable, args) => {
    calls.push([...args]);
    if (args[0] === "--version")
      return { stdout: "0.8.2\n", stderr: "", exitCode: 0 };
    if (args[0] === "pane" && args[1] === "split")
      return {
        stdout: JSON.stringify({ result: { pane: { pane_id: "w1:p2" } } }),
        stderr: "",
        exitCode: 0,
      };
    if (args[0] === "agent" && args[1] === "start")
      return {
        stdout: JSON.stringify({
          result: { agent: { name: args[2], pane_id: "w1:p2" } },
        }),
        stderr: "",
        exitCode: 0,
      };
    if (args[0] === "agent" && args[1] === "prompt") {
      submittedPrompt = args[3] ?? "";
      return {
        stdout: JSON.stringify({ result: { agent: { state: "done" } } }),
        stderr: "",
        exitCode: 0,
      };
    }
    if (args[0] === "agent" && args[1] === "read")
      return {
        stdout: JSON.stringify({ result: { read: { text: submittedPrompt } } }),
        stderr: "",
        exitCode: 0,
      };
    if (args[0] === "pane" && args[1] === "close")
      return { stdout: "{}", stderr: "", exitCode: 0 };
    throw new Error(`unexpected args: ${args.join(" ")}`);
  };

  const report = await runHerdrSmoke({
    agent: "codex",
    cwd,
    environment: { HERDR_ENV: "1", HERDR_PANE_ID: "caller" },
    runner,
    randomBytes: () => Buffer.from("12345678"),
  });

  expect(report.ok).toBe(true);
  expect(report.lifecycle).toEqual({ observed: "done", transport: "settled" });
  expect(report.challenge).toMatchObject({
    delivered: true,
    outputContainsNonce: true,
    outputContainsCwd: true,
  });
  expect(report.cleanup).toMatchObject({ status: "closed", paneId: "w1:p2" });
  expect(submittedPrompt).toContain("$implement");
  expect(submittedPrompt).toContain("\n");
  expect(JSON.stringify(report)).not.toContain(submittedPrompt);
  expect(calls.map((call) => call.slice(0, 2))).toEqual([
    ["--version"],
    ["pane", "split"],
    ["agent", "start"],
    ["agent", "prompt"],
    ["agent", "read"],
    ["pane", "close"],
  ]);
  expect(calls[1]).toContain("--no-focus");
  expect(calls[1]).toContain(cwd);
  expect(calls[2]).toContain("30000");
  expect(calls[3]).toContain("120000");
});

test("the public smoke command works through a fake Herdr executable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-fake-"));
  temporaryDirectories.push(directory);
  const fake = join(directory, "herdr");
  const promptFile = join(directory, "prompt.txt");
  await writeFile(
    fake,
    `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") console.log("0.8.2");
else if (args[0] === "pane" && args[1] === "split") console.log(JSON.stringify({result:{pane:{pane_id:"fake:p2"}}}));
else if (args[0] === "agent" && args[1] === "start") console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:p2",state:"idle"}}}));
else if (args[0] === "agent" && args[1] === "prompt") { writeFileSync(process.env.FAKE_PROMPT, args[3]); console.log(JSON.stringify({result:{agent:{state:"done"}}})); }
else if (args[0] === "agent" && args[1] === "read") console.log(JSON.stringify({result:{read:{text:readFileSync(process.env.FAKE_PROMPT,"utf8")}}}));
else if (args[0] === "pane" && args[1] === "close") console.log("{}");
else process.exit(2);
`,
    "utf8",
  );
  await chmod(fake, 0o755);
  const log = join(directory, "calls.log");
  const result = await exec(
    flow,
    ["herdr", "smoke", "--agent", "codex", "--json"],
    {
      cwd: directory,
      env: {
        ...process.env,
        HERDR_ENV: "1",
        HERDR_PANE_ID: "caller",
        HERDR_BIN_PATH: fake,
        FAKE_LOG: log,
        FAKE_PROMPT: promptFile,
      },
    },
  );
  const report = JSON.parse(result.stdout) as {
    ok: boolean;
    cleanup: { status: string };
  };
  expect(report.ok).toBe(true);
  expect(report.cleanup.status).toBe("closed");
  expect((await readFile(promptFile, "utf8")).includes("$implement")).toBe(
    true,
  );
  expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(6);
});

test("smoke refuses to control Herdr without caller context", async () => {
  await expect(
    runHerdrSmoke({ agent: "codex", environment: { HERDR_ENV: "1" } }),
  ).rejects.toMatchObject({ code: "HERDR_CONTEXT_REQUIRED", exitCode: 3 });
});

function smokeEnvironment() {
  return { HERDR_ENV: "1", HERDR_PANE_ID: "caller" };
}

function lifecycleRunner(
  outcome: string,
  calls: string[][],
  closeResult: { stdout: string; stderr: string; exitCode: number } = {
    stdout: "{}",
    stderr: "",
    exitCode: 0,
  },
  readResult: { stdout: string; stderr: string; exitCode: number } = {
    stdout: JSON.stringify({ result: { read: { text: "diagnostic" } } }),
    stderr: "",
    exitCode: 0,
  },
): HerdrCommandRunner {
  return async (_executable, args) => {
    calls.push([...args]);
    if (args[0] === "--version")
      return { stdout: "herdr 99.1\n", stderr: "", exitCode: 0 };
    if (args[0] === "pane" && args[1] === "split")
      return {
        stdout: JSON.stringify({ result: { pane: { pane_id: "owned:p2" } } }),
        stderr: "",
        exitCode: 0,
      };
    if (args[0] === "agent" && args[1] === "start")
      return {
        stdout: JSON.stringify({
          result: {
            agent: { name: args[2], pane_id: "owned:p2", kind: "codex" },
          },
        }),
        stderr: "",
        exitCode: 0,
      };
    if (args[0] === "agent" && args[1] === "prompt") {
      if (outcome === "timed-out")
        return { stdout: "", stderr: "wait timed out", exitCode: 124 };
      return {
        stdout: JSON.stringify({ result: { agent: { state: outcome } } }),
        stderr: "",
        exitCode: 0,
      };
    }
    if (args[0] === "agent" && args[1] === "read") return readResult;
    if (args[0] === "pane" && args[1] === "close") return closeResult;
    throw new Error(`unexpected args: ${args.join(" ")}`);
  };
}

test.each([
  ["blocked", "blocked"],
  ["unknown", "unknown"],
  ["disappeared", "disappeared"],
] as const)(
  "reports %s as a distinct failed transport outcome and only cleans the owned pane",
  async (outcome, transport) => {
    const cwd = await mkdtemp(join(tmpdir(), "herdr-outcome-"));
    temporaryDirectories.push(cwd);
    const calls: string[][] = [];
    const report = await runHerdrSmoke({
      agent: "codex",
      cwd,
      environment: smokeEnvironment(),
      runner: lifecycleRunner(outcome, calls),
      randomBytes: () => Buffer.from("outcome1"),
    });

    expect(report.ok).toBe(false);
    expect(report.version).toBe("herdr 99.1");
    expect(report.lifecycle).toMatchObject({
      observed: outcome,
      transport,
    });
    expect(report.cleanup).toMatchObject({
      status: "closed",
      paneId: "owned:p2",
    });
    expect(calls.map((call) => call.slice(0, 2))).toEqual([
      ["--version"],
      ["pane", "split"],
      ["agent", "start"],
      ["agent", "prompt"],
      ["pane", "close"],
    ]);
  },
);

test("reports timeout distinctly and honors the prompt timeout", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "herdr-timeout-"));
  temporaryDirectories.push(cwd);
  const calls: string[][] = [];
  const report = await runHerdrSmoke({
    agent: "codex",
    cwd,
    environment: smokeEnvironment(),
    runner: lifecycleRunner("timed-out", calls),
    settlementTimeoutMs: 17,
    randomBytes: () => Buffer.from("timeout1"),
  });

  expect(report.ok).toBe(false);
  expect(report.lifecycle?.transport).toBe("timed-out");
  expect(calls[3]).toContain("17");
  expect(calls.map((call) => call.slice(0, 2))).not.toContain([
    "agent",
    "read",
  ]);
});

test("refuses incomplete protocol responses without prompting and cleans once", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "herdr-protocol-"));
  temporaryDirectories.push(cwd);
  const calls: string[][] = [];
  const runner: HerdrCommandRunner = async (_executable, args) => {
    calls.push([...args]);
    if (args[0] === "--version")
      return { stdout: "0.8.2", stderr: "", exitCode: 0 };
    if (args[0] === "pane" && args[1] === "split")
      return {
        stdout: JSON.stringify({ result: { pane: { pane_id: "owned:p2" } } }),
        stderr: "",
        exitCode: 0,
      };
    if (args[0] === "agent" && args[1] === "start")
      return {
        stdout: JSON.stringify({ result: { agent: { pane_id: "owned:p2" } } }),
        stderr: "",
        exitCode: 0,
      };
    if (args[0] === "pane" && args[1] === "close")
      return { stdout: "{}", stderr: "", exitCode: 0 };
    throw new Error(`unexpected args: ${args.join(" ")}`);
  };

  const report = await runHerdrSmoke({
    agent: "codex",
    cwd,
    environment: smokeEnvironment(),
    runner,
    randomBytes: () => Buffer.from("protocol"),
  });

  expect(report.error?.operation).toBe("agent start");
  expect(report.error?.message).toContain("missing result.agent.name");
  expect(report.cleanup).toMatchObject({
    status: "closed",
    paneId: "owned:p2",
  });
  expect(calls.map((call) => call.slice(0, 2))).toEqual([
    ["--version"],
    ["pane", "split"],
    ["agent", "start"],
    ["pane", "close"],
  ]);
});

test("does not guess a pane identifier when pane creation fails", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "herdr-pane-failure-"));
  temporaryDirectories.push(cwd);
  const calls: string[][] = [];
  const runner: HerdrCommandRunner = async (_executable, args) => {
    calls.push([...args]);
    if (args[0] === "--version")
      return { stdout: "0.8.2", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "split failed", exitCode: 7 };
  };

  const report = await runHerdrSmoke({
    agent: "codex",
    cwd,
    environment: smokeEnvironment(),
    runner,
    randomBytes: () => Buffer.from("panefail"),
  });

  expect(report.error?.operation).toBe("pane split");
  expect(report.owned.paneId).toBeUndefined();
  expect(report.cleanup).toEqual({ status: "not-attempted" });
  expect(calls.map((call) => call.slice(0, 2))).toEqual([
    ["--version"],
    ["pane", "split"],
  ]);
});

test("refuses an agent-name collision and never prompts the existing agent", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "herdr-collision-"));
  temporaryDirectories.push(cwd);
  const calls: string[][] = [];
  const runner: HerdrCommandRunner = async (_executable, args) => {
    calls.push([...args]);
    if (args[0] === "--version")
      return { stdout: "0.8.2", stderr: "", exitCode: 0 };
    if (args[0] === "pane" && args[1] === "split")
      return {
        stdout: JSON.stringify({ result: { pane: { pane_id: "owned:p2" } } }),
        stderr: "",
        exitCode: 0,
      };
    if (args[0] === "agent" && args[1] === "start")
      return {
        stdout: "",
        stderr: "agent already exists",
        exitCode: 8,
      };
    if (args[0] === "pane" && args[1] === "close")
      return { stdout: "{}", stderr: "", exitCode: 0 };
    throw new Error(`unexpected args: ${args.join(" ")}`);
  };

  const report = await runHerdrSmoke({
    agent: "codex",
    cwd,
    environment: smokeEnvironment(),
    runner,
    randomBytes: () => Buffer.from("collision"),
  });

  expect(report.error).toMatchObject({
    operation: "agent start",
    message: "Herdr agent start exited with 8",
  });
  expect(report.cleanup).toMatchObject({
    status: "closed",
    paneId: "owned:p2",
  });
  expect(calls.map((call) => call.slice(0, 2))).toEqual([
    ["--version"],
    ["pane", "split"],
    ["agent", "start"],
    ["pane", "close"],
  ]);
});

test("preserves both primary and cleanup failures without retrying close", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "herdr-cleanup-"));
  temporaryDirectories.push(cwd);
  const calls: string[][] = [];
  const report = await runHerdrSmoke({
    agent: "codex",
    cwd,
    environment: smokeEnvironment(),
    runner: lifecycleRunner(
      "done",
      calls,
      { stdout: "", stderr: "pane close denied", exitCode: 9 },
      { stdout: "not json", stderr: "", exitCode: 0 },
    ),
    randomBytes: () => Buffer.from("cleanup1"),
  });

  expect(report.error?.operation).toBe("agent read");
  expect(report.error?.message).toContain("Unexpected token");
  expect(report.cleanup).toMatchObject({
    status: "failed",
    paneId: "owned:p2",
  });
  expect(report.cleanupError).toMatchObject({
    operation: "pane close",
    exitCode: 9,
  });
  expect(
    calls.filter((call) => call[0] === "pane" && call[1] === "close"),
  ).toHaveLength(1);
});
