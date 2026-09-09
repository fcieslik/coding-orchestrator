# Phase 3 — Herdr Adapter and Feasibility Gate

Status: ready-for-agent

## Problem Statement

The Coding Workflow Orchestrator has durable workflow and Git state, but it cannot yet prove that it can control a fresh coding agent through the installed Herdr runtime. The documented Herdr command assumptions may differ from the installed CLI, mocked success cannot establish real feasibility, and Herdr lifecycle observations cannot be mistaken for semantic ticket completion. Until the Orchestrator can safely create an owned pane, start Codex in the intended working directory, deliver an opaque prompt, wait, read diagnostics, and clean up, Phase 4 worker execution would be built on an unverified critical dependency.

## Solution

Add a minimal internal Herdr adapter for the V1 agent lifecycle and an explicit `flow herdr smoke` command that proves the lifecycle against a real Codex from inside a Herdr-managed pane. Keep Herdr limited to process transport: it receives already-rendered prompts unchanged and returns typed lifecycle observations and diagnostics without interpreting skills, tickets, reviews, artifacts, or workflow completion. Verify deterministic behavior with a fake Herdr executable, then require one successful opt-in live smoke run before declaring Phase 3 complete.

## User Stories

1. As an Orchestrator, I want to detect whether I am running inside Herdr, so that I never pretend to control a session I do not own.
2. As an operator, I want an actionable refusal outside Herdr, so that I know to restart the Orchestrator in a managed pane rather than spoofing an environment variable.
3. As an Orchestrator, I want to identify my caller pane from Herdr-provided context, so that new layout is created relative to the correct terminal.
4. As an Orchestrator, I want to create a sibling pane without moving user focus, so that background delegation does not interrupt the operator.
5. As an Orchestrator, I want every created pane to use an explicit absolute working directory, so that an agent cannot start in an accidental checkout.
6. As an operator, I want the requested working directory verified through the live agent, so that pane creation and agent execution agree about repository location.
7. As an Orchestrator, I want pane identifiers parsed from Herdr's structured response, so that I never infer identity from layout position or display order.
8. As an Orchestrator, I want an owned execution handle containing both pane and agent identity, so that later operations target exactly the resource created for this execution.
9. As an Orchestrator, I want deterministic agent names derived from execution identity, so that panes and diagnostics can be correlated across operations.
10. As an Orchestrator, I want generated agent names to satisfy Herdr's syntax and length limits, so that valid workflow identities do not produce invalid launches.
11. As an operator, I want name collisions refused, so that a new execution cannot attach to or replace an existing agent silently.
12. As an Orchestrator, I want Codex started through Herdr's high-level agent API, so that Herdr can detect and report the agent lifecycle.
13. As a maintainer, I want raw pane-based agent control deferred until a demonstrated high-level API limitation exists, so that V1 has one execution path.
14. As an Orchestrator, I want agent startup bounded by a caller-controlled timeout, so that a missing or undetected process cannot stall the workflow forever.
15. As an operator, I want startup failures to include useful bounded diagnostics, so that configuration and executable problems can be diagnosed.
16. As an Orchestrator, I want a rendered prompt accepted as an opaque payload, so that transport remains independent of worker and reviewer semantics.
17. As an Orchestrator, I want multiline prompt content forwarded unchanged, so that orchestration contracts retain their intended structure.
18. As an Orchestrator, I want literal skill syntax such as `$implement` forwarded unchanged, so that later agent renderers can target Codex without Herdr rewriting their output.
19. As a security-conscious operator, I want full prompts omitted from routine diagnostics, so that task context is not duplicated into logs unnecessarily.
20. As an Orchestrator, I want prompting performed through argv-based process execution rather than shell composition, so that quotes, newlines, dollar signs, and other content cannot change command meaning.
21. As an Orchestrator, I want prompt submission and settlement waiting to use Herdr's agent lifecycle API, so that polling terminal prose is unnecessary.
22. As an Orchestrator, I want wait timeouts supplied by the caller, so that later workflow roles can choose limits without transport policy being hardcoded.
23. As an operator, I want the smoke command to use bounded startup and settlement defaults, so that the feasibility check finishes predictably.
24. As an Orchestrator, I want Herdr `idle` and `done` mapped to a transport-level settled result, so that either recognized resting state can trigger later evidence inspection.
25. As an Orchestrator, I want `blocked` reported distinctly, so that later workflow logic can decide whether a human decision is required.
26. As an Orchestrator, I want `unknown` reported distinctly, so that uncertain lifecycle detection is never accepted as success.
27. As an Orchestrator, I want timeout reported distinctly, so that retry policy can distinguish delay from other failures.
28. As an Orchestrator, I want process disappearance reported distinctly, so that a vanished agent is not confused with normal settlement.
29. As an Orchestrator, I want invocation and protocol errors distinguished from lifecycle observations, so that invalid CLI behavior is never treated as an agent result.
30. As an Orchestrator, I want non-zero Herdr exits retained as failures with command and exit metadata, so that transport failures remain actionable.
31. As an Orchestrator, I want malformed or incomplete JSON refused, so that missing identity or lifecycle evidence cannot pass silently.
32. As a maintainer, I want compatibility determined by required fields and behavior, so that a harmless Herdr version change does not break the adapter unnecessarily.
33. As an operator, I want the observed Herdr version in smoke diagnostics, so that a report can be correlated with the runtime that produced it.
34. As an Orchestrator, I want agent output readable through Herdr for diagnostics, so that blocked and failed executions can be inspected.
35. As an Orchestrator, I want terminal output treated only as diagnostic evidence, so that natural-language text never becomes workflow truth.
36. As an operator, I want captured output bounded, so that an unexpectedly verbose pane cannot produce unbounded reports.
37. As an operator, I want a public smoke command, so that Herdr feasibility can be checked without writing a custom script.
38. As an automation author, I want the smoke command to provide structured JSON, so that the gate can be evaluated without parsing human prose.
39. As an operator, I want the structured report emitted to standard output, so that I can inspect or redirect it using ordinary command-line tools.
40. As an operator, I want to copy the report to an explicit output file, so that live evidence can be retained when needed.
41. As an operator, I want smoke execution not to mutate Workflow run state, so that infrastructure diagnosis cannot advance or damage delivery state.
42. As an operator, I want the smoke prompt to contain a generated nonce, so that old terminal output cannot satisfy the current check.
43. As an operator, I want live success to require the nonce in readable agent output, so that prompt delivery is demonstrated rather than inferred from settlement.
44. As an operator, I want live success to require the expected working directory in agent output, so that the agent's execution location is demonstrated.
45. As an operator, I want the live challenge to exercise multiline content and literal Codex skill syntax, so that the critical future prompt shape is represented.
46. As an Orchestrator, I want a pane closed only when it was created by the current execution, so that unrelated user work is never terminated.
47. As an Orchestrator, I want partial launch failure to trigger cleanup of the pane already created, so that failed startup does not leak background layout.
48. As an operator, I want cleanup failure to preserve the owned pane ID in the report, so that I can recover it manually.
49. As an operator, I want cleanup failure to avoid broader workspace or server termination, so that narrow failure cannot damage the Herdr session.
50. As an operator, I want default smoke success to require successful cleanup, so that the gate proves the complete lifecycle rather than only startup.
51. As an operator, I want an explicit keep-pane diagnostic option, so that I can inspect a problematic live agent after the command returns.
52. As an operator, I want keep-pane mode marked as incomplete gate evidence, so that deliberately skipped cleanup cannot be mistaken for a full pass.
53. As an Orchestrator, I want `blocked`, `unknown`, timeout, disappearance, and cleanup failure distinguishable in the report, so that each condition has precise remediation.
54. As an Orchestrator, I want all non-settled or incompletely cleaned smoke outcomes to return failure, so that Phase 3 fails closed.
55. As a maintainer, I want Herdr process execution behind one injectable command-runner boundary, so that command construction and response parsing can be tested deterministically.
56. As a maintainer, I want a fake Herdr executable to exercise the adapter and public command, so that tests cover the real subprocess boundary without launching an interactive agent.
57. As a maintainer, I want byte-for-byte prompt forwarding asserted, so that refactors cannot corrupt rendered downstream skill invocations.
58. As a maintainer, I want lifecycle and protocol edge cases reproducible in tests, so that uncommon failures do not require manipulating a live terminal session.
59. As a maintainer, I want normal tests to avoid real or billable agents, so that the suite remains deterministic and safe to run repeatedly.
60. As a maintainer, I want the real smoke test explicit and opt-in, so that only an operator in an appropriate Herdr session launches Codex.
61. As a project owner, I want Phase 3 completion to require both automated coverage and a real successful lifecycle, so that Phase 4 is not built on mock-only confidence.
62. As a future worker-execution author, I want the Herdr adapter unaware of `implement`, tickets, commits, and result artifacts, so that Phase 4 owns those semantics.
63. As a future reviewer-execution author, I want the same opaque transport reusable for `$code-review`, so that review methodology remains outside Herdr.
64. As a workflow author, I want a settled Herdr agent treated only as a process observation, so that ticket completion still requires structured artifacts and Git checkpoint validation.

