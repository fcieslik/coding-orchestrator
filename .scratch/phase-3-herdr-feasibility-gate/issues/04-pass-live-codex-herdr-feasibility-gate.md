# 04: Pass the live Codex Herdr feasibility gate

**What to build:** Validate the complete adapter against the installed Herdr runtime from a real managed caller pane, make only compatibility corrections revealed by that run, and record the verified command contract that allows Phase 4 to proceed.

**Blocked by:** 03 — Add operator diagnostics and controlled pane retention.

**Status:** blocked

- [ ] Work begins from a genuine Herdr-managed Codex session with the managed-environment marker and caller workspace, tab, and pane context available; manually exporting the marker is not accepted.
- [x] The installed Herdr binary's current help is inspected for every command used by the adapter before the live smoke runs.
- [ ] The exact structured responses for version discovery, sibling-pane creation, Codex startup, prompt/wait, output read, lifecycle inspection, collision behavior where safely observable, and pane close are compared with the adapter's capability contract.
- [ ] Any compatibility correction remains confined to Herdr transport and parsing; it does not introduce worker, reviewer, ticket, result-artifact, or workflow-completion semantics.
- [x] The deterministic fake-executable suite passes before a real Codex is launched.
- [ ] The live smoke uses the project repository as its explicit absolute cwd and preserves focus in the caller pane.
- [ ] Exactly one owned sibling pane is created and one uniquely named fresh Codex is detected in that pane.
- [ ] The live Codex receives the nonce-bearing multiline opaque challenge with literal `$implement` without invoking the skill.
- [ ] Readable output contains the current nonce and the expected working directory, proving meaningful delivery rather than relying only on lifecycle settlement.
- [ ] The live execution reaches a settled Herdr lifecycle observation, which is reported only as transport evidence.
- [ ] Default cleanup closes exactly the owned pane and leaves the caller pane, other agents, tabs, workspaces, session, and server untouched.
- [ ] The final report is passing only when environment, cwd, creation, startup, prompt delivery, settlement, output checks, and cleanup all succeed.
- [ ] The observed Herdr version and verification date are recorded in project documentation without committing environment-specific prompts, terminal transcripts, or credentials.
- [ ] Stale Herdr examples are corrected to match verified pane creation, agent startup, prompt, wait/read, naming, and cleanup behavior while preserving the capability-based compatibility policy.
- [ ] The roadmap and handoff state clearly that deterministic tests plus this successful live result close the Herdr feasibility gate.
- [x] If the live run blocks, becomes unknown, times out, disappears, mismatches its challenge, or fails cleanup, Phase 3 remains incomplete and the report identifies the smallest next diagnostic action.
- [ ] After any compatibility changes, the complete test, schema drift, typecheck, lint, format, build, executable help, simulated smoke, and default-cleanup live smoke checks all pass.

## Verification record

Preflight on 2026-09-04 observed installed Herdr version `0.8.2`. The binary's top-level help and the `agent`, `pane`, `agent start`, `agent prompt`, `agent wait`, `agent read`, `agent list`, `agent get`, `pane split`, and `pane close` help requests were inspected. Herdr 0.8.2 falls back to the top-level help for nested `--help`; the adapter's command contract remains the capability-based contract documented by the adapter and Herdr skill:

- `herdr --version`
- `herdr pane split --pane <caller-pane> --direction right --cwd <absolute-repository-path> --no-focus`
- `herdr agent start <unique-name> --kind codex --pane <owned-pane> --timeout 30000`
- `herdr agent prompt <unique-name> <opaque-multiline-prompt> --wait --timeout 120000`
- `herdr agent read <unique-name> --source recent-unwrapped --lines 120`
- `herdr pane close <owned-pane>`

The fake-executable Herdr suite passed 15/15 tests before any live-agent attempt. This execution was not itself inside Herdr: `HERDR_ENV=1` and the caller pane context were unavailable. No marker was exported manually and no live pane or agent was created. Phase 3 therefore remains incomplete.

Smallest next diagnostic action: rerun `flow herdr smoke --agent codex --json` from an existing Herdr-managed Codex caller pane, with the repository as its explicit absolute working directory, then inspect the returned report for the first failing capability before changing transport code.

No compatibility correction was made because no live transport response was available to justify one.

## Comments

- 2026-09-04: Live gate blocked before execution because the current caller lacks genuine Herdr-managed context. Deterministic coverage is green; do not treat this preflight as a passing feasibility gate.
