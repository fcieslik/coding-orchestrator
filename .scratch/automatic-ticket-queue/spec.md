# Automatic Ticket Queue

Status: ready-for-agent

## Problem Statement

The Coding Workflow Orchestrator can already execute one ticket through a fresh Worker, preserve durable evidence, and validate Git checkpoints, but the user must advance a multi-ticket Workflow package manually. Review attention and correction also introduce separate workflow concepts even though the downstream `implement` skill already performs `code-review` and returns either a clean result or unresolved findings.

The user wants one minimal, deterministic software-factory flow. Given an ordered Workflow package, the Orchestrator should run every ticket sequentially through Herdr, validate each successful Worker commit using Target repository configuration, and continue until the queue is complete or one explicit condition blocks progress. The Orchestrator should coordinate work, not duplicate implementation or review methodology.

## Solution

When started with a Workflow package, the Orchestrator creates or resumes one Workflow run, captures its filename-ordered Ticket queue, and drains that queue sequentially in one invocation. Every ticket is sent to one fresh Worker through Herdr in the shared Feature worktree. The Worker invokes `implement`, which owns implementation, focused checks, and its internal `code-review`, then publishes one structured Worker result.

A completed Worker result reports either a clean review or unresolved findings. A clean result is followed by the deterministic validation commands configured by the Target repository. If validation passes, the Orchestrator accepts the ticket's Git checkpoint, advances the durable queue, and immediately launches a fresh Worker for the next ticket. After the final ticket passes, the Workflow run completes.

Unresolved findings stop the queue on the current ticket. The Orchestrator displays the findings but does not interpret, rerank, fix, or separately review them. The user may retry the same ticket with the prior findings supplied to a fresh Worker, or continue despite the findings. A successful retry returns to the same validation-and-advance path and automatically resumes the remaining queue. Continue does not bypass deterministic validation: the current commit must still pass before the ticket is accepted and the next Worker starts.

## User Stories

1. As a user, I want to start one accepted Workflow package once, so that I do not invoke the Orchestrator separately for every ticket.
2. As a user, I want the Orchestrator to build one fixed Ticket queue from the package, so that the work to be executed is explicit before delegation begins.
3. As a user, I want ticket order derived from the existing filename order, so that execution is deterministic without a scheduler or dependency graph.
4. As a user, I want all tickets executed sequentially, so that later work builds on accepted earlier commits without merge coordination.
5. As a user, I want one fresh Worker per ticket, so that ticket contexts remain isolated.
6. As a user, I want all Workers to use the Workflow run's shared Feature worktree, so that the queue produces one linear Feature branch.
7. As a user, I want the Orchestrator to launch Workers through Herdr, so that existing agent lifecycle and pane ownership remain in use.
8. As a user, I want the Orchestrator to wait for each Worker before starting the next one, so that queue order is preserved.
9. As a Worker, I want to receive exactly one immutable Ticket input snapshot and the accepted specification context, so that my scope is unambiguous.
10. As a Worker, I want the downstream `implement` skill to own implementation methodology, so that the Orchestrator does not reproduce coding instructions.
11. As a Worker, I want `implement` to run its existing internal `code-review`, so that review methodology remains with the engineering skill.
12. As an Orchestrator, I want one structured Worker result to contain both implementation and review outcome, so that I do not launch an independent Reviewer.
13. As an Orchestrator, I want a clean Worker result to identify its commit, so that I can reconcile it with Git before accepting progress.
14. As an Orchestrator, I want unresolved findings returned as part of the Worker result, so that agent prose or pane output is not workflow truth.
15. As a user, I want repository-specific validation commands read from repository configuration, so that different Target repositories can define their own checks.
16. As a user, I want validation executed by the Orchestrator rather than trusted from Worker claims, so that acceptance is based on deterministic command results.
17. As a user, I want validation to run before a ticket is accepted, so that later tickets do not build on an unchecked checkpoint.
18. As a user, I want a clean result plus passing validation to advance the queue automatically, so that successful packages require no intervention.
19. As a user, I want the final accepted ticket to complete the Workflow run, so that the package has one unambiguous successful outcome.
20. As a user, I want unresolved review findings to stop the queue on the current ticket, so that later Workers do not build on an unaccepted decision.
21. As a user, I want the Orchestrator to show the Worker's findings without rewriting them, so that I can evaluate the original review result.
22. As a user, I want to retry the current ticket after findings, so that a fresh Worker can correct the implementation.
23. As a retry Worker, I want the original ticket and prior findings, so that I know both the required scope and the reason for retry.
24. As a user, I want a clean retry followed by passing validation to resume the queue automatically, so that I do not restart the remaining package manually.
25. As a user, I want to continue when I consider findings false positives, so that review judgement does not overrule my decision.
26. As a user, I want continue to retain deterministic validation, so that ignoring review findings does not ignore repository checks.
27. As a user, I want failed validation to stop on the current ticket, so that the queue never advances past a failing checkpoint.
28. As a user, I want a blocked run to retain the same queue position, so that retry never skips or duplicates a ticket.
29. As a user, I want a restarted Orchestrator to resume from the first unaccepted ticket, so that process lifetime does not define workflow progress.
30. As an Orchestrator, I want queue progress persisted only after checkpoint acceptance, so that a crash cannot mark incomplete work as done.
31. As an Orchestrator, I want an interrupted Worker reconciled through existing execution and Git evidence, so that restart cannot launch duplicate ambiguous work.
32. As a user, I want accepted tickets to remain accepted across retry and restart, so that proven work is not repeated.
33. As a user, I want a Worker technical failure distinguished from review findings, so that operational failure is not presented as a code judgement.
34. As a maintainer, I want the queue loop to reuse existing Worker execution, Herdr, reconciliation, Git checkpoint, and validation modules, so that automation does not duplicate proven machinery.
35. As a maintainer, I want the State snapshot to remain the authoritative workflow truth, so that automation does not introduce a competing scheduler state.
36. As a maintainer, I want the normal flow to have no independent Reviewer, Fixer, or Reporter execution, so that the Orchestrator remains a small coordination module.
37. As a maintainer, I want no automatic review-repair loop or revision counter, so that a finding always produces one understandable human decision point.
38. As a maintainer, I want the full queue behavior tested through one public orchestration seam, so that tests cover the user-visible workflow instead of its internal loop structure.