## Implementation Decisions

- Add an internal TypeScript Herdr adapter with lifecycle operations for launching an agent, submitting an opaque prompt, waiting for settlement, reading bounded diagnostic output, and closing owned resources.
- Represent a launched execution with an owned handle containing the pane identifier and unique agent name. Acquire ownership immediately after pane creation so partial startup can be cleaned up safely.
- Require a real Herdr-managed caller context before controlling layout. An environment marker alone is insufficient when required caller pane identity is absent.
- Launch in two explicit steps: create a sibling pane relative to the caller with an absolute cwd and without focus, then start Codex in that existing pane through the high-level agent API.
- Support Codex as the only live smoke agent in V1. Keep raw pane-based agent startup as an unimplemented fallback until a concrete high-level API incompatibility is demonstrated.
- Normalize deterministic execution names to Herdr's lowercase name grammar and maximum length. Refuse collisions rather than attaching to, releasing, or replacing an existing agent.
- Invoke Herdr through a small injected command runner that accepts an executable plus argument vector and operation timeout. Never construct a shell command from identifiers, paths, or prompts.
- Treat the prompt as an opaque string and forward it unchanged. The adapter has no knowledge of roles, downstream skills, tickets, specifications, review inputs, workflow artifacts, or result semantics.
- Require callers of the internal adapter to supply operation timeouts. Use smoke defaults of 30 seconds for startup and 120 seconds for prompt settlement.
- Map Herdr `idle` and `done` to a `settled` transport result. Preserve `blocked`, `unknown`, `timed-out`, and `disappeared` as separate results. None of these results changes workflow state or proves ticket completion.
- Treat missing executables, command failures, non-zero exits, invalid JSON, missing required response fields, unexpected identifiers, and unsupported lifecycle values as explicit adapter failures.
- Validate compatibility against the response contract and behavior required by each operation rather than pinning an exact Herdr version. Include the observed version in diagnostic reports.
- Bound all captured stdout and stderr. Failure diagnostics include operation, exit information, owned identifiers, lifecycle observations, timings, and bounded output, but exclude the submitted prompt.
- Add one public feasibility command with Codex selection, structured-output, optional output-file, and diagnostic keep-pane options. Keep the general lifecycle primitives internal until workflow commands need them.
- Make the feasibility command fail closed outside a genuine Herdr caller context and avoid all Workflow run creation or mutation.
- Generate a unique nonce for each live challenge. Submit opaque multiline content that includes the nonce and literal `$implement`, instructs the agent not to invoke that skill, and asks it to report the nonce and its current working directory.
- Require a passing live result to prove managed caller context, requested cwd, pane creation, unique Codex detection, meaningful prompt delivery, settled lifecycle, readable matching nonce and cwd, and successful closure of only the created pane.
- Treat blocked, unknown, timeout, process disappearance, response mismatch, and close failure as distinct failing smoke results.
- Attempt narrow cleanup whenever pane ownership was acquired, including agent-start failure. Report both the primary failure and cleanup failure when both occur; never terminate the Herdr server, workspace, tab, or any unowned pane.
- Make keep-pane mode diagnostic only. It reports cleanup as skipped, exposes the owned identifier, and cannot produce the full passing gate required for Phase 3 completion.
- Emit the structured smoke report to standard output and optionally copy the same report to an explicitly requested file. Do not store the report in State snapshot or Operational history.
- Correct architecture documentation to reflect the command and response behavior verified against the installed Herdr runtime. Examples remain capability-oriented rather than promising compatibility with only one version.
- Phase 3 is complete only after the deterministic suite passes and a default-cleanup live Codex smoke passes from inside Herdr. Record the runtime version and verification date without committing environment-specific agent transcripts.

