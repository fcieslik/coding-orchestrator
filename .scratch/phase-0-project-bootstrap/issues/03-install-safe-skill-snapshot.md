# 03: Install a safe skill snapshot

**What to build:** Provide a valid minimal `orchestrate` skill and safely install an explicit runtime snapshot.

**Blocked by:** 02: Complete the CLI and quality contract

**Status:** completed

- [x] The skill has valid metadata and only a Phase 0 placeholder body.
- [x] The installer supports `--target <directory>` and `--force`, defaulting to `~/.agents/skills/orchestrate`.
- [x] Only required runtime artifacts and existing optional runtime directories are copied.
- [x] Development source, tests, dependencies, and Git metadata are excluded.
- [x] Installation fails before modifying the destination when build artifacts are missing.
- [x] An existing destination is preserved unless `--force` is supplied.
- [x] Forced replacement is staged transactionally and restores the previous installation if activation fails.
- [x] Installer tests use temporary destinations and cover fresh installation, refusal, forced replacement, allowlisting, and precondition failure.
- [x] All Phase 0 verification commands pass.
