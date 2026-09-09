# Phase 6.5 — Workflow Hardening and Final Quality Gate

Status: ready-for-agent

## Problem Statement

The Coding Workflow Orchestrator can execute one ticket at a time through a fresh Worker, validate each resulting Git checkpoint, and run a deterministic project validation after the complete Ticket queue. Two practical gaps remain before the final end-to-end phase.

First, safety restrictions are scattered across generated prompt text and project documentation. A Worker must never modify the primary checkout, publish or integrate work, destroy worktrees or unlanded work, or guess through a blocker. These rules need one concise, human-readable source that is included in every Worker prompt regardless of the selected Agent profile.

Second, the final deterministic validation currently covers only `test`, `lint`, and `typecheck`. Running a full project pipeline after every ticket would be slow and redundant, but omitting a non-mutating formatting check and build from the final gate leaves common integration failures undetected. The POC needs one complete quality gate after all tickets are accepted, without becoming a configurable workflow engine.

## Solution

Add one canonical Markdown safeguards asset to the Installed skill and embed its exact contents in every rendered Worker prompt. The safeguards supplement the Orchestration contract; they do not replace or restate the engineering methodology owned by the downstream `implement` skill. Because the prompt hash already covers the complete rendered prompt, it also makes the safeguards used by a Worker attempt durable and verifiable.

Keep per-ticket behavior lightweight. The Worker may run focused checks selected by `implement`, while the Orchestrator independently validates only the Worker result and Git checkpoint. After the last ticket is accepted, the user invokes the existing deterministic validation operation once. Extend that fixed gate from three to five explicitly configured checks: `test`, `lint`, `typecheck`, `formatCheck`, and `build`. Run all five in a documented fixed order, retain the existing timeout and evidence model, and fail closed if any check fails, times out, changes HEAD, or dirties the Feature worktree.

Continue using ordinary Git and the existing `git worktree` adapter. Phase 6.5 records that an external worktree CLI has not demonstrated enough value to become a V1 dependency; it does not add a worktree abstraction, GitHub operation, Reviewer, repair loop, or workflow DSL.

## User Stories

1. As a user, I want every Worker to receive the same safety restrictions, so that delegated implementation cannot accidentally publish, integrate, or destroy work.
2. As a user, I want safeguards stored in one Markdown document, so that I can read and review the Worker safety policy without inspecting TypeScript.
3. As a user, I want the safeguards packaged in the Installed skill, so that a global invocation uses the same policy as the tested Development repository.
4. As a user, I want safeguards embedded directly in the Worker prompt, so that the Worker does not need to discover or open another file before obeying them.
5. As a user, I want the same safeguards applied to Codex, Claude Code, and Pi Worker prompts, so that safety does not depend on agent-specific skill syntax.
6. As a user, I want the Worker restricted to its assigned Feature worktree, so that the primary checkout remains untouched.
7. As a user, I want the Worker forbidden from modifying the Integration target branch, so that only the later explicit handoff can publish accepted work locally.
8. As a user, I want the Worker forbidden from pushing branches, tags, or commits, so that implementation remains local until I authorize delivery.
9. As a user, I want the Worker forbidden from creating, updating, or merging Pull Requests, so that GitHub delivery remains an Orchestrator and user concern.
10. As a user, I want the Worker forbidden from merging, rebasing, or otherwise integrating branches, so that it cannot bypass checkpoint validation.
11. As a user, I want the Worker forbidden from removing worktrees, branches, or commits, so that workflow evidence and recoverable work remain available.
12. As a user, I want the Worker forbidden from discarding pre-existing or unlanded work, so that it preserves changes it does not own.
13. As a user, I want an unable Worker to return `blocked` or `failed` instead of guessing, so that uncertainty cannot become a false success.
14. As a Worker, I want the safeguards to preserve the existing structured result protocol, so that I know how to stop safely and report the smallest useful outcome.
15. As a maintainer, I want safety policy separated from implementation methodology, so that the Orchestrator does not compete with the downstream `implement` skill.
16. As an Orchestrator, I want the prompt hash to cover the embedded safeguards, so that an Execution record identifies the complete contract actually sent to the Worker.
17. As an Orchestrator, I want a missing or unreadable safeguards asset to stop Worker launch, so that no Worker runs under a silently weakened contract.
18. As a user, I want ticket execution to remain responsive, so that the full project pipeline is not repeated after every accepted ticket.
19. As a user, I want each Worker to retain the focused checks chosen by `implement`, so that obvious ticket-level defects can still be found before commit.
20. As a user, I want the Orchestrator to keep validating every ticket's result artifact and Git checkpoint, so that lighter per-ticket project checks do not weaken durable evidence.
21. As a user, I want one full deterministic validation after all tickets are accepted, so that the combined Feature branch is checked as a whole.
22. As a repository owner, I want the final gate to run my configured test command, so that functional regressions block delivery.
23. As a repository owner, I want the final gate to run my configured lint command, so that lint violations block delivery.
24. As a repository owner, I want the final gate to run my configured type-check command, so that static type failures block delivery.
25. As a repository owner, I want the final gate to run a non-mutating formatting check, so that formatting drift is reported without rewriting the Feature worktree.
26. As a repository owner, I want the final gate to run my configured build command, so that compilation or packaging failures block delivery.
27. As a repository owner, I want five named commands rather than arbitrary stages, so that the POC remains easy to configure and explain.
28. As a user, I want every safe check attempted even after an earlier failure, so that one final run provides complete project feedback.
29. As a user, I want the existing timeout applied independently to all five checks, so that a hung formatter or build cannot block the terminal forever.
30. As a user, I want each additional check represented in `validation.json`, so that the durable result explains exactly what passed, failed, or timed out.
31. As an Orchestrator, I want validation tied to the exact Feature HEAD and clean worktree, so that generated or modified project files cannot produce a false pass.
32. As a user with an existing three-command configuration, I want a clear configuration error naming the missing commands, so that migration is explicit rather than guessed.
33. As a user, I want setup to show a complete five-command example, so that a new Target repository is ready to adapt without learning a pipeline DSL.
34. As a maintainer, I want the existing validation artifact and State snapshot model reused, so that Phase 6.5 does not introduce another source of workflow truth.
35. As a maintainer, I want the public `flow validate` boundary to remain unchanged, so that Phase 6.5 expands evidence without adding another operator command.
36. As a maintainer, I want ordinary Git to continue managing Feature branches and worktrees, so that the POC avoids an unnecessary runtime dependency.
37. As a project owner, I want a manual Installed-skill test after automated checks, so that packaging, safeguards, and the five-command gate are proven together.