## Testing Decisions

- Use the public CLI subprocess as the primary testing seam. Place a controllable fake `herdr` executable ahead of the real binary and assert externally visible reports, exit behavior, invocation order, and cleanup.
- Use the injected command-runner seam only for cases that cannot be expressed clearly through the fake executable, such as precise partial-operation timing. Prefer the CLI seam whenever both can prove the same behavior.
- Make the fake executable emit realistic structured responses and record received argument vectors without interpreting them through a shell. This tests command construction and protocol parsing together.
- Assert that an opaque prompt containing newlines, quotes, Unicode, whitespace, and literal `$implement` reaches the command runner byte for byte while the public diagnostic report omits it.
- Cover refusal outside Herdr, missing caller identity, relative or missing cwd, missing executable, invalid agent name, agent-name collision, and incompatible or malformed structured responses.
- Cover successful pane creation and agent startup, exact use of the returned pane identifier, no-focus behavior, requested cwd, correct Codex kind, and owned-handle construction.
- Cover pane creation failure, agent startup failure after pane creation, successful partial-launch cleanup, cleanup failure layered onto startup failure, and refusal to close an unowned identifier.
- Cover Herdr `idle` and `done` as settled transport results and `blocked`, `unknown`, timeout, process disappearance, unsupported states, and non-zero exits as distinct observable outcomes.
- Cover bounded stdout and stderr, prompt redaction, Herdr version reporting, operation timing metadata, and preservation of the owned pane identifier when cleanup fails.
- Cover a successful smoke report only when nonce, expected cwd, settled lifecycle, and default cleanup are all observed.
- Cover nonce mismatch, missing cwd, unreadable output, blocked/unknown lifecycle, timeout, disappearance, and close failure as non-passing reports with stable distinctions.
- Cover keep-pane mode as an intentional cleanup skip that reports the retained pane but cannot satisfy the complete feasibility gate.
- Cover structured output on standard output and optional identical file output without creating or mutating Workflow run state.
- Keep the real Codex smoke outside `pnpm test`. Run it explicitly from a genuine Herdr-managed pane after automated tests pass, using the current repository as the requested cwd.
- For the live verification, confirm the command creates only one owned sibling pane, preserves focus, detects Codex, observes the nonce and cwd, reports the installed Herdr version, and closes the pane. Inspect the reported pane ID manually if cleanup fails.
- Run the full existing suite, type checking, linting, formatting check, build, and executable help check after the Phase 3 changes. Phase 3 is not complete until the additional live smoke passes.

