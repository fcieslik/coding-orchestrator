# Reverse engineering `browser-use/jev-ultrafast`
## Analiza jako specyfikacja dla browser verification tool dla Codex CLI

**Źródło:** `browser-use/jev-ultrafast`  
**Cel dokumentu:** wykorzystać architekturę Jev jako bazę do zbudowania lokalnego narzędzia, które może być wywoływane przez coding agenta (np. Codex CLI) do weryfikacji wdrożeń przez prawdziwą przeglądarkę.

> Dokument opisuje architekturę Jev i proponuje jej adaptację. Nie zakłada kopiowania repo 1:1.

---

## 1. Executive summary

Jev Ultrafast to mały browser agent oparty o **dynamiczny, indeksowany action space**.

Najważniejsza idea:

```text
URL + natural-language goal
        ↓
browser observation
        ↓
visible DOM / controls
        ↓
indexed action space
        ↓
model wybiera:
  operation + compatible target
        ↓
browser executor
        ↓
nowa observation
        ↓
...
        ↓
DONE
```

Model nie generuje:

- CSS selectorów,
- XPath,
- współrzędnych,
- JavaScriptu,
- poleceń shell,
- kodu wykonywalnego.

Zamiast tego wybiera operację i element z aktualnie zaobserwowanego DOM. Executor ponownie sprawdza świeżość strony i poprawność targetu przed wykonaniem mutacji.

To jest szczególnie interesujące dla Codex CLI, ponieważ browser może zostać potraktowany jako **jedno z narzędzi agenta**, obok terminala, AWS CLI, testów itd.

Przykładowy flow:

```text
Codex CLI
   │
   ├── deploy
   │
   ├── run API / infra checks
   │
   └── browser_verify
           │
           ↓
       local Chrome
           │
           ↓
      PASS / FAIL
           │
           ↓
        Codex
```

Repozytorium ma bardzo mały core: `agent.py`, `browser.py`, `snapshot.js`, `model.py`, `questions.py`; `demo.py` jest lokalnym inspectorem/UI. README wskazuje te pliki jako główne elementy implementacji. citeturn0search0turn0search1

---

# 2. Co dokładnie robi Jev

Jev nie jest klasycznym Playwrightowym skryptem:

```python
page.click("#login")
page.fill("#email", "...")
```

Nie jest też klasycznym vision agentem:

```text
screenshot
   ↓
vision LLM
   ↓
x=412,y=291
```

Zamiast tego:

```text
Browser
   ↓
snapshot.js
   ↓
structured state
   ↓
indexed controls

[1] textbox  Email
[2] textbox  Password
[3] button   Login
[4] link     Forgot password
```

Model podejmuje decyzję w postaci:

```text
operation = CLICK
target = 3
```

albo:

```text
operation = TYPE_TEXT
target = 1
```

Dopiero executor mapuje `target=3` na rzeczywisty obserwowany node DOM.

To rozdzielenie model → abstrakcyjna akcja → browser jest jednym z najważniejszych elementów architektury.

---

# 3. Dlaczego dynamic action space jest ważny

W klasycznym browser agencie model może generować:

```text
page.locator(...)
```

albo selector:

```text
#login-button
```

To powoduje problem: model produkuje instrukcję, która później staje się wykonywalnym kodem.

W Jev:

```text
MODEL
  ↓
operation + target id
  ↓
VALIDATE
  ↓
OBSERVED DOM NODE
  ↓
EXECUTE
```

Model nie może bezpośrednio wskazać:

```text
document.querySelector(...)
```

ani:

```text
page.mouse.click(...)
```

README i `AGENTS.md` explicite podkreślają, że target musi pochodzić z obserwowanych elementów, a model output nie staje się selektorem, współrzędną ani wykonywalnym JavaScriptem. citeturn0search1turn0search5

---

# 4. Mapa repozytorium

Najważniejsze pliki:

```text
jev-ultrafast/
│
├── jev_ultrafast/
│   ├── agent.py
│   ├── browser.py
│   ├── model.py
│   ├── questions.py
│   ├── snapshot.js
│   └── demo.py
│
├── examples/
├── tests/
├── scripts/
├── docs/
├── pyproject.toml
├── uv.lock
├── .env.example
└── AGENTS.md
```

