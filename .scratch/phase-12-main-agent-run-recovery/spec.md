# Phase 12 — Main-agent-owned run recovery

**Status:** ready-for-agent

## Problem Statement

The Coding Workflow Orchestrator can leave a Workflow run with an active ticket or blocked phase when a Worker does not start, disappears, times out, or fails while publishing its result. The code, branch, or commit may still exist, but the durable run state does not automatically prove whether the ticket is accepted, retryable, or abandoned.

Today the operator may be tempted to delete the run or edit its files manually. That destroys workflow history and does not provide a safe way to distinguish a recoverable interrupted Worker attempt from an ambiguous Git or artifact state. A main agent needs a small, auditable recovery path that a Worker cannot invoke or impersonate.

## Solution

Add one main-agent-owned run recovery operation with three explicit actions:

- reconcile an interrupted or ambiguous execution against its durable evidence;
- accept one explicitly selected Git checkpoint after the existing checkpoint validation passes;
- cancel a run that cannot safely continue, recording the reason and preserving its evidence.

The operation must reuse the existing run locks, execution reconciliation, lifecycle mutation, ticket queue semantics, and checkpoint validation. It must not become a generic state editor, a second workflow engine, or an automatic process killer.

Recovery is append-only and idempotent. Reconciliation may close an unambiguous interrupted attempt and may repair the known one-revision history publication gap through the existing guarded mechanism, but it must stop on ambiguity. Acceptance uses the same semantics as the normal Workflow step: a non-final ticket becomes `accepted` and the run returns to `implementing`; the final ticket becomes `accepted` and the run becomes `completed`. Cancellation makes the run terminal while retaining state, history, worktree, branch, and artifacts.

## User Stories

