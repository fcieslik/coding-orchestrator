# 04: Validate the Feature worktree baseline

**What to build:** Let an Orchestrator prove that a prepared Feature worktree is still at its last accepted Git checkpoint and safe for a fresh delegated worker, without changing or repairing either Git or durable workflow state.

**Blocked by:** 03: Make preparation retry-safe and serialized.

**Status:** completed

- [x] `flow worktree validate` supports the established explicit or implicit Target repository and Workflow run selection behavior.
- [x] Validation is read-only and never acquires mutation locks, changes the State snapshot, appends Operational history, or repairs Git resources.
- [x] Validation proves that the Feature worktree shares the Target repository's canonical Git common directory.
- [x] Validation proves that Git registration and its canonical path exactly match the persisted Feature worktree.
- [x] Validation requires the expected Feature branch to be checked out and rejects detached or wrong-branch state.
- [x] Validation requires the Feature branch ref and worktree `HEAD` to equal the persisted validated `HEAD`.
- [x] Validation rejects tracked changes and non-ignored untracked files while permitting ignored files.
- [x] Missing worktrees, registrations, branches, and repositories are distinguished from mismatched, dirty, advanced, reset, or divergent Git state.
- [x] External deletion or mutation is reported without recreating, resetting, pruning, or otherwise repairing Git.
- [x] Human output concisely identifies every checked invariant and the overall result.
- [x] Structured output contains the selected run, persisted Git facts, an overall validity result, and named repository, registration, path, branch, head, and cleanliness checks.
- [x] Structured and human errors retain the agreed stable codes and existing exit-status taxonomy.
- [x] Executable tests using real temporary repositories cover the healthy baseline and each independent missing, mismatched, advanced, detached, dirty, and untracked failure mode.
- [ ] The full test, schema drift, typecheck, lint, format, build, and command smoke-test suite passes.
