# 02: Drain a clean Ticket queue with validation

**What to build:** One public invocation of a Workflow package runs its fixed, filename-ordered Ticket queue to completion. For each ticket, the Orchestrator launches one fresh `implement` Worker through Herdr in the shared Feature worktree, validates a clean candidate using Target repository configuration, accepts its Git checkpoint, and immediately advances to the next ticket. A failed check stops on the current ticket.

**Blocked by:** 01: Separate Worker candidate from ticket acceptance.

**Status:** ready-for-agent

- [ ] One invocation executes multiple tickets in filename order without requiring the user to name each ticket.
- [ ] Each ticket uses a fresh Worker; no separate Reviewer, Fixer, or Reporter is launched.
- [ ] Configured deterministic checks run against each clean candidate before that ticket is accepted; a check failure prevents later Worker launches.
- [ ] Every accepted ticket has a reconciled Git checkpoint, and each later Worker starts from the previous accepted commit in the same Feature worktree.
- [ ] Queue progress is published durably before the next Worker starts; the final accepted ticket completes the Workflow run.
- [ ] A public fake-Herdr test proves the multi-ticket happy path and validation-failure stop without inspecting the loop implementation.

## Comments
