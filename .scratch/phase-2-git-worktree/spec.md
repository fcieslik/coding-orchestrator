# Phase 2 — Git and Feature Worktree Protocol

Status: ready-for-agent

## Problem Statement

The Coding Workflow Orchestrator can persist a Workflow run, but it cannot yet establish or verify the isolated Git workspace in which delegated implementation will occur. Without a durable Run base, run-owned Feature branch, isolated Feature worktree, and validated Git checkpoints, the Orchestrator cannot prove that agents changed the intended repository, preserved earlier work, committed new progress, or left a workspace safe to inspect or remove.

## Solution

Make Git part of the durable workflow protocol. A user or Orchestrator can prepare one isolated Feature worktree for a Workflow run, validate its safe baseline, accept an exact commit as a Git checkpoint, and remove a terminal run's worktree only after conservative safety checks. The State snapshot records Git intent and accepted facts, Operational history records accepted Git mutations, and exact retries can finish narrowly defined interrupted operations without adopting or rewriting ambiguous Git resources.

## User Stories

1. As an Orchestrator, I want every Workflow run to resolve one immutable Run base, so that all delegated work has a stable comparison point.
2. As an Orchestrator, I want a Run base stored as a full commit identifier, so that mutable names cannot change its meaning.
3. As a user, I want preparation to default the Run base to the Target repository's current `HEAD`, so that the common case is concise.
4. As a user, I want to select an explicit base revision, so that a run can begin from a deliberate commit other than the current `HEAD`.
5. As an Orchestrator, I want revisions resolved in the Target repository, so that another checkout's current directory cannot affect the selected base.
6. As a user, I want detached `HEAD` accepted when it resolves to a commit, so that preparation does not depend on the Target repository's current branch.
7. As a user, I want unborn repositories rejected, so that a Workflow run never begins without a real commit.
8. As a user, I want non-commit revisions rejected, so that the Run base always identifies a checkoutable source state.
9. As a user, I want shallow repositories supported when the selected commit is locally available, so that local orchestration does not require complete history.
10. As a user, I want missing history rejected without fetching, so that preparation never performs an implicit network operation.
11. As a maintainer, I want SHA-1 and SHA-256 repositories supported, so that commit validation does not assume one Git object format.
12. As an Orchestrator, I want only full canonical object identifiers persisted, so that checkpoints remain unambiguous.
13. As a user, I want each Workflow run to own a dedicated Feature branch, so that delegated changes remain isolated from the Target repository.
14. As a user, I want a deterministic default Feature branch name derived from the run ID, so that the branch is predictable without configuration.
15. As a user, I want to override the Feature branch name on initial preparation, so that project naming conventions can be followed.
16. As a user, I want invalid branch names rejected before mutation, so that preparation cannot partially create unusable Git state.
17. As a user, I want existing branches refused, so that preparation never adopts, resets, or overwrites unrelated work.
18. As a user, I want branches checked out by another worktree refused, so that one run cannot take control of another workspace.
19. As an Orchestrator, I want the exact planned Feature branch persisted before creation, so that retry behavior has one durable intent.
20. As a user, I want delegated implementation isolated from the Target repository, so that agents do not modify the run-owning checkout.
21. As a user, I want a deterministic default Feature worktree location outside the Target repository, so that nested worktrees do not confuse project tools.
22. As a user, I want the default location grouped by Target repository name and run ID, so that worktrees remain discoverable and separated.
23. As a user, I want to override the Feature worktree path on initial preparation, so that local storage policy can be respected.
24. As a user, I want relative path overrides interpreted from my current directory, so that command-line path behavior is predictable.
25. As an Orchestrator, I want the Feature worktree path stored canonically and absolutely, so that later commands address the same machine-local workspace.
26. As a user, I want the Target repository and paths inside it rejected as Feature worktree destinations, so that delegated work cannot occur in the protected checkout.
27. As a user, I want existing destinations refused before initial planning, so that preparation cannot overwrite files or claim another directory.
28. As a user, I want registered worktree destinations refused, so that one Workflow run cannot collide with another Git worktree.
29. As a user, I want symlinked existing path components rejected, so that the planned destination cannot be redirected unexpectedly.
30. As an Orchestrator, I want the Feature worktree proven to share the Target repository's canonical Git common directory, so that similarly named repositories cannot be confused.
31. As an Orchestrator, I want the exact registered path verified, so that branch identity alone cannot authorize a different workspace.
32. As an Orchestrator, I want Git preparation intent persisted before Git resources are created, so that interruption leaves a recoverable, inspectable plan.
33. As an Orchestrator, I want preparation to enter the `preparing` Run phase before Git mutation, so that durable state reflects incomplete setup.
34. As an Orchestrator, I want successful preparation to enter the `implementing` Run phase, so that later phases know the delegated workspace is ready.
35. As an operator, I want a failed Git operation to leave the run in `preparing`, so that the incomplete operation is visible without being misclassified as terminal.
36. As an operator, I want failed validation attempts to preserve State snapshot and Operational history, so that rejected commands do not masquerade as accepted workflow progress.
37. As an Orchestrator, I want interrupted preparation retried from its persisted intent, so that an identical command can safely finish missing work.
38. As a user, I want exact branch, registration, path, base, and `HEAD` matches required during retry, so that unrelated remnants are never adopted.
39. As a user, I want an unexpectedly advanced planned worktree refused, so that unvalidated commits are not silently accepted.
40. As an Orchestrator, I want repeated preparation of an already ready workspace to be idempotent, so that uncertain successful calls do not duplicate state or history.
41. As a user, I want conflicting base, branch, or path options rejected after intent exists, so that persisted Git identity cannot drift.
42. As a user, I want Target repository changes left untouched, so that preparing a Feature worktree never modifies my uncommitted primary-checkout work.
43. As a user, I want dirty Target repository state reported as a warning, so that I know those changes are not included in the committed Run base.
44. As an Orchestrator, I want a standalone baseline validation command, so that I can prove the Feature worktree is safe before launching delegated work.
45. As an Orchestrator, I want baseline validation to verify repository identity, registration, path, branch, `HEAD`, and cleanliness, so that every relevant Git invariant is checked together.
46. As an Orchestrator, I want baseline `HEAD` and the Feature branch ref to equal the last validated commit, so that delegated work begins from known code.
47. As a user, I want tracked modifications rejected during baseline validation, so that existing edits are not mixed into a new delegation.
48. As a user, I want non-ignored untracked files rejected during baseline validation, so that unrecorded files are not silently inherited.
49. As a user, I want ignored files tolerated during preparation and validation, so that normal build caches do not prevent work.
50. As an Orchestrator, I want an explicit candidate commit supplied for checkpoint validation, so that accepted evidence is never inferred from prose.
51. As an Orchestrator, I want a checkpoint candidate proven to exist locally as a commit, so that invalid result artifacts cannot advance workflow truth.
52. As an Orchestrator, I want the supplied commit, Feature branch ref, and Feature worktree `HEAD` to be identical, so that a stale reported commit cannot leave an unvalidated tail.
53. As an Orchestrator, I want each Git checkpoint to be a strict descendant of the prior validated commit, so that every accepted checkpoint proves new committed work.
54. As a user, I want multiple ordinary or merge commits allowed within one checkpoint, so that workers are not constrained to exactly one commit.
55. As an Orchestrator, I want dirty tracked or non-ignored untracked work rejected at checkpoint acceptance, so that all relevant work is preserved in Git.
56. As an operator, I want missing commits distinguished from stale or divergent commits, so that remediation is clear.
57. As an operator, I want rebased, reset, or force-updated history refused when it no longer descends from the accepted checkpoint, so that the Orchestrator never legitimizes rewritten history automatically.
58. As an operator, I want earlier Git checkpoints retained in Operational history after external history rewriting, so that accepted workflow evidence remains auditable.
59. As an Orchestrator, I want each accepted checkpoint to update the latest validated commit, so that the next worker has a precise baseline.
60. As a user, I want persisted Git facts visible through normal run status, so that I can inspect the Run base, Feature branch, Feature worktree, and validated `HEAD` without querying Git manually.
61. As an automation author, I want live worktree validation available as structured output, so that individual invariant results can be consumed without parsing prose.
62. As an operator, I want live validation to distinguish stored intent from current Git reality, so that external deletion or mutation is diagnosable.
63. As an operator, I want a removed or externally missing Feature branch reported without automatic recreation, so that inspection remains non-destructive.
64. As an Orchestrator, I want Git-changing operations serialized across Workflow runs, so that branch and path overrides cannot race.
65. As an operator, I want repository Git-lock contention reported with owner details, so that competing preparation or cleanup is diagnosable.
66. As an operator, I want repository Git locks never broken automatically, so that a live process is not mistaken for a stale one.
67. As an Orchestrator, I want checkpoint acceptance protected by the existing run lock, so that two checkpoints cannot update one Workflow run concurrently.
68. As a maintainer, I want one fixed lock acquisition order, so that repository and run locks cannot deadlock each other.
69. As a user, I want Feature worktrees preserved by default, so that completed work remains available until cleanup is explicitly requested.
70. As a user, I want cleanup limited to terminal Workflow runs, so that active delegated work cannot be removed.
71. As a user, I want cleanup refused when the Feature branch or `HEAD` differs from the last validated commit, so that unaccepted commits are preserved.
72. As a user, I want cleanup refused for tracked, untracked, or ignored files, so that the Orchestrator never guesses which local artifacts are disposable.
73. As a user, I want cleanup to avoid `git clean` and force removal, so that safety checks cannot be bypassed implicitly.
74. As a user, I want cleanup to remove only the registered Feature worktree while preserving its Feature branch, so that committed work remains recoverable.
75. As an Orchestrator, I want Git removal verified before durable state records the worktree as removed, so that the State snapshot never authorizes a workspace that was not actually removed.
76. As an Orchestrator, I want an interrupted cleanup retry to finalize state only when the path and registration are absent and the preserved branch still points to the validated commit, so that narrow recovery remains fail-closed.
77. As a user, I want repeated cleanup after removal to succeed idempotently, so that uncertain successful calls are safe to retry.
78. As an operator, I want the historical path, branch, Run base, and validated commit retained after cleanup, so that the run remains inspectable.
79. As an automation author, I want Git failures mapped onto the existing stable exit categories, so that callers do not need a second error protocol.
80. As an automation author, I want stable error codes for dirty, stale, missing, locked, and invariant-violation outcomes, so that remediation can be automated safely.

