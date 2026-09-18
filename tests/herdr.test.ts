import { execFile } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, expect, test } from "vitest";

import {
  HerdrAdapter,
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

test("agent prompt reads the Herdr 0.8.2 agent_status field", async () => {
  const runner: HerdrCommandRunner = async () => ({
    stdout: JSON.stringify({
      result: {
        agent: {
          name: "smoke-worker",
          pane_id: "w1:p2",
          agent_status: "done",
        },
      },
    }),
    stderr: "",
    exitCode: 0,
  });
  const adapter = new HerdrAdapter({ runner });

  await expect(
    adapter.prompt(
      {
        paneId: "w1:p2",
        agentName: "smoke-worker",
        agentKind: "codex",
        cwd: "/target",
      },
      "smoke prompt",
    ),
  ).resolves.toBe("done");
});

test("agent startup observes Herdr's transient not-ready response", async () => {
  let starts = 0;
  let observations = 0;
  const runner: HerdrCommandRunner = async (_executable, args) => {
    if (args[0] === "agent" && args[1] === "start") {
      starts += 1;
      return {
        stdout: "",
        stderr:
          '{"error":{"code":"agent_not_ready","message":"agent is blocked during startup"}}',
        exitCode: 1,
      };
    }
    if (args[0] === "agent" && args[1] === "get") {
      observations += 1;
      return {
        stdout: JSON.stringify({
          result: {
            agent: {
              agent: "codex",
              name: "startup-retry",
              pane_id: "w1:p2",
              agent_status: observations === 1 ? "blocked" : "idle",
            },
          },
        }),
        stderr: "",
        exitCode: 0,
      };
    }
    throw new Error(`unexpected args: ${args.join(" ")}`);
  };
  const adapter = new HerdrAdapter({ runner });

  await expect(
    adapter.start(
      {
        paneId: "w1:p2",
        agentName: "startup-retry",
        agentKind: "codex",
        cwd: "/target",
      },
      500,
    ),
  ).resolves.toBe("idle");
  expect(starts).toBe(1);
  expect(observations).toBe(2);
});

test("agent startup observes a spawned agent after not-ready instead of starting it twice", async () => {
  let starts = 0;
  const runner: HerdrCommandRunner = async (_executable, args) => {
    if (args[0] === "agent" && args[1] === "start") {
      starts += 1;
      return {
        stdout: "",
        stderr:
          starts === 1
            ? '{"error":{"code":"agent_not_ready","message":"agent is blocked during startup"}}'
            : '{"error":{"code":"agent_name_taken","message":"agent name startup-observe is already used"}}',
        exitCode: 1,
      };
    }
    if (args[0] === "agent" && args[1] === "get")
      return {
        stdout: JSON.stringify({
          result: {
            agent: {
              agent: "codex",
              name: "startup-observe",
              pane_id: "w1:p2",
              agent_status: "idle",
            },
          },
        }),
        stderr: "",
        exitCode: 0,
      };
    throw new Error(`unexpected args: ${args.join(" ")}`);
  };
  const adapter = new HerdrAdapter({ runner });

  await expect(
    adapter.start(
      {
        paneId: "w1:p2",
        agentName: "startup-observe",
        agentKind: "codex",
        cwd: "/target",
      },
      500,
    ),
  ).resolves.toBe("idle");
  expect(starts).toBe(1);
});

test("agent startup reports a persistently blocked owned agent without restarting it", async () => {
  let starts = 0;
  const runner: HerdrCommandRunner = async (_executable, args) => {
    if (args[0] === "agent" && args[1] === "start") {
      starts += 1;
      return {
        stdout: "",
        stderr: '{"error":{"code":"agent_not_ready"}}',
        exitCode: 1,
      };
    }
    if (args[0] === "agent" && args[1] === "get")
      return {
        stdout: JSON.stringify({
          result: {
            agent: {
              agent: "codex",
              name: "startup-blocked",
              pane_id: "w1:p2",
              agent_status: "blocked",
            },
          },
        }),
        stderr: "",
        exitCode: 0,
      };
    throw new Error(`unexpected args: ${args.join(" ")}`);
  };
  const adapter = new HerdrAdapter({ runner });

  await expect(
    adapter.start(
      {
        paneId: "w1:p2",
        agentName: "startup-blocked",
        agentKind: "codex",
        cwd: "/target",
      },
      250,
    ),
  ).rejects.toMatchObject({ code: "HERDR_STARTUP_BLOCKED" });
  expect(starts).toBe(1);
});

test("agent read returns the Herdr CLI text response", async () => {
  const runner: HerdrCommandRunner = async () => ({
    stdout: "HERDR_PHASE3_SMOKE_OK\n/target\n",
    stderr: "",
    exitCode: 0,
  });
  const adapter = new HerdrAdapter({ runner });

  await expect(
    adapter.read({
      paneId: "w1:p2",
      agentName: "smoke-worker",
      agentKind: "codex",
      cwd: "/target",
    }),
  ).resolves.toBe("HERDR_PHASE3_SMOKE_OK\n/target\n");
});

test("smoke forwards the multiline prompt byte-for-byte and cleans its pane", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "herdr-smoke-"));
  temporaryDirectories.push(cwd);
  const outputFile = join(cwd, "smoke-report.json");
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
        stdout: JSON.stringify({
          result: { agent: { agent_status: "done" } },
        }),
        stderr: "",
        exitCode: 0,
      };
    }
    if (args[0] === "agent" && args[1] === "read")
      return {
        stdout: submittedPrompt,
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
    outputFile,
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
  expect(JSON.parse(await readFile(outputFile, "utf8"))).toEqual(report);
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

test("reports output-file failures without losing lifecycle evidence", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "herdr-export-failure-"));
  temporaryDirectories.push(cwd);
  const calls: string[][] = [];
  let submittedPrompt = "";
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
        stdout: JSON.stringify({
          result: { agent: { name: args[2], pane_id: "owned:p2" } },
        }),
        stderr: "",
        exitCode: 0,
      };
    if (args[0] === "agent" && args[1] === "prompt") {
      submittedPrompt = args[3] ?? "";
      return {
        stdout: JSON.stringify({
          result: { agent: { agent_status: "done" } },
        }),
        stderr: "",
        exitCode: 0,
      };
    }
    if (args[0] === "agent" && args[1] === "read")
      return {
        stdout: submittedPrompt,
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
    outputFile: cwd,
    randomBytes: () => Buffer.from("export01"),
  });

  expect(report.ok).toBe(false);
  expect(report.cleanup).toMatchObject({
    status: "closed",
    paneId: "owned:p2",
  });
  expect(report.challenge).toMatchObject({
    delivered: true,
    outputContainsNonce: true,
    outputContainsCwd: true,
  });
  expect(report.error).toMatchObject({ operation: "report export" });
  expect(report.reportExport).toMatchObject({
    status: "failed",
    path: cwd,
    error: { operation: "report export" },
  });
  expect(JSON.stringify(report)).not.toContain(submittedPrompt);
});

