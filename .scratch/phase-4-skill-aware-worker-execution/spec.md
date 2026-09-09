# Phase 4 — Skill-Aware Worker Execution

Status: ready-for-agent

## Problem Statement

The Coding Workflow Orchestrator can persist a Workflow run, prepare and validate an isolated Feature worktree, accept Git checkpoints, and control a fresh Codex lifecycle through Herdr. It cannot yet turn one approved ticket into a durable worker execution. Without a logical Skill invocation, immutable worker input, isolated Worker result, bounded retry protocol, and independent reconciliation against Git, an agent finishing its turn could be mistaken for completed work, an ambiguous timeout could launch duplicate implementation, or a worker could overwrite the state that is supposed to validate it.

## Solution

Let an Orchestrator execute exactly one explicitly selected local Markdown ticket for an existing Workflow run in the `implementing` phase. The Orchestrator snapshots the ticket, resolves the configured worker role to an Agent profile and `implement` Downstream engineering skill, renders the appropriate agent-specific invocation, and launches a fresh Codex through the established Herdr adapter. The worker changes only the Feature worktree, commits its implementation, and atomically publishes a structured result into an isolated writable output directory. The Orchestrator then reconciles the Worker result with immutable input, durable execution state, live Git facts, Herdr ownership, and cleanup before atomically accepting the Worker attempt and Git checkpoint. Explicit reconcile and retry operations recover interrupted work without guessing or launching duplicate workers.

## User Stories

