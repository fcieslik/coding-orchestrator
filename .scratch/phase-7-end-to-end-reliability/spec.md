# Phase 7 — End-to-End Reliability and Delivery Handoff

Status: completed

## Problem Statement

The Coding Workflow Orchestrator can execute a prepared Workflow package one ticket at a time, preserve accepted Git checkpoints across fresh Orchestrator contexts, and run a deterministic five-check validation against the final Feature HEAD. The validated implementation still remains isolated on the Orchestrator-owned Feature branch. The user has no safe, durable Orchestrator operation that moves it onto the original Integration target branch or publishes it as a GitHub Pull Request.

The V1 also lacks one final proof that its existing durable state is sufficient across a controlled restart. Directly merging, pushing, or recreating a Pull Request conversationally would reintroduce hidden state, allow duplicate external effects, and risk reporting success after an ambiguous interruption. Phase 7 must close that gap without growing the POC into a deployment engine, generic delivery framework, automatic repair loop, or exhaustive crash-testing system.

## Solution

Record the named local Integration target branch when a new Workflow run is created. After implementation is complete, accept one natural-language `$orchestrate` request that validates the current Feature HEAD when needed and then uses exactly one explicitly selected Delivery channel.

For local delivery, fast-forward the clean primary checkout only when its saved Integration target branch still points to the immutable Run base and the clean Feature branch still points to the validated descendant. Persist a minimal Delivery result before mutation and reconcile an interrupted operation from Git facts, making a repeated request idempotent.

For optional GitHub delivery, perform a read-only preflight, persist the selected channel immediately before the first mutation, push the existing Feature branch without force, create or reuse one Pull Request against the saved Integration target branch, read GitHub checks once, and record the result through the official `gh` CLI. Never install tools, rebase, merge a Pull Request, or clean up the Feature branch or Feature worktree.

Keep `completed` as the existing implementation-complete Run phase. Validation and delivery remain additive durable results. Close V1 with focused public-CLI tests and one local live gate proving a restart between two tickets, no duplicate work, deterministic validation, safe fast-forward, refusal after target movement, and idempotent finalization. The GitHub live variant remains optional.

## User Stories

