# 01: Minimalne profile Agentów w konfiguracji repozytorium

**What to build:** Repo-local orchestration configuration supports selecting Codex, Claude Code, or Pi as the Worker Agent profile, with optional per-launch `provider` and `model` overrides while native agent configuration remains the fallback.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Configuration version 1 accepts profiles with `kind` set to `codex`, `claude-code`, or `pi`, and optional string fields `provider` and `model`.
- [ ] Omitted provider/model values preserve native agent configuration semantics and do not rewrite global agent settings.
- [ ] Unknown profile kinds, unsupported fields, invalid override values, and missing role references are rejected before any Herdr pane is created.
- [ ] Existing Codex-only configuration remains valid and behaves as before.
- [ ] Configuration documentation includes a minimal Pi example using a provider and model.
