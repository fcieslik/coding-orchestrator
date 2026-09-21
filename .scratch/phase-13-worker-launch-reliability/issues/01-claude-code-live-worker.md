# 01: Run the live Worker through Claude Code

**What to build:** Execute this ticket through the repository-configured Claude
Code Worker. This is an explicit live compatibility test: the Orchestrator
must start Claude Code, not Codex and not Pi.

**Blocked by:** None

**Status:** ready-for-agent

## Required Worker profile

The Target repository must select this profile in
`.orchestrator/config.yaml`:

```yaml
agents:
  claude-worker:
    kind: claude-code

roles:
  worker:
    agent: claude-worker
    skill: implement
```

The profile may use Claude Code's native model and authentication settings.
Provider, model, trust, credentials, and skill installation are not part of
this ticket.

## Acceptance criteria

- [ ] The live Workflow run resolves the `worker` role to `claude-worker` with
  `kind: claude-code` before creating the Worker pane.
- [ ] Herdr starts the Worker with transport kind `claude`; a Codex or Pi
  process is a failed test, not an acceptable fallback.
- [ ] The Worker receives the Claude Code skill invocation `/implement` and the
  existing orchestration contract.
- [ ] Claude Code remains alive long enough to receive the prompt, completes
  the ticket, and returns the normal structured Worker result.
- [ ] The Worker creates `claude-code-live-result.txt` in the Feature worktree
  with exactly this content and a trailing newline:

  ```text
  CLAUDE_CODE_WORKER_OK
  ```

- [ ] No existing project file is modified.
- [ ] If Claude Code is unavailable, exits immediately, or cannot discover
  `/implement`, the run fails with the existing bounded startup diagnostics;
  the Orchestrator does not silently start Codex/Pi instead.
- [ ] The live test is opt-in and uses a disposable Target repository; it is
  not an ordinary CI test and does not require changes to the development
  repository.

## Out of scope

- Testing Pi or Codex in this ticket.
- Changing Claude Code authentication, trust, native configuration, or skill
  installation.
- Fixing Git ref-creation failures; that is covered by the following ticket.

