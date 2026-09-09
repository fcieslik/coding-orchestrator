# Coding Workflow Orchestrator — Roadmap

Phase 5 i dalsze fazy są rozwijane w uproszczonym roadmapie POC: `docs/coding-orchestrator-roadmap-phase-5-onward.md`. W razie różnicy ten dokument jest rozstrzygający dla Phase 0–4, a uproszczony roadmap dla Phase 5+.

## Cel projektu

Zbudować lokalny, trwały orchestrator workflow dla developmentu opartego na:

- **Herdr** jako warstwie terminal/process orchestration,
- **świeżych agentach codingowych** uruchamianych per task,
- **Git + worktrees** jako trwałym stanie kodu,
- **repo-local runtime state** w `.orchestrator/`,
- **structured artifacts** jako protokole między agentami a Orchestratorem,
- **niezależnym reviewerze uruchamianym przez istniejący skill `code-review`**,
- **deterministycznych checkach**,
- **bounded fixer loop**,
- **restart/resume** bez utraty workflow.

Kluczowa zasada:

> Agents are ephemeral. The workflow is durable.

Herdr nie jest workflow engine. Herdr zarządza procesami, pane'ami, cwd i agent lifecycle.  
Workflow semantics, transitions i decyzja „co dalej” należą do Orchestratora.

Skills definiują engineering methodology. Orchestrator definiuje workflow semantics i minimalny execution contract. Agent adapters renderują agent-specific skill invocation syntax, a Herdr transportuje gotowy prompt bez interpretowania jego semantyki.

> Orchestrator nie reimplementuje metodologii należącej do downstream engineering skills. Worker i reviewer prompts są skill-aware wrappers, nie samodzielnymi metodologiami.

---

# 1. Scope pierwszego MVP

Pierwsza wersja powinna być celowo mała.

## MVP scenario

System powinien obsłużyć:

- jedno repo,
- jeden zaakceptowany spec,
- dwa małe tickety,
- jeden feature worktree,
- wykonywanie sekwencyjne,
- świeży worker per ticket,
- Herdr,
- Codex jako worker,
- Codex jako domyślny reviewer V1,
- jeden deterministic check,
- maksymalnie jeden fixer retry,
- `state.json`,
- `history.jsonl`,
- restart/resume.

## MVP success criteria

Przepływ:

```text
approved spec
    ↓
tickets
    ↓
create durable run
    ↓
create feature worktree
    ↓
fresh worker
    ↓
commit + result.json
    ↓
checkpoint validation
    ↓
fresh worker
    ↓
commit + result.json
    ↓
checkpoint validation
    ↓
fresh reviewer
    ↓
deterministic checks
    ↓
fresh fixer if required
    ↓
final validation
    ↓
completed
```

MVP powinien również przetrwać restart głównego Orchestratora w trakcie workflow.

---

# 2. Architektura docelowa

```text
                     HUMAN
                       │
                       ▼
               Orchestrator Agent
                 + SKILL.md
                       │
              ┌────────┴─────────┐
              │                  │
              ▼                  ▼
       deterministic `flow`     Herdr
       CLI / state / git         panes/processes
              │                  │
              │                  ├── fresh Worker
              │                  ├── fresh Worker
              │                  ├── fresh Reviewer
              │                  └── fresh Fixer
              │
              ▼
       .orchestrator/
       state + artifacts
              │
              ▼
         Git worktree
```

## Responsibility split

### Orchestrator

Odpowiada za:

- routing workflow,
- walidację jawnie wskazanego następnego ticketu,
- uruchamianie workerów,
- walidację rezultatów,
- przejścia state machine,
- reviewer/fixer routing,
- retry policy,
- recovery,
- completion decision.

Orchestrator buduje logiczne wywołania ról i skills oraz dodaje wyłącznie kontekst i kontrakt potrzebny do trwałego wykonania workflow. Nie opisuje własnej metodologii implementacji ani code review.

### Herdr

Odpowiada za:

- pane creation,
- cwd,
- uruchamianie agentów,
- prompt delivery,
- lifecycle state,
- output,
- wait,
- process termination.

Herdr traktuje prompt jako opaque payload: wysyła już wyrenderowaną treść bez znajomości `implement`, `code-review`, ticketów, review ani artifact semantics.

### Downstream engineering skills

Odpowiadają za sposób wykonania pracy:

