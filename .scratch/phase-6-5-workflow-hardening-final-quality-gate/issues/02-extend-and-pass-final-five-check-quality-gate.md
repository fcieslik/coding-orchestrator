# 02: Extend and pass the final five-check quality gate

**What to build:** Extend the existing deterministic validation operation into one complete final project gate that runs only after every ticket in the Workflow package is accepted. The Target repository explicitly configures five fixed checks—`test`, `lint`, `typecheck`, `formatCheck`, and `build`—under the existing shared timeout. The public validation command executes them in the documented order in the final Feature worktree, records all outcomes in the existing durable validation result, and passes only when every check succeeds without changing Feature HEAD or worktree contents. Finish by rebuilding and installing the skill and passing one small live exit gate that proves both the Worker safeguards from Ticket 01 and the five-check validation.

**Blocked by:** 01: Embed canonical safeguards in every Worker invocation

**Status:** completed

- [x] Repository-local validation configuration requires exactly `test`, `lint`, `typecheck`, `formatCheck`, `build`, and the existing `timeoutSeconds`, without introducing stage arrays or a workflow DSL.
- [x] Setup creates and documents a complete five-command example while preserving existing user configuration instead of rewriting it.
- [x] An existing three-command configuration is rejected before project commands run with an actionable error naming the missing `formatCheck` and `build` commands.
- [x] The public validation operation remains package-based and runs the five checks sequentially in the fixed order `test`, `lint`, `typecheck`, `formatCheck`, then `build` against the final Feature worktree.
- [x] The operation attempts every later check after an ordinary failure when safe, and applies the existing timeout independently to each command.
- [x] The durable validation result and generated schemas contain exactly five named outcomes with the existing command, status, exit code, duration, and bounded diagnostic contract.
- [x] Overall validation passes only when all five checks pass and the Feature branch remains at the accepted HEAD with a clean Feature worktree.
- [x] A formatting check that exits successfully but modifies files fails through the existing cleanliness policy; the Orchestrator reports and preserves the mutation rather than cleaning it.
- [x] Tests cover passing validation plus focused failures of `formatCheck` and `build`, including non-zero exit, launch failure, and timeout, without duplicating already-covered run selection and Git invariants at lower seams.
- [x] Documentation makes clear that Workers run only focused checks during ticket implementation and the Orchestrator runs this full gate once, after the complete Ticket queue.
- [x] Standard Git and the existing worktree adapter remain unchanged; no external worktree CLI, GitHub operation, Reviewer, auto-fix, or generic pipeline framework is added.
- [x] The complete automated project gates, schema generation/check, build, and Installed-skill validation pass.
- [x] A manual disposable-repository test shows a fresh Worker receiving the canonical safeguards and a completed Workflow run producing five passing validation outcomes with unchanged Feature HEAD, clean Feature worktree, and untouched primary checkout.

Implemented in commit `9d984f8`. The deterministic gate passed 149 automated tests plus lint, typecheck, formatting, schema drift, build, and Installed-skill checks.

Live gate evidence (2026-09-09): package `phase6-5-final-live` ran in `/Users/fc47/workspace/trash/herdr-testing` as run `run_20260909T093920Z_64ec7b024428`. A fresh Codex Worker received the installed skill contract, completed ticket `01-add-multiply`, and published a valid result for accepted commit `c01f98b98588925ac402058554e587566582b765`. Herdr reported lifecycle `done` and closed the owned pane. Final validation recorded `test`, `lint`, `typecheck`, `formatCheck`, and `build` as passed in that order. The Feature HEAD remained at the accepted commit, both Feature worktree and primary checkout were clean, and primary branch `master` remained at run base `d922b77d47def7535ab2585bda635d2f49872e08`.
