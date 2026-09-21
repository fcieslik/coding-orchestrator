# 02: Accept a recovered Git checkpoint

**What to build:** Let a main agent explicitly accept a specific commit after an interrupted Worker execution when the existing checkpoint rules prove that the commit is the next valid Git checkpoint for the active ticket.

**Blocked by:** 01 — Expose run repair and safe reconciliation.

**Status:** ready-for-agent

- [ ] The public recovery operation exposes an `accept` action requiring an explicit commit identifier.
- [ ] Acceptance reuses the existing checkpoint validation, run lock, Feature worktree invariants, ancestry checks, baseline checks, and repository identity checks.
- [ ] A Worker claim, disappearing pane, integration-branch HEAD, stale commit, dirty worktree, unrelated commit, or invalid commit cannot produce acceptance.
- [ ] Successful acceptance marks only the selected active ticket as `accepted` and records the accepted commit in Workflow state and operational history.
- [ ] Accepting a non-final ticket leaves the run implementing with the next ticket pending.
- [ ] Accepting the final ticket moves the run to implementation `completed` using the same semantics as the normal Workflow step.
- [ ] Repeating acceptance for the same already accepted checkpoint is an idempotent no-op without duplicate state history.
- [ ] CLI tests cover successful non-final and final acceptance plus invalid and stale candidates without mutation.