## Implementation Decisions

- Extend the existing CLI with `flow worktree prepare`, `flow worktree validate`, `flow checkpoint validate`, and `flow worktree cleanup`. All commands accept the established repository and run-selection options and support structured output.
- `worktree prepare` accepts optional base revision, Feature branch, and Feature worktree overrides. These options define intent only on the first invocation; later invocations must omit them or match the persisted values exactly.
- Resolve an omitted base revision from the Target repository's `HEAD`. Resolve any supplied revision in the Target repository, peel it to a commit, and store the full lowercase object identifier appropriate to the repository's detected object format.
- Accept normal and linked non-bare Target repositories, shallow history when the selected commit is available locally, and detached `HEAD`. Reject bare repositories, unborn repositories, Target repositories that are themselves submodule checkouts, missing objects, and non-commit revisions. Do not fetch missing objects.
- Use a deterministic Feature branch name under an orchestrator-owned namespace when no branch is supplied. Validate overrides with Git's reference rules and require the branch not to exist or be checked out before the preparation plan is first persisted.
- Use a deterministic hidden sibling worktree root grouped by Target repository name and run ID when no path is supplied. Resolve explicit relative paths from the caller's current directory and store the canonical absolute path.
- Before first persistence, require the worktree destination not to exist and not to identify or reside inside the Target repository or any registered Git worktree. Reject symlinked existing path components.
- Treat the exact Target repository that owns the Workflow run as its protected primary checkout, even when that checkout is itself a linked worktree. Do not attempt to discover a globally original checkout.
- Add an optional, schema-version-1 Git section to the State snapshot. It records the immutable Run base, Feature branch, canonical Feature worktree path and lifecycle status, and latest validated `HEAD`. Keep the snapshot schema version at 1 because this is an additive extension; validate known fields and preserve unknown additive properties.
- Use Feature worktree lifecycle values representing planned, ready, and removed. Planning records the base, branch, and path; readiness additionally establishes the validated `HEAD`, initially equal to the Run base; cleanup changes only the worktree status and retains historical Git facts.
- Preparation first acquires the repository Git-operation lock and then the run lock. It validates durable state, records the complete plan with a state-changing `git.preparation.started` event, and enters `preparing` before invoking Git.
- Invoke Git only after the planned snapshot and its Operational history event are synchronized. The existing one-revision audit-gap rule continues to refuse later mutation rather than allowing Git side effects against incomplete audit state.
- Create the new Feature branch from the exact Run base and register the Feature worktree through the installed Git executable. Use explicit working directories and noninteractive process execution while retaining normal repository hooks and checkout behavior.
- After Git creation, verify canonical common-directory identity, exact worktree registration and path, expected branch, base `HEAD`, and clean tracked/non-ignored state. Only then record `git.worktree.prepared`, set the validated `HEAD` to the Run base, and enter `implementing`.
- A failed operation after planning leaves the run in `preparing`. It returns a diagnostic error without appending a rejection event or modifying accepted workflow facts.
- An exact retry from `preparing` may create missing resources or recognize resources only when they match the persisted plan exactly and remain at the Run base. It refuses existing resources that predate intent, unexpected registrations, mismatched repositories, branches or paths, and advanced worktrees.
- Repeating preparation after the worktree is ready performs live validation and succeeds without changing the revision or duplicating Operational history. Conflicting supplied options are rejected.
- Permit a dirty Target repository because delegated work uses a separate commit-based Feature worktree. Report that dirtiness as a success warning and make clear that uncommitted primary-checkout changes are excluded from the Run base.
- `worktree validate` is a read-only safe-baseline check intended for the moment before delegation. It verifies repository identity, exact registration and path, expected Feature branch, branch ref and `HEAD` equality with the persisted validated commit, and absence of tracked changes or non-ignored untracked files.
- `checkpoint validate` requires an explicit commit argument and uses established run selection. Resolve the candidate to a full local commit identifier, then require the candidate, worktree `HEAD`, and Feature branch ref to be identical.
- Require every accepted Git checkpoint to be a strict descendant of the previous validated `HEAD`; the initial comparison point is the Run base. Allow any positive number of ordinary or merge commits between accepted checkpoints. Reject equality, missing commits, reachable-but-stale candidates, divergence, and rewritten ancestry.
- Require checkpoint worktrees to have no tracked changes or non-ignored untracked files. Ignored files do not prevent preparation, baseline validation, or checkpoint acceptance.
- A successful checkpoint updates the persisted validated `HEAD`, increments the State snapshot revision once, and appends one `git.checkpoint.accepted` event with the matching revision. It does not change the Run phase or create ticket execution state.
- Extend human status with persisted Git facts when present. Keep status snapshot-focused and non-mutating; it does not perform live Git checks. Live state belongs to `worktree validate` and the operation-specific validation commands.
- Structured worktree validation reports the selected run, persisted Git facts, an overall validity result, and named repository, registration, path, branch, head, and cleanliness checks. Failed commands continue to emit the established structured error envelope on standard error.
- Add an owned repository-wide Git-operation lock in the repo-local orchestration runtime. Preparation and cleanup acquire repository lock then run lock in that fixed order. Checkpoint mutation uses the run lock. Lock acquisition, metadata, token-checked release, stale-lock preservation, immediate refusal, and exit behavior follow the Phase 1 contract.
- Cleanup is explicit but allowed only for terminal `completed`, `failed`, or `cancelled` runs. There is no force or active-run override in this phase.
- Before cleanup, validate repository identity, registration, exact path, expected branch, branch ref and worktree `HEAD` equality with the persisted validated `HEAD`, and complete cleanliness including ignored files. Never invoke `git clean` or force worktree removal.
- Cleanup uses non-force Git worktree removal, verifies that both registration and directory are gone, and preserves the Feature branch. Only then update the State snapshot to removed and append `git.worktree.removed`.
- If cleanup is interrupted after Git removal but before state publication, an exact retry may finalize the removed state only when the path is absent, registration is absent, and the preserved Feature branch still equals the validated `HEAD`. Any other combination is refused.
- Repeated cleanup of an already removed worktree succeeds without another revision or event. Later status retains the base, branch, path, and validated commit; missing or externally changed branches are reported but never recreated or repaired.
- Preserve the existing exit-status taxonomy. Invalid syntax and incompatible options use 2; missing repositories, revisions, runs, worktrees, branches, or commit objects use 3; unsafe or inconsistent Git state, dirtiness, stale checkpoints, and cleanup refusal use 4; lock contention uses 5; unexpected process or internal failures use 1.
- Provide stable structured error codes for actionable Git conditions, including dirty worktrees, stale checkpoints, lock contention, and general Git invariant violations.
- Implement Git access behind a small command-runner boundary. Do not introduce a Git library dependency, and do not fetch, push, prune, rebase, reset, delete branches, disable hooks, or perform implicit network access.
- Continue using the State snapshot as workflow truth and Operational history as audit, consistent with ADR 0001. Follow the plan-first preparation and Git-first cleanup ordering from ADR 0002.

