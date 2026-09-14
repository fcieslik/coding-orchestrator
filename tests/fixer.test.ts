import { expect, test } from "vitest";

import { renderFixerPrompt } from "../src/fixer.js";
import { fixerResultSchema } from "../src/schema.js";

const execution = {
  role: "fixer" as const,
  agentProfile: "codex",
  agentKind: "codex" as const,
  runId: "run_20260914T120000Z_012345abcdef",
  ticketId: "01-review",
  briefPath:
    "/repo/.orchestrator/runs/run/fixers/01-review/fixer-attempt-01/fix-brief.json",
  worktree: "/repo/.worktrees/feature",
  candidateCommit: "a".repeat(40),
  resultPath:
    "/repo/.orchestrator/runs/run/fixers/01-review/fixer-attempt-01/output/result.json",
  commitRequired: true,
};

test("Fixer prompt is bounded and does not invoke implementation or review skills", () => {
  const rendered = renderFixerPrompt(execution);

  expect(rendered.prompt).toContain("Candidate commit to preserve in ancestry");
  expect(rendered.prompt).toContain("Fix brief:");
  expect(rendered.prompt).toContain("correction commit");
  expect(rendered.prompt).not.toContain("$implement");
  expect(rendered.prompt).not.toContain("code-review");
  expect(rendered.promptHash).toMatch(/^[0-9a-f]{64}$/);
});

test("Fixer result schema accepts each closed result class and rejects missing decisions", () => {
  const common = {
    schemaVersion: 1,
    ticketId: "01-review",
    summary: "bounded result",
  };
  expect(
    fixerResultSchema.parse({
      ...common,
      status: "completed",
      commit: "b".repeat(40),
    }),
  ).toMatchObject({ status: "completed" });
  expect(
    fixerResultSchema.parse({
      ...common,
      status: "blocked",
      blocker: { type: "scope", requiredDecision: "Prepare a new ticket." },
    }),
  ).toMatchObject({ status: "blocked" });
  expect(
    fixerResultSchema.parse({
      ...common,
      status: "failed",
      diagnostics: { message: "test failure" },
    }),
  ).toMatchObject({ status: "failed" });
  expect(() =>
    fixerResultSchema.parse({
      ...common,
      status: "blocked",
      blocker: { type: "scope" },
    }),
  ).toThrow();
});
