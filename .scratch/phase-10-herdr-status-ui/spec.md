# Phase 10 — Herdr workflow status UI

**Status:** ready-for-agent

## Problem Statement

The Coding Workflow Orchestrator already records durable workflow evidence, but the user must inspect CLI output or open JSON artifacts to understand the current implementation status. This makes ordinary questions—what package is active, which ticket is running, how many tickets are complete, whether validation passed, or why a run is blocked—needlessly technical.

The user works inside Herdr and wants this information available there in a concise, UI-friendly form. The solution must preserve the existing durable evidence model, remain read-only, and avoid introducing a web server or a second source of workflow truth.

## Solution

Provide a small local Herdr plugin that presents the current Coding Workflow Orchestrator status inside Herdr.

The plugin exposes an on-demand terminal popup or overlay. It resolves the Target repository from the Herdr invocation context, queries the Orchestrator through its existing public status command, and renders a compact board containing the Workflow package, Workflow run, Run phase, ticket progress, current or next ticket, validation state, Delivery result, Review attention, and the latest bounded failure reason when present.

While the panel is open, it refreshes at a small fixed interval and publishes a compact subset of the same information as Herdr workspace metadata for display in the sidebar. The metadata expires after the reporter stops refreshing it, preventing stale status from appearing authoritative.

The plugin never mutates workflow state. Durable Orchestrator artifacts remain the only source of truth; the plugin is only a presentation layer.

## User Stories

1. As a user, I want to open the current workflow status from Herdr, so that I do not need to locate and read JSON files.
2. As a user, I want the status view to use the repository associated with my current Herdr context, so that I do not need to paste repository paths.
3. As a user, I want to see the active Workflow package, so that I know which prepared feature is being executed.
4. As a user, I want to see the Workflow run identifier, so that I can correlate the display with durable artifacts when diagnosis is required.
5. As a user, I want to see the current Run phase in plain language, so that I know whether implementation, validation, or delivery is in progress.
6. As a user, I want to see accepted tickets compared with the total ticket count, so that implementation progress is visible at a glance.
7. As a user, I want each ticket shown with a compact pending, active, accepted, or attention state, so that I understand the queue without opening ticket files.
8. As a user, I want to see the current ticket while a Worker is active, so that I know what is being implemented.
9. As a user, I want to see the next available ticket after a Workflow step completes, so that I know what I can request next.
10. As a user, I want to see when all tickets are implemented but deterministic validation has not run, so that implementation completion is not confused with workflow completion.
11. As a user, I want to see the latest deterministic validation status, so that I know whether the implementation passed the configured quality gate.
12. As a user, I want to see the selected Delivery channel and result, so that I know whether the validated work was integrated locally or handed off as a Pull Request.
13. As a user, I want Review attention displayed separately from technical failure, so that I know whether I must make a product or scope decision rather than repair infrastructure.
14. As a user, I want a blocked run to show a concise reason, so that the smallest next action is visible without reading the complete Execution record.
15. As a user, I want the diagnostic artifact reference available when a concise reason is insufficient, so that detailed evidence remains reachable.
16. As a user, I want the panel to update while it remains open, so that I can observe progress without repeatedly reopening it.
17. As a user, I want a short workflow summary visible in the Herdr sidebar while the status reporter is active, so that progress remains available when I return to the agent list.
18. As a user, I want sidebar metadata to expire when it is no longer refreshed, so that an old status is not mistaken for the current truth.
19. As a user, I want a clear empty state when no Workflow run exists, so that absence of work is not presented as an error.
20. As a user, I want a clear ambiguity or repository error when the current context cannot resolve one run safely, so that the plugin never guesses.
21. As a user, I want the status panel to be read-only, so that viewing progress cannot accept tickets, retry Workers, run validation, integrate branches, push commits, or create Pull Requests.
22. As a user, I want to close the panel without affecting the Orchestrator or its agents, so that inspection has no workflow side effects.
23. As a maintainer, I want the plugin to consume the public Orchestrator status contract, so that it does not duplicate parsing rules for durable artifacts.
24. As a maintainer, I want workflow semantics to remain independent from the plugin, so that a missing or broken UI cannot block implementation.
25. As a maintainer, I want one small terminal renderer instead of a frontend framework, so that the POC remains easy to understand and maintain.
26. As a maintainer, I want one public integration seam for automated tests, so that behavior is verified without coupling tests to rendering helpers.
27. As a maintainer, I want a real Herdr smoke test before declaring the feature complete, so that manifest linking, context resolution, popup rendering, and metadata reporting are proven together.

## Implementation Decisions

