# 03: Resolve Worker findings with retry or continue

**What to build:** When `implement` returns a completed candidate with unresolved findings from its internal `code-review`, stop the Ticket queue and show those findings. Let the user either retry the same ticket with a fresh `implement` Worker that receives the prior findings, or continue with the candidate despite the findings. Both successful decisions rejoin the ordinary validation-and-advance path and automatically run the remaining tickets.

**Blocked by:** 02: Drain a clean Ticket queue with validation.

**Status:** ready-for-agent

- [ ] Findings from the structured Worker result block the current ticket and prevent later Worker launches; the Orchestrator neither interprets the findings nor launches `code-review` itself.
- [ ] Retry preserves the same Workflow run, immutable ticket scope, and queue position; it launches one fresh `implement` Worker with the prior findings as feedback.
- [ ] A clean retry followed by passing configured validation accepts the ticket and automatically drains the remaining queue in the same invocation.
- [ ] Findings returned again after retry block again; no automatic repair loop or revision counter is introduced.
- [ ] Continue accepts the user's review judgement but still validates the existing candidate before acceptance and advancement. Failed validation leaves the queue stopped.
- [ ] Public fake-Herdr scenarios prove stop, retry, continue, and absence of separate Reviewer or Fixer executions.

## Comments
