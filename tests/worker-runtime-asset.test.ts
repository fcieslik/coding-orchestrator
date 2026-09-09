import { expect, test, vi } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    readFileSync: () => {
      const error = Object.assign(
        new Error("ENOENT: safeguards asset not found"),
        { code: "ENOENT" },
      );
      throw error;
    },
  };
});

import { launchSkillAwareWorker } from "../src/worker.js";
import type { HerdrCommandRunner } from "../src/herdr.js";

test("missing safeguards stop launch before Herdr creates a Worker", async () => {
  let herdrCalls = 0;
  const runner: HerdrCommandRunner = async () => {
    herdrCalls += 1;
    throw new Error("Herdr must not be called");
  };

  await expect(
    launchSkillAwareWorker({
      role: "worker",
      agentProfile: "codex",
      agentKind: "codex",
      skill: "implement",
      input: "/repo/ticket.md",
      runId: "run_20260904T120000Z_012345abcdef",
      ticketId: "T01",
      worktree: "/repo/.worktrees/feature",
      resultPath: "/repo/output/result.json",
      commitRequired: true,
      callerPaneId: "p:caller",
      agentName: "worker",
      runner,
    }),
  ).rejects.toMatchObject({
    code: "RUNTIME_ASSET_UNAVAILABLE",
    exitCode: 4,
  });
  expect(herdrCalls).toBe(0);
});
