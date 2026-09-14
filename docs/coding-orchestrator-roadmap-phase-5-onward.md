# Coding Workflow Orchestrator — Roadmap od Phase 5

Ten dokument zastępuje plan Phase 5–10 z głównej roadmapy. Phase 0–4 pozostają bez zmian.

Zasada dla V1:

> Gotowy spec i gotowe tickety są wykonywane sekwencyjnie, a wynik jest akceptowany na podstawie Git, ustrukturyzowanych rezultatów i deterministycznych dowodów.

Każdą fazę zamyka co najmniej jeden minimalny test live zgodny z [zasadą zamykania faz](coding-orchestrator-roadmap.md#zasada-zamykania-faz). Testy automatyczne pozostają wymagane, ale same nie wystarczają do oznaczenia fazy jako zakończonej.

---

# Phase 5 — user-driven ticket steps

## Cel

Rozszerzyć pojedynczy Worker vertical slice z Phase 4 tak, aby jeden trwały Workflow run mógł wykonać kilka przygotowanych ticketów. POC pozostaje sterowany przez użytkownika: jedno wywołanie wykonuje najwyżej jeden jawnie wskazany ticket i zwraca kontrolę.

## Flow

```text
local Workflow package
  spec.md + issues/*.md
        ↓
create or resume one Workflow run
        ↓
user selects the next ticket
        ↓
Phase 4 fresh Worker execution
        ↓
commit + accepted checkpoint
        ↓
return control to the user
```

## Implement

- operator interface: `$orchestrate <workflow-package> <ticket-id>`;
- ścisły lokalny Workflow package: `spec.md` oraz `issues/*.md`;
- walidacja przed startem runu wyłącznie formatu należącego do Orchestratora: regularne, niepuste pliki, bezpieczne i jednoznaczne Ticket IDs oraz poprawna konfiguracja; treść Markdown pozostaje opaque dla downstream `implement`;
- przy tworzeniu runu kopia całego Workflow package do immutable run input;
- canonical ticket ID jako nazwa pliku bez `.md`;
- stała kolejność ticketów według nazw plików;
- jeden Workflow run, Feature branch i Feature worktree dla całego pakietu;
- świeży Worker dla każdego ticketu;
- jedno user-triggered Workflow step wykonujące najwyżej jeden ticket;
- akceptacja wyłącznie pierwszego pending ticketu; brak pomijania kolejki;
- dispatch snapshotu ticketu do istniejącego subsystemu Phase 4;
- trwała mapa `pending | active | accepted` z commitem zaakceptowanego ticketu;
- idempotentny no-op dla ponownie wskazanego accepted ticketu;
- resume istniejącego runu bez powtarzania accepted ticketów;
- zatrzymanie na `blocked`, `failed` lub niejednoznacznym stanie;
- jawne ponowne wskazanie tego samego blocked ticketu jako prośba o resume i fresh bounded retry, wyłącznie po reconciliation potwierdzającej brak niezaakceptowanych efektów;
- zwięzły rezultat kroku: ticket, result, commit i next ticket;
- automatyczne oznaczenie runu jako `completed` po ostatnim accepted tickecie, z informacją, że etapy walidacji Phase 6 nie zostały jeszcze wykonane.

Minimalne wejście:

```text
.scratch/example/
├── spec.md
└── issues/
    ├── 01-first-slice.md
    └── 02-second-slice.md
```

Źródłem Workflow package może być lokalny tracker albo osobny proces importujący GitHub/Linear. Orchestrator wykonuje wyłącznie przygotowane lokalne pliki; Worker dostaje jeden konkretny Ticket input snapshot jako jedyny zakres implementacji oraz run-owned `spec.md` jako niemutowalny kontekst całej funkcji. Worker nie zna źródła ticketu ani pozostałych ticketów. Dokumentację techniczną targetowego repo odkrywa w worktree przez jego instrukcje, np. `AGENTS.md`.

## Kontrakt POC

- Ścieżka źródłowego Workflow package jest jego tożsamością. Orchestrator automatycznie wznawia jedyny niezakończony run dla tej ścieżki; wiele pasujących niezakończonych runów oznacza błąd zamiast arbitralnego wyboru. Nie utrzymujemy dodatkowego wskaźnika `active`.
- Run wykonuje skopiowany przy utworzeniu, niemutowalny snapshot specyfikacji i ticketów. Ponowne wskazanie `blocked` ticketu służy wyłącznie ponowieniu po usunięciu zewnętrznej przeszkody. Zmiana specyfikacji albo ticketu wymaga jawnego nowego runu; Phase 5 nie oferuje `--refresh`.
- Worker może opublikować wyłącznie `completed`, `blocked` albo `failed`. Timeout jest osobnym wynikiem transportowym Orchestratora, nie czwartym statusem `result.json`.
- Oczekiwanie na Workera ma konfigurowalny limit. Gdy Worker nie dostarczy poprawnego rezultatu, `execution.json` zachowuje ograniczoną diagnostykę z pane; POC nie utrwala pełnych transkryptów.
- Niedeterminizm Workera jest akceptowany. Deterministyczne pozostają wejście, format rezultatu oraz niezależna walidacja commita, HEAD i czystości Feature worktree.
- Phase 5 korzysta z logicznej konfiguracji roli, agenta i skilla; dopiero renderer agenta tworzy składnię taką jak Codex `$implement`. Nie wprowadzamy ogólnego DSL-a kroków, dopóki kolejne rzeczywiste etapy nie pokażą wspólnego modelu.

Uproszczenie domykające Phase 5: awaria sprzed dostarczenia promptu kończy bieżące wywołanie bez automatycznego ponowienia. Kolejne jawne `$orchestrate` jest jedynym sposobem ponowienia. Blokada współbieżnego wykonania, reconciliation oraz odmowa ponowienia przy niezaakceptowanym commicie, brudnym worktree lub niejednoznacznych artefaktach pozostają bez zmian.

## Ograniczenia V1

- brak wykonywania równoległego;
- brak automatycznego wykonywania całej kolejki;
- brak grafu zależności, `blocked by`, ready calculation i schedulera;
- brak bezpośrednich adapterów ani write-backu GitHub/Linear;
- brak konfigurowalnych formatów ticketów;
- brak cofania pojedynczego zaakceptowanego ticketu i przepisywania historii aktywnego runu; jeżeli zaakceptowana historia ma zostać odrzucona, użytkownik porzuca cały run albo rozpoczyna nowy zamiast wykonywać `git reset` wewnątrz aktywnego runu;
- brak automatycznego Fixera;
- brak command checks, review, HTTP i browser validation — należą do Phase 6.

## Minimalne testy

- jeden integracyjny fake-worker happy path obejmujący dwa tickety, resume i brak ponownego wykonania accepted ticketu;
- jeden scenariusz zatrzymania po `blocked` albo `failed`, obejmujący bezpieczny fresh retry tego samego ticketu po rozwiązaniu blockera;
- jeden zestaw przypadków odrzucający niepoprawny Workflow package;
- test publicznego `scripts/flow`, bez mnożenia osobnych testów tej samej ścieżki.

## Exit gate

Phase 5 jest zakończona, gdy disposable repo z dwoma uporządkowanymi ticketami przechodzi dwa jawne Workflow steps. Każdy krok uruchamia świeżego realnego Codex Workera w tym samym Feature worktree, restart Orchestratora między krokami nie powtarza pierwszego ticketu, a drugi accepted checkpoint kończy run.

---

# Phase 6 — deterministic project validation

## Cel

Dodać jeden jawny, deterministyczny walidacyjny etap dla zakończonego Workflow runu, bez uruchamiania agenta, bez Herdr pane, bez semantic review, HTTP, przeglądarki czy pętli naprawczej. Te możliwości pozostają osobnymi rozszerzeniami na później.

## Przebieg

```text
completed Workflow package
        ↓
rozwiązanie jedynego zakończonego runu po pakiecie (bez Run ID)
        ↓
przewarunki: wszystkie tickety accepted, Feature worktree gotowy,
czysty, HEAD == ostatni accepted Git checkpoint
        ↓
sekwencyjnie: test → lint → typecheck → formatCheck → build (Feature worktree jako cwd,
jeden skonfigurowany timeout na komendę)
        ↓
ponowna kontrola HEAD i czystości
        ↓
atomowa publikacja validation.json + additive stan walidacji + zdarzenie w Operational history
        ↓
passed | failed
```

## Kontrakt

- konfiguracja repo-local: dokładnie pięć nazwanych komend `test`, `lint`, `typecheck`, `formatCheck`, `build` plus jeden `timeoutSeconds`; bez generycznych stage'ów i sekwencji YAML; setup tworzy udokumentowaną wartość domyślną i zachowuje istniejącą poprawną konfigurację;
- komendy wykonywane dokładnie tak, jak są skonfigurowane, w shellu projektu, bez interpolacji wartości przez Orchestratora; konfiguracja jest zaufaną polityką właściciela repo;
- wszystkie pięć sprawdzeń jest wykonywanych, dopóki jest to bezpieczne; każdy wynik ma nazwę, dokładną komendę, status `passed | failed | timed_out`, nullable exit code, czas trwania i ograniczone diagnostyki stdout/stderr;
- walidacja przechodzi tylko gdy wszystkie komendy kończą się sukcesem oraz Feature worktree pozostaje czysty na tym samym HEAD; mutation poleceń zawodzi fail-closed i nie jest resetowana;
- brak Run ID w zwykłym interfejsie: operacja przyjmuje referencję Workflow package (ADR 0006) i odmawia przy braku, niejednoznaczności, niekompletnej kolejce lub złym stanie Git — zanim uruchomi pierwszą komendę;
- wynik: jeden wersjonowany, run-owned artifact (`validation.json`) publikowany atomowo przed odwołaniem w addytywnym stanie snapshotu; Operational history rejestruje decyzję bez stawania się workflow truth (ADR 0001);
- rerun po `failed` lub `passed` jest jawny; najnowszy pełny wynik dla bieżącego HEAD jest wiążący; brak automatycznych ponowień i pollingu;
- blokada per-run chroni przed równoległą walidacją i kolizją z inną operacją mutującą;
- Phase 5 ukończenie implementacji pozostaje odrębne od statusu walidacji; dotychczasowe snapshoty bez danych walidacji pozostają czytelne;
- zaimplementowane przez publiczne `flow validate <workflow-package> [--repo <path>] [--json]`; zero oznacza wyłącznie walidację zakończoną powodzeniem; zainstalowany skill kieruje prośbę o walidację pakietu do tego helpera bez uruchamiania agenta.

## Testy

- główny scenariusz przejścia przez publiczny `flow` w tymczasowym repo: konfiguracja, wybór runu po pakiecie, wykonanie komend w Feature worktree, kontrola Git, trwała publikacja, raportowanie i nienaruszony primary checkout;
- zwarta macierz awarii: niezerowy exit, brakujący plik wykonywalny, timeout, brudny worktree przed startem, zmieniony HEAD, komenda brudząca worktree; wszystkie bezpieczne sprawdzenia są reprezentowane, a `timed_out` jest odróżnialny od zwykłego błędu;
- scenariusz rerun: walidacja najpierw zawodzi, po jawnej korekcie przechodzi bez zmiany HEAD; najnowszy wynik i snapshot są spójne, bez automatycznego ponowienia;
- scenariusze odrzucenia przed pierwszą komendą: brak dopasowania pakietu, niejednoznaczne zakończone runy, niekompletna kolejka, przestarzały HEAD, brak konfiguracji walidacji;
- testy nie uruchamiają Codex, Claude Code, Pi, Herdr, serwera ani przeglądarki.

## Exit gate

Phase 6 jest zakończona, gdy pełny zestaw projektowych testów, typecheck, lint, format check, schema check i build przechodzi, a helper wydaje poprawny wynik dla zakończonego runu z trzema realnymi komendami w repozytorium jednorazowym (ręczny test zainstalowanego skilla).

---

# Phase 6.5 — workflow hardening and final quality gate

## Cel

Domknąć małe, praktyczne zabezpieczenia POC przed finalnym testem Phase 7. Ta faza nie dodaje nowego workflow engine, agenta ani integracji z GitHubem. Utwardza kontrakt Workera, rozdziela focused checks pojedynczego ticketu od pełnej walidacji projektu i potwierdza, że natywny `git worktree` pozostaje wystarczającym mechanizmem V1.

## Worker safety contract

- dodać jeden kanoniczny, instalowany plik `assets/prompts/worker-safeguards.md`;
- wstawiać jego treść bezpośrednio do każdego wyrenderowanego promptu Workera, niezależnie od wybranego agenta;
- uwzględniać finalny prompt z safeguards w istniejącym prompt hash;
- utrzymać następujące obowiązkowe ograniczenia:
  - pracuj wyłącznie w przypisanym Feature worktree;
  - nigdy nie modyfikuj primary checkout ani Integration target branch;
  - nigdy nie pushuj branchy, tagów ani commitów;
  - nigdy nie twórz, nie aktualizuj ani nie merguj Pull Requestu;
  - nigdy nie merguj, nie rebase'uj ani nie integruj branchy;
  - nigdy nie usuwaj worktree, branchy lub commitów ani nie odrzucaj zastanej lokalnej lub innej niezintegrowanej pracy;
  - gdy bezpieczne zakończenie jest niemożliwe, zachowaj pracę, zapisz poprawny `blocked` albo `failed` result i zatrzymaj się zamiast zgadywać;
- nie dodawać metodologii implementacji należącej do downstream `implement`.

## Polityka walidacji

- po pojedynczym tickecie Worker wykonuje tylko focused checks wynikające z `implement`, a Orchestrator niezależnie waliduje result artifact, commit, branch, HEAD i czystość worktree;
- Orchestrator nie uruchamia pełnego project pipeline po każdym tickecie;
- pełny deterministic quality gate uruchamia się raz, po zaakceptowaniu wszystkich ticketów;
- końcowy gate Phase 6 wykonuje jawnie skonfigurowane `formatCheck` (`format:check`) i `build`, obok `lint`, `typecheck` i `test`;
- zachować jeden run-owned `validation.json`, limity czasu, ograniczone diagnostyki oraz kontrolę niezmienionego HEAD i czystego worktree;
- nie dodawać generycznego DSL-a, grafu stage'ów, AI review, auto-fix ani automatycznej pętli naprawczej.

Inspiracją z `no-mistakes` jest wyłącznie pojedynczy, jawny quality gate przed publikacją. V1 nie osadza `no-mistakes` jako drugiego systemu zarządzającego worktree, walidacją, pushowaniem lub PR-ami.

## Worktree tooling

- lokalne branche, commity, checkpointy i worktrees nadal obsługuje standardowy `git` oraz istniejący adapter `git worktree`;
- zewnętrzne CLI do worktrees może zostać ocenione jako mały spike, ale nie staje się zależnością V1 bez wykazania, że usuwa realną złożoność i zachowuje wszystkie istniejące invarianty;
- GitHub CLI nie służy do lokalnego zarządzania branchami ani worktrees.

## Exit gate

Phase 6.5 jest zakończona, gdy każdy Worker otrzymuje kanoniczne safeguards, test renderera potwierdza ich obecność dla wspieranego agenta, pełny pipeline uruchamia się dopiero po ostatnim accepted tickecie, a końcowy wynik obejmuje wszystkie skonfigurowane kontrole bez zmiany Feature HEAD lub worktree.

## Status

**Zakończona 2026-09-09.** Automatyczne gate'y oraz ręczny test zainstalowanego skilla przeszły. Run `run_20260909T093920Z_64ec7b024428` uruchomił świeżego Codex Workera z kanonicznymi safeguards, zaakceptował commit `c01f98b98588925ac402058554e587566582b765`, a następnie zapisał pięć wyników `passed` bez zmiany Feature HEAD, Feature worktree ani primary checkout. Szczegółowe dowody znajdują się w [końcowym tickecie Phase 6.5](../.scratch/phase-6-5-workflow-hardening-final-quality-gate/issues/02-extend-and-pass-final-five-check-quality-gate.md).

---

# Phase 7 — end-to-end reliability

## Cel

Udowodnić, że cały V1 jest bezpiecznie wznawialny, nie raportuje fałszywego sukcesu i przekazuje zwalidowany wynik przez jeden jawnie wybrany kanał: lokalny fast-forward albo GitHub Pull Request.

Recovery powstaje razem z operacjami w Phase 4–6. Phase 7 nie dodaje nowego workflow engine; testuje i domyka istniejące recovery paths. Dostawa jest addytywnym wynikiem zakończonego runu, a nie nowym silnikiem lifecycle.

## Scenariusze

Minimalny zakres POC obejmuje:

- restart Orchestratora pomiędzy ticketami i potwierdzenie, że accepted ticket nie jest wykonywany ponownie;
- przerwanie przed finalizacją oraz bezpieczne, idempotentne ponowienie tej samej operacji;
- odmowę integracji bez mutacji, gdy Integration target branch nie wskazuje już Run base.

Pełna macierz przerwań podczas Workera, reconciliation i każdej komendy walidacyjnej pozostaje poza Phase 7; niższe warstwy zachowują własne focused recovery tests.

Po restarcie świeży Orchestrator używa wyłącznie trwałych źródeł:

- `state.json`;
- `history.jsonl`;
- Git i Feature worktree;
- Worker execution records;
- result i validation artifacts;
- bieżąca obserwacja Herdr.

`state.json` pozostaje źródłem bieżącego stanu, `history.jsonl` append-only audytem, a blokada runu ochroną przed współbieżnym zapisem. Nie dodajemy równoległego `events.jsonl` i nie próbujemy zastępować blokady samym logiem zdarzeń.

## Safe integration handoff

Po przejściu wszystkich wymaganych etapów Phase 6.5 użytkownik może jawnie przenieść zwalidowany wynik z Orchestrator-owned Feature branch na branch, z którego rozpoczął run:

```text
Integration target branch at Run base
              ↓
Feature branch in Feature worktree
  + accepted ticket commits
  + passed validation
              ↓
flow integrate <workflow-package>
              ↓
fast-forward Integration target branch
```

Minimalny kontrakt V1:

- przy tworzeniu nowego runu wymagać checkoutowanego lokalnego brancha i zapisać jego nazwę jako Integration target branch obok immutable Run base; detached HEAD jest odrzucany przed utworzeniem runu;
- `flow integrate <workflow-package>` rozwiązuje jedyny zakończony i zwalidowany run bez wymagania Run ID;
- jeśli dla dokładnie aktualnego Feature HEAD istnieje już wynik walidacji `passed`, użyć go bez ponownego uruchamiania checks; brak aktualnego wyniku uruchamia walidację przed dostawą, a jej błąd zatrzymuje operację;
- przed integracją potwierdzić, że primary checkout jest czysty, nadal ma checkoutowany zapisany Integration target branch, a jego HEAD nadal wskazuje Run base;
- potwierdzić, że Feature branch wskazuje ostatni zwalidowany HEAD i jest bezpiecznym potomkiem Run base;
- wykonać wyłącznie `git merge --ff-only` i zapisać zintegrowany commit jako trwały rezultat;
- jeśli target branch ruszył do przodu, branche się rozeszły albo checkout jest brudny, zakończyć bez mutacji i przekazać użytkownikowi ręczny merge/rebase;
- nie uruchamiać agenta, nie tworzyć automatycznego merge commita, nie rozwiązywać konfliktów i nie usuwać automatycznie Feature worktree ani brancha.

Przerwaną integrację rozstrzyga porównanie target HEAD: `Run base` oznacza operację jeszcze niewykonaną, zwalidowany Feature HEAD oznacza integrację już wykonaną, a każda inna wartość kończy się jako `blocked`. Ponowienie zakończonej integracji zwraca ten sam Delivery result.

To jest jawny krok publikacji zaakceptowanego wyniku, a nie część wykonania ticketu. Istniejące runy bez zapisanego Integration target branch nie są automatycznie integrowane.

## GitHub check and Pull Request handoff

GitHub handoff jest opcjonalną alternatywą dla lokalnego `flow integrate`, a nie drugim merge pathem wykonywanym w tym samym runie. Do momentu tego jawnego kroku cały standardowy workflow pozostaje lokalny i używa zwykłego `git`.

- przed wyborem kanału wykonać read-only preflight; Delivery channel staje się trwały dopiero bezpośrednio przed pierwszą mutacją;
- jeden run zapisuje dokładnie jeden jawnie wybrany Delivery channel: lokalny fast-forward albo GitHub Pull Request; ponowienie tej samej operacji jest idempotentne, a późniejsza zmiana kanału jest odrzucana;
- użytkownik wybiera kanał naturalnym poleceniem do `$orchestrate`; bez jawnego wyboru skill pyta zamiast zgadywać, a komendy `flow` pozostają wewnętrznym mechanizmem skilla;
- branch i commit przygotowuje istniejący lokalny workflow;
- jawne polecenie „przygotuj PR” autoryzuje publikację Feature branch przez zwykły `git push`, utworzenie PR oraz odczyt checks; nie autoryzuje merge ani cleanupu;
- push używa `origin`, istniejącej nazwy Feature branch i nigdy nie używa force; PR używa zapisanego Integration target branch jako base;
- zdalny base może ruszyć po Run base; Orchestrator nie wykonuje rebase i jawnie raportuje, że lokalna walidacja dotyczy zwalidowanego Feature HEAD, a bieżącą integrację oceniają GitHub checks;
- brak remote Feature branch pozwala na zwykły push, ten sam zdalny commit jest wynikiem idempotentnym, a inny commit pod tą samą nazwą blokuje operację bez force-push;
- przed utworzeniem PR sprawdzić, czy PR dla tego head/base już istnieje, aby bezpieczne ponowienie nie tworzyło duplikatu;
- tytuł PR pochodzi z tytułu `spec.md`, a deterministyczny krótki body zawiera Run ID, odniesienie do specyfikacji, accepted tickets, validated HEAD i wynik pięciu checks; nie kopiujemy całej specyfikacji ani transcriptów;
- Orchestrator używa oficjalnego `gh` do sprawdzenia uwierzytelnienia, wyszukania lub utworzenia PR oraz jednorazowego odczytania checks;
- `gh` nie zarządza lokalnymi branchami lub worktrees i nie stanowi źródła uprawnień;
- jeżeli wymagana operacja lub flaga nie jest obsługiwana, Orchestrator może użyć oficjalnego `gh`, zachowując ten sam kontrakt uprawnień;
- Orchestrator nie instaluje ani nie aktualizuje automatycznie `gh`;
- brak narzędzia, uwierzytelnienia albo GitHub remote kończy preflight bez mutacji i podaje najmniejszą wymaganą czynność użytkownika; po pierwszej zewnętrznej mutacji niejednoznaczny wynik zapisuje zablokowany handoff do jawnego wznowienia;
- Worker nie wykonuje żadnej z tych operacji; GitHub handoff należy wyłącznie do głównego Orchestratora;
- V1 tworzy albo odnajduje PR, jednokrotnie odczytuje i zapisuje checks jako `passed`, `failed`, `pending` albo `unavailable`, ale nie czeka w pętli, nie naprawia i nie merguje PR automatycznie;
- utworzony PR kończy handoff, natomiast stan checks pozostaje osobnym jawnie raportowanym wynikiem.

Delivery result jest addytywnym rekordem `state.json` i zawiera kanał, status `prepared`, `completed` albo `blocked`, zwalidowany HEAD oraz target branch. Brak rekordu oznacza, że kanał nie został jeszcze wybrany. `prepared` jest zapisywany pod blokadą bezpośrednio przed pierwszą mutacją, dzięki czemu restart nie gubi zamiaru dostawy. Dla lokalnej integracji rekord zawiera integrated commit; dla GitHub zawiera remote branch, numer i URL PR oraz ostatni zaobserwowany stan checks. Phase 7 nie dodaje nowych głównych Run phases.

Aktualny Delivery result należy do `state.json`, a istniejący `history.jsonl` zapisuje przejścia `prepared`, `completed` i `blocked`. Nie powstaje osobny `delivery.json` ani nowy log. Operacje walidacji i dostawy używają istniejącej blokady Workflow runu; konkurencyjny proces otrzymuje `WORKFLOW_STEP_IN_PROGRESS` i nie przejmuje operacji.

Po udanej dostawie Orchestrator nie usuwa automatycznie Feature worktree ani Feature branch. Cleanup pozostaje jawną, późniejszą operacją użytkownika.

Wewnętrzne operacje pozostają wyspecjalizowane i małe:

```text
flow integrate <workflow-package>
flow pr <workflow-package>
```

Globalny `$orchestrate` wybiera jedną z nich z naturalnego polecenia użytkownika. Nie powstaje generyczny framework `deliver --channel`.

`flow pr` jest właścicielem deterministycznego preflightu, `git push`, wywołań oficjalnego `gh`, wyszukania lub utworzenia PR, odczytu checks oraz zapisu stanu. Główny LLM rozpoznaje intencję, ale nie odtwarza tej procedury z pamięci rozmowy. Matching otwarty PR jest używany ponownie, zmergowany jest zapisywany jako zakończony z jawną informacją o zewnętrznym merge, a zamknięty bez merge lub więcej niż jeden matching PR kończy się jako `blocked`.

## Validation failure limitation

Delivery nie rozpoczyna się po nieudanej końcowej walidacji. Walidację można jawnie ponowić po naprawie środowiska bez zmiany Feature HEAD. Jeżeli naprawa wymaga zmiany kodu, V1 zachowuje Feature worktree i kończy automatyczny handoff; ręczna naprawa albo nowy Workflow package/run pozostają odpowiedzialnością użytkownika. Phase 7 nie dodaje Fixera, adopcji ręcznego commita ani ponownego otwierania zakończonej Ticket queue.

## Invariants

- Run phase `completed` oznacza w V1 `implementation complete`; pełny wynik V1 wymaga dodatkowo aktualnej walidacji `passed` i Delivery result `completed`;
- zaakceptowany ticket nie jest wykonywany ponownie;
- aktywny agent nie jest duplikowany bez reconciliation;
- owned panes i procesy są zamykane bez naruszania cudzych zasobów;
- częściowy albo sprzeczny artifact nie daje statusu `passed`;
- stan niejednoznaczny kończy się jako `blocked`, nigdy jako domniemany sukces;
- resume prowadzi do tego samego końcowego wyniku co wykonanie bez restartu.

Naturalne polecenie „zwaliduj i zintegruj lokalnie” albo „zwaliduj i przygotuj PR” uruchamia kolejno dwie trwałe operacje: walidację, jeśli nie istnieje aktualny wynik dla tego HEAD, a następnie wybrany handoff. Restart pomiędzy nimi wykorzystuje zapisany wynik walidacji i nie uruchamia checks ponownie.

## Final live gate

W disposable real repository wykonać:

```text
approved spec
      ↓
multiple local tickets
      ↓
fresh skill-aware Workers
      ↓
commits + accepted checkpoints
      ↓
configured deterministic validation
      ↓
durable final result and artifacts
      ↓
explicit delivery choice
      ├── safe fast-forward to local Integration target branch
      └── git push + gh PR/check handoff
```

Minimalny live gate używa disposable repo i dwóch małych ticketów. Po pierwszym tickecie główny Orchestrator jest restartowany; drugi ticket musi użyć tego samego runu bez ponowienia pierwszego. Naturalne polecenie uruchamia walidację i lokalną integrację, po czym test potwierdza fast-forward, czysty checkout oraz idempotentne ponowienie. Osobny negatywny run potwierdza odmowę po przesunięciu target branch.

Automatyczne testy obejmują lokalny happy path z idempotentnym powtórzeniem, parametryzowane odmowy dla niespełnionych warunków Git oraz GitHub adapter z fake `git`/`gh`. Osobny opcjonalny manualny wariant GitHub potwierdza jawny push, utworzenie PR przez oficjalne `gh` i odczyt checks bez automatycznego merge; nie jest wymagany do zamknięcia lokalnego V1.

Po przejściu tego gate'u V1 jest gotowe do użycia na przygotowanych specach i ticketach.

## Status

**Zakończona 2026-09-10.** Pełne gate'y Development repository przeszły: 160 testów oraz build, lint, typecheck, format check, schema check, installer i porównanie Installed-skill snapshot. Lokalny run `run_20260910T200221Z_31ca2a6648d9` potwierdził restart pomiędzy dwoma ticketami, walidację dokładnego Feature HEAD, fast-forward bez merge commita oraz idempotentne ponowienie. Run `run_20260910T202830Z_ee0bb90d618f` bezpiecznie odmówił integracji po przesunięciu `master`, bez mutacji i cleanupu. Opcjonalny GitHub gate utworzył przez oficjalne `gh` [PR #1](https://github.com/fcieslik/coding-orchestrator-phase7-live/pull/1) i ponowił handoff bez duplikacji. Szczegółowe dowody znajdują się w [końcowym tickecie Phase 7](../.scratch/phase-7-end-to-end-reliability/issues/03-pass-the-phase-7-end-to-end-reliability-gate.md).

---

# Phase 8 — unresolved review findings and fresh Fixer

Phase 8 extends the Worker result without changing the downstream review methodology. A completed Worker may return a clean review or bounded `review.status = attention` findings. The latter preserves a validated Candidate commit, records `reviewAttention` and `worker.review.attention` durably, closes the originating pane, and blocks the run while leaving the Ticket active. Legacy completed results without review data remain on the existing acceptance path. Fresh Fixer resolution is the following Phase 8 ticket.

## Status

**Zakończona 2026-09-14.** The result/state schemas, Worker contract, candidate validation, durable Review attention, restart-safe reporting, queue refusal, explicit user resolution, and one fresh bounded Fixer are in place. All 165 tests and the remaining Development gates passed. Live run `run_20260914T123825Z_85a138a1a717` preserved Candidate commit `397da994e0702701ed4ac7db52c08827924b0e42` across a main-Orchestrator restart, refused the next ticket, and accepted separate Fixer commit `1017a95366448d44ad88397248ee93ead3f86cfc`. Repeating the same resolution was an idempotent no-op. The primary checkout remained unchanged and every owned pane closed. The first Worker attempt stopped at Codex's hook-trust screen without Git effects; a subsequent safe retry produced the sole Candidate commit. Detailed evidence is recorded in the [Phase 8 gate ticket](../.scratch/phase-8-review-findings-and-fresh-fixer/issues/03-pass-the-phase-8-review-resolution-gate.md).

---

# Poza V1

Następujące elementy są świadomie odłożone:

- automatyczna wielokrokowa pętla fix/review; Phase 8 obsługuje wyłącznie jeden jawnie uruchomiony Fixer dla decyzji użytkownika;
- automatyczne wykonanie całej Ticket queue;
- acykliczny dependency DAG, `blocked by` i ready-ticket calculation;
- równoległe wykonywanie ticketów;
- importery GitHub/Linear tworzące lokalny Workflow package;
- write-back wyników do GitHub/Linear;
- automatyczne mergowanie Pull Requestów;
- konfigurowalne układy i formaty ticketów;
- ponowne otwieranie lub częściowe wykonywanie pakietu;
- schedulery, priorytety i strategie wyboru ticketów;
- visual regression baselines;
- dowolne pluginy lub ogólny workflow DSL;
- automatyczne odpowiadanie na blockery.
- lepsza diagnostyka technicznych awarii Worker attempt, opisana poniżej.

## Następne usprawnienie — diagnostyka awarii Workera

Rozszerzyć istniejący model bez tworzenia osobnego systemu logów:

- zapisać `execution.json` przed pierwszą operacją Herdr; jeśli sam zapis się nie
  powiedzie, nie uruchamiać pane ani Workera;
- rozszerzyć istniejące `diagnostics` o operację, komunikat, nullable exit code i
  signal oraz końcowe 16 KiB każdego z `stdout` i `stderr`; wspólne `truncated`
  informuje o skróceniu;
- zachować główną awarię w `diagnostics`, a ewentualną wtórną awarię zamknięcia
  pane w istniejącym `cleanup.error`;
- Worker attempt otrzymuje `failed`, Workflow run otrzymuje `blocked`, a ticket
  pozostaje niezaakceptowany;
- istniejące `lastExecution` i zdarzenie `workflow.ticket.blocked` otrzymują
  krótki `failureReason`; `lastExecution.path` nadal wskazuje pełny rekord;
- komunikat CLI podaje ticket, operację, exit code, najwyżej 300 znaków z
  pierwszej niepustej linii `stderr` oraz ścieżkę `execution.json`;
- nie zapisywać pełnego promptu, environment variables, niesanitowanego argv ani
  pełnego transcriptu. Nie dodawać redaktora sekretów do POC;
- nie zmieniać reconciliation ani zasad retry: ponowienie pozostaje jawne;
- zachować `schemaVersion: 1`, ponieważ nowe pola są opcjonalne.

Minimalny gate obejmuje trzy regresje: błąd `herdr agent start` utrwalony w
`execution.json`, krótki powód i odnośnik utrwalone w stanie/historii oraz zwięzły
komunikat CLI bez pełnego logu. Review findings i Review attention pozostają
osobnym wynikiem świadomie zakończonego Workera, a nie diagnostyką technicznej
awarii.

Jeżeli powstanie graf lub pętla naprawcza, każda naprawa i ponowne review muszą być osobnymi, numerowanymi jednostkami pracy z własnymi wejściami i artefaktami. Graf nie może zawierać self-edge ani krawędzi powrotnej do przodka; iterację reprezentuje się jako `review-1 → repair-1 → review-2`, a nie ukryty powrót do wcześniejszego węzła.

Można je dodawać na podstawie rzeczywistych potrzeb zaobserwowanych podczas używania V1.