## Implementation Decisions

- Replace the user-driven one-ticket-at-a-time Workflow step as the normal package flow with one automatic sequential Ticket queue drain. An explicit stop still returns control when the current ticket is blocked or failed.
- Capture the Workflow package once and use its immutable, filename-ordered tickets as the fixed Ticket queue. Do not discover, add, reorder, prioritize, or infer dependencies during a Workflow run.
- Use one Workflow run, Feature branch, and Feature worktree for the entire queue. Each accepted Git checkpoint becomes the base observed by the next fresh Worker.
- Keep queue state minimal and durable. It must identify the fixed queue, the first unaccepted ticket, the run outcome, and any current blocking reason. Completed and pending entries may be derived from queue position rather than represented by another planning model.
- Implement the orchestrator as a sequential durable loop over the first unaccepted ticket. It launches one Worker, waits for a conclusive result, reconciles evidence, validates when eligible, persists acceptance, and repeats until blocked, failed, cancelled, or completed.
- Reuse the existing Worker execution module for every ticket. It remains responsible for immutable inputs, Execution records, agent rendering, Herdr launch and observation, structured result capture, cleanup, bounded diagnostics, and reconciliation.
- Invoke only the downstream `implement` skill for the normal Worker. `implement` owns its internal use of `code-review`; the Orchestrator does not invoke `code-review` as a separate workflow stage.
- Preserve one structured Worker result with `completed`, `blocked`, or `failed`. A completed result includes the candidate commit and either a clean review outcome or unresolved Standards/Spec findings.
- Treat a completed clean result as eligible for deterministic validation. Run the Target repository's configured checks against the reconciled current Feature HEAD. Accept and advance only when every required check passes and Git remains valid and clean.
- Treat unresolved findings as a blocked run at the current queue position. Preserve the Worker result as evidence, expose its findings, and do not copy review methodology or create an additional review report model.
- Support exactly two user decisions for review findings: retry the current ticket or continue with the current candidate commit. No per-finding workflow, resolution taxonomy, revision budget, or automatic fix policy is introduced.
- Retry launches one fresh Worker for the same immutable ticket in the same Feature worktree and supplies the prior unresolved findings. It does not create a new Workflow run or advance the queue. A clean retry follows the ordinary validation path; if accepted, the same invocation resumes the remaining queue.
- Continue records the user's decision to accept the review judgement risk but does not accept the Git checkpoint immediately. The candidate commit must pass the ordinary configured validation before queue advancement.
- A repeated finding after retry blocks again and offers the same two decisions. The Orchestrator does not count revisions or start another Worker without an explicit retry.
- A validation failure blocks the current ticket and does not advance the queue. Existing safe retry or rerun mechanisms may be reused; this feature does not add an automatic repair loop.
- A technical Worker or Herdr failure follows existing failure and reconciliation rules. It is not represented as review attention and cannot be overridden as a false-positive finding.
- After every accepted ticket, publish the new State snapshot before launching the next Worker. Restart selects the first unaccepted ticket and reconciles any Active execution before launching new work.
- Complete the Workflow run only after the final ticket has a reconciled accepted checkpoint and its configured validation has passed. Delivery, integration, deployment, and production monitoring remain separate.
- Update the earlier downstream-skill composition decision where necessary: the basic flow composes `code-review` inside the `implement` Worker rather than as an independent Reviewer execution. Herdr continues to transport the rendered Worker request without workflow semantics.

