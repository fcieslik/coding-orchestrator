# Run recovery for the Orchestrator

This is the operator contract for a run that is stuck, has an active ticket that never finished, or cannot be resumed normally.

Recovery is for the Orchestrator or another main agent. A Worker may publish a result and diagnostics, but must not change run state, mark a ticket accepted, cancel a run, edit `state.json`, edit `history.jsonl`, or delete a run.

## The three actions

The intended small CLI surface is one command with mutually exclusive actions:

```text
flow run repair --run <id> --reconcile [--json]
flow run repair --run <id> --accept --commit <sha> [--json]
flow run repair --run <id> --cancel --reason "<reason>" [--json]
```

`run repair` is the operator contract; implementation must reuse existing run locks, `inspectRun`, execution reconciliation, and checkpoint validation. It must not expose arbitrary field updates.

### `--reconcile`

Use this first when the Worker did not start, disappeared, timed out, or left an ambiguous result.

It inspects the execution record and result, Git HEAD/cleanliness, Feature worktree, and known Herdr identity. It may close an unambiguous interrupted attempt or repair the known one-revision audit gap. It must report evidence and stop when the Worker is still alive, the worktree is dirty, a result conflicts with Git, cleanup failed, or the run is otherwise ambiguous. It must not automatically kill a live Worker or accept a ticket.

### `--accept --commit <sha>`

Use this only when the intended ticket is complete and a specific commit is known.

The existing checkpoint validation must prove the run's Feature worktree is ready, the commit is a valid descendant of the run checkpoint, and all normal worktree/checkpoint invariants hold. The integration branch's current HEAD alone is not proof.

On success, the selected ticket becomes `accepted`. If it is the final ticket, the run becomes `completed`; otherwise the next ticket remains `pending` and the run returns to `implementing`. Repeating the same accepted action is a no-op.

### `--cancel --reason "..."`

Use this when no safe commit exists or the run cannot be made consistent.

Cancellation records the reason, preserves the run history, worktree, branch, and artifacts, and makes the run terminal. It does not delete anything and does not silently retry the ticket. A new run or explicit retry is a separate operator decision.

## Decision table

| Observation | Action | Result |
| --- | --- | --- |
| Worker is still alive | Do not repair automatically | Report the live execution; require an explicit operator decision |
| Worker is gone, no result, clean worktree at baseline | `--reconcile`, then retry through the normal bounded retry path | Safe retry may become available |
| Valid result and matching commit exist | `--reconcile`, then `--accept --commit <sha>` | Ticket is accepted after checkpoint validation |
| Commit exists but worktree/checkpoint evidence is ambiguous | No accept | Preserve evidence; cancel or investigate manually |
| No safe commit and no continuation path | `--cancel --reason ...` | Run is terminal and auditable |
| `state.json`/`history.jsonl` has a larger or ambiguous inconsistency | No direct file edit | Fail closed; preserve the run and decide on a new run |

## Invariants

- Never delete an active or blocked run to repair its status.
- Never edit `state.json` or `history.jsonl` by hand.
- Never infer success from a Worker message, a pane disappearing, or `main` merely containing a related change.
- Never kill a live Worker as an implicit part of reconciliation.
- Preserve the original run and artifacts until a terminal state and the desired Git delivery are safely established.

The recovery implementation is complete only when these decisions are covered by focused tests for evidence inspection, checkpoint acceptance, cancellation, idempotency, live-worker refusal, and fail-closed corruption handling.
