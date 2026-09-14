# Phase 8 — unresolved review findings and fresh Fixer

**Status:** completed

## Problem Statement

The implementation Worker runs the downstream `code-review` skill before committing, but the resulting findings are currently visible only inside the ephemeral Worker context. The Orchestrator receives a `Worker result` containing a commit and summary, so it can accept an implementation even when the Worker noticed an important unresolved standards or specification problem.

The user needs a durable distinction between an implementation that is ready to accept and an implementation that exists as a candidate commit but requires a decision. When the user supplies that decision, recovery must not depend on reopening the original Herdr pane or reconstructing its conversation.

## Solution

Extend the Worker result contract with a concise structured review outcome. The Worker continues to resolve clear, safe findings that remain inside the assigned Ticket input snapshot. When an important finding cannot be resolved without a product, architecture, security, destructive-operation, credential, human, or scope decision, the Worker preserves and commits the implementation, publishes the unresolved finding and smallest required decision, and stops.

The Orchestrator validates this candidate commit normally but does not accept the ticket or advance the Ticket queue. It durably records that the implementation needs attention, closes the original Worker pane, and reports both the implemented commit and unresolved findings to the user.

After the user supplies an explicit resolution, the Orchestrator launches one fresh `fixer` execution with a bounded fix brief containing the immutable ticket and specification inputs, candidate commit, unresolved findings, and user decision. The Fixer works in the existing Feature worktree, creates a new commit, and publishes a structured result. The Orchestrator independently validates the resulting Git checkpoint before accepting the ticket.

## User Stories

1. As a user, I want to know that implementation code exists even when its internal review found unresolved problems, so that implementation progress is not confused with acceptance.
2. As a user, I want unresolved review findings reported by the Orchestrator, so that they are not lost when the Worker pane closes.
3. As a user, I want each unresolved finding to state the smallest required decision, so that I can respond without reconstructing the Worker's reasoning.
4. As a user, I want to give the Orchestrator an explicit resolution in a later invocation, so that recovery survives closing or restarting the main agent.
5. As a user, I want the original implementation preserved while I decide, so that useful work is not discarded.
6. As a user, I want an implementation with unresolved findings kept out of the accepted Ticket queue, so that later tickets do not build on work the workflow has not accepted.
7. As a Worker, I want to fix findings that are clearly safe and within the assigned ticket, so that the user is not interrupted for routine corrections.
8. As a Worker, I want to stop instead of guessing when a finding requires a decision or scope expansion, so that I do not silently change product intent.
9. As a Worker, I want the review handoff format included in my output contract, so that I can publish durable evidence without exposing my entire transcript.
10. As a Worker, I want the Ticket input snapshot to remain my only implementation scope, so that review does not authorize unrelated cleanup or refactoring.
11. As a Worker, I want the Specification input snapshot to remain read-only context, so that resolving a finding does not expand the assigned ticket implicitly.
12. As an Orchestrator, I want to distinguish a clean review outcome from unresolved findings, so that I do not infer quality from agent settlement.
13. As an Orchestrator, I want to validate a candidate commit against the same branch, HEAD, ancestry, worktree, and cleanliness invariants as a completed implementation, so that review findings do not weaken Git safety.
14. As an Orchestrator, I want a known candidate commit with valid findings to be a supported durable outcome rather than an ambiguous side effect, so that it can be resumed safely.
15. As an Orchestrator, I want to record the review handoff in the State snapshot and Operational history, so that restart produces the same next action.
16. As an Orchestrator, I want to close the original owned pane after capturing its artifacts, so that recovery does not depend on an ephemeral process.
17. As an Orchestrator, I want to reject a resolution when the candidate commit, Feature branch, or Feature worktree has changed unexpectedly, so that a Fixer never starts from ambiguous state.
18. As an Orchestrator, I want to launch a fresh Fixer after the user's decision, so that correction starts with explicit durable context rather than prior conversation history.
19. As a Fixer, I want a bounded brief containing only the finding, decision, ticket/specification references, worktree, and output contract, so that my scope is narrow.
20. As a Fixer, I want to preserve the Worker's candidate commit and add a separate commit, so that implementation and correction remain auditable.
21. As a Fixer, I want to return `completed`, `blocked`, or `failed` through a structured artifact, so that prose and terminal lifecycle do not become workflow truth.
22. As an Orchestrator, I want to validate the Fixer commit independently before accepting the ticket, so that agent self-report is insufficient for success.
23. As an Orchestrator, I want at most one Fixer attempt in this first version, so that the feature cannot create an unbounded repair loop.
24. As a user, I want a failed or blocked Fixer to preserve both commits and artifacts, so that I can decide the next manual action.
25. As a user, I want repeated resolution commands to be idempotent, so that restarting the Orchestrator does not duplicate Fixers or commits.
26. As a maintainer, I want review methodology to remain owned by the downstream `code-review` skill, so that the Orchestrator adds only lifecycle and output semantics.
27. As a maintainer, I want the Fixer to use a bounded role contract rather than automatically invoking `implement`, so that correction methodology is not assumed without a configured fixer skill.
28. As a maintainer, I want findings and diagnostics bounded and structured, so that run state does not become a copy of the Worker transcript.
29. As a maintainer, I want existing Workers that publish the current successful result shape to remain compatible, so that this feature does not invalidate already supported execution paths.

