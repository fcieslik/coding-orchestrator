# 03: Install a safe skill snapshot

**What to build:** Provide a valid minimal `orchestrate` skill and safely install an explicit runtime snapshot.

**Blocked by:** 02: Complete the CLI and quality contract

**Status:** ready-for-agent

- [ ] The skill has valid metadata and only a Phase 0 placeholder body.
- [ ] The installer supports `--target <directory>` and `--force`, defaulting to `~/.agents/skills/orchestrate`.
- [ ] Only required runtime artifacts and existing optional runtime directories are copied.
- [ ] Development source, tests, dependencies, and Git metadata are excluded.
- [ ] Installation fails before modifying the destination when build artifacts are missing.
- [ ] An existing destination is preserved unless `--force` is supplied.
- [ ] Forced replacement is staged transactionally and restores the previous installation if activation fails.
- [ ] Installer tests use temporary destinations and cover fresh installation, refusal, forced replacement, allowlisting, and precondition failure.
- [ ] All Phase 0 verification commands pass.
