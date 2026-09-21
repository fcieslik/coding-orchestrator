# 06: Pass the automatic Ticket queue gate

**What to build:** Prove the final minimal software-factory flow end to end: one package invocation runs sequential fresh Workers through Herdr, applies Target repository validation before each acceptance, stops on findings or failed checks, and safely resumes after a user decision or process restart.

**Blocked by:** 05: Make the automatic Ticket queue the normal flow.

**Status:** ready-for-agent

- [ ] Public fake-Herdr coverage passes for ordered multi-ticket success, findings stop, retry, continue, validation failure, and restart without duplicate work.
- [ ] The suite verifies behavior at the public command seam, including linear Git ancestry, one shared Feature worktree, unchanged primary checkout, durable queue progress, and no independent Reviewer or Fixer launches.
- [ ] Relevant tests, typecheck, lint, format verification, schema-drift check, build, and Installed skill checks pass.
- [ ] An explicit disposable live gate inside Herdr runs at least two real fresh Workers sequentially and demonstrates automatic queue advancement without manual per-ticket invocation.
- [ ] Live evidence and any skipped gate are recorded accurately; no real-agent gate is silently added to the default automated suite.

## Comments