test("keep-pane is an explicitly non-passing diagnostic result", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "herdr-keep-pane-"));
  temporaryDirectories.push(cwd);
  const calls: string[][] = [];
  let submittedPrompt = "";
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
        stdout: JSON.stringify({
          result: { agent: { name: args[2], pane_id: "owned:p2" } },
        }),
        stderr: "",
        exitCode: 0,
      };
    if (args[0] === "agent" && args[1] === "prompt") {
      submittedPrompt = args[3] ?? "";
      return {
        stdout: JSON.stringify({
          result: { agent: { agent_status: "done" } },
        }),
        stderr: "",
        exitCode: 0,
      };
    }
    if (args[0] === "agent" && args[1] === "read")
      return {
        stdout: submittedPrompt,
        stderr: "",
        exitCode: 0,
      };
    throw new Error(`unexpected args: ${args.join(" ")}`);
  };

  const report = await runHerdrSmoke({
    agent: "codex",
    cwd,
    environment: smokeEnvironment(),
    runner,
    keepPane: true,
    randomBytes: () => Buffer.from("keep0001"),
  });

  expect(report).toMatchObject({
    ok: false,
    result: "failed",
    owned: { paneId: "owned:p2" },
    cleanup: { status: "skipped", paneId: "owned:p2" },
    error: {
      operation: "cleanup",
      message: expect.stringContaining("incomplete"),
    },
  });
  expect(calls.map((call) => call.slice(0, 2))).not.toContain([
    "pane",
    "close",
  ]);
});

