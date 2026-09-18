# Keep agent profiles minimal and defer provider configuration to the agent

The Target repository's `.orchestrator/config.yaml` selects the Agent profile and may provide the optional `provider` and `model` overrides needed for a run, such as Pi with OpenAI and `gpt-5.6-luna`. The Orchestrator does not mirror each agent's full configuration: absent overrides fall back to the agent's native configuration, while the adapter owns only the minimal launch mapping and the logical skill invocation. This keeps repository-level selection explicit without turning the Orchestrator into a second Pi or Claude Code configuration system.

## Consequences

- Profiles use `kind`, with optional `provider` and `model`; `mode`, sessions, arbitrary flags, and permission policy are out of scope until a concrete need appears.
- Agent-specific skill discovery remains a prerequisite owned by the target environment. The renderer uses `/implement` for Claude Code and `/skill:implement` for Pi.
- The adapter maps the domain name `claude-code` to Herdr's transport kind `claude`.
