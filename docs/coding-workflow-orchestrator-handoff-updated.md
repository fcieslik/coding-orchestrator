# Coding Workflow Orchestrator — Architecture & Implementation Handoff

> **Status:** design handoff / implementation-ready architecture  
> **Updated:** 2026-09-07 — simplified user-driven Phase 5 POC
> **Purpose:** this document is the durable context for building the project. A fresh LLM should be able to read this file, understand the intended system, and start implementation without needing the original conversation.

For Phase 5 and later, `docs/coding-orchestrator-roadmap-phase-5-onward.md` is the scope authority. The POC deliberately uses user-triggered single-ticket steps; dependency graphs, automatic queue draining and tracker integrations are future improvements.

---

## 0. Executive summary

We want to build a **durable coding-workflow orchestrator implemented primarily as an agent skill plus deterministic helper tooling**.

The system is **not** a new multi-agent framework and **Herdr is not the workflow orchestrator**.

The intended model is:

- a main **Orchestrator agent** runs inside a Herdr pane;
- Herdr is the programmable terminal/multiplexer layer;
- the Orchestrator uses Herdr to create new panes, choose their working directory, launch fresh coding agents such as Claude Code, Codex, or Pi, send them prompts, wait for them, inspect output, and close panes;
- implementation work is performed by **fresh worker agent processes**, normally one fresh context per task;
- review is performed by a **fresh reviewer agent** through the configured `code-review` skill;
- deterministic validation (formatting, linting, typechecking, tests, build, browser checks, screenshots, etc.) is performed by scripts, not trusted to agent self-report;
- if review or checks fail, the Orchestrator launches a **fresh fixer agent** with a bounded fix brief;
- durable workflow state lives outside the agents' conversation contexts;
- Git/worktrees, commits, structured result artifacts, state snapshots, and append-only events are the durable memory of the workflow;
- existing Matt Pocock engineering skills should remain responsible for planning/specification/implementation/review methodology where appropriate; this project fills the missing orchestration layer between those skills and repeated fresh agent sessions.

The core idea can be summarized as:

> **Agents are ephemeral. The workflow is durable. Herdr hosts and controls terminal processes. Git carries code state. Artifacts carry semantic results. The Orchestrator decides what workflow transition happens next.**

The engineering-method boundary is equally important:

> **Skills define engineering methodology. The Orchestrator defines workflow semantics. Agent adapters define invocation syntax. Herdr defines process transport. Git and artifacts provide durable evidence.**

Worker and reviewer prompts are skill-aware wrappers, not standalone engineering methodologies. The Orchestrator must not reimplement methodology owned by downstream engineering skills; it invokes the configured skill and adds only the minimum durable execution contract.

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

Then use the higher-level agent API against the returned pane:

```bash
herdr agent start <name> \
  --kind codex \
  --pane <pane-id>
```

`agent start` requires an existing available shell pane; it does not create layout or select cwd. Raw `pane run` remains a fallback only when a demonstrated agent-API limitation requires it.

Communication can use:

```bash
herdr agent prompt <target> "<prompt>" --wait --timeout <milliseconds>
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

Herdr also treats prompts as opaque payloads. Phase 4 or Phase 6 constructs a logical skill invocation, the selected agent adapter renders it into a concrete prompt, and Herdr transports that prompt unchanged. Herdr does not know about `implement`, `code-review`, ticket semantics, review semantics, or result semantics.

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

`to-tickets` turns a plan/spec into small **tracer-bullet vertical slices**. Its tickets may declare blocking edges, but the Phase 5 POC deliberately uses filename order and does not interpret a dependency graph. Blocking edges remain useful input for a future scheduler.

Matt's design intentionally makes each ticket suitable for a fresh context window.

This aligns extremely well with this project.

Important rule:

> If good tickets already exist, the Orchestrator should normally consume them rather than inventing a new decomposition.

Task decomposition or tracker import happens before the execution workflow and produces the local Workflow package.

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

This matches the desired worker model. Worker execution must invoke the configured `implement` skill for the assigned ticket and wrap it only with the orchestration contract. It must not reproduce repository inspection, implementation, testing, or self-review methodology in its own prompt.

The workflow stores the logical skill name `implement`. A Codex renderer emits `$implement`; another agent adapter may use different syntax without changing workflow semantics.

However, our workflow should **not depend solely on the worker's internal review or self-report**. We still want an independent workflow-level reviewer and deterministic verification after the implementation phase.

## 3.4 `code-review`

Matt's `code-review` checks a diff against a fixed point along two deliberately separate axes:

1. **Standards** — does the code follow repository conventions/standards?
2. **Spec** — does the implementation match the originating issue/spec?

This is especially valuable as a dedicated fresh reviewer stage. Reviewer execution must invoke the configured `code-review` skill against:

```text
BASE_SHA ... HEAD
```

with the known spec path/reference.

The Orchestrator supplies the fixed range, ticket/spec references, artifact paths, and review-only contract; it does not reproduce the Standards/Spec methodology. A Codex renderer emits `$code-review`. The review process should not trust implementation-agent context.

## 3.5 Other existing skills

The user already has additional skills for activities such as deployment and specialized code review.

Those should stay specialized.

The Orchestrator should decide **when** to invoke them, not absorb their domain logic.

In other words:

```text
existing skills = expertise/procedure for a stage