## Testing Decisions

- Prefer the executable CLI subprocess boundary for preparation, validation, checkpoint, cleanup, output, run selection, error mapping, and persistence behavior. This is the highest existing seam and exercises the actual user contract.
- Use real temporary Git repositories for Git semantics rather than mocking command output. Configure test-local identities, create commits and branches explicitly, and inspect registrations through Git.
- Cover normal and linked Target repositories, detached `HEAD`, shallow repositories with locally available bases, rejected unborn and bare repositories, rejected submodule checkouts, explicit revisions, and missing or non-commit objects.
- Cover SHA-1 repositories and SHA-256 repositories when the installed Git supports them. Tests should detect unsupported SHA-256 initialization rather than weakening production validation.
- Cover deterministic default and explicit branch/path behavior, canonical path storage, relative override resolution, path containment, symlink traversal, existing destinations, existing branches, registered-worktree collisions, and worktree repository-identity mismatches.
- Cover preparation's full external behavior: persisted plan before Git mutation, transition through `preparing` to `implementing`, validated initial `HEAD`, dirty Target repository warnings, and human and structured responses.
- Cover idempotent ready-state preparation, retries with missing planned resources, exact recognition after interruption, conflicts with persisted options, unexpected pre-existing resources, and advanced or mismatched planned worktrees.
- Inject the Git command runner and persistence failures only to force ordering boundaries that real subprocess timing cannot make deterministic. Verify that Git is not invoked before intent and audit synchronization, and that failed ready-state publication leaves exact Git resources available for retry.
- Cover baseline validation for correct identity, registration, path, branch, `HEAD`, and cleanliness. Assert precise failures for missing registration, wrong repository, moved path, detached or wrong branch, advanced or reset `HEAD`, tracked changes, and non-ignored untracked files.
- Cover checkpoint acceptance for one commit, multiple commits, and merge commits. Assert refusal for equality with the prior checkpoint, missing commits, stale commits behind `HEAD`, candidates ahead of `HEAD`, divergence, rewritten ancestry, wrong branches or path, and dirty state.
- Verify each accepted operation increments the snapshot revision once, emits one correctly linked Run event, updates timestamps through the existing clock rules, and preserves unknown additive snapshot and event fields.
- Cover repository-wide lock contention between different runs that target the same branch or path, run-lock contention for one checkpoint, owner metadata, fixed acquisition order, token-checked release, and lock cleanup after handled success or failure. Include real concurrent subprocess coverage where practical.
- Cover cleanup refusal for active runs, unaccepted branch advancement, dirty tracked files, non-ignored untracked files, ignored files, wrong registration, wrong repository identity, missing branch, and any condition that would require force.
- Cover successful cleanup of terminal runs, preservation of the Feature branch, verification that registration and directory are removed, persisted removed status, historical Git facts, and idempotent repeated cleanup.
- Inject interruption after Git removal and before state/history publication. Verify that exact absent-path/absent-registration/unchanged-branch retry can finalize cleanup while every ambiguous combination is refused.
- Cover human-readable command output and structured success/error documents. Assert established exit statuses for argument, missing-resource, invariant, lock, and unexpected-process failures.
- Extend schema-generation and drift tests for the optional Git state without changing schema version 1. Direct schema tests cover known enum/object validation and recursive preservation of unknown additive properties.
- Run the complete existing test suite, schema drift check, type checking, linting, formatting check, build, and executable smoke checks for help and all Phase 2 commands.