1. As a user, I want Phase 4 to execute one explicitly selected ticket, so that the first worker slice remains understandable and testable.
2. As an Orchestrator, I want ticket scheduling excluded from worker execution, so that Phase 5 can own dependency and readiness semantics.
3. As an Orchestrator, I want worker execution to require an existing Workflow run, so that implementation always has durable identity.
4. As an Orchestrator, I want worker execution to require a run in the `implementing` phase, so that it cannot bypass lifecycle preparation.
5. As an Orchestrator, I want worker execution to require a ready Feature worktree, so that delegated changes never occur in the Target repository.
6. As an operator, I want a run still in `preparing` refused with actionable guidance, so that incomplete Git preparation is repaired at its owning phase.
7. As an operator, I want terminal Workflow runs refused, so that completed, failed, or cancelled work is not silently reopened.
8. As a user, I want an idempotent repository setup command, so that the target project can acquire the minimum orchestration contract safely.
9. As a user, I want setup to create a default worker configuration, so that a new target repository has a usable Codex worker profile.
10. As a user, I want setup to document the repo-local orchestration contract, so that humans and agents can discover what is shared and what is runtime-only.
11. As a user, I want setup to ensure run data is ignored by Git, so that ephemeral execution state is not committed with implementation.
12. As a user, I want setup to preserve existing configuration and documentation, so that rerunning it cannot erase project policy.
13. As an operator, I want unsupported configuration versions rejected, so that unknown policy is not interpreted optimistically.
14. As an operator, I want invalid existing configuration reported rather than rewritten, so that repairs remain explicit.
15. As a security-conscious user, I want arbitrary agent process arguments excluded from the initial config, so that a repository cannot silently disable worker isolation.
16. As an Orchestrator, I want Execution role, Agent profile, and Downstream engineering skill configured separately, so that workflow meaning is not coupled to one executable.
17. As an Orchestrator, I want the worker role to resolve to the configured `implement` skill, so that established engineering methodology is reused.
18. As a user, I want the worker timeout configurable, so that projects can accommodate differently sized implementation tasks.
19. As a user, I want worker timeouts bounded to a safe range, so that accidental values cannot cause immediate or effectively unbounded waits.
20. As a user, I want the number of Worker attempts bounded, so that failures cannot create an unlimited autonomous loop.
21. As an Orchestrator, I want the assigned ticket to be a regular Markdown file inside the Target repository, so that worker input cannot escape project ownership.
22. As an Orchestrator, I want symlinked or external ticket inputs refused, so that a ticket path cannot redirect execution unexpectedly.
23. As an Orchestrator, I want a canonical ticket ID derived from the local ticket filename, so that the first slice has stable identity without implementing a ticket graph adapter.
24. As an Orchestrator, I want the source ticket copied before worker launch, so that one attempt executes immutable input.
25. As an Orchestrator, I want the Ticket input snapshot hashed, so that later mutation can be detected.
26. As an operator, I want the source reference and snapshot hash recorded, so that I can trace exactly what a worker received.
27. As an Orchestrator, I want retry to reuse the original Ticket input snapshot by default, so that retry does not silently change the task.
28. As an operator, I want ticket refresh during retry to be explicit, so that an intentional task correction is auditable.
29. As an operator, I want refreshed retries to record old and new ticket hashes, so that input lineage remains visible.
30. As an Orchestrator, I want worker work represented as a logical Skill invocation, so that workflow semantics remain agent-independent.
31. As an Orchestrator, I want the logical invocation to contain the worker role, configured Agent profile, `implement` skill, and immutable input, so that rendering is deterministic.
32. As a Codex user, I want `implement` rendered using Codex skill syntax, so that the installed downstream skill is actually invoked.
33. As a Claude Code user, I want the same logical skill renderable using Claude slash-command syntax, so that future live support does not require changing workflow semantics.
34. As a Pi user, I want the same logical skill renderable using Pi slash-command syntax, so that future live support does not require changing workflow semantics.
35. As a maintainer, I want Claude and Pi rendering tested without launching those agents, so that Phase 4 does not become a generic multi-agent runtime project.
36. As a maintainer, I want renderers to produce text rather than shell commands, so that ticket paths and skill syntax cannot become command injection.
37. As an Orchestrator, I want the rendered prompt to contain the Skill invocation, Skill input, and Orchestration contract only, so that responsibility boundaries remain clear.
38. As a maintainer, I want worker prompts to omit repository-inspection, implementation, testing, and self-review methodology, so that `implement` remains the single methodology owner.
39. As a worker, I want the contract to identify the run, ticket, worktree, and result destination, so that I can operate in the intended scope.
40. As a worker, I want the contract to state that a commit is required, so that successful work leaves durable Git evidence.
41. As a worker, I want the contract to state that Workflow state is read-only, so that I do not mark my own work accepted.
42. As a worker, I want an explicit blocker protocol, so that I stop rather than guessing about product, architecture, security, credentials, destructive operations, or human decisions.
43. As a worker, I want an explicit technical-failure protocol, so that a failed attempt still produces actionable structured evidence.
44. As a worker, I want an atomic result-publication protocol, so that the Orchestrator cannot observe a partially written result.
45. As an Orchestrator, I want every Worker attempt to have its own immutable directory, so that retries never overwrite prior evidence.
46. As an Orchestrator, I want input, execution metadata, and worker output physically separated, so that ownership is enforceable.
47. As an Orchestrator, I want only the attempt output directory writable by the worker, so that it cannot rewrite its Ticket input snapshot or Execution record.
48. As an Orchestrator, I want the Execution record owned and published by the Orchestrator, so that transport observations cannot be forged through the Worker result.
49. As an operator, I want the Execution record to identify its Workflow run, ticket, attempt, role, Agent profile, skill, worktree, and artifacts, so that an attempt is independently inspectable.
50. As an operator, I want prompt and input hashes recorded, so that exact execution inputs can be correlated without duplicating the prompt.
51. As an operator, I want Herdr pane and agent identities recorded, so that live or leaked resources can be recovered precisely.
52. As an operator, I want lifecycle observations, timings, and cleanup recorded, so that execution failures are diagnosable.
53. As a security-conscious operator, I want diagnostic output bounded, so that verbose terminal history cannot grow state without limit.
54. As a security-conscious operator, I want the full prompt and transcript excluded from routine artifacts, so that task context is not duplicated unnecessarily.
55. As an Orchestrator, I want Worker attempt status separate from Herdr lifecycle, so that process state is never confused with workflow evidence.
56. As an Orchestrator, I want an attempt prepared durably before pane creation, so that interruption leaves a reconcilable intent.
57. As an Orchestrator, I want a fresh Codex process for the ticket, so that implementation does not inherit unrelated conversation context.
58. As an Orchestrator, I want the worker pane created with the Feature worktree as its working directory, so that implementation begins in the isolated checkout.
59. As an Orchestrator, I want Codex explicitly rooted at the Feature worktree, so that its primary writable workspace matches Git intent.
60. As an Orchestrator, I want Codex granted one additional exact writable output directory, so that it can publish its result without writing global workflow state.
61. As a security-conscious user, I want the live worker to use workspace-write isolation and automatic permission review, so that unattended execution does not require unrestricted host access.
62. As a security-conscious user, I want Phase 4 to avoid danger-full-access, so that a successful proof does not depend on disabling the sandbox.
63. As an Orchestrator, I want Herdr to receive the rendered prompt unchanged, so that the transport layer remains unaware of ticket, skill, and result semantics.
64. As an Orchestrator, I want agent startup and prompt settlement bounded independently, so that each transport stage has meaningful diagnostics.
65. As an Orchestrator, I want a worker timeout to start reconciliation rather than imply failure, so that slow or disconnected work is not misclassified.
66. As an Orchestrator, I want terminal output used only for bounded diagnostics, so that prose never proves implementation success.
67. As an Orchestrator, I want a settled agent followed by independent artifact and Git inspection, so that Herdr completion is only a transport observation.
68. As an Orchestrator, I want an agent-reported blocker represented distinctly, so that a human decision can pause the Workflow run.
69. As an Orchestrator, I want a Herdr-blocked agent without a valid Worker result treated as incomplete execution, so that interactive agent state does not become workflow truth.
70. As a user, I want an incomplete blocked agent closed after bounded diagnostics are captured, so that recovery does not depend on preserving an ephemeral pane.
71. As a user, I want the resulting Workflow run blocked with its interrupted implementation phase, so that it can resume after a durable decision is recorded.
72. As an Orchestrator, I want a versioned Worker result schema, so that incompatible artifacts fail closed.
73. As an Orchestrator, I want completed, blocked, and failed results represented as distinct schema variants, so that each outcome has appropriate required evidence.
74. As an Orchestrator, I want every Worker result to identify its ticket and provide a concise summary, so that results cannot be detached from their assignment.
75. As an Orchestrator, I want a completed result to contain the canonical current commit identifier, so that it can be compared directly with Git.
76. As an Orchestrator, I want completed results to include structured command outcomes, so that worker-reported validation is machine-readable but not blindly trusted.
77. As an Orchestrator, I want blocked results to contain a typed blocker and the smallest required decision, so that intervention is focused.
78. As an Orchestrator, I want failed results to contain structured diagnostics, so that a conclusive technical failure can be distinguished from ambiguity.
79. As an Orchestrator, I want changed-file lists and handoff notes treated as optional information, so that Git remains authoritative.
80. As a maintainer, I want additive unknown result fields preserved or tolerated, so that compatible producers can evolve without weakening required fields.
81. As an Orchestrator, I want result files required to be regular and nonsymlinked, so that artifact validation cannot be redirected.
82. As an Orchestrator, I want the Ticket input snapshot and Execution record revalidated before acceptance, so that Orchestrator-owned evidence cannot change unnoticed.
83. As an Orchestrator, I want repository identity, worktree registration, Feature branch, current HEAD, ancestry, and cleanliness revalidated, so that acceptance reflects live Git truth.
84. As an Orchestrator, I want one or more worker commits allowed within a checkpoint, so that implementation is not forced into an artificial single-commit shape.
85. As an Orchestrator, I want the reported commit required to equal current HEAD and descend from the previous checkpoint, so that stale or divergent reports cannot advance the run.
86. As an Orchestrator, I want validation available without immediate checkpoint mutation, so that pane cleanup can remain part of successful finalization.
87. As an Orchestrator, I want bounded diagnostics read before cleanup, so that a closed pane does not erase the only useful failure context.
88. As an Orchestrator, I want only the owned pane closed, so that worker cleanup cannot affect unrelated user work.
89. As an Orchestrator, I want all evidence revalidated under the run lock after cleanup, so that facts cannot drift between inspection and acceptance.
90. As an Orchestrator, I want Worker attempt acceptance and Git checkpoint acceptance published as one finalization decision, so that durable workflow truth cannot disagree about success.
91. As an Orchestrator, I want explicit blocked, failed, and accepted attempt milestones in Operational history, so that important execution outcomes are auditable.
92. As an Orchestrator, I want low-level Herdr observations kept out of Operational history, so that the history remains semantic rather than noisy.
93. As an Orchestrator, I want a valid completed result plus matching clean Git state and successful cleanup required for acceptance, so that all independent evidence agrees.
94. As an Orchestrator, I want a failed or missing result with no new commit and a clean worktree treated as a conclusive failure, so that safe retry can be considered.
95. As an Orchestrator, I want any invalid, missing, failed, or blocked result accompanied by a commit or dirty worktree to block the run, so that unknown side effects are preserved for reconciliation.
96. As an Orchestrator, I want mismatched HEAD, branch, or repository identity to block the run, so that worker prose cannot override Git.
97. As an Orchestrator, I want cleanup failure to block acceptance while retaining valid artifacts and the pane identifier, so that resource ownership remains recoverable.
98. As an Orchestrator, I want automatic retry allowed only before confirmed prompt delivery and proven absence of effects, so that implementation cannot be duplicated.
99. As an Orchestrator, I want post-delivery retry to require explicit reconciliation, so that ambiguity is examined before new work starts.
100. As an Orchestrator, I want a retry operation to refuse exhausted attempt budgets, so that autonomous execution remains bounded.
101. As an Orchestrator, I want an active running attempt to prevent a second execute command from taking ownership, so that concurrent supervisors cannot prompt one worker twice.
102. As an operator, I want a separate reconcile operation, so that interrupted execution can be inspected without implying a retry.
103. As an operator, I want a separate retry operation, so that creating another worker is an explicit durable decision.
104. As an operator, I want an already accepted execute request to return idempotent success, so that uncertainty after a successful command is harmless.
105. As an Orchestrator, I want run locks held only for short claims and finalization, so that a long-running agent does not block status inspection or leave a long-lived workflow lock.
106. As an operator, I want human-readable worker command output, so that execution status is understandable interactively.
107. As an automation author, I want equivalent structured command output, so that orchestration can consume results without parsing prose.
108. As an automation author, I want blocked or reconciliation-required outcomes distinguishable from conclusive execution failure, so that callers can choose the correct recovery path.
109. As a maintainer, I want State snapshot version 1 retained for compatible optional execution references, so that Phase 4 does not force an unnecessary migration.
110. As a maintainer, I want separate version-1 schemas for configuration, Execution records, and Worker results, so that each durable contract can evolve deliberately.
111. As a maintainer, I want schema documents generated and checked for drift, so that runtime validation and installed artifacts remain synchronized.
112. As a maintainer, I want worker behavior exercised through the public executable seam, so that CLI parsing, persistence, rendering, Herdr transport, Git, and artifacts are tested together.
113. As a maintainer, I want a deterministic fake Herdr worker path, so that normal tests never launch a real or billable coding agent.
114. As a maintainer, I want crash points tested around every irreversible boundary, so that restart behavior is proven rather than assumed.
115. As a project owner, I want an early live Codex probe after the thinnest fake happy path, so that invalid integration assumptions are discovered before the implementation grows.
116. As a project owner, I want a final live Codex gate after deterministic coverage passes, so that Phase 4 proves the real `$implement` workflow end to end.

