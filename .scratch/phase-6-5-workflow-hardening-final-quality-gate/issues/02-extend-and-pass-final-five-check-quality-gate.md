# 02: Extend and pass the final five-check quality gate

**What to build:** Extend the existing deterministic validation operation into one complete final project gate that runs only after every ticket in the Workflow package is accepted. The Target repository explicitly configures five fixed checks—`test`, `lint`, `typecheck`, `formatCheck`, and `build`—under the existing shared timeout. The public validation command executes them in the documented order in the final Feature worktree, records all outcomes in the existing durable validation result, and passes only when every check succeeds without changing Feature HEAD or worktree contents. Finish by rebuilding and installing the skill and passing one small live exit gate that proves both the Worker safeguards from Ticket 01 and the five-check validation.

**Blocked by:** 01: Embed canonical safeguards in every Worker invocation

**Status:** ready-for-agent

- [ ] Repository-local validation configuration requires exactly `test`, `lint`, `typecheck`, `formatCheck`, `build`, and the existing `timeoutSeconds`, without introducing stage arrays or a workflow DSL.
- [ ] Setup creates and documents a complete five-command example while preserving existing user configuration instead of rewriting it.
- [ ] An existing three-command configuration is rejected before project commands run with an actionable error naming the missing `formatCheck` and `build` commands.
- [ ] The public validation operation remains package-based and runs the five checks sequentially in the fixed order `test`, `lint`, `typecheck`, `formatCheck`, then `build` against the final Feature worktree.
- [ ] The operation attempts every later check after an ordinary failure when safe, and applies the existing timeout independently to each command.
- [ ] The durable validation result and generated schemas contain exactly five named outcomes with the existing command, status, exit code, duration, and bounded diagnostic contract.
- [ ] Overall validation passes only when all five checks pass and the Feature branch remains at the accepted HEAD with a clean Feature worktree.
- [ ] A formatting check that exits successfully but modifies files fails through the existing cleanliness policy; the Orchestrator reports and preserves the mutation rather than cleaning it.
- [ ] Tests cover passing validation plus focused failures of `formatCheck` and `build`, including non-zero exit, launch failure, and timeout, without duplicating already-covered run selection and Git invariants at lower seams.
- [ ] Documentation makes clear that Workers run only focused checks during ticket implementation and the Orchestrator runs this full gate once, after the complete Ticket queue.
- [ ] Standard Git and the existing worktree adapter remain unchanged; no external worktree CLI, GitHub operation, Reviewer, auto-fix, or generic pipeline framework is added.
- [ ] The complete automated project gates, schema generation/check, build, and Installed-skill validation pass.
- [ ] A manual disposable-repository test shows a fresh Worker receiving the canonical safeguards and a completed Workflow run producing five passing validation outcomes with unchanged Feature HEAD, clean Feature worktree, and untouched primary checkout.
