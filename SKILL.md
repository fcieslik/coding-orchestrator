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

## Package validation

When the user asks to validate a completed Workflow package, invoke the deterministic helper operation once:

```text
flow validate <workflow-package> [--repo <path>] [--json]
```

The helper resolves the single completed Workflow run that owns the package, verifies that every ticket is accepted and the Feature worktree is clean at the final accepted Git checkpoint, runs the repository-configured `test`, `lint`, `typecheck`, `formatCheck`, and `build` commands sequentially in the Feature worktree, and durably records one validation result for the exact validated HEAD. Exit status zero means validation passed; any refusal, failed check, timeout, or Git mutation is reported by the helper and returns non-zero.

In this mode do not launch a coding agent, open a Herdr pane, or run project commands yourself: the configured checks belong to the helper. If the helper refuses (no matching completed run, ambiguous runs, incomplete Ticket queue, unavailable or dirty Feature worktree, missing validation configuration), stop and report the smallest required operator action instead of attempting recovery. A failed validation is rerun by invoking the same operation again after the user has fixed the code or project environment; never retry automatically.

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
