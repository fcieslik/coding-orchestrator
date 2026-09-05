# 01: Initialize the worker orchestration contract

**What to build:** Let a target project initialize and validate the smallest repo-local contract required for skill-aware Worker execution. Setup establishes the configured worker role, Codex Agent profile, `implement` Downstream engineering skill, worker timeout, attempt budget, documentation, and ignored runtime area without overwriting project-owned policy.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] `flow setup` creates the missing repo-local orchestration configuration, explanatory documentation, and runtime ignore rule in a valid Target repository.
- [x] The default configuration keeps Execution role, Agent profile, and Downstream engineering skill separate and maps the worker role to Codex plus `implement`.
- [x] The default worker timeout is 1,800 seconds and the default maximum number of Worker attempts is two.
- [x] Configuration validation accepts worker timeouts from 60 through 7,200 seconds and rejects missing role/profile references, unsupported versions, invalid limits, and unsupported live-worker kinds.
- [x] Version 1 does not accept arbitrary child-agent process arguments from repository configuration.
- [x] Repeating setup against an already valid project is an exact no-op.
- [x] Setup creates missing files only; it never overwrites an existing configuration, documentation file, or user ignore content.
- [x] Invalid or conflicting existing setup fails with actionable human and structured diagnostics instead of repairing policy automatically.
- [x] The configuration contract has runtime validation and a generated schema included in schema-drift and installed-package checks.
- [x] Public CLI tests cover creation, repetition, partial existing setup, invalid configuration, unsupported versions, repository errors, and preservation of user content.
