# Browser verification skill POC

Status: ready-for-agent

## Problem Statement

Po wdrożeniu Coding Agent musi dziś sprawdzać działanie aplikacji ręcznie albo utrzymywać kruche, projektowe skrypty przeglądarkowe. Nie ma lekkiego, wspólnego mechanizmu, z którego Codex, Claude Code i Pi mogą skorzystać, aby przejść przez rzeczywisty browser flow i zwrócić sprawdzalny wynik zamiast deklaracji agenta, że wdrożenie „wygląda dobrze”.

Gotowy upstream browser-use/jev-ultrafast dostarcza właściwą warstwę sterowania: obserwowany, indeksowany action space, walidację świeżości strony i bezpieczne wykonanie. Nie dostarcza jednak projektu Verification scenario, niezależnych asercji, kontraktu wyniku ani integracji z różnymi Coding Agents.

## Solution

Stworzyć osobny, mały Browser verification skill POC. Skill opakuje przypiętą rewizję upstreamowego Jev cienkim runnerem; nie będzie forkiem Jev ani nowym browser engine'em. Każdy Target repository będzie mógł trzymać własne, deklaratywne Verification scenarios opisujące dozwolony flow, nie-sekretne test data, dozwolone originy i mutacje oraz obserwowalne asercje.

Runner uruchamia Jev w istniejącym profilu Chrome, zbiera trace i screenshoty, a następnie wykonuje niezależne asercje. Zwraca maszynowo czytelny wynik passed lub failed, kod wyjścia i ścieżki do artefaktów. Agent-native adaptery udostępnią ten sam skill w Codex, Claude Code i Pi.

Automatyczny dowód działania użyje lokalnej, deterministycznej fixture page. Oddzielny Opt-in external smoke scenario może ręcznie użyć nowego, pustego czatu chatgpt.com: wysyła „Cześć!” i sprawdza wysłanie oraz pojawienie się odrębnej odpowiedzi po ustaniu generowania.

## User Stories

1. As a Coding Agent user, I want to invoke one Browser verification skill after deployment, so that browser verification is a normal part of my delivery workflow.
2. As a Codex user, I want the skill available through Codex's native skill mechanism, so that I can invoke it without a custom browser prompt.
3. As a Claude Code user, I want an equivalent native adapter, so that I can run the same Verification scenario with Claude Code.
4. As a Pi user, I want an equivalent native adapter, so that I can run the same Verification scenario with Pi.
5. As a Target repository owner, I want Verification scenarios owned by my repository, so that flows describe my application rather than a generic demo.
6. As a Target repository owner, I want a scenario to specify its starting URL and goal, so that Jev can navigate a real user journey.
7. As a Target repository owner, I want a scenario to contain non-secret test data, so that a known value can be verified after submission.
8. As a Target repository owner, I want a scenario to declare allowed origins, so that browser work has an explicit site boundary.
9. As a Target repository owner, I want a scenario to declare its allowed mutation kinds, so that clicks and text entry are deliberate rather than implicit.
10. As a deployment operator, I want a passed result only when declared assertions pass, so that Jev's DONE is never treated as proof of success.
11. As a deployment operator, I want a failed result to identify the failed assertion, so that I can diagnose the deployment efficiently.
12. As a deployment operator, I want a screenshot and trace for a failed verification, so that the next Coding Agent has browser evidence.
13. As a deployment operator, I want a non-zero exit code for verification failure, so that shell workflows can stop or repair safely.
14. As a deployment operator, I want configuration and browser-availability failures distinguished from assertion failures, so that infrastructure problems are not mistaken for product regressions.
15. As a Coding Agent, I want Jev to choose only from observed page controls, so that model output never becomes a selector, coordinate, or executable browser code.
16. As a Coding Agent, I want stale browser decisions rejected before execution, so that a changed page cannot receive an action intended for an old observation.
17. As a Coding Agent, I want ambiguous mutations not retried automatically, so that a message, form, or command is not submitted twice.
18. As a Target repository owner, I want URL, visible-text, role/name, console-error, new-visible-text, and screenshot assertions, so that common smoke outcomes can be stated without CSS or XPath.
19. As a Target repository owner, I want unsupported assertion forms rejected clearly, so that a scenario cannot silently become arbitrary browser automation.
20. As a Target repository owner, I want secret values excluded from scenarios, so that repository configuration remains safe to review and commit.
21. As a local developer, I want model credentials read only from a local ignored environment file, so that the POC can use upstream Jev without placing keys in configuration.
22. As a local developer, I want the POC to use my existing Chrome profile, so that the first version avoids profile-management complexity.
23. As a local developer, I want the runner to report when an existing profile cannot supply the required session, so that a login problem is not reported as a deployment failure.
24. As a security-conscious user, I want page text treated as untrusted data, so that instructions displayed by a page cannot change scenario policy or tool rules.
25. As a security-conscious user, I want navigation outside the declared origin boundary to stop the run before another agent decision, so that the runner fails closed after unexpected navigation.
26. As a maintainer, I want an upstream Jev revision pinned, so that POC behavior does not silently drift when upstream changes.
27. As a maintainer, I want no Jev fork or provider abstraction in the POC, so that the implementation remains small.
28. As a maintainer, I want one public runner contract to be the primary test seam, so that tests describe user-visible behavior rather than Jev internals.
29. As a maintainer, I want a deterministic local fixture page, so that ordinary automated tests do not require a real deployment, account, or paid model API.
30. As a maintainer, I want an explicitly invoked live local gate using the real Jev setup, so that the integration with Chrome and upstream Jev is proven without making CI billable.
31. As a user, I want an Opt-in external smoke scenario for a new empty ChatGPT chat, so that I can manually validate the end-to-end POC on a real authenticated service.
32. As a user of that external smoke scenario, I want an explicit warning about disclosure of visible page text to configured model providers, so that I can make an informed choice before it runs.
33. As a maintainer, I want adapter installation to create deliberate native skill snapshots, so that agent-specific discovery rules do not require one shared mutable directory.
34. As a maintainer, I want the skill to state its browser/profile, model-key, and user-session prerequisites, so that an unavailable local environment fails with a smallest actionable explanation.