1. As a user, I want a completed Workflow run to retain the branch from which it started, so that the Orchestrator knows the intended local delivery target.
2. As a user, I want run creation rejected on detached HEAD, so that the Orchestrator never invents an Integration target branch.
3. As a user, I want the Integration target branch captured beside the immutable Run base, so that later delivery does not depend on conversation history.
4. As a user, I want to request final validation and delivery through `$orchestrate` in natural language, so that I do not need to remember helper commands.
5. As a user, I want to choose local integration or a GitHub Pull Request explicitly, so that no external or local publication happens by assumption.
6. As a user, I want an ambiguous delivery request to produce one concise choice question, so that the Orchestrator does not guess my intended channel.
7. As a user, I want one run to use only one Delivery channel, so that its final handoff has an unambiguous meaning.
8. As a user, I want a read-only preflight before the Delivery channel is persisted, so that missing prerequisites do not unnecessarily lock my choice.
9. As a user, I want the Delivery channel persisted before its first mutation, so that interruption cannot lose the delivery intent.
10. As a user, I want delivery state represented separately from the Run phase, so that Phase 7 does not destabilize existing implementation lifecycle behavior.
11. As a user, I want `completed` described as implementation complete, so that I understand validation and delivery may still be outstanding.
12. As a user, I want full V1 completion to require implementation complete, validation passed, and delivery completed, so that partial progress is never presented as end-to-end success.
13. As a user, I want finalization to reuse a passing validation for the exact current Feature HEAD, so that the five checks are not run redundantly.
14. As a user, I want missing or stale validation to run before delivery, so that only the current accepted implementation can be handed off.
15. As a user, I want failed validation to stop before any delivery mutation, so that broken work is neither integrated nor published.
16. As a user, I want environment-only validation failures to be retryable without changing Feature HEAD, so that transient problems do not require a new run.
17. As a user, I want a code-level validation failure to preserve the Feature worktree and stop, so that Phase 7 does not hide an unimplemented repair workflow.
18. As a user, I want local delivery to require a clean primary checkout, so that my existing local changes cannot be overwritten.
19. As a user, I want local delivery to require the originally saved Integration target branch to remain checked out, so that another branch cannot be updated accidentally.
20. As a user, I want local delivery to require the Integration target HEAD to remain the Run base, so that concurrent branch movement cannot be silently absorbed.
21. As a user, I want the Feature branch and Feature worktree verified against the validated Feature HEAD, so that the delivered commit is exactly the one that passed validation.
22. As a user, I want local delivery to use fast-forward only, so that the Orchestrator cannot create a merge commit or resolve conflicts on my behalf.
23. As a user, I want divergence or target movement to stop without mutation, so that manual reconciliation remains under my control.
24. As a user, I want an interrupted local fast-forward reconciled from Git, so that a completed ref update is not repeated or misreported.
25. As a user, I want repeating a completed local handoff to return the same Delivery result, so that finalization is idempotent.
26. As a user, I want older runs without a saved Integration target branch refused with a manual instruction, so that the Orchestrator does not infer historical intent.
27. As a user, I want the Feature branch and Feature worktree retained after delivery, so that no recoverable or unlanded evidence is destroyed automatically.
28. As a user, I want the explicit phrase “prepare a PR” to authorize only push, PR creation, and checks inspection, so that it never implies merge or cleanup.
29. As a user, I want GitHub delivery to use the existing Feature branch, so that no extra publication branch is invented.
30. As a user, I want GitHub delivery to use `origin` and the saved Integration target branch as the Pull Request base, so that its destination is deterministic.
31. As a user, I want Feature branch publication to avoid force-push, so that existing remote work cannot be overwritten.
32. As a user, I want a matching remote Feature commit treated idempotently, so that a retry after push can continue safely.
33. As a user, I want a conflicting remote Feature commit to block, so that the Orchestrator never rewrites an ambiguous branch.
34. As a user, I want an existing matching open Pull Request reused, so that retries do not create duplicate PRs.
35. As a user, I want an externally merged matching Pull Request recognized, so that the Orchestrator can record what already happened without merging it itself.
36. As a user, I want a closed-unmerged or ambiguous set of matching Pull Requests to block, so that external state is not guessed.
37. As a user, I want a deterministic Pull Request title and body derived from durable run inputs, so that publication does not require another generative agent step.
38. As a user, I want a remote base branch to be allowed to advance, so that normal Pull Request collaboration does not require automatic rebase.
39. As a user, I want the Orchestrator to state that local validation covered the saved Feature HEAD while GitHub checks cover current remote integration, so that those guarantees are not conflated.
40. As a user, I want GitHub checks read once and reported as passed, failed, pending, or unavailable, so that I get useful status without an unbounded polling loop.
41. As a user, I want Pull Request creation to complete the handoff even when checks are pending, so that the Orchestrator does not occupy my terminal waiting for CI.
42. As a user, I want failed checks reported without automatic fixes or merge, so that remediation remains an explicit later decision.
43. As a user, I want the Orchestrator to use the official authenticated `gh` CLI, so that GitHub operations have one stable machine-readable contract.
44. As a user, I want missing GitHub tools, authentication, or remote configuration reported during preflight, so that no partial external state is created.
45. As a user, I want the Orchestrator never to install or update GitHub tooling, so that dependency and credential management remain mine.
46. As a user, I want an interrupted GitHub handoff resumed from durable state and observed remote facts, so that pushes and Pull Requests are not duplicated.
47. As a user, I want validation and delivery serialized under the existing Workflow run lock, so that two finalizers cannot mutate the same run concurrently.
48. As a user, I want delivery transitions appended to the existing Operational history, so that diagnosis uses one audit trail.
49. As a maintainer, I want no separate delivery artifact or event log, so that State snapshot and Operational history remain the only workflow-state mechanisms.
50. As a maintainer, I want local and GitHub delivery exposed as two small helper operations, so that their different side effects remain explicit.
51. As a maintainer, I want the public helper to produce concise human output and stable structured output, so that both agents and tests can interpret the result without terminal scraping.
52. As a maintainer, I want GitHub automation exercised through a controlled executable seam, so that tests never require a real account or network.
53. As a project owner, I want one controlled restart between two live tickets, so that the V1 proves durable resume without an exhaustive crash matrix.
54. As a project owner, I want the second live ticket to reuse the same Workflow run and Feature worktree without repeating the first ticket, so that restart safety is demonstrated directly.
55. As a project owner, I want the local live gate to prove validation, fast-forward, cleanliness, and idempotent replay, so that V1 ends with usable work on my Integration target branch.
56. As a project owner, I want a separate negative live case for a moved target branch, so that fail-closed integration is proven without risking real work.
57. As a project owner, I want the GitHub live gate optional, so that local V1 completion does not depend on credentials, network availability, or a disposable remote repository.

