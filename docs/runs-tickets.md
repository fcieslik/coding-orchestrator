Dwa tickety są częścią jednego Workflow run, jeśli pochodzą z tego samego Workflow package i nie użyjesz --new-run.

Każdy ticket dostaje jednak osobnego, świeżego Workera i osobny katalog artefaktów:

.orchestrator/runs/run_XXX/
├── state.json
├── input/
│ └── package/
│ ├── spec.md
│ └── issues/
└── workers/
├── 01-first/
│ └── attempt-01/
│ ├── input/ticket.md
│ ├── execution.json
│ └── output/result.json
└── 02-second/
└── attempt-01/
├── input/ticket.md
├── execution.json
└── output/result.json

Czyli:

- run_XXX — wspólny dla całej kolejki ticketów;
- workers/01-first i workers/02-second — osobne wykonania ticketów;
- tickety są wykonywane sekwencyjnie, po jednym wywołaniu;
- oba Workery pracują na tym samym Feature worktree i branchu;
- retry tego samego ticketu tworzy attempt-02 w jego katalogu.

Przykład:

flow orchestrate feature 01-first
flow orchestrate feature 02-second

Drugie polecenie wznowi ten sam run i uruchomi nowego Workera dla drugiego ticketu. Ten model jest opisany w flow (docs/coding-
orchestrator-flow.md:200) i architekturze (docs/coding-workflow-orchestrator-handoff-updated.md:1100).

Herdr sam tego nie wie. Pane uruchamia cyklicznie:

flow status --repo <repo-z-kontekstu> --json

Mechanizm jest taki:

1. Repozytorium bierze z kontekstu Herdr albo z cwd pane’a — dlatego ważne jest --cwd "$PWD".
2. flow status przegląda .orchestrator/runs/.
3. Bez --run wybiera:
   - jedyny run w fazie nieterminalnej;
   - jeśli takiego nie ma — jedyny run terminalny;
   - przy wielu kandydatach zwraca AMBIGUOUS_RUN, bez zgadywania.

4. Pane odświeża wynik mniej więcej co sekundę i pokazuje runId, fazę, ticket aktywny/następny oraz postęp.

Czyli „obecny run” oznacza tutaj jednoznacznie wybrany trwały run z repozytorium, a nie konkretny proces Herdr. Implementacja:
plugins/coding-orchestrator-status/status.mjs i selectRun (src/workflow-run.ts:1113).

Tak. runId jest znany zanim Worker zostanie uruchomiony.

Przebieg:

1. flow orchestrate szuka istniejącego niedokończonego runu dla danego Workflow package.
2. Jeśli go nie ma, Orchestrator wywołuje createRun(), który generuje runId — domyślnie z timestampu i losowego komponentu.
   Można też przekazać jawny ID.

3. Orchestrator zapisuje run w .orchestrator/runs/<runId>.
4. Przy starcie Workera przekazuje ten sam state.runId do executeWorker(...).
5. runId trafia do:
   - promptu Workera,
   - execution record,
   - ścieżki artefaktów,
   - aktualnego snapshotu runu.

Czyli Worker nie wybiera i nie generuje runu. Jest uruchamiany już w kontekście konkretnego runu:

executeWorker({
repository,
runId: state.runId,
ticket: selected.input,
...
});

Źródła: src/workflow-step.ts:428, src/workflow-run.ts:798, src/worker-execution.ts:1200.

Faza nieterminalna” to faza, w której run nie został jeszcze ostatecznie zakończony. W obecnym modelu są to:

- created — run utworzony, jeszcze nieprzygotowany
- preparing — przygotowanie worktree
- implementing — wykonywanie ticketów przez Workerów
- reviewing — przegląd implementacji
- checking — końcowe sprawdzenia
- fixing — poprawianie problemów po review/checkach
- blocked — zatrzymany, wymaga decyzji albo wznowienia

Fazy terminalne, czyli zakończone i niewybierane jako aktywne, to:

- completed
- failed
- cancelled

Typowy przebieg wygląda tak:

created → preparing → implementing → reviewing → checking → completed
↓ ↓
fixing fixing
↓ ↓
reviewing checking

preparing to faza przygotowania izolowanego środowiska Git dla runu. Nie działa wtedy jeszcze Worker.

W tej fazie Orchestrator:

- wybiera bazowy commit (HEAD, chyba że podano inny);
- ustala branch Feature, domyślnie orchestrator/<runId>;
- ustala zewnętrzny Feature worktree;
- zapisuje ten plan trwale w stanie runu;
- przechodzi do preparing przed wykonaniem zmian w Git;
- tworzy branch i worktree;
- sprawdza, czy worktree wskazuje na właściwy commit i jest bezpieczny do pracy.

Po pomyślnej walidacji zapisuje worktreeStatus: "ready" i przełącza run do implementing. Dopiero wtedy może wystartować Worker.

created
↓
preparing ← plan + branch + Feature worktree + walidacja
↓
implementing ← Worker może działać

Ta faza jest celowo trwała: jeśli proces zostanie przerwany po zapisaniu planu, kolejne uruchomienie może dokończyć dokładnie
ten sam branch/worktree. Przy niejednoznacznym stanie Orchestrator odmawia zgadywania.

Kod: prepareWorktree (src/git-worktree.ts:1801), automatyczne przygotowanie w $orchestrate workflow-step (src/workflow-
step.ts:460).
