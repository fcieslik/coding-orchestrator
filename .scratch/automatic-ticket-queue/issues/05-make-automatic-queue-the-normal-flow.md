# 05: Make the automatic Ticket queue the normal flow

**What to build:** Present the automatic queue as the normal Workflow package interface and retire the superseded one-ticket-at-a-time and fresh-Fixer paths from that normal flow. A user starts or resumes a package, sees the current ticket and blocking reason when stopped, and uses only retry or continue for Worker findings. Keep proven low-level Herdr, Worker, Git, validation, and recovery behavior intact.

**Blocked by:** 03: Resolve Worker findings with retry or continue; 04: Resume the Ticket queue without duplicate work.

**Status:** ready-for-agent

- [ ] The normal skill and public command start or resume a Workflow package without requiring an exact ticket ID on each successful step.
- [ ] Human and structured output identify completion or the current blocked ticket with its actionable cause, without exposing pane IDs as routine inputs.
- [ ] The normal findings path offers retry or continue and does not invoke the old fresh-Fixer resolution path.
- [ ] Superseded normal-flow entry points and state/configuration concepts are removed only where no remaining caller needs them; existing safety and diagnostic evidence remain intact.
- [ ] Project documentation and domain terminology describe the automatic Ticket queue and `implement`-owned review consistently, without a separate Orchestrator review stage.
- [ ] Public command and Installed skill tests prove the simplified interface while existing supported behavior remains green where retained.

## Comments