- `implement` — implementation methodology,
- `code-review` — review methodology względem fixed diff.

Rola, agent i skill są odrębnymi pojęciami. Workflow przechowuje logiczną nazwę skill; agent renderer tłumaczy ją na składnię wybranego agenta, np. Codex `$implement` lub `$code-review`.

### Git / worktree

Odpowiada za:

- trwały stan kodu,
- feature branch,
- task commits,
- fixed base SHA,
- final HEAD,
- checkpoint verification.

### Structured artifacts

Odpowiadają za:

- worker result,
- review result,
- check result,
- fixer result,
- execution metadata.

---

# 3. Development repository

Projekt powinien być rozwijany jako normalne Git repo.

Przykład:

```text
~/workspace/coding-orchestrator/
```

Nie rozwijać projektu bezpośrednio w:

```text
~/.agents/skills/orchestrate/
```

Installed skill powinien być osobnym, jawnie budowanym snapshotem.

---

# 4. Proponowany layout repo

```text
coding-orchestrator/
├── SKILL.md
│
├── references/
│   ├── worker-contract.md
│   ├── reviewer-contract.md
│   ├── fixer-contract.md
│   ├── state-machine.md
│   ├── recovery.md
│   └── herdr.md
│
├── scripts/
│   ├── flow
│   └── setup
│
├── assets/
│   └── prompts/
│       ├── worker.md
│       ├── reviewer.md
│       ├── fixer.md
│       └── blocked-resume.md
│
├── src/
│   ├── cli.ts
│   ├── config.ts
│   ├── ids.ts
│   │
│   ├── state/
│   │   ├── schema.ts
│   │   ├── transitions.ts
│   │   ├── store.ts
│   │   └── history.ts
│   │
│   ├── git/
│   │   ├── repo.ts
│   │   ├── worktree.ts
│   │   └── checkpoint.ts
│   │
│   ├── herdr/
│   │   ├── cli.ts
│   │   ├── pane.ts
│   │   └── agent.ts
│   │
│   ├── tickets/
│   │   ├── source.ts
│   │   ├── queue.ts
│   │   └── validate.ts
│   │
│   ├── execution/
│   │   ├── worker.ts
│   │   ├── reviewer.ts
│   │   └── fixer.ts
│   │
│   ├── checks/
│   │   ├── runner.ts
│   │   └── result.ts
│   │
│   └── runtime/
│       ├── paths.ts
│       └── recovery.ts
│
├── schemas/
│   ├── state.schema.json
│   ├── ticket-result.schema.json
│   ├── review-result.schema.json
│   └── checks-result.schema.json
│
├── tests/
├── install-skill.sh
├── package.json
├── tsconfig.json
└── README.md
```

Nie trzeba implementować całej tej struktury od pierwszego dnia.

---

# 5. Phase 0 — bootstrap projektu

## Cel

Utworzyć działające repo developerskie i minimalny executable entrypoint.

## Zadania

- utworzyć repo Git,
- skonfigurować TypeScript,
- skonfigurować test runner,
- dodać lint/format,
- utworzyć `scripts/flow`,
- dodać pusty `SKILL.md`,
- dodać `install-skill.sh`,
- dodać podstawowy build do `dist/`.

## Minimalny rezultat

```bash
pnpm test
pnpm build
./scripts/flow --help
```

powinny działać lokalnie.

---

# 6. Phase 1 — durable state

To pierwszy właściwy subsystem.

## Implementacja

Zbudować:

- run IDs,
- state schema,
- state store,
- transition function,
- append-only history,
- locking,
- crash-safe writes,
- `flow status`,
- `flow history`.

## Run states

Przykładowe:

```text
created
preparing
implementing
reviewing
checking
fixing
blocked
failed
cancelled
completed
```

## Ważna zasada

Centralizować transitions:

```ts
transition(currentState, event) -> nextState
```

Nie trzeba używać XState w V1.

## Testy

- valid transitions,
- invalid transitions refused,
- crash-safe writes,
- event ordering,
- corrupted state handling,
- lock behavior.

---

# 7. Phase 2 — Git / worktree

## Cel

Uczynić Git częścią protokołu workflow.

Skill-aware worker/reviewer correction nie zmienia Phase 2. Prompt i invocation semantics należą do późniejszych faz; repo identity, base, worktree, checkpoint i cleanup pozostają bez zmian.

