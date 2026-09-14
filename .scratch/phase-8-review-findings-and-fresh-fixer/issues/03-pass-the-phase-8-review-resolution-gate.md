# 03: Pass the Phase 8 review-resolution gate

**What to build:** Close Phase 8 with the complete automated quality suite, an installed-skill snapshot, and one disposable live workflow proving that unresolved internal review findings survive restart and are resolved by a fresh Fixer without reopening the Worker, duplicating execution, advancing the queue early, or modifying the primary checkout.

**Blocked by:** 02: Resolve review attention with a fresh Fixer

**Status:** completed

- [x] Focused end-to-end coverage proves clean Worker completion, Review attention, explicit user resolution, fresh Fixer completion, original-ticket acceptance, and idempotent repeat through the public workflow seam.
- [x] Regression coverage proves that legacy clean Worker results retain their current behavior and that existing blocked/failed reconciliation remains fail-closed.
- [x] Tests confirm that neither findings nor user decisions automatically create a tracker ticket, plan, Workflow package entry, second Fixer, or hidden review/fix loop.
- [x] Full tests, lint, typecheck, format check, schema check, build, installer tests, and Installed-skill snapshot comparison pass.
- [x] Runtime documentation, flow documentation, roadmap status, glossary, prompt assets, schemas, and installed skill agree on Review attention, candidate commits, fresh Fixer behavior, and the one-attempt limit.
- [x] A disposable live test launches a real fresh Worker that creates a candidate commit and returns at least one unresolved decision-requiring finding.
- [x] The live test confirms that the Orchestrator reports implementation plus findings, closes the Worker pane, leaves the ticket unresolved, and refuses the next ticket.
- [x] After restarting the main Orchestrator, the same Review attention and candidate commit are recovered solely from durable state and Git evidence.
- [x] An explicit user resolution launches exactly one fresh Fixer with the bounded Fix brief; the original Worker is never resumed.
- [x] The live Fixer preserves candidate ancestry, creates a separate commit, returns a valid result, and allows the Orchestrator to accept the original ticket only after independent Git and artifact validation.
- [x] The primary checkout remains unchanged throughout Worker and Fixer execution, owned panes close safely, and repeated completion reports the same accepted result without additional agents or commits.
- [x] Final live evidence, relevant identifiers, observed limitations, and the Phase 8 completion status are recorded in this ticket and the roadmap.

## Gate evidence

- Date: 2026-09-14
- Development gates: 15 test files and 165 tests passed; build, lint, typecheck, format check, schema check, installer tests, and Installed-skill snapshot comparison passed.
- Live Target repository: `/Users/fc47/workspace/trash/herdr-testing`
- Herdr: `0.8.2`
- Workflow package: `phase8-review-live`
- Run: `run_20260914T123825Z_85a138a1a717`
- Immutable Run base and unchanged primary checkout HEAD: `690eaaf60bfb9349354d01f2261028b95c04601f`
- Candidate commit: `397da994e0702701ed4ac7db52c08827924b0e42`
- Accepted Fixer commit: `1017a95366448d44ad88397248ee93ead3f86cfc`
- The Worker returned one Spec finding for the undefined reversed-bounds policy. The Orchestrator retained ticket `01-add-clamp` as unresolved, refused `02-add-is-within-range`, and recovered the same candidate and finding after the main Orchestrator restarted.
- The explicit decision launched one fresh `fixer-attempt-01`. Its separate commit retained the Candidate commit as its parent, passed artifact and Git validation, and accepted the original ticket. Every owned pane from the failed startup, successful Worker, and successful Fixer was recorded as closed.
- Repeating the same resolution returned `Workflow step: noop`, the same accepted checkpoint, and the same next ticket without another Fixer or commit.
- The primary checkout remained clean at the Run base; the Feature worktree was clean at the accepted commit. No tracker ticket, plan, package entry, automatic second Fixer, or hidden review/fix loop was created.

## Observed limitation

The first Worker attempt settled at Codex's hook-trust review screen and produced neither a result artifact nor Git changes. A subsequent safe retry launched `attempt-02`, which produced the sole Candidate commit. This did not duplicate implementation, weaken checkpoint validation, or affect the Phase 8 attention/Fixer result, but it remains useful input for the separate Worker failure-diagnostics improvement.
