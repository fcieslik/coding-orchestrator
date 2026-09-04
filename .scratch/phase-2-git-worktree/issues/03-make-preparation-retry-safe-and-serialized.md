# 03: Make preparation retry-safe and serialized

**What to build:** Make Feature worktree preparation safe to retry after interruption and safe to run concurrently across Workflow runs. Only resources matching previously persisted intent can complete preparation; ambiguous or conflicting Git state is refused.

**Blocked by:** 02: Harden Git identity and preparation inputs.

**Status:** completed

- [x] A repo-local owned Git-operation lock serializes preparation across Workflow runs before shared branches or worktree registrations are inspected or changed.
- [x] Preparation acquires the repository Git-operation lock before the existing run lock in one fixed order.
- [x] Repository lock metadata, immediate contention failure, owner-token release, stale-lock preservation, and exit status follow the existing lock contract.
- [x] No Git mutation occurs until the planned State snapshot and matching Operational history event are synchronized.
- [x] A one-revision audit lag or other persisted-data inconsistency prevents Git invocation.
- [x] After intent exists, omitted preparation options reuse the persisted base, branch, and path rather than resolving new defaults.
- [x] Supplied options after intent exists must resolve to the exact persisted values; conflicts fail without changing Git, State snapshot, or Operational history.
- [x] A retry in `preparing` creates Git resources that are still absent and completes readiness after validating them.
- [x] A retry may recognize an existing branch and registered worktree only when repository identity, path, branch, and `HEAD` exactly match the persisted plan and Run base.
- [x] Unexpected registrations, mismatched repositories, wrong branches or paths, and worktrees advanced beyond the Run base are refused without adoption or repair.
- [x] A repeated call for an already ready Feature worktree performs live validation and returns success without another revision or duplicate event.
- [x] Failed Git execution leaves the run in `preparing` and does not append rejection events or overwrite the persisted intent.
- [x] Locks are released by their owners after handled success or failure and are retained after process death rather than guessed stale.
- [x] Injected runner and persistence failures prove intent-first ordering and exact retry behavior at every boundary before and after branch/worktree creation and readiness publication.
- [x] A real concurrent subprocess test proves that another run cannot race preparation through a colliding branch or path.
- [x] Human and structured retry, conflict, invariant, and lock results use the established output and exit contracts.
- [x] The full test, schema drift, typecheck, lint, format, build, and command smoke-test suite passes.