## Implementation Decisions

- Introduce one canonical Markdown safeguards asset for Worker execution. It is part of the runtime skill package, not target-project documentation and not a file supplied by the Workflow package.
- Embed the complete safeguards text into every final Worker prompt. Do not send only a path and do not require the Worker to discover the policy.
- Apply the same safeguards text after agent-specific Skill invocation rendering. Agent adapters may differ only in downstream skill syntax; the Orchestration contract and safeguards remain agent-independent.
- Keep the safeguards concise and normative. They require the Worker to operate only in the assigned Feature worktree; leave the primary checkout and Integration target branch untouched; never push, create or merge a Pull Request, merge or rebase branches, remove worktrees/branches/commits, or discard pre-existing or unlanded work; and report `blocked` or `failed` instead of guessing.
- Preserve the existing result statuses and schemas. The safeguards explain when to use the existing `blocked` and `failed` outcomes; they add no new lifecycle or result status.
- Treat the safeguards asset as required runtime input. Refuse Worker launch with an actionable error if the packaged asset cannot be read. Do not maintain a second fallback copy in source code.
- Hash the complete rendered Worker prompt after safeguards are embedded. Reuse the existing prompt hash and Execution record; add no separate safeguards hash, version field, or state artifact.
- Preserve the boundary from ADR 0003: the downstream `implement` skill owns implementation and focused-validation methodology. Safeguards contain only workflow ownership, destructive-operation, publication, integration, and blocker constraints.
- Keep per-ticket completion unchanged. The Orchestrator validates the Worker result, ticket identity, commit existence and reachability, Feature branch and HEAD, and cleanliness policy before accepting a Git checkpoint. It does not independently run the full project validation after each ticket.
- Extend the existing validation configuration to exactly five required named command strings: `test`, `lint`, `typecheck`, `formatCheck`, and `build`, plus the existing shared `timeoutSeconds`. This remains a strict mapping, not a list of stages.
- Define `formatCheck` as a non-mutating repository-owned command. A configured formatter that rewrites files causes the existing post-validation cleanliness check to fail; the Orchestrator never cleans or accepts those mutations.
- Run checks sequentially in the fixed order `test`, `lint`, `typecheck`, `formatCheck`, then `build`. Continue attempting later commands after an ordinary check failure when it remains safe to do so.
- Apply the existing timeout, bounded stdout/stderr diagnostics, status classification, atomic result publication, State snapshot update, Operational history event, HEAD verification, and worktree cleanliness policy equally to all five checks.
- Extend the version 1 validation result in place with the two additional fixed check outcomes. This POC does not need a new schema version because the Installed skill, runtime schemas, and generated schemas ship as one snapshot and no external compatibility promise exists yet.
- Existing repository configurations with only three validation commands require an explicit user edit before validation. Setup preserves an existing config instead of rewriting user policy; validation reports the missing `formatCheck` and `build` fields clearly and runs no project command until configuration is valid.
- Update setup output and operator documentation to describe the five-command final gate and to make clear that it runs only after the complete Ticket queue. Defaults may assume this Development repository's package scripts, but Target repository owners remain responsible for adapting each command.
- Keep `flow validate <workflow-package>` as the single public validation operation. Do not introduce `flow pipeline`, automatic invocation after the last ticket, or a combined implement-and-validate command.
- Keep standard `git` and the existing `git worktree` adapter for V1. Phase 6.5 adds no external worktree CLI dependency and no additional abstraction around current Git behavior.