## Odpowiedzialności

| Plik | Odpowiedzialność |
|---|---|
| `agent.py` | główna pętla agenta |
| `browser.py` | połączenie z Chrome/CDP i wykonanie akcji |
| `snapshot.js` | odczyt DOM i budowanie action space |
| `model.py` | wybór operation/target + generowanie tekstu |
| `questions.py` | instrukcje/prompt dla modelu |
| `demo.py` | lokalny inspector |
| `examples/` | przykłady użycia |
| `tests/` | testy |
| `scripts/` | benchmarki, recording, guard checks |
| `docs/` | dodatkowa dokumentacja |

---

# 5. `agent.py` — orchestrator

`agent.py` jest centrum całego systemu.

Publiczne API wygląda mniej więcej tak:

```python
with Agent(url, goal) as agent:
    for state in agent.run():
        ...
```

Agent przechowuje m.in.:

```text
browser
goal
page
decision
history
status
plan
decisions
text_calls
elapsed_ms
```

Na starcie:

```text
Agent(...)
   ↓
Browser(url)
   ↓
observe()
   ↓
initial page state
```

Następnie działa pętla:

```text
observe
   ↓
predict
   ↓
validate
   ↓
execute
   ↓
observe
   ↓
predict
   ↓
...
```

W kodzie `agent.py` komenda `tick` wykonuje logicznie:

```text
predict
→ act
```

a przy `StalePage` odświeża observation i wymusza ponowną decyzję. citeturn0search3

### Istotna zasada

Jeśli strona zmieniła się między decyzją modelu a wykonaniem:

```text
old observation
      ↓
model decision
      ↓
page changed
      ↓
StalePage
      ↓
new observation
      ↓
new model decision
```

Nie należy ślepo wykonywać starej decyzji.

---

# 6. `snapshot.js` — najważniejsza część browser abstraction

`snapshot.js` odpowiada za zamianę aktualnego DOM na **mały, strukturalny stan**, który może zostać przekazany modelowi.

W uproszczeniu:

```text
DOM
 ↓
widoczne elementy
 ↓
kontrolki
 ↓
label / role / value / text
 ↓
indexed action list
```

Przykład konceptualny:

```json
{
  "actions": [
    {
      "id": 1,
      "kind": "fill",
      "label": "Email",
      "value": ""
    },
    {
      "id": 2,
      "kind": "fill",
      "label": "Password",
      "value": ""
    },
    {
      "id": 3,
      "kind": "click",
      "label": "Login"
    }
  ]
}
```

`snapshot.js` tworzy również mechanizm **freshness guard**.

To ważne, ponieważ:

```text
action #3
```

ma znaczenie tylko w kontekście konkretnej obserwacji strony.

Po zmianie DOM:

```text
action #3 != action #3
```

w sensie semantycznym.

Dlatego observation posiada fingerprint/marker pozwalający wykryć zmianę strony.

---

# 7. `browser.py` — executor

`browser.py` jest warstwą wykonawczą.

Repo korzysta z:

```python
browser_harness
```

oraz CDP.

README mówi o jednej sesji CDP i o Browser Harness jako warstwie połączenia z Chrome. citeturn0search2

Schemat:

```text
Python
  ↓
Browser Harness
  ↓
CDP
  ↓
Chrome
  ↓
real webpage
```

`browser.py` odpowiada m.in. za:

- połączenie z przeglądarką,
- otwarcie URL,
- observation,
- freshness checks,
- aktualną geometrię elementów,
- wykonanie click/fill/select,
- sprawdzanie czy element nie jest zasłonięty,
- oczekiwanie na użyteczną zmianę stanu.

Bardzo istotne:

> Browser executor nie ufa bezpośrednio decyzji modelu.

Przed wykonaniem akcji ponownie sprawdza aktualny stan.

README opisuje m.in. ponowne sprawdzanie document/form values/target/nearby context oraz geometrii i occlusion dla kliknięć. citeturn0search1turn0search2

---

# 8. CDP — dlaczego jest używany

CDP = Chrome DevTools Protocol.

W tym projekcie służy jako niskopoziomowy kanał:

```text
Python
   ↓
CDP
   ↓
Chrome
```

Dzięki temu można:

