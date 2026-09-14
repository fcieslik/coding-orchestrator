# 02: Publish a validated run as an idempotent GitHub Pull Request

**What to build:** Add the optional GitHub Delivery channel behind the natural `$orchestrate` request to prepare a Pull Request. The deterministic helper performs preflight, publishes the existing Feature branch without force, creates or reuses exactly one Pull Request, reads checks once, and persists enough evidence to resume without duplicate pushes or PRs. It never merges, rebases, installs tools, or removes local work.

**Blocked by:** 01: Safely deliver a validated run to its local Integration target.

**Status:** completed

- [x] The State snapshot accepts a GitHub Pull Request Delivery result using the shared `prepared`, `completed`, and `blocked` lifecycle.
- [x] The result records validated HEAD, Integration target branch, remote Feature branch, Pull Request identity and URL, observed Pull Request state, and normalized checks status.
- [x] The public Pull Request operation resolves the same unambiguous completed and validated Workflow run policy as local integration.
- [x] Read-only preflight verifies `origin`, required GitHub tooling and authentication before persisting the channel or pushing.
- [x] Missing remote, unavailable tools, or failed authentication stops with the smallest operator action, no selected channel, and no mutation.
- [x] The explicit natural request to prepare a Pull Request authorizes only ordinary push, PR lookup or creation, and one checks read.
- [x] The deterministic helper owns Git and GitHub commands; the conversational Orchestrator only selects the operation and reports its result.
- [x] The helper uses only the official authenticated `gh` CLI for GitHub operations.
- [x] The helper never installs, upgrades, authenticates, or configures `gh`, credentials, or remotes.
- [x] Publication uses only `origin`, the existing Feature branch name as head, and the saved Integration target branch as Pull Request base.
- [x] A missing remote Feature branch is created by an ordinary push, an exact matching remote commit is reused, and any conflicting remote commit blocks without force-push.
- [x] An advanced remote base is allowed and clearly distinguished from the Run base; no automatic rebase is attempted.
- [x] Pull Request lookup uses exact head/base identity before creation.
- [x] One matching open Pull Request is reused, one merged match completes with an explicit external-merge observation, and a closed-unmerged or ambiguous set of matches blocks.
- [x] Pull Request title and body are deterministic and derived only from durable run inputs, with a specification-title fallback to the Workflow package name.
- [x] Pull Request content includes concise run, specification, accepted-ticket, validated-HEAD, and validation-outcome references without full specifications, tickets, prompts, transcripts, or Worker output.
- [x] Checks are read once and normalized to `passed`, `failed`, `pending`, or `unavailable`; no polling, interpretation, automatic fix, or merge occurs.
- [x] An existing Pull Request completes handoff even when checks are pending or failed, while the checks observation remains separately and prominently reported.
- [x] The GitHub Delivery channel is persisted as `prepared` under the existing Workflow run lock immediately before the first external mutation.
- [x] Reconciliation after interruption following push or PR creation observes remote facts and continues only missing idempotent steps without duplicate push or Pull Request.
- [x] Ambiguous post-mutation evidence records a blocked Delivery result and never deletes or rewrites remote state.
- [x] Repeating a completed Pull Request handoff returns the same durable identity; changing to local delivery after GitHub intent is persisted is rejected.
- [x] Feature branch and Feature worktree remain present and unchanged after GitHub handoff.
- [x] Concise human and structured output report the PR URL, delivered commit, checks status, and whether the PR was created, reused, or externally merged.
- [x] The global Orchestrator skill maps a natural “validate and prepare PR” request to validation followed by this helper without requiring the user to know its command.
- [x] Automated tests exercise the public CLI with a controlled process-level fake `gh`, never a real GitHub account or network.
- [x] Automated tests cover preflight refusal, first push, remote idempotency/conflict, PR classification, checks normalization, fallback behavior, interruption recovery, channel conflict, and absence of force/merge/cleanup commands.