## Implementation Decisions

- Extend new Workflow run Git state with the named Integration target branch captured from the Target repository at run creation. Require a non-detached local branch before any run branch or Feature worktree is created. Keep the Run base immutable.
- Preserve existing runs and schema versioning through an optional additive Integration target branch field. A legacy run without the field remains readable but cannot use automated delivery.
- Preserve the existing Run phase model. `completed` continues to mean that the Ticket queue is implementation complete. An end-to-end V1 success additionally requires a current passing Validation result and a completed Delivery result.
- Add one optional Delivery result to the State snapshot. Absence means no channel has been selected. Its channel is local fast-forward or GitHub Pull Request, and its lifecycle status is `prepared`, `completed`, or `blocked`.
- Store the validated Feature HEAD, Integration target branch, and concise failure reason in every persisted Delivery result. A local result also stores the integrated commit. A GitHub result also stores the remote Feature branch, Pull Request number and URL, observed Pull Request state, and last observed checks status.
- Do not create a separate delivery artifact or log. Persist current delivery truth in the State snapshot and append versioned prepared, completed, and blocked observations to the existing Operational history.
- Resolve the single Workflow run from the Workflow package using the same unambiguous run-selection policy as validation. Do not expose Run IDs as a normal user input.
- Before either channel, require the Ticket queue to be implementation complete, the Feature worktree to be clean at the final accepted Git checkpoint, and validation to have passed for that exact HEAD. Reuse a matching passed result; otherwise run the existing fixed five-check validation once and stop on any failure.
- Treat a failed validation requiring code changes as the end of automated delivery for this POC. Preserve the Feature worktree. Do not adopt manual commits, reopen the Ticket queue, create an implicit repair ticket, or invoke a Fixer.
- Perform all channel-specific prerequisite checks read-only before persisting a Delivery result. A preflight refusal does not select or lock a channel. Persist `prepared` under the existing Workflow run lock immediately before the first local or external mutation.
- Once persisted, a Delivery channel cannot change. Repeating the same channel reconciles or returns its durable outcome. Requesting the other channel fails without mutation.
- Serialize validation and delivery with the existing Workflow run lock. A competing invocation returns the existing in-progress error and never waits for, takes over, or duplicates another finalizer.
- Implement local delivery as one explicit helper operation. Verify the primary checkout is clean, has the saved Integration target branch checked out, and still points to the Run base. Verify the Feature branch and registered Feature worktree are clean at the current validated HEAD and that this HEAD descends from the Run base.
- Mutate local Git only with fast-forward-only merge behavior. Never create a merge commit, rebase, resolve conflicts, reset work, switch the primary checkout, or delete a branch or worktree.
- Reconcile local `prepared` state using exact Git facts. Target HEAD at Run base means the mutation has not happened and may be retried; target HEAD at the validated Feature HEAD means it already happened and can be finalized; any other target HEAD or dirty checkout produces `blocked` without mutation.
- Implement GitHub delivery as a separate explicit helper operation. The deterministic helper owns preflight, ordinary Git push, official `gh` invocation, Pull Request lookup or creation, one checks read, reconciliation, and durable state updates. The conversational Orchestrator owns only intent recognition and reporting.
- Treat the natural-language request to prepare a Pull Request as explicit permission to push the Feature branch, create or reuse the Pull Request, and read checks. It never authorizes force-push, merge, rebase, branch deletion, worktree deletion, or cleanup.
- Use only remote `origin`, the existing local Feature branch name as the remote head, and the saved Integration target branch as the Pull Request base. Do not create a differently named publication branch.
- Allow the remote base to advance beyond the Run base. Do not rebase automatically. Report that deterministic local validation applies to the saved Feature HEAD and that GitHub checks represent the current remote integration signal.
- Before push, classify the remote Feature branch. Missing may be created by ordinary push; an exact matching commit is idempotent; any different commit blocks. Never use a force flag.
- Before creating a Pull Request, search by exact head and base. Reuse one matching open Pull Request. Treat one already-merged match as completed external delivery and report that the merge was external. Block on a closed-unmerged match or multiple matches.
- Generate Pull Request metadata deterministically. Use the accepted specification title, falling back to the Workflow package name only when the title is unavailable. Build a concise body from Run ID, specification reference, accepted ticket identifiers, validated HEAD, and the five validation outcomes. Do not include full specifications, tickets, prompts, transcripts, or Worker output.
- Require an available, authenticated official `gh` CLI for repository, Pull Request, and checks operations. Do not install, update, authenticate, or configure it.
- Read checks once after finding or creating the Pull Request. Normalize the observation to `passed`, `failed`, `pending`, or `unavailable`. Pull Request existence completes the handoff; checks status remains a separate explicitly reported observation and never triggers polling, repair, or merge.
- Reconcile an interrupted GitHub handoff from the prepared intent, remote branch commit, and matching Pull Request facts. Continue only the missing idempotent step. Preserve ambiguity as `blocked`; never compensate by deleting or rewriting remote state.
- Expose concise human output and equivalent structured output for both helper operations, including run identity, channel, status, validated HEAD, target branch, and channel-specific result. Stable error codes distinguish preflight refusal, channel conflict, blocked reconciliation, validation failure, and concurrency.
- Update the global Orchestrator skill to map natural requests for local integration or Pull Request preparation to validation followed by the appropriate helper operation. If no channel is explicit, ask once rather than infer from repository configuration.
- Leave the Feature branch and Feature worktree intact after either successful channel. Automated cleanup remains outside Phase 7.

