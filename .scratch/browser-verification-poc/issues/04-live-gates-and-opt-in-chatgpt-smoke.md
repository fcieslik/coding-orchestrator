# 04: Live gates i opt-in smoke test ChatGPT

**What to build:** Użytkownik może świadomie udowodnić działanie pełnego POC z realnym Chrome, upstream Jev i skonfigurowanymi kluczami, a także ręcznie uruchomić bezpiecznie opisany Opt-in external smoke scenario w nowym pustym czacie ChatGPT. Żaden z tych live flow nie staje się zwykłym testem CI.

**Blocked by:** 02: Niezależne asercje, polityka scenariusza i evidence; 03: Natywne adaptery skilla dla Codex, Claude Code i Pi.

**Status:** ready-for-agent

- [ ] Jawnie uruchamiany local live gate przechodzi przez publiczny runner na fixture page z realnym Chrome i Jev; przy braku Chrome, kluczy lub remote access raportuje unavailable prerequisite zamiast fałszywego PASS.
- [ ] Opt-in external smoke scenario dla chatgpt.com przed startem ostrzega, że widoczny tekst strony może trafić do TypeSafe oraz text-model providerów, i wymaga potwierdzenia użytkownika.
- [ ] Scenariusz ChatGPT otwiera nowy pusty chat, wysyła „Cześć!” i uznaje sukces tylko po widocznym submission oraz pojawieniu się odrębnego tekstu po zakończeniu generowania.
- [ ] Live gate i scenariusz ChatGPT są wyłączone z CI oraz zwykłych testów; testy automatyczne obejmują wyłącznie ich kontrakt prerequisite/confirmation, bez otwierania zewnętrznej usługi.
- [ ] Evidence z live runs pozostaje lokalne i ignorowane przez Git.
