# 04: Add locked lifecycle state mutation

**What to build:** Provide the internal durable mutation contract that later workflow commands can safely use. The Orchestrator can calculate a legal Run phase transition, publish its new authoritative snapshot, append the corresponding Run event, and reject concurrent or inconsistent mutation without exposing a generic transition command to users.

**Blocked by:** 03: Harden repo-local persistence and validation.

**Status:** ready-for-agent

- [ ] One pure transition function owns all Run phase legality and has no filesystem, clock, identifier, or revision side effects.
- [ ] The normal graph supports creation through preparation, implementation, review, checking, and completion.
- [ ] Review and check failure enter fixing; fixer completion returns to the recorded reviewing or checking phase.
- [ ] Any nonterminal phase may become blocked, failed, or cancelled.
- [ ] Blocking records the interrupted phase, including when fixing, and resuming restores that phase without losing the fix return target.
- [ ] Completed, failed, and cancelled phases reject every outgoing event.
- [ ] Invalid transitions return a typed error containing the current phase and attempted event.
- [ ] Exhaustive tests cover every valid edge, every invalid edge, continuation cleanup, nested block/fix behavior, and terminal phases.
- [ ] A successful durable mutation increments the snapshot revision exactly once and emits one event with the next contiguous sequence and matching state revision.
- [ ] Persisted event timestamps and snapshot update times are clamped against the prior persisted time; ordering continues to rely on sequence and revision.
- [ ] Mutation publishes the authoritative snapshot before its paired history update, consistent with ADR 0001.
- [ ] A one-revision audit lag remains readable but refuses every later mutation until recovery reconciles it.
- [ ] Mutation uses an exclusively acquired run-level lock containing process ID, hostname, acquisition time, and a random owner token.
- [ ] A held lock fails immediately with exit category 5 and exposes safe owner details for diagnosis.
- [ ] Lock release succeeds only for the matching owner token; locks are never automatically broken or removed by another owner.
- [ ] The lock spans persisted-data validation, transition calculation, snapshot publication, and history publication, and is released after handled success or failure.
- [ ] Status and history remain readable without acquiring the mutation lock and show only completely published data.
- [ ] Injected failures before and after snapshot/history publication prove the documented old/new visibility and detectable audit-gap behavior.
- [ ] One real concurrent subprocess test proves that a second mutation owner is refused while the first holds the lock.
- [ ] No public generic transition command is added; later domain-specific commands consume this internal contract.
- [ ] The full test, schema drift, typecheck, lint, format, build, and CLI smoke-test suite passes.

