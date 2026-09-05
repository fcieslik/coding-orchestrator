# 04: Handle and reconcile unsuccessful worker execution

**What to build:** Let the Orchestrator classify blocked, failed, malformed, timed-out, and otherwise ambiguous Worker executions from independent durable and Git evidence. Operators can run explicit reconciliation without launching another worker, and no unsuccessful execution can become a false checkpoint.

**Blocked by:** 03: Execute one ticket through an accepted checkpoint.

**Status:** completed

- [x] Worker result schema version 1 is a discriminated union for `completed`, `blocked`, and `failed`, with required common identity and summary fields.
- [x] Blocked results require a typed blocker and the smallest required decision; failed results require structured diagnostics.
- [x] Compatible unknown fields and optional changed-file or handoff information are accepted without becoming workflow truth.
- [x] `flow worker reconcile` inspects an existing attempt without prompting or launching an agent and provides equivalent human and structured results.
- [x] Reconciliation revalidates Ticket input snapshot, Execution record, result artifact, Target repository identity, Feature worktree registration, branch, HEAD, ancestry, cleanliness, Herdr ownership, and cleanup.
- [x] A valid completed result plus matching current clean Git state can proceed to final acceptance.
- [x] A failed or missing result with no new commit and a clean worktree is classified as a conclusive failed attempt.
- [x] Any invalid, missing, failed, or blocked result accompanied by a commit or dirty worktree is treated as ambiguous and blocks the Workflow run.
- [x] Wrong ticket identity, stale or divergent commit, mismatched branch/HEAD, foreign worktree, modified Orchestrator-owned evidence, and unknown side effects block rather than retry.
- [x] Worker timeout, process disappearance, and unsupported Herdr lifecycle initiate reconciliation rather than directly implying success or failure.
- [x] Herdr `blocked` without a valid Worker result captures bounded diagnostics, closes only the owned pane, and blocks the run without starting an automatic conversation.
- [x] Explicit Worker blockers and cleanup failure preserve recoverable evidence and block the run with interrupted phase `implementing`.
- [x] Conclusive technical failure becomes terminal for the Workflow run only when the attempt budget is exhausted.
- [x] Structured outcomes distinguish accepted, blocked/reconciliation-required, and conclusive execution failure using stable error codes and exit categories.
- [x] Tests cover result variants, malformed and missing output, Git effects, and non-launching CLI reconciliation through the public executable seam.

## Verification

- Added `flow worker reconcile` with explicit attempt or execution selection, bounded diagnostics, owned-pane cleanup, independent artifact validation, Git reconciliation, and idempotent accepted-attempt handling.
- Added runtime/schema coverage for the blocked-result decision alias used by the repository handoff documentation.
- Focused verification passes: TypeScript, ESLint, Prettier, schema generation, worker tests, schema tests, and reconciliation/accepted-worker CLI tests.
- Full-suite verification passes: 123/123 tests, including the existing installer coverage with the user-owned root `assets/` directory.
