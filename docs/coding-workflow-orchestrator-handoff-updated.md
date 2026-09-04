# Coding Workflow Orchestrator — Architecture & Implementation Handoff

> **Status:** design handoff / implementation-ready architecture  
> **Date:** 2026-09-03  
> **Purpose:** this document is the durable context for building the project. A fresh LLM should be able to read this file, understand the intended system, and start implementation without needing the original conversation.

---

## 0. Executive summary

We want to build a **durable coding-workflow orchestrator implemented primarily as an agent skill plus deterministic helper tooling**.

The system is **not** a new multi-agent framework and **Herdr is not the workflow orchestrator**.

The intended model is:

- a main **Orchestrator agent** runs inside a Herdr pane;
- Herdr is the programmable terminal/multiplexer layer;
- the Orchestrator uses Herdr to create new panes, choose their working directory, launch fresh coding agents such as Claude Code, Codex, or Pi, send them prompts, wait for them, inspect output, and close panes;
- implementation work is performed by **fresh worker agent processes**, normally one fresh context per task;
- review is performed by a **fresh reviewer agent**, potentially Pi with dedicated skills/extensions;
- deterministic validation (formatting, linting, typechecking, tests, build, browser checks, screenshots, etc.) is performed by scripts, not trusted to agent self-report;
- if review or checks fail, the Orchestrator launches a **fresh fixer agent** with a bounded fix brief;
- durable workflow state lives outside the agents' conversation contexts;
- Git/worktrees, commits, structured result artifacts, state snapshots, and append-only events are the durable memory of the workflow;
- existing Matt Pocock engineering skills should remain responsible for planning/specification/implementation/review methodology where appropriate; this project fills the missing orchestration layer between those skills and repeated fresh agent sessions.

The core idea can be summarized as:

> **Agents are ephemeral. The workflow is durable. Herdr hosts and controls terminal processes. Git carries code state. Artifacts carry semantic results. The Orchestrator decides what workflow transition happens next.**

---

# 1. Problem being solved

A strong coding workflow already has several useful pieces:

- a codebase with `CONTEXT.md`, ADRs, project conventions, and other domain documentation;
- Matt Pocock-style skills for creating specs, breaking them into tickets, implementation, code review, and other engineering workflows;
- multiple capable coding agents: Claude Code, Codex, Pi, etc.;
- Herdr as the terminal workspace manager/multiplexer in which those agents run.

The missing piece is the layer that turns those components into a repeatable software-delivery workflow.

Without an orchestrator, the human has to manually:

1. read the spec/tickets;
2. remember which ticket is next;
3. create a worktree;
4. open a new Herdr pane;
5. `cd` to the correct worktree;
6. launch the desired agent;
7. give the agent the correct context;
8. notice when the agent finishes or blocks;
9. check whether the work was actually committed and usable;
10. repeat the process with a fresh agent for the next ticket;
11. launch a separate reviewer;
12. run linters/tests/build/browser checks;
13. interpret failures;
14. launch another agent to fix findings;
15. remember what happened after an orchestrator/context restart.

The project should automate that operational loop while preserving human control and keeping existing engineering skills composable.

---

# 2. Critical conceptual distinction: Herdr is infrastructure, not workflow logic

This is the most important design constraint.

## 2.1 What Herdr is

Herdr is the **terminal runtime / programmable multiplexer**.

Claude Code, Codex, Pi, shells, dev servers, test runners, and the Orchestrator itself all run **inside Herdr-managed panes**.

The Orchestrator uses Herdr as an API for terminal process management.

Conceptually Herdr provides primitives like:

```text
create/split pane
choose cwd
run command
start coding agent
send prompt
send terminal keys
read output
wait for output
wait for agent lifecycle state
close pane
```

Examples from current Herdr CLI/documentation include:

```bash
herdr pane split --current \
  --direction right \
  --cwd /path/to/worktree \
  --no-focus
```

Then, depending on desired control level:

```bash
herdr pane run <pane-id> "codex"
```

or the higher-level agent API:

```bash
herdr agent start <name> \
  --cwd /path/to/worktree \
  -- <agent-command-and-args>
```

Communication can use:

```bash
herdr agent prompt <target> "<prompt>"
herdr agent wait <target> ...
herdr agent read <target> ...
```

and raw-terminal operations remain available:

```bash
herdr pane run <pane-id> "<command>"
herdr pane send-text <pane-id> "<text>"
herdr pane send-keys <pane-id> enter
herdr pane read <pane-id> --source recent-unwrapped --lines 120
herdr pane wait-output <pane-id> ...
```

Herdr exposes `HERDR_ENV=1` to processes running inside a Herdr-managed pane. Its own agent skill is specifically designed to teach an agent how to control Herdr from inside that environment.

## 2.2 What Herdr is not

Herdr must **not** own the semantic software workflow.

It should not decide:

- how a spec is decomposed;
- which task is ready;
- what task dependencies mean;
- whether a ticket is semantically complete;
- whether code satisfies the spec;
- whether review is required;
- what checks define "done";
- whether a fixer is required;
- when the entire run is complete.

Those decisions belong to our **Orchestrator skill + workflow state**.

A useful separation is:

```text
Herdr state:
- pane exists
- process exists
- agent idle / working / blocked / done / unknown
- terminal output

Workflow state:
- run preparing
- task ready
- task running
- worker finished
- task checkpoint validated
- implementation complete
- reviewing
- checks failed
- fixing
- completed
```

Herdr lifecycle state is an observation about a process. It is **not semantic proof that the ticket is done**.

---

# 3. Relationship with Matt Pocock's skills

This project should **compose with** the Matt Pocock skill system, not reimplement it.

Current Matt Pocock engineering workflow is centered on a chain like:

```text
grill-with-docs
    ↓
to-spec
    ↓
to-tickets
    ↓
implement
    ↓
code-review
```

Relevant properties:

## 3.1 `to-spec`

`to-spec` synthesizes an agreed conversation/codebase understanding into a specification rather than reopening the problem from scratch.

It is designed to respect:

- project vocabulary;
- repository context;
- ADRs;
- testing seams.

Our Orchestrator should treat an existing approved spec as authoritative input.

It should **not casually redesign or reinterpret an already-settled spec**.

## 3.2 `to-tickets`

`to-tickets` turns a plan/spec into small **tracer-bullet vertical slices**.

Tickets declare blocking edges.

This matters because a machine-readable dependency graph gives the Orchestrator exactly what it needs to know:

```text
which tasks exist?
which tasks block which?
which tasks are currently ready?
can anything run in parallel?
```

Matt's design intentionally makes each ticket suitable for a fresh context window.

This aligns extremely well with this project.

Important rule:

> If good tickets already exist, the Orchestrator should normally consume them rather than inventing a new decomposition.

The Orchestrator **may** break a spec into tasks when necessary, but task decomposition is not its primary reason for existing.

## 3.3 `implement`

Matt's `implement` skill builds already-decided work.

Important properties:

- it trusts the upstream plan/spec/ticket;
- it does not reopen design decisions;
- one run covers one ticket;
- it uses TDD where appropriate;
- it typechecks/tests during implementation;
- it performs code review near the end;
- it commits to the current branch;
- the documented intended rhythm is one ticket per fresh context/session.

This matches the desired worker model.

A worker may therefore be launched with a prompt that causes it to invoke/use `implement` for the assigned ticket.

However, our workflow should **not depend solely on the worker's internal review or self-report**. We still want an independent workflow-level reviewer and deterministic verification after the implementation phase.

## 3.4 `code-review`

Matt's `code-review` checks a diff against a fixed point along two deliberately separate axes:

1. **Standards** — does the code follow repository conventions/standards?
2. **Spec** — does the implementation match the originating issue/spec?

This is especially valuable as a dedicated fresh reviewer stage.

The Orchestrator can launch a fresh Pi/Claude/Codex reviewer and ask it to run the existing `code-review` skill against:

```text
BASE_SHA ... HEAD
```

with the known spec path/reference.

The review process should not trust implementation-agent context.

## 3.5 Other existing skills

The user already has additional skills for activities such as deployment and specialized code review.

Those should stay specialized.

The Orchestrator should decide **when** to invoke them, not absorb their domain logic.

In other words:

```text
existing skills = expertise/procedure for a stage

orchestrator = routing + lifecycle + durable coordination
```

---

# 4. Core architecture

The system has five conceptual layers.

```text
┌─────────────────────────────────────────────────────────────┐
│ HUMAN                                                       │
│ "Implement spec X"                                          │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ ORCHESTRATOR AGENT                                          │
│ Claude / Codex / Pi running inside Herdr                    │
│                                                             │
│ loads orchestrator SKILL.md                                 │
│ understands spec/tickets                                    │
│ decides next workflow transition                            │
│ chooses worker/reviewer/fixer role                          │
└──────────────┬──────────────────────────────────────────────┘
               │
               ├──────── uses Herdr CLI ─────────────────┐
               │                                         │
               ▼                                         ▼
┌────────────────────────────┐          ┌──────────────────────────┐
│ WORKFLOW TOOLING           │          │ HERDR                    │
│                            │          │                          │
│ worktree creation          │          │ panes                    │
│ state machine              │          │ cwd                      │
│ events                     │          │ processes                │
│ artifacts                  │          │ input/output             │
│ check runner               │          │ agent lifecycle          │
│ browser verification       │          └────────────┬─────────────┘
│ result validation          │                       │
└──────────────┬─────────────┘                       ▼
               │                         fresh coding agents
               │                      ┌────────┬────────┬────────┐
               └──────────────────────│ Codex  │ Claude │  Pi    │
                                      └────────┴────────┴────────┘
```

