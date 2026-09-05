import { expect, test } from "vitest";

import {
  codexWorkerArguments,
  launchSkillAwareWorker,
  renderSkillInvocation,
  renderWorkerPrompt,
  type LogicalWorkerExecution,
} from "../src/worker.js";
import type { HerdrCommandRunner } from "../src/herdr.js";

const execution: LogicalWorkerExecution = {
  role: "worker",
  agentProfile: "codex",
  agentKind: "codex",
  skill: "implement",
  input:
    "/repo/.orchestrator/runs/run_1/workers/T01/attempt-01/input/ticket.md",
  runId: "run_1",
  ticketId: "T01",
  worktree: "/repo/.worktrees/feature",
  resultPath:
    "/repo/.orchestrator/runs/run_1/workers/T01/attempt-01/output/result.json",
  commitRequired: true,
};

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
      "- Run: run_1",
      "- Ticket: T01",
      '- Worktree: "/repo/.worktrees/feature"',
      '- Write the structured execution result to: "/repo/.orchestrator/runs/run_1/workers/T01/attempt-01/output/result.json"',
      "- Commit required: true",
      "- Implement only the assigned ticket and work only in the provided worktree.",
      "- The assigned ticket input is immutable; do not modify it.",
      "- Global Orchestrator workflow state is read-only.",
      "- Status must be completed, blocked, or failed.",
      "- The result must contain the ticket ID, status, commit SHA when completed, a concise summary, and commands/checks executed.",
      "- Publish the result atomically by writing a temporary file in the output directory, then renaming it to the result path.",
      "- On a product, architecture, security, destructive-operation, credential, or human-decision blocker, do not guess. Write a blocked result with the smallest required decision, then stop.",
      "- On technical failure, write a failed result with relevant diagnostics, then stop.",
    ].join("\n"),
  );
  expect(rendered.prompt).not.toMatch(
    /inspect|testing|self-review|repository methodology/i,
  );
  expect(rendered.promptHash).toBe(renderWorkerPrompt(execution).promptHash);
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
  expect(start).toContain("workspace-write");
  expect(start).toContain("--approve-for-me");
});

test("renderer and child policy reject unsafe input", () => {
  expect(() =>
    renderSkillInvocation("implement", "/tmp/a\n--danger", "codex"),
  ).toThrow("absolute path without control characters");
  expect(() => codexWorkerArguments("/work", "/out\0")).toThrow(
    "absolute path without control characters",
  );
});
