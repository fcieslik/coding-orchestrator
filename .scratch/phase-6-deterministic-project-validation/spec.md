# Phase 6 — Deterministic Project Validation

Status: ready-for-agent

## Problem Statement

After Phase 5 accepts every ticket in a Workflow package, the Coding Workflow Orchestrator can prove that fresh Workers produced an ordered sequence of valid Git checkpoints. It still cannot independently prove that the resulting project passes its tests, lint rules, and type checks. Worker self-report and the review behavior already contained in the downstream `implement` skill are useful implementation feedback, but they are not deterministic workflow evidence.

The previous Phase 6 roadmap combined command checks, an independent semantic Reviewer, review reduction, HTTP validation, browser validation, screenshots, and future repair behavior. That scope is too broad for the current proof of concept. The user needs a small validation gate that runs three explicitly configured project commands against the final Feature branch state and records an unambiguous result without launching another agent.

## Solution

Add one explicit validation operation for a completed implementation run. The user identifies the same local Workflow package used during Phase 5; the Orchestrator resolves its single matching completed Workflow run without requiring a Run ID. It verifies that every ticket is accepted, the Feature worktree is clean, and its HEAD matches the final accepted Git checkpoint. It then runs the configured `test`, `lint`, and `typecheck` commands sequentially in that Feature worktree, with one configured timeout applied independently to each command.

The Orchestrator records the command, status, exit code, duration, and bounded diagnostics for all three checks in one run-owned validation result. Validation passes only when every command exits successfully and the commands leave the Feature worktree clean at the same HEAD. A non-zero exit, launch failure, timeout, changed HEAD, or dirty worktree produces a failed validation result. The implementation run remains distinguishable from its validation status: Phase 5 completion means implementation is complete, while Phase 6 acceptance requires a passing validation result for the current final HEAD.

This phase uses no coding agent, Herdr pane, semantic Reviewer, HTTP request, browser session, screenshot, or automatic repair loop. Those capabilities remain available for later, independent extensions.

## User Stories

1. As a user, I want to validate a completed Workflow package with one command, so that I do not need to locate its Run ID or Feature worktree.
2. As a user, I want the validation operation to resolve the same Workflow run as the package, so that validation cannot accidentally target unrelated work.
3. As a user, I want ambiguous matching runs refused, so that the Orchestrator never guesses which implementation to validate.
4. As a user, I want validation refused until every ticket is accepted, so that partial implementation cannot be presented as a finished feature.
5. As a user, I want tests executed against the final Feature branch state, so that their result covers all accepted tickets together.
6. As a user, I want the linter executed against the final Feature branch state, so that repository lint failures are visible before integration.
7. As a user, I want type checking executed against the final Feature branch state, so that static typing failures are visible before integration.
8. As a repository owner, I want each validation command configured explicitly, so that the Orchestrator does not invent project-specific tooling.
9. As a repository owner, I want the three checks named `test`, `lint`, and `typecheck`, so that the POC contract stays understandable without a generic stage engine.
10. As a repository owner, I want one shared command timeout, so that a hung tool cannot block my terminal indefinitely.
11. As a user, I want all three configured checks attempted, so that one validation run gives me the complete deterministic status of the project.
12. As a user, I want every command to run with the Feature worktree as its working directory, so that checks observe the implementation being validated rather than the primary checkout.
13. As a user, I want the primary checkout left untouched, so that validation cannot accidentally test or modify a different branch.
14. As an Orchestrator, I want the Feature worktree clean before validation, so that unaccepted files cannot influence the result.
15. As an Orchestrator, I want Feature worktree HEAD to equal the final accepted Git checkpoint before validation, so that the exact validation target is known.
16. As an Orchestrator, I want HEAD checked again after validation, so that a command that creates a commit cannot produce a passing result.
17. As an Orchestrator, I want worktree cleanliness checked again after validation, so that a command that modifies tracked or untracked project files cannot produce a passing result.
18. As a user, I want ignored build artifacts tolerated by the existing cleanliness policy, so that ordinary builds do not fail merely for creating ignored output.
19. As a user, I want a non-zero command exit reported as validation failure, so that workflow acceptance follows process evidence rather than agent judgment.
20. As a user, I want a command launch error reported as validation failure, so that a missing executable cannot be mistaken for a passing check.
21. As a user, I want timeout reported distinctly for the affected command, so that a hung check is diagnosable.
22. As a user, I want stdout and stderr retained as bounded diagnostics, so that I can understand a failure without flooding durable state.
23. As a user, I want each command duration recorded, so that slow checks are visible without adding performance monitoring machinery.
24. As a user, I want one machine-readable validation result, so that later integration logic can decide whether the final HEAD is validated without parsing console prose.
25. As a user, I want concise human-readable output, so that a normal pass or failure is immediately understandable.
26. As a caller, I want structured CLI output available, so that scripts can consume the same result without scraping text.
27. As an Orchestrator, I want the validation result associated with the exact final HEAD, so that a later commit cannot inherit stale validation evidence.
28. As a user, I want Phase 5 implementation completion and Phase 6 validation status represented separately, so that a failed check does not erase successfully implemented ticket checkpoints.
29. As a user, I want a failed validation rerunnable after I fix the code or project environment, so that no automatic retry or recovery engine is necessary.
30. As a user, I want an explicit rerun to replace the current validation decision, so that the latest complete check of the same HEAD is authoritative.
31. As a user, I want interrupted validation safe to invoke again, so that a missing or incomplete publication cannot create false success.
32. As an Orchestrator, I want the final result published atomically before validation state references it, so that State snapshot never points at a partial artifact.
33. As a maintainer, I want validation recorded in the existing State snapshot and Operational history model, so that Phase 6 does not create a second source of workflow truth.
34. As a maintainer, I want validation implemented through the public `flow` boundary, so that configuration, run resolution, Git preconditions, command execution, persistence, and reporting are tested together.
35. As a maintainer, I want automated validation tests to use temporary repositories and controlled local commands, so that they remain deterministic and do not launch billable agents.
36. As a project owner, I want a manual installed-skill gate against a disposable repository, so that packaging and real command execution are proven before Phase 6 is closed.
37. As a project owner, I want semantic review deferred, so that review methodology already available through `implement` does not expand this POC phase.
38. As a project owner, I want HTTP and browser validation deferred, so that server lifecycle, browser control, DOM assertions, and screenshots can be designed later as separate extensions.
39. As a project owner, I want successful deterministic validation to become a prerequisite for future safe integration, so that an unvalidated Feature branch cannot be integrated by the planned helper.
40. As a project owner, I want the validation design to remain extensible without implementing a generic workflow DSL, so that later checks can be added only after concrete needs are proven.