test("close failure remains non-passing and identifies the owned pane", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "herdr-close-failure-"));
  temporaryDirectories.push(cwd);
  const calls: string[][] = [];
  let submittedPrompt = "";
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
        stdout: JSON.stringify({
          result: { agent: { name: args[2], pane_id: "owned:p2" } },
        }),
        stderr: "",
        exitCode: 0,
      };
    if (args[0] === "agent" && args[1] === "prompt") {
      submittedPrompt = args[3] ?? "";
      return {
        stdout: JSON.stringify({
          result: { agent: { agent_status: "done" } },
        }),
        stderr: "",
        exitCode: 0,
      };
    }
    if (args[0] === "agent" && args[1] === "read")
      return {
        stdout: submittedPrompt,
        stderr: "",
        exitCode: 0,
      };
    if (args[0] === "pane" && args[1] === "close")
      return { stdout: "", stderr: "pane close denied", exitCode: 9 };
    throw new Error(`unexpected args: ${args.join(" ")}`);
  };

  const report = await runHerdrSmoke({
    agent: "codex",
    cwd,
    environment: smokeEnvironment(),
    runner,
    randomBytes: () => Buffer.from("close001"),
  });

  expect(report.ok).toBe(false);
  expect(report.cleanup).toMatchObject({
    status: "failed",
    paneId: "owned:p2",
  });
  expect(report.cleanupError).toMatchObject({
    operation: "pane close",
    exitCode: 9,
  });
  expect(report.error?.operation).toBe("pane close");
  expect(calls.filter((call) => call[0] === "pane")).toHaveLength(2);
});