orchestrator = routing + lifecycle + durable coordination
```

The core concepts must remain separate:

```text
ROLE != AGENT != SKILL

role: worker
agent: codex
skill: implement
```

Recommended V1 conceptual shape:

```ts
type ExecutionRole = "worker" | "reviewer" | "fixer";

interface RoleExecution {
  role: ExecutionRole;
  agentProfile: string;
  skill?: string;
  input: string;
  contract: ExecutionContract;
}
```

A logical role execution becomes an agent-specific prompt only at the rendering boundary:

```text
RoleExecution
    ↓
agent renderer
    ↓
rendered prompt
    ↓
Herdr
```

Do not overbuild a generic plugin framework for V1.

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

Before Herdr receives a prompt, workflow tooling constructs a logical role execution and the selected agent renderer converts its skill name to agent-specific syntax. Herdr sees only the resulting opaque text.

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
fresh configured agent + code-review skill
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

> **The prepared Workflow package owns the accepted implementation inputs. The Orchestrator records only their fixed order and execution evidence; it does not create another planning model.**

The Orchestrator only stores **execution state for existing tickets** plus workflow-stage state for review, checks, fixes, and delivery.

## 10.1 What is authoritative

Use the following responsibility split:

```text
spec
→ what is being built and why

immutable Workflow package copy
→ accepted spec + filename-ordered implementation units

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

