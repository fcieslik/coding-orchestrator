# 02: Niezależne asercje, polityka scenariusza i evidence

**What to build:** Właściciel Target repository może opisać dozwolony browser flow jako pełny Verification scenario, a runner niezależnie potwierdza rezultat i zbiera użyteczne evidence. Model pozostaje warstwą nawigacji Jev, podczas gdy polityka scenariusza i asercje wyznaczają PASS/FAIL.

**Blocked by:** 01: Minimalny Scenario Runner z lokalną fixture.

**Status:** ready-for-agent

- [ ] Scenariusz deklaruje allowed origins, allowed mutation kinds, artifact destination i zatwierdzone asercje: URL, obecny/nieobecny widoczny tekst, widoczny role/name, brak console errors, nowy widoczny tekst po submission oraz screenshot.
- [ ] Runner odrzuca niedozwoloną mutację i po opuszczeniu allowed origin kończy run jako policy failure przed następną decyzją Jev; tekst strony nie może zmienić polityki ani asercji.
- [ ] Jev DONE, BLOCKED, stale page, timeout, model/browser unavailable, policy failure i assertion failure pozostają rozróżnialnymi wynikami; tylko wszystkie niezależne asercje dają passed.
- [ ] Każdy failed result wskazuje failed assertion lub przyczynę wykonawczą oraz zachowuje końcowy URL, trace i screenshoty w lokalnym evidence store.
- [ ] Fixture-based testy przechodzą przez publiczny runner i obejmują wszystkie typy asercji oraz kluczowe niepowodzenia, bez retry niejednoznacznej browser mutation.
