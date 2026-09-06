# 06: Harden attempt ownership and crash recovery

**What to build:** Make the complete Worker lifecycle fail closed under malicious paths, replaced artifacts, concurrent supervisors, and process interruption at every irreversible boundary. Recovery preserves all uncertain work while preventing duplicate agents and false acceptance.

**Blocked by:** 05: Resume and retry without duplicate work.

**Status:** completed

- [x] Every existing component of attempt input, execution, and output paths is checked against symlink redirection and unsafe path escape.
- [x] Ticket input, Execution record, State snapshot reference, prompt hash, result destination, and attempt lineage are revalidated before finalization.
- [x] Mutation or replacement of any Orchestrator-owned artifact after launch blocks the run without accepting or deleting worker effects.
- [x] A Worker result outside its exact output area, a partial publication, unexpected files used as evidence, or a replaced output path cannot satisfy acceptance.
- [x] Captured diagnostic output is limited to the final 32 KiB, records truncation, and excludes the complete prompt and transcript from normal artifacts.
- [x] Concurrent execute, reconcile, and retry processes cannot claim the same attempt, prompt a worker twice, close unowned panes, or publish conflicting terminal outcomes.
- [x] Failure after attempt preparation but before pane creation is recoverable without creating a second logical attempt unnecessarily.
- [x] Failure after pane creation but before prompt delivery performs or enables narrow owned-pane recovery and permits retry only when no effects are proven.
- [x] Failure after prompt delivery while the worker runs cannot cause automatic duplicate execution.
- [x] Failure after commit and result publication but before cleanup can reconcile and accept the existing work rather than rerun it.
- [x] Failure after cleanup but before final checkpoint acceptance can revalidate and finalize without requiring the closed agent.
- [x] Failure after State snapshot publication but before Operational history publication preserves the existing detectable audit-gap behavior and refuses unsafe mutation.
- [x] Cleanup errors retain the exact owned pane identity and never broaden cleanup to a tab, workspace, server, or unrelated pane.
- [x] Crash and concurrency tests use controlled subprocess and injected failure seams without sleeps or real agents.
- [x] All recovery paths preserve Git commits, dirty changes, Worker results, and diagnostic evidence until their disposition is proven.

Implemented attempt ownership manifests and stale-aware reconciliation claims, exact output-area validation, byte-bounded/redacted diagnostics, prompt and state revalidation, and pane persistence before prompt delivery.
