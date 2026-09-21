# 04: Resume the Ticket queue without duplicate work

**What to build:** A restarted Orchestrator resumes the same durable Workflow run from its first unaccepted ticket. It preserves accepted checkpoints and reconciles an interrupted or ambiguous Active execution before deciding whether another Worker can launch. A live or uncertain Worker is never duplicated.

**Blocked by:** 02: Drain a clean Ticket queue with validation.

**Status:** ready-for-agent

- [ ] A new Orchestrator process resumes the fixed Ticket queue without rerunning accepted tickets or rediscovering new package entries.
- [ ] An Active execution is reconciled against existing Execution record, Worker result, Herdr ownership, and Git evidence before any new Worker launches.
- [ ] A proven completed candidate resumes at its remaining validation or acceptance decision; a proven safe retry may launch a fresh Worker; ambiguous or live work blocks instead of duplicating execution.
- [ ] Queue position advances only after durable checkpoint acceptance, including across process interruption.
- [ ] A public fake-Herdr restart scenario proves no duplicate Worker, no repeated accepted ticket, and safe continuation through the remaining queue.

## Comments
