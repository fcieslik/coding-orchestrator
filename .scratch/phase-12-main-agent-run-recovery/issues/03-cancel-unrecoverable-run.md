# 03: Cancel an unrecoverable run without deleting evidence

**What to build:** Let a main agent deliberately close a run that cannot safely continue, while preserving its state, history, Feature worktree, branch, and execution artifacts for diagnosis or comparison with a later run.

**Blocked by:** 01 — Expose run repair and safe reconciliation.

**Status:** ready-for-agent

- [ ] The public recovery operation exposes a `cancel` action requiring a non-empty operator reason.
- [ ] Cancellation uses the existing run lock and records a durable state transition plus the reason in operational history.
- [ ] Cancellation produces a terminal `cancelled` run and does not mark an active ticket as accepted.
- [ ] Cancellation does not delete the run, worktree, branch, execution record, Worker result, or diagnostic artifacts.
- [ ] Cancellation does not launch a retry or mutate the integration target branch.
- [ ] Repeating cancellation is idempotent and does not append a conflicting duplicate transition.
- [ ] Lock contention, terminal-run behavior, malformed state, ambiguous history, and other fail-closed cases preserve original evidence and return existing error conventions.
- [ ] CLI tests cover human/JSON cancellation output, preserved artifacts, reason recording, idempotency, and refusal under unsafe conditions.
