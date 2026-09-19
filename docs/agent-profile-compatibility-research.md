# Agent profile compatibility research

Date: 2026-09-18

## Question

Can the Orchestrator launch Claude Code and Pi as live interactive Workers, select their repository-configured provider/model settings, and invoke the existing `implement` skill through the Herdr lifecycle?

## Findings

### Claude Code

- The documented interactive entry point is `claude`; `claude "query"` starts an interactive session with an initial prompt. The non-interactive `-p` mode is a different path and must not be used for the Herdr interactive Worker contract.
- Claude Code supports `--model`, `--add-dir`, and `--name`. `--add-dir` grants the session access to additional working directories, which is suitable for the preallocated Worker result directory.
- Project skills live at `.claude/skills/<skill-name>/SKILL.md` and are invoked as `/<skill-name>`. Therefore `/implement <ticket-path>` is valid when the skill is discoverable by Claude Code.
- The documented `--bare` and `--safe-mode` options disable or restrict customization discovery. The Orchestrator must not enable them when the Worker depends on the installed `implement` skill.

Primary sources:

- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage)
- [Claude Code skills](https://code.claude.com/docs/en/skills)

### Pi

- Pi defaults to interactive mode. `--print` and `--mode rpc` are separate modes; the Herdr Worker adapter should use the default interactive mode if it continues to use `agent start` followed by `agent prompt`.
- Pi supports `--provider <name>`, `--model <pattern>`, `--name`, `--session-dir`, and `--no-session`. A repository Agent profile can therefore express values such as `provider: openai` and `model: gpt-5.6-luna` as validated launch arguments.
- Pi's official model documentation currently lists OpenAI GPT-5.6 Sol, Terra, and Luna model IDs, including `gpt-5.6-luna`.
- Pi discovers shared skills from `~/.agents/skills/` and project skills from `.agents/skills/`; it also supports explicit `--skill <path>` arguments.
- Pi registers skills as `/skill:<name>`, not as bare `/<name>`. The live Pi Worker invocation must therefore be `/skill:implement <ticket-path>` unless the Orchestrator deliberately supplies a different Pi prompt-template or command adapter.
- Pi's project-local skill/resource loading may require project trust in interactive mode. The adapter or preflight must account for this; otherwise Pi can start successfully but not expose the expected skill.

Primary sources:

- [Pi interactive usage and CLI](https://pi.dev/docs/latest/usage)
- [Pi skills](https://pi.dev/docs/latest/skills)
- [Pi RPC mode](https://pi.dev/docs/latest/rpc)
- [Pi providers](https://pi.dev/docs/latest/providers)
- [Pi custom models](https://pi.dev/docs/latest/models)
- [Pi settings and project trust](https://pi.dev/docs/latest/settings)

### Skill installation boundary

- The current shared `implement` skill at `~/.agents/skills/implement/SKILL.md` is discoverable by Pi according to Pi's documented global skill locations.
- Claude Code's documented skill locations are `~/.claude/skills/<name>/SKILL.md` and `.claude/skills/<name>/SKILL.md` in the project. Its documentation does not list `~/.agents/skills/` as an automatic discovery location.
- Therefore the Orchestrator should not pretend that one global skill path works identically for both agents. The selected agent must already expose the configured downstream skill through its native skill location, or the target repository must provide the native copy. Provisioning or synchronizing skills is outside the minimal launch adapter.

## Compatibility consequence

The current renderer's rule `codex -> $implement`, `claude-code/pi -> /implement` is not correct for Pi. The renderer needs an explicit profile-specific skill invocation mapping:

| Agent profile | Herdr kind | Interactive executable | Skill invocation |
| --- | --- | --- | --- |
| `codex` | `codex` | `codex` | `$implement "..."` |
| `claude-code` | `claude` | `claude` | `/implement "..."` |
| `pi` | `pi` | `pi` | `/skill:implement "..."` |

The repository's native agent configuration should own provider/model/session choices, while the Orchestrator owns only profile selection, transport contract, cwd, result-directory access, timeouts, and forbidden permission bypasses.

## Limits of this research

- Documentation proves that the required CLI modes and flags exist; it does not prove that a particular account can authenticate or that every arbitrary model ID is enabled for that account.
- A live Pi model listing could not be executed in this environment because Pi attempted to create lock files under `/Users/fc47/.pi/agent`, which is outside the writable workspace. This is an environment permission issue, not evidence that `gpt-5.6-luna` is unsupported.
- Herdr 0.8.2 installed locally advertises `pi` and `claude` as supported agent kinds. The compatibility suite should still assert this transport mapping rather than relying on a generic executable string.

## Claude Code live gate

The repository's explicit live gate is opt-in: first run `flow herdr smoke --agent claude` inside a Herdr pane, then execute one disposable Worker ticket with a `claude-code` profile. The first command verifies the real Herdr/Claude interactive lifecycle; the disposable Worker verifies authentication and that the native `/implement` skill is actually discoverable. Missing prerequisites are reported by the operator and are not part of ordinary CI.

## Pi live gate

The Pi gate is also opt-in: first run `flow herdr smoke --agent pi` inside a Herdr pane, then execute one disposable Worker ticket with a `pi` profile. The first command verifies the real Herdr/Pi interactive lifecycle; the disposable Worker verifies authentication, native `/skill:implement` discovery, and the configured provider/model when those overrides are present. Missing Pi, credentials, native skill, project trust, or model access are environment prerequisites and are not part of ordinary CI.