- obserwować stronę,
- wykonywać operacje,
- pobierać informacje o DOM,
- kontrolować kartę,
- pobierać screenshoty,
- korzystać z geometrii elementów.

Nie trzeba budować własnego browsera.

Dla naszego narzędzia najlepsza architektura również powinna używać istniejącego Chrome + CDP/Browser Harness zamiast implementować własną warstwę przeglądarki.

---

# 9. `model.py` — decision engine

`model.py` zawiera dwie różne odpowiedzialności.

## A. Decision model

Model dostaje:

```text
goal
+
current page
+
available actions
+
history
```

i wybiera:

```text
operation
+
compatible target
```

Ważny szczegół architektury:

```text
CLICK
  → tylko targety klikowalne

TYPE_TEXT
  → tylko pola tekstowe

SELECT
  → tylko odpowiednie kontrolki
```

Czyli nie:

```text
model → target 17
```

dla dowolnego targetu.

Tylko:

```text
model
  ├── operation probabilities
  └── target probabilities
        ↓
  compatible target head
```

README określa to jako dynamic, indexed action space i operation-specific target heads. citeturn0search0

---

# 10. `TYPE_TEXT` jest specjalnym przypadkiem

Jev nie wymaga od głównego modelu generowania tekstu.

Działa:

```text
decision model
      ↓
TYPE_TEXT [3]
      ↓
field_context(...)
      ↓
text model
      ↓
JSON
      ↓
validate
      ↓
browser.fill(...)
```

Czyli mamy dwa logiczne modele:

```text
               ┌──────────────┐
               │ decision LLM │
               └──────┬───────┘
                      │
               action = TYPE_TEXT
                      │
                      ↓
               ┌──────────────┐
               │  text model  │
               └──────┬───────┘
                      │
                      ↓
                  "hello"
```

README mówi wprost: mały LLM generuje tekst tylko wtedy, gdy operacja to `TYPE_TEXT`. citeturn0search0

---

# 11. `questions.py` — kontrakt z modelem

Ten moduł zawiera instrukcje dla modelu.

To nie powinien być klasyczny agent prompt typu:

```text
You are an autonomous browser agent...
```

Najważniejsze jest ograniczenie modelu do małego kontraktu:

```text
wybierz operation
wybierz compatible target
```

Model nie powinien mieć możliwości wygenerowania:

```text
selector
xpath
javascript
shell
cdp command
```

To jest bardzo ważne przy projektowaniu naszego narzędzia.

---

# 12. `demo.py`

`demo.py` nie jest potrzebny do core engine.

To lokalny inspector:

```text
Python agent
      ↓
HTTP server 127.0.0.1:8766
      ↓
browser UI
```

Inspector pokazuje:

- elementy,
- decyzje,
- prawdopodobieństwa,
- wykonane akcje,
- stan agenta.

Można go pominąć w pierwszej wersji Codex toola. citeturn0search10

---

# 13. Screenshoty

Jedna z ważniejszych decyzji architektonicznych:

**screenshot nie jest podstawowym inputem modelu.**

Domyślny loop:

```text
DOM → structured state → model
```

Screenshot jest opcjonalny:

```text
DOM → model
       \
        → screenshot → evidence / inspector
```

README wyraźnie zaznacza, że default agent loop nie używa screenshotów, a inspector może je włączać. citeturn0search1

Dla deployment verification jest to bardzo korzystne.

Możemy używać screenshotów jako **evidence**, a nie jako głównego mechanizmu nawigacji.

---

# 14. Outcome verification — bardzo ważna lekcja

Jev ma ważną zasadę:

```text
DONE
```

nie oznacza automatycznie:

```text
SUCCESS
```

README explicite mówi, że wybór `DONE` wymaga niezależnej weryfikacji rezultatu. citeturn0search0

Dla naszego narzędzia należy to rozwinąć.

Nie:

```text
Agent says DONE
      ↓
PASS
```

Tylko:

```text
Agent says DONE
      ↓
Verifier
      ↓
assertions
      ↓
PASS / FAIL
```

---

# 15. Docelowa architektura dla Codex CLI

Proponowana architektura:

