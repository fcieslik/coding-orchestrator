# Phase 1 — Durable State

Status: ready-for-agent

## Problem Statement

The Coding Workflow Orchestrator has an executable foundation but cannot yet create or inspect a Workflow run independently of an agent session. Without durable, validated state and ordered Operational history, a fresh Orchestrator cannot determine what workflow exists, which Run phase it occupies, or whether persisted data is safe to trust after interruption.

## Solution

Add the first durable workflow subsystem. A user or Orchestrator can create a Workflow run for an accepted specification in a Target repository, inspect its authoritative State snapshot, and read its ordered Operational history through human-readable or structured CLI output. Persistence is versioned, validated, locked against concurrent mutation, crash-safe at its publication boundaries, and conservative when data is ambiguous, incompatible, corrupted, or redirected outside the Target repository.

## User Stories

1. As an Orchestrator, I want to create a durable Workflow run for an accepted specification, so that workflow truth survives my context ending.
2. As an Orchestrator, I want every Workflow run to have a unique identifier, so that multiple executions can coexist safely.
3. As an Orchestrator, I want identifiers to be sortable by creation time, so that runs are easier to inspect operationally.
4. As an Orchestrator, I want identifier randomness, so that concurrent creation does not cause collisions.
5. As an Orchestrator, I want to supply a previously generated identifier, so that retrying an uncertain creation request is idempotent.
6. As a user, I want multiple Workflow runs to reference the same specification, so that I can retry or experiment without deleting history.
7. As a user, I want the Target repository selected explicitly or inferred from my current Git checkout, so that state belongs to the intended project.
8. As a user, I want repository inference to use the nearest Git root, so that commands work from nested directories.
9. As an Orchestrator, I want internal calls to accept an explicit Target repository, so that an Installed skill is never mistaken for the project being changed.
10. As a user, I want linked non-bare Git worktrees accepted as Target repositories, so that ordinary Git layouts remain usable.
11. As a user, I want bare or non-Git directories rejected, so that repo-local state has an unambiguous owner.
12. As a user, I want the specification verified as an existing regular file, so that a run cannot begin from a missing source of truth.
13. As a user, I want the specification constrained to the Target repository, so that a Workflow run cannot silently depend on an external path.
14. As a user, I want escaping specification symlinks rejected, so that path validation cannot be bypassed.
15. As an Orchestrator, I want a normalized Specification reference persisted relative to the Target repository, so that snapshots remain portable.
16. As a user, I want minimal repo-local runtime setup created automatically, so that the first Workflow run does not require manual directory preparation.
17. As a maintainer, I want runtime runs ignored by Git by default, so that local execution state is not accidentally committed.
18. As a maintainer, I want existing ignore rules preserved, so that runtime bootstrap does not rewrite unrelated repository policy.
19. As an Orchestrator, I want a versioned State snapshot, so that incompatible persisted formats are detected explicitly.
20. As an Orchestrator, I want runtime validation on every snapshot read, so that malformed workflow truth is never trusted.
21. As an integrator, I want a published language-neutral snapshot schema, so that other tools can validate the same contract.
22. As an integrator, I want a published Run event schema, so that Operational history has a stable external contract.
23. As a maintainer, I want generated schemas checked for drift, so that runtime parsing and published contracts stay aligned.
24. As an Orchestrator, I want the State snapshot to be authoritative, so that recovery has one unambiguous source of workflow truth.
25. As an operator, I want required Operational history for every run, so that actions can be diagnosed and handed off.
26. As an operator, I want every Run event to have a unique identity and contiguous sequence, so that event order and duplication are detectable.
27. As an Orchestrator, I want Run events linked to state revisions, so that incomplete audit publication can be distinguished from state rollback.
28. As an operator, I want timestamped events in UTC, so that activity is understandable across local environments.
29. As an Orchestrator, I want sequence and revision to define ordering, so that wall-clock changes cannot corrupt workflow interpretation.
30. As a user, I want run creation published atomically, so that a visible run always has both required durable files.
31. As an Orchestrator, I want atomic snapshot replacement, so that a crash exposes either the old or new complete state.
32. As an operator, I want logically append-only history published without torn JSONL records, so that every visible event remains parseable.
33. As an operator, I want a one-revision audit lag reported clearly, so that an interrupted history write is visible without misrepresenting workflow truth.
34. As an Orchestrator, I want mutation refused while the audit trails state, so that later actions do not compound an unresolved persistence gap.
35. As an Orchestrator, I want concurrent mutation refused through an owned lock, so that two processes cannot update the same run.
36. As an operator, I want lock owner details in contention errors, so that I can diagnose the competing process safely.
37. As an operator, I want locks released only by their owner, so that one process cannot unlock another process's mutation.
38. As an operator, I want stale locks preserved rather than guessed away, so that active work is never overwritten automatically.
39. As a user, I want status reads to remain available during mutation, so that I can observe the last completely published snapshot.
40. As a user, I want to inspect a run by identifier, so that I can select the exact workflow I care about.
41. As a user, I want the sole active run selected when no identifier is supplied, so that common interactive use stays concise.
42. As a user, I want ambiguous run selection refused with candidate identifiers, so that the CLI never guesses between active workflows.
43. As a user, I want human-readable status output, so that I can understand the current run without parsing JSON.
44. As an Orchestrator, I want structured status output, so that automation does not parse presentation text.
45. As an operator, I want status to report audit synchronization, so that incomplete persistence is visible immediately.
46. As a user, I want human-readable chronological history, so that I can understand what happened during a run.
47. As an Orchestrator, I want history returned as a valid JSON array, so that automation can consume exact event envelopes.
48. As a user, I want malformed or incompatible persisted data rejected without modification, so that evidence remains available for recovery.
49. As a user, I want corrupted runs reported during implicit selection, so that a damaged workflow is not silently skipped.
50. As a maintainer, I want unknown additive fields preserved across reads and writes, so that compatible schema evolution does not lose data.
51. As a maintainer, I want unknown lifecycle values and newer schema versions rejected, so that older executables do not invent semantics.
52. As a user, I want runtime symlinks rejected, so that supposedly repo-local state cannot redirect reads or writes elsewhere.
53. As an automation author, I want categorized process exit codes and structured errors, so that failure classes are handled reliably.
54. As a maintainer, I want lifecycle transitions centralized in one pure function, so that workflow legality is reviewable and exhaustively testable.
55. As an Orchestrator, I want invalid Run phase transitions refused with typed context, so that illegal workflow progress cannot be persisted.
56. As an Orchestrator, I want a Blocked run to remember its interrupted phase, so that it can later resume conservatively.
57. As an Orchestrator, I want fixer completion to remember whether review or checks must run again, so that validation is not skipped.
58. As a user, I want completed, failed, and cancelled runs to be terminal, so that finished outcomes cannot be accidentally reopened.

