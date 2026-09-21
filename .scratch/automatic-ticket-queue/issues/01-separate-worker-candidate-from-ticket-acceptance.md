# 01: Separate Worker candidate from ticket acceptance

**What to build:** Let a completed `implement` Worker return a reconciled candidate commit and its internal `code-review` outcome without immediately accepting the ticket. The existing single-ticket behavior remains usable while the later queue flow gains a point at which configured validation can run before acceptance.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A completed Worker result exposes its candidate commit and either `clean` or unresolved findings from `implement`; the Orchestrator does not launch `code-review` separately.
- [ ] The candidate is reconciled against the existing Worker result, Git, worktree, Herdr ownership, and cleanup evidence before it is eligible for acceptance.
- [ ] The automatic-queue path can leave the current ticket unaccepted after a valid candidate result, without advancing the Ticket queue.
- [ ] Existing public single-ticket behavior remains green during this preparatory change; no new report model or independent Reviewer is introduced.
- [ ] A public fake-Herdr scenario demonstrates a valid candidate that is not yet an Accepted ticket.

## Comments