## Implementacja

Zbudować:

- repo detection,
- base SHA resolution,
- feature branch creation,
- worktree creation,
- branch/head validation,
- checkpoint validation,
- dirty-state detection,
- safe cleanup guard.

## Invariants

- primary checkout nie jest używany do delegated implementation,
- run zapisuje immutable `BASE_SHA`,
- sequential tickets używają jednego feature worktree,
- każdy ticket normalnie kończy się commitem,
- checkpoint zapisuje commit SHA,
- cleanup jest fail-closed.

## Testy

Używać temporary Git repos.

Scenariusze:

- create worktree,
- commit validation,
- missing commit,
- stale commit,
- dirty worktree,
- wrong branch,
- cleanup refusal.

---

# 8. Phase 3 — Herdr adapter

## Cel

Zbudować minimalną warstwę potrzebną do sterowania agentami i zamknąć **Herdr feasibility gate**: udowodnić na żywym Codexie, że automatyzacja Herdr działa end to end, zanim Phase 4 oprze na niej worker execution.

Phase 3 jest ukończona dopiero, gdy przechodzą oba poziomy dowodu:

1. deterministyczne testy adaptera z fake `herdr` executable;
2. jawnie uruchomiony `flow herdr smoke --agent codex` wewnątrz Herdr (`HERDR_ENV=1`).

## V1 primitives

```text
create/start agent
prompt agent
wait
read output
close
```

Publiczny CLI V1 dodaje tylko gate command:

```text
flow herdr smoke --agent codex [--json] [--output <file>] [--keep-pane]
```

Pozostałe primitives są wewnętrznym TypeScript API. Adapter:

- tworzy sibling pane względem caller pane z explicit absolute cwd i `--no-focus`;
- przechowuje owned handle zawierający pane ID i agent name;
- używa deterministycznej, znormalizowanej nazwy zgodnej z `[a-z][a-z0-9_-]{0,31}` i odmawia kolizji;
- wywołuje `herdr` przez injectable argv-based command runner, nigdy przez shell-built command;
- przyjmuje caller-supplied timeouts; smoke używa 30 sekund dla startu i 120 sekund dla prompt settlement;
- rozpoznaje kompatybilność po wymaganym zachowaniu i polach JSON, zapisując zaobserwowaną wersję wyłącznie diagnostycznie;
- ogranicza przechwycony output i nie zapisuje pełnego promptu w diagnostyce.

Preferować wysokopoziomowe Herdr agent API tam, gdzie jest niezawodne.

Raw pane operations traktować jako fallback.

Adapter przyjmuje już wyrenderowany prompt jako opaque payload i przekazuje go bez zmian. Nie konstruuje ani nie interpretuje downstream skill invocation, ticket semantics, review semantics ani result semantics.

## Ważna zasada

Herdr lifecycle state nie jest workflow truth.

```text
agent done
```

oznacza tylko, że proces zakończył pracę.

Nie oznacza:

```text
ticket done
```

`wait` zwraca jawny wynik transportowy:

```text
settled     # Herdr idle lub done
blocked
unknown
timed-out
disappeared
```

Invocation/protocol failures, takie jak brak executable, non-zero CLI exit lub malformed JSON, pozostają błędami adaptera. Żaden wynik transportowy sam nie kończy ticketu.

## Live feasibility gate

Smoke test musi potwierdzić:

- wykonanie wewnątrz Herdr i dostępność caller context;
- utworzenie owned pane z żądanym cwd bez zmiany focusu;
- start i detekcję świeżego, jednoznacznie nazwanego Codexa;
- dostarczenie multiline opaque prompt zawierającego nonce i literalne `$implement`;
- odczyt odpowiedzi zawierającej nonce i oczekiwany cwd;
- settled lifecycle observation;
- zamknięcie wyłącznie utworzonego pane.

`blocked`, `unknown`, timeout, process disappearance oraz close failure odróżniają się w raporcie, ale wszystkie failują gate. `--keep-pane` jest trybem diagnostycznym, raportuje `cleanup: skipped` i nie stanowi pełnego passing gate. Przy close failure raport eksponuje owned pane ID, lecz nie kończy innych panes ani serwera. JSON report trafia na stdout; `--output` opcjonalnie utrwala ten sam raport bez mutowania workflow state.

## Testy

