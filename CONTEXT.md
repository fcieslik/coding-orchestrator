# Coding Workflow Orchestrator

This context defines the language used to describe the orchestrator and its packaged skill.

## Language

**Development repository**:
The Git repository containing the orchestrator's source code, tests, and packaging machinery.
_Avoid_: Installed skill, skill directory

**Installed skill**:
An explicitly built snapshot of the orchestrator copied from the development repository into an agent's skill directory.
_Avoid_: Development repository, live checkout

**Target repository**:
The non-bare Git checkout that owns repo-local orchestration configuration and durable workflow runs.
_Avoid_: Development repository, Installed skill, Feature worktree

**Workflow run**:
A durable execution of one accepted specification, identified independently from any agent session.
_Avoid_: Agent run, session, task

**Run phase**:
The current lifecycle position of a Workflow run: `created`, `preparing`, `implementing`, `reviewing`, `checking`, `fixing`, `blocked`, `failed`, `cancelled`, or `completed`.
_Avoid_: Herdr state, agent status

**State snapshot**:
The authoritative current facts and run phase for a workflow run.
_Avoid_: Event log, agent context

**Operational history**:
The ordered audit of events observed during a workflow run, used for diagnosis and handoff rather than as workflow truth.
_Avoid_: State snapshot, issue tracker

**Run event**:
A versioned observation recorded in operational history at a specific revision of a workflow run.
_Avoid_: State snapshot, ticket

**Specification reference**:
A repository-relative reference to the accepted specification that a workflow run executes.
_Avoid_: Copied specification, ticket graph

**Blocked run**:
A recoverable Workflow run that cannot safely proceed without a resolved condition and retains the phase from which it was blocked.
_Avoid_: Failed run, cancelled run

**Run base**:
The immutable Git commit from which a Workflow run's delegated implementation begins.
_Avoid_: Starting branch, mutable base

**Feature branch**:
The Git branch owned by one Workflow run and shared by its sequential delegated work.
_Avoid_: Task branch, primary branch

**Feature worktree**:
The isolated Git worktree containing a Workflow run's Feature branch, where delegated implementation occurs.
_Avoid_: Target repository, primary checkout, task worktree

**Git checkpoint**:
An accepted commit that proves a validated point of progress on a Workflow run's Feature branch.
_Avoid_: Worker completion, uncommitted changes