## Testing Decisions

- Use two existing behavioral seams. Test Worker safety through the final Worker prompt renderer, and test the expanded quality gate primarily through the public `flow validate` command. No new generic seam is needed.
- Assert that the final prompt for each supported Agent kind contains the complete canonical safeguards, preserves the correct agent-specific `implement` invocation, and still includes the existing ticket, specification, result, and blocker contract.
- Assert externally meaningful safety statements rather than Markdown heading order or whitespace. The test should fail if publication, integration, destructive cleanup, primary-checkout protection, or no-guess blocker behavior disappears.
- Assert that changing safeguards content changes the final prompt hash, and that a missing runtime safeguards asset fails before Herdr creates a Worker.
- Extend packaging tests to prove that the Installed skill contains the canonical safeguards asset and that the installed renderer uses it.
- Extend the existing configuration/schema tests for exactly five named validation commands and one timeout. Reject missing, empty, misspelled, or extra stage-like configuration without running a check.
- Extend the existing public-flow passing scenario to record all five checks in fixed order against the final Feature worktree and to publish a passing `validation.json` for the unchanged accepted HEAD.
- Extend the compact failure matrix so `formatCheck` and `build` can independently return non-zero, fail to launch, or time out. None may produce overall `passed`, and safe later checks remain represented.
- Add a formatting-mutation regression case: a zero-exit `formatCheck` that rewrites a file fails overall validation through the existing cleanliness policy and the Orchestrator leaves the mutation intact.
- Preserve the existing run-selection, interrupted rerun, locking, diagnostics, unchanged-HEAD, dirty-worktree, and primary-checkout assertions. Do not duplicate them at lower seams merely because the tuple now has five entries.
- Automated tests use temporary repositories and controlled local commands. They do not launch Codex, Claude Code, Pi, Herdr, GitHub, a server, or a browser.
- Run the full Development repository test, typecheck, lint, format check, schema check, build, and installed-skill validation after implementation.
- Close Phase 6.5 with one manual Installed-skill run in a disposable Target repository. One fresh Worker transcript must show the embedded safeguards, and one completed Workflow run must produce five passing validation outcomes while leaving the Feature HEAD, Feature worktree, and primary checkout unchanged.

## Out of Scope

- A generic pipeline, stage array, dependency graph, YAML workflow DSL, plugin system, reducer, or conditional/parallel validation execution.
- Running the full deterministic quality gate automatically or after every ticket.
- Removing focused checks from the downstream `implement` methodology or prescribing which focused checks a Worker must choose.
- Semantic code review, a Reviewer role, the `code-review` skill, security review, browser/UI validation, HTTP validation, screenshots, or accessibility checks.
- Automatic fixes, retries, repair agents, repair graphs, or interpretation of validation failures by an LLM.
- GitHub authentication, push, Pull Request creation, checks, merge, `gh`, or `gh-axi`; these belong to the optional Phase 7 GitHub handoff.
- Local integration into the Integration target branch; this belongs to Phase 7 safe integration.
- Replacing standard Git or the existing worktree adapter with a third-party CLI, or performing a worktree-tool evaluation during implementation.
- Automatically migrating or overwriting an existing Target repository configuration.
- Adding new Worker result statuses, State snapshot truth sources, or lifecycle phases.
- Installing project dependencies or guessing validation commands from package metadata.

## Further Notes

- The terms Installed skill, Target repository, Workflow run, Feature branch, Feature worktree, Integration target branch, Git checkpoint, Worker result, Execution record, Orchestration contract, and Operational history follow the project glossary.
- The agreed test seams are the highest existing boundaries that expose each change: the final Worker prompt and public deterministic helper. This avoids testing a private safeguards loader or individual command-runner internals.
- ADR 0003 keeps methodology in the downstream engineering skill. The safeguards are allowed because they define workflow permissions, ownership, evidence, and blocker behavior rather than how to implement software.
- ADR 0005 remains intact: safeguards do not make Worker output authoritative. The Orchestrator still reconciles the structured result with Git and its own durable records.
- ADR 0006 remains intact: the final quality gate resolves the completed Workflow run from the prepared Workflow package and does not ask Workers to discover tickets or tracker state.
- Phase 6.5 deliberately borrows only the idea of one explicit final quality gate from `no-mistakes`; it does not embed or depend on that project.
- Phase 7 remains responsible for restart reliability and the explicit choice between local fast-forward integration and GitHub PR handoff.

## Comments
