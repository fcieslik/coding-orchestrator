# 03: Pass the Phase 7 end-to-end reliability gate

**What to build:** Close V1 with complete automated gates, an Installed-skill verification, and a small local live scenario that proves the whole prepared-package workflow across a fresh Orchestrator context. Two tickets must produce ordered accepted checkpoints in one Feature worktree, final validation and local fast-forward must complete, replay must be idempotent, and a moved Integration target must be refused without destroying work. Record concise completion evidence in the project documentation.

**Blocked by:** 01: Safely deliver a validated run to its local Integration target; 02: Publish a validated run as an idempotent GitHub Pull Request.

**Status:** completed

- [x] The complete Development repository test suite, build, lint, typecheck, format check, schema check, installer tests, and Installed-skill validation pass.
- [x] Runtime schemas, generated schemas, installed assets, helper entrypoints, and operator documentation describe the same Integration target and Delivery result contracts.
- [x] The Installed skill exposes natural finalization through `$orchestrate` and contains the built local-integration and Pull Request helper operations.
- [x] A disposable real Target repository contains one approved specification and exactly two minimal ordered tickets suitable for a safe live test.
- [x] Ticket 1 is accepted through a fresh skill-aware Worker and records its Git checkpoint.
- [x] The main Orchestrator context is restarted before ticket 2.
- [x] Ticket 2 resumes the same Workflow run and Feature worktree with a fresh Worker and does not repeat ticket 1.
- [x] One natural request performs or reuses final five-check validation and locally fast-forwards the saved Integration target branch.
- [x] The live result proves the Integration target branch reaches the exact validated Feature HEAD without a merge commit.
- [x] Repeating finalization returns the same completed Delivery result without new validation commands, commits, history transitions, panes, branches, or worktrees.
- [x] Primary and Feature checkouts are clean after delivery, while the Feature branch and Feature worktree remain available.
- [x] A separate disposable negative run moves the Integration target branch after run creation and proves local delivery refuses without mutating either branch or deleting work.
- [x] The live gate inspects durable State snapshot and Operational history evidence rather than trusting only conversational success output.
- [x] The local live gate requires no GitHub remote, credentials, `gh`, or network and is sufficient to close V1.
- [x] If an optional disposable GitHub live gate is run, it proves explicit push, PR creation or reuse through official `gh`, one checks read, idempotent replay, and no automatic merge or cleanup.
- [x] Phase 7 status and detailed gate evidence are recorded using the established roadmap/spec/final-ticket convention.
- [x] Documentation states the deliberate POC limitation after code-level validation failure and keeps Fixer, repair flow, exhaustive crash testing, automatic cleanup, and deployment outside V1.

Implemented by the Phase 7 delivery work, including local integration commit `ba45b54267d835fb893fea1d93f5a5b6655036fd` and GitHub handoff commit `ca87999eebb2294aeb02475e27bf8ac6197df8a7`. The final Development repository gate passed 160 automated tests plus build, lint, typecheck, formatting, schema drift, installer, and Installed-skill snapshot checks.

Local live gate evidence (2026-09-10): package `phase7-v1-final-live` ran in `/Users/fc47/workspace/trash/herdr-testing` as run `run_20260910T200221Z_31ca2a6648d9`. Ticket `01-add-min-value` was accepted at `01c884730bd7d6806ea0ce451fae42ea3b77d9ef`; after restarting the main Orchestrator context, ticket `02-add-max-value` resumed the same run and Feature worktree and was accepted at `ad64d935a0164d1639331ca72bcf1ebde2fb4de0`. All five final checks passed for that exact HEAD, `master` fast-forwarded to it without a merge commit, both checkouts were clean, and the Feature branch/worktree remained available. Repeating the same natural finalization request preserved the original validation and Delivery timestamps and produced no new history event, commit, branch, worktree, or validation execution.

Moved-target evidence (2026-09-10): package `phase7-moved-target-live` ran as `run_20260910T202830Z_ee0bb90d618f` and accepted Feature checkpoint `6c3d7e767e19aa74a39db4f408ce2ed04afec2dc`. After `master` moved independently to `40da913df17c08a1b3444e1329105d6ba4dacc54`, validation passed for the Feature checkpoint but local integration refused before Delivery intent or Git mutation. Both branches and the Feature worktree were retained unchanged by the helper.

Optional GitHub live evidence (2026-09-10): package `phase7-github-live`, run `run_20260910T090214Z_c9aca2463008`, published validated HEAD `0700bf4a048ac94b111848de4638212d4d59ae03` through official `gh` as [PR #1](https://github.com/fcieslik/coding-orchestrator-phase7-live/pull/1). Repeating the handoff reused the same open PR without another push, PR, or history transition; checks were observed once as unavailable and no merge or cleanup occurred.