Mockować command runner.

Scenariusze:

- launch success,
- blocked,
- done,
- unknown,
- timeout,
- process disappearance,
- malformed CLI output.

Test command runnera musi również potwierdzić byte-for-byte opaque prompt forwarding, cleanup po częściowym launchu, collision refusal i bounded diagnostics. Real-agent smoke jest jawny i opt-in; `pnpm test` nie uruchamia interaktywnych ani płatnych agentów.

---

# 9. Phase 4 — skill-aware Worker vertical slice

To jest pierwszy realny coding-workflow proof-of-concept: jeden jawnie wskazany local Markdown ticket jest wykonywany w przygotowanym Workflow runie. Phase 5 dodaje przygotowany Workflow package, trwałą Ticket queue oraz user-triggered Workflow steps.

## Flow

```text
flow run create + Git preparation
      ↓
flow worker execute --run <run-id> --ticket <path> [--repo <path>]
      ↓
immutable Ticket input snapshot
      ↓
RoleExecution(worker, configured agent, skill = implement)
      ↓
agent renderer
      ↓
$implement "<absolute-snapshot-path>"       # Codex
/implement "<absolute-snapshot-path>"       # Claude/Pi rendering only in Phase 4
+ orchestration contract
      ↓
Herdr → fresh Codex Worker
      ↓
one or more commits + output/result.json
      ↓
reconciliation + owned-pane cleanup
      ↓
atomic checkpoint/attempt acceptance
```

Publiczne operacje V1:

```text
flow worker execute
flow worker reconcile
flow worker retry
```

Ponowne `execute` nie tworzy duplikatu. `reconcile` bada interrupted lub ambiguous attempt, a `retry` tworzy kolejny attempt dopiero po udowodnieniu, że jest to bezpieczne. Komendy wymagają runu w `implementing` z gotowym Feature worktree; run pozostający w `preparing` musi najpierw dokończyć Phase 2 Git preparation. Run lock obejmuje tylko krótkie claim/finalization mutations, nigdy czas pracy agenta.

## Worker contract

Worker invocation ma dokładnie trzy części:

1. logical skill invocation: role `worker`, configured skill `implement`, input = immutable Ticket input snapshot;
2. absolute snapshot reference jako skill input;
3. minimalny orchestration contract.

Orchestration contract zawiera tylko:

- run/ticket/worktree identity,
- result artifact path,
- scope i commit requirement,
- global workflow state jako read-only,
- blocker/failure protocol.

Worker może zapisywać kod w Feature worktree oraz własny prealokowany output directory. State snapshot, Operational history, Ticket input snapshot i Execution record pozostają Orchestrator-owned. Dla Codex agent launch używa Feature worktree jako `-C`, dokładnego output directory jako `--add-dir`, `workspace-write` i automatic approval review; Phase 4 nie wymaga `danger-full-access`.

Nie powtarza instrukcji dotyczących repo inspection, implementacji, testowania ani self-review — ich właścicielem jest `implement`.

Agent renderer zamienia logiczne `implement` na składnię agenta:

```text
skill = implement
Codex    → $implement "<absolute-snapshot-path>"
Claude   → /implement "<absolute-snapshot-path>"
Pi       → /implement "<absolute-snapshot-path>"
```

Phase 4 uruchamia live tylko Codex; renderery Claude/Pi są czystą, testowaną logiką tekstową. Nie hardcodować agent-specific syntax w state machine ani workflow semantics i nie pozwalać rendererowi budować shell commands.

## Repo config i setup

Phase 4 dodaje idempotentne `flow setup`. Tworzy brakujące `.orchestrator/config.yaml`, `.orchestrator/README.md` i ignore rule dla `.orchestrator/runs/`, lecz nie nadpisuje istniejących plików ani nie naprawia konfliktów automatycznie.

Minimalna konfiguracja:

```yaml
version: 1

agents:
  codex:
    kind: codex

roles:
  worker:
    agent: codex
    skill: implement

workflow:
  workerTimeoutSeconds: 1800
  maxWorkerAttempts: 2
```

Timeout musi należeć do zakresu 60–7200 sekund. V1 nie przyjmuje dowolnych agent process arguments z repo config.

## Attempt artifacts i lifecycle

Canonical ticket ID dla local Markdown adaptera jest nazwą pliku bez `.md`. Ticket musi być zwykłym plikiem wewnątrz Target repository. Każdy attempt kopiuje i hashuje jego treść:

```text
.orchestrator/runs/<run-id>/workers/<ticket-id>/attempt-01/
├── input/
│   └── ticket.md
├── execution.json
└── output/
    └── result.json
```

Tylko `output/` jest dodatkowym writable rootem workera. `execution.json` jest Orchestrator-owned i utrwala logical invocation, input hash, prompt hash, worktree/result references, attempt status, Herdr identity, lifecycle observations, cleanup, timings oraz maksymalnie ostatnie 32 KiB diagnostyki. Pełny prompt i transcript nie są utrwalane.

Attempt lifecycle:

```text
prepared → running → reconciling → accepted
                              ├── blocked
                              └── failed
```

Herdr state jest osobną obserwacją. State snapshot przechowuje tylko minimalną referencję do active/last execution; pełna ticket map należy do Phase 5. Operational history zapisuje semantic milestones `worker.attempt.prepared`, `started`, `accepted`, `blocked` i `failed`, nie każdy detal transportu.

## `result.json`

`result.json` jest wersjonowaną discriminated union z `status = completed | blocked | failed`. Wspólne pola to `schemaVersion`, `ticketId`, `status` i `summary`. `completed` wymaga canonical commit SHA oraz structured command results; `blocked` wymaga structured blocker i najmniejszej wymaganej decyzji; `failed` wymaga structured diagnostics. `filesChanged` i `notesForNextTask` są opcjonalne i nie są workflow truth.

Przykład `completed`:

```json
{
  "schemaVersion": 1,
  "ticketId": "01-add-worker-execution",
  "status": "completed",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "summary": "Implemented ticket",
  "commands": [{ "command": "pnpm test", "exitCode": 0 }],
  "filesChanged": []
}
```

Worker publikuje wynik przez temporary file + atomic rename. Orchestrator akceptuje tylko zwykły, niesymlinkowany plik zgodny ze schematem. Unknown object fields pozostają dozwolone dla forward compatibility.

## Retry i reconciliation

`workerTimeoutSeconds` uruchamia reconciliation, nie oznacza automatycznie failure. Maksymalnie dwa attempty są dozwolone. Automatyczny retry jest bezpieczny wyłącznie przed potwierdzonym prompt delivery i przy udowodnionym braku efektów ubocznych. Po delivery nowy attempt wymaga jawnego reconciliation/retry.

- valid `completed` + matching current HEAD + clean worktree może zostać zaakceptowany;
- `failed` albo missing result + brak nowego commita + clean worktree jest jednoznacznym failure i może dopuścić retry;
- invalid/missing/blocked result przy commicie lub dirty worktree blokuje run;
- mismatched HEAD, branch lub nieznane zmiany blokują run;
- explicit blocker, ambiguity oraz cleanup failure blokują run z `interruptedPhase = implementing`;
- exhausted conclusive technical failure kończy run jako `failed`.

Retry domyślnie używa poprzedniego Ticket input snapshot. Jawne `--refresh-ticket` tworzy nowy snapshot i zapisuje old/new input hashes w lineage.

## Checkpoint validation

Orchestrator przed akceptacją attemptu sprawdza bez mutacji:

- worktree istnieje,
- branch jest poprawny,
- co najmniej jeden nowy commit istnieje,
- `result.json` parsuje się,
- ticket ID jest poprawny,
- commit istnieje,
- zgłoszony commit jest canonical current HEAD i potomkiem poprzedniego checkpointu,
- cleanliness policy jest spełniona,
- Ticket input snapshot i Execution record zgadzają się ze State snapshot,
- Orchestrator-owned artifacts nie zostały zmienione,
- owned pane został bezpiecznie zamknięty.

Walidacja przebiega w kolejności: inspect bez mutacji → bounded diagnostic read → close owned pane → revalidate pod run lockiem → atomowo zaakceptuj Git checkpoint i Worker attempt. Herdr `blocked` bez poprawnego Worker result nie inicjuje automatycznej rozmowy: diagnostyka jest utrwalana, pane zamykany, a run blokowany do decyzji zapisanej w trwałym źródle.

Kluczowy invariant:

> `worker_done` is not `task_done`.

## Testy i exit gate

