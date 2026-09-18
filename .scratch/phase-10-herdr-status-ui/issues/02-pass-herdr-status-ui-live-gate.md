# 02: Pass the Herdr status UI live gate

**What to build:** Prove the Phase 10 status UI in a real Herdr session against a disposable Target repository and Workflow run. The user must be able to open the status panel, observe implementation progress and final state, see the corresponding sidebar summary, and close the panel without changing workflow evidence.

**Blocked by:** 01/Build the read-only Herdr workflow status UI

**Status:** ready-for-agent

- [ ] The development build and all automated quality gates pass before the live test begins.
- [ ] The plugin is linked from the development checkout through Herdr's standard local plugin workflow and appears enabled without manifest warnings.
- [ ] A disposable Target repository contains a prepared Workflow package with one minimal ticket and a clean committed baseline.
- [ ] Opening the plugin from that repository requires no manually supplied repository or run path.
- [ ] Before ticket execution, the panel correctly shows the prepared run or clear no-run state expected by the workflow lifecycle.
- [ ] During a real delegated ticket execution, the panel shows the correct Workflow package, active ticket, implementation phase, and progress without interfering with the Worker.
- [ ] While the panel is active, the configured Herdr sidebar displays the compact package, ticket, step, and progress metadata.
- [ ] After Worker completion, reopening or refreshing the panel shows the accepted ticket, implementation completion, and the correct next workflow action.
- [ ] One blocked or diagnostic fixture demonstrates a concise failure reason without requiring the user to read raw JSON in the ordinary path.
- [ ] Closing the panel removes or allows its TTL-bound sidebar metadata to expire and does not close unrelated panes or agents.
- [ ] Comparing durable workflow evidence and Git state before and after status inspection proves that the plugin performed no workflow mutation.
- [ ] The live-test result, tested Herdr version, commands used, observed limitations, and GO/NO-GO decision are recorded in the Phase 10 documentation.
- [ ] Phase 10 is marked complete only when split-pane rendering, refresh, sidebar metadata, clean shutdown, and read-only behavior all pass in real Herdr.

## Handoff

### Done in implementation

- The status plugin remains read-only and uses the public `flow status --json` contract.
- `src/herdr.ts` retries `agent start` only for Herdr's transient `agent_not_ready` response, within the existing startup timeout.
- `status.mjs` accepts Herdr 0.8.2's flat `HERDR_PLUGIN_CONTEXT_JSON` fields (`workspace_cwd` and `focused_pane_cwd`) and retains a safe cwd fallback when JSON context is absent.
- The manifest entrypoint resolves `status.mjs` through `HERDR_PLUGIN_ROOT`, so the plugin also starts when Herdr sets the Target pane cwd.
- Regression coverage was added in `tests/herdr.test.ts` and `tests/herdr-status-ui.test.ts`.
- The plugin was linked locally and observed enabled on Herdr `0.8.2` without manifest warnings.

### Observed live evidence

- Disposable Target repository: `/private/tmp/coding-orchestrator-status-live-vGLgIX`.
- Workflow run: `run_20260916T092049Z_82de10f9b20d`.
- After the startup-race correction, the real Codex Worker accepted ticket `01-record-signal`; the run reached `completed` and the Target `master` checkout stayed clean at baseline `064dd2e205c9e28b06e1d66dc3337ee13ef71567`.
- The rendered status board showed package, run, completed phase, `1/1` progress, accepted ticket, validation, delivery, and the read-only close hint.
- Herdr accepted repeated workspace metadata reports at approximately one-second intervals; after closing the panel, reporting stopped and the TTL window elapsed.
- An initial attempt exposed two Herdr 0.8.2 compatibility issues: immediate `agent_not_ready` after pane creation and the flat plugin-context shape. Both are covered by the implementation changes above.
- In the `herdr-testing/phase10-status-live-20260916` Target, the user completed ticket `01-record-status-test-marker` in run `run_20260916T101059Z_ab74b1cf9b6b`. A separate split status pane then displayed that run, `completed`, `1/1` accepted, and validation not run. Status inspection left revision `14` and the Target Git checkout unchanged.
- The first screen capture showed only the Worker because `flow orchestrate` does not open the status plugin. The owner clarified that the status view should remain visible in a separate pane; the manifest default and usage documentation now specify `split`.

### Still to do before formal closure

- The owner should repeat/confirm the live split pane, sidebar, refresh, close, and read-only checks in the intended session and record the final GO/NO-GO decision.
- The active-ticket transition was missed in the second live attempt because the status pane was opened after the Worker finished; repeat that observation with the pane open before starting a new ticket.
- The checklist above and the Phase 10 documentation still need formal completion; Phase 10 must remain incomplete until that confirmation is recorded.
- The final full test suite, final commit, and any remaining documentation update were intentionally not performed in this handoff.
