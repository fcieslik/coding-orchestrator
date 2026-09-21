# Phase 13 — Worker launch reliability

**Status:** ready-for-agent

## Goal

Make Worker startup failures diagnosable and safe at the existing launch
boundary. Cover Git run-branch/ref creation failures and Claude Code processes
that exit immediately after startup.

## Scope

- Preserve the existing Git, Execution, Herdr, retry, cleanup, and recovery
  semantics.
- Report actionable Git ref-creation failures without deleting or repairing
  user-owned Git metadata automatically.
- Record bounded Claude Code startup diagnostics when the process disappears
  before prompt delivery or settlement.
- Keep native Claude Code configuration, authentication, skills, and trust
  outside the Orchestrator.
- Add deterministic tests at the existing temporary-Git and fake-Herdr seams.

## Out of scope

- Automatic permission changes, lock deletion, ref deletion, or process
  termination.
- A new Worker protocol, persistence store, agent runtime, or provider
  configuration system.
- Live model execution in ordinary CI.