A Workflow run freezes its ordered Ticket queue from the copied Workflow package. Persist only each ticket's snapshot reference, minimal status and accepted commit. The user may request only the first `pending` ticket.

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
      "status": "accepted",
      "commit": "def456",
      "attempt": 1
    },
    "002-auth-api": {
      "status": "active",
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
pending
active
accepted
```

Worker `blocked` or `failed` outcomes remain attempt/run outcomes owned by the existing Phase 4 lifecycle; they do not make later queue entries eligible.

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
→ workflow policy, reusable references, skill-aware wrapper templates, deterministic helper tooling

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

The reusable/default worker, reviewer, fixer, and blocked-resume templates belong to the **global skill package**, not to every target repository. Worker and reviewer defaults are skill-aware wrappers; repo-local files are explicit orchestration-contract overrides, not replacements for downstream engineering methodology.

Phase 4 exposes `flow setup`. It creates missing `.orchestrator/config.yaml`, `.orchestrator/README.md`, and the runtime ignore rule idempotently. It validates but never overwrites an existing config, README, or user ignore content; conflicts require manual resolution.

The initial config keeps role, agent, and skill distinct:

```yaml
version: 1
agents:
  codex:
    kind: codex
roles:
  worker:
    agent: codex
    skill: implement
workflow:
  workerTimeoutSeconds: 1800
  maxWorkerAttempts: 2
```

Phase 4 does not accept arbitrary child-process arguments from repo config. Worker timeout is validated in the range 60–7200 seconds.

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
            ├── input/
            │   ├── spec.md
            │   └── issues/
            │       ├── 001-auth-model.md
            │       └── 002-auth-api.md
            ├── workers/
            │   └── 002-auth-api/
            │       └── attempt-01/
            │           ├── input/
            │           │   └── ticket.md
            │           ├── execution.json
            │           └── output/
            │               └── result.json
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

The Workflow package is copied once as immutable run input. What is **not** introduced is:

```text
no live tracker mirror
no parsed dependency graph
no second internal task model
```

The run uses the immutable copy of the Workflow package captured at creation, not mutable tracker or source files.

---

# 13. Workflow package and Ticket queue

The Orchestrator consumes one prepared local Workflow package:

```text
<feature>/
├── spec.md
└── issues/
    ├── 01-first-slice.md
    └── 02-second-slice.md
```

Ticket IDs are filenames without `.md`; lexical filename order defines the fixed Ticket queue. Ticket bodies are opaque inputs to `implement`. Phase 5 does not parse status, priority or blocking edges.

Therefore the intended relationship is:

```text
local tracker / GitHub / Linear
            ↓
preparation or import process
            ↓
local Workflow package
            ↓
Orchestrator executes one explicit ticket step
```

Workers receive one immutable Ticket input snapshot as their only implementation scope and the run-owned immutable `spec.md` as read-only feature context. They neither discover tickets nor know the upstream tracker; other tickets and internal Orchestrator documentation are not official Worker inputs. Target-repository guidance remains discoverable from the worktree, for example through `AGENTS.md`.

## 13.1 User-driven execution

```text
$orchestrate <workflow-package> <ticket-id>
    ↓
create or resume run
    ↓
validate that ticket-id is the first pending entry
    ↓
fresh Worker → commit → accepted checkpoint
    ↓
return control to user
```

One Workflow run, Feature branch and Feature worktree span the whole package. Each ticket uses a fresh Worker. Repeating an accepted ticket is an idempotent no-op; requesting a later ticket early is rejected. Repeating the same blocked ticket is an explicit resume request and may launch one fresh bounded retry only after reconciliation proves a clean unchanged checkpoint, unambiguous artifacts, safe cleanup and remaining attempt budget.

## 13.2 Tracker boundary

Phase 5 has no GitHub/Linear API, tracker adapter or write-back. Future importers may normalize remote tracker data into the local Workflow package, and future exporters may publish results back. These remain outside the execution engine.

## 13.3 When no tickets exist

The execution workflow fails clearly when the package lacks a regular `spec.md` or at least one regular `issues/*.md` ticket. Planning and ticket creation happen before Orchestrator execution:

```text
spec → to-tickets/importer → Workflow package → Orchestrator execution
```

---

# 14. Orchestrator behavior: what belongs in `SKILL.md`

The Orchestrator skill should contain **judgment and policy**, not implementation mechanics.

It should teach the main agent to:

1. establish that it is running inside Herdr;
2. identify the prepared local Workflow package and explicit ticket ID;
3. require the fixed `spec.md` + `issues/*.md` package layout;
4. avoid reopening settled product/design decisions;
5. create or resume the one run associated with that package;
6. use the immutable package copy owned by the run;
7. create one Feature worktree shared by all tickets in the run;
8. validate that the requested ticket is the first pending queue entry;
9. construct a worker role execution using the configured `implement` skill;
10. render the logical skill invocation for the selected agent;
11. launch a fresh worker using Herdr and send the rendered wrapper prompt;
12. wait for completion/blocking;
13. validate the Git checkpoint and any worker artifact;
14. record ticket execution state;
15. return control after at most one ticket;
16. make a repeated accepted-ticket request an idempotent no-op;
17. stop on blocked, failed or ambiguous execution;
18. treat a repeated request for the same blocked ticket as an explicit resume request, but launch a fresh bounded retry only after safe reconciliation;
19. mark the run implementation-complete only after the final ticket is accepted;
20. surface meaningful blockers to the human;
21. resume correctly after context/process restart by reading repo-local durable state.

The skill should explicitly say:

```text
You coordinate the workflow.
You normally do not implement project code yourself.

Prefer existing approved specs and tickets.
Do not reopen settled product decisions.

Delegate implementation to fresh workers.
Delegate semantic review to a fresh reviewer.
Invoke configured downstream skills for implementation and review.
Add orchestration contracts; do not restate downstream methodology.
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
5. send the already-rendered worker prompt as an opaque payload;
6. store Herdr identity in `execution.json`;
7. wait for lifecycle state or inspect output;
8. handle blocked/unknown cases deliberately;
9. validate result and Git without mutation;
10. close only the owned pane;
11. revalidate and atomically accept the attempt/checkpoint under the run lock.

Conceptually:

```bash
PANE_JSON="$(
  herdr pane split --current \
    --direction right \
    --cwd "$WORKTREE" \
    --no-focus
)"

PANE_ID="<parse .result.pane.pane_id>"

AGENT_NAME="run42-t01-codex"
herdr agent start "$AGENT_NAME" --kind codex --pane "$PANE_ID" -- \
  -C "$WORKTREE" \
  --add-dir "$ATTEMPT_OUTPUT" \
  --sandbox workspace-write \
  --approve-for-me
```

Then:

```bash
herdr agent prompt "$AGENT_NAME" "$PROMPT" --wait --timeout 120000
```

The implementation should prefer the highest-level reliable Herdr primitive for coding agents and keep raw pane operations as the escape hatch. The Herdr adapter must neither construct nor interpret skill invocations.

## 15.3 Waiting

Waiting should not mean:

```text
poll terminal every 2 seconds with an LLM
```

Prefer Herdr wait primitives.

Examples include agent lifecycle waits and output waits.

When the wait returns:

- `done` / `idle` → inspect structured result and repository state;
- `blocked` → capture bounded diagnostics, close the owned pane, and block the run; do not conduct an automatic dialogue;
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

# 16. Skill-aware worker contract

Every worker invocation has exactly three conceptual parts:

1. the configured downstream skill invocation;
2. its input, normally the assigned ticket reference;
3. the orchestration contract.

The logical workflow request is independent of agent syntax:

```text
role: worker
skill: implement
input: /absolute/runtime/path/attempt-01/input/ticket.md
```

The selected agent renderer converts this to a concrete wrapper. For Codex:

```markdown
$implement "/absolute/runtime/path/attempt-01/input/ticket.md"

Orchestration contract:

- Run: run_20260903_feature_x
- Ticket: 002-auth-api
- Worktree: /absolute/path/to/worktree
- Write the structured execution result to:
  /absolute/runtime/path/attempt-01/output/result.json
- Commit required: true
- Implement only the assigned ticket and work only in the provided worktree.
- Global Orchestrator workflow state is read-only.
- On a product, architecture, security, destructive-operation, credential, or human-decision blocker, do not guess. Write a `blocked` result with the smallest required decision, then stop.
- On technical failure, write a `failed` result with relevant diagnostics, then stop.
```

This wrapper does not teach the worker how to inspect, design, implement, test, or self-review software; that methodology belongs to `implement`. `$implement` is Codex syntax and must not appear in workflow state-machine semantics.

## 16.1 Worker attempt artifacts

Phase 4 accepts one explicit local Markdown ticket. Its canonical ticket ID is the filename without `.md`. The source must be a regular file inside the Target repository. Every attempt copies and hashes the source into an immutable snapshot:

```text
.orchestrator/runs/<run-id>/workers/<ticket-id>/attempt-01/
├── input/
│   └── ticket.md
├── execution.json
└── output/
    └── result.json
```

Only `output/` is writable by the worker. `execution.json` is Orchestrator-owned and stores the logical invocation, input and prompt hashes, artifact references, attempt status, Herdr identity, lifecycle observations, cleanup, timings, and at most the final 32 KiB of diagnostic output. It does not store the full prompt or transcript.

Attempt status is separate from Herdr lifecycle:

```text
prepared → running → reconciling → accepted
                              ├── blocked
                              └── failed
```

The public operations are `flow worker execute`, `flow worker reconcile`, and `flow worker retry`. They require an explicit run in `implementing`, a ready Feature worktree, and an explicit ticket; a run still in `preparing` must finish Phase 2 Git preparation first. Scheduling remains a Phase 5 concern. A repeated command never launches a duplicate worker without first reconciling the active attempt.

## 16.2 Worker result

Example:

```json
{
  "schemaVersion": 1,
  "ticketId": "002-auth-api",
  "status": "completed",
  "summary": "Added authenticated preferences API endpoint",
  "commit": "fed9870123456789fed9870123456789fed98701",
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
  "filesChanged": ["src/api/preferences.ts", "tests/preferences-api.test.ts"],
  "decisions": [],
  "notesForNextTask": [
    "Consumers should call UserPreferenceService; do not access repository directly."
  ]
}
```

A Worker result is a versioned discriminated union. `completed` requires the canonical commit and structured command results; `blocked` requires a structured blocker and smallest required decision; `failed` requires structured diagnostics. `filesChanged` and handoff notes are optional information rather than workflow truth. The worker publishes through a temporary file and atomic rename.

A worker may also report a blocker:

```json
{
  "schemaVersion": 1,
  "ticketId": "002-auth-api",
  "status": "blocked",
  "summary": "A product decision is required",
  "blocker": {
    "type": "product",
    "summary": "Spec is ambiguous about anonymous users.",
    "requiredDecision": "Choose whether anonymous users receive 401 or default preferences."
  }
}
```

## 16.3 Retry and ticket refresh

The default maximum is two attempts. A failed invocation never starts another Worker automatically, including failures before prompt delivery. A later explicit invocation may retry only after reconciliation proves that no side effects remain. After delivery, timeout, disappearance, malformed/missing result, or technical failure likewise requires explicit reconciliation. Any commit, dirty worktree, mismatched HEAD/branch, or other unknown side effect blocks rather than retries.

Retry reuses the immutable Ticket input snapshot and the same run-owned Specification input snapshot. If a human intentionally changed the source ticket, `worker retry --refresh-ticket` records the old and new hashes and creates a fresh snapshot; task changes never enter a retry silently.

---

# 17. Checkpoint validation after every worker

The worker saying "done" is insufficient.

Before accepting a Worker attempt, the Orchestrator/helper should validate at minimum:

```text
✓ expected worktree still exists
✓ branch is the expected branch
✓ HEAD is at or after task start
✓ a new commit exists when a commit is required
✓ result.json exists and parses
✓ result task ID matches assigned task
✓ reported commit exists
✓ reported commit is the canonical current HEAD and descends from the prior checkpoint
✓ there are no unexpected unresolved decisions
✓ worktree state satisfies configured cleanliness policy
✓ Ticket input snapshot and Execution record still match State snapshot
✓ Orchestrator-owned artifacts were not modified
```

Optional checks:

```text
✓ changed paths are within allowed scope
✓ task-specific validation command succeeded
✓ commit message references task/ticket
```

Validation and acceptance are deliberately separated:

```text
inspect without mutation
    → read bounded diagnostics
    → close owned pane
    → revalidate under run lock
    → atomically accept checkpoint + Worker attempt
```

If a failed or missing result accompanies no new commit and a clean worktree, the failure is conclusive and retry may be allowed. If invalid, missing, failed, or blocked output accompanies a commit or dirty worktree, the run blocks for reconciliation. The worker's declaration never overrides Git evidence.

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

# 19. Skill-aware independent reviewer stage

After all required implementation tasks are complete, launch a fresh reviewer.

Preferred reviewer properties:

- fresh context;
- read-only intent where practical;
- same worktree or a clean review checkout;
- knows fixed `BASE_SHA`;
- knows current `HEAD`;
- receives the originating spec;
- invokes the configured `code-review` skill;
- writes the required human-readable and machine-readable artifacts.

Example review prompt:

```markdown
$code-review

Review the fixed implementation range:

BASE_SHA: abc123
HEAD_SHA: fed987

Ticket: .scratch/feature/issues/002-auth-api.md
Spec: docs/specs/feature-x.md

Orchestration contract:

- This is a review-only execution; do not modify implementation code.
- Review exactly the fixed `BASE_SHA..HEAD_SHA` range.
- Write the human-readable review to: <runtime>/review/attempt-01.md
- Write the machine-readable result to: <runtime>/review/attempt-01.json
- Return pass/fail with structured findings.
- If required information is missing, write a `blocked` or `failed` artifact instead of guessing.
```

The workflow stores logical `skill = code-review`; the Codex renderer emits `$code-review`. The wrapper must not restate the Standards/Spec review methodology owned by the skill.

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

The configured downstream `code-review` skill owns:

- fixed diff point;
- Standards axis;
- Spec axis;
- keep findings separate;
- do not let one axis hide the other.

The Orchestrator owns only the fixed diff inputs, source references, read-only/no-fix rule, artifact paths, failure protocol, and artifact validation. It must also validate that the reviewer did not modify implementation code.

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
      "artifacts": ["artifacts/screenshots/mobile-nav-failure.png"]
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
  "options": ["401", "default preferences"],
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
│   │   ├── source.ts          # read immutable local Workflow package
│   │   ├── queue.ts           # validate fixed order + explicit next ticket
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
    skill: implement
    args: []

  workerLarge:
    executable: claude
    skill: implement
    args: []

  reviewer:
    executable: codex
    skill: code-review
    args: []

  fixer:
    executable: codex
    args: []
```

The Orchestrator chooses a **role**, resolves its agent profile and configured downstream skill, then creates a logical role execution:

```text
worker
reviewer
fixer
```

The project config determines which executable currently implements that role and which skill, if any, owns its engineering methodology.

```text
role != agent profile != skill

worker + codex + implement
reviewer + codex + code-review
fixer + codex + no configured skill
```

The fixer does not automatically use `implement`. It retains a bounded fixer prompt unless a dedicated fixer skill is explicitly configured.

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

Recommended Phase 5 POC:

```text
user selects exact next ticket
    ↓
run one fresh worker
    ↓
validate checkpoint
    ↓
return control to user
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

Automatic queue draining, blocking graphs and parallel frontier execution remain future improvements.

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
    skill: implement
  workerLarge:
    executable: claude
    skill: implement
  reviewer:
    executable: codex
    skill: code-review
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

# 44. Skill-aware wrappers should be generated from templates

Do not let the Orchestrator improvise worker or reviewer methodology. Their templates are skill-aware wrappers:

```text
downstream skill invocation
+ task or fixed-review input
+ orchestration contract
```

Worker and reviewer templates must not duplicate methodology owned by `implement` or `code-review`. The fixer template remains a bounded role contract unless a dedicated fixer skill is configured.

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

- explicit separation of logical skill names from agent syntax;
- easier debugging;
- easy prompt testing;
- less orchestration-context token use;
- explicit contract evolution;
- one reusable source of truth for orchestration contracts.

Agent-specific renderers supply invocation syntax. For Codex, `implement` becomes `$implement` and `code-review` becomes `$code-review`; workflow semantics must not hardcode those strings. The Orchestrator may still add a short task-specific orchestration note.

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
- a prepared local Workflow package containing `spec.md` and ordered `issues/*.md`
- a Git repository
- Herdr running
- Codex/Claude/Pi available
- project check configuration

The Orchestrator can:

1. run repo setup if `.orchestrator/` is not initialized;
2. create a repo-local run state;
3. create a feature worktree;
4. copy the Workflow package into immutable run input;
5. validate the exact ticket selected by the user as the first pending queue entry;
6. launch fresh Worker 1 in a Herdr pane;
7. send that ticket;
8. wait and validate its commit/checkpoint;
9. record the ticket as done in `state.json`;
10. return control to the user after that one ticket;
11. resume later in the same worktree with the next explicitly selected ticket and a fresh agent until implementation is complete;
12. launch a fresh reviewer;
13. ingest review result;
14. run deterministic checks;
15. if failure: launch one fresh fixer;
16. rerun required verification;
17. mark completed;
18. recover from an Orchestrator restart at any phase.
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

The skill-aware invocation correction does not change Phase 2. Finish repository identity, base, worktree, checkpoint, and cleanup safety normally; worker/reviewer prompt construction belongs to later phases.

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

Treat the rendered prompt as an opaque payload. Do not construct or interpret worker, reviewer, skill, ticket, or artifact semantics in this adapter.

Phase 3 is a feasibility gate, not only an adapter unit. It is complete when:

1. deterministic tests pass against a fake `herdr` executable; and
2. `flow herdr smoke --agent codex` passes inside a Herdr-managed pane with `HERDR_ENV=1`.

The internal TypeScript adapter exposes `launch`, `prompt`, `wait`, `read`, and `close` around an owned handle containing pane ID and agent name. It creates a sibling pane from the caller with explicit absolute cwd and `--no-focus`, uses deterministic Herdr-safe names, refuses collisions, and invokes the CLI through an injectable argv-based command runner rather than shell-built command strings.

`wait` reports `settled`, `blocked`, `unknown`, `timed-out`, or `disappeared`. Invocation and protocol failures remain explicit errors. These are transport observations, never ticket-completion decisions.

The smoke challenge uses a nonce, multiline content, literal `$implement`, and expected cwd. Passing requires successful agent detection, opaque prompt delivery, settled lifecycle, readable matching output, and closure of only the pane created by the command. `--keep-pane` is diagnostic and cannot produce a full passing gate. JSON is emitted to stdout and may optionally be copied to an output file without mutating workflow state.

Mocked coverage includes launch success, blocked, done, unknown, timeout, process disappearance, malformed JSON, non-zero exits, partial-launch cleanup, name collision, byte-for-byte prompt forwarding, and bounded diagnostics. The real smoke is explicit and opt-in; `pnpm test` must not launch an interactive agent.

Do not yet create a generic terminal abstraction unless needed.

## Phase 4 — skill-aware worker execution

Implement:

- logical worker role/skill invocation;
- configured implementation skill (`implement`);
- worker orchestration-contract generation;
- agent-specific skill rendering, including Codex `$implement`;
- skill-aware worker wrapper prompt;
- execution record;
- worker result schema;
- blocker/failure result handling;
- ticket checkpoint validation;
- retry count.

Use one sequential ticket first.

## Phase 5 — user-driven ticket steps

Implement:

- strict local Workflow package validation (`spec.md` + `issues/*.md`): regular non-empty files, safe unique Ticket IDs and valid owned configuration, without parsing downstream implementation methodology from Markdown;
- immutable package copy and fixed filename-ordered Ticket queue;
- `$orchestrate <workflow-package> <ticket-id>` operator interface;
- one explicit ticket per user-triggered Workflow step;
- validation that the selected ticket is the first pending entry;
- one shared Feature worktree with a fresh agent per ticket;
- minimal `pending | active | accepted` state and accepted commit;
- idempotent accepted-ticket replay and durable resume;
- explicit same-ticket blocked resume with safe reconciliation and bounded fresh retry;
- dispatch of the selected Ticket input snapshot to Phase 4.

Do **not** add a dependency graph, automatic scheduler, queue-draining loop, tracker API or write-back in the POC.

## Phase 6 — skill-aware independent reviewer

Implement:

- fixed `BASE_SHA`/`HEAD_SHA`;
- logical reviewer role/skill invocation;
- configured review skill (`code-review`);
- agent-specific rendering, including Codex `$code-review`;
- review orchestration contract and artifact paths;
- skill-aware reviewer wrapper prompt;
- review result schema with closed execution status and structured findings using `low | medium | high | critical` severity;
- deterministic reducer that maps validated reviewer output and a declared blocking threshold to pass/fail/blocked without LLM interpretation;
- artifact-only handoff from the fixed diff and spec/ticket references to `review.md` and `review.json`;
- validation that reviewer did not modify implementation code.

## Phase 7 — deterministic checks

Implement:

- YAML config;
- command execution;
- stdout/stderr capture;
- timeout;
- aggregate check result.

## Phase 8 — fixer

Implement later, after the manual Phase 6 failure policy proves insufficient:

- fix brief synthesis from review/check artifacts;
- fresh fixer launch;
- result validation;
- bounded retries with an explicit stop condition;
- a distinct numbered work unit and artifact set for every repair and re-review attempt; do not model iteration as a cyclic edge back to an ancestor stage.

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
- logical role/skill invocation construction;
- Codex skill rendering (`implement` → `$implement`, `code-review` → `$code-review`);
- skill-aware wrapper prompt construction;
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

Herdr tests remain unaware of skill semantics and assert that rendered prompts are transported unchanged.

Fake worker artifacts:

- good result;
- missing commit;
- wrong task ID;
- invalid JSON;
- stale commit;
- blocked decision.

Worker prompt tests assert `$implement`, assigned ticket, result path, blocker protocol, and commit requirement, without a duplicated implementation methodology. Reviewer prompt tests assert `$code-review`, fixed base/head, ticket/spec references, output paths, and the no-code-modification contract, without a duplicated Standards/Spec methodology.

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
  "skill": "implement",
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
22. **Skills define engineering methodology; the Orchestrator adds only workflow semantics and the minimum execution contract.**
23. **Worker and reviewer prompts are skill-aware wrappers, not standalone engineering methodologies.**
24. **Agent-specific skill invocation syntax belongs to the agent renderer, not workflow semantics.**
25. **Herdr transports already-rendered prompts as opaque payloads.**
26. **Execution role, agent profile, and downstream skill are distinct concepts.**
27. **A fixer uses a bounded fixer contract unless a dedicated fixer skill is explicitly configured.**

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
  │           $implement T01
  │           + orchestration contract
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
  │           $implement T02
  │           + orchestration contract
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
  │           $implement T03
  │           + orchestration contract
  │               │
  │               ▼
  │             commit C
  │
  ├── validate T03
  │
  ├── Herdr → fresh configured reviewer
  │               │
  │               ▼
  │         $code-review
  │         + fixed BASE_SHA..HEAD_SHA
  │         + review contract
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

## 59.2 Workflow package boundary

Phase 5 accepts only a prepared local Workflow package with `spec.md` and filename-ordered `issues/*.md`. A preparation process may use Matt local tickets, GitHub or Linear as its source, but the execution engine has no tracker API dependency.

Future importers may normalize remote sources into this package, and separate exporters may perform status write-back. Workers remain unaware of both directions.

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
Codex reviewer using code-review
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
6. it renders the configured `implement` skill for the selected agent and sends the ticket plus orchestration contract;
7. worker completes and leaves commit + structured result;
8. Orchestrator validates the checkpoint;
9. the next fresh worker is launched for the next task;
10. implementation finishes;
11. a fresh reviewer is launched with the configured `code-review` skill against fixed `BASE_SHA..HEAD_SHA`;
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

1. Accept a prepared local Workflow package and exact ticket ID.
2. Create or resume its durable workflow run and safe shared Feature worktree.
3. Validate that the requested ticket is the first pending entry in the immutable Ticket queue.
4. Build a logical worker invocation using the configured `implement` skill and that ticket's snapshot.
5. Render the invocation for the selected agent, add only the orchestration contract, and launch a fresh worker inside Herdr at that worktree.
6. Wait for it to settle or block.
7. Validate its structured result and Git checkpoint.
8. Mark the ticket accepted only after validation.
9. Return control to the user after this one ticket; a later invocation advances the same run.
10. After implementation is complete, later phases launch an independent reviewer and deterministic validation stages.

## Rules

- Herdr state is process state, not workflow truth.
- Herdr transports already-rendered prompts without interpreting skill semantics.
- Workers do not modify global workflow state.
- Fresh agent context is preferred per ticket.
- Sequential tasks use the same feature worktree.
- Skills own engineering methodology; orchestration wrappers contain only task inputs and workflow contracts.
- Agent-specific invocation syntax belongs to the agent renderer, not workflow semantics.
- Do not automatically use `implement` for fixing unless a dedicated fixer skill is configured.
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
                 prepared Workflow package
                           │
                           ▼
                ORCHESTRATOR AGENT
                running inside HERDR
                           │
             owns durable state machine
                           │
                           ▼
                 logical RoleExecution
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
          Worker        Reviewer        Fixer
       implement      code-review   bounded contract
             └─────────────┼─────────────┘
                           │
                    agent renderer
                           │
                           ▼
                   rendered prompt
                           │
                           ▼
                Herdr → fresh agent pane
                           │
                           ▼
                  same Git worktree
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
    → define specialized engineering methodology, including implement and code-review

Orchestrator skill
    → decides workflow routing and next stage; supplies task inputs and execution contracts

Agent renderers
    → convert logical skill names to agent-specific invocation syntax

Herdr
    → transports opaque rendered prompts and controls terminal/agent processes

Workflow package
    → accepted spec + filename-ordered implementation units

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
