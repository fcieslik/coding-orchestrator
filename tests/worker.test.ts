import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import {
  codexWorkerArguments,
  launchSkillAwareWorker,
  renderSkillInvocation,
  renderWorkerPrompt,
  type LogicalWorkerExecution,
} from "../src/worker.js";
import type { HerdrCommandRunner } from "../src/herdr.js";
import { workerResultSchema } from "../src/schema.js";
import { stableJson } from "../src/worker-execution.js";

const execution: LogicalWorkerExecution = {
  role: "worker",
  agentProfile: "codex",
  agentKind: "codex",
  skill: "implement",
  input:
    "/repo/.orchestrator/runs/run_1/workers/T01/attempt-01/input/ticket.md",
  runId: "run_20260904T120000Z_012345abcdef",
  ticketId: "T01",
  worktree: "/repo/.worktrees/feature",
  resultPath:
    "/repo/.orchestrator/runs/run_1/workers/T01/attempt-01/output/result.json",
  commitRequired: true,
};
const safeguards = readFileSync(
  fileURLToPath(
    new URL("../assets/prompts/worker-safeguards.md", import.meta.url),
  ),
  "utf8",
);

test("renderers keep logical execution distinct and use exact agent syntax", () => {
  expect(renderSkillInvocation("implement", execution.input, "codex")).toBe(
    '$implement "/repo/.orchestrator/runs/run_1/workers/T01/attempt-01/input/ticket.md"',
  );
  expect(
    renderSkillInvocation("implement", execution.input, "claude-code"),
  ).toBe(
    '/implement "/repo/.orchestrator/runs/run_1/workers/T01/attempt-01/input/ticket.md"',
  );
  expect(renderSkillInvocation("implement", execution.input, "pi")).toBe(
    '/implement "/repo/.orchestrator/runs/run_1/workers/T01/attempt-01/input/ticket.md"',
  );
  const rendered = renderWorkerPrompt(execution);
  expect(rendered.prompt).toBe(
    [
      '$implement "/repo/.orchestrator/runs/run_1/workers/T01/attempt-01/input/ticket.md"',
      "",
      "Orchestration contract:",
      "",
      "- Run: run_20260904T120000Z_012345abcdef",
      "- Ticket: T01",
      '- Worktree: "/repo/.worktrees/feature"',
      '- Write the structured execution result to: "/repo/.orchestrator/runs/run_1/workers/T01/attempt-01/output/result.json"',
      "- Commit required: true",
      "- Implement only the assigned ticket and work only in the provided worktree.",
      "- The assigned ticket input is immutable; do not modify it.",
      "- Global Orchestrator workflow state is read-only.",
      "- Write exactly one JSON object using the camelCase fields in one of the following shapes; do not use snake_case aliases.",
      '- Completed: {"schemaVersion":1,"ticketId":"T01","status":"completed","commit":"<full commit SHA>","summary":"<concise summary>","commands":[{"command":"git status --short","status":"passed","exitCode":0}],"review":{"status":"clean","findings":[]}}',
      '- Completed with Review attention: {"schemaVersion":1,"ticketId":"T01","status":"completed","commit":"<full candidate commit SHA>","summary":"<concise summary>","commands":[{"command":"git status --short","status":"passed","exitCode":0}],"review":{"status":"attention","findings":[{"axis":"standards","summary":"<concise unresolved finding>","evidence":"<optional evidence or reference>","requiredDecision":"<smallest required decision>"}]}}',
      '- Blocked: {"schemaVersion":1,"ticketId":"T01","status":"blocked","summary":"<concise summary>","blocker":{"type":"<type>","requiredDecision":"<smallest required decision>"}}',
      '- Failed: {"schemaVersion":1,"ticketId":"T01","status":"failed","summary":"<concise summary>","diagnostics":{"message":"<failure message>"}}',
      "- Publish the result atomically by writing a temporary file in the output directory, then renaming it to the result path.",
      "- Fix clear review findings that stay within the assigned ticket before committing. If a Standards or Spec finding requires a decision or scope expansion, preserve the implementation commit and return completed with Review attention; do not guess, ignore it, or expand the ticket. If it is outside this ticket or specification, tell the user to prepare separate work.",
      "- On a product, architecture, security, destructive-operation, credential, or human-decision blocker, do not guess. Write a blocked result with the smallest required decision, then stop.",
      "- On technical failure, write a failed result with relevant diagnostics, then stop.",
      "",
      "Worker safeguards (canonical policy):",
      "",
      safeguards,
    ].join("\n"),
  );
  expect(rendered.prompt).not.toMatch(
    /inspect|testing|self-review|repository methodology/i,
  );
  expect(rendered.prompt).not.toMatch(/ticket_id|commit_sha/);
  expect(rendered.promptHash).toBe(renderWorkerPrompt(execution).promptHash);
  expect(rendered.prompt).toContain(safeguards);
  expect(rendered.promptHash).toBe(
    createHash("sha256").update(rendered.prompt, "utf8").digest("hex"),
  );
  const changedPrompt = rendered.prompt.replace(
    safeguards,
    `${safeguards}\nAdditional safeguard`,
  );
  expect(rendered.promptHash).not.toBe(
    createHash("sha256").update(changedPrompt, "utf8").digest("hex"),
  );
});