## Testing Decisions

- Use the public helper CLI as the primary and highest test seam for both delivery channels. Exercise it in fresh temporary Target repositories with real local Git state; avoid tests coupled to private reducer, command-runner, or serialization functions.
- Extend the existing public workflow scenarios to create a new run from a named Integration target branch and prove that detached HEAD is rejected before any run branch, worktree, or durable run is created.
- Test local delivery with a completed Workflow package, clean Feature worktree, current passing validation, and unchanged primary checkout. Assert exact fast-forward, persisted completed Delivery result, Operational history, concise output, structured output, retained Feature resources, and clean checkouts.
- Repeat the same local command and assert it returns the same integrated commit without new commits, state transitions, worktrees, or mutations.
- Simulate an interrupted local operation at `prepared` and cover both reconcilable Git outcomes: target still at Run base and target already at validated Feature HEAD.
- Use one parameterized public-CLI refusal matrix for dirty primary checkout, wrong checked-out branch, moved target HEAD, divergent history, stale validation, dirty Feature worktree, changed Feature HEAD, missing Integration target branch, and changed Delivery channel. Every case must prove no mutation.
- Reuse the established process-level fake executable pattern for GitHub tests. Put a controlled fake `gh` ahead of real tools. Do not call GitHub, require credentials, or mock private functions.
- Test GitHub preflight failure for missing remote, missing tools, and failed authentication. Assert that no Delivery channel is persisted and no push occurs.
- Test ordinary first push, exact-commit idempotent remote reuse, and conflicting remote commit refusal. Assert no force option is ever emitted.
- Test matching Pull Request classification for none, one open, one merged, one closed-unmerged, and multiple matches. Assert creation happens only for none and never duplicates an existing match.
- Test checks normalization for passed, failed, pending, unavailable, and malformed tool output. A created or reused Pull Request may complete delivery with any normalized checks observation, but malformed or ambiguous identity evidence must fail closed.
- Simulate interruption after push and after Pull Request creation. A later invocation must reuse observed external effects and complete without another push or duplicate Pull Request.
- Assert deterministic Pull Request title and body are derived only from durable run inputs and exclude prompt, transcript, and full ticket/specification contents.
- Preserve existing validation tests rather than duplicating the five-check matrix. Phase 7 tests only whether a current pass is reused, a missing pass is invoked, and a failure prevents delivery.
- Keep the automated recovery proof intentionally narrow. Do not add a crash point for every Git command, validation command, Worker state, or history append.
- Run the complete Development repository tests, build, lint, typecheck, format check, schema check, installer tests, and installed-skill package validation after implementation.
- Close Phase 7 with one local manual live gate in a disposable real Target repository. Execute two small tickets in one Workflow run, restart the main Orchestrator between them, prove the first accepted ticket is not repeated, validate the final Feature HEAD, integrate it locally, repeat finalization idempotently, and confirm both checkouts are clean and Feature resources remain.
- Run a separate local negative live case in which the Integration target branch moves after the run starts. The helper must refuse without changing either branch or deleting work.
- Keep the GitHub live gate optional. When performed, use a disposable remote repository and prove explicit push, Pull Request creation through official `gh`, one checks read, idempotent repeat, and no automatic merge or cleanup.

