# 01: Execute the first Workflow package ticket

**What to build:** Add the first end-to-end user-driven Workflow step. Given a valid Workflow package and its first ticket ID, the Orchestrator should hide setup and run plumbing, create the durable run and shared feature worktree, snapshot the package, execute one fresh Worker through the existing Phase 4 subsystem, validate its checkpoint, and return the next expected ticket.

**Blocked by:** None

**Status:** completed

- [x] A package with one regular `spec.md` and at least one regular Markdown file under `issues/` is accepted; malformed, empty, symlinked, or ambiguous input is rejected before partial run creation.
- [x] Ticket IDs come exactly from filenames and the fixed queue uses lexical filename order without parsing dependencies, status, priority, or tracker metadata.
- [x] The first invocation automatically performs missing repository setup, creates the Workflow run, prepares one feature branch and worktree, and copies the complete package into immutable run-owned input.
- [x] The requested ticket must exactly match the first pending ticket, and the Worker receives only the run-owned snapshot of that ticket.
- [x] Execution delegates to the existing Phase 4 skill-aware Worker path instead of duplicating prompt rendering, Herdr transport, result validation, or Git checkpoint validation.
- [x] A validated Worker commit is recorded as the accepted ticket checkpoint, the primary checkout remains unchanged, and the result reports the ticket, outcome, accepted commit, and next expected ticket.
- [x] Minimal durable queue state records ticket order, per-ticket status, and accepted commit without introducing a dependency graph or second issue tracker.
- [x] A public executable integration test with fake Herdr/Worker behavior proves the first-step happy path and representative invalid-package failures.