test("every supported Agent prompt embeds the complete canonical safeguards", () => {
  for (const agentKind of ["codex", "claude-code", "pi"] as const) {
    const rendered = renderWorkerPrompt({
      ...execution,
      agentKind,
      agentProfile: agentKind,
    });

    expect(rendered.skillInvocation).toBe(
      `${agentKind === "codex" ? "$" : "/"}implement ${JSON.stringify(execution.input)}`,
    );
    expect(rendered.prompt).toContain(safeguards);
    expect(rendered.prompt).toContain("primary checkout");
    expect(rendered.prompt).toContain("Integration target branch");
    expect(rendered.prompt).toContain("never push branches, tags, or commits");
    expect(rendered.prompt).toContain(
      "never create, update, or merge Pull Requests",
    );
    expect(rendered.prompt).toContain(
      "never merge, rebase, or otherwise combine",
    );
    expect(rendered.prompt).toContain("Do not delete workflow Git resources");
    expect(rendered.prompt).toContain("Do not discard pre-existing changes");
    expect(rendered.prompt).toContain(
      "write a valid existing `blocked` or `failed` result",
    );
    expect(rendered.prompt).toContain("Do not guess");
    expect(rendered.prompt).toContain("- Ticket: T01");
    expect(rendered.prompt).toContain(
      "Write the structured execution result to:",
    );
    expect(rendered.prompt).toContain("- Blocked:");
    expect(rendered.prompt).toContain("Completed with Review attention:");
    expect(rendered.prompt).not.toMatch(
      /inspect|testing|self-review|repository methodology/i,
    );
  }
});

test("worker prompt adds immutable specification context without expanding ticket scope", () => {
  const specification = "/repo/.orchestrator/runs/run_1/input/package/spec.md";
  const rendered = renderWorkerPrompt({ ...execution, specification });

  expect(rendered.skillInvocation).toBe(
    '$implement "/repo/.orchestrator/runs/run_1/workers/T01/attempt-01/input/ticket.md"',
  );
  expect(rendered.prompt).toContain(`- Specification: "${specification}"`);
  expect(rendered.prompt).toContain(
    "- Use the specification as read-only context and common constraints; the assigned ticket remains the only implementation scope.",
  );
  expect(rendered.prompt).not.toContain("02-other-ticket");
  expect(rendered.promptHash).not.toBe(
    renderWorkerPrompt(execution).promptHash,
  );
  expect(() =>
    renderWorkerPrompt({
      ...execution,
      specification: "input/package/spec.md",
    }),
  ).toThrow("specification must be an absolute path");
});

test("codex launch forwards opaque prompt and isolated child argv", async () => {
  const calls: string[][] = [];
  const runner: HerdrCommandRunner = async (_executable, args) => {
    calls.push([...args]);
    if (args[0] === "pane" && args[1] === "split")
      return {
        stdout: JSON.stringify({ result: { pane: { pane_id: "p:worker" } } }),
        stderr: "",
        exitCode: 0,
      };
    if (args[0] === "agent" && args[1] === "start")
      return {
        stdout: JSON.stringify({
          result: { agent: { name: "run-worker", pane_id: "p:worker" } },
        }),
        stderr: "",
        exitCode: 0,
      };
    if (args[0] === "agent" && args[1] === "prompt")
      return {
        stdout: JSON.stringify({
          result: {
            agent: {
              name: "run-worker",
              pane_id: "p:worker",
              agent_status: "done",
            },
          },
        }),
        stderr: "",
        exitCode: 0,
      };
    throw new Error(`unexpected Herdr call: ${args.join(" ")}`);
  };

  const launched = await launchSkillAwareWorker({
    ...execution,
    callerPaneId: "p:caller",
    agentName: "run-worker",
    runner,
  });
  expect(launched.handle).toMatchObject({
    paneId: "p:worker",
    agentName: "run-worker",
    cwd: execution.worktree,
  });
  const start = calls.find(
    (args) => args[0] === "agent" && args[1] === "start",
  );
  expect(start).toEqual([
    "agent",
    "start",
    "run-worker",
    "--kind",
    "codex",
    "--pane",
    "p:worker",
    "--timeout",
    "30000",
    "--",
    ...codexWorkerArguments(
      execution.worktree,
      "/repo/.orchestrator/runs/run_1/workers/T01/attempt-01/output",
    ),
  ]);
  const prompt = calls.find(
    (args) => args[0] === "agent" && args[1] === "prompt",
  );
  expect(prompt?.[3]).toBe(renderWorkerPrompt(execution).prompt);
  expect(prompt?.[3]).toContain("$implement");
  expect(start).not.toContain("danger-full-access");
  expect(start).not.toContain("--sandbox");
  expect(start).not.toContain("workspace-write");
  expect(start).toContain("--approve-for-me");
});

test("ownership serialization is independent of nested object key order", () => {
  const first = {
    retry: {
      previousAttemptId: "attempt-01",
      previousExecutionId: "exec-01",
      previousInputHash: "a".repeat(64),
      inputHash: "a".repeat(64),
      refreshed: false,
    },
  };
  const reordered = {
    retry: {
      refreshed: false,
      inputHash: "a".repeat(64),
      previousInputHash: "a".repeat(64),
      previousExecutionId: "exec-01",
      previousAttemptId: "attempt-01",
    },
  };

  expect(stableJson(first)).toBe(stableJson(reordered));
});

test("worker prompt result examples satisfy the runtime schema", () => {
  const prompt = renderWorkerPrompt(execution).prompt;
  for (const label of ["Completed", "Blocked", "Failed"]) {
    const line = prompt
      .split("\n")
      .find((candidate) => candidate.startsWith(`- ${label}: `));
    expect(line).toBeDefined();
    const example = line!
      .slice(line!.indexOf("{"))
      .replace("<full commit SHA>", "a".repeat(40));
    expect(() => workerResultSchema.parse(JSON.parse(example))).not.toThrow();
  }
});

test("renderer and child policy reject unsafe input", () => {
  expect(() =>
    renderSkillInvocation("implement", "/tmp/a\n--danger", "codex"),
  ).toThrow("absolute path without control characters");
  expect(() => codexWorkerArguments("/work", "/out\0")).toThrow(
    "absolute path without control characters",
  );
});
