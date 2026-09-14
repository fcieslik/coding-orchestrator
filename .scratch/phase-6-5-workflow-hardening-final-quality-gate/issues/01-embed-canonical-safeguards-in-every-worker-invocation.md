# 01: Embed canonical safeguards in every Worker invocation

**What to build:** Add one concise, human-readable Worker safeguards policy to the runtime skill package and embed its complete contents in every final Worker prompt. Every supported Agent profile must receive the same restrictions while retaining its own downstream `implement` invocation syntax. A Worker must stay in its assigned Feature worktree, leave the primary checkout and Integration target branch untouched, avoid publication, branch integration, destructive cleanup, and loss of unlanded work, and return the existing `blocked` or `failed` result instead of guessing. The safeguards extend the Orchestration contract without duplicating implementation methodology.

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] One canonical Markdown safeguards document is included in both the Development repository runtime assets and the Installed skill package.
- [x] The complete safeguards text is embedded directly in every rendered Codex, Claude Code, and Pi Worker prompt; the Worker is not given only a file reference.
- [x] The safeguards prohibit modifying the primary checkout or Integration target branch, pushing, Pull Request operations, branch integration, deleting workflow Git resources, and discarding pre-existing or unlanded work.
- [x] The safeguards require a Worker that cannot continue safely to preserve its work, publish a valid existing `blocked` or `failed` result, and stop instead of guessing.
- [x] The safeguards do not restate repository inspection, implementation, testing, or review methodology owned by the downstream `implement` skill.
- [x] The existing prompt hash covers the complete prompt after safeguards are embedded, without adding another hash or workflow state field.
- [x] A missing or unreadable runtime safeguards asset fails before a Herdr Worker is created and reports an actionable error instead of using a fallback policy.
- [x] Renderer tests cover every supported Agent kind and fail if any material safeguard disappears while preserving the existing ticket, specification, result, and blocker contract.
- [x] Packaging and installer tests prove that the Installed skill contains and uses the same canonical safeguards document.
- [x] Focused tests and the Development repository quality checks pass without changing existing Worker result schemas or lifecycle statuses.

Implemented in commit `c736cf0`. The canonical runtime asset is packaged unchanged, all supported Agent renderers embed it, and focused safeguards, packaging, installer, and prompt-hash tests pass.