## Out of Scope

- Worker Role execution, `$implement` rendering, worker orchestration contracts, worker result artifacts, commits, Git checkpoint acceptance, or ticket completion.
- Reviewer Role execution, `$code-review` rendering, fixed-diff review inputs, review artifacts, or review pass/fail ingestion.
- Fixer prompting, deterministic project checks, ticket graph scheduling, retry policy, restart/resume of active agents, or workflow lifecycle transitions.
- Treating Herdr output, lifecycle settlement, or Codex prose as semantic workflow truth.
- A generic terminal framework, alternate multiplexer support, direct socket integration, Herdr server management, workspace or tab creation, worktree creation, or focus management beyond preserving the caller's focus.
- Automatic fallback to raw pane-driven Codex startup, dual high-level/raw execution paths, support for Claude or Pi, configurable agent plugins, or a generic agent-adapter framework.
- Long-running background monitoring, event subscriptions, streaming terminal output, automatic answers to blocked agents, approval handling, or interactive recovery UI.
- Persisting smoke evidence into Workflow run state, committing live transcripts, retaining panes by default, closing pre-existing resources, or broad session cleanup.
- Pinning the project to one exact Herdr version or guaranteeing compatibility with future response contracts that do not provide the required capabilities.
- Windows support, remote Herdr sessions, SSH orchestration, CI execution of live agents, or unattended billable smoke runs.

## Further Notes

- The terms Workflow run, State snapshot, Operational history, Execution role, Agent profile, Skill invocation, Orchestration contract, Agent renderer, and Herdr feasibility gate follow the project glossary.
- ADR 0003 keeps engineering methodology in downstream skills, invocation syntax in agent renderers, and opaque process transport in Herdr. Phase 3 must not introduce worker or reviewer semantics while testing literal future prompt content.
- ADR 0004 requires both deterministic fake-runtime coverage and a successful real Codex lifecycle before the gate is considered closed.
- The currently installed Herdr reports version 0.8.2, but the live managed session remains the authority for exact subcommand responses and lifecycle behavior.
- The architecture examples were corrected to reflect that high-level agent startup targets an existing pane and requires an explicit agent kind. Implementation must still validate the exact structured responses live.

## Comments