## Implementation Decisions

- Add a separate public validation operation instead of extending the user-driven Ticket step. Its normal operator input is a Workflow package reference; repository override and structured output follow existing CLI conventions. A Run ID is not required in the ordinary workflow.
- The installed Orchestrator skill translates a user request to validate a package into the deterministic helper operation. The skill does not run project checks itself and does not launch an agent for this phase.
- Resolve exactly one matching Workflow run using the existing package identity rules. Accept only a run whose Phase 5 Ticket queue is fully accepted and whose implementation phase is complete. Missing or ambiguous runs fail before command execution.
- Extend repository-local configuration with exactly three named command strings: `test`, `lint`, and `typecheck`, plus one validation timeout in seconds. Do not introduce a list of arbitrary stages or extend the minimal YAML parser with sequence syntax for this phase.
- Repository configuration is trusted, user-owned project policy. Execute each configured command exactly as provided in a project shell with no runtime values interpolated into it by the Orchestrator.
- Run the commands sequentially in the Feature worktree in the fixed order `test`, `lint`, then `typecheck`. Attempt all three checks even when an earlier check fails, so one invocation returns complete validation feedback.
- Apply the configured timeout independently to every command. Terminate the owned command process on timeout and classify that check as `timed_out`.
- Before executing commands, reuse existing Git validation to require an available Feature worktree, the Orchestrator-owned Feature branch, a clean worktree, and HEAD equal to the last accepted Git checkpoint.
- After all commands settle, require the same HEAD and a clean Feature worktree. A command-created commit or non-ignored file change makes the overall validation fail. The Orchestrator reports the mutation but does not reset or delete it.
- Define check statuses as `passed`, `failed`, or `timed_out`. Define overall validation status as `passed` or `failed`; launch errors, timeouts, Git mutations, and any non-zero exit produce `failed`.
- Record one canonical, versioned, machine-readable result owned by the Workflow run. It contains the Run ID, validated HEAD, overall status, timestamps, and one outcome per named check with its command, status, nullable exit code, duration, and bounded stdout/stderr diagnostics.
- Publish the complete result atomically, then update the State snapshot with the validation status, validated HEAD, and artifact reference and append the corresponding Operational history event. State snapshot remains workflow truth; the artifact remains detailed evidence.
- Preserve the current distinction between implementation completion and validation. Do not reopen or discard Accepted tickets when validation fails. Additive optional validation state keeps existing Phase 0–5 runs readable.
- Allow an explicit validation invocation after `failed` or `passed`. The latest fully published result for the current HEAD becomes authoritative. Do not add automatic retries, validation attempts, background polling, or crash-recovery state; after interruption, the user invokes validation again.
- A passing result is valid only for the recorded HEAD. The future safe-integration operation must require a passing result whose HEAD still equals the Feature branch HEAD.
- Use the existing per-run mutation lock to prevent concurrent validation or collision with another state-changing operation. A conflicting invocation fails without starting checks.
- Return exit code zero only for an overall passing validation. Preconditions, invalid configuration, interrupted command launch, timeout, failed check, or Git mutation return non-zero with structured diagnostics when requested.
- Keep the implementation local and explicit. Do not introduce a generic stage interface, plugin system, reducer, reviewer role, agent renderer changes, or Herdr behavior in Phase 6.

