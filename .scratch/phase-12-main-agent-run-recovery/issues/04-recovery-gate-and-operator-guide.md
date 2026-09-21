# 04: Pass the run-recovery gate and publish the operator guide

**What to build:** Prove that the complete main-agent recovery contract works through the public CLI and keep the operator documentation synchronized with the implemented reconcile, accept, and cancel behavior.

**Blocked by:** 02 — Accept a recovered Git checkpoint; 03 — Cancel an unrecoverable run without deleting evidence.

**Status:** ready-for-agent

- [ ] The public CLI tests cover reconcile, accept, and cancel through one consistent temporary-repository/fake-Herdr seam.
- [ ] The test suite covers live-Worker refusal, clean retry eligibility, valid recovered acceptance, final/non-final ticket transitions, cancellation, idempotency, lock contention, audit-gap repair, and fail-closed corruption.
- [ ] Tests prove that Worker-facing execution paths cannot mutate Workflow state through the main-agent recovery behavior.
- [ ] Human-readable and structured recovery output expose enough evidence and next action for a main agent without requiring manual JSON inspection.
- [ ] The operator guide maps common symptoms to reconcile, accept, cancel, retry, or new-run decisions and states the required evidence.
- [ ] The operator guide explicitly forbids direct state/history editing, deleting active or blocked runs, implicit branch-head acceptance, and automatic Worker termination.
- [ ] The full project verification commands pass with no real model calls, provider credentials, or live agent sessions required.
