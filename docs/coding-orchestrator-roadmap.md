# Coding Workflow Orchestrator — Roadmap

## Cel projektu

Zbudować lokalny, trwały orchestrator workflow dla developmentu opartego na:

- **Herdr** jako warstwie terminal/process orchestration,
- **świeżych agentach codingowych** uruchamianych per task,
- **Git + worktrees** jako trwałym stanie kodu,
- **repo-local runtime state** w `.orchestrator/`,
- **structured artifacts** jako protokole między agentami a Orchestratorem,
- **niezależnym reviewerze**,
- **deterministycznych checkach**,
- **bounded fixer loop**,
- **restart/resume** bez utraty workflow.

Kluczowa zasada:

> Agents are ephemeral. The workflow is durable.

Herdr nie jest workflow engine. Herdr zarządza procesami, pane'ami, cwd i agent lifecycle.  
Workflow semantics, transitions i decyzja „co dalej” należą do Orchestratora.

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
- Pi jako reviewer,
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
- wybór następnego ready ticketu,
- uruchamianie workerów,
- walidację rezultatów,
- przejścia state machine,
- reviewer/fixer routing,
- retry policy,
- recovery,
- completion decision.

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
│   │   ├── scheduler.ts
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

Zbudować minimalną warstwę potrzebną do sterowania agentami.

## V1 primitives

```text
create/start agent
prompt agent
wait
read output
close
```

Preferować wysokopoziomowe Herdr agent API tam, gdzie jest niezawodne.

Raw pane operations traktować jako fallback.

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

---

# 9. Phase 4 — pierwszy Worker vertical slice

To powinien być pierwszy realny proof-of-concept.

## Flow

```text
flow run create
      ↓
state.json
      ↓
create worktree
      ↓
Herdr
      ↓
Codex Worker
      ↓
commit
      ↓
result.json
      ↓
checkpoint validation
      ↓
ticket done
```

## Worker contract

Worker powinien dostać:

- jeden bounded ticket,
- spec reference,
- `CONTEXT.md`,
- relevant ADRs,
- branch/worktree context,
- output path dla `result.json`.

Worker:

1. implementuje tylko ticket,
2. nie modyfikuje global workflow state,
3. uruchamia focused checks,
4. commituje,
5. zapisuje structured result,
6. kończy sesję.

## `result.json`

Minimalnie:

```json
{
  "schemaVersion": 1,
  "ticketId": "T01",
  "status": "completed",
  "commit": "abc123",
  "summary": "Implemented ticket",
  "commands": [],
  "filesChanged": []
}
```

## Checkpoint validation

Orchestrator przed oznaczeniem ticketu jako done sprawdza:

- worktree istnieje,
- branch jest poprawny,
- nowy commit istnieje,
- `result.json` parsuje się,
- ticket ID jest poprawny,
- commit istnieje,
- commit jest reachable z HEAD,
- cleanliness policy jest spełniona.

Kluczowy invariant:

> `worker_done` is not `task_done`.

---

# 10. Phase 5 — ticket graph execution

## Cel

Obsłużyć więcej niż jeden ticket.

Orchestrator nie tworzy własnego drugiego task graph.

Źródłem prawdy są istniejące tickety.

## Ticket adapter

Minimalny interfejs:

```text
list tickets
read ticket
read blockers
read ticket id/title
```

Na początku można obsłużyć lokalne markdown tickety.

Później:

- GitHub issues,
- Linear,
- inne trackery.

## Ready calculation

```text
if ticket is recorded done:
    done
else if all blockers are done:
    ready
else:
    blocked
```

## V1 execution

Sekwencyjnie:

```text
T01 → fresh worker → commit
T02 → fresh worker → commit
T03 → fresh worker → commit
```

Wszystkie w tym samym feature worktree.

---

# 11. Phase 6 — Reviewer

## Cel

Oddzielić authoring od semantic review.

Po zakończeniu implementation tickets uruchomić świeżego reviewera.

Reviewer dostaje:

- fixed `BASE_SHA`,
- current `HEAD`,
- spec,
- relevant ADRs,
- coding standards.

Reviewer nie powinien naprawiać kodu.

## Output

Przykładowe:

```text
.orchestrator/runs/<run-id>/review/attempt-01.md
.orchestrator/runs/<run-id>/review/attempt-01.json
```

JSON powinien zawierać co najmniej:

- pass/fail,
- severity,
- findings,
- references.

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
- prompt construction,
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
fresh Codex worker via Herdr
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
Phase 4   Single-worker vertical slice
Phase 5   Ticket graph execution
Phase 6   Reviewer
Phase 7   Deterministic checks
Phase 8   Fixer
Phase 9   Browser verification
Phase 10  Recovery hardening
```

Po Phase 4 powinien istnieć pierwszy rzeczywiście działający fragment systemu.

Po Phase 8 powinien działać pełny core delivery loop.

Po Phase 10 można zacząć projektować parallel execution.