## Testing Decisions

- Use the public `flow` executable as the primary and ideally only new behavioral test seam. This matches the established Phase 5 integration-test style and proves configuration parsing, package-based Run selection, Git validation, command execution, durable publication, and CLI reporting in one place.
- Build one main passing integration scenario in a temporary Git repository. Create a completed Workflow run with all tickets accepted, configure three controlled commands, invoke validation through a fresh CLI process, and assert that all three commands ran in the Feature worktree, the result is `passed`, the recorded HEAD is exact, durable validation state references the result, and the primary checkout is unchanged.
- Build one compact failure matrix through the same CLI seam for a non-zero exit, missing executable, timeout, dirty worktree before execution, changed HEAD, and a command that dirties the worktree. Assert that none can produce overall `passed`.
- In the failure matrix, assert that all safe-to-run named checks are represented in the result and that timeout is distinguishable from a normal non-zero exit.
- Add one rerun scenario in which validation first fails and then passes after an explicit user correction without changing the accepted HEAD. Assert that the latest complete result and State snapshot agree and that no automatic retry occurred.
- Add one run-selection scenario covering missing package match, ambiguous completed runs, incomplete Ticket queue, and stale Feature branch HEAD. Assert rejection before the first project command starts.
- Keep diagnostics assertions bounded to observable guarantees: correct command identity, status, exit code, and useful output marker. Do not couple tests to child-process implementation details or exact timing.
- Extend configuration, runtime schema, generated JSON Schema, setup output, help text, and installer tests only where the new public contract requires it. Preserve schema-drift checks.
- Reuse existing Git worktree, State snapshot, Operational history, atomic publication, lock, and CLI test patterns rather than adding lower-level duplicate test suites.
- Do not launch Codex, Claude Code, Pi, Herdr, a server, or a browser in automated Phase 6 tests.
- Run the full project test, typecheck, lint, formatting check, schema check, build, and installed-skill validation after implementation.
- Close Phase 6 with one manual installed-skill test in a disposable repository whose completed Workflow run has three real project commands. The gate passes only when the installed helper records all three passing checks for the final accepted HEAD, leaves both checkouts clean, and returns the same result through human and structured output.

## Out of Scope

- Independent semantic review, a Reviewer Execution role, the `code-review` skill, review prompts, review artifacts, finding severities, or a review reducer.
- HTTP requests, server startup or readiness, response assertions, API artifacts, or service cleanup.
- Browser control, DOM assertions, console inspection, screenshots, visual review, or accessibility review.
- Security-specific scanners or policies beyond a repository choosing one as one of its three configured commands.
- Automatic fixing, a Fixer Execution role, repair briefs, retry loops, re-review, or bounded repair graphs.
- Generic validation stages, arbitrary command arrays, dependency graphs between checks, parallel checks, conditional execution, reusable YAML workflow templates, or a validation plugin framework.
- Guessing commands from package metadata, installing dependencies, choosing a package manager, or changing repository scripts.
- Running checks after every ticket. Phase 6 validates the combined final Feature branch after the complete Ticket queue.
- Treating Worker-reported commands as Phase 6 evidence. The Orchestrator executes the configured checks independently.
- Resetting or cleaning changes made by a validation command. Mutation fails closed and requires explicit human recovery.
- Automatically integrating the Feature branch into the Integration target branch or cleaning up the Feature worktree.
- Live non-Codex workers or any changes to Agent profiles and skill rendering.

## Further Notes

- The terms Workflow package, Workflow run, State snapshot, Operational history, Ticket queue, Accepted ticket, Run base, Feature branch, Feature worktree, Git checkpoint, Integration target branch, and Installed skill follow the project glossary.
- The approved test seam is the public deterministic helper. There is no agent boundary to fake in this phase.
- ADR 0001 keeps State snapshot authoritative over Operational history. Validation follows the same snapshot-first truth model while publishing its complete evidence artifact before referencing it.
- ADR 0002 requires Git actions to fail closed. Validation observes and verifies Git state but never repairs command-created mutations automatically.
- ADR 0003 remains relevant by exclusion: downstream engineering skills own methodology, while this phase performs only deterministic project commands and therefore needs no Skill invocation.
- ADR 0004 does not require a Herdr smoke for Phase 6 because Phase 6 launches no agent. Its manual exit gate proves the installed deterministic helper instead.
- ADR 0006 provides package-based Run identity, allowing the validation interface to remain free of normal Run ID boilerplate.
- The earlier roadmap sections describing semantic review, HTTP, browser, and repair behavior should be moved to future improvements when this spec is adopted. They are not deleted as ideas; they are removed from the Phase 6 exit gate.
- The POC deliberately accepts command nondeterminism caused by the target project or its environment. The Orchestrator's deterministic responsibility is to run the declared commands against a fixed Git state and classify their observable outcomes without LLM interpretation.

## Comments
