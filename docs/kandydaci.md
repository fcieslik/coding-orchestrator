Obecnie mamy następujących kandydatów na rozwój po V1:

### Najbardziej praktyczne

1. Lepsza diagnostyka awarii Workera
   - zachowanie ograniczonego stdout/stderr, operacji i exit code;
   - szczególnie gdy herdr agent start kończy się przed utworzeniem pełnego rekordu;
   - komunikaty w stylu: „ticket zablokowany, ponieważ…”, zamiast samego statusu blocked.

2. Obsługa innych agentów
   - live Worker dla Claude Code i Pi;
   - renderowanie /implement już istnieje, brakuje adapterów uruchamiania i testów kompatybilności.

3. Jawny cleanup po dostarczeniu wyniku
   - bezpieczne usunięcie Feature worktree i opcjonalnie Feature branch;
   - wyłącznie na polecenie użytkownika;
   - odmowa, jeśli istnieje niezintegrowana praca.

4. Lepsze wykrywanie rodzaju projektu
   - sensowne domyślne kontrole dla TypeScript, Python itd.;
   - obecnie użytkownik konfiguruje test, lint, typecheck, formatCheck i build.

5. Prostszy UX przygotowania workflow
   - mniej ręcznego boilerplate’u;
   - prostsze tworzenie pakietu ze spec.md i ticketów;
   - czytelne status, „następny ticket” i sugerowane następne polecenie.

### Dalsze rozszerzenie jakości

6. Niezależny semantic code review
   - świeży Reviewer używający $code-review;
   - stały diff BASE_SHA..HEAD_SHA;
   - ustrukturyzowane findingi;
   - deterministyczna reguła akceptacji, np. brak findingów high.

7. Security checks
   - osobny, jawnie skonfigurowany etap;
   - może być deterministycznym skanerem albo później niezależnym agentem.

8. HTTP/API validation
   - uruchomienie serwera;
   - wykonanie zdefiniowanych requestów;
   - zapis statusów, odpowiedzi i logów jako artefaktów.

9. Browser/UI validation
   - uruchomienie aplikacji;
   - scenariusz przeglądarkowy;
   - screenshoty i opcjonalnie visual regression baselines.

10. Bounded Fixer
    - świeży agent naprawiający konkretny wynik walidacji lub review;
    - jawny limit prób;
    - sekwencja typu review-1 → repair-1 → review-2, bez ukrytych pętli.

### Automatyzacja większych workflow

11. Automatyczne wykonanie całej kolejki ticketów
    - zamiast ręcznego wywoływania każdego ticketu;
    - nadal świeży Worker dla każdego zadania.

12. Graf zależności ticketów
    - blocked by;
    - obliczanie gotowych ticketów;
    - obowiązkowo acykliczny DAG.

13. Równoległe tickety
    - dopiero po grafie zależności;
    - prawdopodobnie osobne worktrees i jawna integracja wyników.

14. Import i synchronizacja trackerów
    - GitHub/Linear → lokalny Workflow package;
    - później write-back statusów i rezultatów;
    - Workery nadal nie powinny znać źródłowego trackera.

15. Szablony workflow / prosty YAML
    - frontend: implementacja → testy → browser → screenshots → PR;
    - backend: implementacja → testy → uruchomienie API → HTTP checks → PR;
    - warto dopiero po powstaniu co najmniej 2–3 rzeczywistych workflow, żeby nie projektować abstrakcji w ciemno.

### Mój rekomendowany porządek

diagnostyka
↓
cleanup
↓
Claude/Pi
↓
Reviewer
↓
HTTP albo Browser — według pierwszej realnej potrzeby
↓
bounded Fixer
↓
dopiero potem kolejka, DAG i YAML

Największy stosunek wartości do kosztu mają teraz: diagnostyka, cleanup i prostszy UX. Scheduler, DAG i DSL zostawiłbym zdecydowanie na później.

Aktualna lista odłożonych elementów znajduje się w roadmapie od Phase 5 (docs/coding-orchestrator-roadmap-phase-5-onward.md).

16. czasami status orchestratora wymaga recznego usuwania run bo cos sie zepsuło, cos nie uruchomiło
    trzeba przygotowac instrukcje lub skrypty jak to naprawic, tak zeby orchestrator lub inny główny agent (nie worker!) mogli to naprawiac!

• Mogę utworzyć nowy pakiet/run, ale jest ważna konsekwencja:

- main jest obecnie na 5f3610b — nie zawiera implementacji ticketów 02/03/04.
- Implementacja znajduje się tylko w starym worktree:
  - ticket 02: 84fbeec
  - ticket 03: 5109fe3
  - ticket 04: 77ee146
  - korekta dokumentacji: 7c95fa5

- Stary run jest zablokowany, więc orchestrator nie może użyć tych commitów jako
  zaakceptowanego checkpointu.

Nowy run z main oznaczałby ponowne wykonanie ticketów 02 → 03 → 04.

Wybierz proszę:

1. Utworzyć nowy pakiet/run i powtórzyć implementację 02–04 od aktualnego main —
   bezpieczna ścieżka orchestratora.

2. Ręcznie zintegrować istniejący branch orchestrator/
   run_20260918T075945Z_4d5a3899f2e0 z main — szybciej, ale omija zablokowaną
   akceptację orchestratora.