---

# 5. Unit of work: one delivery run, one primary worktree

Default model:

> **A worktree belongs to the feature/run, not to the lifetime of an agent.**

For sequential tasks belonging to the same feature:

```text
Spec X
  │
  ▼
worktree: feat/spec-x
  │
  ├── fresh Worker 1 → Task 1 → commit A
  │
  ├── fresh Worker 2 → Task 2 → commit B
  │
  ├── fresh Reviewer → reviews BASE...HEAD
  │
  ├── deterministic checks
  │
  └── fresh Fixer → fixes findings → commit C
  │
  ▼
completed branch
```

Each worker receives a fresh LLM context, but all sequential workers operate on the **same worktree and branch**.

Therefore:

```text
conversation context is disposable
repository state is durable
```

## 5.1 Why this is preferable

If every fresh agent got a new worktree, sequential tickets would require repeated integration/merging.

That would add complexity with little value.

Fresh context does **not** require a fresh Git branch.

## 5.2 When separate worktrees are appropriate

Separate worktrees should be used when tasks are actually running **concurrently**.

Example:

```text
T1 ── independent ──┐
                    ├── integration
T2 ── independent ──┘
```

Parallelism introduces new concerns:

- conflicting edits;
- integration order;
- dependency edges;
- branch reconciliation;
- combined verification.

Therefore V1 should strongly prefer **sequential execution in one worktree**.

Parallel scheduling can be added later once the sequential workflow is reliable.

---

# 6. Agent lifecycle model

Every semantic stage should preferably use a fresh process/context.

Example:

```text
Task 1
  ↓
fresh Codex
  ↓
commit/result
  ↓
process can die

Task 2
  ↓
fresh Claude Code
  ↓
commit/result
  ↓
process can die

Review
  ↓
fresh Pi with review skills/extensions
  ↓
review artifact
  ↓
process can die

Fix
  ↓
fresh worker
  ↓
commit/result
```

The goal is to reduce:

- context pollution;
- confirmation bias;
- self-review bias;
- stale assumptions;
- accidental dependence on hidden conversation history.

A new agent should be able to orient itself from durable project state:

- assigned task;
- spec;
- `CONTEXT.md`;
- relevant ADRs;
- current branch/worktree;
- previous commits;
- a minimal handoff/result artifact if needed.

---

# 7. High-level workflow

The canonical workflow should be:

```text
SPEC / TICKETS
      │
      ▼
CREATE RUN
      │
      ▼
CREATE WORKTREE
      │
      ▼
IMPLEMENT TASKS
      │
      │ for each ready task:
      │   fresh worker
      │   implement
      │   commit
      │   result artifact
      │   checkpoint validation
      │
      ▼
IMPLEMENTATION COMPLETE
      │
      ▼
FRESH REVIEWER
      │
      ▼
REVIEW
      │
   ┌──┴───┐
 fail    pass
   │       │
   ▼       ▼
 FIXING   CHECKS
   │       │
   │    ┌──┴───┐
   │   fail   pass
   │    │       │
   └────┤       ▼
        ▼     COMPLETE
   FRESH FIXER
        │
        ▼
   re-review / re-check
```

The exact repeat policy should be configurable, but fix loops must be bounded.

---

# 8. Workflow state machine

The system should be designed as an explicit state machine even if V1 does not use the XState library.

## 8.1 Run-level states

Recommended states:

```text
created
preparing
implementing
reviewing
checking
fixing
blocked
failed
cancelled
completed
```

Possible transition model:

```text
created
  │
  ▼
preparing
  │
  ▼
implementing
  │
  ▼
reviewing ───── failure ─────┐
  │                          │
 success                     ▼
  │                        fixing
  ▼                          │
checking ───── failure ──────┘
  │
 success
  ▼
completed
```

Failures that cannot be automatically resolved should lead to:

```text
blocked
```

rather than an uncontrolled autonomous loop.

## 8.2 Task states

Recommended task lifecycle:

```text
pending
  │
  ▼
ready
  │
  ▼
running
  │
  ├── blocked
  │
  ▼
worker_done
  │
  ▼
checkpoint_validating
  │
  ├── invalid → retry/fix/blocked
  │
  ▼
done
```

Important invariant:

> `worker_done` is not `task_done`.

An LLM finishing its turn or Herdr reporting `done` only means that worker execution stopped/settled. The Orchestrator must validate the task checkpoint.

## 8.3 Review states

```text
pending
running
passed
failed
error
```

## 8.4 Verification/check states

Per check:

```text
pending
running
passed
failed
error
skipped
```

Overall verification:

```text
pending
running
passed
failed
```

## 8.5 Fix attempt states

```text
pending
running
worker_done
validating
done
failed
```

---

# 9. Do not require XState for V1

The architecture is state-machine-oriented, but adding XState immediately may create unnecessary abstraction.

V1 can implement:

```ts
type RunStatus =
  | "created"
  | "preparing"
  | "implementing"
  | "reviewing"
  | "checking"
  | "fixing"
  | "blocked"
  | "failed"
  | "cancelled"
  | "completed";
```

with a single transition function:

```ts
transition(currentState, event) -> nextState
```

Centralizing transitions is more important than the library choice.

XState becomes attractive later if the system gains:

- nested states;
- concurrent branches;
- parallel task scheduling;
- timers;
- retries with backoff;
- long-lived UI;
- external events;
- pause/resume semantics;
- complex guards.

---

# 10. Durable execution state: minimal snapshot + optional history

Workflow truth must not live only in the Orchestrator's context window, but V1 should keep the persistence model deliberately small.

The important simplification is:

> **Matt `to-tickets` already owns the implementation task graph. The Orchestrator must not create a second task-planning model on top of it.**

The Orchestrator only stores **execution state for existing tickets** plus workflow-stage state for review, checks, fixes, and delivery.

## 10.1 What is authoritative

Use the following responsibility split:

```text
spec
→ what is being built and why

tickets produced by to-tickets
→ implementation units + blocking edges / dependency graph

Git/worktree
→ durable code state

.orchestrator/runs/<run-id>/state.json
→ current execution/workflow state

history.jsonl
→ optional append-only operational history

Herdr
→ currently living terminal/process state

review/check/fix artifacts
→ evidence produced by later workflow stages
```

There is intentionally **no separate `OrchestratorTask` entity** in V1.

## 10.2 Ticket execution state

A ticket that has never been executed does not need an entry in `state.json`; it is implicitly `pending`.

The Orchestrator reads the ticket graph and derives whether a pending ticket is currently `ready` or `blocked` from its blocking edges.

Persist only facts that cannot be derived from the ticket files.

Example:

```json
{
  "version": 1,
  "run": "feature-auth",
  "phase": "implementing",
  "spec": "specs/auth.md",
  "worktree": "../.worktrees/feature-auth",
  "branch": "feat/auth",
  "base": "abc123",
  "tickets": {
    "001-auth-model": {
      "status": "done",
      "commit": "def456",
      "attempt": 1
    },
    "002-auth-api": {
      "status": "running",
      "attempt": 1,
      "agent": "codex",
      "herdrPane": "pane-17"
    }
  },
  "review": null,
  "checks": null,
  "fix": null
}
```

Ticket execution statuses can stay minimal:

```text
missing entry = pending
running
finished       # worker settled; checkpoint not yet accepted
done
failed
```

`ready` and `blocked` should normally be **derived**, not persisted.

For example:

```text
001 done
002 blocked by 001  → ready
003 blocked by 002  → blocked
```

This keeps the runtime model aligned with `to-tickets` instead of duplicating it.

## 10.3 Run-level phase

The run-level state can also stay small:

```text
preparing
implementing
reviewing
checking
fixing
ready_to_deliver
completed
blocked
failed
cancelled
```

The state file answers the most important recovery question:

> What phase are we in, which ticket is currently executing, and what should happen next?

## 10.4 History

An append-only `history.jsonl` is useful, but it is not required to be the primary database of the system.

Example:

```json
{"at":"2026-09-03T18:00:00Z","event":"run.started"}
{"at":"2026-09-03T18:00:02Z","event":"worktree.created","branch":"feat/auth","base":"abc123"}
{"at":"2026-09-03T18:01:10Z","event":"ticket.started","ticket":"001-auth-model","agent":"codex","pane":"p4"}
{"at":"2026-09-03T18:21:45Z","event":"ticket.finished","ticket":"001-auth-model"}
{"at":"2026-09-03T18:22:02Z","event":"ticket.done","ticket":"001-auth-model","commit":"def456"}
{"at":"2026-09-03T18:23:11Z","event":"ticket.started","ticket":"002-auth-api","agent":"claude","pane":"p6"}
{"at":"2026-09-03T18:50:10Z","event":"review.started","agent":"pi","attempt":1}
```

The history exists mainly for:

- recovery diagnostics;
- debugging;
- human handoff;
- understanding retries/failures;
- future observability/UI.

Git already provides a large part of implementation history, so do not turn the history log into a second issue tracker.

## 10.5 Single-writer rule

A major invariant remains:

> **Only the Orchestrator/helper CLI writes global workflow state.**

Workers should not mutate `state.json` directly.

The sequence is:

```text
worker changes code / commits / leaves result
        ↓
Orchestrator validates repository checkpoint
        ↓
Orchestrator updates state.json
        ↓
Orchestrator optionally appends history event
```