## Implementation Decisions

- Add a durable-state subsystem with separate responsibilities for runtime schemas, lifecycle transitions, repository/run resolution, snapshot persistence, Operational history, locking, identifiers, and crash-safe filesystem publication.
- Extend the existing `flow` CLI with run creation, status, and history commands. Repository-sensitive commands accept an explicit repository option and otherwise discover the nearest Git root from the current working directory.
- Run creation requires a Specification reference. It optionally accepts a caller-supplied valid run ID for idempotent retries.
- Generated run IDs use the form `run_<UTC YYYYMMDDTHHMMSSZ>_<12 lowercase hexadecimal characters>`. Generation uses cryptographic randomness and retries on collision.
- Repeating creation with a caller-supplied ID succeeds only when the existing valid run references the same specification. A conflicting or corrupted existing run is refused.
- Permit multiple distinct runs for the same Specification reference.
- Require the Target repository to be a non-bare Git checkout. A linked worktree is valid. Resolve the repository and specification real paths, reject paths escaping the repository, and store the canonical repository-relative Specification reference.
- Keep runtime state repo-local. Minimal bootstrap creates the orchestration runtime and its runs area, preserving existing ignore content and proving that runs are ignored by Git before publishing a run.
- Reject symlinks for orchestration runtime directories, run directories, snapshots, history files, and locks.
- A State snapshot always contains schema version, run ID, revision, Run phase, Specification reference, creation time, and update time. It may contain the interrupted phase of a Blocked run and the post-fix return phase while those continuations are needed.
- Start new runs in the `created` phase at revision 1. Pair creation with sequence 1 history event `run.created` at state revision 1.
- Use the canonical Run phases `created`, `preparing`, `implementing`, `reviewing`, `checking`, `fixing`, `blocked`, `failed`, `cancelled`, and `completed`.
- Centralize lifecycle legality in a pure transition function operating only on phase and continuation metadata. Persistence concerns such as time, IDs, revisions, and I/O remain outside it.
- Use semantic transition events. The normal graph advances through preparation, implementation, review, checks, and completion; review or check failure enters fixing; fixer completion returns to the failed validation phase.
- Permit any nonterminal phase to become blocked, failed, or cancelled. Resuming a Blocked run returns to its recorded phase. Completed, failed, and cancelled phases have no outgoing transitions.
- Keep retry limits, artifact validation, completion evidence, and other subsystem guards outside the pure Run phase transition function.
- Use Zod 4 as the runtime schema source of truth. Preserve unknown object properties structurally at every schema level while rejecting missing required data, unknown lifecycle values, and unsupported schema versions.
- Generate and commit deterministic JSON Schemas for State snapshots and history events. The build regenerates them before bundling, and tests compare generated output for drift.
- Do not build migration machinery for schema version 1. Unsupported versions fail with a compatibility error.
- Every history event contains schema version, event ID, run ID, sequence, state revision, UTC RFC 3339 timestamp with milliseconds, namespaced event type, and a data object.
- Keep history event types open to future namespaced values. Only the transition function's state-changing input is a closed event union.
- Require history sequences to be contiguous from 1. State revisions begin at 1, never decrease, increase by at most one per event, never exceed snapshot revision, and belong to the enclosing run.
- Treat matching final history and snapshot revisions as synchronized. Treat history exactly one revision behind as a readable interrupted-audit warning that blocks further mutation. Treat larger gaps, history ahead of state, empty history, malformed or blank records, mismatched run IDs, and invalid sequence as corruption.
- Make the snapshot authoritative and publish it before its paired history update. Do not introduce event sourcing or a transaction journal in this phase; automatic reconciliation is deferred to recovery work.
- Publish initial runs by fully writing and syncing a uniquely named hidden staging directory beside the final run, then atomically renaming it into place without overwriting another run.
- Publish individual snapshots and logical history appends through same-directory temporary files, file synchronization, atomic rename, and directory synchronization. History is append-only at the domain level even though the complete small file is atomically replaced in V1.
- Clamp persisted timestamps so that they never precede the prior persisted timestamp. Sequence and revision, not wall time, determine order.
- A run-level mutation lock uses exclusive filesystem creation and records process ID, hostname, acquisition time, and a random owner token. It spans validation, transition calculation, snapshot publication, and history publication.
- Lock acquisition fails immediately when held. Locks are never automatically broken and can only be released when the token matches the owner.
- Status and history reads do not acquire the mutation lock because all published files are complete atomic versions.
- Run selection uses an explicit ID when provided. Otherwise it chooses the sole nonterminal run, falls back to the sole run when none are active, and refuses zero or ambiguous candidates with guidance.
- Implicit selection validates every candidate and fails if any run is unreadable. Explicit selection validates only the requested run. Hidden interrupted-creation directories are ignored as runs but reported by repository diagnostics.
- Human status reports run identity, phase, Specification reference, revision, timestamps, and audit synchronization. Structured status returns the State snapshot with history sequence, revision, and synchronization metadata.
- Human history renders one chronological line per Run event. Structured history returns a JSON array containing the exact persisted event envelopes.
- Default failures write concise messages to standard error. Structured mode writes stable error objects containing a code, message, and optional details.
- Use exit status 0 for success, 1 for unexpected internal failures, 2 for invalid commands or arguments, 3 for missing or ambiguous repositories/runs/specifications, 4 for corrupted or incompatible persisted data, and 5 for lock contention.
- Preserve all original persisted bytes when validation fails. Ordinary commands never repair, migrate, truncate, or overwrite corrupted data.
- A command cleans up only its own staging files after a handled error. It never deletes artifacts left by another or interrupted invocation.

