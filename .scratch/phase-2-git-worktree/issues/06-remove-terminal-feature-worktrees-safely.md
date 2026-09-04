# 06: Remove terminal Feature worktrees safely

**What to build:** Let a user explicitly remove a terminal Workflow run's Feature worktree only when every committed and local artifact is proven safe, while preserving the Feature branch and making interrupted cleanup exactly retryable.

**Blocked by:** 04: Validate the Feature worktree baseline.

**Status:** ready-for-agent

- [ ] `flow worktree cleanup` supports established repository and Workflow run selection and is idempotently successful for an already removed worktree.
- [ ] Cleanup is allowed only for `completed`, `failed`, or `cancelled` Workflow runs and has no force or active-run override.
- [ ] Cleanup acquires the repository Git-operation lock before the run lock and retains the established owner and contention behavior.
- [ ] Cleanup validates canonical repository identity, exact registration and path, expected Feature branch, and branch/`HEAD` equality with the persisted validated `HEAD`.
- [ ] Cleanup refuses tracked changes, non-ignored untracked files, and ignored files.
- [ ] Cleanup refuses missing or changed branches, unaccepted commits, detached or wrong branches, mismatched registration, wrong repository identity, and every condition that would require force.
- [ ] Cleanup never invokes `git clean`, force removal, worktree pruning, branch deletion, reset, or automatic repair.
- [ ] The registered Feature worktree is removed through non-force Git behavior while its Feature branch and commits are preserved.
- [ ] Git registration and the exact worktree directory are proven absent before durable state records removal.
- [ ] Successful cleanup changes only the Feature worktree lifecycle status, retains its historical path, branch, Run base, and validated `HEAD`, increments the snapshot revision once, and appends one `git.worktree.removed` event.
- [ ] If Git removal succeeds before state publication, an exact retry may finalize removal only when the path and registration are absent and the preserved Feature branch still equals the validated `HEAD`.
- [ ] Every ambiguous interrupted-cleanup combination is refused without deleting, rewriting, or adopting additional resources.
- [ ] Repeating cleanup after durable removal creates no additional revision or event.
- [ ] Later status reports persisted Git history and any externally missing or divergent preserved branch without recreating it.
- [ ] Human and structured output identify successful removal and precise safety refusals using the established exit taxonomy.
- [ ] Real temporary-repository tests cover active-run refusal, each dirty-state class, wrong identity and registration, unaccepted `HEAD`, successful terminal cleanup, preserved branch history, and idempotency.
- [ ] Injected persistence failures cover interruption after Git removal and before snapshot or history publication, including exact finalization and fail-closed ambiguous cases.
- [ ] The full test, schema drift, typecheck, lint, format, build, and command smoke-test suite passes.