This avoids contradictory state and keeps workers disposable.

---

# 11. Global skill installation, repo-local setup, and state

The Orchestrator itself should be installed as a **global user skill**, separate from the application repository it operates on.

Recommended installed location for Codex:

```text
~/.agents/skills/orchestrate/
```

The application repository should contain only the **repo-local orchestration contract and runtime state** under `.orchestrator/`.

This separation is intentional:

```text
global skill installation
→ workflow policy, reusable references, generic prompt templates, deterministic helper tooling

application repository
→ project-specific config, project-specific checks/overrides, specs/tickets/context, runtime run state
```

The global skill must be able to operate on any target repository or worktree. Its helper executable may live under the global skill directory while its process `cwd` or explicit `--repo` / `--worktree` arguments point at the application repository.

## 11.1 Repo bootstrap

On first use in a repository, the global skill should detect whether that repository is initialized for orchestration.

If not, it should create something like:

```text
project/
├── CONTEXT.md
├── docs/
├── ...
└── .orchestrator/
    ├── config.yaml
    ├── README.md
    ├── prompts/
    │   └── ... optional project-specific prompt overrides ...
    ├── scripts/
    │   └── ... project-specific deterministic checks/hooks ...
    └── runs/
```

The reusable/default worker, reviewer, fixer, and blocked-resume prompt templates belong to the **global skill package**, not to every target repository. Repo-local prompt files are overrides only when a project needs them.

The setup command can conceptually be:

```text
/orchestrate setup
```

or:

```bash
flow setup
```

The skill should be able to create/update the repo-local structure idempotently.

## 11.2 What should be committed in the application repository

The application repository should normally commit the **shared project orchestration contract**:

```text
.orchestrator/config.yaml
.orchestrator/README.md
.orchestrator/scripts/*
.orchestrator/prompts/*    # only when project-specific overrides exist
```

This is what makes project-specific workflow configuration portable between developers and LLMs using the repository, while the reusable Orchestrator implementation remains globally installed.

A cloned repo immediately tells an Orchestrator:

- which agents/roles are expected for this project;
- which checks to run;
- where project context lives;
- whether any project-specific prompt overrides exist;
- how browser or project-specific verification works.

## 11.3 Runtime run state is repo-local

Active execution state should also live **under the repository's `.orchestrator/` directory**, not in a global XDG database.

Recommended location:

```text
.orchestrator/runs/<run-id>/
```

This gives every agent in the repository one predictable place to look for current workflow state.

However, runtime state contains ephemeral information such as Herdr pane IDs and current attempts. Therefore the recommended V1 default is:

```gitignore
.orchestrator/runs/
```

That gives us the useful property:

```text
repo-local and discoverable
but not accidentally mixed into feature commits
```

If a team later wants **shared cross-machine execution state**, that should be an explicit mode (for example tracking selected run summaries, publishing state to the ticket tracker, or storing run state in a dedicated branch). It should not complicate V1.

## 11.4 Worktrees

Worktrees can also use a predictable repo-relative parent path, for example:

```text
../<repo-name>-worktrees/<run-id>/
```

or a project-configured location.

The exact location is less important than recording it in `state.json` and never using the primary checkout for delegated implementation.

---

# 12. Suggested repo-local run layout

Example:

```text
project/
└── .orchestrator/
    ├── config.yaml                  # committed
    ├── README.md                    # committed
    ├── prompts/                     # committed
    ├── scripts/                     # committed
    └── runs/                        # repo-local runtime; gitignored by default
        └── feature-auth/
            ├── state.json
            ├── history.jsonl        # optional but recommended
            ├── review/
            │   ├── attempt-01.md
            │   └── attempt-01.json
            ├── checks/
            │   ├── attempt-01.json
            │   └── logs/
            ├── fixes/
            │   └── attempt-01.md
            └── artifacts/
                ├── screenshots/
                └── logs/
```

Notice what is **not** duplicated here:

```text
no copied spec
no copied ticket graph
no internal T01/T02 task definitions
```

The run state references the real spec/tickets where they already live.

---

# 13. Tickets are the implementation task graph

The Orchestrator should consume the tickets produced by Matt Pocock's `to-tickets` skill directly.

`to-tickets` already provides the properties needed by a workflow scheduler:

- one ticket per implementation slice;
- tracer-bullet vertical slices;
- explicit blocking edges;
- local files or native tracker records;
- ticket sizes suitable for fresh context windows.

Therefore the intended relationship is:

```text
approved spec
    ↓
to-tickets
    ↓
Ticket A ─────┐
Ticket B      │ blocking graph
Ticket C ◄────┘
    ↓
Orchestrator executes tickets
    ↓
fresh agent per ticket
```

Not:

```text
Matt ticket
    ↓
new Orchestrator task
    ↓
agent
```

## 13.1 Ready-ticket calculation

The Orchestrator reads the current ticket set and its blocking edges.

For each ticket:

```text
if ticket already recorded as done:
    done
else if every blocker is done:
    ready
else:
    blocked
```

For V1, choose one ready ticket and execute sequentially.

## 13.2 Tickets may come from different backends

The task graph may be represented as:

- local markdown ticket files created by `to-tickets`;
- GitHub issues with blocking relationships represented by the skill;
- another configured tracker.

The Orchestrator only needs a small adapter that can answer:

```text
list tickets
read ticket
read blocking edges
identify ticket reference/title
```

Do not copy full ticket content into `state.json`.

## 13.3 When no tickets exist

If the user provides only a spec and explicitly wants the Orchestrator to decompose it, the Orchestrator may invoke/use the existing `to-tickets` skill first.

The preferred flow is:

```text
spec
  ↓
to-tickets
  ↓
Orchestrator execution
```

rather than introducing an internal planning format.

---

# 14. Orchestrator behavior: what belongs in `SKILL.md`

The Orchestrator skill should contain **judgment and policy**, not implementation mechanics.

It should teach the main agent to:

1. establish that it is running inside Herdr;
2. identify the input spec/tickets;
3. prefer already-existing approved specs/tickets;
4. avoid reopening settled product/design decisions;
5. read the existing ticket graph and blocking edges;
6. invoke/use `to-tickets` first only when no suitable tickets exist;
7. create/resume a minimal repo-local durable run;
8. create one primary worktree for sequential work;
9. derive the next ready ticket from ticket dependencies + execution state;
10. choose an appropriate worker role;
11. launch a fresh worker using Herdr;
12. provide the ticket + bounded authoritative context;
13. wait for completion/blocking;
14. validate the Git checkpoint and any worker artifact;
15. record ticket execution state;
16. repeat until implementation is complete;
17. launch a fresh reviewer;
18. run deterministic checks;
19. launch a fresh fixer when needed;
20. limit retries;
21. mark the run complete only when review/check policy is satisfied;
22. surface meaningful blockers to the human;
23. resume correctly after context/process restart by reading repo-local durable state.

The skill should explicitly say:

```text
You coordinate the workflow.
You normally do not implement project code yourself.

Prefer existing approved specs and tickets.
Do not reopen settled product decisions.

Delegate implementation to fresh workers.
Delegate semantic review to a fresh reviewer.
Use deterministic scripts for deterministic checks.

Herdr is your terminal/process control layer.
Workflow state is not Herdr state.

Never infer semantic completion solely from an agent returning to idle/done.
```

---

# 15. Herdr integration

The Orchestrator itself is a coding agent running **inside Herdr**.

Herdr's official skill should ideally also be installed for the Orchestrator agent so it knows the current CLI primitives.

## 15.1 Environment invariant

Before performing Herdr orchestration:

```bash
test "${HERDR_ENV:-}" = "1"
```

If the Orchestrator is not inside a Herdr-managed pane, the skill should stop orchestration instead of pretending to control a session it does not own.

## 15.2 Launch pattern

One safe pattern:

1. create a sibling pane with the task worktree as cwd;
2. retain the returned pane ID;
3. start the selected agent process;
4. name/label the pane/agent with run/task identity;
5. send the generated worker prompt;
6. store Herdr identity in `execution.json`;
7. wait for lifecycle state or inspect output;
8. handle blocked/unknown cases deliberately;
9. after checkpoint validation, optionally close the pane.

Conceptually:

```bash
PANE_JSON="$(
  herdr pane split --current \
    --direction right \
    --cwd "$WORKTREE" \
    --no-focus
)"

PANE_ID="<parse .result.pane.pane_id>"

herdr pane rename "$PANE_ID" "run42:T01:codex"
herdr pane run "$PANE_ID" "codex"
```

The higher-level agent API may be preferable where supported:

```bash
herdr agent start "run42:T01" \
  --cwd "$WORKTREE" \
  -- codex
```

Then:

```bash
herdr agent prompt "run42:T01" "$(cat "$PROMPT_FILE")"
```

The implementation should prefer the highest-level reliable Herdr primitive for coding agents and keep raw pane operations as the escape hatch.

## 15.3 Waiting

Waiting should not mean:

```text
poll terminal every 2 seconds with an LLM
```

Prefer Herdr wait primitives.

Examples include agent lifecycle waits and output waits.

When the wait returns:

- `done` / `idle` → inspect structured result and repository state;
- `blocked` → inspect worker dialog/output, then either answer safely or surface a blocker;
- `unknown` → treat as unknown, not success;
- timeout/process disappearance → record execution failure and apply retry policy.

## 15.4 Reading output

Terminal history is useful for diagnostics, but it should not be the primary machine protocol.

Use:

```text
structured result files = semantic protocol
Herdr output = human-readable diagnostics / recovery aid
```

This keeps the system from having to parse natural-language scrollback to infer completion.

---

# 16. Worker contract

Every worker should get a bounded task and explicit completion protocol.

Example worker brief:

```markdown
# Worker ticket 002-auth-api

You are implementing exactly one assigned ticket in an existing feature worktree.

## Source of truth

Ticket:
<ticket reference/path from the configured `to-tickets` output>

Spec:
<spec path/ref>

## Read before editing

- CONTEXT.md
- docs/adr/004-persistence.md
- <other relevant docs>

## Current Git context

Branch: feat/preferences
Base commit before this ticket: def456

Previous completed ticket commits are already present in this worktree.

## Instructions

1. Implement only this ticket.
2. Do not reopen settled design decisions from the spec/ADRs.
3. Use the repository's existing engineering skills where appropriate.
4. Run ticket-relevant tests/typechecks.
5. Commit completed work to the current branch.
6. Write the structured result to:
   .orchestrator/runs/<run-id>/tickets/<ticket-id>/result.json
7. Finish the session.

Do not mark the overall workflow complete.
Do not edit global workflow state.
```

If using Matt skills, the prompt can explicitly instruct the worker to use `/implement <ticket>`.

## 16.1 Worker result

Example:

```json
{
  "schemaVersion": 1,
  "ticketId": "002-auth-api",
  "status": "completed",
  "summary": "Added authenticated preferences API endpoint",
  "commit": "fed987",
  "commands": [
    {
      "command": "pnpm test preferences-api",
      "exitCode": 0
    },
    {
      "command": "pnpm typecheck",
      "exitCode": 0
    }
  ],
  "filesChanged": [
    "src/api/preferences.ts",
    "tests/preferences-api.test.ts"
  ],
  "decisions": [],
  "notesForNextTask": [
    "Consumers should call UserPreferenceService; do not access repository directly."
  ]
}
```

A worker may also report a blocker:

```json
{
  "status": "blocked",
  "blocker": {
    "type": "decision",
    "summary": "Spec is ambiguous about anonymous users.",
    "options": [
      "Return 401",
      "Return default preferences"
    ]
  }
}
```

---

# 17. Checkpoint validation after every worker

The worker saying "done" is insufficient.

Before setting `task.status = done`, the Orchestrator/helper should validate at minimum:

```text
✓ expected worktree still exists
✓ branch is the expected branch
✓ HEAD is at or after task start
✓ a new commit exists when a commit is required
✓ result.json exists and parses
✓ result task ID matches assigned task
✓ reported commit exists
✓ reported commit is reachable from current HEAD
✓ there are no unexpected unresolved decisions
✓ worktree state satisfies configured cleanliness policy
```

Optional checks:

```text
✓ changed paths are within allowed scope
✓ task-specific validation command succeeded
✓ commit message references task/ticket
```

Then transition:

```text
worker_done
    ↓
checkpoint_validating
    ↓
done
```

---

# 18. Handoff philosophy

Do not build giant agent-memory transcripts.

The preferred handoff is:

1. code in the worktree;
2. commits;
3. spec/ticket;
4. structured result;
5. short notes only when something cannot be inferred from code/spec.

Example generated handoff:

```markdown
# T02 handoff

Status: completed
Commit: fed987

## Implemented

Added authenticated preferences API endpoint.

## Relevant decisions

No new design decision. Followed ADR-004.

## Verification performed by worker

- pnpm test preferences-api
- pnpm typecheck

## Notes for following tasks

Use UserPreferenceService. Do not directly access preference persistence.
```

This keeps new agents oriented without polluting their context with the previous worker's full reasoning.

---

# 19. Reviewer stage

After all required implementation tasks are complete, launch a fresh reviewer.

Preferred reviewer properties:

- fresh context;
- read-only intent where practical;
- same worktree or a clean review checkout;
- knows fixed `BASE_SHA`;
- knows current `HEAD`;
- receives the originating spec;
- receives project context/ADRs;
- uses dedicated review skills/extensions.

Example review prompt:

```markdown
# Review run run_20260903_feature_x

Review the implementation from:

BASE: abc123
HEAD: fed987

Source spec:
docs/specs/feature-x.md

Read:
- CONTEXT.md
- relevant ADRs
- repository coding standards

Use the installed code-review skill.

Do not implement fixes in this session.

Write findings to:
<runtime>/review/attempt-01.md

Also write machine-readable summary to:
<runtime>/review/attempt-01.json
```

## 19.1 Why fresh review matters

A fresh reviewer reduces author bias.

The reviewer asks:

```text
Is this the correct implementation?
```

rather than:

```text
Can I justify the implementation I just wrote?
```

## 19.2 Matt `code-review`

Where available, use Matt's code-review methodology:

- fixed diff point;
- Standards axis;
- Spec axis;
- keep findings separate;
- do not let one axis hide the other.

---

# 20. Deterministic verification

Agent review and deterministic checks solve different problems.

## 20.1 Semantic review asks

- Does the diff actually satisfy the spec?
- Is the architecture sensible?
- Are there missing edge cases?
- Is there scope creep?
- Does the implementation violate project conventions in ways tooling cannot detect?
- Is the design unnecessarily complicated?

## 20.2 Deterministic checks prove

- formatting;
- lint;
- typecheck;
- unit tests;
- integration tests;
- build;
- migrations;
- browser smoke flows;
- console errors;
- screenshot creation;
- visual snapshot comparison;
- other project-specific invariants.

Neither replaces the other.

---

# 21. Repository-defined check configuration

The Orchestrator should not guess whether a project uses pnpm, pytest, cargo, etc.

Let the repository define its checks.

Example:

```yaml
# .orchestrator/config.yaml

version: 1

checks:
  - id: format
    command: pnpm prettier --check .
    required: true

  - id: lint
    command: pnpm lint
    required: true

  - id: typecheck
    command: pnpm typecheck
    required: true

  - id: test
    command: pnpm test
    required: true
    timeoutSeconds: 900

  - id: build
    command: pnpm build
    required: true

  - id: browser
    command: pnpm verify:browser
    required: true
    timeoutSeconds: 600
```

Potential additional configuration:

```yaml
workflow:
  maxWorkerAttempts: 2
  maxFixAttempts: 2
  requireReview: true
  rerunReviewAfterFix: true
  rerunAllChecksAfterFix: true

git:
  baseBranch: main
  requireCleanTaskCheckpoint: true

agents:
  worker:
    command: codex
  workerLarge:
    command: claude
  reviewer:
    command: pi
    args: ["--profile", "reviewer"]
  fixer:
    command: codex
```

---

# 22. Check runner output

Every check run should produce structured data and logs.

Example:

```json
{
  "attempt": 1,
  "status": "failed",
  "startedAt": "2026-09-03T19:00:00Z",
  "finishedAt": "2026-09-03T19:04:00Z",
  "checks": [
    {
      "id": "format",
      "status": "passed",
      "exitCode": 0,
      "durationMs": 2180,
      "log": "logs/format.log"
    },
    {
      "id": "browser",
      "status": "failed",
      "exitCode": 1,
      "durationMs": 43000,
      "log": "logs/browser.log",
      "artifacts": [
        "artifacts/screenshots/mobile-nav-failure.png"
      ]
    }
  ]
}
```

This artifact becomes direct input to a fixer.

---

# 23. Browser and visual verification

Browser verification will require custom project scripts.

A good split is:

## 23.1 Deterministic browser automation

Use Playwright or equivalent to:

1. start or connect to the app;
2. wait for health/ready;
3. visit required routes;
4. perform critical flows;
5. assert text/state;
6. inspect console/network failures where relevant;
7. take screenshots;
8. optionally run visual snapshots;
9. write machine-readable results.

Example result:

```json
{
  "check": "browser",
  "status": "failed",
  "steps": [
    {
      "name": "open dashboard",
      "status": "passed"
    },
    {
      "name": "create project",
      "status": "passed"
    },
    {
      "name": "mobile settings navigation",
      "status": "failed",
      "screenshot": "screenshots/mobile-settings.png",
      "message": "Settings button is outside visible viewport."
    }
  ]
}
```

## 23.2 Visual/UX agent review

If needed, launch another fresh specialized agent that reviews:

- screenshots;
- rendered app;
- visual quality;
- accessibility/UX;
- specific design criteria.

Do not replace deterministic browser tests with "the agent looked at it and said it works".

---

# 24. Fix loop

If semantic review or deterministic checks fail, create a bounded **fix brief** and launch a fresh fixer.

Do not send vague instructions such as:

```text
Fix everything.
```

Generate a concrete artifact:

```markdown
# Fix attempt 1

## Original spec

<spec ref>

## Current branch

feat/feature-x

## Review findings

### HIGH
- UserPreferenceService does not validate ownership.

### MEDIUM
- Persistence mapping is duplicated.

## Deterministic failures

### browser
Mobile navigation cannot open Settings.

Artifact:
<absolute path>/artifacts/screenshots/mobile-settings.png

## Passed checks

- format
- lint
- typecheck
- unit tests
- build

## Instructions

Fix the listed findings only.
Preserve already-passing behavior.
Run focused checks while working.
Commit the fix.
Write result.json to <path>.
```

Then:

```text
fresh fixer
   ↓
commit
   ↓
checkpoint validation
   ↓
re-review and/or re-check
```

Policy can decide whether:

- all checks rerun;
- only failed checks rerun initially;
- full suite must pass before completion;
- semantic review must rerun after any code-changing fix.