## Testing Decisions

- Prefer the existing `scripts/flow` subprocess boundary as the primary test seam because it exercises argument parsing, repository discovery, path safety, persistence, output, and exit behavior together.
- Cover run creation in temporary Git repositories, including implicit and explicit repository selection, canonical Specification references, generated and supplied IDs, idempotent retry, duplicate-spec runs, minimal runtime bootstrap, and Git-ignore verification.
- Cover human and structured status/history output through the executable, including explicit selection, sole-active selection, sole-terminal fallback, no-run behavior, ambiguous runs, audit warnings, and categorized errors.
- Cover invalid repositories, missing or external specifications, escaping specification symlinks, runtime symlinks, unknown versions, malformed snapshots, malformed history, sequence/revision violations, and mismatched run identities at the subprocess seam.
- Test the pure lifecycle transition seam exhaustively: every permitted edge succeeds with correct continuation metadata, every other edge is rejected, blocking/resume preserves its origin, fixing returns to the correct validation phase, and terminal phases cannot transition.
- Test runtime schema parsing and generated-schema drift directly because these contracts cannot be proven completely through a small number of CLI scenarios.
- Test crash safety through injected filesystem failures at synchronization and rename boundaries. Assert that readers observe only a complete old or complete new file and that failed creation never exposes a partial final run.
- Test the detectable snapshot-first failure mode: a one-revision history lag remains readable with a warning and refuses mutation, while other state/history inconsistencies fail as corruption.
- Test lock acquisition, owner metadata, token-checked release, cleanup on handled failure, and refusal of a second owner directly. Include one concurrent subprocess test to prove actual contention behavior.
- Inject clocks and random sources into lower-level tests so IDs, timestamps, collisions, and backward-clock clamping are deterministic without sleeps.
- Reuse the Phase 0 convention of building before executable tests. Final verification runs the complete test suite, type checking, linting, formatting checks, build, schema drift check, and smoke tests for help plus all new commands.

