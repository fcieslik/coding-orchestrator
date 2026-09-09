# 01: Validate a completed Workflow run

**What to build:** Add one public deterministic validation operation that resolves a completed Workflow run from its Workflow package, executes its explicitly configured `test`, `lint`, and `typecheck` commands against the final accepted Feature worktree, and durably records whether that exact HEAD passed all three checks.

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] Repository-local configuration defines exactly three named validation commands—`test`, `lint`, and `typecheck`—plus one per-command timeout, without introducing generic stages or YAML sequences.
- [x] Repository setup creates a valid, documented default validation configuration while preserving existing valid configuration according to the established setup contract.
- [x] The public validation operation accepts a Workflow package reference and resolves exactly one matching completed Workflow run without requiring a Run ID in the normal interface.
- [x] Validation refuses a missing or ambiguous run, an incomplete Ticket queue, an unavailable Feature worktree, a dirty Feature worktree, or a HEAD that differs from the final accepted Git checkpoint before starting project commands.
- [x] The three configured commands run sequentially in the fixed order `test`, `lint`, then `typecheck`, with the Feature worktree as cwd and the configured timeout applied independently to each command.
- [x] All three commands are attempted when it remains safe to run them, and each outcome records its name, exact configured command, `passed`, `failed`, or `timed_out` status, nullable exit code, duration, and bounded stdout/stderr diagnostics.
- [x] Overall validation is `passed` only when all three commands exit successfully and the Feature branch remains at the validated HEAD with a clean Feature worktree after execution.
- [x] One versioned, run-owned result is published atomically and then referenced by additive validation state containing the overall status and exact validated HEAD; Operational history records the decision without becoming workflow truth.
- [x] Phase 5 implementation completion remains distinct from Phase 6 validation status, and existing Phase 0–5 State snapshots without validation data remain readable.
- [x] Human CLI output is concise, structured output exposes the complete result, and process exit is zero only for passing validation.
- [x] The installed Orchestrator skill routes a package-validation request to the deterministic helper and does not launch a coding agent or Herdr pane.
- [x] A public-CLI integration test with a temporary real Git repository proves the passing path across configuration, Run selection, command execution, Git checks, durable publication, and reporting while leaving the primary checkout unchanged.
- [x] Relevant runtime schemas, generated schemas, setup/help output, installer expectations, documentation, and project quality checks remain consistent.
