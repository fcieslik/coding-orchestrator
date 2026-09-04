import type { RunPhase } from "./schema.js";

export type FixReturnPhase = "reviewing" | "checking";

export interface RunLifecycleState {
  phase: RunPhase;
  interruptedPhase?: RunPhase;
  fixReturnPhase?: FixReturnPhase;
}

export type RunTransitionType =
  | "prepare"
  | "implement"
  | "review"
  | "review.fail"
  | "check"
  | "check.fail"
  | "fix.complete"
  | "resume"
  | "block"
  | "fail"
  | "cancel"
  | "complete";

export interface RunTransitionEvent {
  type: RunTransitionType;
  data?: Record<string, unknown>;
}

export class InvalidRunTransitionError extends Error {
  readonly code = "INVALID_RUN_TRANSITION";

  constructor(
    readonly currentPhase: RunPhase,
    readonly attemptedEvent: string,
  ) {
    super(
      `Invalid Run phase transition from ${currentPhase} using ${attemptedEvent}`,
    );
  }
}

const eventAliases: Record<string, RunTransitionType> = {
  check_failed: "check.fail",
  check_passed: "complete",
  "check.failed": "check.fail",
  "check.failure": "check.fail",
  "check.started": "check",
  checking: "check",
  checks_failed: "check.fail",
  checks_passed: "complete",
  "checks.fail": "check.fail",
  "checks.failed": "check.fail",
  "checks.failure": "check.fail",
  fix: "fix.complete",
  "fix.done": "fix.complete",
  "fix.completed": "fix.complete",
  fix_complete: "fix.complete",
  fix_completed: "fix.complete",
  "fixer.complete": "fix.complete",
  "implementation.start": "implement",
  "implementation.started": "implement",
  start_implementation: "implement",
  start_implementing: "implement",
  implementing: "implement",
  "preparation.start": "prepare",
  "preparation.started": "prepare",
  start_preparation: "prepare",
  start_preparing: "prepare",
  preparing: "prepare",
  review_failed: "review.fail",
  review_passed: "check",
  "review.failed": "review.fail",
  "review.failure": "review.fail",
  "review.started": "review",
  start_review: "review",
  start_reviewing: "review",
  reviewing: "review",
  start_check: "check",
  start_checking: "check",
  "run.check": "check",
  "run.check.failed": "check.fail",
  "run.check.started": "check",
  "run.completed": "complete",
  "run.fix.completed": "fix.complete",
  "run.implementation.started": "implement",
  "run.preparation.started": "prepare",
  "run.review.failed": "review.fail",
  "run.review.started": "review",
  "run.resumed": "resume",
  "run.implement": "implement",
  "run.prepare": "prepare",
  "run.review": "review",
  "run.resume": "resume",
  "resume.blocked": "resume",
  unblock: "resume",
  blocked: "block",
  cancelled: "cancel",
  completed: "complete",
  failed: "fail",
};

const historyEventTypes: Record<RunTransitionType, string> = {
  block: "run.blocked",
  cancel: "run.cancelled",
  check: "run.check.started",
  "check.fail": "run.check.failed",
  complete: "run.completed",
  fail: "run.failed",
  "fix.complete": "run.fix.completed",
  implement: "run.implementation.started",
  prepare: "run.preparation.started",
  review: "run.review.started",
  "review.fail": "run.review.failed",
  resume: "run.resumed",
};

export type RunTransitionAlias = keyof typeof eventAliases;
export type RunTransitionInput =
  | RunTransitionEvent
  | RunTransitionType
  | RunTransitionAlias
  | {
      type: RunTransitionType | RunTransitionAlias;
      data?: Record<string, unknown>;
    };

export function normalizeRunTransition(
  event: RunTransitionInput,
): RunTransitionType {
  const attemptedEvent = typeof event === "string" ? event : event.type;
  if (runTransitionTypes.has(attemptedEvent as RunTransitionType)) {
    return attemptedEvent as RunTransitionType;
  }
  const normalized = eventAliases[attemptedEvent];
  if (normalized) return normalized;
  throw new Error(`Unknown Run transition event: ${attemptedEvent}`);
}

export { InvalidRunTransitionError as InvalidTransitionError };

export function runTransitionEventType(event: RunTransitionInput): string {
  return historyEventTypes[normalizeRunTransition(event)];
}

const runTransitionTypes = new Set<RunTransitionType>([
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
]);

const terminalPhases = new Set<RunPhase>(["failed", "cancelled", "completed"]);

function invalid(state: RunLifecycleState, event: string): never {
  throw new InvalidRunTransitionError(state.phase, event);
}

function withoutContinuation(state: RunLifecycleState): RunLifecycleState {
  return { phase: state.phase };
}

/** Calculate a legal lifecycle transition without persistence or other side effects. */
export function transition(
  current: RunLifecycleState | RunPhase,
  event: RunTransitionInput,
): RunLifecycleState {
  const state: RunLifecycleState =
    typeof current === "string" ? { phase: current } : current;
  const attemptedEvent = typeof event === "string" ? event : event.type;
  let transitionType: RunTransitionType;
  try {
    transitionType = normalizeRunTransition(event);
  } catch {
    return invalid(state, attemptedEvent);
  }

  if (terminalPhases.has(state.phase)) return invalid(state, attemptedEvent);

  if (transitionType === "block") {
    if (state.phase === "blocked") return invalid(state, attemptedEvent);
    return {
      phase: "blocked",
      interruptedPhase: state.phase,
      ...(state.phase === "fixing" && state.fixReturnPhase
        ? { fixReturnPhase: state.fixReturnPhase }
        : {}),
    };
  }

  if (transitionType === "resume") {
    if (!state.interruptedPhase || state.phase !== "blocked")
      return invalid(state, attemptedEvent);
    if (state.interruptedPhase === "fixing" && !state.fixReturnPhase)
      return invalid(state, attemptedEvent);
    return {
      phase: state.interruptedPhase,
      ...(state.interruptedPhase === "fixing" && state.fixReturnPhase
        ? { fixReturnPhase: state.fixReturnPhase }
        : {}),
    };
  }

  switch (transitionType) {
    case "prepare":
      return state.phase === "created"
        ? withoutContinuation({ phase: "preparing" })
        : invalid(state, attemptedEvent);
    case "implement":
      return state.phase === "preparing"
        ? withoutContinuation({ phase: "implementing" })
        : invalid(state, attemptedEvent);
    case "review":
      return state.phase === "implementing"
        ? withoutContinuation({ phase: "reviewing" })
        : invalid(state, attemptedEvent);
    case "review.fail":
      return state.phase === "reviewing"
        ? { phase: "fixing", fixReturnPhase: "reviewing" }
        : invalid(state, attemptedEvent);
    case "check":
      return state.phase === "reviewing"
        ? withoutContinuation({ phase: "checking" })
        : invalid(state, attemptedEvent);
    case "check.fail":
      return state.phase === "checking"
        ? { phase: "fixing", fixReturnPhase: "checking" }
        : invalid(state, attemptedEvent);
    case "fix.complete":
      if (state.phase !== "fixing" || !state.fixReturnPhase)
        return invalid(state, attemptedEvent);
      return withoutContinuation({ phase: state.fixReturnPhase });
    case "complete":
      return state.phase === "checking"
        ? withoutContinuation({ phase: "completed" })
        : invalid(state, attemptedEvent);
    case "fail":
      return withoutContinuation({ phase: "failed" });
    case "cancel":
      return withoutContinuation({ phase: "cancelled" });
  }
}