1. As an Orchestrator, I want to reconcile a run whose Worker did not start, so that I can determine whether a retry is safe without deleting the run.
2. As an Orchestrator, I want to reconcile a run whose Worker disappeared, so that the durable execution and Git evidence determine the next safe action.
3. As an Orchestrator, I want to reconcile a timed-out Worker attempt, so that a timeout is not silently treated as success or failure.
4. As an Orchestrator, I want reconciliation to inspect the execution record, Worker result, Git state, Feature worktree, and owned Herdr identity, so that recovery uses evidence from every existing boundary.
5. As an Orchestrator, I want reconciliation to report when a Worker is still alive, so that recovery does not race a running process.
6. As an Orchestrator, I want reconciliation not to kill a live Worker automatically, so that an observation command cannot cause an unexpected destructive side effect.
7. As an Orchestrator, I want a conclusive missing or failed Worker result with a clean unchanged worktree to remain retryable, so that a launch failure can be retried through the existing bounded retry path.
8. As an Orchestrator, I want a dirty or changed worktree to block automatic recovery, so that untracked or partial implementation is not discarded or misclassified.
9. As an Orchestrator, I want conflicting result and Git evidence to remain ambiguous, so that the system does not guess which source is authoritative.
10. As an Orchestrator, I want cleanup failures to remain visible, so that a new Worker is not launched while the previous attempt may still own resources.
11. As an Orchestrator, I want to accept a specific commit after recovery, so that work completed before an orchestration failure can become an official Git checkpoint.
12. As an Orchestrator, I want checkpoint acceptance to use the existing validation rules, so that manual recovery cannot weaken worktree, ancestry, or baseline guarantees.
13. As an Orchestrator, I want a commit on the integration branch alone not to prove ticket completion, so that unrelated or manually edited changes cannot be accepted by accident.
14. As an Orchestrator, I want acceptance to require an explicitly named commit, so that recovery never chooses a moving branch head implicitly.
15. As an Orchestrator, I want the active ticket to become `accepted` only after the checkpoint succeeds, so that ticket state remains derived from durable Git evidence.
16. As an Orchestrator, I want accepting a non-final ticket to leave the next ticket pending, so that the normal sequential queue remains intact.
17. As an Orchestrator, I want accepting the final ticket to complete the implementation phase, so that repaired runs have the same terminal meaning as normally completed runs.
18. As an Orchestrator, I want repeating an acceptance for an already accepted ticket to be a no-op, so that a retry after a lost CLI response cannot duplicate work or history.
19. As an Orchestrator, I want to cancel a run when no safe checkpoint exists, so that a permanently stuck run does not block the repository forever.
20. As an Orchestrator, I want cancellation to require a reason, so that a later operator can understand why the run was abandoned.
21. As an Orchestrator, I want cancellation to preserve state, history, worktree, branch, and artifacts, so that the failure remains diagnosable and recoverable as evidence.
22. As an Orchestrator, I want cancellation not to launch a retry, so that ending a run and starting new work remain separate decisions.
23. As an Orchestrator, I want recovery actions serialized by the existing run lock, so that two main agents cannot accept, cancel, or reconcile the same run concurrently.
24. As an Orchestrator, I want recovery mutations recorded in operational history, so that the operator decision and its evidence are auditable.
25. As an Orchestrator, I want recovery to be append-only, so that it never rewrites earlier events or silently changes the past.
26. As an Orchestrator, I want a known one-revision history publication gap to be repairable through a guarded operation, so that an interrupted state publication does not require manual file editing.
27. As an Orchestrator, I want larger or ambiguous state/history corruption to fail closed, so that recovery never invents missing history or overwrites original bytes.
28. As an Orchestrator, I want an active or blocked run to be preserved rather than deleted, so that run deletion is not used as a status repair mechanism.
29. As an Orchestrator, I want an explicit recovery command rather than a generic state editor, so that the supported actions remain understandable and constrained.
30. As an Orchestrator, I want the three recovery actions to be mutually exclusive, so that one invocation cannot both accept and cancel a run.
31. As an Orchestrator, I want structured JSON output for recovery, so that another main agent can consume evidence without scraping human text.
32. As an Orchestrator, I want human-readable recovery output, so that an operator can repair a run from a terminal without inspecting implementation details.
33. As an Orchestrator, I want invalid run identifiers, missing evidence, lock contention, and invalid commits to fail with the existing error conventions, so that recovery behaves consistently with the rest of the CLI.
34. As a Worker, I want to remain unable to mutate Workflow state, so that a Worker result cannot mark its own ticket accepted or cancel its run.
35. As a Worker, I want to publish only result and diagnostic artifacts, so that the Orchestrator remains responsible for interpreting evidence.
36. As a main agent, I want to use recovery without becoming a Worker, so that human or supervisory decisions remain outside the delegated implementation contract.
37. As a repository owner, I want the original run to remain available after cancellation, so that a later new run can be compared with the failed attempt.
38. As a repository owner, I want the Feature branch and commit objects preserved during recovery, so that manual integration or later investigation does not lose Git evidence.
39. As a maintainer, I want recovery to reuse existing lifecycle and checkpoint semantics, so that the feature does not introduce a parallel state machine.
40. As a maintainer, I want one public CLI integration seam, so that recovery is tested as an operator-facing behavior rather than as private file manipulation.
41. As a maintainer, I want recovery tests to use temporary Git repositories and fake Herdr execution, so that they are deterministic and do not require a real agent or provider credentials.
42. As a maintainer, I want tests for success, ambiguity, live-worker refusal, idempotency, lock contention, audit gaps, and corruption, so that recovery fails closed at every important boundary.
43. As a documentation reader, I want a short operator guide mapping symptoms to recovery actions, so that I know when to reconcile, accept, cancel, retry, or start a new run.
44. As a documentation reader, I want the guide to state that direct JSON edits and deletion are unsupported, so that the documented recovery path preserves workflow history.

## Implementation Decisions

- Add one public `run repair` operation with three mutually exclusive actions: reconcile evidence, accept an explicit commit, or cancel with a required reason.
- Keep recovery owned by the Orchestrator or a main agent. Worker prompts, Worker result artifacts, and Worker execution code must not gain authority to mutate Workflow truth.
- Use the existing public CLI as the highest test seam. The recovery operation must be observable through its human-readable and structured output without requiring tests to call private persistence helpers.
- Reuse the existing run lock for every recovery action. Lock contention must preserve the run and return the existing lock error behavior.
- Reuse existing execution reconciliation for Worker-attempt evidence. Do not create a second attempt state model or a separate recovery database.
- Reuse the existing checkpoint validation for `accept`. The explicit commit must satisfy the same ready Feature worktree, ancestry, baseline, cleanliness, and repository identity checks as a normal accepted checkpoint.
- Do not accept a commit solely because it is present on the integration target branch, because a Worker reported completion, or because a Herdr pane disappeared.
- Apply normal ticket queue semantics after successful acceptance. Update only the selected active ticket and the run phase needed to represent the next pending ticket or implementation completion.
- Make acceptance idempotent for a ticket already accepted with the same checkpoint. Do not append a duplicate state mutation when the requested result is already true.
- Require a non-empty cancellation reason and record it in the state-changing history event. Cancellation is terminal but does not remove Git or runtime artifacts.
- Do not automatically kill a live Worker during reconciliation. A live execution is reported as unresolved and requires an explicit operator decision.
- Permit only the already-defined, bounded one-revision history repair when the snapshot is readable and the missing history publication is unambiguous. Do not add a general JSON editor or history reconstruction algorithm.
- Fail closed for malformed snapshots, invalid history sequences, larger revision gaps, unexpected runtime entries, ambiguous Git evidence, dirty worktrees, failed cleanup, or missing ownership proof. Preserve original bytes and report the recovery boundary.
- Keep recovery append-only and idempotent. Recovery events must use the existing operational history and state snapshot publication rules.
- Preserve existing commands such as status, history, worker reconcile, worker retry, run resume, checkpoint validation, and terminal worktree cleanup. Recovery composes these capabilities rather than replacing them.
- Keep run deletion outside the repair operation. If deletion is ever supported, it remains a separate cleanup operation restricted to a safely terminal run and is not a recovery shortcut.
- Keep the implementation minimal: no daemon, panel, new persistence store, arbitrary state mutation flags, automatic retry loop, automatic process termination, or new agent protocol.
- Update the operator documentation with the symptom-to-action decision table and the invariants against deletion, manual JSON edits, implicit branch-head acceptance, and live-worker termination.

