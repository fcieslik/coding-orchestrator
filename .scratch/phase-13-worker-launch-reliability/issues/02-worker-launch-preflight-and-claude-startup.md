# 02: Harden Worker launch preflight and Claude Code startup

**What to build:** Make two live Worker launch failures diagnosable and safe: Git
must be able to create the Orchestrator run branch/ref, and a Claude Code
process that exits immediately must be reported as a failed startup rather than
as a settled Worker. Keep the fix in the existing launch path; do not add a
second agent runtime or an automatic environment repair mechanism.

**Blocked by:** 01: Run the live Worker through Claude Code

**Status:** ready-for-agent

## Acceptance criteria

- [ ] Before launching a Worker, the Orchestrator performs the existing Git
  branch/ref creation through one explicit, testable preflight boundary.
- [ ] A Git ref-creation failure reports the operation, intended run ref, and
  actionable distinction between a permissions problem, a namespace/file
  conflict, and an existing lock when Git exposes that information.
- [ ] The failure does not delete refs, lock files, branches, runs, or user
  changes, and does not retry automatically.
- [ ] A Claude Code process that exits before prompt delivery or before a
  settled lifecycle is recorded as a failed/disappeared startup using the
  existing Execution diagnostics and owned-pane cleanup.
- [ ] Claude startup diagnostics retain a bounded, redacted stderr/stdout
  tail and identify the failed operation without persisting the full prompt,
  credentials, or arbitrary command arguments.
- [ ] Missing native `implement` skill, authentication, trust, model, or CLI
  configuration is reported as an environment/configuration prerequisite; the
  Orchestrator does not install skills, change trust, inject credentials, or
  silently fall back to Codex/Pi.
- [ ] Reconciliation and explicit retry remain bounded and idempotent; an
  immediate Claude exit cannot create a duplicate Worker, duplicate commit, or
  accepted ticket.
- [ ] Deterministic tests cover writable Git success, Git ref-lock failure,
  namespace/file conflict, stale-lock reporting, Claude immediate exit with
  diagnostics, Claude successful interactive settlement, and owned-pane
  cleanup using temporary Git repositories and the existing fake Herdr seam.
- [ ] Operator-facing documentation gives the smallest next action for each
  failure and explicitly says not to delete run records or Git refs as a first
  repair step.

## Out of scope

- Automatic chmod/chown, lock deletion, ref deletion, namespace migration, or
  modification of the user's native Claude Code configuration.
- A generic Git repair subsystem, background monitor, new persistence store, or
  new Worker protocol.
- Provider login, credential management, skill installation, trust approval,
  model discovery, or automatic fallback between agents.

