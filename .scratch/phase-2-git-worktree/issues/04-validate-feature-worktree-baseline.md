# 04: Validate the Feature worktree baseline

**What to build:** Let an Orchestrator prove that a prepared Feature worktree is still at its last accepted Git checkpoint and safe for a fresh delegated worker, without changing or repairing either Git or durable workflow state.

**Blocked by:** 03: Make preparation retry-safe and serialized.

**Status:** ready-for-agent

- [ ] `flow worktree validate` supports the established explicit or implicit Target repository and Workflow run selection behavior.
- [ ] Validation is read-only and never acquires mutation locks, changes the State snapshot, appends Operational history, or repairs Git resources.
- [ ] Validation proves that the Feature worktree shares the Target repository's canonical Git common directory.
- [ ] Validation proves that Git registration and its canonical path exactly match the persisted Feature worktree.
- [ ] Validation requires the expected Feature branch to be checked out and rejects detached or wrong-branch state.
- [ ] Validation requires the Feature branch ref and worktree `HEAD` to equal the persisted validated `HEAD`.
- [ ] Validation rejects tracked changes and non-ignored untracked files while permitting ignored files.
- [ ] Missing worktrees, registrations, branches, and repositories are distinguished from mismatched, dirty, advanced, reset, or divergent Git state.
- [ ] External deletion or mutation is reported without recreating, resetting, pruning, or otherwise repairing Git.
- [ ] Human output concisely identifies every checked invariant and the overall result.
- [ ] Structured output contains the selected run, persisted Git facts, an overall validity result, and named repository, registration, path, branch, head, and cleanliness checks.
- [ ] Structured and human errors retain the agreed stable codes and existing exit-status taxonomy.
- [ ] Executable tests using real temporary repositories cover the healthy baseline and each independent missing, mismatched, advanced, detached, dirty, and untracked failure mode.
- [ ] The full test, schema drift, typecheck, lint, format, build, and command smoke-test suite passes.
