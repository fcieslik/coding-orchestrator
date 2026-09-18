# 02: Wspólny kontrakt Worker–Herdr dla trzech Agentów

**What to build:** The existing Worker launch boundary supports all configured Agent profiles through one interactive Herdr lifecycle, with agent-specific skill syntax and preserved Codex safeguards.

**Blocked by:** 01: Minimalne profile Agentów w konfiguracji repozytorium

**Status:** ready-for-agent

- [ ] The Worker launch path accepts Codex, Claude Code, and Pi profiles without introducing a second execution architecture.
- [ ] Domain profile `claude-code` maps to Herdr kind `claude`; Pi maps to Herdr kind `pi`; Codex mapping remains unchanged.
- [ ] Skill rendering uses `$implement` for Codex, `/implement` for Claude Code, and `/skill:implement` for Pi.
- [ ] The existing orchestration contract, immutable input handling, prompt hashing, result contract, and opaque prompt transport remain unchanged.
- [ ] Deterministic compatibility tests cover exact Herdr kind, child arguments, prompt delivery, handle identity, settlement, and owned-pane cleanup for every supported profile.
- [ ] Codex security validation continues to reject unrestricted permissions and arbitrary unvalidated child arguments.
