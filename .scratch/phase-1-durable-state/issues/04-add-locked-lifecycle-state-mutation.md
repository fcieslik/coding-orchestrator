# 04: Add locked lifecycle state mutation

**What to build:** Provide the internal durable mutation contract that later workflow commands can safely use. The Orchestrator can calculate a legal Run phase transition, publish its new authoritative snapshot, append the corresponding Run event, and reject concurrent or inconsistent mutation without exposing a generic transition command to users.

**Blocked by:** 03: Harden repo-local persistence and validation.

**Status:** completed

- [x] One pure transition function owns all Run phase legality and has no filesystem, clock, identifier, or revision side effects.
- [x] The normal graph supports creation through preparation, implementation, review, checking, and completion.
- [x] Review and check failure enter fixing; fixer completion returns to the recorded reviewing or checking phase.
- [x] Any nonterminal phase may become blocked, failed, or cancelled.
- [x] Blocking records the interrupted phase, including when fixing, and resuming restores that phase without losing the fix return target.
- [x] Completed, failed, and cancelled phases reject every outgoing event.
- [x] Invalid transitions return a typed error containing the current phase and attempted event.
- [x] Exhaustive tests cover every valid edge, every invalid edge, continuation cleanup, nested block/fix behavior, and terminal phases.
- [x] A successful durable mutation increments the snapshot revision exactly once and emits one event with the next contiguous sequence and matching state revision.
- [x] Persisted event timestamps and snapshot update times are clamped against the prior persisted time; ordering continues to rely on sequence and revision.
- [x] Mutation publishes the authoritative snapshot before its paired history update, consistent with ADR 0001.
- [x] A one-revision audit lag remains readable but refuses every later mutation until recovery reconciles it.
- [x] Mutation uses an exclusively acquired run-level lock containing process ID, hostname, acquisition time, and a random owner token.
- [x] A held lock fails immediately with exit category 5 and exposes safe owner details for diagnosis.
- [x] Lock release succeeds only for the matching owner token; locks are never automatically broken or removed by another owner.
- [x] The lock spans persisted-data validation, transition calculation, snapshot publication, and history publication, and is released after handled success or failure.
- [x] Status and history remain readable without acquiring the mutation lock and show only completely published data.
- [x] Injected failures before and after snapshot/history publication prove the documented old/new visibility and detectable audit-gap behavior.
- [x] One real concurrent subprocess test proves that a second mutation owner is refused while the first holds the lock.
- [x] No public generic transition command is added; later domain-specific commands consume this internal contract.
- [x] The full test, schema drift, typecheck, lint, format, build, and CLI smoke-test suite passes.
