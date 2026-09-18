# Phase 11 — Multi-agent Worker profiles

Status: ready-for-agent

## Problem Statement

The Coding Workflow Orchestrator can render a logical Worker execution for Codex and can already render partial Claude Code and Pi skill syntax, but the live launch path, repository configuration, and compatibility coverage still assume Codex. A Target repository cannot select Claude Code or Pi as its Worker Agent profile, cannot provide a small per-run provider/model override such as Pi with OpenAI and `gpt-5.6-luna`, and cannot rely on one tested Herdr launch contract for all three supported agents.

The current renderer also treats Claude Code and Pi as if they used the same slash-command syntax. Official documentation confirms that Claude Code invokes a skill as `/implement`, while Pi invokes it as `/skill:implement`. A Worker launched with the wrong syntax may start successfully but never execute the intended Downstream engineering skill.

## Solution

Extend the repo-local orchestration configuration and the live Worker launch path to support three named Agent profile kinds: Codex, Claude Code, and Pi. Keep the profile deliberately small: it selects the agent kind and may override `provider` and `model`; all other provider, model, trust, session, and agent-specific settings remain in the selected agent's native configuration.

Resolve the Worker role to the selected profile, map the domain profile name to Herdr's agent kind, render the logical `implement` Skill invocation using the selected agent's documented syntax, and launch the interactive agent through the existing Herdr lifecycle. Preserve the existing Orchestration contract, Worker result schema, Execution record, Git checkpoint rules, ownership boundaries, and opaque prompt transport.

Require the selected environment to expose the `implement` Downstream engineering skill through the native skill discovery mechanism of the chosen agent. The Orchestrator does not copy or synchronize skills between Codex, Claude Code, and Pi locations.

Test the feature primarily through the existing public Worker launch seam with a controllable Herdr runner. Add deterministic compatibility tests for exact Herdr kind, child arguments, skill invocation, prompt delivery, lifecycle settlement, and failure handling. Keep live provider/model execution out of ordinary automated tests; use disposable, explicitly invoked live gates when the required binary, authentication, Herdr session, and native skill are available.

## User Stories