```text
┌──────────────────────────────────────────────┐
│                  CODEX CLI                   │
│                                              │
│  deploy / inspect / fix / test               │
│                                              │
│              browser_verify()                │
└──────────────────────┬───────────────────────┘
                       │
                       ↓
┌──────────────────────────────────────────────┐
│             Browser Verifier Tool            │
│                                              │
│  1. create browser session                  │
│  2. navigate                                │
│  3. observe                                 │
│  4. build action space                      │
│  5. model decision                          │
│  6. validate target                         │
│  7. execute                                 │
│  8. observe                                 │
│  9. collect evidence                        │
│ 10. verify outcome                          │
└──────────────────────┬───────────────────────┘
                       │
                       ↓
                ┌─────────────┐
                │ Chrome/CDP  │
                └─────────────┘
```

---

# 16. Tool API dla Codex

Rekomendowany publiczny interfejs:

```json
{
  "url": "https://staging.example.com",
  "goal": "Verify that the user can log in and send a chat message.",
  "checks": [
    "page loads",
    "login succeeds",
    "chat page opens",
    "message can be sent",
    "response is visible"
  ]
}
```

Output:

```json
{
  "status": "passed",
  "checks": [
    {
      "name": "page loads",
      "status": "passed"
    },
    {
      "name": "login succeeds",
      "status": "passed"
    },
    {
      "name": "chat page opens",
      "status": "passed"
    },
    {
      "name": "message can be sent",
      "status": "passed"
    },
    {
      "name": "response is visible",
      "status": "passed"
    }
  ],
  "evidence": [
    "artifacts/001.png",
    "artifacts/002.png"
  ],
  "trace": "artifacts/trace.json"
}
```

Najważniejsze: Codex dostaje **ustrukturyzowany wynik**, a nie tylko tekst typu `it seems to work`.

---

# 17. Proponowany flow deployment verification

Dla Twojego przypadku:

```text
Codex
 │
 ├── git diff
 │
 ├── build
 │
 ├── deploy
 │
 ├── wait for deployment
 │
 ├── HTTP/API smoke checks
 │
 └── browser_verify
          │
          ↓
       Chrome
          │
          ├── open app
          ├── login
          ├── navigate
          ├── interact
          ├── wait
          └── observe
          │
          ↓
      assertions
          │
     ┌────┴────┐
     ↓         ↓
   PASS       FAIL
     │         │
     ↓         ↓
  finish     Codex
              │
              ↓
             fix
              │
              ↓
            deploy
```

To pozwala zbudować pętlę:

```text
deploy → verify → fix → deploy → verify
```

---

# 18. Deterministic checks + Jev

Nie należy zastępować wszystkiego AI.

Najlepszy podział:

## Deterministic

```text
HTTP 200
API response
health endpoint
expected URL
DOM exact text
known element exists
AWS deployment status
```

## Jev

```text
"find login"
"open chat"
"fill form"
"find the send button"
"navigate through UI"
```

## Evidence

```text
screenshot
DOM snapshot
URL
console errors
network errors
trace
```

Architektura:

```text
                 deployment
                     │
          ┌──────────┴──────────┐
          ↓                     ↓
   deterministic checks       Jev
          │                     │
          └──────────┬──────────┘
                     ↓
               final verifier
                     ↓
                 PASS/FAIL
```

---

# 19. Retry semantics

To jest bardzo ważne.

### Browser mutation

Nie retryować bezmyślnie:

```text
CLICK
TYPE
SUBMIT
```

Jeśli nie wiadomo, czy akcja została wykonana, automatyczny retry może wykonać ją drugi raz.

AGENTS.md Jev explicite zaleca:

> Never retry a browser mutation.

Najpierw:

```text
log execution
     ↓
observe
     ↓
decide whether action actually happened
```

Dopiero wtedy kolejna akcja. citeturn0search5

---

# 20. Stale page handling

Obowiązkowy mechanizm:

```text
snapshot A
   ↓
model
   ↓
action
   ↓
page changed
```

Executor:

```text
fresh(snapshot A)?
      │
   no ─┴─→ StalePage
              ↓
         observe B
              ↓
          new decision
```

Nigdy:

```text
stale snapshot
   ↓
execute anyway
```

---

# 21. Text generation retry

Jev ma interesujący mechanizm `pending_text`.

Przykład:

```text
model says:
TYPE_TEXT Email
```

Text helper generuje:

```text
user@example.com
```

Ale zanim browser wykona akcję:

```text
page changed
```

Nie trzeba generować tekstu drugi raz, jeśli **cały input text-helpera jest identyczny**.

Można zachować:

```text
pending_text
```

i użyć go po ponownym snapshot.

To zmniejsza liczbę requestów i koszt.

---

# 22. Waiting strategy

Jev nie używa prostego:

```python
sleep(1)
```

Po akcjach czeka tylko tyle, ile potrzeba.

Przykładowo:

```text
TYPE into combobox
      ↓
wait for suggestions
      ↓
max ~200ms
```

Inne akcje:

```text
animation frames / ~50ms
```

To jest istotne dla szybkiego verifiera.

W naszym narzędziu należy zrobić:

```text
action-specific postcondition wait
```

np.:

```text
click Login
   ↓
wait until URL changes OR login UI appears
```

zamiast:

```text
sleep(3)
```

---

# 23. Evidence model

Dla Codex toola warto rozszerzyć Jev o formalny evidence store:

```text
artifacts/
├── trace.json
├── screenshots/
│   ├── 001-before.png
│   ├── 002-login.png
│   └── 003-chat.png
├── snapshots/
│   ├── 001.json
│   └── 002.json
└── result.json
```

`result.json`:

```json
{
  "status": "failed",
  "failed_check": "response visible",
  "reason": "No assistant response appeared within timeout",
  "url": "https://staging.example.com/chat",
  "screenshot": "screenshots/003-chat.png"
}
```

To jest bardzo ważne dla coding agenta, bo agent może następnie użyć evidence do diagnozy.

---

# 24. Credentials

Nie przekazywać credentials do modelu jako zwykłego promptu.

Zamiast:

```text
goal:
login with filip@example.com
password: MySecret123
```

lepiej:

```text
browser verifier
    ↓
credential provider
    ↓
environment / OS secret store
    ↓
browser
```

Model powinien wiedzieć:

```text
"login using configured test account"
```

ale nie powinien otrzymywać sekretu, jeśli nie jest to konieczne.

Jev również wymaga trzymania credentials po stronie środowiska i `.env` poza repozytorium. citeturn0search5

---

# 25. Browser lifecycle

Proponowany lifecycle:

```text
browser_verify()
       │
       ↓
connect/start Chrome
       │
       ↓
create isolated verification context
       │
       ↓
navigate(url)
       │
       ↓
observe
       │
       ↓
agent loop
       │
       ↓
independent verification
       │
       ↓
collect evidence
       │
       ↓
close/release browser
```

Dla deployment verification preferowany jest **osobny profil/test context**, żeby stan użytkownika z poprzedniej sesji nie wpływał na test.

Jev w obecnym MVP korzysta z istniejącego Chrome profile i owned tabs, co należy potraktować jako ograniczenie, a nie docelową izolację dla naszego narzędzia. citeturn0search1

---

# 26. Biblioteki / technologie

Minimalny stack wynikający z Jev:

```text
Python
uv
Browser Harness
Chrome
CDP
Node.js
JavaScript snapshot
LLM API
```

Jev używa:

```text
browser_harness
```

do komunikacji z przeglądarką oraz Pythona jako głównego runtime'u. `uv sync` instaluje zależności, a README opisuje Browser Harness jako komponent wymagany do połączenia z Chrome. citeturn0search0turn0search2

### Rekomendowany stack naszego narzędzia

```text
Python
├── browser-harness
├── CDP
├── pydantic
├── httpx
└── LLM client

Node.js
└── snapshot.js
```

Nie ma potrzeby używania Playwrighta, jeśli chcemy zachować architekturę Jev.

Alternatywnie Playwright może zostać użyty jako executor, ale wtedy przestajemy być bliską implementacją Jev.

---

# 27. Co kopiować z Jev

## Zachować

```text
✓ indexed action space
✓ operation-specific targets
✓ DOM-based observation
✓ freshness fingerprint
✓ stale-page detection
✓ target validation
✓ click occlusion check
✓ separate text model
✓ structured model output
✓ bounded action loop
✓ action history
✓ evidence recording
✓ independent outcome verification
```