## Implementation Decisions

- Build Phase 4 on the existing durable-run, Git/worktree, checkpoint, and Herdr primitives. Preserve their public interfaces unless a nonmutating checkpoint-inspection seam must be extracted for finalization.
- Execute one explicitly supplied local Markdown ticket only. Require an explicit Workflow run identifier and ticket reference, allow the established optional Target repository selection, and defer ticket discovery, blocker parsing, readiness, and scheduling to Phase 5.
- Require the Workflow run to be in `implementing` with a ready Feature worktree. A run in `preparing` must complete the existing Git preparation flow first; Phase 4 does not repeat the Phase 2 lifecycle transition.
- Add idempotent repository setup that creates only missing default configuration, explanatory repo-local documentation, and the runtime ignore rule. Never overwrite existing files or repair unsupported configuration automatically.
- Define configuration version 1 with a named Codex Agent profile, a worker role referencing that profile and the logical `implement` skill, a default 1,800-second worker timeout, and a default maximum of two Worker attempts. Accept worker timeouts from 60 through 7,200 seconds. Do not allow arbitrary child-agent arguments in V1.
- Expose explicit worker execute, reconcile, and retry commands. Execute creates the first attempt or reports an existing accepted attempt idempotently; reconcile examines existing ambiguous or interrupted evidence; retry creates a later attempt only after reconciliation proves it safe. Ticket refresh during retry requires a dedicated explicit option.
- Resolve the ticket as a nonsymlinked regular Markdown file within the Target repository. Derive its canonical local ticket ID from the filename without the extension. Copy it into a fresh immutable Ticket input snapshot and record its source reference and SHA-256 hash.
- Give each Worker attempt a monotonically numbered, never-reused artifact area. Separate an Orchestrator-owned input area and Execution record from a worker-writable output area containing the eventual Worker result. Grant the worker additional write access only to that output area.
- Represent attempt lifecycle as `prepared`, `running`, `reconciling`, and the terminal outcomes `accepted`, `blocked`, or `failed`. Keep Herdr lifecycle observations in separate fields.
- Add optional active and last execution references to State snapshot version 1 rather than introducing a ticket map. Store the full attempt detail in its Execution record. Phase 5 will add execution state for multiple tickets without creating a second task graph.
- Make the Execution record versioned and Orchestrator-owned. Record execution/run/ticket/attempt identity, logical role/profile/skill, ticket source and hash, worktree and artifact references, prompt hash, timestamps, Herdr handle, transport observations, cleanup, retry lineage, and bounded diagnostics. Do not store the full prompt or complete transcript.
- Publish Execution record and State snapshot changes through the repository's existing safe filesystem and run-lock conventions. Hold the run lock only for short attempt claims and finalization mutations, never while waiting for an agent.
- Record only semantic Worker attempt milestones in Operational history: prepared, started, accepted, blocked, and failed. Keep transport detail in the Execution record.
- Define a logical Role execution independently of prompt syntax. The worker role resolves through configuration to an Agent profile and the `implement` skill. A pure renderer converts that logical invocation to Codex dollar-prefixed syntax or Claude/Pi slash-prefixed syntax.
- Run live workers only through Codex in Phase 4. Implement and unit-test Claude Code and Pi rendering as text transformations without adding live launch, lifecycle, or compatibility support for those agents.
- Validate logical skill names and generated inputs before rendering. Render prompt text directly and pass it to Herdr as an opaque argument vector value; never create a shell command from a Skill invocation or path.
- Keep the worker wrapper limited to the rendered Skill invocation, immutable ticket input, and Orchestration contract. Include run/ticket/worktree identity, Worker result destination, commit requirement, execution scope, Workflow state ownership, atomic result publication, and blocker/failure protocols. Do not reproduce implementation methodology owned by `implement`.
- Extend the Herdr launch boundary to accept validated child-agent arguments without learning skill or ticket semantics. Launch Codex with the Feature worktree as its working root, the exact attempt output area as an additional writable directory, workspace-write sandboxing, and automatic approval review. Do not use danger-full-access.
- Reuse the existing Herdr owned-handle, unique-name, opaque-prompt, bounded-wait, bounded-read, and narrow-cleanup behavior. Use the configured worker timeout for prompt settlement while retaining a separate bounded startup timeout.
- Require the worker to commit implementation on the existing Feature branch. Permit one or more commits after the previous validated checkpoint, require the reported canonical commit to equal the current Feature worktree and branch HEAD, and never squash or rewrite worker history.
- Define Worker result schema version 1 as a discriminated union with `completed`, `blocked`, and `failed` variants. All variants require schema version, ticket ID, status, and concise summary. Completed requires a full canonical commit identifier and structured command outcomes; blocked requires a typed blocker and smallest required decision; failed requires structured diagnostics. Allow compatible unknown fields and optional changed-file or handoff-note information without treating them as truth.
- Require Worker result publication through a temporary file and atomic rename. Accept only a regular, nonsymlinked final result that satisfies the selected schema variant and matches the assigned ticket.
- Split Git checkpoint handling internally into nonmutating inspection and final acceptance while preserving existing external Phase 2 behavior. Initial reconciliation validates runtime artifact identity, Worker result, repository identity, Feature worktree registration, branch, current HEAD, ancestry, and cleanliness without advancing `validatedHead`.
- After initial evidence validation, read at most the final 32 KiB of agent output for diagnostics, record whether it was truncated, and close only the owned pane. Reacquire the run lock, reload and revalidate all durable and Git evidence, then publish Worker attempt acceptance and Git checkpoint acceptance as one finalization decision.
- Treat an explicit valid Worker blocker, unknown side effects, mismatched Git facts, modified Orchestrator-owned artifacts, and cleanup failure as blocked outcomes with interrupted phase `implementing`. Treat a conclusive technical failure as failed, and move the Workflow run to terminal failure only when its permitted attempts are exhausted.
- If Herdr reports blocked without a valid Worker result, capture bounded diagnostics, close the owned pane, and block the run. Do not automatically answer the worker. A human resolves the issue in an authoritative durable source before a fresh attempt.
- Use Git and durable artifacts to classify reconciliation. A valid completed result plus matching clean Git evidence may be accepted. A failed or missing result with no new commit and a clean worktree is a conclusive failure. Any invalid, missing, failed, or blocked result accompanied by a commit or dirty worktree is ambiguous and blocks retry.
- Permit automatic retry only when prompt delivery was not confirmed and reconciliation proves that no code, commit, or result side effect exists. After confirmed delivery, require explicit reconcile and retry operations. Default retry to the prior immutable Ticket input snapshot; explicit refresh records old and new input hashes.
- Make repeated commands fail closed around ownership. An accepted attempt returns idempotent success, a live running attempt is not taken over by another execute invocation, and an interrupted supervisor can be recovered only through reconciliation.
- Keep default human output concise and expose equivalent structured output. Preserve existing exit categories for arguments, missing resources, corruption, and locking; use a distinct exit category for blocked/reconciliation-required outcomes and another for conclusive or exhausted execution failure. Provide stable structured error codes for precise causes.
- Keep State snapshot at schema version 1 because its new execution references are optional and additive. Give configuration, Execution record, and Worker result independent version-1 schemas and include their generated schema documents in build and drift verification.