test("the public smoke command works through a fake Herdr executable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-fake-"));
  temporaryDirectories.push(directory);
  const fake = join(directory, "herdr");
  const promptFile = join(directory, "prompt.txt");
  const outputFile = join(directory, "smoke-report.json");
  await writeFile(
    fake,
    `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") console.log("0.8.2");
else if (args[0] === "pane" && args[1] === "split") console.log(JSON.stringify({result:{pane:{pane_id:"fake:p2"}}}));
else if (args[0] === "agent" && args[1] === "start") console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:p2",agent_status:"idle"}}}));
else if (args[0] === "agent" && args[1] === "prompt") { writeFileSync(process.env.FAKE_PROMPT, args[3]); console.log(JSON.stringify({result:{agent:{agent_status:"done"}}})); }
else if (args[0] === "agent" && args[1] === "read") process.stdout.write(readFileSync(process.env.FAKE_PROMPT,"utf8"));
else if (args[0] === "pane" && args[1] === "close") { if (process.env.FAKE_CLOSE_FAILURE === "1") { console.error("pane close denied"); process.exit(9); } console.log("{}"); }
else process.exit(2);
`,
    "utf8",
  );
  await chmod(fake, 0o755);
  const log = join(directory, "calls.log");
  const result = await exec(
    flow,
    ["herdr", "smoke", "--agent", "codex", "--json", "--output", outputFile],
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
  expect(result.stdout.trim().split("\n")).toHaveLength(1);
  expect(JSON.parse(await readFile(outputFile, "utf8"))).toEqual(report);
  expect((await readFile(promptFile, "utf8")).includes("$implement")).toBe(
    true,
  );
  expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(6);

  const help = await exec(flow, ["herdr", "smoke", "--help"], {
    cwd: directory,
  });
  expect(help.stdout).toContain("may incur normal agent usage");
  expect(help.stdout).toContain("diagnostics");
  expect(help.stdout).toContain("can never pass the complete gate");

  let humanKeepPane: { stdout: string; stderr: string; code?: number };
  try {
    await exec(flow, ["herdr", "smoke", "--agent", "codex", "--keep-pane"], {
      cwd: directory,
      env: {
        ...process.env,
        HERDR_ENV: "1",
        HERDR_PANE_ID: "caller",
        HERDR_BIN_PATH: fake,
        FAKE_LOG: log,
        FAKE_PROMPT: promptFile,
      },
    });
    throw new Error("expected human keep-pane smoke to be non-passing");
  } catch (error) {
    humanKeepPane = error as typeof humanKeepPane;
  }
  expect(humanKeepPane.stdout).toContain("Herdr smoke: failed");
  expect(humanKeepPane.stdout).toContain("Cleanup: skipped");
  expect(humanKeepPane.stdout).toContain("not a complete gate pass");

  let exportFailure: {
    stdout: string;
    stderr: string;
    code?: number;
  };
  try {
    await exec(
      flow,
      ["herdr", "smoke", "--agent", "codex", "--json", "--output", directory],
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
    throw new Error("expected report export to fail");
  } catch (error) {
    exportFailure = error as typeof exportFailure;
  }
  expect(exportFailure.code).toBe(1);
  expect(exportFailure.stderr).toBe("");
  expect(exportFailure.stdout.trim().split("\n")).toHaveLength(1);
  const failedReport = JSON.parse(exportFailure.stdout) as {
    ok: boolean;
    cleanup: { status: string };
    challenge: { outputContainsNonce: boolean; outputContainsCwd: boolean };
    reportExport?: { status: string };
  };
  expect(failedReport).toMatchObject({
    ok: false,
    cleanup: { status: "closed" },
    challenge: { outputContainsNonce: true, outputContainsCwd: true },
    reportExport: { status: "failed" },
  });

  let keepPane: {
    stdout: string;
    stderr: string;
    code?: number;
  };
  try {
    await exec(
      flow,
      ["herdr", "smoke", "--agent", "codex", "--json", "--keep-pane"],
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
    throw new Error("expected keep-pane smoke to be non-passing");
  } catch (error) {
    keepPane = error as typeof keepPane;
  }
  expect(keepPane.code).toBe(1);
  expect(keepPane.stderr).toBe("");
  expect(JSON.parse(keepPane.stdout)).toMatchObject({
    ok: false,
    owned: { paneId: "fake:p2" },
    cleanup: { status: "skipped", paneId: "fake:p2" },
    error: { operation: "cleanup" },
  });

  let closeFailure: {
    stdout: string;
    stderr: string;
    code?: number;
  };
  try {
    await exec(flow, ["herdr", "smoke", "--agent", "codex", "--json"], {
      cwd: directory,
      env: {
        ...process.env,
        HERDR_ENV: "1",
        HERDR_PANE_ID: "caller",
        HERDR_BIN_PATH: fake,
        FAKE_LOG: log,
        FAKE_PROMPT: promptFile,
        FAKE_CLOSE_FAILURE: "1",
      },
    });
    throw new Error("expected pane close to fail");
  } catch (error) {
    closeFailure = error as typeof closeFailure;
  }
  expect(closeFailure.code).toBe(1);
  expect(closeFailure.stderr).toBe("");
  expect(JSON.parse(closeFailure.stdout)).toMatchObject({
    ok: false,
    owned: { paneId: "fake:p2" },
    cleanup: { status: "failed", paneId: "fake:p2" },
    cleanupError: { operation: "pane close" },
  });

  let humanCloseFailure: { stdout: string; stderr: string; code?: number };
  try {
    await exec(flow, ["herdr", "smoke", "--agent", "codex"], {
      cwd: directory,
      env: {
        ...process.env,
        HERDR_ENV: "1",
        HERDR_PANE_ID: "caller",
        HERDR_BIN_PATH: fake,
        FAKE_LOG: log,
        FAKE_PROMPT: promptFile,
        FAKE_CLOSE_FAILURE: "1",
      },
    });
    throw new Error("expected human pane close to fail");
  } catch (error) {
    humanCloseFailure = error as typeof humanCloseFailure;
  }
  expect(humanCloseFailure.stdout).toContain("Cleanup: failed");
  expect(humanCloseFailure.stdout).toContain("Manual recovery");
  expect(humanCloseFailure.stdout).toContain("fake:p2");
  expect(await readdir(directory)).not.toContain(".orchestrator");
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
    stdout: "diagnostic",
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
        stdout: JSON.stringify({
          result: { agent: { agent_status: outcome } },
        }),
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
      { stdout: "", stderr: "agent read denied", exitCode: 7 },
    ),
    randomBytes: () => Buffer.from("cleanup1"),
  });

  expect(report.error?.operation).toBe("agent read");
  expect(report.error?.message).toContain("exited with 7");
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