## Out of Scope

- Ticket source adapters, ticket dependency graphs, scheduling, ticket execution state, or associating checkpoints with tickets.
- Herdr integration, pane or process lifecycle, worker launch, worker result artifacts, reviewer behavior, deterministic checks, or fixer execution.
- Branch delivery, merging into another branch, pull requests, pushes, fetches, remote management, rebasing, resets, cherry-picking, branch deletion, or automatic conflict resolution.
- Parallel ticket worktrees, task-specific branches, worktree pooling, or multiple delegated worktrees for one Workflow run.
- Submodule initialization, update, cleanup, or orchestration. A repository containing gitlinks may be checked out normally, but a submodule checkout cannot own a Workflow run in this phase.
- Force cleanup, active-run cleanup, automatic deletion of ignored files, retention policies, scheduled cleanup, or pruning Git worktree metadata.
- General restart recovery, audit reconciliation, stale-lock breaking, automatic adoption of unknown Git resources, or repair of externally rewritten branches. Only exact retry completion of the documented prepare and cleanup boundaries is included.
- Public generic lifecycle transitions, ticket completion, review comparison, final delivery validation, configuration files, prompt overrides, UI, monitoring, deployment, or Windows support.

## Further Notes

- The terms Target repository, Workflow run, Run phase, State snapshot, Operational history, Run event, Run base, Feature branch, Feature worktree, and Git checkpoint follow the project glossary.
- ADR 0001 keeps the State snapshot authoritative and makes a one-revision Operational history lag detectable. Phase 2 must not invoke Git while such a lag exists.
- ADR 0002 defines preparation's durable-intent ordering and cleanup's Git-first ordering. Exact retry behavior is part of those safety boundaries, not general reconciliation.
- Sequential tickets introduced later will share this single Feature worktree and advance its validated `HEAD` through Git checkpoints.
- Phase 1 is being implemented concurrently. Phase 2 implementation should re-read the final persistence, schema, run-selection, error, and locking interfaces before coding and adapt to them without reverting or redesigning Phase 1 work.

## Comments
