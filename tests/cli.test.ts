import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, expect, test } from "vitest";

import {
  cleanupWorktree,
  inspectCheckpoint,
  prepareWorktree,
} from "../src/git-worktree.js";
import {
  acquireRunLock,
  FlowError,
  inspectRun,
  mutateRun,
  releaseRunLock,
} from "../src/workflow-run.js";

const run = promisify(execFile);
const executable = fileURLToPath(new URL("../scripts/flow", import.meta.url));
const outsideInstallationRoot = fileURLToPath(new URL(".", import.meta.url));
const temporaryDirectories: string[] = [];

async function createTargetRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "flow-target-"));
  temporaryDirectories.push(repository);
  await run("git", ["init", "--quiet", repository]);
  await mkdir(join(repository, "specs"));
  await writeFile(join(repository, "specs", "feature.md"), "# Feature\n");
  return repository;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("flow displays usage when invoked without arguments", async () => {
  const { stderr, stdout } = await run(executable, [], {
    cwd: outsideInstallationRoot,
  });

  expect(stdout).toContain("Usage: flow");
  expect(stderr).toBe("");
});

test("flow --help displays usage", async () => {
  const { stderr, stdout } = await run(executable, ["--help"], {
    cwd: outsideInstallationRoot,
  });

  expect(stdout).toContain("Usage: flow");
  expect(stderr).toBe("");
});

test("flow orchestrate rejects an invalid Workflow package before creating a run", async () => {
  const repository = await createCommittedTargetRepository();
  const packageDirectory = join(repository, "feature");
  await mkdir(packageDirectory);
  await writeFile(join(packageDirectory, "spec.md"), "# Feature\n");
  await mkdir(join(packageDirectory, "issues"));

  await expect(
    run(
      executable,
      ["orchestrate", "feature", "01-first", "--repo", repository, "--json"],
      { cwd: repository },
    ),
  ).rejects.toMatchObject({
    code: 2,
    stdout: "",
    stderr: expect.stringContaining("INVALID_WORKFLOW_PACKAGE"),
  });
  const runs = await readdir(join(repository, ".orchestrator", "runs"));
  expect(runs).toEqual([]);
});