- Build a local Herdr plugin rather than a web application. The plugin consists of a Herdr manifest and a small executable terminal renderer using the project's existing runtime and dependencies.
- Treat the plugin as a read-only presentation adapter. It may query status and report visual metadata, but it must not expose or call workflow mutation operations.
- Use the existing public structured status command as the plugin's data source. Do not parse State snapshots, Execution records, validation results, or Operational history directly inside the plugin.
- Resolve the Target repository from the Herdr plugin invocation context. Do not require the user to enter a repository path during ordinary use.
- Follow existing run-selection semantics. If the public status command cannot resolve a run safely, render its concise error instead of selecting a run independently.
- Declare one terminal pane entrypoint whose default presentation is a popup or overlay. Do not implement native non-terminal UI because Herdr plugin v1 does not provide that surface.
- Render a compact text board optimized for scanning rather than reproducing complete JSON. Show the package/run identity, phase, ticket progress, active or next ticket, validation, delivery, Review attention, and latest bounded failure reason only when those values exist.
- Refresh the status at approximately one-second intervals only while the panel process is open. Do not introduce a persistent daemon, file watcher, background web server, or new event bus.
- Publish compact workspace metadata from the same refresh loop for optional sidebar display. Use a small fixed token vocabulary for package, ticket, step, and progress.
- Apply a short metadata TTL longer than the refresh interval. When the panel closes or fails, its metadata naturally disappears instead of remaining stale.
- Keep metadata visual-only. A failure to report or clear Herdr metadata must not mutate, block, fail, retry, or otherwise influence a Workflow run.
- Render semantic states consistently: pending work, active work, accepted work, Review attention, blocked technical execution, validation outcome, and Delivery outcome must remain distinct.
- Prefer plain text and stable symbols that remain understandable without color. Color may enhance the display but cannot carry meaning by itself.
- Bound all displayed diagnostic text. Show only the concise stored failure reason and artifact reference; never render full prompts, environment variables, unlimited process output, terminal transcripts, or hidden reasoning.
- Provide an explicit close interaction and terminate cleanly when the containing popup or pane closes.
- Keep plugin-owned settings minimal. The first version does not require a database, migrations, credentials, networking, or durable plugin state.
- Package or link the plugin using Herdr's standard manifest workflow. Do not modify Herdr itself.
- Keep the Installed skill and the status plugin independently usable: workflow commands work without the plugin, and the plugin reports a clear unavailable state when the Installed skill is missing.
- Do not add a new architecture decision record. This feature is a reversible presentation layer over the existing public status boundary and does not change workflow truth or ownership.

## Testing Decisions

- Use one primary automated seam: invoke the plugin's public pane entrypoint against a real temporary Target repository containing a real Workflow run, and use the real public structured status command to supply data.
- Replace only the outer Herdr command boundary in the automated test so reported workspace metadata can be captured without a live Herdr session. Do not fake the Orchestrator status model or test private renderer functions directly.
- Through this seam, assert that the terminal output and metadata contain the correct package, run, phase, accepted/total ticket progress, current or next ticket, validation state, and Delivery state.
- Through the same seam, cover one blocked Worker attempt and assert that the concise failure reason and diagnostic reference are shown without full retained stdout or stderr.
- Through the same seam, cover Review attention and assert that it remains visibly distinct from a technical Worker failure.
- Assert that an absent run and an ambiguous or invalid Target repository produce clear read-only states without workflow mutation.
- Assert that metadata uses a TTL and that the plugin exits cleanly when the panel is closed.
- Assert externally that viewing status does not change State snapshot revisions, Operational history, Git state, ticket state, validation results, or Delivery results.
- Reuse the repository's existing temporary Git-repository and public CLI test patterns. Do not introduce a general terminal UI testing framework or a broad snapshot matrix.
- After automated checks pass, perform one manual live smoke test in Herdr: link the local plugin, open it from a pane in a disposable Target repository, run one real ticket, observe the panel and sidebar before/during/after completion, close the panel, and verify the Workflow run is unchanged by inspection.

## Out of Scope

- A browser-based dashboard or local HTTP server.
- Native non-terminal Herdr UI, changes to Herdr itself, or a custom plugin SDK.
- A persistent background daemon, filesystem watcher, or additional event stream.
- Viewing or aggregating multiple Target repositories at once.
- Historical analytics, charts, search, filtering, or long-term reporting.
- Editing specifications, tickets, configuration, or Workflow runs from the status UI.
- Starting, retrying, cancelling, accepting, validating, integrating, pushing, or creating Pull Requests from the plugin.
- Replacing the State snapshot, Operational history, Execution record, Worker result, validation result, or Delivery result as workflow evidence.
- Displaying complete JSON documents, full terminal transcripts, complete stdout/stderr, prompts, environment variables, or hidden reasoning.
- Automatic modification of the user's Herdr configuration or sidebar layout.
- Remote access, authentication, authorization, networking, or multi-user operation.
- A generalized dashboard framework or plugin abstraction for unrelated workflows.

## Further Notes

- Herdr plugins are executable workflow packages that can declare actions, event hooks, and terminal pane entrypoints. Herdr plugin v1 deliberately excludes native non-terminal plugin UI: [Herdr Plugins](https://herdr.dev/docs/plugins/).
- Plugin panes may use popup, overlay, split, tab, or zoomed placement. Popup or overlay is appropriate for an on-demand status board: [Herdr Plugins — Panes](https://herdr.dev/docs/plugins/#panes).
- Herdr custom workspace metadata can expose compact tokens in configured sidebar rows. These values are presentation-only and support expiry: [Herdr Configuration — Sidebar row layouts](https://herdr.dev/docs/configuration/#sidebar-row-layouts).
- Herdr startup hooks are one-shot initialization rather than supervised daemons. Limiting refresh to the open panel avoids inventing lifecycle management that Herdr plugin v1 does not provide: [Herdr Plugins — Startup hooks](https://herdr.dev/docs/plugins/#startup-hooks).
- A future web dashboard should be reconsidered only when the product needs cross-repository aggregation, historical analytics, rich logs, remote access, or browser-based workflow controls.
