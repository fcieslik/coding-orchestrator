# Phase 5 — User-Driven Ticket Steps

Status: ready-for-agent

## Problem Statement

The Coding Workflow Orchestrator can execute and validate one explicitly selected ticket through a fresh Worker, but using it for a feature with several prepared tickets still requires the operator to assemble low-level setup, run, worktree, and Worker commands. The earlier Phase 5 design added a dependency graph, ready-ticket calculation, automatic scheduling, tracker adapters, and a loop that executed every ticket. That is too much machinery for the current proof of concept and hides control from the user. The user needs a minimal way to advance one durable feature workflow by one known ticket at a time, while keeping all ticket implementations on one Feature branch and Feature worktree and preserving safe restart, blocker recovery, and checkpoint validation.

## Solution

Accept a prepared local Workflow package containing one `spec.md` and a filename-ordered `issues/*.md` Ticket queue. The user invokes the Orchestrator with the package and exact ticket ID. The Orchestrator automatically initializes repository-local configuration when needed, creates or resumes the single matching Workflow run, uses the immutable copy of the package owned by that run, and verifies that the requested ticket is the first pending queue entry. It then delegates that one Ticket input snapshot to the existing Phase 4 skill-aware Worker execution, validates the result and Git checkpoint, records the ticket as accepted, reports the next ticket, and returns control. Every ticket uses a fresh Worker, while the entire package shares one Workflow run, Feature branch, and Feature worktree.

A repeated accepted-ticket request is an idempotent no-op. A blocked ticket prevents later tickets from running. When the user resolves an external blocker and explicitly invokes the same ticket again, the Orchestrator reconciles the prior attempt and may resume the run with one fresh bounded Worker attempt only when Git, artifacts, cleanup, and the attempt budget prove that retry is safe. A blocker resolution that changes the accepted spec or ticket requires a new Workflow run from a newly prepared package.

## User Stories