Primary seam to publiczny `scripts/flow` z fake `herdr` w `PATH`; niższe injected seams służą crash/timing cases. Testy obejmują interruption przed pane, przed delivery, podczas pracy, po commit/result, po cleanup oraz snapshot-first history gap. Human output ma odpowiednik `--json`; exit `6` oznacza blocked/reconciliation required, a `7` conclusive/exhausted execution failure.

Kolejność gate'u:

1. minimalny deterministic fake-worker happy path;
2. wczesny manual live Codex probe z globalnym `$implement`;
3. negative, retry, reconciliation i crash tests;
4. pełny quality/schema/build suite oraz command help checks;
5. końcowy manual live Codex gate w disposable repo.

Real-agent test jest opt-in i nie należy do `pnpm test`. Phase 4 nie obejmuje ticket scheduling, reviewer, deterministic project checks, fixer, automatic blocker answers ani live Claude/Pi.

---

# 10. Phase 5 — user-driven ticket steps

## Cel

Obsłużyć kilka przygotowanych ticketów w jednym Workflow runie bez budowania schedulera ani grafu zależności.

Wejściem jest lokalny Workflow package o stałym układzie:

```text
<feature>/
├── spec.md
└── issues/
    ├── 01-first.md
    └── 02-second.md
```

Pakiet jest walidowany przed startem runu i kopiowany do immutable run input. Orchestrator sprawdza wyłącznie format, który posiada: regularne, niepuste pliki, bezpieczne i jednoznaczne Ticket IDs oraz konfigurację. Nie interpretuje struktury Markdown należącej do downstream `implement`. Nazwa pliku bez `.md` jest canonical ticket ID, a kolejność wynika z sortowania nazw. GitHub, Linear lub lokalny tracker mogą przygotować taki pakiet przed uruchomieniem workflow, ale Phase 5 nie komunikuje się z trackerem i nie wykonuje write-backu.

## V1 execution

Jedno wywołanie użytkownika wykonuje najwyżej jeden jawnie wskazany ticket:

```text
$orchestrate <workflow-package> <ticket-id>
    ↓
create/resume run → validate next pending ticket
    ↓
fresh Worker → commit → accepted checkpoint
    ↓
return control to user
```

Wszystkie tickety jednego runu używają tej samej Feature branch i Feature worktree, lecz każdy ticket otrzymuje świeżego Workera. Orchestrator nie pozwala pominąć pending ticketu, nie powtarza accepted ticketu i zatrzymuje kolejkę po `blocked`, `failed` lub niejednoznacznym wyniku. Ponowne jawne wskazanie tego samego blocked ticketu może uruchomić fresh bounded retry dopiero po reconciliation potwierdzającej brak niezaakceptowanych efektów.

Pełny zakres, minimalne testy, live exit gate oraz świadomie odłożone usprawnienia opisuje uproszczony roadmap Phase 5+.

---

# 11. Phase 6 — deterministic project validation

## Cel

Po zakończeniu wszystkich implementation tickets użytkownik uruchamia jawnie
deterministyczną walidację końcowego Feature worktree. Etap nie uruchamia
agenta ani Herdr pane i nie wykonuje semantic review, HTTP, browser,
screenshots, security scanów ani automatycznej naprawy.

Target repository definiuje dokładnie pięć komend w
`.orchestrator/config.yaml`: `test`, `lint`, `typecheck`, `formatCheck` i
`build`, ze wspólnym timeoutem na komendę. `flow validate <workflow-package>` wykonuje je kolejno
w Feature worktree, zachowuje ograniczone diagnostyki i publikuje wynik tylko
dla niezmienionego, czystego, ostatniego accepted Git checkpoint.

Każdy niezerowy exit, błąd uruchomienia, timeout albo mutacja Git powoduje
`failed`; Orchestrator nie czyści ani nie resetuje zaobserwowanych zmian.
Jawne ponowienie po korekcie zastępuje poprzednią kompletną decyzję dla tego
samego HEAD. Szczegółowy kontrakt i exit gate opisuje roadmap Phase 5+.

Semantic review, HTTP i browser validation, screenshots, security-specific
scanners oraz automatyczny Fixer pozostają możliwymi przyszłymi rozszerzeniami,
a nie częścią Phase 6.

---

# 12. Phase 7 — deterministic checks

## Cel

Nie ufać agent self-report w kwestiach, które można sprawdzić programowo.

Target repo definiuje checks w:

