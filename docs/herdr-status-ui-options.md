# Herdr status UI for Coding Orchestrator

## Wniosek

Herdr może zapewnić wygodny widok statusu bez uruchamiania osobnego serwera WWW. Najlepszy kierunek dla POC to mały plugin z:

- krótkim statusem runu w sidebarze Herdr;
- terminalowym popupem lub overlayem z pełniejszym podsumowaniem;
- odczytem istniejącego, trwałego stanu z `.orchestrator/runs/`.

UI pozostaje wyłącznie projekcją danych. `state.json`, `execution.json`, `validation.json` i historia nadal są źródłem prawdy.

## Co umożliwia Herdr

Plugin Herdr jest manifestem oraz uruchamianymi poza procesem Herdr komendami. Może deklarować actions, event hooks i terminalowe panes oraz korzystać z całego CLI lub Socket API Herdr. Plugin v1 nie obsługuje własnego natywnego, nieterminalowego UI. [Herdr Plugins](https://herdr.dev/docs/plugins/)

Panel pluginu może zostać otwarty jako `popup`, `overlay`, `split`, `tab` albo `zoomed`. Popup jest dobrym domyślnym widokiem statusu, ponieważ nie zmienia stałego układu pane'ów. [Herdr Plugins — Panes](https://herdr.dev/docs/plugins/#panes)

Herdr pozwala również raportować krótkie metadane pane'a lub workspace'u. Własne tokeny mogą być wyświetlane w wierszach sidebara, na przykład jako nazwa pakietu, bieżący ticket i postęp. [Herdr Configuration — Sidebar row layouts](https://herdr.dev/docs/configuration/#sidebar-row-layouts)

Startup hook jest jednorazową inicjalizacją, a nie nadzorowanym daemonem. Dokumentacja nie opisuje eventu wywoływanego przez zmianę plików `.orchestrator/runs`, dlatego odświeżanie powinno użyć prostego pollingu w otwartym panelu albo jawnego raportowania metadanych po zmianie trwałego stanu. [Herdr Plugins — Startup hooks](https://herdr.dev/docs/plugins/#startup-hooks)

## Proponowany wygląd

Sidebar, zawsze pod ręką:

```text
● codex
  phase7-live · ticket 2/3 · worker
```

Popup otwierany skrótem:

```text
phase7-live

[✓] 01-add-min-value
[▶] 02-add-max-value       Worker: working
[ ] 03-update-docs
[ ] Final validation
[ ] Local integration / PR
```

Przy problemie:

```text
[!] 02-add-max-value       blocked
    Agent start failed (exit 1)
```

## Najmniejszy sensowny zakres

1. Jedna komenda odczytująca aktualny run przez istniejące `flow status --json`.
2. Jeden terminalowy popup renderujący run, tickety, bieżący etap i ostatni błąd.
3. Opcjonalne tokeny `package`, `ticket`, `step` i `progress` w sidebarze.
4. Odświeżanie co około sekundę tylko wtedy, gdy popup jest otwarty; sidebar aktualizowany po trwałej zmianie stanu.
5. Brak mutacji workflow z panelu w pierwszej wersji.

Nie potrzeba frameworka frontendowego, bazy danych ani nowego API. Prosty proces Node może czytać publiczny wynik `flow status --json` i renderować tekst.

## Kiedy warto zbudować dashboard WWW

Serwer WWW ma sens dopiero wtedy, gdy potrzebne będą:

- jednoczesny widok wielu repozytoriów i historycznych runów;
- filtrowanie, wykresy lub rozbudowane logi;
- dostęp spoza bieżącej sesji Herdr;
- sterowanie workflow przez formularze.

Na obecnym etapie oznaczałby dodatkowy proces, port, lifecycle i warstwę UI bez proporcjonalnej korzyści.

## Bezpieczeństwo

Plugin jest zwykłym kodem uruchamianym z uprawnieniami użytkownika i Herdr go nie sandboxuje. Pierwsza wersja powinna być lokalna, tylko do odczytu i nie powinna wyświetlać pełnych promptów ani nieograniczonych logów Workera. [Herdr Plugins — Trust and security](https://herdr.dev/docs/plugins/#trust-and-security)
