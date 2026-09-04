# 03: Make preparation retry-safe and serialized

**What to build:** Make Feature worktree preparation safe to retry after interruption and safe to run concurrently across Workflow runs. Only resources matching previously persisted intent can complete preparation; ambiguous or conflicting Git state is refused.

**Blocked by:** 02: Harden Git identity and preparation inputs.

**Status:** ready-for-agent

- [ ] A repo-local owned Git-operation lock serializes preparation across Workflow runs before shared branches or worktree registrations are inspected or changed.
- [ ] Preparation acquires the repository Git-operation lock before the existing run lock in one fixed order.
- [ ] Repository lock metadata, immediate contention failure, owner-token release, stale-lock preservation, and exit status follow the existing lock contract.
- [ ] No Git mutation occurs until the planned State snapshot and matching Operational history event are synchronized.
- [ ] A one-revision audit lag or other persisted-data inconsistency prevents Git invocation.
- [ ] After intent exists, omitted preparation options reuse the persisted base, branch, and path rather than resolving new defaults.
- [ ] Supplied options after intent exists must resolve to the exact persisted values; conflicts fail without changing Git, State snapshot, or Operational history.
- [ ] A retry in `preparing` creates Git resources that are still absent and completes readiness after validating them.
- [ ] A retry may recognize an existing branch and registered worktree only when repository identity, path, branch, and `HEAD` exactly match the persisted plan and Run base.
- [ ] Unexpected registrations, mismatched repositories, wrong branches or paths, and worktrees advanced beyond the Run base are refused without adoption or repair.
- [ ] A repeated call for an already ready Feature worktree performs live validation and returns success without another revision or duplicate event.
- [ ] Failed Git execution leaves the run in `preparing` and does not append rejection events or overwrite the persisted intent.
- [ ] Locks are released by their owners after handled success or failure and are retained after process death rather than guessed stale.
- [ ] Injected runner and persistence failures prove intent-first ordering and exact retry behavior at every boundary before and after branch/worktree creation and readiness publication.
- [ ] A real concurrent subprocess test proves that another run cannot race preparation through a colliding branch or path.
- [ ] Human and structured retry, conflict, invariant, and lock results use the established output and exit contracts.
- [ ] The full test, schema drift, typecheck, lint, format, build, and command smoke-test suite passes.
