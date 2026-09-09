import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import {
  renderWorkerPrompt,
  type LogicalWorkerExecution,
} from "../src/worker.js";

const execution: LogicalWorkerExecution = {
  role: "worker",
  agentProfile: "codex",
  agentKind: "codex",
  skill: "implement",
  input: "/repo/.orchestrator/runs/run_1/input/ticket.md",
  runId: "run_20260904T120000Z_012345abcdef",
  ticketId: "T01",
  worktree: "/repo/.worktrees/feature",
  resultPath: "/repo/.orchestrator/runs/run_1/output/result.json",
  commitRequired: true,
};
const safeguards = readFileSync(
  fileURLToPath(
    new URL("../assets/prompts/worker-safeguards.md", import.meta.url),
  ),
  "utf8",
);

test("all supported Agent prompts preserve syntax and embed canonical safeguards", () => {
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
    for (const statement of [
      "primary checkout",
      "Integration target branch",
      "never push branches, tags, or commits",
      "never create, update, or merge Pull Requests",
      "never merge, rebase, or otherwise combine",
      "Do not delete workflow Git resources",
      "Do not discard pre-existing changes",
      "write a valid existing `blocked` or `failed` result",
      "Do not guess",
    ])
      expect(rendered.prompt).toContain(statement);

    expect(rendered.prompt).toContain("- Ticket: T01");
    expect(rendered.prompt).toContain("- Blocked:");
    expect(rendered.prompt).toContain(
      "Write the structured execution result to:",
    );
    expect(rendered.prompt).not.toMatch(
      /inspect|testing|self-review|repository methodology/i,
    );
  }
});

test("the existing prompt hash covers the complete safeguards policy", () => {
  const rendered = renderWorkerPrompt(execution);
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
