# 01: Prepare and inspect a Feature worktree

**What to build:** Give a Workflow run its first complete Git-backed implementation workspace. A user can prepare the default Run base, Feature branch, and external Feature worktree, then inspect the accepted Git facts through normal status output.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] `flow worktree prepare` supports the established explicit or implicit Target repository and Workflow run selection behavior.
- [ ] Preparation resolves the Target repository's `HEAD` to a full canonical commit identifier and persists it as the immutable Run base.
- [ ] Preparation derives the agreed orchestrator-owned Feature branch name and hidden sibling Feature worktree location from the run and Target repository.
- [ ] Delegated Git resources are created without changing the Target repository's checked-out branch, `HEAD`, index, or working files.
- [ ] The State snapshot gains an optional schema-version-1 Git section containing the Run base, Feature branch, canonical Feature worktree path, worktree lifecycle status, and validated `HEAD`.
- [ ] Known Git fields and lifecycle values are runtime-validated while unknown additive properties remain preserved.
- [ ] Generated snapshot schemas include the optional Git state and remain deterministic and drift-checked.
- [ ] Preparation records complete intent with `git.preparation.started`, enters `preparing`, and creates no Git resources before that mutation and its audit are synchronized.
- [ ] A successfully created worktree is verified at the Run base, recorded as ready with `git.worktree.prepared`, and advances the Workflow run to `implementing`.
- [ ] The initial validated `HEAD` equals the Run base.
- [ ] Human and structured preparation output identify the run, Run base, Feature branch, Feature worktree, and resulting Run phase.
- [ ] Human and structured run status include persisted Git facts when present without performing live Git validation.
- [ ] Executable tests prove the complete default preparation and inspection path in a real temporary Git repository.
- [ ] Existing run creation, status, history, schema, installer, help, version, and error behavior remains green.
- [ ] The full test, schema drift, typecheck, lint, format, build, and command smoke-test suite passes.
