# 02: Render and launch an isolated skill-aware worker

**What to build:** Convert a configured logical Worker execution into the smallest agent-specific skill wrapper and launch a fresh Codex through Herdr with the Feature worktree as its workspace and only the assigned attempt output area as additional writable storage.

**Blocked by:** 01: Initialize the worker orchestration contract.

**Status:** completed

- [x] A logical Role execution retains distinct role, Agent profile, Downstream engineering skill, immutable input, and Orchestration contract values.
- [x] Codex renders logical `implement` using dollar-prefixed skill syntax; Claude Code and Pi render the same logical skill using slash-command syntax.
- [x] Phase 4 supports live execution only for the configured Codex Agent profile while Claude Code and Pi rendering remain pure, tested text transformations.
- [x] The wrapper contains only the Skill invocation, immutable ticket input, and workflow-specific contract covering identity, scope, result publication, commit, ownership, blocker, and failure rules.
- [x] The wrapper does not duplicate repository inspection, implementation, testing, or self-review methodology owned by `implement`.
- [x] Skill names and generated inputs are validated, paths are represented safely, and rendering never constructs a shell command.
- [x] Prompt hashes are deterministic and the full prompt is not included in routine command output or diagnostics.
- [x] The Herdr launch boundary accepts validated child-agent arguments while remaining unaware of roles, skills, tickets, and Worker result semantics.
- [x] Codex starts with the Feature worktree as its working root, the exact attempt output area as an additional writable directory, workspace-write isolation, and automatic approval review.
- [x] Launch never uses danger-full-access and never grants write access to the Target repository's complete runtime area.
- [x] The existing owned-handle, collision refusal, opaque-prompt forwarding, bounded startup/wait, and narrow-cleanup guarantees remain intact.
- [x] Tests assert exact renderer output, byte-for-byte Herdr forwarding, child argument boundaries, sandbox policy, and absence of duplicated engineering methodology.
