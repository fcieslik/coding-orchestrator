# 03: Add operator diagnostics and controlled pane retention

**What to build:** Complete the operator-facing feasibility workflow with durable report export and an explicit diagnostic mode that can retain the owned pane without weakening the definition of a passing gate.

**Blocked by:** 02 — Fail closed across Herdr lifecycle and protocol failures.

**Status:** completed

- [x] `flow herdr smoke --json` emits exactly one structured report to standard output for successful and non-passing lifecycle results.
- [x] Human-readable output summarizes the same evidence and clearly distinguishes a passing gate from a diagnostic or failed run.
- [x] An optional output-file argument copies the same structured report to the explicitly requested destination.
- [x] Report export does not create or mutate Workflow run state and does not append Operational history.
- [x] Output-file failures are reported without hiding the already observed Herdr lifecycle and cleanup evidence.
- [x] Default smoke execution requires successful closure of the owned pane before reporting a passing gate.
- [x] An explicit keep-pane option skips closure only for the pane created by the current invocation.
- [x] Keep-pane output reports `cleanup` as skipped, exposes the owned pane identifier, and explains that the result is diagnostic rather than a complete gate pass.
- [x] Keep-pane mode returns a non-passing result even when launch, prompt delivery, settlement, nonce, cwd, and output checks succeed.
- [x] Close failure reports the owned pane prominently with manual-recovery guidance and remains non-passing.
- [x] Neither keep-pane nor close failure triggers agent release, forceful process termination, broader layout cleanup, or Herdr server control.
- [x] Reports preserve bounded useful diagnostics but never include the complete challenge prompt.
- [x] Fake-executable CLI tests cover successful report export, export failure, keep-pane behavior, normal close, close failure, human output, structured output, and absence of workflow-state mutation.
- [x] Help text explains that the live command launches Codex, may incur normal agent usage, requires a genuine Herdr-managed caller, and treats keep-pane as diagnostic-only.
- [x] The full deterministic suite, schema drift check, type checking, linting, formatting check, build, and executable help checks pass without launching a real agent.