```text
.orchestrator/config.yaml
```

Przykład:

```yaml
version: 1

checks:
  - id: typecheck
    command: pnpm typecheck
    required: true

  - id: test
    command: pnpm test
    required: true
    timeoutSeconds: 900

  - id: build
    command: pnpm build
    required: true
```

## Runner powinien zapisywać

- command,
- status,
- exit code,
- duration,
- stdout/stderr,
- log path,
- artifacts.

---

# 13. Phase 8 — Fixer

## Cel

Automatycznie naprawiać jasno zdefiniowane failures bez tworzenia otwartego autonomous loop.

## Input

Fix brief powinien zawierać:

- original spec,
- current branch,
- review findings,
- failed checks,
- passed checks,
- artifact paths,
- explicit scope.

## Flow

```text
review/check failure
      ↓
fix brief
      ↓
fresh fixer
      ↓
commit
      ↓
checkpoint validation
      ↓
re-review / re-check
```

## Retry limits

Np.:

```yaml
workflow:
  maxWorkerAttempts: 2
  maxFixAttempts: 2
```

Po wyczerpaniu limitu:

```text
run → blocked
```

---

# 14. Phase 9 — browser verification

Dodać dopiero po stabilizacji podstawowego loopa.

## Możliwy zakres

Playwright runner:

- start/connect app,
- wait for ready,
- visit routes,
- perform critical flows,
- inspect console errors,
- assert UI state,
- create screenshots,
- optional visual snapshots,
- write machine-readable result.

Browser automation jest deterministic checkiem.

Opcjonalny visual/UX agent review powinien być osobnym stage'em.

---

# 15. Phase 10 — recovery

Recovery jest częścią MVP, nie dodatkiem.

## Test

Zabijać głównego Orchestratora podczas:

- implementing,
- after worker finished,
- reviewing,
- checking,
- fixing.

Po restarcie świeży Orchestrator powinien na podstawie:

- `state.json`,
- `history.jsonl`,
- Git,
- execution records,
- Herdr state,

ustalić, co bezpiecznie zrobić dalej.

## Recovery rule

Jeżeli system nie potrafi jednoznacznie potwierdzić stanu:

```text
block instead of guess
```

---

# 16. Repo-local `.orchestrator/`

Każdy target project ma własny kontrakt orchestration.

Przykład:

```text
project/
└── .orchestrator/
    ├── config.yaml
    ├── README.md
    ├── prompts/
    ├── scripts/
    └── runs/
```

## Committed

```text
.orchestrator/config.yaml
.orchestrator/README.md
.orchestrator/scripts/*
.orchestrator/prompts/*
```

## Gitignored

```text
.orchestrator/runs/
```

Runtime state powinien być lokalny dla repo, ale domyślnie nie powinien trafiać do feature commits.

---

# 17. Installed global skill

Development repo:

```text
~/workspace/coding-orchestrator/
```

Installed package:

```text
~/.agents/skills/orchestrate/
```

Przykład installed package:

```text
~/.agents/skills/orchestrate/
├── SKILL.md
├── references/
├── scripts/
├── assets/
│   └── prompts/
├── schemas/
└── dist/
```

Development-only files nie powinny być kopiowane:

- `src/`,
- `tests/`,
- fixtures,
- `.git`,
- `node_modules`.

## Development loop

```text
edit
 ↓
test
 ↓
build
 ↓
install-skill.sh
 ↓
fresh Codex session
 ↓
smoke test inside Herdr
```

---

# 18. Test strategy

Orchestrator tooling wymaga mocnych testów, ponieważ agenci będą polegać na jego invariants.

## Unit tests

- state transitions,
- ticket readiness,
- retry policy,
- config parsing,
- schema validation,
- logical role/skill invocation construction,
- Codex rendering: `implement` → `$implement`, `code-review` → `$code-review`,
- worker/reviewer wrapper prompt construction,
- event serialization.

## Integration tests

### Temporary Git repo

- worktree creation,
- commits,
- dirty state,
- checkpoint validation,
- cleanup refusal.

### Fake Herdr

- launch success,
- blocked,
- done,
- unknown,
- process vanished,
- malformed output.

Testy Herdr pozostają nieświadome skill semantics i sprawdzają, że wyrenderowany prompt jest transportowany bez zmian.