1. As a user, I want to select Claude Code as the Worker Agent profile, so that implementation can run in Claude Code without changing Workflow semantics.
2. As a user, I want to select Pi as the Worker Agent profile, so that implementation can run in Pi without changing Workflow semantics.
3. As a user, I want existing Codex configuration to remain valid, so that this feature does not require a migration for current repositories.
4. As a repository owner, I want Agent profiles declared in the repo-local orchestration configuration, so that the selected Worker is portable and reviewable with the project.
5. As a repository owner, I want a Pi profile to specify `provider`, so that the repository can choose the provider used for a Worker attempt.
6. As a repository owner, I want a Pi profile to specify `model`, so that the repository can choose a concrete model such as `gpt-5.6-luna`.
7. As a repository owner, I want omitted provider/model values to fall back to Pi's native configuration, so that the Orchestrator does not duplicate Pi settings.
8. As a repository owner, I want a Claude Code profile to use its native configuration by default, so that the Orchestrator does not become a second Claude Code settings system.
9. As a repository owner, I want model overrides passed only for the current Worker launch, so that a Workflow run cannot silently rewrite a user's global agent settings.
10. As an operator, I want unsupported profile fields rejected, so that the small configuration contract does not grow accidental arbitrary CLI passthrough.
11. As an operator, I want an unknown Agent profile kind rejected before creating a Herdr pane, so that invalid configuration fails without side effects.
12. As an operator, I want a role that references a missing profile rejected before execution, so that the Orchestrator never guesses a fallback agent.
13. As an operator, I want the existing `version: 1` configuration format extended compatibly, so that Codex-only repositories keep working unchanged.
14. As an Orchestrator, I want the Worker role to remain distinct from the Agent profile, so that workflow responsibility is not coupled to one executable.
15. As an Orchestrator, I want the `implement` Downstream engineering skill to remain distinct from the Agent profile, so that methodology remains reusable across agents.
16. As an Orchestrator, I want `claude-code` to map to Herdr's `claude` kind, so that the repo-facing vocabulary remains clear while the transport uses Herdr's canonical value.
17. As an Orchestrator, I want `pi` to map to Herdr's `pi` kind, so that Pi launches through Herdr's supported agent lifecycle.
18. As an Orchestrator, I want Codex to preserve its existing child arguments and sandbox policy, so that adding profiles does not weaken the existing Worker security contract.
19. As an Orchestrator, I want Claude Code to start in interactive mode, so that it remains compatible with Herdr's `agent start` followed by `agent prompt` lifecycle.
20. As an Orchestrator, I want Pi to start in its default interactive mode, so that it remains compatible with the same Herdr prompt transport rather than requiring a second RPC execution architecture.
21. As a Claude Code Worker, I want the logical `implement` skill rendered as `/implement`, so that Claude Code invokes the project skill documented for its native skill system.
22. As a Pi Worker, I want the logical `implement` skill rendered as `/skill:implement`, so that Pi invokes the skill command documented by Pi rather than an unknown bare slash command.
23. As a Codex Worker, I want the logical `implement` skill rendered as `$implement`, so that existing Codex behavior remains unchanged.
24. As a Worker, I want the immutable Ticket input path quoted safely in the rendered invocation, so that paths with spaces cannot change prompt meaning.
25. As an Orchestrator, I want the complete existing Orchestration contract sent unchanged after the skill invocation, so that all agents receive the same run, ticket, worktree, result, commit, blocker, and failure requirements.
26. As a Worker, I want the result contract to remain agent-independent, so that Claude Code and Pi produce the same structured Worker result accepted by the Orchestrator.
27. As an Orchestrator, I want Herdr to transport the rendered prompt as opaque text, so that Herdr does not need to understand skills, tickets, or Worker results.
28. As an operator, I want startup, prompt settlement, read, and cleanup failures represented using the existing Execution record and diagnostics, so that a non-Codex failure remains recoverable and auditable.
29. As an operator, I want a failed Claude Code or Pi launch to close only the pane owned by that attempt, so that compatibility support cannot damage unrelated Herdr work.
30. As an operator, I want a missing or unavailable native `implement` skill treated as an environment/configuration problem, so that the Orchestrator does not silently substitute a different methodology.
31. As a repository owner, I want to keep native agent skill installation outside the Orchestrator, so that each agent remains responsible for its own discovery rules and trust model.
32. As a maintainer, I want the exact compatibility mapping tested for all supported profiles, so that a successful process launch cannot mask an incorrect skill invocation.
33. As a maintainer, I want configuration tests to cover Codex-only legacy input, Claude Code profiles, Pi profiles, provider/model overrides, fallback behavior, invalid fields, and invalid references.
34. As a maintainer, I want launch tests to assert the exact Herdr agent kind and child argv for each profile, so that CLI compatibility regressions are caught without a real model call.
35. As a maintainer, I want prompt tests to assert the exact agent-specific skill syntax while preserving the rest of the wrapper, so that renderer changes do not leak into workflow semantics.
36. As a maintainer, I want compatibility tests to use the existing injected Herdr runner seam, so that tests remain deterministic, fast, and free of provider credentials.
37. As a project owner, I want an explicit disposable live gate for Claude Code and Pi, so that the real Herdr/CLI/native-skill integration is verified when the local environment can support it.
38. As a project owner, I want ordinary CI tests not to require Claude, Pi, provider credentials, or billable model calls, so that the feature remains maintainable across developer environments.
39. As a documentation reader, I want a small configuration example, so that I can select Pi with OpenAI and a model without reading adapter internals.
40. As a documentation reader, I want the native skill discovery prerequisite stated explicitly, so that a launch failure is not mistaken for a Herdr incompatibility.
41. As a maintainer, I want Reviewer and Fixer behavior unchanged in this slice, so that live Worker support does not expand into an unbounded multi-role migration.
42. As a maintainer, I want the public workflow state, Execution role, Agent profile, Skill invocation, Orchestration contract, Worker attempt, and Worker result vocabulary preserved, so that the new profiles remain an additive transport capability.

## Implementation Decisions

- Extend the existing Agent profile configuration with the three supported kinds: `codex`, `claude-code`, and `pi`.
- Keep the profile fields minimal: `kind` is required; `provider` and `model` are optional string overrides. Do not add generic `args`, `mode`, session controls, sandbox controls, or arbitrary executable configuration in this slice.
- Apply `provider` and `model` only as per-launch overrides. If omitted, the selected agent uses its native configuration. A provider value is meaningful for Pi; Claude Code uses its own provider/auth configuration and may receive a model override where supported.
- Preserve configuration version 1 and the existing Codex default. Existing valid Codex configurations must parse and behave as before.
- Resolve the configured Worker role to an Agent profile before any Herdr pane is created. Fail closed on missing profile, unsupported kind, invalid override, or unsupported role/profile combination.
- Keep the profile's domain name `claude-code` and map it to Herdr's transport kind `claude`. Keep `pi` mapped directly to Herdr's `pi` kind.
- Extend the existing Herdr execution handle and launch options to represent supported agent kinds without changing Herdr's responsibility boundary. The adapter remains unaware of Workflow skill and ticket semantics.
- Preserve interactive launch through `agent start`, followed by opaque prompt delivery, bounded settlement/read, and owned-pane cleanup. Do not introduce Pi RPC or Claude print mode for this Worker slice.
- Build agent-specific child arguments from validated profile overrides. Continue to use the existing safe argument validation and forbid unrestricted-permission bypasses.
- Render skill invocations using the documented mapping: Codex `$implement`, Claude Code `/implement`, Pi `/skill:implement`.
- Keep logical skill name `implement` and all Workflow artifacts agent-independent. The syntax difference exists only in the Agent renderer.
- Preserve the existing Worker wrapper, safeguards, result schema, Execution record, reconciliation, checkpoint acceptance, retry, and cleanup semantics.
- Treat native skill discovery as an environment prerequisite. The Orchestrator neither installs, copies, symlinks, nor synchronizes the downstream skill between agent-specific locations.
- Keep live Claude Code and Pi support limited to the Worker execution path. Reviewer and Fixer profiles remain outside this slice unless their existing code path can consume the same additive profile model without behavior changes.
- Use the public Worker launch path with an injected Herdr command runner as the primary test seam. Use existing config parsing/schema validation as the secondary pure seam; do not create a new generic agent abstraction solely for tests.
- Add deterministic tests for each profile's Herdr `agent start` kind, child arguments, prompt content, settlement response, identity validation, and failure/cleanup behavior.
- Add a disposable live compatibility gate for each new profile only when the binary, Herdr, authentication, native `implement` skill, and provider/model are available. The gate must report unavailable prerequisites clearly and must not become a normal credential-dependent CI test.
- Update the durable domain documentation and workflow documentation to describe minimal native Agent profiles, the Pi skill syntax, the Claude-to-Herdr kind mapping, and the native skill prerequisite.