Recommended safe default:

```text
after any fixer commit:
  rerun semantic review if finding was semantic
  rerun full required deterministic check suite before DONE
```

---

# 25. Retry limits

Never create an unlimited autonomous fix loop.

Recommended defaults:

```yaml
workflow:
  maxWorkerAttempts: 2
  maxFixAttempts: 2
```

After limit exhaustion:

```text
run → blocked
```

The Orchestrator should report:

- what failed;
- what was attempted;
- current branch/worktree;
- relevant artifacts/logs;
- the smallest decision or human intervention required.

This prevents uncontrolled token/cost burn and circular agent behavior.

---

# 26. Blockers and decisions

Some failures are technical; some require human judgment.

Examples requiring escalation:

- spec ambiguity that changes product behavior;
- destructive database choice;
- credentials/secrets required;
- breaking API decision;
- deployment/cutover requiring human authorization;
- two fix attempts failed;
- branch cannot be safely reconciled.

Represent decisions durably.

Example:

```json
{
  "id": "decision_001",
  "run": "run_20260903_feature_x",
  "task": "T02",
  "status": "open",
  "question": "Should anonymous users receive defaults or 401?",
  "options": [
    "401",
    "default preferences"
  ],
  "sourceExecution": "exec_002"
}
```

Once answered:

```json
{
  "status": "resolved",
  "resolution": "401",
  "resolvedAt": "..."
}
```

The worker can then be resumed or replaced with a fresh worker that reads the resolved decision.

---

# 27. Suggested Orchestrator CLI/helper responsibilities

The skill should not hand-roll complex state mutation through ad hoc shell commands.

Provide a small deterministic CLI.

Possible name placeholders:

```text
flow
orch
crewctl
workrun
```

Example surface:

```text
flow init
flow run create --spec <ref>
flow status
flow history

flow worktree create
flow worktree status

flow task list
flow task next
flow task start T01 --agent worker
flow task validate T01
flow task retry T01

flow review start --agent reviewer
flow review ingest <artifact>

flow checks run

flow fix create
flow fix start --agent fixer

flow block
flow resume
flow complete
```

The final naming is less important than having a single owner for state transitions.

---

# 28. Which language should implement the helpers?

Recommendation:

## TypeScript is a good default if:

- the surrounding tooling is JS/TS-heavy;
- browser verification is Playwright-based;
- XState may be adopted later;
- typed schemas are desired;
- packaging as one CLI is useful.

## Python is also a strong choice if:

- fast scripting and subprocess work are the main concern;
- the user prefers Python;
- JSON/YAML/file manipulation dominates.

## Bash should remain glue

Use Bash for very small wrappers.

Do not put the core state machine, locking, retries, event persistence, or schema migration logic into a large Bash system unless there is a compelling reason.

A practical split could be:

```text
TypeScript:
- CLI
- state/event model
- Herdr command wrapper
- Git/worktree orchestration
- check runner
- Playwright verification

Bash:
- tiny project-specific hooks
- environment bootstrap
```

---

# 29. Suggested source layout

The Orchestrator development repository should itself be the **source root of one skill**, rather than nesting the skill under `skills/orchestrate/`.

A reasonable V1 development repo:

```text
coding-orchestrator/
├── SKILL.md
│
├── references/
│   ├── worker-contract.md
│   ├── reviewer-contract.md
│   ├── fixer-contract.md
│   ├── state-machine.md
│   ├── recovery.md
│   └── herdr.md
│
├── scripts/
│   ├── flow                     # thin executable wrapper / stable skill entrypoint
│   └── setup                    # optional thin setup wrapper
│
├── assets/
│   └── prompts/
│       ├── worker.md
│       ├── reviewer.md
│       ├── fixer.md
│       └── blocked-resume.md
│
├── src/                         # deterministic helper implementation
│   ├── cli.ts
│   ├── config.ts
│   ├── ids.ts
│   │
│   ├── state/
│   │   ├── schema.ts
│   │   ├── transitions.ts
│   │   ├── store.ts
│   │   └── history.ts
│   │
│   ├── git/
│   │   ├── repo.ts
│   │   ├── worktree.ts
│   │   └── checkpoint.ts
│   │
│   ├── herdr/
│   │   ├── cli.ts
│   │   ├── pane.ts
│   │   └── agent.ts
│   │
│   ├── tickets/
│   │   ├── source.ts          # read configured to-tickets output/tracker
│   │   ├── scheduler.ts       # derive ready tickets from blockers + state
│   │   └── validate.ts
│   │
│   ├── execution/
│   │   ├── worker.ts
│   │   ├── reviewer.ts
│   │   └── fixer.ts
│   │
│   ├── checks/
│   │   ├── runner.ts
│   │   └── result.ts
│   │
│   └── runtime/
│       ├── paths.ts
│       └── recovery.ts
│
├── schemas/
│   ├── state.schema.json
│   ├── ticket-result.schema.json
│   ├── review-result.schema.json
│   └── checks-result.schema.json
│
├── tests/
├── install-skill.sh
├── package.json
└── README.md
```

`SKILL.md` is the main agent-facing policy/router. Larger stage-specific instructions should live in `references/` and be referenced from `SKILL.md` so the agent can load them only when needed. `scripts/` exposes stable executable entrypoints; `src/` contains the deterministic implementation behind those entrypoints.

Avoid turning `SKILL.md` into the implementation of the state machine, Git validation, locking, retries, or Herdr parsing. Those mechanics belong to deterministic tooling.

## 29.1 Development repo vs installed skill

Do not develop the project directly inside `~/.agents/skills/`. Keep a normal Git development repository, for example:

```text
~/workspace/coding-orchestrator/
```

and explicitly build/package/install it into the Codex global skill directory:

```text
~/.agents/skills/orchestrate/
```

Recommended development loop:

```text
edit source repo
    ↓
run tests / build
    ↓
install-skill.sh (copy packaged files)
    ↓
~/.agents/skills/orchestrate/
    ↓
start a fresh Codex session for skill-level smoke testing
```

The installation step should be explicit rather than a symlink. This makes the installed skill a deliberate packaged snapshot and avoids accidental live changes while a workflow is being tested.

## 29.2 Installed skill package

The installed artifact does not need all development-only files. A good initial package is:

```text
~/.agents/skills/orchestrate/
├── SKILL.md
├── references/
├── scripts/
├── assets/
│   └── prompts/
├── schemas/
└── dist/                        # compiled deterministic helper tooling
```

Development-only `src/`, `tests/`, fixtures, `.git`, and `node_modules` should normally not be copied into the installed package.

The install script should be deterministic and should copy only the files required at runtime. Conceptually:

```bash
pnpm test
pnpm build
./install-skill.sh
```

The project may expose convenience commands such as:

```bash
pnpm skill:install
pnpm skill:check
```

where `skill:check` validates the installed package shape, required references, executable wrappers, schemas, and compiled helper entrypoint.

## 29.3 Skill paths vs target repository paths

The installed skill directory and the repository being orchestrated are different roots:

```text
SKILL_ROOT
~/.agents/skills/orchestrate/

TARGET_REPO
~/workspace/my-project/

TARGET_WORKTREE
~/workspace/my-project-worktrees/<run-id>/
```

References, templates, schemas, and helper executables must be resolved relative to `SKILL_ROOT`. Git operations, `.orchestrator/` state, project checks, and implementation edits must operate on the explicit target repository/worktree.

For interactive convenience, `flow status` may infer a repository from `cwd`. Internal orchestration calls should prefer explicit paths such as `--repo` and `--worktree` so the main checkout cannot be confused with the delegated feature worktree.

Avoid overbuilding this structure before V1 needs it.

---

# 30. Agent configuration

Agents should be roles, not hard-coded assumptions.

Example:

```yaml
agents:
  worker:
    executable: codex
    args: []

  workerLarge:
    executable: claude
    args: []

  reviewer:
    executable: pi
    args:
      - "--profile"
      - "reviewer"

  fixer:
    executable: codex
    args: []
```

The Orchestrator chooses a **role**:

```text
worker
reviewer
fixer
```

The project config determines which executable currently implements that role.

Later, policies may select based on:

- task size;
- frontend/backend;
- cost;
- model strengths;
- required extensions;
- required skills.

Do not make model routing a prerequisite for V1.

---

# 31. Project context contract

Workers need fast orientation.

The codebase already contains useful context such as:

```text
CONTEXT.md
ADR.md / docs/adr/*
```

The Orchestrator should pass a small explicit **read-first manifest**.

Example:

```text
Read first:
- CONTEXT.md
- docs/adr/003-auth.md
- docs/specs/feature-x.md
- <ticket path>
```

Do not force every agent to crawl the whole repo if the relevant context is known.

At the same time, avoid injecting huge handoff transcripts.

Good context:

```text
authoritative docs
ticket
spec
git history
small result artifacts
```

Bad context:

```text
entire previous agent conversation
hundreds of lines of reasoning
manual summaries of code the next agent can inspect directly
```

---

# 32. Git invariants

Git should be treated as part of the workflow protocol.

Recommended invariants:

1. resolve and record the base commit at run creation;
2. create a dedicated worktree/branch;
3. each task normally produces a commit;
4. task checkpoint records commit SHA;
5. reviewer compares the original run base with current HEAD;
6. fixer commits are separate;
7. final verification runs against final HEAD;
8. cleanup only happens after the desired delivery state is safely reached.

Example:

