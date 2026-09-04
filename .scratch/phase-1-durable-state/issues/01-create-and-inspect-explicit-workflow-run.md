# 01: Create and inspect an explicit Workflow run

**What to build:** Let a user create the first durable Workflow run by explicitly naming a Target repository, Specification reference, and run ID, then inspect its authoritative State snapshot and initial Operational history in human-readable or structured form. This slice establishes the complete public happy path and versioned data contracts without yet adding implicit selection or the full persistence-hardening matrix.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] `flow run create` accepts an explicit Target repository, Specification reference, and valid caller-supplied run ID.
- [ ] Creation rejects a non-Git or bare Target repository and a missing, non-file, or repository-external specification with the agreed categorized error behavior.
- [ ] A successful creation produces a complete run containing a versioned State snapshot and required Operational history.
- [ ] The initial snapshot records the run ID, revision 1, `created` phase, normalized Specification reference, and UTC creation/update timestamps.
- [ ] The initial history contains exactly one valid `run.created` event at sequence 1 and state revision 1.
- [ ] `flow status --run` displays the explicitly selected run in concise human-readable form.
- [ ] `flow status --run --json` returns the snapshot plus history synchronization metadata as a valid JSON document.
- [ ] `flow history --run` displays the initial event as one chronological human-readable entry.
- [ ] `flow history --run --json` returns an array containing the exact initial event envelope.
- [ ] Runtime Zod schemas validate snapshots and Run events while preserving additive unknown object properties.
- [ ] Deterministic JSON Schemas for snapshots and Run events are generated, committed, included by the build, and checked for drift.
- [ ] Executable subprocess tests prove the complete explicit create/status/history path in a temporary Git repository.
- [ ] Existing help, version, installer, typecheck, lint, format, test, and build behavior remains green.