1. As a user, I want to provide one prepared Workflow package, so that the Orchestrator receives an unambiguous spec and Ticket queue.
2. As a user, I want the Workflow package to have one fixed directory shape, so that I do not need ticket-source configuration.
3. As a user, I want to invoke the Orchestrator with the package and exact ticket ID, so that I retain control over each implementation step.
4. As a user, I want one invocation to execute at most one ticket, so that I can inspect the result before continuing.
5. As a user, I want the Orchestrator to return control after every accepted ticket, so that the POC remains understandable and predictable.
6. As a user, I want repository setup performed automatically when it is missing, so that I do not need to remember a separate setup command.
7. As a user, I want run creation and Git preparation performed automatically for the first ticket, so that run IDs and worktree paths are not operator inputs.
8. As a user, I want later invocations to resume the matching Workflow run automatically, so that continuing a feature requires the same simple command shape.
9. As a user, I want ambiguity between multiple matching unfinished runs refused, so that the Orchestrator never guesses which durable state to mutate.
10. As a user, I want a completed matching run reported without creating a new run, so that accidental repeated invocations do not repeat implementation.
11. As a user, I want a new run to require an explicit request, so that rerunning completed work is intentional.
12. As an Orchestrator, I want the Workflow package located inside the Target repository, so that repository identity and input ownership are clear.
13. As an Orchestrator, I want the package specification to be a regular Markdown file, so that the accepted feature definition cannot be redirected through a symlink.
14. As an Orchestrator, I want at least one regular Markdown ticket, so that an empty package cannot create a meaningless Workflow run.
15. As an operator, I want malformed packages rejected before partial run creation, so that correcting input leaves no cleanup burden.
16. As an Orchestrator, I want canonical ticket IDs derived from filenames, so that tickets need no additional metadata schema.
17. As an Orchestrator, I want ticket order derived lexically from filenames, so that the queue is deterministic without dependency parsing.
18. As a user, I want gaps in numeric filename prefixes tolerated, so that ordering does not require renumbering every ticket.
19. As an Orchestrator, I want exact ticket-ID matching, so that fuzzy selection cannot dispatch the wrong work.
20. As a Worker, I want the ticket body passed as opaque Markdown input, so that the Orchestrator does not reinterpret implementation instructions.
21. As a user, I want ticket frontmatter, status, priority, and blocking edges unnecessary, so that the package format stays minimal.
22. As an Orchestrator, I want the complete package copied when the run is created, so that restart uses the same accepted inputs.
23. As an Orchestrator, I want later steps to use the run-owned package copy, so that changes in the source tracker cannot silently change an active run.
24. As an operator, I want changed source files to require an explicit new run when they alter accepted work, so that input lineage remains clear.
25. As an Orchestrator, I want one fixed Ticket queue recorded for the run, so that tickets added later do not enter it accidentally.
26. As an Orchestrator, I want only minimal per-ticket state, so that Phase 5 does not become a second issue tracker.
27. As an operator, I want pending, active, and accepted tickets distinguishable, so that current progress is directly inspectable.
28. As an operator, I want every accepted ticket associated with its validated commit, so that queue progress has durable Git evidence.
29. As an Orchestrator, I want the first pending ticket to be the only eligible selection, so that users cannot skip required earlier work.
30. As a user, I want an out-of-order selection rejected with the expected next ticket, so that recovery is obvious.
31. As a user, I want repeating an accepted ticket to return its existing commit without launching a Worker, so that retrying a command is safe.
32. As an Orchestrator, I want one Workflow run, Feature branch, and Feature worktree for the entire package, so that later tickets build on earlier commits.
33. As a user, I want the primary checkout untouched by delegated ticket work, so that the feature remains isolated until I decide how to integrate it.
34. As an Orchestrator, I want each selected ticket executed by a fresh Worker, so that implementation contexts do not accumulate unrelated conversation history.
35. As a Worker, I want to receive only one immutable Ticket input snapshot, so that I never discover, select, or schedule other tickets.
36. As an Orchestrator, I want ticket execution delegated to the existing Phase 4 subsystem, so that skill rendering, Herdr transport, result validation, and checkpoint acceptance are not duplicated.
37. As an Orchestrator, I want `implement` to remain the owner of engineering methodology, so that Phase 5 adds no implementation instructions.
38. As an operator, I want Worker completion accepted only after existing result and Git checkpoint validation, so that queue state cannot advance on agent prose.
39. As an operator, I want a concise step result containing ticket, outcome, commit, and next ticket, so that routine execution does not dump internal records.
40. As a user, I want the final accepted ticket to complete the implementation run, so that the package has a clear terminal result.
41. As a user, I want completion to state that Phase 6 validation stages have not run, so that implementation completion is not confused with review or system validation.
42. As an Orchestrator, I want a blocked or failed ticket to keep later tickets unavailable, so that the queue cannot advance past unresolved work.
43. As a user, I want the blocked result to explain the smallest required action, so that I can resolve the actual impediment.
44. As a user, I want to retry a resolved blocked ticket by invoking that same ticket again, so that recovery uses the ordinary operator interface.
45. As an Orchestrator, I want repeated invocation of a blocked ticket treated as an explicit resume request, so that retry is never inferred autonomously.
46. As an Orchestrator, I want the previous attempt reconciled before resume, so that a fresh Worker cannot duplicate unknown side effects.
47. As an Orchestrator, I want blocked retry allowed only when the previous pane is settled or closed, the worktree is clean, HEAD remains at the prior checkpoint, and artifacts are unambiguous, so that recovery fails closed.
48. As an Orchestrator, I want blocked retry to consume the existing bounded Worker attempt budget, so that human-triggered recovery cannot create an unlimited loop.
49. As a user, I want a safe blocked retry to launch a fresh Worker with the same Ticket input snapshot and Feature worktree, so that resolved external conditions can be tested in a clean context.
50. As a user, I want an unsafe blocked retry refused with the conflicting Git or artifact evidence, so that no work is overwritten or guessed away.
51. As a user, I want a blocker that changes requirements to require a new package and run, so that immutable accepted input is preserved.
52. As a user with GitHub or Linear tickets, I want a preparation process to materialize the same local Workflow package, so that remote origin does not change execution semantics.
53. As a Worker, I want no access to tracker discovery or selection, so that my only responsibility is implementing the assigned snapshot.
54. As a security-conscious user, I want Phase 5 to require no GitHub or Linear credentials, so that execution does not gain unnecessary external authority.
55. As a project owner, I want tracker write-back deferred, so that the POC proves local execution before adding synchronization failure modes.
56. As a maintainer, I want the Phase 5 behavior tested at the public executable boundary, so that CLI parsing, durable state, Git, Phase 4 dispatch, and resume are proven together.
57. As a maintainer, I want fake Herdr and Worker behavior used in automated tests, so that the suite remains deterministic and does not launch billable agents.
58. As a project owner, I want one manual live gate with two real fresh Workers, so that the shared-worktree and restart assumptions are proven in the real environment.
59. As a project owner, I want the live gate to restart the Orchestrator naturally between explicit ticket steps, so that no test-only pause mechanism is required.
60. As a maintainer, I want future automation features recorded but not implemented, so that POC scope remains deliberate rather than forgotten.

## Implementation Decisions

