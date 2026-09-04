# 01: Run a simulated Herdr lifecycle through the smoke command

**What to build:** Deliver the first complete Herdr transport slice. From the public smoke command, create an owned sibling pane, start Codex, forward an opaque challenge, wait for settlement, read matching diagnostics, and close the pane through a controllable fake Herdr executable.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] `flow herdr smoke --agent codex` is available through the existing executable CLI and has concise help and argument validation.
- [x] The smoke command refuses to control Herdr unless both the managed-environment marker and caller pane context are present.
- [x] The command resolves its current working directory to an explicit absolute path and requests a sibling pane relative to the caller without changing focus.
- [x] Pane identity is parsed from Herdr's structured response rather than inferred from display order or example identifiers.
- [x] The adapter retains an owned execution handle containing the returned pane identifier and the generated agent name.
- [x] Agent identity is deterministic, normalized to Herdr's lowercase grammar and length limit, and suitable for later correlation in reports.
- [x] Codex starts through Herdr's high-level agent API in the previously created pane.
- [x] Herdr is invoked through an injectable executable-and-argument-vector command runner; no shell-built command contains paths, identifiers, or prompts.
- [x] The adapter accepts an already-rendered prompt as an opaque string and does not interpret skills, tickets, reviews, artifacts, or workflow meaning.
- [x] The smoke challenge contains a unique nonce, multiple lines, and literal `$implement`, explicitly asks Codex not to invoke the skill, and requests the current working directory.
- [x] Tests prove that the complete prompt reaches the fake executable byte for byte, including whitespace, newlines, Unicode, quotes, and the literal dollar sign.
- [x] Prompt submission waits through Herdr's agent API using the agreed 120-second smoke settlement timeout; agent startup uses the agreed 30-second timeout.
- [x] Herdr `idle` and `done` responses produce a transport-level settled observation without implying ticket completion.
- [x] Agent output is read through Herdr and must contain the current challenge nonce and expected working directory for the smoke path to proceed.
- [x] Default execution closes only the pane created by the current smoke invocation.
- [x] Structured success output identifies the observed Herdr version, requested cwd, owned identities, lifecycle observation, challenge checks, cleanup result, and timings without including the submitted prompt.
- [x] The smoke command does not create or mutate a Workflow run, State snapshot, or Operational history.
- [x] A fake Herdr executable drives the complete CLI subprocess test without starting a real or billable agent.
- [x] Existing commands and tests remain green.
