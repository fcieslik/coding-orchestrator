# 05: Accept Git checkpoints

**What to build:** Let an Orchestrator accept an explicitly reported commit as the next Git checkpoint only after proving that it is new, complete, clean, and exactly represents the current Feature branch and Feature worktree.

**Blocked by:** 04: Validate the Feature worktree baseline.

**Status:** completed

- [x] `flow checkpoint validate --commit` requires an explicit commit and supports established repository and Workflow run selection.
- [x] The candidate is resolved locally to a full canonical commit identifier using the repository's detected object format.
- [x] Missing objects and non-commit revisions are rejected without fetching or mutation.
- [x] The candidate commit, Feature branch ref, and Feature worktree `HEAD` must be identical.
- [x] A reachable candidate behind the current `HEAD` is rejected as stale rather than accepting an unvalidated tail.
- [x] The candidate must be a strict descendant of the prior validated `HEAD`; equality, divergence, resets, rebases, and force-updated ancestry are refused.
- [x] One or more ordinary commits and merge commits between Git checkpoints are accepted when ancestry and identity invariants hold.
- [x] Checkpoint validation proves repository identity, exact registration and path, and expected Feature branch before accepting the candidate.
- [x] Tracked changes and non-ignored untracked files block checkpoint acceptance while ignored files are permitted.
- [x] A successful checkpoint updates only the persisted validated `HEAD`, increments the snapshot revision once, and appends one `git.checkpoint.accepted` Run event at the matching revision.
- [x] Checkpoint acceptance does not change the Run phase or introduce ticket execution state.
- [x] Previously accepted Git checkpoints remain visible in Operational history even if an external actor later rewrites branch history.
- [x] The existing run lock spans persisted-data validation, live Git validation, snapshot publication, and history publication.
- [x] Failed validation leaves the State snapshot and Operational history unchanged and preserves all Git state.
- [x] Human and structured success output identify the run, prior validated commit, and newly accepted Git checkpoint.
- [x] Stable failures distinguish missing, stale, divergent, dirty, locked, and general Git-invariant conditions using the agreed exit statuses.
- [x] Real temporary-repository tests cover single, multiple, and merge commits plus every missing, stale, ahead, divergent, rewritten, wrong-branch, wrong-path, dirty, and concurrent case.
- [x] Persistence-failure tests prove existing snapshot-first audit-gap behavior for checkpoint mutation without accepting later checkpoints over a gap.
- [ ] The full test, schema drift, typecheck, lint, format, build, and command smoke-test suite passes.