## Testing Decisions

- Prefer the existing public executable subprocess seam. Put a controllable fake `herdr` executable ahead of the real binary and drive setup, execute, reconcile, retry, persistence, prompt rendering, Git mutation, result publication, checkpoint acceptance, cleanup, structured output, and exit behavior through that boundary.
- Make the first implementation slice a deterministic happy-path fake worker that receives the rendered wrapper, changes a temporary Feature worktree, creates one or more real Git commits, atomically writes a valid Worker result, settles, and permits the Orchestrator to clean up and accept the checkpoint.
- Perform an early manual live probe immediately after that thin fake happy path. Use a disposable Target repository and a real Codex inside Herdr to verify global `$implement` availability, working directory, sandbox permissions, commit creation, isolated Worker result publication, wait/read behavior, cleanup, and checkpoint acceptance before implementing all negative cases.
- Extend the fake CLI fixture for deterministic negative and recovery scenarios rather than using a live model to provoke them. The fake may use test-provided fixture locations and outcomes, but production code must not parse prompt prose to determine workflow behavior.
- Use injected filesystem, clock, process, and transport seams only for failure windows or timing conditions that cannot be proven clearly through the public subprocess. Do not create a second general worker abstraction solely for tests.
- Test setup creation, exact no-op repetition, preservation of existing valid files, invalid configuration, unsupported versions, ignore-rule preservation, and refusal to overwrite conflicts.
- Test configuration defaults, role/profile/skill separation, missing references, unsupported agent kinds for live execution, timeout bounds, attempt-limit bounds, and refusal of arbitrary agent arguments.
- Test local ticket resolution, Markdown requirement, canonical ID derivation, external paths, symlink escapes, missing files, immutable copying, source hashing, same-input retry, explicit refresh, and retry lineage.
- Test pure renderers for Codex, Claude Code, and Pi. Assert their exact skill invocation syntax, quoted generated snapshot reference, full wrapper contract, stable prompt hash, and absence of duplicated inspection, implementation, testing, or self-review methodology.
- Test that child-agent launch arguments set the Feature worktree root, exact output writable directory, workspace-write sandbox, and automatic permission review without danger-full-access. Assert the Herdr adapter still treats the prompt and child arguments as opaque transport data.
- Test attempt artifact permissions and boundaries. Assert that output is writable for the worker while Ticket input snapshot and Execution record remain Orchestrator-owned, that attempts never overwrite one another, and that symlinked or replaced artifacts fail closed.
- Test every Worker result variant directly against runtime schemas and generated-schema drift. Cover full SHA-1 and SHA-256 commit identifiers, required and optional fields, structured commands, blocker details, diagnostics, additive unknown fields, unsupported versions, malformed JSON, partial files, wrong ticket IDs, and symlinks.
- Test the full reconciliation matrix with real temporary Git repositories: matching completed result, missing result, failed result, blocker, no commit, one commit, multiple commits, stale report, divergent commit, wrong branch, wrong worktree, dirty tracked state, nonignored untracked files, modified input, modified Execution record, and cleanup failure.
- Test that initial checkpoint inspection is nonmutating, cleanup precedes final acceptance, finalization reloads evidence under the run lock, and successful acceptance advances the validated checkpoint and attempt state together.
- Test semantic Operational history milestones and State snapshot active/last execution references while asserting that raw Herdr output and intermediate lifecycle observations remain confined to the Execution record.
- Test bounded diagnostics at, below, and above 32 KiB, truncation reporting, and omission of the full prompt and transcript from normal artifacts and command output.
- Test idempotent accepted execution, refusal to duplicate a running attempt, safe pre-delivery automatic retry, post-delivery reconciliation requirement, explicit safe retry, attempt-budget exhaustion, blocked-run resume prerequisites, and refreshed-input retry.
- Exercise interruption after attempt preparation, after pane creation but before prompt delivery, after prompt delivery during work, after commit/result but before cleanup, after cleanup but before final acceptance, and after State snapshot publication but before Operational history publication. Each recovery must avoid duplicate workers, preserve ambiguous effects, and refuse false success.
- Keep all automated tests free of real or billable agents. After deterministic coverage and the full quality suite pass, repeat the disposable live Codex scenario as the Phase 4 exit gate.
- Final verification runs the complete test suite, type checking, linting, formatting checks, build, schema drift checks, help checks for setup and all worker commands, the fake end-to-end scenario, and the explicit final live Codex gate.

