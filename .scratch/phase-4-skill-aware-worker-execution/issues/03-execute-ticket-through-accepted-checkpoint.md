# 03: Execute one ticket through an accepted checkpoint

**What to build:** Deliver the first complete Worker vertical slice. An explicit local Markdown ticket for an existing run in `implementing` becomes an immutable Worker attempt, a controlled fake worker commits an implementation and publishes a completed result, and the Orchestrator cleans up and accepts the attempt with its Git checkpoint only after all independent evidence agrees.

**Blocked by:** 02: Render and launch an isolated skill-aware worker.

**Status:** completed

- [x] `flow worker execute` requires an explicit Workflow run and ticket, supports established Target repository selection, and offers equivalent human and structured output.
- [x] Execution requires a run in `implementing` with a ready Feature worktree; `created`, `preparing`, blocked, and terminal runs fail with actionable guidance.
- [x] The assigned ticket must be a nonsymlinked regular Markdown file inside the Target repository, and its canonical ID is derived from its filename.
- [x] Before launch, the Orchestrator creates a never-reused attempt, copies and hashes an immutable Ticket input snapshot, and durably claims the Active execution.
- [x] Attempt storage separates Orchestrator-owned input and Execution record data from the worker-writable output area.
- [x] The versioned Execution record captures execution identity, logical invocation, source and prompt hashes, artifact references, timestamps, worktree, Herdr ownership, lifecycle, timings, cleanup, and bounded diagnostics.
- [x] State snapshot version 1 gains only compatible active/last execution references; no ticket graph or ticket map is introduced.
- [x] Operational history records semantic prepared, started, and accepted milestones without copying raw transport observations.
- [x] The completed Worker result is atomically published, nonsymlinked, schema-valid, tied to the assigned ticket, and contains the full canonical current commit plus structured command outcomes.
- [x] One or more commits after the previous checkpoint are accepted, but the reported commit, Feature branch, and Feature worktree HEAD must identify the same current commit.
- [x] Existing checkpoint logic exposes nonmutating inspection before final acceptance while preserving the established public Phase 2 checkpoint behavior.
- [x] Finalization performs nonmutating evidence inspection, bounded diagnostic read, owned-pane cleanup, locked evidence reload, and one acceptance decision for the Worker attempt and Git checkpoint.
- [x] A public fake-Herdr end-to-end test proves ticket snapshot, rendered prompt, real temporary Git mutation, commit, result publication, cleanup, State snapshot, Operational history, and checkpoint acceptance.
- [ ] After the deterministic happy path passes, an explicit early live probe in a disposable repository proves real Herdr plus fresh Codex plus global `$implement`, including sandboxed commit and isolated result publication.