## Implementation Decisions

- Build the Browser verification skill as a standalone source package rather than as a module of Coding Workflow Orchestrator. This tracker entry records its design; the package owns its implementation and installation lifecycle.
- Package agent-facing workflow instructions, a thin deterministic runner, a scenario schema, native installation adapters, and an upstream Jev dependency pinned to one reviewed revision. Do not copy or modify Jev's controller loop.
- Use upstream Jev directly for browser observation, indexed operation/target selection, text entry, freshness checks, target validation, click occlusion checks, bounded execution, and its no-retry mutation semantics.
- Use only upstream Jev's direct TypeSafe decision model and configured text model for this POC. Store their keys in local ignored environment configuration; do not add a general provider interface, key store, or remote credential management.
- Define a Target-repository-owned, declarative Verification scenario with a starting URL, natural-language goal, non-secret test data, allowed origins, allowed mutation kinds, assertion list, timeout, and artifact destination. Reject unknown fields and unsupported assertion forms.
- Support only the approved POC assertions: URL matching, visible text present, visible text absent, visible element role/name, absence of observed console errors, new visible text after a recorded submission, and screenshot evidence. Do not expose CSS selectors, XPath, model-generated JavaScript, arbitrary CDP commands, or arbitrary project hooks.
- Include explicit test data in the natural-language goal supplied to Jev and assert its observable result. The runner never writes a hardcoded value into a DOM target outside Jev's controlled TYPE_TEXT path.
- Treat scenario policy as authoritative and all page text as untrusted. Visible text may inform Jev's next action but cannot alter allowed origins, mutation kinds, assertions, timeouts, or artifact destinations.
- Before each runner-controlled step, enforce that the observed URL remains in the allowed-origin set; after unexpected navigation, produce a failed policy result and do not request another Jev decision. Enforce allowed mutation kinds before passing an observed action to execution. The POC does not promise to prevent the first browser navigation caused by a permitted click.
- Treat Jev DONE, BLOCKED, stale-page handling, model unavailability, browser unavailability, policy violation, timeout, and assertion failure as distinct runner outcomes. Only all independent assertions passing produces passed.
- Publish one stable public runner invocation that accepts a Verification scenario and emits one structured result plus an operating-system exit status. It is the only primary behavior seam for the POC.
- Record bounded evidence for every run: final structured result, action/observation trace, screenshots, final URL, and failed assertion details. Keep raw evidence local and exclude it from version control.
- Use the existing Chrome profile and tabs for the POC; do not implement isolated profiles, browser contexts, cross-device execution, account provisioning, or automatic login. A required login is an explicit session prerequisite.
- Make the local fixture page the ordinary integration target. It contains a minimal form and result surface sufficient to prove navigation, text input, submit, response observation, assertions, structured outcome, artifacts, and exit status.
- Provide a manually invoked Opt-in external smoke scenario for chatgpt.com, not an automatic fixture. It starts a new empty chat, sends „Cześć!”, and requires both visible submission and a distinct post-generation response. It presents the data-disclosure warning before use.
- Create small native skill adapters/snapshots for Codex, Claude Code, and Pi that delegate to the shared runner. Keep the Verification scenario format and runner result agent-independent.
- Do not add a new ADR: the POC's wrapper, Chrome-profile choice, upstream pin, and supported assertion vocabulary are reversible and intentionally narrow.

