# 02: Resume and complete the Ticket queue

**What to build:** Continue the same Workflow package one explicitly selected ticket at a time. Each invocation should recover the durable run after process restart, enforce queue order, launch a fresh Worker in the existing feature worktree, and return control until the final ticket completes the implementation run.

**Blocked by:** 01

**Status:** completed

- [x] A later invocation finds and resumes the single matching unfinished run without requiring the user to provide a run ID or worktree path.
- [x] Multiple matching unfinished runs are refused as ambiguous rather than guessed between.
- [x] The exact first pending ticket is the only ticket eligible for execution; an out-of-order request is rejected and reports the expected ticket.
- [x] Every eligible ticket launches a fresh Worker through Phase 4 while reusing the package's feature branch, feature worktree, immutable input snapshot, and accepted checkpoint chain.
- [x] Each accepted ticket commit descends from the previous accepted commit, and the primary checkout remains unchanged.
- [x] Repeating an already accepted ticket is an idempotent no-op that reports its existing commit and does not launch another Worker.
- [x] Accepting the final ticket marks the implementation run complete and explicitly states that Phase 6 review and system validation have not run.
- [x] Repeating a request against a completed run is a no-op; starting another run for the same package requires an explicit new-run request.
- [x] A public executable integration test proves two sequential tickets across a process restart, reuse of one feature worktree, fresh Workers, ordered descendant commits, and no duplicate execution.

Implemented user-driven queue resumption, safe blocked-ticket retry through Phase 4 reconciliation, explicit `--new-run`, and public CLI integration coverage.
