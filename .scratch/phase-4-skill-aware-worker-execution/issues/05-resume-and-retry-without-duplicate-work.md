# 05: Resume and retry without duplicate work

**What to build:** Make Worker execution safe to repeat after command uncertainty or interruption. Existing work is resumed or reconciled first, retries are bounded and explicit after prompt delivery, and a changed ticket enters a new attempt only through an auditable refresh.

**Blocked by:** 04: Handle and reconcile unsuccessful worker execution.

**Status:** completed

- [x] Repeating execute for an accepted attempt returns the existing success without creating artifacts, history, panes, agents, or commits.
- [x] Repeating execute for a live running attempt refuses takeover and never sends a second prompt.
- [x] An interrupted supervisor is recovered through explicit reconciliation rather than guessed ownership.
- [x] The run lock covers only short attempt claims and finalization mutations and is never held while an agent works or the Orchestrator waits.
- [x] `flow worker retry` creates a monotonically numbered fresh attempt only after reconciliation proves retry safe.
- [x] The configured attempt budget is enforced across automatic and explicit retries.
- [x] Automatic retry is permitted only before confirmed prompt delivery and only when code, Git, result, and transport evidence prove no side effects.
- [x] Timeout, disappearance, failure, or ambiguity after confirmed delivery requires explicit reconciliation before retry.
- [x] An ambiguous commit, dirty worktree, altered branch, untrusted artifact, active agent, or failed cleanup prevents retry.
- [x] Retry uses the prior immutable Ticket input snapshot by default even if the source ticket changed.
- [x] An explicit ticket-refresh option creates and hashes a new Ticket input snapshot and records old/new hashes in attempt lineage.
- [x] Ticket changes never enter a retry silently, and an unchanged explicit refresh is handled predictably without weakening lineage.
- [x] Retried workers remain fresh Codex contexts on the same Feature worktree and start from the last accepted Git checkpoint.
- [x] State snapshot, Execution records, Operational history, CLI output, and exit categories expose retry eligibility and budget consistently.
- [x] End-to-end tests cover accepted idempotency, live-owner refusal, safe pre-delivery retry, mandatory post-delivery reconciliation, budget exhaustion, same-input retry, and refreshed-input retry.
