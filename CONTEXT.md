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

**Workflow package**:
The prepared local input containing one accepted specification and an ordered set of Markdown tickets, independent of the tracker where they originated.
_Avoid_: Remote tracker, Workflow run, ticket graph

**Blocked run**:
A recoverable Workflow run that cannot safely proceed without a resolved condition and retains the phase from which it was blocked.
_Avoid_: Failed run, cancelled run

**Run base**:
The immutable Git commit from which a Workflow run's delegated implementation begins.
_Avoid_: Starting branch, mutable base

**Feature branch**:
The Orchestrator-owned Git branch checked out in the Feature worktree and shared by one Workflow run's sequential delegated work. It starts at the Run base but is not the user's Integration target branch.
_Avoid_: Integration target branch, task branch, primary branch

**Integration target branch**:
The user-owned local Git branch from which a Workflow run starts and which may receive the validated Feature branch through an explicit safe integration step.
_Avoid_: Feature branch, primary checkout, Run base

**Feature worktree**:
The isolated Git worktree containing a Workflow run's Feature branch, where delegated implementation occurs.
_Avoid_: Target repository, primary checkout, task worktree

**Git checkpoint**:
An accepted commit that proves a validated point of progress on a Workflow run's Feature branch.
_Avoid_: Worker completion, uncommitted changes

**Execution role**:
The workflow responsibility assigned to one agent execution: `worker`, `reviewer`, or `fixer`.
_Avoid_: Agent, skill

**Agent profile**:
The configured agent executable and launch settings used to perform an Execution role.
_Avoid_: Execution role, downstream engineering skill

**Downstream engineering skill**:
An existing skill that owns the methodology for a delegated engineering activity, such as `implement` or `code-review`.
_Avoid_: Execution role, prompt template

**Skill invocation**:
A logical request to apply a Downstream engineering skill to a specific input under an Orchestration contract.
_Avoid_: Rendered prompt, agent command

**Orchestration contract**:
The workflow-specific constraints and evidence requirements attached to a delegated execution, excluding engineering methodology.
_Avoid_: Implementation instructions, review methodology

**Worker attempt**:
One bounded execution of an assigned ticket by a fresh worker, with its own immutable input and output artifacts.
_Avoid_: Workflow run, ticket, agent session

**Ticket input snapshot**:
The immutable copy of an assigned ticket used as the input to one Worker attempt.
_Avoid_: Mutable ticket reference, ticket graph

**Specification input snapshot**:
The immutable copy of the Workflow package specification supplied to a Worker as read-only feature context. The assigned Ticket input snapshot remains the only implementation scope.
_Avoid_: Mutable source specification, Ticket input snapshot

**Worker result**:
The structured, worker-owned outcome artifact for one Worker attempt. It is evidence consumed by the Orchestrator, not workflow truth by itself.
_Avoid_: State snapshot, Git checkpoint, terminal output

**Execution record**:
The Orchestrator-owned durable record of one Worker attempt, including its logical invocation, owned Herdr identity, lifecycle observations, and artifact references.
_Avoid_: Worker result, State snapshot, terminal transcript

**Active execution**:
The Worker attempt currently associated with a Workflow run and requiring launch, observation, reconciliation, or finalization.
_Avoid_: Active agent, ready ticket

**Ticket queue**:
The fixed, ordered list of tickets copied from a Workflow package and executed sequentially by one Workflow run.
_Avoid_: Ticket graph, scheduler

**Workflow step**:
One user-triggered advancement of a Workflow run that executes at most the next pending ticket and then returns control to the user.
_Avoid_: Workflow run, automatic scheduler

**Accepted ticket**:
A ticket whose Worker attempt produced a validated Git checkpoint recorded in the Workflow run state.
_Avoid_: Worker finished, ticket file status

**Execution reconciliation**:
The fail-closed comparison of an interrupted or ambiguous Worker attempt against its Execution record, Worker result, Git state, and owned Herdr identity before deciding whether it may be accepted or retried.
_Avoid_: Automatic retry, terminal inspection

**Agent renderer**:
The adapter that converts a Skill invocation into the invocation syntax understood by an Agent profile.
_Avoid_: Workflow engine, Herdr adapter

**Herdr feasibility gate**:
A live validation that proves the Orchestrator can control one fresh coding-agent lifecycle through Herdr before worker workflow semantics are built on top of it.
_Avoid_: Unit test suite, ticket completion check