## Testing Decisions

- Test external behavior through the public CLI recovery operation using the existing temporary Target repository, Git worktree, and fake Herdr patterns.
- Assert human-readable output for the recovery outcome and concise next action, and assert structured JSON output for run identity, ticket, evidence summary, state, and error details.
- Cover reconciliation of a missing result with a clean unchanged worktree and verify that the existing bounded retry path becomes eligible without accepting the ticket.
- Cover reconciliation when a Worker is still alive and verify that no state acceptance, cancellation, process termination, or duplicate attempt occurs.
- Cover reconciliation with a valid completed result and matching commit, followed by explicit acceptance of that commit.
- Cover acceptance of a non-final ticket and verify that the ticket becomes accepted while the next ticket remains pending and the run remains implementing.
- Cover acceptance of the final ticket and verify that the ticket becomes accepted and the run becomes completed.
- Cover invalid, stale, dirty, unrelated, and integration-branch-only commit candidates and verify that no state or history mutation occurs.
- Cover cancellation with a reason and verify terminal state, preserved artifacts, recorded reason, and no retry launch.
- Cover repeated reconcile, repeated accept, and repeated cancel operations and verify idempotent external behavior and no duplicate history events where the requested result is already true.
- Cover run-lock contention and verify that a competing recovery action fails without changing state or artifacts.
- Cover the known one-revision history publication gap and verify that the guarded repair restores a synchronized audit without rewriting prior bytes.
- Cover malformed state, malformed history, larger revision gaps, and ambiguous evidence and verify fail-closed diagnostics with preserved original bytes.
- Cover that Worker-facing execution paths cannot invoke or perform main-agent recovery mutations.
- Reuse existing CLI, lifecycle, workflow-run, worker reconciliation, checkpoint, and cleanup tests as prior art. Add only the focused cases needed for the new public operation.
- Do not use real model calls, provider credentials, live Claude Code/Pi/Codex sessions, or a new UI framework in ordinary tests.

## Out of Scope

- Direct editing of state snapshots or operational history by an operator, Worker, or arbitrary CLI flag.
- Deleting active, blocked, failed, or otherwise non-terminal runs as a repair strategy.
- Automatically killing Herdr panes or Worker processes during reconciliation.
- Automatic retry loops, automatic commit selection, automatic merge/integration, or automatic push/delivery.
- A new persistence store, recovery daemon, background monitor, web UI, or multi-run recovery dashboard.
- Reconstructing ambiguous or materially corrupted snapshots, history, execution records, or Git repositories.
- Replacing existing Worker reconciliation, retry, checkpoint validation, lifecycle transitions, or cleanup commands.
- Changing Worker, Reviewer, Fixer, Agent profile, Claude Code, or Pi behavior beyond the authority boundary needed to prevent Worker-side repair.
- Adding a general authorization system or remote multi-user operator service.
- Treating manual changes already present on the integration target branch as automatic proof that a ticket is accepted.

## Further Notes

- The existing domain model distinguishes Run phase, ticket queue status, Worker attempt, Worker result, Execution reconciliation, and Git checkpoint. Recovery must preserve those distinctions rather than collapse them into a single `status` field.
- A run that was manually integrated may still be repairable when its Feature branch, Feature worktree, and checkpoint ancestry remain verifiable. If those invariants are no longer provable, the safe action is cancellation or investigation, not forced acceptance.
- The operator guide should be the first place a main agent looks when a status panel shows an active ticket that cannot advance. It should direct the agent to preserve the run, inspect evidence, and choose one explicit action.
- This phase defines the recovery contract. Implementation should be split into small tickets only after the spec is accepted, with the public CLI seam kept central.
