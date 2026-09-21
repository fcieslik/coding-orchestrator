# 03: Natywne adaptery skilla dla Codex, Claude Code i Pi

**What to build:** Użytkownik może zainstalować Browser verification skill jako świadomy, natywny snapshot dla Codex, Claude Code i Pi. Każdy adapter przyjmuje ten sam Verification scenario i deleguje do wspólnego runnera, bez kopiowania browser engine'u albo rozchodzenia się kontraktu wyniku.

**Blocked by:** 01: Minimalny Scenario Runner z lokalną fixture.

**Status:** ready-for-agent

- [ ] Pakiet udostępnia minimalne agent-native instrukcje i instalację dla Codex, Claude Code oraz Pi, zgodne z ich natywnym discovery/invocation modelem.
- [ ] Każdy adapter uruchamia ten sam publiczny runner z tym samym scenariuszem i przekazuje jego ustrukturyzowany rezultat bez agent-specific interpretacji PASS/FAIL.
- [ ] Instalacja tworzy jawny snapshot zamiast współdzielonego, mutowalnego katalogu; dokumentuje wymagania Chrome, local env i istniejącej sesji.
- [ ] Testy adapterów weryfikują publiczne entrypointy i przekazanie scenariusza do runnera bez wymagania aktywnej sesji modelowej.
