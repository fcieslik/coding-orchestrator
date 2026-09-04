import { expect, test } from "vitest";

import {
  InvalidRunTransitionError,
  transition,
  type RunTransitionType,
  type RunLifecycleState,
} from "../src/lifecycle.js";

test("transition follows the normal lifecycle graph", () => {
  let state: RunLifecycleState = { phase: "created" };
  state = transition(state, { type: "prepare" });
  expect(state).toEqual({ phase: "preparing" });
  state = transition(state, { type: "implement" });
  expect(state).toEqual({ phase: "implementing" });
  state = transition(state, { type: "review" });
  expect(state).toEqual({ phase: "reviewing" });
  state = transition(state, { type: "check" });
  expect(state).toEqual({ phase: "checking" });
  state = transition(state, { type: "complete" });
  expect(state).toEqual({ phase: "completed" });
});

test("review and check failures retain their validation phase through fixing", () => {
  expect(transition({ phase: "reviewing" }, { type: "review.fail" })).toEqual({
    phase: "fixing",
    fixReturnPhase: "reviewing",
  });
  expect(
    transition(
      { phase: "fixing", fixReturnPhase: "reviewing" },
      { type: "fix.complete" },
    ),
  ).toEqual({ phase: "reviewing" });
  expect(transition({ phase: "checking" }, { type: "check.fail" })).toEqual({
    phase: "fixing",
    fixReturnPhase: "checking",
  });
  expect(
    transition(
      { phase: "fixing", fixReturnPhase: "checking" },
      { type: "fix.complete" },
    ),
  ).toEqual({ phase: "checking" });
});

test("blocking and resuming preserves a fixing continuation", () => {
  const blocked = transition(
    { phase: "fixing", fixReturnPhase: "checking" },
    { type: "block" },
  );
  expect(blocked).toEqual({
    phase: "blocked",
    interruptedPhase: "fixing",
    fixReturnPhase: "checking",
  });
  expect(transition(blocked, { type: "resume" })).toEqual({
    phase: "fixing",
    fixReturnPhase: "checking",
  });
});

test("every nonterminal phase can fail or cancel, while terminal phases are closed", () => {
  const phases = [
    "created",
    "preparing",
    "implementing",
    "reviewing",
    "checking",
    "fixing",
    "blocked",
  ] as const;
  for (const phase of phases) {
    expect(transition({ phase }, { type: "fail" })).toEqual({
      phase: "failed",
    });
    expect(transition({ phase }, { type: "cancel" })).toEqual({
      phase: "cancelled",
    });
  }
  for (const phase of ["completed", "failed", "cancelled"] as const) {
    expect(() => transition({ phase }, { type: "fail" })).toThrow(
      InvalidRunTransitionError,
    );
  }
});

test("invalid transitions expose the phase and attempted event", () => {
  expect(() => transition({ phase: "created" }, { type: "complete" })).toThrow(
    expect.objectContaining({
      currentPhase: "created",
      attemptedEvent: "complete",
      code: "INVALID_RUN_TRANSITION",
    }),
  );
});

test("the canonical transition matrix rejects every edge outside the graph", () => {
  const events: RunTransitionType[] = [
    "prepare",
    "implement",
    "review",
    "review.fail",
    "check",
    "check.fail",
    "fix.complete",
    "resume",
    "block",
    "fail",
    "cancel",
    "complete",
  ];
  const states: Array<{
    state: RunLifecycleState;
    valid: RunTransitionType[];
  }> = [
    { state: { phase: "created" }, valid: ["prepare"] },
    { state: { phase: "preparing" }, valid: ["implement"] },
    { state: { phase: "implementing" }, valid: ["review"] },
    { state: { phase: "reviewing" }, valid: ["check", "review.fail"] },
    { state: { phase: "checking" }, valid: ["complete", "check.fail"] },
    {
      state: { phase: "fixing", fixReturnPhase: "reviewing" },
      valid: ["fix.complete"],
    },
    {
      state: { phase: "blocked", interruptedPhase: "reviewing" },
      valid: ["resume"],
    },
  ];
  for (const { state, valid } of states) {
    for (const event of events) {
      if (
        valid.includes(event) ||
        event === "block" ||
        event === "fail" ||
        event === "cancel"
      )
        continue;
      expect(() => transition(state, event)).toThrow(InvalidRunTransitionError);
    }
  }
});