## Testing Decisions

- Use the public orchestration command as the primary and ideally only new test seam. Drive it with the existing fake Herdr/Worker mechanism and real temporary Git repositories so the test observes queue persistence, process boundaries, commits, validation, and resume behavior together.
- Add one main happy-path integration scenario with several ordered tickets. Assert that one invocation launches one fresh Worker per ticket in order, every later commit descends from the previous accepted checkpoint, validation runs for every ticket, the queue completes, and the primary Target repository checkout is unchanged.
- Add one findings scenario in which the second Worker returns unresolved findings. Assert that the run blocks on the second ticket, no later Worker launches, the findings are returned unchanged, and the queue position does not advance.
- Extend the findings scenario with retry. The fresh retry Worker receives the same ticket plus prior findings, returns clean, passes validation, and the same orchestration invocation automatically launches the remaining Workers and completes the queue.
- Extend or parameterize the findings scenario with continue. Assert that no Fixer or Reviewer launches, configured validation still runs, and only a passing validation allows the next ticket to start.
- Add a validation-failure scenario. Assert that the current ticket is not accepted, later tickets do not launch, and restart preserves the same queue position.
- Add an interruption scenario at the highest public seam. After one accepted ticket and an interrupted next execution, a new process must reconcile existing evidence, avoid repeating accepted work, and avoid duplicating an ambiguous live Worker.
- Assert external behavior rather than loop implementation: Worker launch order, fresh identities, commits, validation outcomes, State snapshot queue position, terminal result, and absence of unexpected launches. Do not test whether the implementation uses `for`, `while`, an index, or derived ticket statuses.
- Reuse existing focused tests for Herdr transport, Worker result schemas, Git checkpoint reconciliation, State snapshot publication, command execution, cleanup, and bounded diagnostics. Do not duplicate those matrices in queue tests.
- Keep automated tests free of real or billable agents. Add one explicit disposable live gate that runs at least two real sequential Workers through Herdr and proves automatic advancement in the shared Feature worktree.
- Run the repository's configured typecheck, lint, format, test, schema-drift, build, and installation checks after implementation.

## Out of Scope

- Parallel ticket execution, multiple simultaneous Workers, per-ticket worktrees, branch merging, or deterministic merge scheduling.
- Ticket dependency graphs, ready-frontier calculation, priorities, dynamic scheduling, or a workflow DSL.
- An independent Reviewer execution, reviewer agent configuration, or an Orchestrator-owned `reviewing` stage.
- A separate Fixer role, automatic repair, automatic review/retry loops, `maxRevisions`, or any other revision counter.
- Per-finding identifiers, dismiss/defer/fix state, severity policy, reranking, or Orchestrator interpretation of review findings.
- A Reporter agent or a new report-path field in the State snapshot. Existing structured artifacts remain sufficient evidence.
- Reimplementing or modifying the Standards/Spec methodology owned by `code-review`.
- Trusting Worker-reported checks instead of configured deterministic validation.
- Skipping configured validation when the user continues past review findings.
- Adding tickets to, removing tickets from, or reordering an active Workflow run.
- Remote tracker reads or write-back, Pull Request creation, integration, deployment, production monitoring, or performance automation.
- Replacing Herdr or introducing another durable workflow framework.

## Further Notes

- Determinism applies to queue order, result contracts, validation commands, state transitions, persistence, and recovery. Worker implementation and review judgement remain nondeterministic.
- The minimal success path is: select the first unaccepted ticket, run one `implement` Worker through Herdr, receive a clean result, validate the commit, accept it, persist queue progress, and repeat.
- The minimal findings path is: preserve the current queue position, expose the Worker findings, and wait for either retry or continue.
- This specification intentionally supersedes the normal user-driven per-ticket invocation described by the earlier Workflow step phase and the mandatory fresh-Fixer resolution described by the earlier review-attention phase.
- State snapshot remains workflow truth, Operational history remains diagnostic audit, Worker result remains evidence, and Git checkpoint remains accepted implementation progress.

## Comments
