# Coding Workflow Status Herdr plugin

This is a local, read-only Herdr plugin for the Coding Workflow Orchestrator. It
opens one terminal pane beside the current pane, reads the public
`flow status --json` contract, and refreshes the display about once per second
while the status pane is open. It does
not read `.orchestrator/runs` itself and has no workflow mutation commands.

## Link and open

Build the Orchestrator first so that its public CLI exists, then link the plugin
directory from the development checkout:

```sh
pnpm build
herdr plugin link /path/to/coding-orchestrator/plugins/coding-orchestrator-status
herdr plugin pane open --plugin coding-orchestrator.status --entrypoint status --placement split
```

The pane uses the repository associated with the Herdr invocation context. It
does not ask for a repository or run path. The standard run-selection behavior
of `flow status --json` is preserved, including the no-run and ambiguous-run
states.

For an installed Orchestrator skill, point the plugin at its executable through
the environment inherited by the pane:

```sh
export ORCHESTRATOR_FLOW_PATH="$HOME/.agents/skills/orchestrate/scripts/flow"
```

When linked from this development checkout, the plugin automatically looks for
`../../scripts/flow` relative to its directory.

## Sidebar metadata

While the panel is open it best-effort reports four expiring workspace tokens:
`$package`, `$ticket`, `$step`, and `$progress`. The panel does not change Herdr's
configuration. To show them in an expanded sidebar, add a row to the user's
Herdr configuration:

```toml
[ui.sidebar.spaces]
rows = [
  ["state_icon", "workspace"],
  ["$package", "$ticket", "$step", "$progress"],
]
```

The values use a short TTL, so they disappear after the reporter stops. A
metadata rejection or missing Herdr CLI never affects the Workflow run.

## Close and troubleshoot

Press `q` or `Esc` in the status pane, or close that pane. Closing the
panel only stops its refresh loop; it does not close agents or alter workflow or
Git state.

If the panel says the context is unavailable, open it from a Herdr workspace
whose context includes a repository/worktree path. If it says the Orchestrator
is unavailable, build/link the Installed skill and set
`ORCHESTRATOR_FLOW_PATH`. A no-run message is an ordinary empty state; an
ambiguous-run message requires choosing a run explicitly in the public CLI.