Prompt tests sprawdzają, że worker wrapper zawiera `$implement`, assigned ticket, result path, blocker protocol i commit requirement, a reviewer wrapper zawiera `$code-review`, fixed `BASE_SHA`/`HEAD_SHA`, ticket/spec, artifact paths i no-code-modification contract. Oba templates nie mogą duplikować downstream engineering methodology.

### Fake worker artifacts

- correct result,
- missing commit,
- wrong ticket ID,
- invalid JSON,
- stale commit,
- blocker.

## End-to-end fixture

Najpierw nie używać realnego LLM-a.

Fake worker:

```text
read prompt
edit file
commit
write result.json
exit
```

Dopiero po przejściu E2E uruchomić realny smoke test z Codex/Claude/Pi wewnątrz Herdr.

---

# 19. Najważniejsze invariants

1. Herdr zarządza terminal/process mechanics, nie workflow semantics.
2. Orchestrator zarządza workflow routing i global state transitions.
3. Git/worktree jest durable; agent conversation jest disposable.
4. Istniejące tickets są task graph.
5. Nie tworzyć drugiego wewnętrznego task modelu.
6. Ready/blocked wyliczać z ticket dependencies + execution state.
7. Preferować świeży agent context per ticket.
8. Sequential tickets tego samego feature'a używają jednego worktree.
9. Worker nie modyfikuje global workflow state.
10. Worker finished nie oznacza ticket done.
11. Ticket completion wymaga Git checkpoint validation.
12. Semantic review i deterministic verification są osobnymi etapami.
13. Reviewer powinien być świeżym agentem.
14. Fix loop musi być bounded.
15. Tylko Orchestrator może oznaczyć cały run jako completed.
16. Completion wymaga finalnego HEAD z passing review/check policy.
17. Destructive cleanup działa fail-closed.
18. Existing specs/ADRs/tickets są authoritative.
19. Orchestrator komponuje się z istniejącymi engineering skills zamiast je zastępować.
20. Global skill i target repo są osobnymi rootami.
21. Runtime state jest repo-local pod `.orchestrator/runs/`.
22. Skills definiują engineering methodology; Orchestrator dodaje tylko workflow semantics i execution contract.
23. Worker i reviewer prompts są skill-aware wrappers, nie samodzielnymi metodologiami.
24. Agent-specific skill invocation syntax należy do agent renderer, nie do workflow semantics.
25. Herdr transportuje już wyrenderowany prompt jako opaque payload.
26. Rola, agent profile i downstream skill są odrębnymi pojęciami.
27. Fixer nie używa automatycznie `implement`; pozostaje bounded contract, chyba że jawnie skonfigurowano dedykowany skill.

---

# 20. Czego nie budować w V1

Nie zaczynać od:

- parallel swarm scheduling,
- Web UI,
- cloud execution,
- autonomous model routing,
- vector memory,
- dużej conversation-history database,
- watcher daemon,
- XState visualization,
- PR automation,
- remote hosts,
- nowego issue trackera,
- własnego multi-agent frameworka,
- zastępowania Herdr,
- zastępowania istniejących coding skills.

Parallelism rozważyć dopiero po udowodnieniu niezawodnego sequential workflow.

---

# 21. Pierwszy realny milestone

Najważniejszy pierwszy vertical slice:

```text
approved ticket
      ↓
durable run
      ↓
isolated feature worktree
      ↓
RoleExecution(worker) → Codex `$implement` wrapper → Herdr
      ↓
commit
      ↓
structured result.json
      ↓
independent checkpoint validation
      ↓
Orchestrator restart
      ↓
correct resume
```

Jeżeli ten scenariusz działa niezawodnie, rdzeń architektury jest potwierdzony.

---

# 22. Sugerowana kolejność prac

```text
Phase 0   Project bootstrap
Phase 1   Durable state
Phase 2   Git/worktree
Phase 3   Herdr adapter
Phase 4   Skill-aware worker vertical slice
Phase 5   User-driven ticket steps
Phase 6   Skill-aware independent reviewer
Phase 7   Deterministic checks
Phase 8   Fixer
Phase 9   Browser verification
Phase 10  Recovery hardening
```

Po Phase 4 powinien istnieć pierwszy rzeczywiście działający fragment systemu.

Po Phase 8 powinien działać pełny core delivery loop.

Po Phase 10 można zacząć projektować parallel execution.