## Out of Scope

- Reading a ticket dependency graph, determining ready or blocked tickets, selecting the next ticket, executing multiple tickets, or parallel scheduling.
- Introducing a second internal task graph or copying an entire ticket set into Workflow state.
- Reviewer execution, `code-review` invocation, fixed-diff review artifacts, deterministic project checks, fixer execution, or delivery.
- Live Claude Code or Pi execution, compatibility testing, model routing, arbitrary agent executables, generic plugins, or user-supplied child-agent arguments.
- Automatic dialogue with blocked agents, approval conversations, preservation of blocked panes for later chat, streaming output, event subscriptions, or interactive recovery UI.
- Trusting Herdr lifecycle, terminal prose, Worker result declarations, changed-file lists, or worker-reported commands as sufficient semantic proof.
- Unbounded retries, retry after unknown side effects, automatic task changes during retry, automatic ticket repair, or automatic stale-lock breaking.
- Full configuration migration, project-specific prompt overrides, deterministic check configuration, browser configuration, or generalized repository bootstrap beyond the minimal Phase 4 contract.
- Changing the implementation methodology owned by `implement`, embedding that methodology in worker prompts, or using `implement` automatically for future fixer work.
- Removing completed Feature worktrees, merging branches, pushing commits, creating pull requests, publishing live transcripts, or running real-agent tests in CI.

