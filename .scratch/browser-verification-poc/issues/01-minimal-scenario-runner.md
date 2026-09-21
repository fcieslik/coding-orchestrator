# 01: Minimalny Scenario Runner z lokalną fixture

**What to build:** Użytkownik może uruchomić jeden deklaratywny Verification scenario przeciw lokalnej fixture page. Runner używa przypiętej rewizji upstreamowego Jev oraz istniejącego Chrome, prowadzi flow do zakończenia i zwraca ustrukturyzowany wynik passed albo failed, kod wyjścia, podstawowy trace i screenshot. Jest to jeden publiczny kontrakt, z którego później skorzystają scenariusze i adaptery.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Minimalny Verification scenario z URL, goal, nie-sekretnym test data i timeoutem jest walidowany; nieznana lub niepoprawna konfiguracja kończy się jednoznacznym błędem konfiguracji bez browser mutation.
- [ ] Publiczne uruchomienie runnera wykonuje pełny flow na lokalnej fixture page i zwraca JSONowy rezultat, właściwy exit status, trace oraz screenshot zamiast uznawać Jev DONE za sukces.
- [ ] Przypięta zależność Jev, istniejący Chrome i wymagane lokalne klucze są sprawdzane jako jawne prerequisites; brak któregokolwiek daje najmniejszy użyteczny komunikat.
- [ ] Test integracyjny sprawdza zewnętrzny kontrakt runnera na fixture page, bez asercji prywatnych struktur Jev i bez wywoływania płatnych API w zwykłym teście.