## Out of Scope

- Git branch, commit, checkpoint, or Feature worktree creation and validation.
- Ticket source adapters, dependency graphs, scheduling, or ticket execution state.
- Herdr integration, pane/process lifecycle, or agent execution records.
- Worker, reviewer, checker, or fixer execution and their structured result artifacts.
- Retry-budget enforcement and completion-evidence guards owned by later subsystems.
- A public generic transition command or public commands for phases not yet operational.
- Automatic audit reconciliation, stale-lock breaking, migrations, cleanup, or general restart recovery.
- Repository-wide orchestration configuration, prompt overrides, and full setup beyond the minimal runtime/ignore bootstrap.
- Event sourcing, SQLite, XState, parallel execution, monitoring, UI, deployment, or Windows support.

## Further Notes

- The terms Target repository, Workflow run, Run phase, State snapshot, Operational history, Run event, Specification reference, and Blocked run follow the project glossary.
- The snapshot-authority and detectable-audit-gap tradeoff is recorded in ADR 0001.
- The State snapshot intentionally contains no copied specification, ticket graph, Git state, or agent state. Later phases add only facts their subsystem owns.
- Phase 0 is being implemented concurrently; Phase 1 should build on its final executable and quality-tool interfaces without reverting or redesigning that work.

## Comments

