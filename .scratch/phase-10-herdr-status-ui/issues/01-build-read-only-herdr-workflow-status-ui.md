# 01: Build the read-only Herdr workflow status UI

**What to build:** Deliver a complete local Herdr plugin that lets a user open a compact, read-only view of the current Coding Workflow Orchestrator run without inspecting JSON artifacts. The view resolves the Target repository from Herdr context, consumes the public structured status command, refreshes while open, and reports expiring summary metadata for the Herdr sidebar.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The plugin has a valid Herdr manifest and one terminal pane entrypoint that can be linked and opened using standard Herdr plugin commands.
- [ ] Opening the plugin from a Target repository context resolves that repository without requiring the user to enter its path.
- [ ] The plugin obtains workflow data only through the existing public structured status command and does not parse durable run artifacts directly.
- [ ] The panel clearly shows the Workflow package, Workflow run, Run phase, accepted/total ticket progress, current or next ticket, validation state, and Delivery result when available.
- [ ] Review attention is visibly distinct from a technical Worker failure.
- [ ] A blocked technical execution shows only its concise failure reason and diagnostic artifact reference, without full output or transcripts.
- [ ] Missing runs, ambiguous run selection, invalid repository context, and an unavailable Installed skill produce clear read-only states without guessing.
- [ ] The panel refreshes approximately once per second only while it is open and terminates cleanly when closed.
- [ ] The same refresh loop publishes compact package, ticket, step, and progress metadata with a bounded TTL so stale sidebar values expire.
- [ ] Metadata reporting is best-effort and cannot change or block the Workflow run when Herdr rejects or cannot accept it.
- [ ] The display remains understandable without color and does not expose prompts, environment variables, full JSON, unlimited stdout/stderr, transcripts, or hidden reasoning.
- [ ] The plugin exposes no operation that starts, retries, accepts, validates, integrates, pushes, or otherwise mutates a workflow.
- [ ] One public automated seam invokes the real plugin entrypoint against a real temporary Target repository and real structured status command while replacing only the outer Herdr metadata boundary.
- [ ] The automated seam verifies normal progress, Review attention, technical failure, missing/invalid context, metadata TTL, clean exit, and absence of workflow or Git mutation without introducing a general terminal UI test framework.
- [ ] Relevant documentation explains how to link, open, configure optional sidebar tokens, close, and troubleshoot the plugin.
- [ ] Focused tests and the repository's full test, typecheck, lint, format, and build gates pass.
