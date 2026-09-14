# 01: Preserve and report bounded Worker failure diagnostics

**What to build:** Make a technical Worker failure understandable and durable from end to end. When a Herdr or later Worker-execution operation fails, preserve a small structured Attempt failure diagnostic in the existing Execution record, block the Workflow run without accepting the ticket, and tell the user why it stopped and where to inspect the evidence. Keep this separate from Review attention and do not add a logging subsystem or change retry behavior.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The initial Execution record is durable before the first Herdr operation; failure to create it launches no pane or Worker.
- [ ] A technical failure records the operation, concise message, optional exit code and signal, bounded stdout and stderr tails, and whether either stream was truncated.
- [ ] Retained stdout and stderr are limited to the final 16 KiB of each stream, for at most 32 KiB of process output in the record.
- [ ] A primary execution failure remains in diagnostics, while a secondary pane-cleanup failure uses the existing cleanup error field.
- [ ] The Worker attempt becomes `failed`, the Workflow run becomes `blocked`, and the ticket remains unaccepted.
- [ ] The last-execution reference and ticket-blocked history event contain the same short failure reason and continue to point to the Execution record.
- [ ] Human-readable CLI output identifies the ticket and failed operation, includes the exit code when available, shows at most 300 normalized characters from the first non-empty stderr line, and points to the Execution record without printing the complete streams.
- [ ] Prompts, environment variables, unsanitized command arguments, and full terminal transcripts are not added to durable diagnostics.
- [ ] Explicit retry, attempt limits, reconciliation, and Review attention behavior are unchanged.
- [ ] Existing version 1 Execution records without the new optional diagnostic fields remain valid.
- [ ] One public-process regression using fake Herdr and a real temporary Git repository proves the failure record, blocked state/history, bounded output, and concise CLI behavior without introducing a new lower-level test seam.
- [ ] Installed-skill documentation and generated schemas describe the additive contract consistently.
- [ ] The focused regression and the existing test, schema, typecheck, lint, format, and build gates pass.