## Out of Scope

- A generic delivery framework, workflow DSL, stage graph, reducer engine, plugin system, deployment engine, or arbitrary delivery channels.
- Automatic execution of the complete Ticket queue, dependency scheduling, parallel tickets, or changes to the one-ticket-per-user-invocation model.
- Exhaustive interruption testing across every Worker, reconciliation, validation, Git, filesystem, history, or external API boundary.
- Automatic implementation repair, Fixer invocation, adoption of manual commits, reopening a completed Workflow package, or adding tickets to an active run.
- Automatic rebase, merge commits, conflict resolution, branch switching, force-push, Pull Request merge, or automatic Feature resource cleanup.
- Waiting for GitHub checks, interpreting their meaning with an LLM, retrying CI, fixing failed checks, or enforcing repository-specific merge policy.
- Supporting Git remotes other than `origin`, multiple publication remotes, custom remote branch names, stacked Pull Requests, forks, or multiple Pull Requests for one run.
- Installing, upgrading, authenticating, or configuring Git, GitHub CLI, credentials, remotes, branch protection, or CI.
- Migrating legacy Workflow runs to infer an Integration target branch or Delivery channel.
- GitHub/Linear ticket import, tracker write-back, issue closing, release creation, deployment, browser validation, HTTP validation, screenshots, or security review.
- Deleting the Feature branch or Feature worktree after successful delivery.

## Further Notes

- The terms Workflow run, Run phase, Run base, Feature branch, Feature worktree, Integration target branch, Delivery channel, Delivery result, State snapshot, Operational history, Git checkpoint, Workflow package, and Workflow step follow the project glossary.
- The agreed primary test seam is the public deterministic helper. Real temporary Git repositories cover local behavior; process-level fake GitHub tools cover external behavior without introducing a new internal testing abstraction.
- ADR 0001 remains intact: the State snapshot holds current workflow truth, while Operational history remains an audit and diagnostic record.
- ADR 0002 provides the precedent for persisting intent before a Git mutation and reconciling an interrupted side effect from Git rather than guessing.
- ADR 0005 remains intact: durable artifacts and independent evidence determine acceptance; conversational agent output cannot declare delivery successful.
- ADR 0006 remains intact: delivery resolves a local Workflow package and its run without coupling Workers or workflow semantics to a tracker.
- No new ADR is required. Phase 7 applies existing durability, Git intent, evidence-reconciliation, and local-package boundaries to the final handoff rather than introducing a new architectural style.
- The deliberate POC limitation after a code-level validation failure is inconvenient but explicit: preserve work and stop. A bounded repair flow remains a future improvement.
