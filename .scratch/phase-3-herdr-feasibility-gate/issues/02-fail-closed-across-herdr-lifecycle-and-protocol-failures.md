# 02: Fail closed across Herdr lifecycle and protocol failures

**What to build:** Harden the simulated lifecycle so every uncertain Herdr observation and protocol failure is represented explicitly, produces bounded diagnostics, and cleans up only resources owned by the current execution.

**Blocked by:** 01 — Run a simulated Herdr lifecycle through the smoke command.

**Status:** completed

- [x] The adapter exposes distinct `settled`, `blocked`, `unknown`, `timed-out`, and `disappeared` transport outcomes.
- [x] Herdr `idle` and `done` both map to `settled`; no transport outcome is treated as semantic workflow completion.
- [x] `blocked`, `unknown`, timeout, and process disappearance remain distinguishable in structured smoke reports and all fail the gate.
- [x] Missing Herdr executables, non-zero command exits, malformed JSON, missing required fields, unexpected identifiers, and unsupported lifecycle values are explicit invocation or protocol failures rather than lifecycle outcomes.
- [x] Herdr compatibility is validated by required response fields and behavior rather than one exact version string.
- [x] The observed Herdr version remains available in diagnostics when later operations fail.
- [x] A generated agent-name collision is refused without attaching to, releasing, prompting, or replacing the existing agent.
- [x] Failure before pane creation attempts no cleanup and never targets a guessed identifier.
- [x] Failure after pane creation but before successful agent startup triggers a close attempt for exactly that owned pane.
- [x] Failure after agent startup retains both pane and agent identity for diagnosis and narrow cleanup.
- [x] If the primary operation and cleanup both fail, the report preserves both failures and prominently identifies the owned pane for manual recovery.
- [x] Cleanup failure never escalates to closing an unowned pane, tab, workspace, session, or Herdr server.
- [x] Captured standard output and standard error are size-bounded and retain the useful tail or other documented diagnostic window.
- [x] Reports include operation names, safe argument metadata, exit information, timings, identities, and lifecycle observations while excluding the full prompt.
- [x] Caller-supplied operation timeouts are honored independently for launch, prompt/wait, read, and close operations.
- [x] Fake-executable scenarios cover blocked, idle, done, unknown, timeout, process disappearance, malformed output, incomplete output, non-zero exits, collisions, and cleanup failures.
- [x] Tests verify exact invocation order and prove that no later Herdr operation runs after an earlier failure unless it is the narrowly required owned-resource cleanup.
- [x] Human-readable failures remain actionable and structured failures use the project's established error envelope and exit-status categories.
- [ ] Existing successful smoke behavior and all previous project behavior remain green (the pre-existing installer tests still see the unrelated untracked `assets/` directory).
