# 04: Worker Pi z provider/model override

**What to build:** A repository selecting Pi as its Worker Agent can execute the existing `implement` workflow through Herdr, optionally choosing a provider and model for that launch while preserving the common Worker result and lifecycle.

**Blocked by:** 01: Minimalne profile Agentów w konfiguracji repozytorium; 02: Wspólny kontrakt Worker–Herdr dla trzech Agentów

**Status:** ready-for-agent

- [ ] A Pi profile starts an interactive Pi Worker through Herdr using Pi's supported transport kind.
- [ ] The Worker receives the Pi skill invocation `/skill:implement` and the complete existing orchestration contract.
- [ ] `provider` and `model` are forwarded only when explicitly configured for the current launch; when omitted, Pi uses its native configuration.
- [ ] No arbitrary arguments, RPC mode, print/headless mode, credential storage, or agent configuration synchronization is introduced.
- [ ] Startup, prompt, settlement, result reconciliation, retry, and owned-pane cleanup preserve existing Worker semantics.
- [ ] An explicitly invoked live compatibility gate verifies the real binary, Herdr lifecycle, authentication, native `implement` skill, and configured provider/model when prerequisites are available; unavailable prerequisites are reported clearly and do not fail ordinary CI.