## Further Notes

- The terms Workflow run, Run phase, State snapshot, Operational history, Feature worktree, Git checkpoint, Execution role, Agent profile, Downstream engineering skill, Skill invocation, Orchestration contract, Worker attempt, Ticket input snapshot, Worker result, Execution record, Active execution, and Execution reconciliation follow the project glossary.
- ADR 0001 keeps State snapshot authoritative over Operational history. Phase 4 follows its snapshot-first publication and detectable audit-gap behavior.
- ADR 0002 keeps Git preparation and cleanup fail-closed. Phase 4 reuses its repository identity, worktree ownership, and lock-order invariants.
- ADR 0003 assigns engineering methodology to downstream skills, agent syntax to renderers, workflow semantics to the Orchestrator, and opaque transport to Herdr.
- ADR 0004 established the two-level deterministic plus live feasibility gate. Phase 4 uses the same evidence pattern while adding real implementation semantics.
- ADR 0005 isolates worker output from Orchestrator-owned evidence and requires reconciliation before checkpoint acceptance or retry.
- The agreed test seam is already confirmed: public executable plus fake Herdr is primary; narrow injected seams exist only for crash and timing windows; live Codex is an early probe and final manual gate.
- Phase 4 corrects one earlier discussion assumption: successful Phase 2 Git preparation already leaves the run in `implementing`, so worker execution validates that phase rather than transitioning from `preparing` again.

## Comments
