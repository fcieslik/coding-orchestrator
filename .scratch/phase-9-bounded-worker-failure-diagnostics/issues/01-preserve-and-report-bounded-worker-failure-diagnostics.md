# 01: Preserve and report bounded Worker failure diagnostics

**What to build:** Make a technical Worker failure understandable and durable from end to end. When a Herdr or later Worker-execution operation fails, preserve a small structured Attempt failure diagnostic in the existing Execution record, block the Workflow run without accepting the ticket, and tell the user why it stopped and where to inspect the evidence. Keep this separate from Review attention and do not add a logging subsystem or change retry behavior.

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] The initial Execution record is durable before the first Herdr operation; failure to create it launches no pane or Worker.
- [x] A technical failure records the operation, concise message, optional exit code and signal, bounded stdout and stderr tails, and whether either stream was truncated.
- [x] Retained stdout and stderr are limited to the final 16 KiB of each stream, for at most 32 KiB of process output in the record.
- [x] A primary execution failure remains in diagnostics, while a secondary pane-cleanup failure uses the existing cleanup error field.
- [x] The Worker attempt becomes `failed`, the Workflow run becomes `blocked`, and the ticket remains unaccepted.
- [x] The last-execution reference and ticket-blocked history event contain the same short failure reason and continue to point to the Execution record.
- [x] Human-readable CLI output identifies the ticket and failed operation, includes the exit code when available, shows at most 300 normalized characters from the first non-empty stderr line, and points to the Execution record without printing the complete streams.
- [x] Prompts, environment variables, unsanitized command arguments, and full terminal transcripts are not added to durable diagnostics.
- [x] Explicit retry, attempt limits, reconciliation, and Review attention behavior are unchanged.
- [x] Existing version 1 Execution records without the new optional diagnostic fields remain valid.
- [x] One public-process regression using fake Herdr and a real temporary Git repository proves the failure record, blocked state/history, bounded output, and concise CLI behavior without introducing a new lower-level test seam.
- [x] Installed-skill documentation and generated schemas describe the additive contract consistently.
- [x] The focused regression and the existing test, schema, typecheck, lint, format, and build gates pass.

## Gate evidence

- Development gates passed on 2026-09-14: 166 tests plus lint, typecheck, format check, schema check, and build.
- The freshly built global skill was installed before the live gate.
- Live run `run_20260914T133659Z_abc670766af9` used a controlled Herdr proxy against the disposable repository `/Users/fc47/workspace/trash/herdr-testing`.
- Real pane creation reached `agent start`, which failed deliberately with exit code `23` and stderr `PHASE9_CONTROLLED_FAILURE: simulated Codex startup failure`.
- The Execution record persisted `status = failed`, operation, exit code, bounded stdout/stderr, and `cleanup.status = closed`.
- Run state persisted `phase = blocked`; `lastExecution` and both failure/block history events retained the same reason and Execution-record reference.
- Ticket `01-create-marker` remained active and unaccepted, no checkpoint or implementation commit was created, the marker stayed absent, and the Feature worktree remained clean at base commit `db04fd9a21432965e3e2e4655b31774f6d0e1d51`.

## Observed limitation

The first invocation required an explicit resume after Codex's sandbox denied Git feature-branch ref creation. That pre-Worker permission boundary is separate from Phase 9 diagnostics; after Git metadata access was granted, the controlled `agent start` failure followed the expected durable path.