## Testing Decisions

- Test external behavior through the public runner invocation. The same scenario/result contract is used by native adapters, the deterministic fixture, and the opt-in live gate; tests must not invoke private Jev helpers or assert its internal action-table implementation.
- Use one local deterministic fixture page as the highest automated integration seam. A successful scenario must visibly submit known test data, receive a fixture response, satisfy declared assertions, write artifacts, produce a passed result, and exit successfully.
- Through the same seam, test URL, visible-text, absent-text, role/name, new-visible-text, console-error, screenshot, and unsupported-assertion behavior. Assert the externally returned result and evidence references, not private checker decomposition.
- Through the same seam, cover failure modes: missing or invalid scenario, unsupported action/mutation policy, navigation outside the allowed origins, browser unavailable, timeout, Jev blocked/stale/model failure, failed assertion, and unavailable existing login session. Each must return the correct non-success outcome without an automatic browser-mutation retry.
- Use a controlled Jev-driver boundary only in ordinary automated tests to avoid credentials and paid requests. It may simulate public upstream state transitions but must not duplicate or replace upstream Jev's own safety tests.
- Add one explicitly invoked local live gate that runs the public runner against the fixture with a real Chrome session and real configured Jev keys. It validates the actual browser/Jev integration and records evidence, but is skipped with a clear prerequisite result when Chrome, keys, or remote access are unavailable.
- Treat the Opt-in external smoke scenario as manual evidence only. It must never run in CI or ordinary tests, and its warning/confirmation condition must be tested without opening chatgpt.com.
- Reuse upstream Jev's offline tests and guard-check script as dependency confidence, but do not make their paid examples part of this package's ordinary suite.
- Verify installation adapters by exercising their public agent-native entrypoints against the same runner contract. Do not require a live model session for every agent in normal automated tests.

## Out of Scope

- A fork, rewrite, extension, or replacement of the Jev browser controller.
- A general browser automation framework, selector API, XPath, Playwright fallback, arbitrary JavaScript, arbitrary CDP access, or project-specific executable hooks.
- A full E2E suite, test-case authoring UI, test recorder, scenario marketplace, parallel scheduler, cloud service, or hosted browser.
- Isolated browser profiles or contexts, account provisioning, automatic login, secret stores, identity rotation, or CI secret configuration.
- Production-wide automatic verification, unattended third-party-service mutation, purchases, deletion, publishing, or messages to real external recipients.
- A guarantee that a permitted click cannot perform the initial cross-origin navigation before the POC observes and fails it.
- Full semantic protection against prompt injection in page content; the POC limits policy authority and actions but cannot prove model reasoning is immune to hostile text.
- Full accessibility-name compliance or support for iframe, shadow DOM, canvas, file upload, popup tabs, nested scrolling, arbitrary keyboard widgets, or any other current upstream Jev limitation.
- Replacing agent-native configuration, model configuration, or skill-discovery rules for Codex, Claude Code, or Pi.
- Automatic ChatGPT smoke tests or transmission of a user's existing conversation history as test data.

## Further Notes

- The POC deliberately keeps one deep public module: the scenario runner. Native skills are thin invocation adapters; upstream Jev remains the browser-control module; Target repositories own only Verification scenarios.
- Jev's current architecture supports observed indexed actions and revalidates targets before execution, but its own DONE still requires independent verification. The runner's assertion boundary exists specifically to supply that missing truth layer.
- Existing Chrome-profile use is a conscious POC trade-off. It is acceptable for local, user-authorized smoke tests but not an isolation model for an unattended deployment-verification product.
- The external ChatGPT scenario can expose visible page text to the configured TypeSafe and text-model providers because Jev includes visible page text in model context. It is opt-in, starts with a fresh empty chat, and must be run only after the user accepts that disclosure.
- This specification is ready for ticketing and implementation. Publishing it does not create implementation authority.