test("flow orchestrate executes the first package ticket through a fake Worker", async () => {
  const repository = await createCommittedTargetRepository();
  const packageDirectory = join(repository, "feature");
  await mkdir(join(packageDirectory, "issues"), { recursive: true });
  await writeFile(join(packageDirectory, "spec.md"), "# Feature\n");
  await writeFile(
    join(packageDirectory, "issues", "01-first.md"),
    "# First ticket\n\nImplement the first slice.\n",
  );
  const fakeDirectory = await temporaryDirectory();
  const fake = join(fakeDirectory, "herdr");
  const state = join(fakeDirectory, "state.json");
  await writeFile(
    fake,
    `#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") console.log("fake-herdr 1.0.0");
else if (args[0] === "pane" && args[1] === "split") console.log(JSON.stringify({result:{pane:{pane_id:"fake:worker"}}}));
else if (args[0] === "agent" && args[1] === "start") {
  const child = args.slice(args.indexOf("--") + 1);
  const worktree = child[child.indexOf("-C") + 1];
  writeFileSync(process.env.FAKE_STATE, JSON.stringify({worktree}));
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:worker",agent_status:"idle"}}}));
} else if (args[0] === "agent" && args[1] === "prompt") {
  const current = JSON.parse(readFileSync(process.env.FAKE_STATE, "utf8"));
  const prompt = args[3];
  const ticket = prompt.match(/- Ticket: ([^\\n]+)/)[1];
  const resultPath = prompt.match(/Write the structured execution result to: "([^"]+)"/)[1];
  writeFileSync(current.worktree + "/first-change.txt", "done\\n");
  execFileSync("git", ["-C", current.worktree, "add", "first-change.txt"]);
  execFileSync("git", ["-C", current.worktree, "commit", "--quiet", "-m", "first ticket"]);
  const commit = execFileSync("git", ["-C", current.worktree, "rev-parse", "HEAD"], {encoding:"utf8"}).trim();
  writeFileSync(resultPath + ".tmp", JSON.stringify({schemaVersion:1,ticketId:ticket,status:"completed",summary:"done",commit,commands:[]}));
  renameSync(resultPath + ".tmp", resultPath);
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:worker",agent_status:"done"}}}));
} else if (args[0] === "agent" && args[1] === "read") process.stdout.write("done\\n");
else if (args[0] === "pane" && args[1] === "close") console.log("{}");
else process.exit(2);
`,
    "utf8",
  );
  await chmod(fake, 0o755);

  const { stdout } = await run(
    executable,
    ["orchestrate", "feature", "01-first", "--repo", repository, "--json"],
    {
      cwd: repository,
      env: {
        ...process.env,
        HERDR_ENV: "1",
        HERDR_PANE_ID: "caller",
        HERDR_BIN_PATH: fake,
        FAKE_STATE: state,
      },
    },
  );
  const report = JSON.parse(stdout);
  expect(report).toMatchObject({
    status: "accepted",
    ticketId: "01-first",
    snapshot: {
      phase: "completed",
      tickets: { "01-first": { status: "accepted" } },
    },
  });
  expect(report.acceptedCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(await gitOutput(repository, ["rev-parse", "HEAD"])).not.toBe(
    report.acceptedCommit,
  );
});

test("flow orchestrate persists Worker Review attention without accepting or advancing the queue", async () => {
  const repository = await createCommittedTargetRepository();
  await writeWorkflowPackage(repository, ["01-review", "02-later"]);
  const fakeDirectory = await temporaryDirectory();
  const fake = join(fakeDirectory, "herdr");
  const state = join(fakeDirectory, "state.json");
  const launches = join(fakeDirectory, "launches.log");
  const closes = join(fakeDirectory, "closes.log");
  await writeFile(
    fake,
    `#!/usr/bin/env node
import { appendFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const args = process.argv.slice(2);
if (args[0] === "--version") console.log("fake-herdr 1.0.0");
else if (args[0] === "pane" && args[1] === "split") console.log(JSON.stringify({result:{pane:{pane_id:"fake:worker"}}}));
else if (args[0] === "agent" && args[1] === "start") {
  const child = args.slice(args.indexOf("--") + 1);
  writeFileSync(process.env.FAKE_STATE, JSON.stringify({worktree: child[child.indexOf("-C") + 1]}));
  appendFileSync(process.env.FAKE_LAUNCHES, args[2] + "\\n");
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:worker",agent_status:"idle"}}}));
} else if (args[0] === "agent" && args[1] === "prompt") {
  const current = JSON.parse(readFileSync(process.env.FAKE_STATE, "utf8"));
  const prompt = args[3];
  const ticket = prompt.match(/- Ticket: ([^\\n]+)/)[1];
  const resultPath = prompt.match(/Write the structured execution result to: "([^"]+)"/)[1];
  writeFileSync(current.worktree + "/candidate.txt", "candidate\\n");
  execFileSync("git", ["-C", current.worktree, "add", "candidate.txt"]);
  execFileSync("git", ["-C", current.worktree, "commit", "--quiet", "-m", "candidate implementation"]);
  const commit = execFileSync("git", ["-C", current.worktree, "rev-parse", "HEAD"], {encoding:"utf8"}).trim();
  writeFileSync(resultPath + ".tmp", JSON.stringify({schemaVersion:1,ticketId:ticket,status:"completed",summary:"Implementation exists; review decision required.",commit,commands:[],review:{status:"attention",findings:[{axis:"spec",summary:"The empty-state behavior is unspecified.",evidence:"candidate.txt",requiredDecision:"Choose the empty-state behavior for this ticket."}]}}));
  renameSync(resultPath + ".tmp", resultPath);
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:worker",agent_status:"done"}}}));
} else if (args[0] === "agent" && args[1] === "read") process.stdout.write("candidate worker done\\n");
else if (args[0] === "pane" && args[1] === "close") { appendFileSync(process.env.FAKE_CLOSES, "fake:worker\\n"); console.log("{}"); }
else process.exit(2);
`,
    "utf8",
  );
  await chmod(fake, 0o755);
  const environment = {
    ...process.env,
    HERDR_ENV: "1",
    HERDR_PANE_ID: "caller",
    HERDR_BIN_PATH: fake,
    FAKE_STATE: state,
    FAKE_LAUNCHES: launches,
    FAKE_CLOSES: closes,
  };
  const initialHead = await gitOutput(repository, ["rev-parse", "HEAD"]);
  const first = JSON.parse(
    (
      await run(
        executable,
        ["orchestrate", "feature", "01-review", "--repo", repository, "--json"],
        { cwd: repository, env: environment },
      )
    ).stdout,
  ) as {
    runId: string;
    status: string;
    candidateCommit: string;
    review: { status: string; findings: Array<{ requiredDecision: string }> };
    execution: { executionId: string };
    snapshot: {
      phase: string;
      interruptedPhase?: string;
      git: { validatedHead?: string; featureWorktree: string };
      tickets: Record<string, { status: string; commit?: string }>;
      reviewAttention?: {
        candidateCommit: string;
        executionId: string;
        attemptId: string;
        findings: Array<{ requiredDecision: string }>;
      };
    };
  };
  expect(first).toMatchObject({
    status: "attention",
    review: {
      status: "attention",
      findings: [
        {
          requiredDecision: "Choose the empty-state behavior for this ticket.",
        },
      ],
    },
    snapshot: {
      phase: "blocked",
      interruptedPhase: "implementing",
      tickets: {
        "01-review": { status: "active" },
        "02-later": { status: "pending" },
      },
      reviewAttention: {
        candidateCommit: first.candidateCommit,
        findings: [
          {
            requiredDecision:
              "Choose the empty-state behavior for this ticket.",
          },
        ],
      },
    },
  });
  expect(first.candidateCommit).not.toBe(first.snapshot.git.validatedHead);
  expect(first.snapshot.reviewAttention?.executionId).toBe(
    first.execution.executionId,
  );
  expect(first.snapshot.reviewAttention?.attemptId).toBe("attempt-01");
  expect(await gitOutput(repository, ["rev-parse", "HEAD"])).toBe(initialHead);
  expect((await readFile(closes, "utf8")).trim().split("\n")).toEqual([
    "fake:worker",
  ]);
  expect((await readFile(launches, "utf8")).trim().split("\n")).toHaveLength(1);

  const later = await run(
    executable,
    ["orchestrate", "feature", "02-later", "--repo", repository, "--json"],
    { cwd: repository, env: environment },
  ).then(
    (result) => ({ code: 0, ...result }),
    (error: unknown) => error as { code: number; stderr: string },
  );
  expect(later.code).toBe(4);
  expect(later.stderr).toContain("WORKFLOW_BLOCKED");

  const restarted = JSON.parse(
    (
      await run(
        executable,
        ["orchestrate", "feature", "01-review", "--repo", repository, "--json"],
        { cwd: repository, env: environment },
      )
    ).stdout,
  );
  expect(restarted).toMatchObject({
    status: "attention",
    runId: first.runId,
    candidateCommit: first.candidateCommit,
    review: first.review,
    snapshot: {
      phase: "blocked",
      reviewAttention: first.snapshot.reviewAttention,
    },
  });
  expect((await readFile(launches, "utf8")).trim().split("\n")).toHaveLength(1);

  const reconciledInvocation = await run(
    executable,
    [
      "worker",
      "reconcile",
      "--repo",
      repository,
      "--run",
      first.runId,
      "--attempt",
      "attempt-01",
      "--json",
    ],
    { cwd: repository, env: environment },
  ).then(
    (result) => ({ code: 0, ...result }),
    (error: unknown) => error as { code: number; stdout: string },
  );
  expect(reconciledInvocation.code).toBe(4);
  const reconciled = JSON.parse(reconciledInvocation.stdout);
  expect(reconciled).toMatchObject({
    status: "attention",
    outcome: "review-attention",
    code: "WORKER_REVIEW_ATTENTION",
    candidateCommit: first.candidateCommit,
    review: first.review,
    snapshot: {
      phase: "blocked",
      reviewAttention: first.snapshot.reviewAttention,
    },
  });
  expect(
    JSON.parse(await readFile(reconciled.artifacts.record, "utf8")),
  ).toMatchObject({
    status: "blocked",
    cleanup: { status: "closed" },
  });
  const history = (
    await run(executable, [
      "history",
      "--repo",
      repository,
      "--run",
      first.runId,
      "--json",
    ])
  ).stdout;
  expect(
    JSON.parse(history).map((event: { type: string }) => event.type),
  ).toContain("worker.review.attention");
  expect(await gitOutput(repository, ["rev-parse", "HEAD"])).toBe(initialHead);
}, 30_000);

test("flow orchestrate retries a launch failure only after another explicit invocation", async () => {
  const repository = await createCommittedTargetRepository();
  const packageDirectory = join(repository, "feature");
  await mkdir(join(packageDirectory, "issues"), { recursive: true });
  await writeFile(join(packageDirectory, "spec.md"), "# Feature\n");
  await writeFile(join(packageDirectory, "issues", "01-first.md"), "# First\n");
  const fakeDirectory = await temporaryDirectory();
  const fake = join(fakeDirectory, "herdr");
  const state = join(fakeDirectory, "state.json");
  const promptPath = join(fakeDirectory, "prompt.txt");
  const splits = join(fakeDirectory, "splits");
  await writeFile(splits, "0");
  await writeFile(
    fake,
    `#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") console.log("fake-herdr 1.0.0");
else if (args[0] === "pane" && args[1] === "split") {
  const count = Number(readFileSync(process.env.FAKE_SPLITS, "utf8")) + 1;
  writeFileSync(process.env.FAKE_SPLITS, String(count));
  if (count === 1) process.exit(1);
  console.log(JSON.stringify({result:{pane:{pane_id:"fake:worker"}}}));
} else if (args[0] === "agent" && args[1] === "start") {
  const child = args.slice(args.indexOf("--") + 1);
  const worktree = child[child.indexOf("-C") + 1];
  writeFileSync(process.env.FAKE_STATE, JSON.stringify({worktree}));
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:worker",agent_status:"idle"}}}));
} else if (args[0] === "agent" && args[1] === "prompt") {
  const current = JSON.parse(readFileSync(process.env.FAKE_STATE, "utf8"));
  const prompt = args[3];
  writeFileSync(process.env.FAKE_PROMPT, prompt);
  const ticket = prompt.match(/- Ticket: ([^\\n]+)/)[1];
  const resultPath = prompt.match(/Write the structured execution result to: "([^"]+)"/)[1];
  writeFileSync(current.worktree + "/first-change.txt", "done\\n");
  execFileSync("git", ["-C", current.worktree, "add", "first-change.txt"]);
  execFileSync("git", ["-C", current.worktree, "commit", "--quiet", "-m", "first ticket"]);
  const commit = execFileSync("git", ["-C", current.worktree, "rev-parse", "HEAD"], {encoding:"utf8"}).trim();
  writeFileSync(resultPath + ".tmp", JSON.stringify({schemaVersion:1,ticketId:ticket,status:"completed",summary:"done",commit,commands:[]}));
  renameSync(resultPath + ".tmp", resultPath);
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:worker",agent_status:"done"}}}));
} else if (args[0] === "agent" && args[1] === "read") process.stdout.write("done\\n");
else if (args[0] === "pane" && args[1] === "close") console.log("{}");
else process.exit(2);
`,
    "utf8",
  );
  await chmod(fake, 0o755);

  const arguments_ = [
    "orchestrate",
    "feature",
    "01-first",
    "--repo",
    repository,
    "--json",
  ];
  const environment = {
    ...process.env,
    HERDR_ENV: "1",
    HERDR_PANE_ID: "caller",
    HERDR_BIN_PATH: fake,
    FAKE_STATE: state,
    FAKE_PROMPT: promptPath,
    FAKE_SPLITS: splits,
  };

  await expect(
    run(executable, arguments_, { cwd: repository, env: environment }),
  ).rejects.toMatchObject({ code: 1 });
  expect(await readFile(splits, "utf8")).toBe("1");
  await expect(readFile(promptPath, "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });

  const { stdout } = await run(executable, arguments_, {
    cwd: repository,
    env: environment,
  });
  const report = JSON.parse(stdout) as { runId: string; status: string };
  const expectedSpecification = await realpath(
    join(
      repository,
      ".orchestrator",
      "runs",
      report.runId,
      "input",
      "package",
      "spec.md",
    ),
  );

  expect(report.status).toBe("accepted");
  expect(await readFile(splits, "utf8")).toBe("2");
  expect(await readFile(promptPath, "utf8")).toContain(
    `- Specification: "${expectedSpecification}"`,
  );
});

test("flow preserves bounded Herdr startup diagnostics and blocks the ticket", async () => {
  const repository = await createCommittedTargetRepository();
  await writeWorkflowPackage(repository, ["01-first"]);
  const fakeDirectory = await temporaryDirectory();
  const fake = join(fakeDirectory, "herdr");
  const started = join(fakeDirectory, "started");
  const prompted = join(fakeDirectory, "prompted");
  await writeFile(
    fake,
    `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") console.log("fake-herdr 1.0.0");
else if (args[0] === "pane" && args[1] === "split") console.log(JSON.stringify({result:{pane:{pane_id:"fake:worker"}}}));
else if (args[0] === "agent" && args[1] === "start") {
  writeFileSync(process.env.FAKE_STARTED, "started\\n");
  process.stdout.write("startup stdout\\n" + "o".repeat(17000));
  process.stderr.write("first\\tstartup\\terror\\n" + "e".repeat(17000));
  process.exit(23);
} else if (args[0] === "agent" && args[1] === "prompt") appendFileSync(process.env.FAKE_PROMPTED, "prompted\\n");
else if (args[0] === "pane" && args[1] === "close") console.log("{}");
else process.exit(2);
`,
    "utf8",
  );
  await chmod(fake, 0o755);

  const result = await run(
    executable,
    ["orchestrate", "feature", "01-first", "--repo", repository],
    {
      cwd: repository,
      env: {
        ...process.env,
        HERDR_ENV: "1",
        HERDR_PANE_ID: "caller",
        HERDR_BIN_PATH: fake,
        FAKE_STARTED: started,
        FAKE_PROMPTED: prompted,
      },
    },
  ).then(
    (value) => ({ ...value, code: 0 }),
    (error: unknown) =>
      error as { stdout: string; stderr: string; code: number },
  );
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Ticket 01-first blocked");
  expect(result.stderr).toContain("agent start failed");
  expect(result.stderr).toContain("Exit code: 23");
  expect(result.stderr).toContain("stderr: first startup error");
  expect(result.stderr).not.toContain("startup stdout");
  expect(result.stderr).not.toContain("eeeeeeeeeeee");
  await expect(readFile(prompted, "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(readFile(started, "utf8")).resolves.toBe("started\n");

  const [runId] = await readdir(join(repository, ".orchestrator", "runs"));
  expect(runId).toBeDefined();
  const recordPath = join(
    repository,
    ".orchestrator",
    "runs",
    runId!,
    "workers",
    "01-first",
    "attempt-01",
    "execution.json",
  );
  const persistedRecordPath = await realpath(recordPath);
  expect(result.stderr).toContain(persistedRecordPath);
  const record = JSON.parse(await readFile(recordPath, "utf8")) as {
    status: string;
    diagnostics: {
      operation: string;
      message: string;
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      truncated: boolean;
    };
    cleanup?: { status: string; error?: string };
  };
  expect(record).toMatchObject({
    status: "failed",
    diagnostics: {
      operation: "agent start",
      message: "Herdr agent start exited with 23",
      exitCode: 23,
      truncated: true,
    },
    cleanup: { status: "closed" },
  });
  expect(Buffer.byteLength(record.diagnostics.stdout ?? "", "utf8")).toBe(
    16 * 1024,
  );
  expect(Buffer.byteLength(record.diagnostics.stderr ?? "", "utf8")).toBe(
    16 * 1024,
  );
  expect(record.diagnostics.stdout).toMatch(/o+$/);
  expect(record.diagnostics.stderr).toMatch(/e+$/);
  expect(JSON.stringify(record)).not.toContain("--pane");

  const state = JSON.parse(
    await readFile(
      join(repository, ".orchestrator", "runs", runId!, "state.json"),
      "utf8",
    ),
  ) as {
    phase: string;
    tickets: Record<string, { status: string }>;
    lastExecution: { path: string; failureReason: string };
  };
  expect(state).toMatchObject({
    phase: "blocked",
    tickets: { "01-first": { status: "active" } },
    lastExecution: { path: persistedRecordPath },
  });

  const history = (
    await readFile(
      join(repository, ".orchestrator", "runs", runId!, "history.jsonl"),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line)) as Array<{
    type: string;
    data: { failureReason?: string };
  }>;
  const blocked = history.at(-1);
  expect(blocked).toMatchObject({
    type: "workflow.ticket.blocked",
    data: { failureReason: state.lastExecution.failureReason },
  });
}, 30_000);

test("flow orchestrate resumes a two-ticket queue across processes", async () => {
  const repository = await createCommittedTargetRepository();
  const packageDirectory = join(repository, "feature");
  await mkdir(join(packageDirectory, "issues"), { recursive: true });
  await writeFile(join(packageDirectory, "spec.md"), "# Feature\n");
  await writeFile(join(packageDirectory, "issues", "01-first.md"), "# First\n");
  await writeFile(
    join(packageDirectory, "issues", "02-second.md"),
    "# Second\n",
  );
  const fakeDirectory = await temporaryDirectory();
  const fake = join(fakeDirectory, "herdr");
  const state = join(fakeDirectory, "state.json");
  const workers = join(fakeDirectory, "workers.log");
  const prompts = join(fakeDirectory, "prompts.jsonl");
  await writeFile(
    fake,
    `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
const args = process.argv.slice(2);
if (args[0] === "--version") console.log("fake-herdr 1.0.0");
else if (args[0] === "pane" && args[1] === "split") console.log(JSON.stringify({result:{pane:{pane_id:"fake:worker"}}}));
else if (args[0] === "agent" && args[1] === "start") {
  const child = args.slice(args.indexOf("--") + 1);
  const worktree = child[child.indexOf("-C") + 1];
  appendFileSync(process.env.FAKE_WORKERS, args[2] + "\\n");
  writeFileSync(process.env.FAKE_STATE, JSON.stringify({worktree}));
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:worker",agent_status:"idle"}}}));
} else if (args[0] === "agent" && args[1] === "prompt") {
  const current = JSON.parse(readFileSync(process.env.FAKE_STATE, "utf8"));
  const prompt = args[3];
  appendFileSync(process.env.FAKE_PROMPTS, JSON.stringify(prompt) + "\\n");
  const ticket = prompt.match(/- Ticket: ([^\\n]+)/)[1];
  const resultPath = prompt.match(/Write the structured execution result to: "([^"]+)"/)[1];
  const file = ticket.replace(/[^A-Za-z0-9_-]/g, "_") + ".txt";
  writeFileSync(current.worktree + "/" + file, ticket + "\\n");
  execFileSync("git", ["-C", current.worktree, "add", file]);
  execFileSync("git", ["-C", current.worktree, "commit", "--quiet", "-m", ticket]);
  const commit = execFileSync("git", ["-C", current.worktree, "rev-parse", "HEAD"], {encoding:"utf8"}).trim();
  writeFileSync(resultPath + ".tmp", JSON.stringify({schemaVersion:1,ticketId:ticket,status:"completed",summary:ticket,commit,commands:[]}));
  renameSync(resultPath + ".tmp", resultPath);
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:worker",agent_status:"done"}}}));
} else if (args[0] === "agent" && args[1] === "read") process.stdout.write("done\\n");
else if (args[0] === "pane" && args[1] === "close") console.log("{}");
else process.exit(2);
`,
    "utf8",
  );
  await chmod(fake, 0o755);
  const environment = {
    ...process.env,
    HERDR_ENV: "1",
    HERDR_PANE_ID: "caller",
    HERDR_BIN_PATH: fake,
    FAKE_STATE: state,
    FAKE_WORKERS: workers,
    FAKE_PROMPTS: prompts,
  };
  const initialHead = await gitOutput(repository, ["rev-parse", "HEAD"]);
  const first = JSON.parse(
    (
      await run(
        executable,
        ["orchestrate", "feature", "01-first", "--repo", repository, "--json"],
        { cwd: repository, env: environment },
      )
    ).stdout,
  ) as {
    runId: string;
    acceptedCommit: string;
    nextTicket?: string;
    snapshot: { phase: string; git: { featureWorktree: string } };
    execution: { artifacts: { record: string } };
  };
  expect(first).toMatchObject({
    status: "accepted",
    nextTicket: "02-second",
    snapshot: { phase: "implementing" },
  });
  expect(await gitOutput(repository, ["rev-parse", "HEAD"])).toBe(initialHead);

  const second = JSON.parse(
    (
      await run(
        executable,
        ["orchestrate", "feature", "02-second", "--repo", repository, "--json"],
        { cwd: repository, env: environment },
      )
    ).stdout,
  ) as {
    runId: string;
    acceptedCommit: string;
    snapshot: {
      phase: string;
      git: { featureWorktree: string };
      tickets: Record<string, { commit?: string }>;
    };
    execution: { artifacts: { record: string } };
    phase6: string;
  };
  expect(second).toMatchObject({
    status: "accepted",
    runId: first.runId,
    snapshot: { phase: "completed" },
    phase6: "not-run",
  });
  expect(second.snapshot.git.featureWorktree).toBe(
    first.snapshot.git.featureWorktree,
  );
  expect(second.snapshot.tickets["01-first"]!.commit).toBe(
    first.acceptedCommit,
  );
  expect(second.snapshot.tickets["02-second"]!.commit).toBe(
    second.acceptedCommit,
  );
  const expectedSpecification = await realpath(
    join(
      repository,
      ".orchestrator",
      "runs",
      first.runId,
      "input",
      "package",
      "spec.md",
    ),
  );
  const renderedPrompts = (await readFile(prompts, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string);
  expect(renderedPrompts).toHaveLength(2);
  expect(renderedPrompts).toEqual(
    expect.arrayContaining([
      expect.stringContaining(`- Specification: "${expectedSpecification}"`),
    ]),
  );
  expect(renderedPrompts[0]).not.toContain("02-second");
  expect(renderedPrompts[0]).not.toContain(join(packageDirectory, "spec.md"));
  expect(
    JSON.parse(await readFile(first.execution.artifacts.record, "utf8")),
  ).toMatchObject({ specification: expectedSpecification });
  expect(
    JSON.parse(await readFile(second.execution.artifacts.record, "utf8")),
  ).toMatchObject({ specification: expectedSpecification });
  await expect(
    gitOutput(second.snapshot.git.featureWorktree, [
      "merge-base",
      "--is-ancestor",
      first.acceptedCommit,
      second.acceptedCommit,
    ]),
  ).resolves.toBe("");
  expect(
    JSON.parse(await readFile(first.execution.artifacts.record, "utf8")).herdr
      .agentName,
  ).not.toBe(
    JSON.parse(await readFile(second.execution.artifacts.record, "utf8")).herdr
      .agentName,
  );

  const repeated = JSON.parse(
    (
      await run(
        executable,
        ["orchestrate", "feature", "01-first", "--repo", repository, "--json"],
        { cwd: repository, env: environment },
      )
    ).stdout,
  );
  expect(repeated).toMatchObject({
    status: "noop",
    runId: first.runId,
    acceptedCommit: first.acceptedCommit,
  });
  expect((await readFile(workers, "utf8")).trim().split("\n")).toHaveLength(2);
});

test("flow orchestrate refuses a duplicate invocation while the ticket is active", async () => {
  const repository = await createCommittedTargetRepository();
  const packageDirectory = join(repository, "feature");
  await mkdir(join(packageDirectory, "issues"), { recursive: true });
  await writeFile(join(packageDirectory, "spec.md"), "# Feature\n");
  await writeFile(join(packageDirectory, "issues", "01-first.md"), "# First\n");
  await writeFile(
    join(packageDirectory, "issues", "02-second.md"),
    "# Second\n",
  );
  const fakeDirectory = await temporaryDirectory();
  const fake = join(fakeDirectory, "herdr");
  const state = join(fakeDirectory, "state.json");
  const started = join(fakeDirectory, "started");
  const release = join(fakeDirectory, "release");
  const workers = join(fakeDirectory, "workers.log");
  await writeFile(
    fake,
    `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
const args = process.argv.slice(2);
if (args[0] === "--version") console.log("fake-herdr 1.0.0");
else if (args[0] === "pane" && args[1] === "split") console.log(JSON.stringify({result:{pane:{pane_id:"fake:worker"}}}));
else if (args[0] === "agent" && args[1] === "start") {
  const child = args.slice(args.indexOf("--") + 1);
  const worktree = child[child.indexOf("-C") + 1];
  appendFileSync(process.env.FAKE_WORKERS, args[2] + "\\n");
  writeFileSync(process.env.FAKE_STATE, JSON.stringify({worktree}));
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:worker",agent_status:"idle"}}}));
} else if (args[0] === "agent" && args[1] === "prompt") {
  writeFileSync(process.env.FAKE_STARTED, "started\\n");
  while (!existsSync(process.env.FAKE_RELEASE)) await new Promise((resolve) => setTimeout(resolve, 20));
  const current = JSON.parse(readFileSync(process.env.FAKE_STATE, "utf8"));
  const prompt = args[3];
  const ticket = prompt.match(/- Ticket: ([^\\n]+)/)[1];
  const resultPath = prompt.match(/Write the structured execution result to: "([^"]+)"/)[1];
  writeFileSync(current.worktree + "/first-change.txt", "done\\n");
  execFileSync("git", ["-C", current.worktree, "add", "first-change.txt"]);
  execFileSync("git", ["-C", current.worktree, "commit", "--quiet", "-m", "first ticket"]);
  const commit = execFileSync("git", ["-C", current.worktree, "rev-parse", "HEAD"], {encoding:"utf8"}).trim();
  writeFileSync(resultPath + ".tmp", JSON.stringify({schemaVersion:1,ticketId:ticket,status:"completed",summary:"done",commit,commands:[]}));
  renameSync(resultPath + ".tmp", resultPath);
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:worker",agent_status:"done"}}}));
} else if (args[0] === "agent" && args[1] === "read") process.stdout.write("done\\n");
else if (args[0] === "pane" && args[1] === "close") console.log("{}");
else process.exit(2);
`,
    "utf8",
  );
  await chmod(fake, 0o755);
  const environment = {
    ...process.env,
    HERDR_ENV: "1",
    HERDR_PANE_ID: "caller",
    HERDR_BIN_PATH: fake,
    FAKE_STATE: state,
    FAKE_STARTED: started,
    FAKE_RELEASE: release,
    FAKE_WORKERS: workers,
  };
  const invocation = [
    "orchestrate",
    "feature",
    "01-first",
    "--repo",
    repository,
    "--json",
  ];
  const first = run(executable, invocation, {
    cwd: repository,
    env: environment,
  });
  for (let attempts = 0; attempts < 200; attempts += 1) {
    if (await readFile(started, "utf8").catch(() => undefined)) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await expect(readFile(started, "utf8")).resolves.toBe("started\n");
  const runId = (await readdir(join(repository, ".orchestrator", "runs"))).find(
    (entry) => entry.startsWith("run_"),
  )!;
  const statePath = join(
    repository,
    ".orchestrator",
    "runs",
    runId,
    "state.json",
  );
  const historyPath = join(
    repository,
    ".orchestrator",
    "runs",
    runId,
    "history.jsonl",
  );
  const stateBeforeDuplicate = await readFile(statePath, "utf8");
  const activeExecution = JSON.parse(stateBeforeDuplicate).activeExecution as {
    executionId: string;
    attemptId: string;
  };
  const historyBeforeDuplicate = await readFile(historyPath, "utf8");

  const duplicate = await run(executable, invocation, {
    cwd: repository,
    env: environment,
  })
    .then((value) => ({ ...value, code: 0 }))
    .catch(
      (error: unknown) =>
        error as { stdout: string; stderr: string; code: number },
    );
  expect(duplicate.code).toBe(5);
  expect(JSON.parse(duplicate.stderr)).toMatchObject({
    code: "WORKFLOW_STEP_IN_PROGRESS",
    details: {
      runId,
      ticketId: "01-first",
      executionId: activeExecution.executionId,
      attemptId: activeExecution.attemptId,
    },
  });
  expect(await readFile(statePath, "utf8")).toBe(stateBeforeDuplicate);
  expect(await readFile(historyPath, "utf8")).toBe(historyBeforeDuplicate);
  expect((await readFile(workers, "utf8")).trim().split("\n")).toHaveLength(1);

  await writeFile(release, "release\n");
  const completed = JSON.parse((await first).stdout);
  expect(completed).toMatchObject({
    status: "accepted",
    ticketId: "01-first",
    nextTicket: "02-second",
  });
});

test("flow orchestrate safely retries a blocked ticket before advancing the queue", async () => {
  const repository = await createCommittedTargetRepository();
  const packageDirectory = join(repository, "feature");
  await mkdir(join(packageDirectory, "issues"), { recursive: true });
  await writeFile(join(packageDirectory, "spec.md"), "# Feature\n");
  await writeFile(join(packageDirectory, "issues", "01-first.md"), "# First\n");
  await writeFile(
    join(packageDirectory, "issues", "02-second.md"),
    "# Second\n",
  );
  const fakeDirectory = await temporaryDirectory();
  const fake = join(fakeDirectory, "herdr");
  const state = join(fakeDirectory, "state.json");
  const attempts = join(fakeDirectory, "attempts");
  const prompts = join(fakeDirectory, "prompts.jsonl");
  await writeFile(attempts, "0");
  await writeFile(
    fake,
    `#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync, renameSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") console.log("fake-herdr 1.0.0");
else if (args[0] === "pane" && args[1] === "split") console.log(JSON.stringify({result:{pane:{pane_id:"fake:worker"}}}));
else if (args[0] === "agent" && args[1] === "start") {
  const child = args.slice(args.indexOf("--") + 1);
  writeFileSync(process.env.FAKE_STATE, JSON.stringify({worktree: child[child.indexOf("-C") + 1]}));
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:worker",agent_status:"idle"}}}));
} else if (args[0] === "agent" && args[1] === "prompt") {
  const current = JSON.parse(readFileSync(process.env.FAKE_STATE, "utf8"));
  const prompt = args[3];
  appendFileSync(process.env.FAKE_PROMPTS, JSON.stringify(prompt) + "\\n");
  const ticket = prompt.match(/- Ticket: ([^\\n]+)/)[1];
  const resultPath = prompt.match(/Write the structured execution result to: "([^"]+)"/)[1];
  const count = Number(readFileSync(process.env.FAKE_ATTEMPTS, "utf8")) + 1;
  writeFileSync(process.env.FAKE_ATTEMPTS, String(count));
  if (count === 1) {
    writeFileSync(resultPath + ".tmp", JSON.stringify({schemaVersion:1,ticketId:ticket,status:"blocked",summary:"Need an external decision.",blocker:{type:"product-decision",requiredDecision:"Choose the API."}}));
  } else {
    const file = ticket + ".txt";
    writeFileSync(current.worktree + "/" + file, "resolved\\n");
    execFileSync("git", ["-C", current.worktree, "add", file]);
    execFileSync("git", ["-C", current.worktree, "commit", "--quiet", "-m", "resolved blocker"]);
    const commit = execFileSync("git", ["-C", current.worktree, "rev-parse", "HEAD"], {encoding:"utf8"}).trim();
    writeFileSync(resultPath + ".tmp", JSON.stringify({schemaVersion:1,ticketId:ticket,status:"completed",summary:"resolved",commit,commands:[]}));
  }
  renameSync(resultPath + ".tmp", resultPath);
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:worker",agent_status:"done"}}}));
} else if (args[0] === "agent" && args[1] === "read") process.stdout.write("done\\n");
else if (args[0] === "pane" && args[1] === "close") console.log("{}");
else process.exit(2);
`,
    "utf8",
  );
  await chmod(fake, 0o755);
  const environment = {
    ...process.env,
    HERDR_ENV: "1",
    HERDR_PANE_ID: "caller",
    HERDR_BIN_PATH: fake,
    FAKE_STATE: state,
    FAKE_ATTEMPTS: attempts,
    FAKE_PROMPTS: prompts,
  };
  const first = await run(
    executable,
    ["orchestrate", "feature", "01-first", "--repo", repository, "--json"],
    { cwd: repository, env: environment },
  )
    .then((value) => ({ ...value, code: 0 }))
    .catch(
      (error: unknown) =>
        error as { stdout: string; stderr: string; code: number },
    );
  expect(first.code).toBe(4);
  expect(JSON.parse(first.stderr)).toMatchObject({
    code: "WORKER_NOT_COMPLETED",
    details: {
      workerStatus: "blocked",
      requiredAction: "Choose the API.",
    },
  });
  const runs = (
    await readdir(join(repository, ".orchestrator", "runs"))
  ).filter((entry) => entry.startsWith("run_"));
  expect(runs).toHaveLength(1);
  const laterTicket = await run(
    executable,
    ["orchestrate", "feature", "02-second", "--repo", repository, "--json"],
    { cwd: repository, env: environment },
  )
    .then((value) => ({ ...value, code: 0 }))
    .catch(
      (error: unknown) =>
        error as { stdout: string; stderr: string; code: number },
    );
  expect(laterTicket.code).toBe(4);
  expect(JSON.parse(laterTicket.stderr)).toMatchObject({
    code: "WORKFLOW_BLOCKED",
    details: { activeTicket: "01-first" },
  });
  expect(Number(await readFile(attempts, "utf8"))).toBe(1);

  await writeFile(
    join(packageDirectory, "issues", "01-first.md"),
    "# Changed\n",
  );
  const changedPackage = await run(
    executable,
    ["orchestrate", "feature", "01-first", "--repo", repository, "--json"],
    { cwd: repository, env: environment },
  )
    .then((value) => ({ ...value, code: 0 }))
    .catch(
      (error: unknown) =>
        error as { stdout: string; stderr: string; code: number },
    );
  expect(changedPackage.code).toBe(3);
  expect(JSON.parse(changedPackage.stderr)).toMatchObject({
    code: "WORKFLOW_PACKAGE_CHANGED",
  });
  await writeFile(join(packageDirectory, "issues", "01-first.md"), "# First\n");

  const resumed = JSON.parse(
    (
      await run(
        executable,
        ["orchestrate", "feature", "01-first", "--repo", repository, "--json"],
        { cwd: repository, env: environment },
      )
    ).stdout,
  );
  expect(resumed).toMatchObject({
    status: "accepted",
    ticketId: "01-first",
    nextTicket: "02-second",
    snapshot: {
      phase: "implementing",
      tickets: {
        "01-first": { status: "accepted" },
        "02-second": { status: "pending" },
      },
    },
  });
  expect(Number(await readFile(attempts, "utf8"))).toBe(2);
  const specification = await realpath(
    join(
      repository,
      ".orchestrator",
      "runs",
      runs[0]!,
      "input",
      "package",
      "spec.md",
    ),
  );
  const renderedPrompts = (await readFile(prompts, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string);
  expect(renderedPrompts).toHaveLength(2);
  expect(renderedPrompts).toEqual(
    expect.arrayContaining([
      expect.stringContaining(`- Specification: "${specification}"`),
    ]),
  );
  expect(renderedPrompts[0]).toContain(`- Specification: "${specification}"`);
  expect(renderedPrompts[1]).toContain(`- Specification: "${specification}"`);
});

test("flow orchestrate refuses a blocked retry after an unaccepted worktree change", async () => {
  const repository = await createCommittedTargetRepository();
  const packageDirectory = join(repository, "feature");
  await mkdir(join(packageDirectory, "issues"), { recursive: true });
  await writeFile(join(packageDirectory, "spec.md"), "# Feature\n");
  await writeFile(join(packageDirectory, "issues", "01-first.md"), "# First\n");
  await writeFile(
    join(packageDirectory, "issues", "02-second.md"),
    "# Second\n",
  );
  const fakeDirectory = await temporaryDirectory();
  const fake = join(fakeDirectory, "herdr");
  const state = join(fakeDirectory, "state.json");
  const attempts = join(fakeDirectory, "attempts");
  await writeFile(attempts, "0");
  await writeFile(
    fake,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync, renameSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") console.log("fake-herdr 1.0.0");
else if (args[0] === "pane" && args[1] === "split") console.log(JSON.stringify({result:{pane:{pane_id:"fake:worker"}}}));
else if (args[0] === "agent" && args[1] === "start") {
  const child = args.slice(args.indexOf("--") + 1);
  writeFileSync(process.env.FAKE_STATE, JSON.stringify({worktree: child[child.indexOf("-C") + 1]}));
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:worker",agent_status:"idle"}}}));
} else if (args[0] === "agent" && args[1] === "prompt") {
  const current = JSON.parse(readFileSync(process.env.FAKE_STATE, "utf8"));
  const prompt = args[3];
  const ticket = prompt.match(/- Ticket: ([^\\n]+)/)[1];
  const resultPath = prompt.match(/Write the structured execution result to: "([^"]+)"/)[1];
  const count = Number(readFileSync(process.env.FAKE_ATTEMPTS, "utf8")) + 1;
  writeFileSync(process.env.FAKE_ATTEMPTS, String(count));
  writeFileSync(current.worktree + "/unaccepted.txt", "must not be discarded\\n");
  writeFileSync(resultPath + ".tmp", JSON.stringify({schemaVersion:1,ticketId:ticket,status:"blocked",summary:"The worker changed the worktree.",blocker:{type:"external",requiredDecision:"Clean the worktree."}}));
  renameSync(resultPath + ".tmp", resultPath);
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:worker",agent_status:"done"}}}));
} else if (args[0] === "agent" && args[1] === "read") process.stdout.write("done\\n");
else if (args[0] === "pane" && args[1] === "close") console.log("{}");
else process.exit(2);
`,
    "utf8",
  );
  await chmod(fake, 0o755);
  const environment = {
    ...process.env,
    HERDR_ENV: "1",
    HERDR_PANE_ID: "caller",
    HERDR_BIN_PATH: fake,
    FAKE_STATE: state,
    FAKE_ATTEMPTS: attempts,
  };

  const first = await run(
    executable,
    ["orchestrate", "feature", "01-first", "--repo", repository, "--json"],
    { cwd: repository, env: environment },
  )
    .then((value) => ({ ...value, code: 0 }))
    .catch(
      (error: unknown) =>
        error as { stdout: string; stderr: string; code: number },
    );
  expect(first.code).toBe(4);
  const retry = await run(
    executable,
    ["orchestrate", "feature", "01-first", "--repo", repository, "--json"],
    { cwd: repository, env: environment },
  )
    .then((value) => ({ ...value, code: 0 }))
    .catch(
      (error: unknown) =>
        error as { stdout: string; stderr: string; code: number },
    );
  expect(retry.code).toBe(4);
  expect(JSON.parse(retry.stderr)).toMatchObject({
    code: "RETRY_REQUIRES_RECONCILIATION",
    details: { evidence: { clean: false } },
  });
  expect(Number(await readFile(attempts, "utf8"))).toBe(1);
});

test("flow --version displays the package version", async () => {
  const { stderr, stdout } = await run(executable, ["--version"], {
    cwd: outsideInstallationRoot,
  });

  expect(stdout).toBe("0.1.0\n");
  expect(stderr).toBe("");
});

test("flow rejects unsupported arguments", async () => {
  await expect(
    run(executable, ["--unknown"], {
      cwd: outsideInstallationRoot,
    }),
  ).rejects.toMatchObject({
    code: 1,
    stderr: "Unsupported argument: --unknown\n",
    stdout: "",
  });
});

test("flow creates an explicit Workflow run", async () => {
  const repository = await createTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";

  const { stderr, stdout } = await run(executable, [
    "run",
    "create",
    "--repo",
    repository,
    "--spec",
    "specs/feature.md",
    "--run",
    runId,
  ]);

  expect(stderr).toBe("");
  expect(stdout).toContain(`Created run ${runId}`);

  const runDirectory = join(repository, ".orchestrator", "runs", runId);
  const snapshot = JSON.parse(
    await readFile(join(runDirectory, "state.json"), "utf8"),
  );
  expect(snapshot).toMatchObject({
    schemaVersion: 1,
    runId,
    revision: 1,
    phase: "created",
    specification: "specs/feature.md",
  });
  expect(snapshot.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  expect(snapshot.updatedAt).toBe(snapshot.createdAt);

  const history = (await readFile(join(runDirectory, "history.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    schemaVersion: 1,
    runId,
    sequence: 1,
    stateRevision: 1,
    timestamp: snapshot.createdAt,
    type: "run.created",
    data: { specification: "specs/feature.md" },
  });
  expect(history[0].eventId).toEqual(expect.any(String));
});

test("flow bootstraps ignored runtime state without replacing existing ignore rules", async () => {
  const repository = await createTargetRepository();
  const existingIgnore = "dist/\n# keep this rule\n";
  await writeFile(join(repository, ".gitignore"), existingIgnore);

  await createExplicitRun(repository, "run_20260904T120000Z_012345abcdef");

  expect(await readFile(join(repository, ".gitignore"), "utf8")).toBe(
    `${existingIgnore}.orchestrator/runs/\n`,
  );
  await expect(
    run("git", [
      "-C",
      repository,
      "check-ignore",
      "--quiet",
      "--no-index",
      "--",
      ".orchestrator/runs/probe",
    ]),
  ).resolves.toBeDefined();
});

test("flow rejects a specification symlink that escapes the Target repository", async () => {
  const repository = await createTargetRepository();
  const externalDirectory = await temporaryDirectory();
  const externalSpecification = join(externalDirectory, "external.md");
  await writeFile(externalSpecification, "# External\n");
  await symlink(externalSpecification, join(repository, "specs", "linked.md"));

  await expect(
    run(executable, [
      "run",
      "create",
      "--repo",
      repository,
      "--spec",
      "specs/linked.md",
      "--run",
      "run_20260904T120000Z_012345abcdef",
    ]),
  ).rejects.toMatchObject({ code: 3, stdout: "" });
});

test("flow rejects a redirected runtime directory before reading or writing", async () => {
  const repository = await createTargetRepository();
  const redirected = await temporaryDirectory();
  await symlink(redirected, join(repository, ".orchestrator"));

  await expect(
    run(executable, [
      "run",
      "create",
      "--repo",
      repository,
      "--spec",
      "specs/feature.md",
      "--run",
      "run_20260904T120000Z_012345abcdef",
    ]),
  ).rejects.toMatchObject({ code: 4, stdout: "" });
});

test.each([
  ["non-Git repository", async () => temporaryDirectory(), "specs/feature.md"],
  ["bare repository", createBareRepository, "specs/feature.md"],
  ["missing specification", createTargetRepository, "specs/missing.md"],
  ["non-file specification", createTargetRepository, "specs"],
])(
  "flow rejects a %s with repository-data exit status",
  async (_, setup, spec) => {
    const repository = await setup();

    await expect(
      run(executable, [
        "run",
        "create",
        "--repo",
        repository,
        "--spec",
        spec,
        "--run",
        "run_20260904T120000Z_012345abcdef",
      ]),
    ).rejects.toMatchObject({ code: 3, stdout: "" });
  },
);

test("flow rejects a specification outside the Target repository", async () => {
  const repository = await createTargetRepository();
  const externalDirectory = await temporaryDirectory();
  const specification = join(externalDirectory, "external.md");
  await writeFile(specification, "# External\n");

  await expect(
    run(executable, [
      "run",
      "create",
      "--repo",
      repository,
      "--spec",
      specification,
      "--run",
      "run_20260904T120000Z_012345abcdef",
    ]),
  ).rejects.toMatchObject({ code: 3, stdout: "" });
});

test.each(["feature-one", "run_20269999T999999Z_012345abcdef"])(
  "flow rejects invalid caller-supplied run ID %s",
  async (runId) => {
    const repository = await createTargetRepository();

    await expect(
      run(executable, [
        "run",
        "create",
        "--repo",
        repository,
        "--spec",
        "specs/feature.md",
        "--run",
        runId,
      ]),
    ).rejects.toMatchObject({ code: 2, stdout: "" });
  },
);

test.each([
  [
    "a flag in place of a value",
    [
      "run",
      "create",
      "--repo",
      "--spec",
      "specs/feature.md",
      "--run",
      "run_20260904T120000Z_012345abcdef",
    ],
  ],
  [
    "an unknown option",
    [
      "status",
      "--repo",
      "/tmp",
      "--run",
      "run_20260904T120000Z_012345abcdef",
      "--bogus",
    ],
  ],
  [
    "a duplicate option",
    [
      "history",
      "--repo",
      "/tmp",
      "--repo",
      "/tmp",
      "--run",
      "run_20260904T120000Z_012345abcdef",
    ],
  ],
])("flow rejects %s for a recognized command", async (_, arguments_) => {
  await expect(run(executable, arguments_)).rejects.toMatchObject({
    code: 2,
    stdout: "",
  });
});

test("flow allows repository and run ID to be inferred", async () => {
  const repository = await createTargetRepository();

  await expect(
    run(
      executable,
      ["run", "create", "--repo", repository, "--spec", "specs/feature.md"],
      { cwd: repository },
    ),
  ).resolves.toMatchObject({ stdout: expect.stringContaining("Created run") });
});

test("flow generates a sortable cryptographically random run ID", async () => {
  const repository = await createTargetRepository();

  const { stderr, stdout } = await run(
    executable,
    ["run", "create", "--spec", "specs/feature.md"],
    { cwd: repository },
  );

  expect(stderr).toBe("");
  expect(stdout).toMatch(/^Created run run_\d{8}T\d{6}Z_[0-9a-f]{12}\n$/);
  const runId = stdout.trim().slice("Created run ".length);
  expect(
    (await readdir(join(repository, ".orchestrator", "runs"))).sort(),
  ).toEqual([runId]);
});

test("flow retries an explicit run creation safely", async () => {
  const repository = await createTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);
  const runDirectory = join(repository, ".orchestrator", "runs", runId);
  const before = await Promise.all([
    readFile(join(runDirectory, "state.json"), "utf8"),
    readFile(join(runDirectory, "history.jsonl"), "utf8"),
  ]);

  const { stderr, stdout } = await run(executable, [
    "run",
    "create",
    "--repo",
    repository,
    "--spec",
    "specs/feature.md",
    "--run",
    runId,
  ]);

  expect(stderr).toBe("");
  expect(stdout).toContain(`Created run ${runId}`);
  expect(
    await Promise.all([
      readFile(join(runDirectory, "state.json"), "utf8"),
      readFile(join(runDirectory, "history.jsonl"), "utf8"),
    ]),
  ).toEqual(before);
});

test("flow refuses a retry for a different specification without changing the run", async () => {
  const repository = await createTargetRepository();
  await writeFile(join(repository, "specs", "other.md"), "# Other\n");
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);
  const runDirectory = join(repository, ".orchestrator", "runs", runId);
  const before = await readFile(join(runDirectory, "state.json"), "utf8");

  await expect(
    run(executable, [
      "run",
      "create",
      "--repo",
      repository,
      "--spec",
      "specs/other.md",
      "--run",
      runId,
    ]),
  ).rejects.toMatchObject({ code: 3, stdout: "" });

  expect(await readFile(join(runDirectory, "state.json"), "utf8")).toBe(before);
});

test("flow uses the sole nonterminal run for implicit status and history", async () => {
  const repository = await createTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);

  const status = await run(executable, ["status", "--repo", repository]);
  expect(status.stdout).toContain(`Run: ${runId}\n`);

  const history = await run(executable, [
    "history",
    "--repo",
    repository,
    "--json",
  ]);
  expect(JSON.parse(history.stdout)).toHaveLength(1);
});

test("flow falls back to the sole terminal run for implicit status", async () => {
  const repository = await createTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);
  const statePath = join(
    repository,
    ".orchestrator",
    "runs",
    runId,
    "state.json",
  );
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.phase = "completed";
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

  const { stdout } = await run(executable, ["status", "--repo", repository]);
  expect(stdout).toContain(`Run: ${runId}\n`);
  expect(stdout).toContain("Phase: completed\n");
});

test("flow refuses ambiguous implicit selection and reports candidate IDs", async () => {
  const repository = await createTargetRepository();
  const runIds = [
    "run_20260904T120000Z_012345abcdef",
    "run_20260904T120001Z_012345abcdee",
  ];
  for (const runId of runIds) await createExplicitRun(repository, runId);

  await expect(
    run(executable, ["status", "--repo", repository]),
  ).rejects.toMatchObject({
    code: 3,
    stdout: "",
    stderr: expect.stringContaining(runIds[0]!),
  });

  await expect(
    run(executable, ["status", "--repo", repository, "--json"]),
  ).rejects.toMatchObject({
    code: 3,
    stdout: "",
    stderr: expect.stringMatching(
      new RegExp(`"code":"[A-Z_]+".*${runIds[0]!}.*${runIds[1]!}`),
    ),
  });
});

test("flow reports no run candidates with structured guidance", async () => {
  const repository = await createTargetRepository();

  await expect(
    run(executable, ["history", "--repo", repository, "--json"]),
  ).rejects.toMatchObject({
    code: 3,
    stdout: "",
    stderr: expect.stringMatching(/"code":"[A-Z_]+".*"message":".*run/i),
  });
});

test("flow displays explicit run status in human and structured forms", async () => {
  const repository = await createTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);

  const human = await run(executable, [
    "status",
    "--repo",
    repository,
    "--run",
    runId,
  ]);
  expect(human.stderr).toBe("");
  expect(human.stdout).toContain(`Run: ${runId}\n`);
  expect(human.stdout).toContain("Phase: created\n");
  expect(human.stdout).toContain("Specification: specs/feature.md\n");
  expect(human.stdout).toContain("Revision: 1\n");
  expect(human.stdout).toContain("History: synchronized\n");

  const structured = await run(executable, [
    "status",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  expect(structured.stderr).toBe("");
  expect(JSON.parse(structured.stdout)).toMatchObject({
    schemaVersion: 1,
    runId,
    revision: 1,
    phase: "created",
    specification: "specs/feature.md",
    history: {
      lastSequence: 1,
      lastStateRevision: 1,
      synchronized: true,
    },
  });
});

test("flow reports a one-revision interrupted audit without modifying persisted bytes", async () => {
  const repository = await createTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);
  const statePath = join(
    repository,
    ".orchestrator",
    "runs",
    runId,
    "state.json",
  );
  const historyPath = join(
    repository,
    ".orchestrator",
    "runs",
    runId,
    "history.jsonl",
  );
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.revision = 2;
  const stateBytes = `${JSON.stringify(state, null, 2)}\n`;
  const historyBytes = await readFile(historyPath, "utf8");
  await writeFile(statePath, stateBytes);

  const human = await run(executable, [
    "status",
    "--repo",
    repository,
    "--run",
    runId,
  ]);
  expect(human.stdout).toContain("interrupted audit");
  const structured = await run(executable, [
    "status",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  expect(JSON.parse(structured.stdout).history).toMatchObject({
    synchronized: false,
    warning: expect.stringContaining("one revision behind"),
  });
  expect(await readFile(statePath, "utf8")).toBe(stateBytes);
  expect(await readFile(historyPath, "utf8")).toBe(historyBytes);
});

test("flow rejects malformed history with corruption status and preserves bytes", async () => {
  const repository = await createTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);
  const historyPath = join(
    repository,
    ".orchestrator",
    "runs",
    runId,
    "history.jsonl",
  );
  const original = await readFile(historyPath, "utf8");
  await writeFile(historyPath, `${original}\n`);

  await expect(
    run(executable, ["status", "--repo", repository, "--run", runId, "--json"]),
  ).rejects.toMatchObject({
    code: 4,
    stdout: "",
    stderr: expect.stringMatching(/CORRUPT_RUN/),
  });
  expect(await readFile(historyPath, "utf8")).toBe(`${original}\n`);
});

test("flow displays explicit run history in human and structured forms", async () => {
  const repository = await createTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);
  const persistedEvent = JSON.parse(
    (
      await readFile(
        join(repository, ".orchestrator", "runs", runId, "history.jsonl"),
        "utf8",
      )
    ).trim(),
  );

  const human = await run(executable, [
    "history",
    "--repo",
    repository,
    "--run",
    runId,
  ]);
  expect(human.stderr).toBe("");
  expect(human.stdout).toBe(
    `${persistedEvent.timestamp}  1  run.created  revision 1\n`,
  );

  const structured = await run(executable, [
    "history",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  expect(structured.stderr).toBe("");
  expect(JSON.parse(structured.stdout)).toEqual([persistedEvent]);
});

test("flow prepares and inspects a default Feature worktree", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);

  const prepared = await run(executable, [
    "worktree",
    "prepare",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  const result = JSON.parse(prepared.stdout);
  expect(result).toMatchObject({
    runId,
    phase: "implementing",
    git: {
      worktreeStatus: "ready",
      featureBranch: `orchestrator/${runId}`,
    },
  });
  expect(result.git.runBase).toMatch(/^[0-9a-f]{40,64}$/);
  expect(result.git.validatedHead).toBe(result.git.runBase);
  expect(result.git.featureWorktree).toMatch(
    new RegExp(`${runId.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}$`),
  );
  expect(result.warnings).toEqual([
    expect.stringContaining("excluded from the Run base"),
  ]);
  await expect(
    run("git", ["-C", repository, "symbolic-ref", "--short", "HEAD"]),
  ).resolves.toMatchObject({ stdout: "master\n" });
  await expect(
    run("git", ["-C", result.git.featureWorktree, "status", "--porcelain"]),
  ).resolves.toMatchObject({ stdout: "" });

  const status = await run(executable, [
    "status",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  expect(JSON.parse(status.stdout)).toMatchObject({
    runId,
    phase: "implementing",
    git: result.git,
  });
  const humanStatus = await run(executable, [
    "status",
    "--repo",
    repository,
    "--run",
    runId,
  ]);
  expect(humanStatus.stdout).toContain(`Run base: ${result.git.runBase}\n`);
  expect(humanStatus.stdout).toContain(
    `Feature branch: ${result.git.featureBranch}\n`,
  );
  expect(humanStatus.stdout).toContain(
    `Feature worktree: ${result.git.featureWorktree}\n`,
  );
  const history = await run(executable, [
    "history",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  const events = JSON.parse(history.stdout) as Array<{
    type: string;
    stateRevision: number;
    data: Record<string, unknown>;
  }>;
  expect(events.map((event) => event.type)).toEqual([
    "run.created",
    "git.preparation.started",
    "git.worktree.prepared",
  ]);
  expect(events.map((event) => event.stateRevision)).toEqual([1, 2, 3]);
  expect(events[1]?.data).toMatchObject({
    runBase: result.git.runBase,
    featureBranch: result.git.featureBranch,
    featureWorktree: result.git.featureWorktree,
    worktreeStatus: "planned",
  });
});

test("flow retries an interrupted preparation from persisted intent", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_898989898989";
  await createExplicitRun(repository, runId);
  let failOnce = true;
  await expect(
    prepareWorktree(
      { repository, runId },
      {
        afterHistoryPublication: () => {
          if (failOnce) {
            failOnce = false;
            throw new Error("interrupt after intent");
          }
        },
      },
    ),
  ).rejects.toThrow("interrupt after intent");

  const interrupted = await inspectRun(repository, runId);
  expect(interrupted.snapshot).toMatchObject({
    phase: "preparing",
    git: { worktreeStatus: "planned" },
  });
  expect(interrupted.operationalHistory).toHaveLength(2);

  const retried = await run(executable, [
    "worktree",
    "prepare",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  expect(JSON.parse(retried.stdout)).toMatchObject({
    runId,
    phase: "implementing",
    git: { worktreeStatus: "ready" },
  });
  const history = JSON.parse(
    await run(executable, [
      "history",
      "--repo",
      repository,
      "--run",
      runId,
      "--json",
    ]).then(({ stdout }) => stdout),
  ) as Array<{ type: string }>;
  expect(history.map((event) => event.type)).toEqual([
    "run.created",
    "git.preparation.started",
    "git.worktree.prepared",
  ]);
});

test("flow validates a healthy Feature worktree baseline in human and JSON output", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_121212121212";
  await createExplicitRun(repository, runId);
  const prepared = JSON.parse(
    (
      await run(executable, [
        "worktree",
        "prepare",
        "--repo",
        repository,
        "--run",
        runId,
        "--json",
      ])
    ).stdout,
  ) as { git: { featureWorktree: string } };

  const structured = await run(executable, [
    "worktree",
    "validate",
    "--repo",
    repository,
    "--json",
  ]);
  const report = JSON.parse(structured.stdout);
  expect(report).toMatchObject({
    runId,
    valid: true,
    git: { worktreeStatus: "ready" },
    checks: {
      repository: { valid: true },
      registration: { valid: true },
      path: { valid: true },
      branch: { valid: true },
      head: { valid: true },
      cleanliness: { valid: true },
    },
  });
  expect(report.git.featureWorktree).toBe(prepared.git.featureWorktree);

  const human = await run(executable, [
    "worktree",
    "validate",
    "--repo",
    repository,
    "--run",
    runId,
  ]);
  expect(human.stdout).toContain("repository: valid");
  expect(human.stdout).toContain("registration: valid");
  expect(human.stdout).toContain("cleanliness: valid");
  expect(human.stdout).toContain("Result: valid");
});

test("flow accepts a new Git checkpoint and exposes its audit event", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_232323232323";
  await createExplicitRun(repository, runId);
  const prepared = JSON.parse(
    (
      await run(executable, [
        "worktree",
        "prepare",
        "--repo",
        repository,
        "--run",
        runId,
        "--json",
      ])
    ).stdout,
  ) as {
    git: { featureWorktree: string; runBase: string };
    revision: number;
  };
  const feature = prepared.git.featureWorktree;
  await writeFile(join(feature, "checkpoint.txt"), "checkpoint\n");
  await run("git", ["-C", feature, "add", "checkpoint.txt"]);
  await run("git", ["-C", feature, "commit", "--quiet", "-m", "checkpoint"]);
  const commit = (
    await run("git", ["-C", feature, "rev-parse", "HEAD"])
  ).stdout.trim();

  const beforeInspection = await inspectRun(repository, runId);
  await expect(
    inspectCheckpoint({ repository, runId, commit }),
  ).resolves.toMatchObject({
    previousValidatedHead: prepared.git.runBase,
    acceptedCommit: commit,
  });
  expect((await inspectRun(repository, runId)).snapshot).toEqual(
    beforeInspection.snapshot,
  );

  const accepted = await run(executable, [
    "checkpoint",
    "validate",
    "--repo",
    repository,
    "--run",
    runId,
    "--commit",
    commit,
    "--json",
  ]);
  expect(JSON.parse(accepted.stdout)).toMatchObject({
    runId,
    revision: prepared.revision + 1,
    phase: "implementing",
    git: { validatedHead: commit },
    previousValidatedHead: expect.any(String),
    acceptedCommit: commit,
  });
  const history = JSON.parse(
    (
      await run(executable, [
        "history",
        "--repo",
        repository,
        "--run",
        runId,
        "--json",
      ])
    ).stdout,
  ) as Array<{ type: string; stateRevision: number }>;
  expect(history.at(-1)).toMatchObject({
    type: "git.checkpoint.accepted",
    stateRevision: prepared.revision + 1,
  });
});

test("flow rejects stale and dirty checkpoint candidates without mutation", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_242424242424";
  await createExplicitRun(repository, runId);
  const prepared = JSON.parse(
    (
      await run(executable, [
        "worktree",
        "prepare",
        "--repo",
        repository,
        "--run",
        runId,
        "--json",
      ])
    ).stdout,
  ) as { git: { featureWorktree: string; runBase: string }; revision: number };
  const feature = prepared.git.featureWorktree;
  await writeFile(join(feature, "next.txt"), "next\n");
  await run("git", ["-C", feature, "add", "next.txt"]);
  await run("git", ["-C", feature, "commit", "--quiet", "-m", "next"]);
  const current = (
    await run("git", ["-C", feature, "rev-parse", "HEAD"])
  ).stdout.trim();
  const before = await inspectRun(repository, runId);

  await expect(
    run(executable, [
      "checkpoint",
      "validate",
      "--repo",
      repository,
      "--run",
      runId,
      "--commit",
      prepared.git.runBase,
      "--json",
    ]),
  ).rejects.toMatchObject({
    code: 4,
    stderr: expect.stringContaining("CHECKPOINT_STALE"),
  });
  const afterStale = await inspectRun(repository, runId);
  expect(afterStale.snapshot).toEqual(before.snapshot);
  expect(afterStale.operationalHistory).toEqual(before.operationalHistory);

  await writeFile(join(feature, "dirty.txt"), "dirty\n");
  await expect(
    run(executable, [
      "checkpoint",
      "validate",
      "--repo",
      repository,
      "--run",
      runId,
      "--commit",
      current,
      "--json",
    ]),
  ).rejects.toMatchObject({
    code: 4,
    stderr: expect.stringContaining("UNTRACKED_WORKTREE"),
  });
  const afterDirty = await inspectRun(repository, runId);
  expect(afterDirty.snapshot).toEqual(before.snapshot);
  expect(afterDirty.operationalHistory).toEqual(before.operationalHistory);
});

test("flow refuses cleanup for an active run", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_303030303030";
  await createExplicitRun(repository, runId);
  const prepared = await prepareFeatureWorktree(repository, runId);

  await expect(
    run(executable, [
      "worktree",
      "cleanup",
      "--repo",
      repository,
      "--run",
      runId,
      "--json",
    ]),
  ).rejects.toMatchObject({
    code: 4,
    stdout: "",
    stderr: expect.stringContaining("WORKTREE_CLEANUP_REFUSED"),
  });
  expect(await pathExists(prepared.featureWorktree)).toBe(true);
});

test.each([
  [
    "tracked changes",
    "DIRTY_WORKTREE",
    async (path: string) => {
      await writeFile(join(path, "specs", "feature.md"), "changed\n");
    },
  ],
  [
    "non-ignored untracked files",
    "UNTRACKED_WORKTREE",
    async (path: string) => {
      await writeFile(join(path, "untracked.txt"), "untracked\n");
    },
  ],
  [
    "ignored files",
    "IGNORED_WORKTREE",
    async (path: string) => {
      await writeFile(join(path, "ignored.txt"), "ignored\n");
    },
  ],
] as const)("flow refuses cleanup for %s", async (_label, code, mutate) => {
  const repository = await createCommittedTargetRepository();
  if (_label === "ignored files") {
    await writeFile(join(repository, ".gitignore"), "ignored.txt\n");
    await run("git", ["-C", repository, "add", ".gitignore"]);
    await run("git", ["-C", repository, "commit", "--quiet", "-m", "ignore"]);
  }
  const runId = "run_20260904T120000Z_313131313131";
  await createExplicitRun(repository, runId);
  const prepared = await prepareTerminalWorktree(repository, runId);
  const before = await inspectRun(repository, runId);
  await mutate(prepared.featureWorktree);

  await expect(
    run(executable, [
      "worktree",
      "cleanup",
      "--repo",
      repository,
      "--run",
      runId,
      "--json",
    ]),
  ).rejects.toMatchObject({
    code: 4,
    stdout: "",
    stderr: expect.stringContaining(code),
  });
  const after = await inspectRun(repository, runId);
  expect(after.snapshot).toEqual(before.snapshot);
  expect(after.operationalHistory).toEqual(before.operationalHistory);
  expect(await pathExists(prepared.featureWorktree)).toBe(true);
});

test("flow removes a terminal Feature worktree, preserves its branch, and is idempotent", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_323232323232";
  await createExplicitRun(repository, runId);
  const prepared = await prepareTerminalWorktree(repository, runId);
  const terminal = await inspectRun(repository, runId);
  const branchHead = await gitOutput(repository, [
    "rev-parse",
    `refs/heads/${prepared.featureBranch}`,
  ]);

  const first = await run(executable, [
    "worktree",
    "cleanup",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  const result = JSON.parse(first.stdout);
  expect(result).toMatchObject({
    runId,
    phase: "completed",
    revision: terminal.snapshot.revision + 1,
    git: {
      runBase: prepared.runBase,
      featureBranch: prepared.featureBranch,
      featureWorktree: prepared.featureWorktree,
      worktreeStatus: "removed",
      validatedHead: branchHead,
    },
  });
  expect(await pathExists(prepared.featureWorktree)).toBe(false);
  expect(
    await gitOutput(repository, [
      "show-ref",
      "--verify",
      `refs/heads/${prepared.featureBranch}`,
    ]),
  ).toContain(branchHead);
  expect(
    await gitOutput(repository, ["worktree", "list", "--porcelain"]),
  ).not.toContain(prepared.featureWorktree);

  const historyBeforeRetry = await readFile(
    join(repository, ".orchestrator", "runs", runId, "history.jsonl"),
    "utf8",
  );
  const stateBeforeRetry = await readFile(
    join(repository, ".orchestrator", "runs", runId, "state.json"),
    "utf8",
  );
  await expect(
    run(executable, [
      "worktree",
      "cleanup",
      "--repo",
      repository,
      "--run",
      runId,
      "--json",
    ]),
  ).resolves.toMatchObject({ stdout: first.stdout });
  expect(
    await readFile(
      join(repository, ".orchestrator", "runs", runId, "history.jsonl"),
      "utf8",
    ),
  ).toBe(historyBeforeRetry);
  expect(
    await readFile(
      join(repository, ".orchestrator", "runs", runId, "state.json"),
      "utf8",
    ),
  ).toBe(stateBeforeRetry);
  const history = JSON.parse(
    await run(executable, [
      "history",
      "--repo",
      repository,
      "--run",
      runId,
      "--json",
    ]).then(({ stdout }) => stdout),
  ) as Array<{ type: string }>;
  expect(history.at(-1)?.type).toBe("git.worktree.removed");
});

test("flow exactly retries cleanup after Git removal before state publication", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_333333333333";
  await createExplicitRun(repository, runId);
  const prepared = await prepareTerminalWorktree(repository, runId);
  let interrupted = true;
  await expect(
    cleanupWorktree(
      { repository, runId },
      {
        beforeSnapshotPublication: () => {
          if (interrupted) {
            interrupted = false;
            throw new Error("interrupt before cleanup state");
          }
        },
      },
    ),
  ).rejects.toThrow("interrupt before cleanup state");
  expect(await pathExists(prepared.featureWorktree)).toBe(false);
  expect(
    (await inspectRun(repository, runId)).snapshot.git?.worktreeStatus,
  ).toBe("ready");

  const retry = await run(executable, [
    "worktree",
    "cleanup",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  expect(JSON.parse(retry.stdout).git.worktreeStatus).toBe("removed");
});

test("flow exactly retries cleanup after state publication before history", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_343434343434";
  await createExplicitRun(repository, runId);
  const prepared = await prepareTerminalWorktree(repository, runId);
  let interrupted = true;
  await expect(
    cleanupWorktree(
      { repository, runId },
      {
        afterSnapshotPublication: () => {
          if (interrupted) {
            interrupted = false;
            throw new Error("interrupt before cleanup history");
          }
        },
      },
    ),
  ).rejects.toThrow("interrupt before cleanup history");
  expect(await pathExists(prepared.featureWorktree)).toBe(false);
  expect((await inspectRun(repository, runId)).audit.synchronized).toBe(false);

  const retry = await run(executable, [
    "worktree",
    "cleanup",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  expect(JSON.parse(retry.stdout).git.worktreeStatus).toBe("removed");
  expect((await inspectRun(repository, runId)).audit.synchronized).toBe(true);
});

test("flow refuses an interrupted cleanup retry when the preserved branch changed", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_353535353535";
  await createExplicitRun(repository, runId);
  const prepared = await prepareTerminalWorktree(repository, runId);
  await expect(
    cleanupWorktree(
      { repository, runId },
      {
        beforeSnapshotPublication: () => Promise.reject(new Error("interrupt")),
      },
    ),
  ).rejects.toThrow("interrupt");
  await run("git", ["-C", repository, "branch", "-D", prepared.featureBranch]);

  await expect(
    run(executable, [
      "worktree",
      "cleanup",
      "--repo",
      repository,
      "--run",
      runId,
      "--json",
    ]),
  ).rejects.toMatchObject({
    code: 3,
    stdout: "",
    stderr: expect.stringContaining("FEATURE_BRANCH_NOT_FOUND"),
  });
  expect(
    (await inspectRun(repository, runId)).snapshot.git?.worktreeStatus,
  ).toBe("ready");
});

test.each([
  [
    "missing Feature worktree",
    "FEATURE_WORKTREE_NOT_FOUND",
    async (path: string) => {
      await run("git", ["-C", path, "worktree", "remove", path]);
    },
  ],
  [
    "missing registration",
    "WORKTREE_REGISTRATION_NOT_FOUND",
    async (path: string) => {
      await run("git", ["-C", path, "worktree", "remove", path]);
    },
  ],
  [
    "detached HEAD",
    "WORKTREE_INVARIANT_VIOLATION",
    async (path: string) => {
      await run("git", ["-C", path, "checkout", "--detach", "--quiet"]);
    },
  ],
  [
    "advanced HEAD",
    "WORKTREE_INVARIANT_VIOLATION",
    async (path: string) => {
      await writeFile(join(path, "advanced.txt"), "advanced\n");
      await run("git", ["-C", path, "add", "advanced.txt"]);
      await run("git", ["-C", path, "commit", "--quiet", "-m", "advanced"]);
    },
  ],
  [
    "missing Feature branch",
    "FEATURE_BRANCH_NOT_FOUND",
    async (path: string, branch: string) => {
      await run("git", ["-C", path, "checkout", "--detach", "--quiet"]);
      await run("git", ["-C", path, "branch", "-D", branch]);
    },
  ],
  [
    "wrong Feature branch",
    "WORKTREE_INVARIANT_VIOLATION",
    async (path: string) => {
      await run("git", [
        "-C",
        path,
        "checkout",
        "-b",
        "other-feature",
        "--quiet",
      ]);
    },
  ],
  [
    "tracked changes",
    "DIRTY_WORKTREE",
    async (path: string) => {
      await writeFile(join(path, "specs", "feature.md"), "changed\n");
    },
  ],
  [
    "non-ignored untracked files",
    "UNTRACKED_WORKTREE",
    async (path: string) => {
      await writeFile(join(path, "untracked.txt"), "untracked\n");
    },
  ],
] as const)(
  "flow rejects %s without repairing persisted state",
  async (_label, code, mutate) => {
    const repository = await createCommittedTargetRepository();
    const runId = "run_20260904T120000Z_131313131313";
    await createExplicitRun(repository, runId);
    const prepared = JSON.parse(
      (
        await run(executable, [
          "worktree",
          "prepare",
          "--repo",
          repository,
          "--run",
          runId,
          "--json",
        ])
      ).stdout,
    ) as { git: { featureWorktree: string; featureBranch: string } };
    const statePath = join(
      repository,
      ".orchestrator",
      "runs",
      runId,
      "state.json",
    );
    const historyPath = join(
      repository,
      ".orchestrator",
      "runs",
      runId,
      "history.jsonl",
    );
    const beforeState = await readFile(statePath, "utf8");
    const beforeHistory = await readFile(historyPath, "utf8");
    await mutate(prepared.git.featureWorktree, prepared.git.featureBranch);
    if (_label === "missing registration")
      await mkdir(prepared.git.featureWorktree, { recursive: true });

    await expect(
      run(executable, [
        "worktree",
        "validate",
        "--repo",
        repository,
        "--run",
        runId,
        "--json",
      ]),
    ).rejects.toMatchObject({
      code:
        _label === "missing Feature worktree" ||
        _label === "missing registration" ||
        _label === "missing Feature branch"
          ? 3
          : 4,
      stdout: "",
      stderr: expect.stringContaining(code),
    });
    expect(await readFile(statePath, "utf8")).toBe(beforeState);
    expect(await readFile(historyPath, "utf8")).toBe(beforeHistory);
  },
);

test("flow permits ignored files during baseline validation", async () => {
  const repository = await createCommittedTargetRepository();
  await writeFile(join(repository, ".gitignore"), "ignored.txt\n");
  await run("git", ["-C", repository, "add", ".gitignore"]);
  await run("git", ["-C", repository, "commit", "--quiet", "-m", "ignore"]);
  const runId = "run_20260904T120000Z_141414141414";
  await createExplicitRun(repository, runId);
  const prepared = JSON.parse(
    (
      await run(executable, [
        "worktree",
        "prepare",
        "--repo",
        repository,
        "--run",
        runId,
        "--json",
      ])
    ).stdout,
  ) as { git: { featureWorktree: string } };
  await writeFile(
    join(prepared.git.featureWorktree, "ignored.txt"),
    "ignored\n",
  );

  const { stdout } = await run(executable, [
    "worktree",
    "validate",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  expect(JSON.parse(stdout)).toMatchObject({
    valid: true,
    checks: { cleanliness: { valid: true } },
  });
});

test("flow reports a Feature worktree from a different Git repository", async () => {
  const repository = await createCommittedTargetRepository();
  const otherRepository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_151515151515";
  await createExplicitRun(repository, runId);
  const prepared = JSON.parse(
    (
      await run(executable, [
        "worktree",
        "prepare",
        "--repo",
        repository,
        "--run",
        runId,
        "--json",
      ])
    ).stdout,
  ) as { git: { featureWorktree: string } };
  await writeFile(
    join(prepared.git.featureWorktree, ".git"),
    `gitdir: ${join(otherRepository, ".git")}\n`,
  );

  await expect(
    run(executable, [
      "worktree",
      "validate",
      "--repo",
      repository,
      "--run",
      runId,
      "--json",
    ]),
  ).rejects.toMatchObject({
    code: 4,
    stdout: "",
    stderr: expect.stringContaining("GIT_INVARIANT_VIOLATION"),
  });
});

test("flow validates without acquiring the run mutation lock", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_161616161616";
  await createExplicitRun(repository, runId);
  const prepared = JSON.parse(
    (
      await run(executable, [
        "worktree",
        "prepare",
        "--repo",
        repository,
        "--run",
        runId,
        "--json",
      ])
    ).stdout,
  );
  const lock = await acquireRunLock(repository, runId);
  try {
    const { stdout } = await run(executable, [
      "worktree",
      "validate",
      "--repo",
      repository,
      "--run",
      runId,
      "--json",
    ]);
    expect(JSON.parse(stdout)).toMatchObject({
      runId,
      valid: true,
      git: prepared.git,
    });
  } finally {
    await releaseRunLock(lock);
  }
});

test("failed Git execution preserves the synchronized preparation intent", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_909090909090";
  await createExplicitRun(repository, runId);

  await expect(
    prepareWorktree(
      { repository, runId },
      {
        gitRunner: async () => {
          throw new FlowError(
            "injected worktree failure",
            3,
            "WORKTREE_CREATION_FAILED",
          );
        },
      },
    ),
  ).rejects.toMatchObject({ code: "WORKTREE_CREATION_FAILED", exitCode: 3 });

  const interrupted = await inspectRun(repository, runId);
  expect(interrupted.snapshot).toMatchObject({
    phase: "preparing",
    git: { worktreeStatus: "planned" },
  });
  expect(interrupted.operationalHistory).toHaveLength(2);
});

test("flow persists explicit base, branch, and caller-relative worktree inputs", async () => {
  const repository = await createCommittedTargetRepository();
  const caller = await temporaryDirectory();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);
  const base = await gitOutput(repository, ["rev-parse", "HEAD"]);

  const { stdout } = await run(
    executable,
    [
      "worktree",
      "prepare",
      "--repo",
      repository,
      "--run",
      runId,
      "--base",
      "HEAD",
      "--branch",
      "feature/custom",
      "--worktree",
      "relative-feature-worktree",
      "--json",
    ],
    { cwd: caller },
  );

  const canonicalCaller = await realpath(caller);
  expect(JSON.parse(stdout)).toMatchObject({
    git: {
      runBase: base,
      featureBranch: "feature/custom",
      featureWorktree: join(canonicalCaller, "relative-feature-worktree"),
    },
  });
});

test("flow supports SHA-256 Target repositories without truncating commits", async () => {
  const repository = await temporaryDirectory();
  await run("git", ["init", "--quiet", "--object-format=sha256", repository]);
  await run("git", [
    "-C",
    repository,
    "config",
    "user.email",
    "test@example.com",
  ]);
  await run("git", ["-C", repository, "config", "user.name", "Test User"]);
  await mkdir(join(repository, "specs"));
  await writeFile(join(repository, "specs", "feature.md"), "# Feature\n");
  await run("git", ["-C", repository, "add", "."]);
  await run("git", ["-C", repository, "commit", "--quiet", "-m", "initial"]);
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);

  const { stdout } = await run(executable, [
    "worktree",
    "prepare",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  const result = JSON.parse(stdout);
  expect(result.git.runBase).toMatch(/^[0-9a-f]{64}$/);
  expect(result.git.validatedHead).toBe(result.git.runBase);
});

test("flow refuses an unborn Target repository before preparing", async () => {
  const repository = await createTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);

  await expect(
    run(executable, [
      "worktree",
      "prepare",
      "--repo",
      repository,
      "--run",
      runId,
    ]),
  ).rejects.toMatchObject({
    code: 4,
    stdout: "",
    stderr: expect.stringContaining("unborn"),
  });
});

test("flow refuses a Target repository checked out as a submodule", async () => {
  const superproject = await createCommittedTargetRepository();
  const child = await createCommittedTargetRepository();
  await run("git", [
    "-C",
    superproject,
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    "--quiet",
    child,
    "vendor/child",
  ]);
  await run("git", ["-C", superproject, "add", "."]);
  await run("git", [
    "-C",
    superproject,
    "commit",
    "--quiet",
    "-m",
    "submodule",
  ]);
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(join(superproject, "vendor", "child"), runId);

  await expect(
    run(executable, [
      "worktree",
      "prepare",
      "--repo",
      join(superproject, "vendor", "child"),
      "--run",
      runId,
    ]),
  ).rejects.toMatchObject({
    code: 4,
    stdout: "",
    stderr: expect.stringContaining("submodule"),
  });
});

test("flow refuses branch and worktree collisions before persisting preparation", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);
  await run("git", ["-C", repository, "branch", "existing"]);
  const statePath = join(
    repository,
    ".orchestrator",
    "runs",
    runId,
    "state.json",
  );
  const before = await readFile(statePath, "utf8");

  await expect(
    run(executable, [
      "worktree",
      "prepare",
      "--repo",
      repository,
      "--run",
      runId,
      "--branch",
      "existing",
    ]),
  ).rejects.toMatchObject({ code: 3, stdout: "" });
  expect(await readFile(statePath, "utf8")).toBe(before);

  const registeredPath = await temporaryDirectory();
  await run("git", [
    "-C",
    repository,
    "worktree",
    "add",
    "--quiet",
    "--detach",
    registeredPath,
  ]);
  const secondRunId = "run_20260904T120001Z_012345abcdee";
  await createExplicitRun(repository, secondRunId);
  await expect(
    run(executable, [
      "worktree",
      "prepare",
      "--repo",
      repository,
      "--run",
      secondRunId,
      "--worktree",
      join(registeredPath, "nested"),
    ]),
  ).rejects.toMatchObject({ code: 4, stdout: "" });
});

test("flow refuses symlinked Feature worktree path components", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(repository, runId);
  const caller = await temporaryDirectory();
  const redirected = await temporaryDirectory();
  await symlink(redirected, join(caller, "redirected"));

  await expect(
    run(
      executable,
      [
        "worktree",
        "prepare",
        "--repo",
        repository,
        "--run",
        runId,
        "--worktree",
        "redirected/feature",
      ],
      { cwd: caller },
    ),
  ).rejects.toMatchObject({
    code: 4,
    stdout: "",
    stderr: expect.stringContaining("symbolic link"),
  });
});

test("flow prepares a run whose Target repository is a linked worktree", async () => {
  const mainRepository = await createCommittedTargetRepository();
  const linkedRepository = join(await temporaryDirectory(), "linked-target");
  await run("git", [
    "-C",
    mainRepository,
    "worktree",
    "add",
    "--quiet",
    linkedRepository,
  ]);
  const runId = "run_20260904T120000Z_012345abcdef";
  await createExplicitRun(linkedRepository, runId);

  const { stdout } = await run(executable, [
    "worktree",
    "prepare",
    "--repo",
    linkedRepository,
    "--run",
    runId,
    "--json",
  ]);
  expect(JSON.parse(stdout)).toMatchObject({
    runId,
    phase: "implementing",
    git: { worktreeStatus: "ready" },
  });
});

test("flow executes one ticket through a fake Herdr worker and accepts its checkpoint", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260906T120000Z_030303030303";
  const ticket = "tickets/03-ship-widget.md";
  await mkdir(join(repository, "tickets"));
  await writeFile(
    join(repository, ticket),
    "# Ship widget\n\nImplement the widget.\n",
  );
  await run(executable, ["setup", "--repo", repository]);
  await createExplicitRun(repository, runId);
  const prepared = await prepareFeatureWorktree(repository, runId);

  const fakeDirectory = await temporaryDirectory();
  const fake = join(fakeDirectory, "herdr");
  const state = join(fakeDirectory, "state.json");
  const promptPath = join(fakeDirectory, "prompt.txt");
  await writeFile(
    fake,
    `#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") console.log("fake-herdr 0.8.2");
else if (args[0] === "pane" && args[1] === "split") console.log(JSON.stringify({result:{pane:{pane_id:"fake:worker"}}}));
else if (args[0] === "agent" && args[1] === "start") {
  const delimiter = args.indexOf("--");
  const child = args.slice(delimiter + 1);
  const worktree = child[child.indexOf("-C") + 1];
  const output = child[child.indexOf("--add-dir") + 1];
  writeFileSync(process.env.FAKE_STATE, JSON.stringify({ worktree, output, name: args[2] }));
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:worker",agent_status:"idle"}}}));
}
else if (args[0] === "agent" && args[1] === "prompt") {
  const prompt = args[3];
  writeFileSync(process.env.FAKE_PROMPT, prompt);
  const current = JSON.parse(readFileSync(process.env.FAKE_STATE, "utf8"));
  const ticket = prompt.match(/- Ticket: ([^\\n]+)/)[1];
  const resultPath = prompt.match(/Write the structured execution result to: "([^"]+)"/)[1];
  writeFileSync(current.worktree + "/worker-change.txt", "implemented\\n");
  execFileSync("git", ["-C", current.worktree, "add", "worker-change.txt"]);
  execFileSync("git", ["-C", current.worktree, "commit", "--quiet", "-m", "worker implementation"]);
  const commit = execFileSync("git", ["-C", current.worktree, "rev-parse", "HEAD"], {encoding:"utf8"}).trim();
  const temporary = resultPath + ".tmp";
  writeFileSync(temporary, JSON.stringify({schemaVersion:1,ticketId:ticket,status:"completed",summary:"Implemented widget.",commit,commands:[{command:"git commit",status:"passed",exitCode:0}]}));
  renameSync(temporary, resultPath);
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:worker",agent_status:"done"}}}));
}
else if (args[0] === "agent" && args[1] === "read") process.stdout.write("fake worker completed\\n");
else if (args[0] === "pane" && args[1] === "close") console.log("{}");
else process.exit(2);
`,
    "utf8",
  );
  await chmod(fake, 0o755);

  const { stdout } = await run(
    executable,
    [
      "worker",
      "execute",
      "--repo",
      repository,
      "--run",
      runId,
      "--ticket",
      ticket,
      "--json",
    ],
    {
      cwd: repository,
      env: {
        ...process.env,
        HERDR_ENV: "1",
        HERDR_PANE_ID: "caller",
        HERDR_BIN_PATH: fake,
        FAKE_STATE: state,
        FAKE_PROMPT: promptPath,
      },
    },
  );
  const report = JSON.parse(stdout) as {
    status: string;
    executionId: string;
    ticketId: string;
    attemptId: string;
    acceptedCommit: string;
    artifacts: { input: string; record: string; output: string };
    snapshot: {
      phase: string;
      git?: { validatedHead?: string };
      activeExecution?: unknown;
      lastExecution?: { ticketId: string };
    };
  };
  expect(report).toMatchObject({
    status: "accepted",
    ticketId: "03-ship-widget",
    snapshot: {
      phase: "implementing",
      git: { validatedHead: report.acceptedCommit },
      lastExecution: { ticketId: "03-ship-widget" },
    },
  });
  expect(report.snapshot.activeExecution).toBeUndefined();
  expect(await readFile(report.artifacts.input, "utf8")).toContain(
    "Ship widget",
  );
  expect(await readFile(promptPath, "utf8")).toContain(
    `$implement "${report.artifacts.input}"`,
  );
  expect(
    JSON.parse(await readFile(report.artifacts.output, "utf8")),
  ).toMatchObject({
    status: "completed",
    ticketId: "03-ship-widget",
    commit: report.acceptedCommit,
  });
  expect(
    JSON.parse(await readFile(report.artifacts.record, "utf8")),
  ).toMatchObject({
    status: "accepted",
    cleanup: { status: "closed" },
    herdr: { paneId: "fake:worker" },
  });
  expect(
    await gitOutput(prepared.featureWorktree, ["log", "-1", "--format=%s"]),
  ).toBe("worker implementation");
  const repeated = await run(
    executable,
    [
      "worker",
      "execute",
      "--repo",
      repository,
      "--run",
      runId,
      "--ticket",
      ticket,
      "--json",
    ],
    {
      cwd: repository,
      env: {
        ...process.env,
        HERDR_ENV: "1",
        HERDR_PANE_ID: "caller",
        HERDR_BIN_PATH: fake,
        FAKE_STATE: state,
        FAKE_PROMPT: promptPath,
      },
    },
  );
  expect(JSON.parse(repeated.stdout)).toMatchObject({
    status: "accepted",
    attemptId: report.attemptId,
    executionId: report.executionId,
  });
  const reconciled = await run(executable, [
    "worker",
    "reconcile",
    "--repo",
    repository,
    "--run",
    runId,
    "--attempt",
    report.attemptId,
    "--json",
  ]);
  expect(JSON.parse(reconciled.stdout)).toMatchObject({
    status: "accepted",
    outcome: "accepted",
    code: "WORKER_ATTEMPT_ACCEPTED",
  });
  const historyEvents = (
    await run(executable, [
      "history",
      "--repo",
      repository,
      "--run",
      runId,
      "--json",
    ])
  ).stdout;
  expect(
    JSON.parse(historyEvents).map((event: { type: string }) => event.type),
  ).toEqual([
    "run.created",
    "git.preparation.started",
    "git.worktree.prepared",
    "worker.attempt.prepared",
    "worker.attempt.started",
    "worker.attempt.accepted",
  ]);
});

test("worker reconcile classifies a missing result as conclusive failure", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260906T120000Z_040404040404";
  await run(executable, ["setup", "--repo", repository]);
  await createExplicitRun(repository, runId);
  const prepared = await prepareFeatureWorktree(repository, runId);
  const attempt = await createReconciliationAttempt(
    repository,
    runId,
    prepared.featureWorktree,
    "04-missing-result",
  );

  const result = await run(
    executable,
    [
      "worker",
      "reconcile",
      "--repo",
      repository,
      "--run",
      runId,
      "--attempt",
      attempt.attemptId,
      "--json",
    ],
    { cwd: repository },
  )
    .then((value) => ({ ...value, code: 0 }))
    .catch((error: unknown) => error as { stdout: string; code: number });
  const report = JSON.parse(result.stdout);
  expect(result.code).toBe(1);
  expect(report).toMatchObject({
    status: "failed",
    outcome: "conclusive-failure",
    code: "WORKER_EXECUTION_FAILED",
    evidence: { result: "missing", clean: true },
    snapshot: { phase: "implementing" },
  });
  expect(report.snapshot.activeExecution).toBeUndefined();
  expect(JSON.parse(await readFile(attempt.record, "utf8"))).toMatchObject({
    status: "failed",
  });
});

test("worker reconcile blocks an explicit Worker blocker and preserves its evidence", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260906T120000Z_050505050505";
  await run(executable, ["setup", "--repo", repository]);
  await createExplicitRun(repository, runId);
  const prepared = await prepareFeatureWorktree(repository, runId);
  const attempt = await createReconciliationAttempt(
    repository,
    runId,
    prepared.featureWorktree,
    "04-blocked-worker",
    {
      schemaVersion: 1,
      ticketId: "04-blocked-worker",
      status: "blocked",
      summary: "A product decision is required.",
      blocker: { type: "product-decision", decision: "Choose the API shape." },
    },
  );

  const result = await run(
    executable,
    [
      "worker",
      "reconcile",
      "--repo",
      repository,
      "--run",
      runId,
      "--attempt",
      attempt.attemptId,
      "--json",
    ],
    { cwd: repository },
  )
    .then((value) => ({ ...value, code: 0 }))
    .catch((error: unknown) => error as { stdout: string; code: number });
  const report = JSON.parse(result.stdout);
  expect(result.code).toBe(4);
  expect(report).toMatchObject({
    status: "blocked",
    outcome: "reconciliation-required",
    evidence: { result: "blocked", clean: true },
    snapshot: { phase: "blocked", interruptedPhase: "implementing" },
  });
  expect(JSON.parse(await readFile(attempt.output, "utf8"))).toMatchObject({
    status: "blocked",
  });
});

test("worker reconcile treats a failed result with Git effects as ambiguous", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260906T120000Z_060606060606";
  await run(executable, ["setup", "--repo", repository]);
  await createExplicitRun(repository, runId);
  const prepared = await prepareFeatureWorktree(repository, runId);
  const attempt = await createReconciliationAttempt(
    repository,
    runId,
    prepared.featureWorktree,
    "04-failed-with-effects",
    {
      schemaVersion: 1,
      ticketId: "04-failed-with-effects",
      status: "failed",
      summary: "The worker encountered a technical failure.",
      diagnostics: { message: "test failure" },
    },
  );
  await writeFile(
    join(prepared.featureWorktree, "unreconciled.txt"),
    "effect\n",
  );

  const result = await run(
    executable,
    [
      "worker",
      "reconcile",
      "--repo",
      repository,
      "--run",
      runId,
      "--attempt",
      attempt.attemptId,
      "--json",
    ],
    { cwd: repository },
  )
    .then((value) => ({ ...value, code: 0 }))
    .catch((error: unknown) => error as { stdout: string; code: number });
  const report = JSON.parse(result.stdout);
  expect(result.code).toBe(4);
  expect(report).toMatchObject({
    status: "blocked",
    outcome: "reconciliation-required",
    evidence: { result: "failed", clean: false },
  });
  expect(
    await pathExists(join(prepared.featureWorktree, "unreconciled.txt")),
  ).toBe(true);
});

test("worker reconcile rejects unexpected output artifacts and preserves them", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260906T120000Z_070707070707";
  await run(executable, ["setup", "--repo", repository]);
  await createExplicitRun(repository, runId);
  const prepared = await prepareFeatureWorktree(repository, runId);
  const attempt = await createReconciliationAttempt(
    repository,
    runId,
    prepared.featureWorktree,
    "07-output-boundary",
  );
  const unexpected = attempt.output.replace("result.json", "partial.tmp");
  await writeFile(unexpected, "partial\n");

  const result = await run(executable, [
    "worker",
    "reconcile",
    "--repo",
    repository,
    "--run",
    runId,
    "--attempt",
    attempt.attemptId,
    "--json",
  ])
    .then((value) => ({ ...value, code: 0 }))
    .catch((error: unknown) => error as { stdout: string; code: number });
  const report = JSON.parse(result.stdout);
  expect(result.code).toBe(4);
  expect(report).toMatchObject({
    status: "blocked",
    evidence: { result: "invalid" },
  });
  await expect(readFile(unexpected, "utf8")).resolves.toBe("partial\n");
});

test("worker reconcile refuses a concurrently claimed attempt", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260906T120000Z_080808080808";
  await run(executable, ["setup", "--repo", repository]);
  await createExplicitRun(repository, runId);
  const prepared = await prepareFeatureWorktree(repository, runId);
  const attempt = await createReconciliationAttempt(
    repository,
    runId,
    prepared.featureWorktree,
    "08-claim-contention",
  );
  const claim = attempt.record.replace("execution.json", ".reconcile.lock");
  await writeFile(
    claim,
    JSON.stringify({
      pid: process.pid,
      token: "held",
      acquiredAt: new Date().toISOString(),
    }),
  );

  await expect(
    run(executable, [
      "worker",
      "reconcile",
      "--repo",
      repository,
      "--run",
      runId,
      "--attempt",
      attempt.attemptId,
      "--json",
    ]),
  ).rejects.toMatchObject({ code: 5, stdout: "" });
});

test("worker reconcile blocks a replaced Execution record", async () => {
  const repository = await createCommittedTargetRepository();
  const runId = "run_20260906T120000Z_090909090909";
  await run(executable, ["setup", "--repo", repository]);
  await createExplicitRun(repository, runId);
  const prepared = await prepareFeatureWorktree(repository, runId);
  const attempt = await createReconciliationAttempt(
    repository,
    runId,
    prepared.featureWorktree,
    "09-record-ownership",
  );
  const recordValue = JSON.parse(await readFile(attempt.record, "utf8"));
  recordValue.ownership = {
    token: "test-owner",
    fingerprint: "0".repeat(64),
  };
  await writeFile(attempt.record, `${JSON.stringify(recordValue)}\n`);
  await writeFile(
    attempt.record.replace("execution.json", "ownership.json"),
    `${JSON.stringify(recordValue.ownership)}\n`,
  );

  const result = await run(executable, [
    "worker",
    "reconcile",
    "--repo",
    repository,
    "--run",
    runId,
    "--attempt",
    attempt.attemptId,
    "--json",
  ])
    .then((value) => ({ ...value, code: 0 }))
    .catch((error: unknown) => error as { stdout: string; code: number });
  const report = JSON.parse(result.stdout);
  expect(result.code).toBe(4);
  expect(report).toMatchObject({
    status: "blocked",
    evidence: { result: "invalid" },
  });
  expect(JSON.parse(await readFile(attempt.record, "utf8"))).toMatchObject({
    ownership: { token: "test-owner" },
  });
});

test("worker reconcile exposes a non-launching command help contract", async () => {
  const { stdout, stderr } = await run(
    executable,
    ["worker", "reconcile", "--help"],
    {
      cwd: outsideInstallationRoot,
    },
  );
  expect(stderr).toBe("");
  expect(stdout).toContain(
    "Inspect an existing Worker attempt without prompting or launching an agent.",
  );
});

async function createExplicitRun(
  repository: string,
  runId: string,
): Promise<void> {
  await run(executable, [
    "run",
    "create",
    "--repo",
    repository,
    "--spec",
    "specs/feature.md",
    "--run",
    runId,
  ]);
}

async function createReconciliationAttempt(
  repository: string,
  runId: string,
  worktree: string,
  ticketId: string,
  result?: Record<string, unknown>,
): Promise<{ attemptId: string; record: string; output: string }> {
  const attemptId = "attempt-01";
  const canonicalRepository = await realpath(repository);
  const directory = join(
    canonicalRepository,
    ".orchestrator",
    "runs",
    runId,
    "workers",
    ticketId,
    attemptId,
  );
  const input = join(directory, "input", "ticket.md");
  const record = join(directory, "execution.json");
  const output = join(directory, "output", "result.json");
  await mkdir(join(directory, "input"), { recursive: true });
  await mkdir(join(directory, "output"), { recursive: true });
  const contents = `# ${ticketId}\n`;
  await writeFile(input, contents);
  const timestamp = "2026-09-06T12:00:00.000Z";
  await writeFile(
    record,
    `${JSON.stringify({
      schemaVersion: 1,
      executionId: `exec_${ticketId}`,
      runId,
      ticketId,
      attemptId,
      attempt: 1,
      status: "reconciling",
      role: "worker",
      agentProfile: "codex",
      agentKind: "codex",
      skill: "implement",
      ticket: {
        source: `tickets/${ticketId}.md`,
        input,
        hash: createHash("sha256").update(contents).digest("hex"),
      },
      worktree,
      artifacts: { directory, input, record, output },
      promptHash: "0".repeat(64),
      timestamps: { preparedAt: timestamp, startedAt: timestamp },
    })}\n`,
  );
  await mutateRun({
    repository,
    runId,
    event: "checkpoint",
    preserveLifecycle: true,
    historyEventType: "worker.attempt.prepared",
    data: { executionId: `exec_${ticketId}`, ticketId, attemptId },
    updateSnapshot: () => ({
      activeExecution: {
        executionId: `exec_${ticketId}`,
        ticketId,
        attemptId,
        path: record,
      },
    }),
  });
  if (result) await writeFile(output, `${JSON.stringify(result)}\n`);
  return { attemptId, record, output };
}

async function prepareFeatureWorktree(
  repository: string,
  runId: string,
): Promise<{
  featureBranch: string;
  featureWorktree: string;
  runBase: string;
  revision: number;
}> {
  const { stdout } = await run(executable, [
    "worktree",
    "prepare",
    "--repo",
    repository,
    "--run",
    runId,
    "--json",
  ]);
  const result = JSON.parse(stdout) as {
    revision: number;
    git: {
      featureBranch: string;
      featureWorktree: string;
      runBase: string;
    };
  };
  return { revision: result.revision, ...result.git };
}

async function prepareTerminalWorktree(
  repository: string,
  runId: string,
): Promise<{
  featureBranch: string;
  featureWorktree: string;
  runBase: string;
  revision: number;
}> {
  const prepared = await prepareFeatureWorktree(repository, runId);
  await mutateRun({ repository, runId, event: "review" });
  await mutateRun({ repository, runId, event: "check" });
  await mutateRun({ repository, runId, event: "complete" });
  return prepared;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function createCommittedTargetRepository(): Promise<string> {
  const repository = await createTargetRepository();
  await run("git", [
    "-C",
    repository,
    "config",
    "user.email",
    "test@example.com",
  ]);
  await run("git", ["-C", repository, "config", "user.name", "Test User"]);
  await run("git", ["-C", repository, "add", "."]);
  await run("git", ["-C", repository, "commit", "--quiet", "-m", "initial"]);
  return repository;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "flow-invalid-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function createBareRepository(): Promise<string> {
  const repository = await temporaryDirectory();
  await run("git", ["init", "--quiet", "--bare", repository]);
  return repository;
}

async function gitOutput(repository: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", repository, ...args]);
  return stdout.trim();
}

// --- Phase 6: deterministic Workflow package validation ---

async function writeValidationConfiguration(
  repository: string,
  commands: {
    test: string;
    lint: string;
    typecheck: string;
    formatCheck?: string;
    build?: string;
    timeoutSeconds?: number;
  },
): Promise<void> {
  await mkdir(join(repository, ".orchestrator"), { recursive: true });
  await writeFile(
    join(repository, ".orchestrator", "config.yaml"),
    `version: 1\n\nagents:\n  codex:\n    kind: codex\n\nroles:\n  worker:\n    agent: codex\n    skill: implement\n\nworkflow:\n  workerTimeoutSeconds: 1800\n  maxWorkerAttempts: 2\n  validation:\n    test: ${JSON.stringify(commands.test)}\n    lint: ${JSON.stringify(commands.lint)}\n    typecheck: ${JSON.stringify(commands.typecheck)}\n    formatCheck: ${JSON.stringify(commands.formatCheck ?? "exit 0")}\n    build: ${JSON.stringify(commands.build ?? "exit 0")}\n    timeoutSeconds: ${commands.timeoutSeconds ?? 60}\n`,
    "utf8",
  );
}

async function writeWorkflowPackage(
  repository: string,
  tickets: string[],
): Promise<string> {
  const packageDirectory = join(repository, "feature");
  await mkdir(join(packageDirectory, "issues"), { recursive: true });
  await writeFile(join(packageDirectory, "spec.md"), "# Feature\n");
  for (const ticket of tickets)
    await writeFile(
      join(packageDirectory, "issues", `${ticket}.md`),
      `# ${ticket}\n`,
    );
  return packageDirectory;
}

async function writeFakeHerdrWorker(): Promise<{
  directory: string;
  environment: NodeJS.ProcessEnv;
}> {
  const directory = await temporaryDirectory();
  const fake = join(directory, "herdr");
  const state = join(directory, "state.json");
  await writeFile(
    fake,
    `#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") console.log("fake-herdr 1.0.0");
else if (args[0] === "pane" && args[1] === "split") console.log(JSON.stringify({result:{pane:{pane_id:"fake:worker"}}}));
else if (args[0] === "agent" && args[1] === "start") {
  const child = args.slice(args.indexOf("--") + 1);
  const worktree = child[child.indexOf("-C") + 1];
  writeFileSync(process.env.FAKE_STATE, JSON.stringify({worktree}));
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:worker",agent_status:"idle"}}}));
} else if (args[0] === "agent" && args[1] === "prompt") {
  const current = JSON.parse(readFileSync(process.env.FAKE_STATE, "utf8"));
  const prompt = args[3];
  const ticket = prompt.match(/- Ticket: ([^\\n]+)/)[1];
  const resultPath = prompt.match(/Write the structured execution result to: "([^"]+)"/)[1];
  const file = ticket.replace(/[^A-Za-z0-9_-]/g, "_") + ".txt";
  writeFileSync(current.worktree + "/" + file, ticket + "\\n");
  execFileSync("git", ["-C", current.worktree, "add", file]);
  execFileSync("git", ["-C", current.worktree, "commit", "--quiet", "-m", ticket]);
  const commit = execFileSync("git", ["-C", current.worktree, "rev-parse", "HEAD"], {encoding:"utf8"}).trim();
  writeFileSync(resultPath + ".tmp", JSON.stringify({schemaVersion:1,ticketId:ticket,status:"completed",summary:ticket,commit,commands:[]}));
  renameSync(resultPath + ".tmp", resultPath);
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:worker",agent_status:"done"}}}));
} else if (args[0] === "agent" && args[1] === "read") process.stdout.write("done\\n");
else if (args[0] === "pane" && args[1] === "close") console.log("{}");
else process.exit(2);
`,
    "utf8",
  );
  await chmod(fake, 0o755);
  return {
    directory,
    environment: {
      ...process.env,
      HERDR_ENV: "1",
      HERDR_PANE_ID: "caller",
      HERDR_BIN_PATH: fake,
      FAKE_STATE: state,
    },
  };
}

/** Run one orchestrate step per ticket until the package queue completes. */
async function completeWorkflowRun(
  repository: string,
  tickets: string[],
  environment: NodeJS.ProcessEnv,
  newRun = false,
): Promise<{
  runId: string;
  validatedHead: string;
  featureWorktree: string;
}> {
  let report:
    | {
        runId: string;
        acceptedCommit: string;
        snapshot: { git: { featureWorktree: string } };
      }
    | undefined;
  for (const ticket of tickets) {
    const arguments_ = [
      "orchestrate",
      "feature",
      ticket,
      "--repo",
      repository,
      "--json",
      ...(newRun ? ["--new-run"] : []),
    ];
    report = JSON.parse(
      (await run(executable, arguments_, { cwd: repository, env: environment }))
        .stdout,
    );
  }
  if (!report) throw new Error("no orchestrate step was executed");
  return {
    runId: report.runId,
    validatedHead: report.acceptedCommit,
    featureWorktree: report.snapshot.git.featureWorktree,
  };
}

async function writeRecordingCheck(
  directory: string,
  name: string,
  body = "",
): Promise<string> {
  const script = join(directory, name);
  await writeFile(
    script,
    `#!/usr/bin/env sh\nprintf '%s cwd=%s\\n' "$1" "$PWD" | tee -a "$FAKE_LOG"\n${body}\n`,
    "utf8",
  );
  await chmod(script, 0o755);
  return script;
}

interface ValidationInvocation {
  exitCode: number | undefined;
  stdout: string;
  stderr: string;
}

async function invokeValidation(
  packageReference: string,
  repository: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ValidationInvocation> {
  return run(
    executable,
    ["validate", packageReference, "--repo", repository, "--json"],
    {
      cwd: repository,
      env: environment,
    },
  ).then(
    ({ stdout }) => ({ exitCode: 0, stdout, stderr: "" }),
    (error: Error & { code?: number; stdout?: string; stderr?: string }) => ({
      exitCode: error.code,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    }),
  );
}

test("flow validate runs the configured checks in the Feature worktree and publishes one passed result", async () => {
  const repository = await createCommittedTargetRepository();
  await writeWorkflowPackage(repository, ["01-first", "02-second"]);
  const fakeDirectory = await temporaryDirectory();
  const check = await writeRecordingCheck(fakeDirectory, "check");
  const log = join(fakeDirectory, "checks.log");
  await writeValidationConfiguration(repository, {
    test: `${check} test`,
    lint: `${check} lint`,
    typecheck: `${check} typecheck`,
    formatCheck: `${check} formatCheck`,
    build: `${check} build`,
  });
  const { environment } = await writeFakeHerdrWorker();
  const completed = await completeWorkflowRun(
    repository,
    ["01-first", "02-second"],
    { ...environment, FAKE_LOG: log },
  );
  // Commit the package and configuration so the primary checkout is clean
  // before validation; only .orchestrator/runs/ stays ignored.
  await run("git", ["-C", repository, "add", "."]);
  await run("git", [
    "-C",
    repository,
    "commit",
    "--quiet",
    "-m",
    "package and validation configuration",
  ]);
  const primaryHeadBefore = await gitOutput(repository, ["rev-parse", "HEAD"]);

  const invocation = await invokeValidation("feature", repository, {
    ...environment,
    FAKE_LOG: log,
  });

  expect(invocation.exitCode).toBe(0);
  const report = JSON.parse(invocation.stdout) as {
    runId: string;
    repository: string;
    validatedHead: string;
    status: string;
    result: string;
    checks: Array<{
      name: string;
      command: string;
      status: string;
      exitCode: number | null;
      durationMs: number;
    }>;
  };
  expect(report).toMatchObject({
    schemaVersion: 1,
    runId: completed.runId,
    repository: await realpath(repository),
    validatedHead: completed.validatedHead,
    status: "passed",
    startedAt: expect.any(String),
    finishedAt: expect.any(String),
    git: {
      headAfterValidation: completed.validatedHead,
      cleanAfterValidation: true,
    },
  });
  expect(report.checks.map((check) => check.name)).toEqual([
    "test",
    "lint",
    "typecheck",
    "formatCheck",
    "build",
  ]);
  for (const check of report.checks) {
    expect(check.status).toBe("passed");
    expect(check.exitCode).toBe(0);
    expect(check.durationMs).toBeGreaterThanOrEqual(0);
  }
  expect(report.checks.map((check) => check.command)).toEqual([
    `${check} test`,
    `${check} lint`,
    `${check} typecheck`,
    `${check} formatCheck`,
    `${check} build`,
  ]);
  // All five commands executed sequentially in the Feature worktree.
  expect((await readFile(log, "utf8")).split("\n").filter(Boolean)).toEqual([
    `test cwd=${completed.featureWorktree}`,
    `lint cwd=${completed.featureWorktree}`,
    `typecheck cwd=${completed.featureWorktree}`,
    `formatCheck cwd=${completed.featureWorktree}`,
    `build cwd=${completed.featureWorktree}`,
  ]);

  const result = JSON.parse(
    await readFile(
      join(
        repository,
        ".orchestrator",
        "runs",
        completed.runId,
        "validation.json",
      ),
      "utf8",
    ),
  ) as {
    schemaVersion: number;
    runId: string;
    validatedHead: string;
    status: string;
    checks: Array<{ name: string; stdout?: string; stderr?: string }>;
    git: { headAfterValidation: string; cleanAfterValidation: boolean };
  };
  expect(result).toMatchObject({
    schemaVersion: 1,
    runId: completed.runId,
    validatedHead: completed.validatedHead,
    status: "passed",
  });
  // Structured CLI output includes the complete canonical artifact.
  expect(report).toMatchObject(result);
  expect(result.checks.map((check) => check.name)).toEqual([
    "test",
    "lint",
    "typecheck",
    "formatCheck",
    "build",
  ]);
  expect(result.checks[0]?.stdout).toContain("cwd=");
  expect(result.git).toMatchObject({
    headAfterValidation: completed.validatedHead,
    cleanAfterValidation: true,
  });

  const snapshot = JSON.parse(
    await readFile(
      join(repository, ".orchestrator", "runs", completed.runId, "state.json"),
      "utf8",
    ),
  ) as {
    phase: string;
    tickets: Record<string, { status: string; commit?: string }>;
    validation?: { status: string; validatedHead: string; result: string };
  };
  expect(snapshot.phase).toBe("completed");
  expect(snapshot.tickets["02-second"]?.commit).toBe(completed.validatedHead);
  expect(snapshot.validation).toEqual({
    status: "passed",
    validatedHead: completed.validatedHead,
    result: "validation.json",
    at: expect.any(String),
  });

  const history = (
    await readFile(
      join(
        repository,
        ".orchestrator",
        "runs",
        completed.runId,
        "history.jsonl",
      ),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string });
  expect(history.at(-1)?.type).toBe("workflow.validation.completed");
  expect(
    history.filter((event) => event.type === "workflow.validation.completed"),
  ).toHaveLength(1);

  // The primary checkout stays untouched.
  expect(await gitOutput(repository, ["rev-parse", "HEAD"])).toBe(
    primaryHeadBefore,
  );
  expect(await gitOutput(repository, ["status", "--porcelain"])).toBe("");
}, 30_000);

test("flow validate fails closed across the deterministic failure matrix", async () => {
  const scenarios: Array<{
    name: string;
    commands: {
      test: string;
      lint: string;
      typecheck: string;
      formatCheck?: string;
      build?: string;
    };
    timeoutSeconds?: number;
    assert: (
      invocation: ValidationInvocation,
      context: {
        featureWorktree: string;
      },
    ) => Promise<void>;
  }> = [];

  // Non-zero exit: all five checks are still attempted.
  scenarios.push({
    name: "non-zero exit",
    commands: {
      test: "exit 3",
      lint: "exit 0",
      typecheck: "exit 0",
    },
    assert: async (invocation) => {
      expect(invocation.exitCode).toBe(1);
      const report = JSON.parse(invocation.stdout) as {
        status: string;
        checks: Array<{ status: string; exitCode: number | null }>;
      };
      expect(report.status).toBe("failed");
      expect(report.checks.map((check) => check.status)).toEqual([
        "failed",
        "passed",
        "passed",
        "passed",
        "passed",
      ]);
      expect(report.checks[0]?.exitCode).toBe(3);
    },
  });

  // Missing executable: recorded as a failed check, never a pass.
  scenarios.push({
    name: "missing executable",
    commands: {
      test: "definitely-missing-executable-xyz",
      lint: "exit 0",
      typecheck: "exit 0",
    },
    assert: async (invocation) => {
      expect(invocation.exitCode).toBe(1);
      const report = JSON.parse(invocation.stdout) as {
        status: string;
        checks: Array<{ status: string; exitCode: number | null }>;
      };
      expect(report.status).toBe("failed");
      expect(report.checks[0]?.status).toBe("failed");
      expect(report.checks[0]?.exitCode).not.toBe(0);
      expect(report.checks.slice(1).map((check) => check.status)).toEqual([
        "passed",
        "passed",
        "passed",
        "passed",
      ]);
    },
  });

  // Timeout: the shell and its descendants are terminated as one owned group.
  scenarios.push({
    name: "timeout",
    timeoutSeconds: 1,
    commands: {
      test: "sh -c 'sleep 5 & wait'",
      lint: "exit 0",
      typecheck: "exit 0",
    },
    assert: async (invocation) => {
      expect(invocation.exitCode).toBe(1);
      const report = JSON.parse(invocation.stdout) as {
        status: string;
        checks: Array<{
          status: string;
          exitCode: number | null;
          durationMs: number;
        }>;
      };
      expect(report.status).toBe("failed");
      expect(report.checks[0]).toMatchObject({
        status: "timed_out",
        exitCode: null,
      });
      expect(report.checks[0]?.durationMs).toBeGreaterThanOrEqual(1_000);
      expect(report.checks[0]?.durationMs).toBeLessThan(3_000);
      expect(report.checks.slice(1).map((check) => check.status)).toEqual([
        "passed",
        "passed",
        "passed",
        "passed",
      ]);
    },
  });

  // The final two checks have the same failure contract as the earlier gates.
  for (const focused of [
    {
      name: "formatCheck non-zero exit",
      commands: { formatCheck: "exit 7" },
      index: 3,
      status: "failed",
      exitCode: 7,
    },
    {
      name: "formatCheck launch failure",
      commands: { formatCheck: "definitely-missing-format-check-xyz" },
      index: 3,
      status: "failed",
    },
    {
      name: "formatCheck timeout",
      commands: { formatCheck: "sh -c 'sleep 5 & wait'" },
      index: 3,
      status: "timed_out",
    },
    {
      name: "build non-zero exit",
      commands: { build: "exit 8" },
      index: 4,
      status: "failed",
      exitCode: 8,
    },
    {
      name: "build launch failure",
      commands: { build: "definitely-missing-build-xyz" },
      index: 4,
      status: "failed",
    },
    {
      name: "build timeout",
      commands: { build: "sh -c 'sleep 5 & wait'" },
      index: 4,
      status: "timed_out",
    },
  ] as const)
    scenarios.push({
      name: focused.name,
      commands: {
        test: "exit 0",
        lint: "exit 0",
        typecheck: "exit 0",
        ...focused.commands,
      },
      ...(focused.status === "timed_out" ? { timeoutSeconds: 1 } : {}),
      assert: async (invocation) => {
        expect(invocation.exitCode).toBe(1);
        const report = JSON.parse(invocation.stdout) as {
          status: string;
          checks: Array<{ status: string; exitCode: number | null }>;
        };
        expect(report.status).toBe("failed");
        expect(report.checks).toHaveLength(5);
        expect(report.checks[focused.index]?.status).toBe(focused.status);
        if (focused.exitCode !== undefined)
          expect(report.checks[focused.index]?.exitCode).toBe(focused.exitCode);
        expect(
          report.checks
            .filter((_, index) => index !== focused.index)
            .every((check) => check.status === "passed"),
        ).toBe(true);
      },
    });

  // A successful formatCheck that changes files fails validation and is never
  // cleaned; the mutation remains available for explicit recovery.
  scenarios.push({
    name: "dirty worktree after formatCheck",
    commands: {
      test: "exit 0",
      lint: "exit 0",
      typecheck: "exit 0",
      formatCheck: `touch ${join("validation-dirty.txt")}`,
    },
    assert: async (invocation, context) => {
      expect(invocation.exitCode).toBe(1);
      const report = JSON.parse(invocation.stdout);
      expect(report.status).toBe("failed");
      const result = JSON.parse(await readFile(report.result, "utf8"));
      expect(result.git.cleanAfterValidation).toBe(false);
      expect(result.git.reason).toContain("not clean after validation");
      await expect(
        lstat(join(context.featureWorktree, "validation-dirty.txt")),
      ).resolves.toBeTruthy();
      expect(
        await gitOutput(context.featureWorktree, ["status", "--porcelain"]),
      ).toContain("validation-dirty.txt");
    },
  });

  // A command that creates a commit cannot produce a passing result.
  scenarios.push({
    name: "changed HEAD",
    commands: {
      test: "git commit --quiet --allow-empty -m sneaky",
      lint: "exit 0",
      typecheck: "exit 0",
    },
    assert: async (invocation, context) => {
      expect(invocation.exitCode).toBe(1);
      const report = JSON.parse(invocation.stdout);
      expect(report.status).toBe("failed");
      const actualHead = await gitOutput(context.featureWorktree, [
        "rev-parse",
        "HEAD",
      ]);
      const result = JSON.parse(await readFile(report.result, "utf8"));
      expect(result.validatedHead).not.toBe(actualHead);
      expect(result.git.headAfterValidation).toBe(actualHead);
      expect(result.git.reason).toContain("HEAD changed during validation");
    },
  });

  for (const scenario of scenarios) {
    const repository = await createCommittedTargetRepository();
    await writeWorkflowPackage(repository, ["01-first"]);
    const recordingCheck = await writeRecordingCheck(
      await temporaryDirectory(),
      "unused",
    );
    await writeValidationConfiguration(repository, {
      test: scenario.commands.test,
      lint: `${recordingCheck} lint`,
      typecheck: `${recordingCheck} typecheck`,
      formatCheck:
        scenario.commands.formatCheck ?? `${recordingCheck} formatCheck`,
      build: scenario.commands.build ?? `${recordingCheck} build`,
      ...(scenario.timeoutSeconds === undefined
        ? {}
        : { timeoutSeconds: scenario.timeoutSeconds }),
    });
    const { environment } = await writeFakeHerdrWorker();
    const completed = await completeWorkflowRun(
      repository,
      ["01-first"],
      environment,
    );
    const matrixLog = join(await temporaryDirectory(), "checks.log");

    const invocation = await invokeValidation("feature", repository, {
      ...environment,
      FAKE_LOG: matrixLog,
    });

    await scenario.assert(invocation, {
      featureWorktree: completed.featureWorktree,
    });

    const snapshot = JSON.parse(
      await readFile(
        join(
          repository,
          ".orchestrator",
          "runs",
          completed.runId,
          "state.json",
        ),
        "utf8",
      ),
    );
    expect(snapshot.validation.status).toBe("failed");
    expect(snapshot.phase).toBe("completed");
  }
}, 45_000);

test("flow validate refuses before running any command when preconditions fail", async () => {
  const fakeDirectory = await temporaryDirectory();
  const check = await writeRecordingCheck(fakeDirectory, "check");
  const log = join(fakeDirectory, "checks.log");
  const commands = {
    test: `${check} test`,
    lint: `${check} lint`,
    typecheck: `${check} typecheck`,
  };
  const { environment } = await writeFakeHerdrWorker();
  const validationEnvironment = { ...environment, FAKE_LOG: log };

  async function assertRefused(
    invocation: ValidationInvocation,
    code: number,
    errorToken: string,
  ): Promise<void> {
    expect(invocation.exitCode).toBe(code);
    expect(invocation.stderr).toContain(errorToken);
    await expect(lstat(log)).rejects.toMatchObject({ code: "ENOENT" });
  }

  // Missing package match.
  const missingRepository = await createCommittedTargetRepository();
  await writeWorkflowPackage(missingRepository, ["01-first"]);
  await writeValidationConfiguration(missingRepository, commands);
  await assertRefused(
    await invokeValidation("feature", missingRepository, validationEnvironment),
    3,
    "RUN_NOT_FOUND",
  );

  // Incomplete Ticket queue.
  const incompleteRepository = await createCommittedTargetRepository();
  await writeWorkflowPackage(incompleteRepository, ["01-first", "02-second"]);
  await writeValidationConfiguration(incompleteRepository, commands);
  const incompleteWorker = await writeFakeHerdrWorker();
  await completeWorkflowRun(incompleteRepository, ["01-first"], {
    ...incompleteWorker.environment,
    FAKE_LOG: log,
  });
  await assertRefused(
    await invokeValidation(
      "feature",
      incompleteRepository,
      validationEnvironment,
    ),
    4,
    "WORKFLOW_NOT_COMPLETED",
  );

  // The package path still matches, but its contents no longer match the
  // immutable input captured by the completed run.
  const changedPackageRepository = await createCommittedTargetRepository();
  await writeWorkflowPackage(changedPackageRepository, ["01-first"]);
  await writeValidationConfiguration(changedPackageRepository, commands);
  const changedPackageWorker = await writeFakeHerdrWorker();
  await completeWorkflowRun(
    changedPackageRepository,
    ["01-first"],
    changedPackageWorker.environment,
  );
  await writeFile(
    join(changedPackageRepository, "feature", "spec.md"),
    "# Changed feature\n",
  );
  await assertRefused(
    await invokeValidation(
      "feature",
      changedPackageRepository,
      validationEnvironment,
    ),
    3,
    "WORKFLOW_PACKAGE_CHANGED",
  );

  // Dirty Feature worktree before execution.
  const dirtyRepository = await createCommittedTargetRepository();
  await writeWorkflowPackage(dirtyRepository, ["01-first"]);
  await writeValidationConfiguration(dirtyRepository, commands);
  const dirtyWorker = await writeFakeHerdrWorker();
  const dirtyRun = await completeWorkflowRun(
    dirtyRepository,
    ["01-first"],
    dirtyWorker.environment,
  );
  await writeFile(join(dirtyRun.featureWorktree, "untracked.txt"), "x\n");
  await assertRefused(
    await invokeValidation("feature", dirtyRepository, validationEnvironment),
    4,
    "UNTRACKED_WORKTREE",
  );

  // Feature worktree HEAD differs from the final accepted Git checkpoint.
  const staleRepository = await createCommittedTargetRepository();
  await writeWorkflowPackage(staleRepository, ["01-first"]);
  await writeValidationConfiguration(staleRepository, commands);
  const staleWorker = await writeFakeHerdrWorker();
  const staleRun = await completeWorkflowRun(
    staleRepository,
    ["01-first"],
    staleWorker.environment,
  );
  await run("git", [
    "-C",
    staleRun.featureWorktree,
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "external",
  ]);
  await assertRefused(
    await invokeValidation("feature", staleRepository, validationEnvironment),
    4,
    "WORKTREE_INVARIANT_VIOLATION",
  );

  // Ambiguous completed runs for the same package.
  const ambiguousRepository = await createCommittedTargetRepository();
  await writeWorkflowPackage(ambiguousRepository, ["01-first"]);
  await writeValidationConfiguration(ambiguousRepository, commands);
  const ambiguousWorker = await writeFakeHerdrWorker();
  await completeWorkflowRun(
    ambiguousRepository,
    ["01-first"],
    ambiguousWorker.environment,
  );
  await completeWorkflowRun(
    ambiguousRepository,
    ["01-first"],
    ambiguousWorker.environment,
    true,
  );
  await assertRefused(
    await invokeValidation(
      "feature",
      ambiguousRepository,
      validationEnvironment,
    ),
    3,
    "AMBIGUOUS_WORKFLOW_RUN",
  );

  // A completed and an unfinished run are still ambiguous. Validation must
  // not silently prefer the completed one.
  const mixedRepository = await createCommittedTargetRepository();
  await writeWorkflowPackage(mixedRepository, ["01-first", "02-second"]);
  await writeValidationConfiguration(mixedRepository, commands);
  const mixedWorker = await writeFakeHerdrWorker();
  await completeWorkflowRun(
    mixedRepository,
    ["01-first", "02-second"],
    mixedWorker.environment,
  );
  await completeWorkflowRun(
    mixedRepository,
    ["01-first"],
    mixedWorker.environment,
    true,
  );
  await assertRefused(
    await invokeValidation("feature", mixedRepository, validationEnvironment),
    3,
    "AMBIGUOUS_WORKFLOW_RUN",
  );

  // A legacy three-command validation block is rejected before commands run,
  // with both newly required names in the actionable schema error.
  const legacyRepository = await createCommittedTargetRepository();
  await writeWorkflowPackage(legacyRepository, ["01-first"]);
  await writeValidationConfiguration(legacyRepository, {
    test: "exit 0",
    lint: "exit 0",
    typecheck: "exit 0",
  });
  const legacyWorker = await writeFakeHerdrWorker();
  await completeWorkflowRun(
    legacyRepository,
    ["01-first"],
    legacyWorker.environment,
  );
  await mkdir(join(legacyRepository, ".orchestrator"), { recursive: true });
  await writeFile(
    join(legacyRepository, ".orchestrator", "config.yaml"),
    "version: 1\n\nagents:\n  codex:\n    kind: codex\n\nroles:\n  worker:\n    agent: codex\n    skill: implement\n\nworkflow:\n  workerTimeoutSeconds: 1800\n  maxWorkerAttempts: 2\n  validation:\n    test: 'exit 0'\n    lint: 'exit 0'\n    typecheck: 'exit 0'\n    timeoutSeconds: 60\n",
    "utf8",
  );
  const legacyInvocation = await invokeValidation(
    "feature",
    legacyRepository,
    validationEnvironment,
  );
  expect(legacyInvocation.exitCode).toBe(2);
  expect(legacyInvocation.stderr).toContain("formatCheck");
  expect(legacyInvocation.stderr).toContain("build");
  await expect(readFile(log, "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });

  // Missing validation configuration (a preserved config without the block).
  const unconfiguredRepository = await createCommittedTargetRepository();
  await writeWorkflowPackage(unconfiguredRepository, ["01-first"]);
  await mkdir(join(unconfiguredRepository, ".orchestrator"), {
    recursive: true,
  });
  await writeFile(
    join(unconfiguredRepository, ".orchestrator", "config.yaml"),
    "version: 1\n\nagents:\n  codex:\n    kind: codex\n\nroles:\n  worker:\n    agent: codex\n    skill: implement\n\nworkflow:\n  workerTimeoutSeconds: 1800\n  maxWorkerAttempts: 2\n",
    "utf8",
  );
  const unconfiguredWorker = await writeFakeHerdrWorker();
  await completeWorkflowRun(
    unconfiguredRepository,
    ["01-first"],
    unconfiguredWorker.environment,
  );
  await assertRefused(
    await invokeValidation(
      "feature",
      unconfiguredRepository,
      validationEnvironment,
    ),
    2,
    "VALIDATION_NOT_CONFIGURED",
  );
}, 45_000);

test("flow validate rerun after an explicit correction replaces the failed decision", async () => {
  const repository = await createCommittedTargetRepository();
  await writeWorkflowPackage(repository, ["01-first"]);
  const fakeDirectory = await temporaryDirectory();
  const check = await writeRecordingCheck(fakeDirectory, "check");
  const log = join(fakeDirectory, "checks.log");
  const flag = join(fakeDirectory, "fixed.flag");
  const conditional = join(fakeDirectory, "conditional");
  await writeFile(
    conditional,
    `#!/usr/bin/env sh\nprintf '%s cwd=%s\\n' "$1" "$PWD" >> "$FAKE_LOG"\nif [ -f "$FIXED_FLAG" ]; then exit 0; else exit 1; fi\n`,
    "utf8",
  );
  await chmod(conditional, 0o755);
  await writeValidationConfiguration(repository, {
    test: `${conditional} test`,
    lint: `${check} lint`,
    typecheck: `${check} typecheck`,
    formatCheck: `${check} formatCheck`,
    build: `${check} build`,
  });
  const { environment } = await writeFakeHerdrWorker();
  const validationEnvironment = {
    ...environment,
    FAKE_LOG: log,
    FIXED_FLAG: flag,
  };
  const completed = await completeWorkflowRun(
    repository,
    ["01-first"],
    environment,
  );

  const failed = await invokeValidation(
    "feature",
    repository,
    validationEnvironment,
  );
  expect(failed.exitCode).toBe(1);
  expect(JSON.parse(failed.stdout).status).toBe("failed");
  expect(JSON.parse(failed.stdout).checks[0].status).toBe("failed");

  // An explicit user correction without changing the accepted HEAD.
  await writeFile(flag, "fixed\n");
  expect(
    await gitOutput(completed.featureWorktree, ["rev-parse", "HEAD"]),
  ).toBe(completed.validatedHead);

  const passed = await invokeValidation(
    "feature",
    repository,
    validationEnvironment,
  );
  expect(passed.exitCode).toBe(0);
  const report = JSON.parse(passed.stdout);
  expect(report).toMatchObject({
    runId: completed.runId,
    validatedHead: completed.validatedHead,
    status: "passed",
  });

  const snapshot = JSON.parse(
    await readFile(
      join(repository, ".orchestrator", "runs", completed.runId, "state.json"),
      "utf8",
    ),
  );
  expect(snapshot.validation.status).toBe("passed");
  expect(snapshot.validation.validatedHead).toBe(completed.validatedHead);
  const history = (
    await readFile(
      join(
        repository,
        ".orchestrator",
        "runs",
        completed.runId,
        "history.jsonl",
      ),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map(
      (line) => JSON.parse(line) as { type: string; data: { status?: string } },
    );
  const validationEvents = history.filter(
    (event) => event.type === "workflow.validation.completed",
  );
  // Exactly two explicit invocations happened; no automatic retry appeared.
  expect(validationEvents.map((event) => event.data.status)).toEqual([
    "failed",
    "passed",
  ]);
}, 45_000);
