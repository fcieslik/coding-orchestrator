# 03: Worker Claude Code

**What to build:** A repository selecting Claude Code as its Worker Agent can execute the existing `implement` workflow through Herdr and receive the same structured Worker result and lifecycle handling as Codex.

**Blocked by:** 01: Minimalne profile Agentów w konfiguracji repozytorium; 02: Wspólny kontrakt Worker–Herdr dla trzech Agentów

**Status:** ready-for-agent

- [ ] A Claude Code profile starts an interactive Claude Code Worker through Herdr.
- [ ] The Worker receives the Claude Code skill invocation `/implement` and the complete existing orchestration contract.
- [ ] An optional model override applies only to the current launch; when omitted, Claude Code uses its native configuration.
- [ ] No arbitrary arguments, session controls, trust changes, or unrestricted permission bypasses are introduced.
- [ ] Startup, prompt, settlement, result reconciliation, retry, and owned-pane cleanup preserve existing Worker semantics.
- [ ] An explicitly invoked live compatibility gate verifies the real binary, Herdr lifecycle, authentication, and native `implement` skill when prerequisites are available; unavailable prerequisites are reported clearly and do not fail ordinary CI.