## Implementation Decisions

- The public behavior is one durable review-attention flow: Worker execution may finish with either a clean implementation or a validated candidate implementation carrying unresolved review findings.
- Do not classify findings using undefined labels such as `medium` or `large`. An unresolved finding is one the Worker cannot safely resolve inside the assigned ticket without an external decision or scope expansion.
- The Worker remains responsible for applying clear, safe corrections discovered by its internal downstream review before publishing its final result.
- Extend the completed Worker result additively with a bounded review outcome. A clean outcome contains no unresolved findings. An attention outcome contains one or more structured findings with an axis, concise summary, evidence/reference when available, and smallest required decision.
- Keep the existing Worker statuses `completed`, `blocked`, and `failed`. Review attention is evidence attached to a technically completed implementation, not a fourth transport outcome.
- A `completed` result with a clean review outcome follows the existing acceptance path.
- A `completed` result with unresolved findings must identify a canonical candidate commit. The Orchestrator validates it using the existing nonmutating result and Git reconciliation seam but does not record it as the Accepted ticket checkpoint.
- Record the candidate commit, unresolved findings, Worker attempt, and attention status durably in the Workflow run. The run becomes blocked with `interruptedPhase = implementing`; this is a supported review handoff, not ambiguous Git evidence.
- Add a dedicated Operational history event for review attention and retain the existing run lock and revision rules.
- The original Worker pane is always closed through existing owned-pane cleanup. The workflow never attempts to reopen or converse with that Worker after returning control to the user.
- A later natural-language `$orchestrate` request may apply an explicit user-supplied resolution through a fresh Fixer. Without that resolution, the run remains blocked. The helper command remains an internal mechanism of the skill.
- Before launching the Fixer, revalidate the run, candidate commit, Feature branch, Feature worktree registration, HEAD, cleanliness, artifacts, and absence of another active execution. Any drift blocks without launching an agent.
- A fix action creates one fresh execution with role `fixer`. It receives the immutable Ticket input snapshot, Specification input snapshot, candidate commit, structured unresolved findings, the user's durable resolution, Feature worktree, result path, and the existing safeguards.
- The persisted Fix brief is an internal execution artifact, not a new tracker ticket or plan. It may only resolve findings inside the original ticket scope.
- A finding whose resolution would expand the original ticket or specification remains blocked and instructs the user to prepare a separate ticket or Workflow package; the Orchestrator never generates or appends that work automatically.
- The Fixer uses a bounded fixer contract. It does not automatically invoke `implement` unless a dedicated fixer skill is explicitly configured in a future change.
- The Fixer must work only in the existing Feature worktree, keep the candidate commit in ancestry, make only the requested correction, create at least one new commit, and publish its result atomically.
- Reuse Herdr's opaque prompt transport, fresh-process launch, wait/read behavior, bounded diagnostics, ownership, and cleanup. Herdr remains unaware of review or fixer semantics.
- Reuse existing checkpoint inspection and acceptance. Successful Fixer finalization requires a valid completed result, matching clean Feature HEAD, candidate ancestry, and successful owned-pane cleanup.
- After a successful Fixer, accept its commit as the ticket's Git checkpoint and continue the existing single-ticket Workflow step semantics.
- A Fixer blocker or technical failure preserves the candidate and Fixer evidence and leaves the run blocked. No automatic second Fixer, review/fix loop, reset, or cleanup occurs.
- Repeated commands reconcile durable state. They may report an existing accepted result or existing active/blocked Fixer, but must never launch a duplicate execution.
- Bound the number and size of unresolved findings. Do not persist the complete internal review, prompt, transcript, or hidden chain of reasoning.
- Preserve compatibility with Worker results that omit the review field by treating them according to the current successful path. Tightening that compatibility can be a later schema-versioned policy after live adoption.
- Update the installed skill documentation and Worker/Fixer prompt assets to explain the output and lifecycle contract without restating Standards or Spec review methodology.
- Add the terms `Review attention`, `Candidate commit`, `Review finding`, and `Fixer attempt` to the domain glossary. Record a new ADR only if implementation requires changing the existing responsibility boundary; the intended design is consistent with the current downstream-skill composition ADR.

