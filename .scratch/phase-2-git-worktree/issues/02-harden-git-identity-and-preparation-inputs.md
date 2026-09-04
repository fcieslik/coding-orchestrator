# 02: Harden Git identity and preparation inputs

**What to build:** Let users deliberately select a Run base, Feature branch, and Feature worktree destination while making every accepted preparation provably tied to the intended Git repository and safe from collisions or path redirection.

**Blocked by:** 01: Prepare and inspect a Feature worktree.

**Status:** ready-for-agent

- [ ] `flow worktree prepare` accepts optional base revision, Feature branch, and Feature worktree path overrides on initial preparation.
- [ ] Base revisions are resolved inside the Target repository, peeled to commits, and persisted only as full lowercase object identifiers.
- [ ] Normal and linked non-bare Target repositories, detached `HEAD`, and shallow repositories with the selected object available locally are supported.
- [ ] Bare and unborn repositories, Target repositories that are themselves submodule checkouts, missing objects, and non-commit revisions are rejected without fetching or mutation.
- [ ] Git object-format detection supports SHA-1 and SHA-256 repositories without assuming identifier length.
- [ ] Feature branch overrides are validated using Git's reference rules and are refused when the branch already exists or is checked out in any worktree.
- [ ] Relative Feature worktree overrides resolve from the caller's current directory and are persisted as canonical absolute paths.
- [ ] Initial preparation refuses existing destinations, the Target repository, paths inside the Target repository, registered worktrees, and destinations traversing symlinked existing components.
- [ ] The Feature worktree is proven to share the Target repository's canonical Git common directory and exact registered path.
- [ ] The exact run-owning Target repository is treated as the protected primary checkout even when it is a linked worktree.
- [ ] A dirty Target repository does not block preparation, remains untouched, and produces a success warning explaining that uncommitted changes are outside the Run base.
- [ ] Git subprocesses use explicit working directories and noninteractive execution while preserving normal repository hooks.
- [ ] No preparation path fetches, pushes, prunes, rebases, resets, deletes branches, or initializes submodules.
- [ ] Human and structured failures use stable argument, missing-resource, and Git-invariant error contracts and exit statuses.
- [ ] Real temporary-repository tests cover repository shapes, object formats where supported, explicit overrides, collisions, containment, symlinks, repository identity, and dirty Target repository behavior.
- [ ] The full test, schema drift, typecheck, lint, format, build, and command smoke-test suite passes.
