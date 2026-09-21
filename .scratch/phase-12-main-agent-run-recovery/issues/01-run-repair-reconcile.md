# 01: Expose run repair and safe reconciliation

**What to build:** Give the Orchestrator or another main agent one public recovery operation that can inspect and safely reconcile an interrupted Workflow run without deleting it, accepting a ticket, or killing a live Worker.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] The CLI exposes a `run repair` operation with a mutually exclusive `reconcile` action and human-readable plus structured output.
- [ ] Reconciliation uses the existing run lock and existing Worker execution reconciliation evidence.
- [ ] Reconciliation reports execution record, Worker result, Git/worktree, cleanup, and owned Herdr evidence needed for the next decision.
- [ ] A live Worker, dirty or changed worktree, conflicting evidence, failed cleanup, or missing ownership proof stops recovery without accepting, cancelling, retrying, or killing the Worker.
- [ ] A conclusive missing/failed result with a clean unchanged worktree remains eligible for the existing bounded retry path.
- [ ] The known one-revision history publication gap can be repaired through the existing guarded mechanism; larger or ambiguous corruption fails closed and preserves original bytes.
- [ ] Repeating reconciliation is safe and does not create duplicate state changes for an already reconciled outcome.
- [ ] CLI tests cover the public reconciliation behavior using the existing temporary Git repository and fake Herdr seam.
