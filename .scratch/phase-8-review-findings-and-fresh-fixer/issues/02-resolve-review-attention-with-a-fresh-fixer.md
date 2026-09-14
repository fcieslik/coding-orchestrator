# 02: Resolve review attention with a fresh Fixer

**What to build:** Allow the user to supply an explicit resolution for an existing Review attention state and have the Orchestrator apply it through exactly one fresh Fixer execution. The Fixer receives a bounded Fix brief, preserves the candidate commit, creates a separate correction commit, and publishes structured evidence that the Orchestrator independently validates before accepting the original ticket.

**Blocked by:** 01: Return unresolved review findings as durable attention

**Status:** completed

- [x] A natural-language `$orchestrate` request with the user's explicit resolution selects the attention state for the requested Workflow package and ticket without requiring the user to remember internal helper arguments.
- [x] Without an explicit resolution the run remains blocked and no agent is launched.
- [x] Before launch, the Orchestrator revalidates the candidate commit, Feature branch, Feature worktree registration, HEAD, cleanliness, attention artifacts, attempt allowance, and absence of another Active execution.
- [x] Drift, missing evidence, ambiguous selection, or work outside the original ticket/specification scope fails closed before launching a Fixer.
- [x] The durable Fix brief contains only the immutable ticket and specification references, candidate commit, exact unresolved findings, user resolution, allowed scope, safeguards, result path, and commit/output requirements.
- [x] The Fix brief is an internal execution artifact rather than a generated tracker ticket or plan.
- [x] The Orchestrator launches a fresh `fixer` role through Herdr and never reopens or prompts the original Worker pane.
- [x] The Fixer uses a bounded role contract and does not automatically invoke `implement` unless a dedicated fixer skill is explicitly configured in a later change.
- [x] The Fixer works only in the existing Feature worktree, preserves the candidate commit in ancestry, makes only the requested correction, creates at least one separate commit, and atomically publishes `completed`, `blocked`, or `failed` evidence.
- [x] Successful finalization requires a matching clean Feature HEAD, valid candidate ancestry, valid Fixer result, and successful owned-pane cleanup before the new commit becomes the Accepted ticket checkpoint.
- [x] A successful Fixer accepts the original ticket and advances the existing single-ticket Workflow step semantics without creating another ticket.
- [x] A blocked, failed, missing, malformed, or side-effect-ambiguous Fixer preserves all known work and leaves the run blocked without a second automatic Fixer.
- [x] Restart and repeated resolution reconcile the same execution or accepted checkpoint and never launch a duplicate Fixer or create a duplicate commit.
- [x] Public-process tests cover the fresh-Fixer happy path, refusal matrix, every result class, interruption boundaries, one-attempt limit, and idempotent recovery while reusing lower-level Herdr and Git tests where possible.
- [x] Human and JSON output identify the candidate, Fixer outcome, accepted commit when present, and smallest next user action when blocked.
