# 07: Pass the complete Phase 4 exit gate

**What to build:** Prove that skill-aware Worker execution is ready to support later ticket scheduling. All deterministic quality and recovery evidence must pass first, followed by a manual live run in which the global Orchestrator launches a fresh Codex through Herdr, invokes `$implement` for one disposable ticket, and accepts the resulting commit and Worker result safely.

**Blocked by:** 06: Harden attempt ownership and crash recovery.

**Status:** completed

- [x] The complete automated test suite passes without launching a real or billable coding agent.
- [x] Type checking, linting, formatting verification, build, generated-schema drift checks, and installed-package validation pass.
- [x] Help and invalid-argument checks pass for setup, worker execute, worker reconcile, and worker retry.
- [x] The public fake-Herdr end-to-end scenario passes from repository setup through accepted Worker attempt and Git checkpoint.
- [x] Deterministic negative tests prove no false success for blockers, technical failure, malformed or missing results, wrong Git evidence, timeout, disappearance, dirty state, cleanup failure, exhausted retry, and every specified crash window.
- [x] The built development snapshot installs successfully as the global `orchestrate` skill without development-only files or unresolved runtime dependencies.
- [x] A disposable target is initialized with the repo-local orchestration contract, a Workflow run, a ready Feature worktree, and one bounded Markdown ticket.
- [x] The final live test is started explicitly by an operator inside a genuine Herdr-managed Codex Orchestrator session and is never part of normal automated tests or CI.
- [x] A fresh Codex worker appears in one owned Herdr pane with the expected Feature worktree and recognizes the installed global `$implement` skill.
- [x] The live worker implements only the assigned Ticket input snapshot, creates at least one commit on the Feature branch, and atomically publishes a valid completed Worker result in its isolated output area.
- [x] The live run proves settled transport, bounded diagnostic read, correct cwd, matching canonical HEAD, clean worktree, successful owned-pane cleanup, and atomic Worker attempt plus Git checkpoint acceptance.
- [x] The live worker does not require danger-full-access and cannot modify State snapshot, Operational history, Ticket input snapshot, or Execution record.
- [x] The final report records the observed runtime versions, run/ticket/attempt identities, validation outcome, and cleanup without persisting the full prompt or transcript.
- [x] Phase 4 is declared complete only after both deterministic evidence and the final live Codex gate pass; otherwise Phase 5 remains blocked.

Deterministic gate evidence: `pnpm test` passed 128 tests; `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, and `pnpm schema:check` passed. Public help returned exit 0 and invalid options returned exit 2 for setup and all three Worker operations. A temporary installed snapshot ran `flow --version` as 0.1.0 and contained only the allowlisted runtime directories.

Live gate evidence: operator-started run `run_20260906T213801Z_3de600df9891`, ticket `01-add-phase4-live-marker`, attempt `attempt-01`, and execution `exec_3ba3af93-169a-44f0-85c1-1cb82c127312` ran with Codex CLI 0.153.4, Herdr 0.8.2, and flow 0.1.0. The fresh Worker used the configured `implement` skill, published a schema-valid completed result, and committed `19bde2a218091a7e8a161a0e3ed57fb1e68f8b73`. Independent validation confirmed the exact marker bytes, single-file diff, commit ancestry and canonical HEAD, clean registered Feature worktree, accepted atomic checkpoint, settled `done` transport, and successful owned-pane cleanup. The Target repository remained clean and unchanged.
