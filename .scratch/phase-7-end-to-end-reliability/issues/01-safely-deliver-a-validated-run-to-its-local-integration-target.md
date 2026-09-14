# 01: Safely deliver a validated run to its local Integration target

**What to build:** Make a completed Workflow run locally deliverable from the user-facing `$orchestrate` workflow. A new run remembers its named Integration target branch, validation is reused or run for the exact Feature HEAD, and the deterministic helper fast-forwards the unchanged clean target or refuses without mutation. The Delivery result survives interruption, reconciles from Git, repeats idempotently, and leaves all Feature resources intact.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] A new Workflow run requires a named checked-out local branch and records it as the Integration target branch beside the immutable Run base.
- [x] Detached HEAD is rejected before a run branch, Feature worktree, or durable Workflow run is created.
- [x] Existing snapshots without an Integration target branch remain readable but receive a clear refusal from automated delivery.
- [x] The State snapshot supports one optional Delivery result with channel `local`, lifecycle status `prepared`, `completed`, or `blocked`, the validated HEAD, target branch, and channel-specific evidence.
- [x] Delivery transitions are appended to the existing Operational history; no separate delivery artifact or event log is introduced.
- [x] The public local-integration operation resolves exactly one Workflow run from the Workflow package without requiring a Run ID.
- [x] Read-only preflight requires implementation complete, a clean Feature worktree at the final accepted checkpoint, and passing validation for the exact Feature HEAD.
- [x] A current passing Validation result is reused; absent validation invokes the existing five-check gate once, and any validation failure prevents delivery mutation.
- [x] Preflight verifies a clean primary checkout on the saved Integration target branch at the Run base and a clean Feature branch/worktree at the validated descendant.
- [x] A preflight refusal does not persist a Delivery channel or mutate Git.
- [x] The helper records `prepared` under the existing Workflow run lock immediately before the fast-forward mutation.
- [x] Local delivery uses fast-forward-only behavior and never creates a merge commit, rebases, switches branches, resolves conflicts, resets work, or deletes Feature resources.
- [x] Reconciliation treats target HEAD at Run base as not yet integrated, target HEAD at the validated Feature HEAD as already integrated, and every other target HEAD as blocked without mutation.
- [x] A repeated completed local handoff returns the same Delivery result without another merge, history transition, commit, worktree, or branch.
- [x] A request for another Delivery channel after local intent is persisted is rejected without mutation.
- [x] Dirty checkout, wrong target branch, moved target HEAD, divergent history, stale validation, changed Feature HEAD, dirty Feature worktree, and conflicting delivery intent are covered through a compact public-CLI refusal matrix.
- [x] Local delivery uses the existing Workflow run lock and a concurrent invocation returns the established in-progress error without taking ownership.
- [x] Concise human output and equivalent structured output distinguish completed delivery, preflight refusal, validation failure, blocked reconciliation, channel conflict, and concurrency.
- [x] The global Orchestrator skill maps natural requests for validation plus local integration to the validation and local handoff operations, while asking for a channel when the user did not select one.
- [x] User-facing output calls Run phase `completed` implementation complete and reports full V1 completion only after validation and local Delivery result are complete.
- [x] Automated tests use real temporary Git repositories at the public CLI seam and prove successful fast-forward, unchanged dirty/moved cases, recovery, idempotency, history, state, and retained Feature branch/worktree.