## Testing Decisions

- Prefer the public `flow` process seam with a fake Herdr executable and real temporary Git repositories. It should cover Worker output, durable attention state, restart, user resolution, fresh Fixer launch, Git validation, ticket acceptance, and idempotency in one observable flow.
- Add focused runtime-schema tests for a clean review outcome, bounded unresolved findings, missing required decisions, malformed findings, unknown additive fields, and backward-compatible completed results without review data.
- Test a Worker that creates a real candidate commit and publishes unresolved findings. Assert that the Orchestrator reports implementation plus findings, closes only the owned pane, blocks the run, does not accept the ticket, and does not advance the Ticket queue.
- Test that an obvious finding resolved by the Worker produces the existing clean completed path and does not create review-attention state.
- Test restart before the user decision. A fresh Orchestrator invocation must report the same candidate commit and findings without launching a Worker or Fixer.
- Test the fix path with one fresh fake Fixer. Assert that its prompt contains the immutable ticket/specification references, candidate commit, exact persisted findings, explicit user resolution, result path, safeguards, and no duplicated code-review or implementation methodology.
- Test that the Fixer adds a separate commit whose ancestry includes the candidate and that only the validated Fixer commit becomes the Accepted ticket checkpoint.
- Test refusal before Fixer launch for changed HEAD, dirty worktree, wrong branch, missing candidate commit, modified attention artifacts, active execution, and exhausted Fixer allowance.
- Test `completed`, `blocked`, `failed`, missing, malformed, and mismatched Fixer results using the existing reconciliation matrix without duplicating every lower-level transport test.
- Test interruption after resolution persistence, after Fixer launch, after Fixer commit/result, and after cleanup but before acceptance. Repeating the command must reconcile rather than duplicate work.
- Test that one Fixer attempt is the hard limit and that no automatic review/fix cycle occurs.
- Run the existing full test, lint, typecheck, format, schema, build, and installer gates.
- Finish with an opt-in disposable-repository live test: a real Worker publishes one unresolved review decision, the main Orchestrator is restarted, the user supplies a resolution, one fresh Fixer creates a follow-up commit, and the ticket is accepted without modifying the primary checkout.

## Out of Scope

- Reopening, preserving, or sending later prompts to the original Worker pane.
- Asking the original Worker to continue after it published its result.
- Automatic interpretation or reranking of free-form review prose by the Orchestrator.
- Inventing `medium` or `large` severity semantics not provided by the downstream review skill.
- An independent workflow-level Reviewer or fixed `BASE_SHA..HEAD_SHA` review gate.
- Automatically repeating review after the Fixer or building a review/repair loop.
- More than one automatic Fixer attempt.
- Automatically using the `implement` skill for the Fixer.
- Acceptance of unresolved findings without a Fixer commit that resolves the supplied decision.
- Starting later tickets while the current ticket remains in review-attention state.
- Resetting, squashing, rewriting, merging, pushing, creating a Pull Request, or cleaning Feature resources as part of review resolution.
- Changing the downstream `code-review` methodology, its two-axis presentation, or its use of sub-agents.
- A generic workflow DSL, dependency graph, scheduler, or parallel execution.
- Automatic generation of plans, tracker tickets, or Workflow package entries from review findings.

## Further Notes

- The deterministic part of this feature is the input/output contract, state transition, Git verification, attempt bound, and idempotent recovery. The Worker, review judgement, and Fixer remain nondeterministic.
- Review attention differs from an ordinary blocker because a known implementation commit exists and is expected. It differs from an Accepted ticket because the user has not resolved the reported concern.
- Keeping the candidate commit in Git is safer and simpler than attempting rollback. The subsequent Fixer commit provides an auditable record of the user's decision.
- If live use shows that harmless judgement calls cause excessive interruptions, an explicit accept-as-is path can be considered later rather than added pre-emptively.