## Nie kopiować bez zmian

```text
✗ demo inspector jako wymagany komponent
✗ benchmark-specific examples
✗ Google Flights assumptions
✗ current model provider assumptions
✗ fixed demo step limit
✗ existing Chrome profile as final architecture
```

---

# 28. Ograniczenia Jev, które muszą wejść do projektu

README wskazuje, że obecny MVP nie obsługuje w pełni:

- shadow DOM,
- frames,
- canvas,
- uploads,
- popup tabs,
- nested scrolling,
- arbitralnych keyboard widgets.

DOM reader obsługuje typowe HTML/ARIA controls, ale nie pełną specyfikację accessible-name. citeturn0search0turn0search1

Dlatego verifier powinien mieć możliwość:

```text
Jev failed
   ↓
fallback
   ↓
Playwright/CDP deterministic action
```

ale **tylko jako świadomie kontrolowany fallback**, a nie jako sposób na obchodzenie action-space security.

---

# 29. Bezpieczeństwo

Najważniejsza granica:

```text
MODEL
  ↓
typed action
  ↓
VALIDATOR
  ↓
BROWSER
```

a nie:

```text
MODEL
  ↓
arbitrary JavaScript
  ↓
BROWSER
```

Model nie powinien mieć bezpośredniej możliwości:

```javascript
fetch(...)
document.cookie
localStorage.clear()
window.location = ...
```

ani:

```bash
aws ...
rm ...
curl ...
```

Browser tool powinien wykonywać tylko wcześniej zdefiniowane operacje.

---

# 30. Proponowany podział modułów naszego narzędzia

```text
browser_verifier/
│
├── agent.py
│   └── agent loop
│
├── browser.py
│   └── Chrome/CDP
│
├── snapshot.py / snapshot.js
│   └── DOM → indexed actions
│
├── model.py
│   └── operation + target
│
├── text.py
│   └── TYPE_TEXT generation
│
├── verifier.py
│   └── independent assertions
│
├── evidence.py
│   └── screenshots / snapshots / trace
│
├── credentials.py
│   └── test credentials
│
├── result.py
│   └── structured PASS/FAIL
│
└── cli.py
    └── Codex-facing CLI
```

---

# 31. CLI

Najprostszy interfejs:

```bash
browser-verify \
  --url https://staging.example.com \
  --goal "Verify login and chat flow" \
  --checks checks.json \
  --artifacts ./artifacts
```

Exit codes:

```text
0 = PASS
1 = verification FAIL
2 = tool/configuration error
3 = browser unavailable
```

To jest bardzo ważne dla Codex.

Agent może zrobić:

```bash
browser-verify ...
if [ $? -ne 0 ]; then
    ...
fi
```

---

# 32. Codex tool vs CLI

Docelowo można mieć dwa interfejsy:

```text
                    browser-verifier
                         │
             ┌───────────┴───────────┐
             ↓                       ↓
          CLI                       MCP
             │                       │
          Codex CLI              other agents
```

Na początku zrobiłbym **CLI**, ponieważ jest najprostszy do integracji i debugowania.

Później można wystawić:

```text
browser_verify
```

jako MCP tool.

---

# 33. Przykładowy kontrakt dla Codex

Input:

```json
{
  "url": "https://staging.example.com",
  "goal": "Verify the production-like chat flow",
  "checks": [
    "application loads",
    "login works",
    "chat page is accessible",
    "user can send a message",
    "assistant response becomes visible"
  ],
  "timeout_ms": 30000
}
```

Output:

```json
{
  "status": "passed",
  "duration_ms": 8421,
  "checks": {
    "application_loads": "passed",
    "login": "passed",
    "chat_access": "passed",
    "send_message": "passed",
    "response_visible": "passed"
  },
  "artifacts": {
    "trace": "./artifacts/trace.json",
    "screenshots": [
      "./artifacts/001.png",
      "./artifacts/002.png"
    ]
  }
}
```

---

# 34. Verification policy

Nie pozwalać modelowi samemu powiedzieć:

```text
PASS
```

Model odpowiada:

```text
I think the response is visible.
```

Verifier odpowiada:

```text
DOM assertion:
expected assistant response element
→ found
→ PASS
```

Czyli:

```text
LLM = navigation
Verifier = truth
```

To powinno być podstawową zasadą projektu.

---

# 35. Minimalny MVP

Pierwsza wersja nie powinna implementować wszystkiego.

## MVP v0.1

```text
Chrome
+
CDP
+
snapshot.js
+
indexed actions
+
CLICK
+
TYPE_TEXT
+
navigation
+
stale-page protection
+
screenshots
+
PASS/FAIL
+
CLI
```

Obsługiwane:

```text
button
link
input
textarea
select
checkbox
```

Bez:

```text
iframe
shadow DOM
canvas
upload
popup
```

---

# 36. MVP workflow

```text
browser-verify
      │
      ↓
connect Chrome
      │
      ↓
open URL
      │
      ↓
snapshot
      │
      ↓
LLM chooses action
      │
      ↓
validate
      │
      ↓
execute
      │
      ↓
snapshot
      │
      ↓
repeat
      │
      ↓
DONE
      │
      ↓
deterministic checks
      │
      ↓
PASS / FAIL
```

---

# 37. Jak Codex powinien tego używać

Przykład:

```text
User:
"Deploy latest version and verify it."
```

Codex:

```text
1. inspect git
2. build
3. deploy
4. wait
5. browser_verify
```

Jeżeli:

```text
browser_verify → PASS
```

kończy.

Jeżeli:

```text
browser_verify → FAIL
```

Codex dostaje:

```text
FAIL

check: response_visible
reason: expected element not found
url: /chat
screenshot: artifacts/004.png
```

I może:

```text
inspect code
↓
identify bug
↓
fix
↓
deploy
↓
verify again
```

To jest główny przypadek użycia.

---

# 38. Najważniejszy design principle

Cały system powinien zachować następującą granicę:

```text
                ┌────────────────────┐
                │      Codex         │
                │                    │
                │ planning / coding  │
                │ deploy / diagnose  │
                └─────────┬──────────┘
                          │
                    browser_verify
                          │
                ┌─────────▼──────────┐
                │       Jev          │
                │                    │
                │ navigation / UI    │
                │ interaction        │
                └─────────┬──────────┘
                          │
                       Chrome
                          │
                ┌─────────▼──────────┐
                │   deterministic    │
                │     verifier       │
                │                    │
                │ actual PASS/FAIL   │
                └────────────────────┘
```

**Jev nie powinien być źródłem prawdy.**

Jev powinien być **warstwą sterowania browserem**.

Źródłem prawdy powinny być obserwowalne, deterministyczne warunki.

---

# 39. Wnioski końcowe

`jev-ultrafast` jest bardzo dobrą bazą koncepcyjną do browser toola dla Codex CLI, ponieważ ma mały core i bardzo wyraźny podział:

```text
snapshot.js → "co jest na stronie?"
model.py    → "co zrobić?"
browser.py  → "wykonaj akcję"
agent.py    → "powtarzaj"
verifier    → "czy faktycznie się udało?"
```

Najważniejsza rzecz do zachowania:

```text
DOM
 ↓
indexed actions
 ↓
operation + target
 ↓
validated execution
```

a nie:

```text
screenshot
 ↓
LLM
 ↓
arbitrary browser code
```

Dla narzędzia deployment verification proponowana architektura to:

```text
Codex CLI
    ↓
browser-verify CLI
    ↓
Jev-like browser agent
    ↓
Chrome / CDP
    ↓
evidence
    ↓
independent verifier
    ↓
structured PASS/FAIL
```

To pozwala potraktować przeglądarkę jako **realny test integration/e2e wykonywany przez coding agenta po deploymentcie**, a nie jako kolejnego „chatowego browser agenta”.

### Źródła

- Repozytorium i README: urlbrowser-use/jev-ultrafasthttps://github.com/browser-use/jev-ultrafast
- Agent loop: urlagent.pyhttps://github.com/browser-use/jev-ultrafast/blob/main/jev_ultrafast/agent.py
- Browser/CDP executor: urlbrowser.pyhttps://github.com/browser-use/jev-ultrafast/blob/main/jev_ultrafast/browser.py
- Instrukcje architektoniczne repo: urlAGENTS.mdhttps://github.com/browser-use/jev-ultrafast/blob/main/AGENTS.md