- Add one user-driven Workflow step operation whose operator contract accepts a Workflow package reference and exact ticket ID. The global Orchestrator skill should expose the same two meaningful inputs and hide setup, run identity, worktree paths, Phase 4 command selection, and reconciliation mechanics.
- One invocation executes at most one ticket and always returns control afterward. Phase 5 does not automatically drain the Ticket queue.
- Infer the Target repository from the invocation context and require the Workflow package to be inside it. Do not require the user to supply a repository path or run ID in the normal skill interface.
- If repository-local Orchestrator setup is absent, perform the existing idempotent setup automatically before creating a run. Existing invalid or conflicting setup continues to fail explicitly.
- Require one regular specification and at least one direct regular Markdown ticket in the agreed fixed package layout. Reject symlinked required inputs and invalid packages before publishing a partial run.
- Derive canonical ticket IDs from filenames without `.md`, sort tickets lexically, and require exact ID selection. Ticket Markdown remains opaque; Phase 5 does not parse title, status, priority, frontmatter, `blocked by`, or any other planning metadata.
- On first execution, copy the accepted specification and ordered tickets into Orchestrator-owned immutable run input. Record the source package identity for lookup, but execute only the copied inputs afterward.
- Associate at most one unfinished Workflow run with a package for automatic resume. Refuse ambiguity rather than choosing between multiple candidates.
- A completed matching run is a no-op by default. Creating another run for the same source package requires an explicit new-run request and snapshots the current package contents.
- Extend durable run state with one fixed Ticket queue. Each entry contains only its canonical ID, run-owned snapshot reference, `pending`, `active`, or `accepted` status, and accepted commit when applicable.
- Keep queue state Orchestrator-owned. Workers may not edit package snapshots, queue state, ticket statuses, or tracker records.
- Use one Feature branch and Feature worktree for the whole Workflow run. Every accepted ticket advances the existing validated HEAD, and every later Worker starts from that checkpoint.
- Require the requested ticket to be the first pending queue entry. A later ticket is refused with the exact expected ticket; an accepted ticket returns idempotent success without a new attempt.
- Dispatch the selected run-owned Ticket input snapshot through the existing Phase 4 Worker execution subsystem. Reuse its role/profile/skill resolution, agent rendering, orchestration contract, Herdr lifecycle, artifact boundaries, cleanup, reconciliation, and checkpoint validation.
- Launch one fresh Worker per ticket. Phase 5 never asks a Worker to discover a ticket source, choose work, inspect other queue entries, or update global workflow state.
- After acceptance, atomically record the ticket's commit and determine the next pending ticket. After the final acceptance, move the run to `completed` for the Phase 5 implementation-only workflow and state explicitly that Phase 6 validation did not run.
- A Worker `blocked` or `failed` outcome prevents later ticket selection. Do not skip, reorder, or automatically replace the selected ticket.
- Treat a later user invocation of the same blocked ticket as an explicit request to resume. First reconcile the prior attempt using durable execution records, Worker result, Git state, Herdr ownership, and cleanup evidence.
- Permit a fresh blocked retry only when reconciliation proves no unaccepted commit or dirty worktree, no live or ambiguously owned Worker, no conflicting artifacts, and remaining attempt budget. Resume to `implementing`, reuse the immutable ticket snapshot, create a new attempt, and launch a fresh Worker.
- The existing Phase 4 attempt limit remains authoritative for blocked retries. Unsafe evidence, exhausted attempts, or a blocker requiring changed accepted input remains blocked and produces actionable guidance.
- A resolved environmental, credential, service, or configuration condition may retry the same immutable ticket. A product or implementation decision that changes the specification or ticket requires a newly prepared Workflow package and explicit new run.
- Keep GitHub, Linear, and other trackers outside the execution engine. Preparation/import tooling may materialize the local Workflow package before execution, and future export tooling may publish results afterward. Phase 5 performs neither remote reads nor write-back and needs no tracker credentials.
- Human output for a normal step contains the ticket ID, `accepted`, `blocked`, `failed`, or no-op result, accepted commit when present, and next pending ticket when present. Structured output carries the equivalent data without requiring callers to parse prose.
- Preserve State snapshot as workflow truth, Operational history as audit evidence, Git checkpoints as implementation evidence, Worker results as untrusted inputs, and Herdr lifecycle as transport observation.

## Testing Decisions

