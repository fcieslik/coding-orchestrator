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