```text
BASE abc123
 │
 ├── def456 T01
 │
 ├── fed987 T02
 │
 └── 991abc Fix review findings
      │
      HEAD
```

Do not rely on mutable branch names alone when review needs a fixed point.

Record SHAs.

---

# 33. Worktree safety

Before launching a worker:

```text
✓ repository recognized
✓ run base commit exists
✓ target branch exists/created safely
✓ worktree path is correct
✓ worktree is not the user's primary checkout
✓ no unrelated dirty state
```

Before cleanup:

```text
✓ work has been committed/preserved
✓ branch/head is known
✓ no untracked valuable artifacts in worktree
✓ run state is terminal or user explicitly requested cleanup
```

One useful idea borrowed from Firstmate is **fail-closed worktree handling**: never destroy a worktree simply because the worker process ended.

---

# 34. Lessons worth borrowing from Firstmate

This project is not intended to copy Firstmate wholesale, but several design lessons are valuable.

## Borrow:

### Durable state

A restart/compacted context should not lose task progress.

### Worktree isolation

Coding agents should not casually edit the primary checkout.

### Deterministic mechanics outside the LLM

Git checks, process checks, task state writes, validation, and cleanup should be script-owned.

### Structured supervision

Only wake/engage the reasoning agent for meaningful decisions when possible.

### Safe cleanup

Do not delete worktrees or state unless work is provably preserved.

### Append-only history

Operational history makes debugging/recovery much easier.

## Do not copy by default:

- large backend abstraction layer;
- automatic fleet spawning policies;
- extensive shell-based runtime;
- all Firstmate project modes;
- persistent hierarchical "second mates";
- PR/relay functionality unrelated to this workflow;
- zero-token watcher daemon before V1 needs it.

Our project should remain smaller and Herdr-native.

---

# 35. Supervision strategy

V1 does not need a daemon.

The Orchestrator can:

1. launch worker;
2. call Herdr wait;
3. inspect result;
4. transition.

This is sufficient for one active worker at a time.

Later, when parallel workers exist, consider a lightweight watcher/event pump that:

- waits on multiple Herdr agent/process states;
- writes runtime events;
- avoids forcing the LLM to poll repeatedly.

That idea is inspired by Firstmate's event-driven supervision but should be added only when concurrency justifies it.

---

# 36. Sequential first, parallel later

V1 should intentionally avoid a "swarm".

Recommended V1 scheduler:

```text
while exists ready task:
    choose first ready task
    run fresh worker
    validate checkpoint
```

Benefits:

- easy reasoning;
- one primary worktree;
- minimal Git conflicts;
- easy recovery;
- deterministic ordering;
- straightforward history.

Future scheduler:

```text
frontier = all tickets whose blockers are done
```

Then the system can run multiple frontier tasks in isolated worktrees.

That is a separate architectural phase and should not complicate the initial implementation.

---

# 37. Recovery after Orchestrator restart

A critical requirement:

> A new Orchestrator context must be able to resume an existing run from disk.

Resume algorithm:

1. find active run;
2. read `state.json`;
3. read recent `history.jsonl` when present;
4. verify repository/worktree still exists;
5. verify recorded HEAD/branch;
6. inspect any recorded active Herdr execution;
7. determine whether worker is still present;
8. inspect result artifact;
9. reconcile state conservatively;
10. continue from the next valid transition.

Examples:

### State says a ticket is `running`, agent still working

Continue waiting.

### State says a ticket is `running`, agent gone, valid `result.json` + commit exists

Run checkpoint validation and mark the ticket done if valid.

### State says a ticket is `running`, agent gone, no result

Record execution failure; apply retry policy.

### State says `checking`, prior check artifact complete

Ingest it instead of rerunning blindly.

Recovery should be idempotent.

---

# 38. Idempotency

Many orchestration commands should be safe to call twice.

Examples:

```text
create worktree:
  if correct worktree already exists → reuse/validate

append event:
  event IDs prevent duplicate ingestion where necessary

task validate:
  repeated validation returns same semantic result

checks ingest:
  artifact attempt already recorded → no duplicate transition
```

The Orchestrator may retry commands after context interruptions, so helpers must fail predictably and avoid destructive surprises.

---

# 39. Locking

Even with one Orchestrator, accidental concurrent invocations may happen.

The state store should have a run-level lock.

Simplest options:

- filesystem lock;
- advisory lock;
- SQLite transaction if state later moves to SQLite.

V1 can use a lock file around state transition commands.

Never allow two processes to mutate `state.json` simultaneously.

---

# 40. JSON schemas

Structured artifacts should have versioned schemas.

At minimum:

```text
RunState
TicketExecution
TicketResult
Execution
ReviewResult
CheckAttempt
Decision
FixResult
```

Every JSON artifact should include:

```json
{
  "schemaVersion": 1
}
```

This makes future evolution safer and helps LLMs/tools detect stale formats.

---

# 41. Suggested run completion invariant

A run can transition to `completed` only if all required conditions are true.

Recommended invariant:

```text
all required tasks == done
AND no open blocking decisions
AND review policy satisfied
AND all required checks passed against final HEAD
AND final HEAD is recorded
```

Optionally:

```text
AND deployment/delivery stage completed
```

if delivery is included in the workflow.

Do not let an implementation worker call the global run complete.

---

# 42. Deployment integration

Deployment should be modeled as an optional downstream stage, not embedded into implementation.

Example:

```text
implementation
   ↓
review
   ↓
checks
   ↓
ready_to_deliver
   ↓
deployment/release skill
   ↓
completed
```

The Orchestrator should invoke the user's existing deployment skill/process where appropriate.

Potential states:

```text
ready_to_deliver
deploying
deployed
deployment_failed
```

Whether deployment is automatic or requires explicit human approval should be configurable.

---

# 43. Suggested configuration model

The configuration should live in the repository and be created by the setup skill.

Example:

```yaml
version: 1

runtime:
  runsDir: .orchestrator/runs

worktree:
  root: ../my-project-worktrees

git:
  baseBranch: main
  requireTicketCommit: true
  requireCleanCheckpoint: true

workflow:
  mode: sequential
  requireReview: true
  maxWorkerAttempts: 2
  maxFixAttempts: 2
  rerunReviewAfterSemanticFix: true
  rerunAllChecksAfterFix: true

agents:
  worker:
    executable: codex
  workerLarge:
    executable: claude
  reviewer:
    executable: pi
    args: ["--profile", "reviewer"]
  fixer:
    executable: codex

context:
  alwaysRead:
    - CONTEXT.md
  adrGlobs:
    - "docs/adr/*.md"

checks:
  - id: format
    command: pnpm prettier --check .
    required: true

  - id: lint
    command: pnpm lint
    required: true

  - id: typecheck
    command: pnpm typecheck
    required: true

  - id: test
    command: pnpm test
    required: true
    timeoutSeconds: 900

  - id: browser
    command: pnpm verify:browser
    required: true
    timeoutSeconds: 600
```

The setup skill should also ensure `.orchestrator/runs/` is gitignored by default unless the repository explicitly opts into sharing execution state through Git.

---

# 44. Prompts should be generated from templates

Do not let the Orchestrator improvise the entire worker protocol each time.

Use reusable templates populated with run data. The default templates belong to the global skill package, for example:

```text
~/.agents/skills/orchestrate/assets/prompts/
├── worker.md
├── reviewer.md
├── fixer.md
└── blocked-resume.md
```

A target repository may optionally provide project-specific overrides under `.orchestrator/prompts/`, but overrides should be explicit rather than silently replacing the global protocol.

Benefits:

- consistent behavior across Claude/Codex/Pi;
- easier debugging;
- easy prompt testing;
- less orchestration-context token use;
- explicit protocol evolution;
- one reusable source of truth for the generic worker/reviewer/fixer contracts.

The Orchestrator should still be able to add a short task-specific note.

---

# 45. Observability

Useful `flow status` output:

```text
Run: run_20260903_feature_x
State: reviewing
Branch: feat/feature-x
Worktree: ~/.local/share/.../run_20260903_feature_x
Base: abc123
Head: fed987

Tasks:
✓ T01 Add persistence model      def456
✓ T02 Add API endpoint           fed987
○ T03 Add UI                     pending

Active execution:
review attempt 1
agent: pi
herdr: run42:review:1

Checks:
not started
```

Useful `flow history`:

```text
18:00 run created
18:00 worktree created
18:01 T01 started → codex
18:21 T01 worker finished
18:22 T01 checkpoint validated → def456
18:23 T02 started → claude
18:48 T02 checkpoint validated → fed987
18:50 review started → pi
```

This should be sufficient for both humans and a fresh Orchestrator context.

---

# 46. Safety boundaries

The Orchestrator should be conservative around:

- destructive Git commands;
- deleting worktrees;
- force push;
- deployment;
- credentials;
- production mutations;
- migrations;
- ambiguous product decisions.

Helpers should use fail-closed behavior.

Examples:

```text
Cannot prove worktree is safely preserved
→ do not delete it

Cannot determine whether current branch matches recorded run
→ block instead of guessing

Reviewer returned malformed artifact
→ do not mark review passed

Herdr state is unknown
→ do not treat task as successful
```

---

# 47. Non-goals for V1

Do not build these first:

- general-purpose distributed agent framework;
- cloud execution;
- autonomous model marketplace/routing;
- semantic vector memory;
- huge conversation-history database;
- parallel swarm scheduling;
- Web UI;
- XState visualization;
- complex PR automation;
- remote hosts;
- persistent second-level orchestrators;
- a new issue tracker;
- a replacement for Matt Pocock skills;
- a replacement for Herdr.