- Use the existing public `flow` executable as the primary and ideally only new test seam. Substitute the existing controllable fake Herdr/Worker through the established environment hook, and exercise real temporary Git repositories rather than mocking queue persistence or checkpoint behavior below the CLI.
- Make one main integration scenario cover a valid two-ticket Workflow package, automatic setup/run/worktree preparation, exact first-ticket dispatch, a real fake-worker commit and accepted checkpoint, process exit, a fresh CLI process resuming the same run, second-ticket dispatch in the same Feature worktree, a second accepted checkpoint, and final completion.
- In that scenario, assert that the two executions have distinct Worker identities, the second commit descends from the first, the primary checkout remains unchanged, and repeating the first accepted ticket launches no Worker and returns its existing commit.
- Make one recovery scenario cover ticket 01 returning `blocked`, ticket 02 being refused, a second invocation of ticket 01, reconciliation proving a clean unchanged checkpoint, a fresh bounded Worker accepting ticket 01, and only then ticket 02 becoming eligible. Parameterize or extend the same scenario to prove that conclusive `failed` or unsafe side effects do not advance the queue.
- Make one table-driven package-validation scenario cover missing specification, missing or empty issues directory, non-Markdown ticket selection, symlinked required inputs, external package paths, and unknown exact ticket IDs. Assert that rejection occurs before partial run publication or Worker launch.
- Update existing State snapshot/schema tests only where the durable Ticket queue contract requires it. Do not introduce separate unit-test seams for filename sorting, queue selection, or run lookup when their behavior is already clear through the public executable scenario.
- Reuse existing Phase 4 tests for skill rendering, Worker prompt shape, result schema, Herdr transport, checkpoint validation, retry limits, ownership, cleanup, and crash windows. Phase 5 tests should verify composition of those capabilities rather than repeat their matrices.
- Keep automated tests free of real agents. The manual exit gate uses a disposable real repository inside Herdr and invokes the globally installed Orchestrator twice: ticket 01 before an Orchestrator restart and ticket 02 afterward.
- The live gate passes only when two fresh Codex Workers operate in the same Feature worktree, produce two ordered accepted commits, the first ticket is not repeated after restart, the second acceptance completes the run, Worker panes are cleaned safely, and the Target repository checkout remains unchanged.
- Run the normal project quality, schema-drift, build, and public-help checks after implementation. The live gate remains explicit and is not part of the default test command.

## Out of Scope

- Automatically selecting or executing the next ticket without an exact user request.
- Automatically draining the entire Ticket queue in one invocation.
- Dependency graphs, `blocked by` parsing, ready-frontier calculation, priorities, scheduling strategies, or parallel ticket execution.
- Separate worktrees per ticket or merging per-ticket branches. One Workflow run owns one Feature worktree.
- GitHub, Linear, or other remote tracker APIs inside the execution engine.
- Importing from remote trackers, exporting status or comments, tracker write-back, authentication, or credential management.
- Configurable package layouts, alternate ticket formats, fuzzy ticket lookup, mandatory frontmatter, or mutable ticket status fields.
- Editing the immutable Workflow package of an active run, partially reopening a completed package, or adding tickets to an existing run.
- Bypassing reconciliation, discarding unknown side effects, resetting a dirty worktree, or retrying beyond the existing bounded attempt budget.
- Reviewer execution, `code-review`, command checks, HTTP validation, browser validation, screenshots, automatic Fixer behavior, or fix/review loops. These belong to Phase 6 or later work.
- Changing downstream `implement` methodology, duplicating it in prompts, or teaching Herdr ticket semantics.
- Live Claude Code or Pi execution, multi-agent routing policy, CI execution of real agents, or production-grade remote workflow coordination.

## Further Notes

- The terms Workflow package, Ticket queue, Workflow step, Accepted ticket, Workflow run, Feature worktree, Git checkpoint, Worker attempt, Ticket input snapshot, Execution reconciliation, State snapshot, Operational history, Agent profile, Downstream engineering skill, Skill invocation, and Orchestration contract follow the project glossary.
- ADR 0001 keeps State snapshot authoritative over Operational history. Queue acceptance must follow the same snapshot-first and detectable-audit-gap behavior.
- ADR 0002 keeps Git preparation, checkpoints, and cleanup fail-closed. All tickets in this feature reuse the one run-owned Feature worktree.
- ADR 0003 keeps engineering methodology in `implement`, agent syntax in the renderer, workflow semantics in the Orchestrator, and rendered prompts opaque to Herdr.
- ADR 0004 requires deterministic automated evidence plus a manual live feasibility gate. Phase 5 uses a small fake-worker suite and one two-ticket live gate.
- ADR 0005 requires Worker output isolation and evidence reconciliation. The user-driven blocked retry extends that rule rather than bypassing it.
- ADR 0006 keeps tracker integrations outside the execution engine by materializing accepted work as a local Workflow package.
- The approved primary test seam is the public executable with the existing fake Herdr/Worker. Narrow lower seams should be added only if a failure window cannot be demonstrated through that boundary.
- Automatic queue draining, dependency graphs, remote importers and write-back, alternative package formats, reopening completed packages, prioritization, and parallel scheduling are intentionally recorded as future improvements rather than Phase 5 requirements.

## Comments
