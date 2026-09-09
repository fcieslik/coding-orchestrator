# 02: Fail closed, rerun validation, and pass the Phase 6 gate

**What to build:** Complete the deterministic validation gate by proving that command failures, timeouts, and Git mutations cannot produce false success, that a user can explicitly rerun validation after correcting a problem, and that the packaged Installed skill passes one real Phase 6 test without agents or Herdr automation.

**Blocked by:** 01: Validate a completed Workflow run

**Status:** ready-for-agent

- [ ] A non-zero command exit produces overall `failed` while retaining the command's exit code and useful bounded diagnostics.
- [ ] A missing executable or other command launch failure produces overall `failed` and cannot be reported as a passing or missing check.
- [ ] A command exceeding its configured timeout is terminated, recorded distinctly as `timed_out`, and produces overall `failed` without blocking indefinitely.
- [ ] A validation command that changes Feature branch HEAD or leaves non-ignored worktree changes produces overall `failed`; the Orchestrator reports the evidence and does not reset, clean, commit, or delete the changes.
- [ ] Safe remaining checks are still attempted after an ordinary command failure so the user receives one complete validation report.
- [ ] A failed validation does not reopen Accepted tickets or erase their Git checkpoints; implementation completion and failed validation remain independently inspectable.
- [ ] After the user corrects the project or environment without changing the accepted HEAD, explicitly invoking validation again executes a fresh validation and atomically replaces the current validation decision.
- [ ] Repeating validation after a pass is safe and produces a new complete decision for the same current HEAD without automatic retries, attempt machinery, or background recovery.
- [ ] Interrupted publication cannot leave State snapshot pointing at a partial result; the user can safely invoke validation again.
- [ ] Concurrent state-changing operations are refused through the existing per-run lock before duplicate checks begin.
- [ ] A compact public-CLI failure matrix covers non-zero exit, launch failure, timeout, dirty precondition, stale HEAD, and validation-created Git changes without adding duplicate lower-level suites.
- [ ] A public-CLI rerun scenario proves fail-then-pass behavior and agreement between the latest result, State snapshot, exact HEAD, and structured output.
- [ ] Phase 6 documentation and roadmap describe only deterministic `test`, `lint`, and `typecheck` validation; semantic review, HTTP, browser, screenshots, security stages, and automatic repair are retained as future improvements.
- [ ] The complete project test, typecheck, lint, formatting, schema, build, and installed-package checks pass.
- [ ] After rebuilding and reinstalling the skill, one manual disposable-repository test proves that all three real configured commands pass for the final accepted HEAD, both checkouts remain clean, human and structured output agree, and no coding agent or Herdr pane is launched.
