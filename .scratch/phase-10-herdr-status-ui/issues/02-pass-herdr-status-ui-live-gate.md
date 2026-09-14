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
- [ ] Phase 10 is marked complete only when popup rendering, refresh, sidebar metadata, clean shutdown, and read-only behavior all pass in real Herdr.
