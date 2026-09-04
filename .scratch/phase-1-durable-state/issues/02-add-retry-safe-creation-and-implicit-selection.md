# 02: Add retry-safe creation and implicit run selection

**What to build:** Make Workflow run creation safe to retry and convenient for interactive use. Users can rely on generated identifiers and repository discovery, while the Orchestrator can supply an identifier for idempotency. Status and history can select an unambiguous run without silently guessing.

**Blocked by:** 01: Create and inspect an explicit Workflow run.

**Status:** ready-for-agent

- [ ] Omitting the run ID generates an identifier in the approved UTC-time-plus-12-hex format using cryptographic randomness.
- [ ] Identifier generation retries a filesystem collision without overwriting an existing run.
- [ ] Supplying an existing valid run ID with the same Specification reference returns the existing run successfully without duplicating history.
- [ ] Supplying an existing run ID for a different specification or malformed run is refused without changing persisted bytes.
- [ ] Distinct run IDs may reference the same specification.
- [ ] Omitting the repository discovers the nearest non-bare Git worktree root from the current directory.
- [ ] Linked Git worktrees are accepted as Target repositories.
- [ ] Repository-sensitive commands continue to honor an explicit repository over current-directory inference.
- [ ] An explicit run ID always selects that run for status and history.
- [ ] Without an ID, status and history select the sole nonterminal run.
- [ ] When no nonterminal run exists, implicit selection falls back only when exactly one total run exists.
- [ ] Zero candidates and multiple eligible candidates fail with guidance; ambiguity output includes the candidate run IDs.
- [ ] Human failures use stderr and the agreed exit categories; structured mode emits a stable error object with code, message, and optional details.
- [ ] Injected clock and randomness make identifier, collision, and backward-clock scenarios deterministic without test sleeps.
- [ ] Subprocess tests cover repository discovery, generated IDs, idempotent retry, duplicate-spec runs, linked worktrees, and every implicit-selection outcome.

