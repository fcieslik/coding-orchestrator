# 03: Recover a blocked Workflow step and pass the Phase 5 gate

**What to build:** Add the narrow recovery path for an explicitly retried blocked ticket, then prove the complete Phase 5 POC at its public boundary. Recovery must reconcile the previous attempt and launch a fresh bounded Worker only when durable evidence makes retry safe.

**Blocked by:** 02

**Status:** implemented; live gate pending

- [x] A blocked or failed ticket prevents later tickets from executing and reports the smallest action needed from the user.
- [x] Invoking the same blocked ticket again is treated as an explicit resume request; the Orchestrator never retries it autonomously.
- [x] Before retry, reconciliation confirms that the previous pane is settled or closed, cleanup is safe, the feature worktree is clean, HEAD remains at the prior accepted checkpoint, no unaccepted commit exists, and result artifacts are unambiguous.
- [x] A safe retry launches a fresh Worker in the same feature worktree with the same immutable ticket snapshot and consumes the existing bounded attempt budget.
- [x] An unsafe or exhausted retry remains blocked without modifying or accepting uncertain work and reports the conflicting evidence or required recovery action.
- [x] If resolving the blocker changes the accepted spec or ticket requirements, the workflow requires a new package and run instead of mutating the active run's input.
- [x] Minimal automated coverage at the public executable boundary proves blocked stop, safe same-ticket recovery, and refusal to advance after unsafe or conclusive failure without duplicating broad Phase 4 tests.
- [x] The installed global skill exposes the simple operator interface of Workflow package plus ticket ID and does not require setup commands, run IDs, worktree paths, or direct Worker commands.
- [ ] The manual live gate runs two prepared tickets through two real fresh Codex Workers, with an Orchestrator restart between invocations, one shared feature worktree, two ordered accepted commits, cleaned-up panes, no duplicate execution, and an unchanged primary checkout.
- [ ] Tests, build, installed-skill validation, command help, durable artifacts, and the manual live evidence satisfy the Phase 5 exit gate.

Deterministic evidence passes: 133 automated tests, typecheck, lint, formatting, schema drift, build, installed-skill coverage, and public command help. The manual live gate remains pending because it requires an operator-started real Codex/Herdr run.
