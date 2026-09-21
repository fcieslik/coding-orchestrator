# Main-agent-owned recovery for interrupted Workflow runs

An interrupted or failed Worker must not leave the only recovery path as manual deletion or direct editing of `.orchestrator/runs`. Run truth remains owned by the Orchestrator, while recovery decisions belong to the Orchestrator or another main agent, never to a Worker.

The recovery surface stays deliberately small. One operator operation exposes three explicit actions:

- reconcile evidence from the execution record, result, Git/worktree, and Herdr identity;
- accept one explicitly named commit only after the existing checkpoint validation passes;
- cancel a run that cannot safely continue, recording the reason and preserving its artifacts.

Acceptance uses the same ticket and run semantics as the normal path. A non-final accepted ticket leaves the run implementing with the next pending ticket; the final accepted ticket completes the implementation phase. A commit on the integration branch is not sufficient by itself: the run's Feature worktree and checkpoint invariants must still be verifiable.

Recovery is append-only and idempotent. It does not provide a generic state editor, automatically kill a live Worker, or delete a run. A known one-revision history publication gap may be repaired through the existing guarded mechanism; ambiguous or larger corruption fails closed and remains available for diagnosis.

This trades a small, explicit recovery interface for strong auditability. Operators may need to start a new run after cancelling an unrecoverable one, but the system never hides uncertainty by rewriting history or treating a Worker declaration as workflow truth.