The first useful version should prove the core loop.

---

# 48. MVP scope

A successful V1 should support this scenario:

```text
Given:
- an approved spec + tickets produced by `to-tickets` (or an existing configured ticket set)
- a Git repository
- Herdr running
- Codex/Claude/Pi available
- project check configuration

The Orchestrator can:

1. run repo setup if `.orchestrator/` is not initialized;
2. create a repo-local run state;
3. create a feature worktree;
4. read the ticket graph/blocking edges;
5. derive the first ready ticket;
6. launch fresh Worker 1 in a Herdr pane;
7. send that ticket;
8. wait and validate its commit/checkpoint;
9. record the ticket as done in `state.json`;
10. derive and launch the next ready ticket in a fresh agent context;
11. launch a fresh reviewer after implementation tickets finish;
12. ingest review result;
13. run deterministic checks;
14. if failure: launch one fresh fixer;
15. rerun required verification;
16. mark completed;
17. recover from an Orchestrator restart at any phase.
```

This is enough to validate the architecture.

---

# 49. Suggested implementation order

## Phase 1 — durable state

Implement:

- run IDs;
- state schema;
- event log;
- transition function;
- lock;
- `status`;
- `history`.

Tests:

- valid transitions;
- invalid transitions refused;
- crash-safe writes;
- event order.

## Phase 2 — Git/worktree

Implement:

- detect repository;
- record base SHA;
- create worktree;
- validate branch/head;
- checkpoint validation;
- safe cleanup guard.

Tests should use temporary Git repos.

## Phase 3 — Herdr adapter

Implement only primitives needed by V1:

```text
create agent pane
start agent
prompt agent
wait
read output
close
```

Mock the command runner for unit tests.

Do not yet create a generic terminal abstraction unless needed.

## Phase 4 — worker execution

Implement:

- prompt generation;
- execution record;
- worker result schema;
- ticket checkpoint validation;
- retry count.

Use one sequential ticket first.

## Phase 5 — ticket graph execution

Implement:

- adapter for the configured `to-tickets` output/tracker;
- ticket blocking-edge parsing;
- ready-ticket calculation from ticket graph + `state.json`;
- sequential loop;
- same-worktree fresh agents.

Do **not** introduce a second internal task graph.

## Phase 6 — reviewer

Implement:

- fixed base/head;
- reviewer prompt;
- review result schema;
- pass/fail ingestion.

## Phase 7 — deterministic checks

Implement:

- YAML config;
- command execution;
- stdout/stderr capture;
- timeout;
- aggregate check result.

## Phase 8 — fixer

Implement:

- fix brief synthesis from review/check artifacts;
- fresh fixer launch;
- result validation;
- bounded retries.

## Phase 9 — browser check

Implement project-specific or reusable Playwright runner.

## Phase 10 — recovery

Kill/restart the Orchestrator during each major state and prove the workflow can resume.

Only after this should parallelism be considered.

---

# 50. Testing strategy for the orchestrator itself

The orchestration tooling needs strong tests because LLM agents will rely on its invariants.

## Unit tests

- state transitions;
- task readiness;
- retry policy;
- config parsing;
- schema validation;
- prompt construction;
- event serialization.

## Integration tests

Temporary Git repository:

- worktree creation;
- commits;
- dirty-state handling;
- checkpoint validation;
- cleanup refusal.

Fake Herdr CLI:

- agent launch success;
- blocked;
- done;
- unknown;
- process disappears;
- malformed output.

Fake worker artifacts:

- good result;
- missing commit;
- wrong task ID;
- invalid JSON;
- stale commit;
- blocked decision.

## End-to-end test

Use a trivial fixture repo and a cheap/local scripted "agent" process that behaves like a worker:

```text
read prompt
edit file
commit
write result.json
exit
```

This can validate orchestration without paying for LLM calls.

Then run a real smoke test with Codex/Claude/Pi inside Herdr.

---

# 51. Structured execution record

Each launched agent should have a durable execution record.

Example:

```json
{
  "schemaVersion": 1,
  "id": "exec_003",
  "runId": "run_20260903_feature_x",
  "role": "worker",
  "ticketId": "002-auth-api",
  "agentProfile": "workerLarge",
  "command": ["claude"],
  "cwd": "/.../worktree",
  "herdr": {
    "paneId": "1-3",
    "agentName": "run42:T02"
  },
  "startedAt": "...",
  "finishedAt": null,
  "status": "running"
}
```

This allows recovery without guessing which pane belongs to which task.

---

# 52. Naming panes/agents

Use deterministic labels:

```text
<short-run>:<role>:<task-or-attempt>
```

Examples:

```text
fx42:worker:T01
fx42:worker:T02
fx42:review:01
fx42:fix:01
fx42:browser:01
```

This improves both CLI automation and human readability inside Herdr.

---

# 53. Orchestrator should not micromanage workers

A common failure mode would be making the Orchestrator too "smart".

Avoid:

- reading every line of worker output;
- continuously steering implementation;
- rewriting the ticket while it is being built;
- fixing code directly;
- doing its own semantic review;
- inventing project test commands when config exists;
- second-guessing settled ADR decisions.

Preferred model:

```text
Orchestrator:
  give bounded task
  wait
  validate artifact/checkpoint
  decide next workflow state
```

This keeps agent context small and architecture predictable.

---

# 54. Human control model

The system should automate routine transitions but escalate material decisions.

Human should be able to:

```text
flow status
flow history
flow pause
flow resume
flow cancel
```

Potential future commands:

```text
flow approve <decision>
flow reject <decision>
flow retry <ticket>
flow skip-check <id> --reason ...
```

Every manual override should be recorded in `history.jsonl` when history logging is enabled.

---

# 55. Parallelism extension design

Do not implement yet, but preserve this conceptual path.

Matt `to-tickets` blocking edges define a frontier.

Future:

```text
readyFrontier = tickets where all blockers are done
```

For `N > 1` ready tasks:

```text
T1 → isolated worktree A → worker
T2 → isolated worktree B → worker
```

Then integrate.

Possible strategies:

1. merge task branches into integration branch;
2. rebase tasks in dependency order;
3. dedicated integration ticket/agent;
4. rerun review/checks only on integrated HEAD.

This deserves a separate design because it materially changes Git semantics.

---

# 56. Optional event-driven watcher later

When multiple workers run concurrently, an LLM should not poll all panes repeatedly.

A future deterministic watcher could:

```text
Herdr lifecycle/output events
          ↓
watcher
          ↓
runtime event log
          ↓
Orchestrator is engaged only for actionable event
```

Examples of actionable events:

- worker blocked;
- worker settled;
- worker process vanished;
- review completed;
- check failed;
- timeout.

This borrows the useful **zero-token supervision** idea from Firstmate without adopting its entire architecture.

---

# 57. Key invariants

These should eventually appear verbatim or nearly verbatim in the skill/tooling documentation.

1. **Herdr owns terminal/process mechanics, not workflow semantics.**
2. **The Orchestrator owns workflow routing and global execution-state transitions.**
3. **Git/worktree state is durable; agent conversation state is disposable.**
4. **Matt `to-tickets` tickets are the implementation task graph; do not duplicate them as internal Orchestrator tasks.**
5. **Blocking/ready state is derived from ticket edges plus execution state whenever possible.**
6. **Prefer one fresh agent context per implementation ticket.**
7. **Sequential tickets in one feature normally share one worktree.**
8. **Parallel tickets require isolated worktrees.**
9. **Workers never mutate global workflow state directly.**
10. **A worker finishing does not mean a ticket is semantically complete.**
11. **Every ticket completion requires a validated Git checkpoint.**
12. **Review is independent from deterministic verification.**
13. **A fresh reviewer is preferred over relying on author self-review.**
14. **Failure creates a bounded fix workflow, not an unlimited loop.**
15. **Only the Orchestrator/workflow helper may mark the run completed.**
16. **Completion requires all mandatory tickets, review policy, and checks to pass against final HEAD.**
17. **Destructive cleanup fails closed when preservation cannot be proven.**
18. **Existing specs/tickets/ADRs are authoritative; the Orchestrator should not casually redesign them.**
19. **Existing Matt Pocock skills remain specialized building blocks rather than being reimplemented.**
20. **The Orchestrator implementation is installed globally; each application repository owns only its repo-local `.orchestrator/` contract and the skill bootstraps that contract idempotently.**
21. **Active run state is repo-local under `.orchestrator/runs/` and gitignored by default.**

---

# 58. Example end-to-end run

Input:

```text
Spec: Implement project preferences.

Tasks:
T01 Add persistence model
T02 Add API endpoint
T03 Add settings UI
```

Dependencies:

```text
T01
 │
 ▼
T02
 │
 ▼
T03
```

Execution:

```text
Human
  │
  ▼
Orchestrator pane (Claude)
  │
  ├── flow run create
  ├── create worktree feat/preferences
  │
  ├── Herdr → new pane cwd=worktree
  │               │
  │               ▼
  │           Codex Worker
  │           T01 /implement
  │               │
  │               ▼
  │             commit A
  │             result.json
  │
  ├── validate T01
  │
  ├── close worker pane
  │
  ├── Herdr → fresh pane, same cwd
  │               │
  │               ▼
  │           Claude Worker
  │           T02 /implement
  │               │
  │               ▼
  │             commit B
  │
  ├── validate T02
  │
  ├── Herdr → fresh pane, same cwd
  │               │
  │               ▼
  │           Codex Worker
  │           T03 /implement
  │               │
  │               ▼
  │             commit C
  │
  ├── validate T03
  │
  ├── Herdr → fresh Pi reviewer
  │               │
  │               ▼
  │         /code-review BASE...HEAD
  │               │
  │               ▼
  │          review passes
  │
  ├── run deterministic checks
  │       format ✓
  │       lint ✓
  │       typecheck ✓
  │       test ✓
  │       build ✓
  │       browser ✗
  │
  ├── generate fix brief
  │
  ├── Herdr → fresh fixer pane
  │               │
  │               ▼
  │            Codex
  │               │
  │               ▼
  │             commit D
  │
  ├── re-review / rerun checks
  │               │
  │               ▼
  │             all ✓
  │
  └── run → completed
```

At any point the Orchestrator process can disappear. A fresh Orchestrator can resume from state + events + Git + Herdr execution records.

---

# 59. Open design decisions for implementation

These do not block initial prototyping but should be resolved explicitly.

## 59.1 TypeScript vs Python

Current recommendation: TypeScript if Playwright/XState integration is expected; otherwise Python is equally valid.

## 59.2 Task source adapter

Initial V1 can accept local markdown task files.

Later adapters can normalize:

- Matt local tickets;
- GitHub issues;
- Linear issues.

Avoid coupling state machine internals to one tracker.

## 59.3 Commit responsibility

Preferred: worker commits its own task, matching Matt `implement`.

Alternative: worker leaves changes and Orchestrator commits after validation.

Current recommendation: **worker commits**, Orchestrator validates.

## 59.4 Reviewer write access

Preferred: reviewer does not modify code.

Enforcement can initially be prompt-based + Git diff validation.

Later a reviewer can run in a read-only clone/worktree if needed.

## 59.5 Cleanup

Decide whether completed worktrees are:

- preserved by default until manual cleanup;
- removed after branch delivery;
- retained for N days.

Safe default for V1: preserve until explicit cleanup.

---

# 60. First implementation milestone

The first genuinely useful proof of concept should be deliberately narrow:

```text
one repo
one approved two-task spec
one worktree
sequential workers
Herdr
Codex worker
Pi reviewer
one check command
one fixer retry
JSON state
JSONL events
restart/resume
```

If this works reliably, the architecture is validated.

Do not judge success by number of agents.

Judge it by whether this workflow can recover from:

- worker failure;
- malformed result;
- failed tests;
- reviewer findings;
- Orchestrator restart;
- dirty worktree;
- Herdr agent state ambiguity.

---

# 61. Definition of done for the project MVP

The orchestrator MVP is done when a user can say:

> "Implement this spec."

and then observe:

1. the Orchestrator creates/resumes a durable run;
2. it creates a safe feature worktree;
3. it identifies the first task;
4. it opens a new Herdr pane at the worktree path;
5. it launches the configured worker agent;
6. it sends the worker a bounded task prompt;
7. worker completes and leaves commit + structured result;
8. Orchestrator validates the checkpoint;
9. the next fresh worker is launched for the next task;
10. implementation finishes;
11. a fresh reviewer is launched;
12. review findings become a durable artifact;
13. deterministic checks run with captured logs/artifacts;
14. failures produce a bounded fixer brief;
15. a fresh fixer is launched if needed;
16. final required checks pass;
17. state becomes `completed`;
18. killing/restarting the main Orchestrator at an intermediate point does not lose the workflow.

---

# 62. Recommended first files to create

A new LLM starting implementation should probably begin with:

```text
SKILL.md
references/worker-contract.md
references/state-machine.md
scripts/flow

src/state/schema.ts
src/state/transitions.ts
src/state/store.ts
src/state/events.ts

src/git/worktree.ts
src/git/checkpoint.ts

src/herdr/cli.ts
src/herdr/agent.ts

src/execution/worker.ts

schemas/ticket-result.schema.json

install-skill.sh
```

Then write tests before adding reviewer/fixer complexity. Build and install the packaged skill into `~/.agents/skills/orchestrate/` before real Codex smoke tests.

---

# 63. Suggested initial `SKILL.md` skeleton

This is intentionally only a skeleton. The real skill should reference scripts/docs rather than becoming enormous.

```markdown
---
name: orchestrate
description: Run an approved coding spec/ticket workflow using fresh coding agents inside Herdr, durable state, independent review, and deterministic verification.
---

# Orchestrate

You are the workflow coordinator.

You normally do not implement project code yourself.

## Preconditions

- You must be running inside Herdr (`HERDR_ENV=1`).
- If `.orchestrator/` is missing, initialize the repository Orchestrator setup first.
- Read the repository's orchestrator configuration.
- Prefer an existing approved spec/ticket set.
- Respect CONTEXT.md, domain docs, ADRs, and settled decisions.
- Resolve skill-owned references/templates/helpers relative to the installed skill root.
- Treat the target repository/worktree as a separate root; prefer explicit repo/worktree paths for delegated operations.

## Core loop

1. Create or resume a durable workflow run.
2. Ensure the run has a safe Git worktree.
3. Read the configured ticket graph and select the next ready ticket.
4. Launch a fresh worker inside Herdr at that worktree.
5. Give it only the bounded ticket + authoritative context.
6. Wait for it to settle or block.
7. Validate its structured result and Git checkpoint.
8. Mark the ticket done only after validation.
9. Repeat for remaining tasks.
10. Launch an independent fresh reviewer.
11. Run deterministic checks.
12. If findings/failures exist, generate a bounded fix brief and launch a fresh fixer.
13. Enforce retry limits.
14. Mark the run complete only when completion invariants pass.

## Rules

- Herdr state is process state, not workflow truth.
- Workers do not modify global workflow state.
- Fresh agent context is preferred per ticket.
- Sequential tasks use the same feature worktree.
- Do not reopen settled spec/ADR decisions.
- Do not infer success from terminal prose alone.
- Do not delete worktrees when preservation cannot be proven.
```

---

# 64. Sources and external references

These are the key external systems/ideas used in this design.

## Herdr

Official documentation:

- Documentation: https://herdr.dev/docs/
- Concepts: https://herdr.dev/docs/concepts/
- CLI reference: https://herdr.dev/docs/cli-reference/
- Agent automation: https://herdr.dev/docs/agent-automation/
- Agent skill: https://herdr.dev/docs/agent-skill/

Important confirmed capabilities relevant to this design:

- panes are real terminal processes;
- panes can be created/split with explicit `--cwd`;
- agents can control Herdr from inside Herdr;
- `HERDR_ENV=1` identifies the Herdr environment;
- raw pane commands can run/send/read/wait;
- recognized coding agents can be started/prompted/read/waited via the agent API;
- Herdr lifecycle state is useful process information but should not be treated as semantic task completion.

## Matt Pocock skills

Repository:

- https://github.com/mattpocock/skills

Relevant docs/source:

- `to-spec`
  - https://github.com/mattpocock/skills/blob/main/docs/engineering/to-spec.md
- `to-tickets`
  - https://github.com/mattpocock/skills/blob/main/docs/engineering/to-tickets.md
- `implement`
  - https://github.com/mattpocock/skills/blob/main/docs/engineering/implement.md
- `code-review`
  - https://github.com/mattpocock/skills/blob/main/docs/engineering/code-review.md
- repository setup
  - https://github.com/mattpocock/skills/blob/main/docs/engineering/setup-matt-pocock-skills.md

Important ideas used here:

- specs should represent already-settled work;
- tickets are tracer-bullet vertical slices;
- tickets declare dependency/blocking edges;
- one ticket is intended to fit one fresh context;
- implementation trusts upstream decisions;
- code review should compare a fixed diff point and distinguish Standards from Spec adherence.

## Firstmate

Repository:

- https://github.com/kunchenguid/firstmate
- architecture:
  https://github.com/kunchenguid/firstmate/blob/main/docs/architecture.md

Ideas borrowed selectively:

- durable orchestration state;
- worktree isolation;
- scripts own deterministic mechanics;
- safe/fail-closed worktree handling;
- append-only status/history;
- event-driven supervision as a possible future optimization.

This project intentionally does **not** aim to reproduce Firstmate as an agent distro.

---

# 65. Final mental model for any incoming LLM

If you remember only one diagram, remember this one:

```text
                  approved SPEC / TICKETS
                           │
                           ▼
                ORCHESTRATOR AGENT
                running inside HERDR
                           │
             owns durable state machine
                           │
                           │ uses Herdr
                           ▼
                  fresh agent panes
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
          Worker        Reviewer        Fixer
       Claude/Codex     Pi/etc.      Claude/Codex
             │             │             │
             └─────── same Git worktree ─┘
                           │
                           ▼
                 deterministic checks
                           │
                           ▼
                       COMPLETE
```

And remember the responsibility split:

```text
Matt Pocock skills
    → create the spec/ticket graph and define/execute specialized engineering procedures

Orchestrator skill
    → decides workflow routing and next stage

Herdr
    → creates and controls terminal/agent processes

Tickets from `to-tickets`
    → implementation units + dependency graph

Git/worktree
    → durable implementation state

repo-local .orchestrator/runs/<run-id>/state.json (+ optional history.jsonl)
    → minimal durable execution state/history

structured artifacts
    → worker/reviewer/check/fixer protocol

scripts
    → deterministic mechanics and verification
```

The system should feel less like an "agent swarm" and more like a **small durable software-delivery engine whose transition actions happen to be executed by fresh coding agents**.

That is the architecture to preserve.
