# Orchestration contract

This directory contains the repository-local contract used by the Coding Workflow Orchestrator.

- `.orchestrator/config.yaml` is shared project policy. It selects the Worker role, Agent profile, downstream engineering skill, timeout, and attempt budget.
- `.orchestrator/runs/` contains ephemeral Workflow state and is intentionally ignored by Git.
- `workflow.validation` in `.orchestrator/config.yaml` defines exactly five validation commands (`test`, `lint`, `typecheck`, `formatCheck`, `build`) plus one `timeoutSeconds` applied independently to each command. `flow validate` runs them sequentially in that fixed order in the final Feature worktree. The default commands assume a pnpm project; adapt them to this repository before validating a completed Workflow run.
- Agent profiles select the native Worker executable with `kind: codex`, `kind: claude-code`, or `kind: pi`. Optional `provider` and `model` values are one-launch overrides; when omitted, the selected Agent uses its native configuration. For example, Pi may be configured as:

  ```yaml
  agents:
    pi-openai:
      kind: pi
      provider: openai
      model: gpt-5.6-luna
  ```

- Workers may write only their assigned Feature worktree and their preallocated result output directory. They must not modify Workflow state or the execution record.

The version 1 default Worker uses the Codex Agent profile and the `implement` skill. Timeout values are limited to 60–7,200 seconds and the attempt budget is bounded. Agent process arguments are deliberately not configurable in version 1.
