---
name: orchestrate
description: Coordinate a durable coding workflow from an approved specification.
---

# Orchestrate

Coordinate the durable workflow. Do not normally implement project code directly.

## Operator interface

For one explicit Phase 5 Workflow step, accept the prepared package and exact
ticket ID directly:

```text
$orchestrate <workflow-package> <ticket-id>
```

Infer the Target repository from the current working directory unless the user explicitly provides another repository. The user does not need to provide a Run ID, helper path, Herdr instructions, permission flags, or wait/read/cleanup instructions.

Resolve the bundled `scripts/flow` relative to this installed skill and invoke its `orchestrate <workflow-package> <ticket-id>` operation. It performs repository setup, creates or resumes the matching Workflow run, selects the immutable run-owned Ticket snapshot, and executes at most that one ticket. If no matching run exists, selection is ambiguous, the requested ticket is not the first pending entry, or durable evidence is unsafe, stop and report the smallest required operator action instead of guessing.

Treat `flow orchestrate` as a long-running foreground operation. Invoke it once and retain ownership of that same process until it exits. If the execution tool yields a session or cell handle, continue polling that exact handle; a yield, empty output, or temporarily missing result artifact does not prove that the process ended. Never invoke the same Workflow step again to poll its progress. If the helper reports `WORKFLOW_STEP_IN_PROGRESS`, do not retry it. Begin reconciliation only after independently confirming that the process which owned the execution has ended.

Repeat an accepted ticket only as an idempotent no-op. Repeat the same blocked ticket only as an explicit resume request; never retry it autonomously, and never retry when reconciliation finds an unaccepted commit, dirty worktree, ambiguous artifacts, unsafe cleanup, or an exhausted attempt budget. A changed specification or ticket requires a new Workflow package and explicit new run. Do not implement the ticket in the Orchestrator context. Do not add unrestricted-access arguments; Worker permissions are owned by repository configuration and the agent adapter. Prompt settlement, result ingestion, checkpoint validation, retry reconciliation, and owned-pane cleanup are handled by the deterministic helper and must not be reimplemented in conversational instructions.

If a Worker returns `completed` with `review.status = attention`, report the candidate commit and every bounded finding with its smallest required decision. The run is durably blocked with Review attention, the ticket remains active and later tickets remain unavailable; do not treat the candidate as an accepted checkpoint. The original Worker pane is closed and is never reopened. A clean review or a legacy completed result without `review` follows the existing acceptance path. Findings do not create tickets or plans; a scope-expanding concern requires separate work prepared by the user.

When the user supplies an explicit resolution for that attention, pass it with the
same natural-language `$orchestrate` request as `--resolution <decision>` to the
bundled helper. The helper revalidates the candidate and launches exactly one
fresh bounded Fixer in the existing Feature worktree. The Fixer must preserve the
candidate commit, create a separate correction commit, and publish structured
evidence. A valid correction is accepted only after independent Git validation;
blocked, failed, malformed, or drifted Fixer evidence remains durable and never
starts a second Fixer.

## Package validation

When the user asks to validate a completed Workflow package, invoke the deterministic helper operation once:

```text
flow validate <workflow-package> [--repo <path>] [--json]
```

The helper resolves the single completed Workflow run that owns the package, verifies that every ticket is accepted and the Feature worktree is clean at the final accepted Git checkpoint, runs the repository-configured `test`, `lint`, `typecheck`, `formatCheck`, and `build` commands sequentially in the Feature worktree, and durably records one validation result for the exact validated HEAD. Exit status zero means validation passed; any refusal, failed check, timeout, or Git mutation is reported by the helper and returns non-zero.

In this mode do not launch a coding agent, open a Herdr pane, or run project commands yourself: the configured checks belong to the helper. If the helper refuses (no matching completed run, ambiguous runs, incomplete Ticket queue, unavailable or dirty Feature worktree, missing validation configuration), stop and report the smallest required operator action instead of attempting recovery. A failed validation is rerun by invoking the same operation again after the user has fixed the code or project environment; never retry automatically.

## Final local integration

When the user explicitly asks to validate and integrate a completed Workflow run locally, invoke the deterministic helper once:

```text
flow integrate <workflow-package> [--repo <path>] [--json]
```

It resolves exactly one completed run from the Workflow package, reuses a passing validation for the exact Feature HEAD when available, otherwise runs the configured five-check validation, and then fast-forwards the saved Integration target branch only when the primary checkout and Feature worktree satisfy the durable Git preflight. It never creates a merge commit, switches branches, rebases, resets, force-updates, or removes the Feature branch/worktree.

The helper persists local Delivery intent before the fast-forward and reconciles an interrupted operation from Git facts. A completed repeat returns the same Delivery result without another mutation; a moved, dirty, divergent, or ambiguous target is refused or recorded as blocked without guessing. Do not pass a Run ID or reproduce this protocol conversationally.

For natural requests such as “validate and integrate locally”, select this local operation explicitly. If the user requests final validation without choosing local integration or Pull Request preparation, ask once which Delivery channel they want instead of inferring one.

## GitHub Pull Request handoff

When the user explicitly asks to “validate and prepare a PR” (or an equivalent unambiguous request), invoke the deterministic helper once:

```text
flow pr <workflow-package> [--repo <path>] [--json]
```

It resolves the same one completed Workflow run as local delivery, reuses or performs deterministic validation for the exact Feature HEAD, then performs its own read-only GitHub preflight before recording GitHub Delivery intent. It can make only an ordinary push of the existing Feature branch to `origin`, look up or create one Pull Request against the saved Integration target branch, and read checks once. It never force-pushes, rebases, merges a Pull Request, changes branches, or removes Feature resources.

The helper persists intent before its first external mutation and reconciles repeats from remote branch and Pull Request facts. Report its URL, delivered commit, and checks observation; a pending or failed checks observation still means the PR handoff is complete. Do not reproduce the GitHub procedure conversationally or invoke `gh` directly.

## Downstream engineering skills

Compose existing engineering skills instead of recreating their methodology.

- Dispatch the assigned implementation ticket through the configured `implement` skill.
- For a Phase 5 Worker, provide the run-owned immutable specification snapshot as read-only feature context; the assigned ticket remains the only implementation scope.
- Add only orchestration context: ticket/spec references, worktree and run identity, artifact paths, commit/checkpoint requirements, scope restrictions, and blocker/failure protocol. Do not list other tickets or provide internal Orchestrator documentation.
- Repository instructions and engineering documentation are discovered in the target worktree by the downstream skill (for example via `AGENTS.md`); their absence does not block the workflow.
- Review, command checks, and other Phase 6 validation stages are outside this Workflow step.

Worker and reviewer prompts are skill-aware wrappers, not standalone engineering methodologies. Do not restate or replace methodology owned by downstream skills.

## Invocation boundary

Agent-specific skill syntax belongs to the agent renderer, not workflow semantics. For Codex, render a logical skill name as `$skill-name`; state and workflow logic retain the logical name only.

Herdr transports an already-rendered prompt unchanged. It launches, prompts, waits for, reads, and closes agent processes without constructing or interpreting skill, ticket, review, or result semantics.