## Testing Decisions

- Tests verify externally observable behavior at the public Worker launch boundary and configuration validation boundary. They do not assert private helper decomposition or duplicate the implementation of the adapter.
- Configuration tests cover the legacy Codex profile, Claude Code and Pi profiles, optional provider/model values, missing values with native fallback semantics, invalid values, unknown fields, unknown profile kinds, and missing role references.
- Renderer tests cover all three exact skill invocation strings, quoted immutable input, deterministic prompt hashes, canonical safeguards, and preservation of the existing Orchestration contract.
- Herdr compatibility tests use the existing fake/injected runner. A table-driven matrix should assert profile name, Herdr kind, child executable arguments, provider/model override forwarding, opaque prompt forwarding, returned handle identity, and settled lifecycle state.
- Launch failure tests cover invalid agent kind, startup failure, transient startup readiness, prompt failure, settlement timeout, protocol mismatch, disappearing agent, and cleanup failure for each supported transport kind.
- Security tests assert that profile overrides cannot inject empty values, control characters, `--` delimiters, newline-separated arguments, unrestricted-permission flags, or arbitrary unvalidated child arguments.
- Existing Codex tests must continue to pass unchanged in behavior. New tests should extend the existing test style rather than replace Codex fixtures with a generic test-only abstraction.
- Compatibility tests must assert that Pi receives `/skill:implement` and Claude Code receives `/implement`; asserting only that both prompts start with `/` is insufficient.
- Live compatibility gates should use a disposable Target repository and isolated Feature worktree, verify one real Herdr start/prompt/settlement/cleanup cycle, and avoid relying on a production Workflow run or modifying the development repository.
- Live gates must verify native skill availability and the configured provider/model before claiming success. Missing credentials or unavailable native configuration are reported as skipped/unavailable prerequisites, not silently converted to a Codex run.
- Run the existing full quality suite, typecheck, lint, format check, build, generated-schema drift check, and installer/package checks after implementation. Documentation-only changes made during specification work require only formatting/diff validation until code work begins.
- Prior art is the existing configuration tests, Worker renderer tests, Herdr adapter tests, worker runtime-asset tests, and public CLI/integration tests.

## Out of Scope

- A full agent configuration abstraction or mirror of Pi, Claude Code, or Codex settings.
- Arbitrary child-process argument arrays, custom executable paths, provider credentials, API keys, model registries, or secret storage in the Orchestrator configuration.
- Automatic installation, copying, symlinking, or synchronization of the `implement` skill between agent ecosystems.
- Reimplementing or translating the `implement` methodology for Claude Code or Pi.
- Pi RPC mode, Claude Code print/headless mode, SDK integration, streaming output, or agent-specific structured output protocols.
- Live Reviewer or Fixer migration, role-specific agent scheduling, parallel Workers, or changes to downstream review/fix methodology.
- Provider capability discovery, model availability checks against remote APIs, automatic fallback models, or credential login flows.
- Changing Worker result JSON, Git checkpoint acceptance, Workflow phase semantics, Execution record ownership, retry policy, or Herdr cleanup policy except where necessary to generalize agent-kind identity.
- Trust-policy management inside the Orchestrator. Native agent trust and project approval remain agent-owned prerequisites.
- Making live Claude Code or Pi tests mandatory in credential-free CI.

## Further Notes

- The primary test seam is the existing public Worker launch path with an injected Herdr runner; configuration parsing/schema validation is a narrow supporting seam. This keeps the feature small and avoids a second agent runtime architecture.
- Official Claude Code documentation supports interactive startup, model selection, additional directories, project skills, and `/skill-name` invocation. Official Pi documentation supports interactive startup, provider/model selection, project/global skills, and `/skill:name` invocation.
- Pi's native skill command is `/skill:implement`, not `/implement`. This is a compatibility requirement, not a stylistic preference.
- Pi can discover the shared skill locations used by the current environment, while Claude Code requires its own documented skill location. The selected environment must make `implement` available to the selected agent before the Worker starts.
- The exact repository configuration example and the minimal/native-configuration boundary are recorded in ADR 0007.
- This spec is ready for implementation after the current documentation and research notes are preserved. No code changes are implied by publishing the spec.

## Comments
