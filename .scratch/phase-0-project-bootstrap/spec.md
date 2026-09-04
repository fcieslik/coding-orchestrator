# Phase 0 — Project Bootstrap

Status: ready-for-agent

## Problem Statement

The Coding Workflow Orchestrator has architecture documentation but no Git repository, executable project, build system, tests, or installable skill snapshot. Development cannot proceed safely to durable state or orchestration features until a reproducible foundation exists.

## Solution

Bootstrap the development repository as a private TypeScript project with a tested `flow` executable, bundled build output, minimal valid skill definition, and transactional installer. Initialize Git on `main`, but leave the initial commit to the user.

## User Stories

1. As a maintainer, I want the project initialized as a Git repository, so that its history can be managed normally.
2. As a maintainer, I want to make the initial commit myself, so that repository publication remains under my control.
3. As a developer, I want Node 24 or newer supported, so that the project uses an LTS baseline.
4. As a developer, I want pnpm pinned to version `11.25.0`, so that dependency management is reproducible.
5. As a developer, I want a committed lockfile, so that installations resolve consistently.
6. As a developer, I want strict TypeScript checking, so that later orchestration logic has a sound foundation.
7. As a developer, I want `pnpm test` to work from a clean checkout, so that behavior can be verified consistently.
8. As a developer, I want lint and formatting commands, so that new code follows one convention.
9. As a developer, I want `pnpm build` to produce bundled executable code, so that the installed skill does not require development dependencies.
10. As a user, I want `flow` with no arguments to show usage, so that the entrypoint is discoverable.
11. As a user, I want `flow --help` to succeed, so that I can inspect its interface.
12. As a user, I want `flow --version` to report `0.1.0`, so that I can identify the installed snapshot.
13. As a user, I want unsupported arguments to fail clearly, so that mistakes are not silently accepted.
14. As an agent, I want a valid minimal `orchestrate` skill definition, so that the snapshot is structurally usable before workflow behavior is added.
15. As a maintainer, I want installation to copy an explicit runtime allowlist, so that development-only files are excluded.
16. As a maintainer, I want installation to refuse an existing destination by default, so that prior installations are not overwritten accidentally.
17. As a maintainer, I want `--force` to replace an installation transactionally, so that failure does not leave a partial snapshot.
18. As a test author, I want an alternate installation target, so that installer behavior can be verified safely in temporary directories.
19. As a maintainer, I want generated output ignored by Git, so that source history remains clean.
20. As a macOS or Linux user, I want portable Bash wrappers, so that the bootstrap works in the supported Herdr environment.

## Implementation Decisions

- Initialize Git with branch `main`; do not create a commit or remote.
- Create a private `coding-orchestrator` package at version `0.1.0`, requiring Node 24+, with `pnpm@11.25.0` pinned.
- Use strict TypeScript and ESM. Use tsup to emit one bundled CLI entrypoint.
- Use Vitest, ESLint, and Prettier. Expose `test`, `build`, `typecheck`, `lint`, `format`, and `format:check` package commands.
- Make tests build the executable before exercising it, ensuring `pnpm test` works without pre-existing build output.
- Define the CLI contract as:
  - no arguments or `--help`: usage on stdout, exit `0`;
  - `--version`: `0.1.0` on stdout, exit `0`;
  - unsupported arguments: explanatory stderr output and nonzero exit.
- Keep `flow` as a thin Bash wrapper that resolves its own installation root and invokes the bundled entrypoint with Node.
- Create a minimal valid skill definition with the canonical name `orchestrate`, a concise description, and placeholder body only.
- Define the installer interface as `install-skill.sh [--target <directory>] [--force]`.
- Default installation to `~/.agents/skills/orchestrate`; reject invalid arguments and unsafe broad targets.
- Require the built CLI and required runtime files before modifying the destination.
- Copy only the skill definition, executable scripts, and build output, plus references, assets, and schemas when those optional runtime directories exist.
- Exclude source, tests, dependencies, Git metadata, and development configuration.
- Stage beside the destination. With `--force`, temporarily move the prior installation aside, activate the staged snapshot, restore the prior installation if activation fails, and remove the temporary backup after success.
- Commit the pnpm lockfile; ignore dependencies, build output, coverage, logs, and common editor/OS files.
- Install the pinned pnpm release globally through npm before verification.
- Target macOS and Linux; Windows support is excluded.

## Testing Decisions

- Test external behavior rather than TypeScript functions or Bash implementation details.
- Use two public subprocess seams: the `flow` executable for CLI behavior and the installer for snapshot behavior.
- Verify help, default invocation, version, and invalid arguments.
- Verify a fresh install contains the runtime allowlist and excludes development files.
- Verify an existing destination is unchanged without `--force`.
- Verify forced installation replaces stale contents.
- Verify missing build artifacts fail before changing an existing destination.
- There is no existing test prior art; the roadmap's executable acceptance commands are authoritative.
- Final verification includes tests, type-checking, linting, formatting checks, build, and the real `flow --help` smoke test.

## Out of Scope

- Durable run state, transitions, events, and recovery.
- Git worktree orchestration.
- Herdr integration or worker, reviewer, and fixer agents.
- Ticket adapters and deterministic project checks.
- Operational commands beyond help and version.
- Full skill policy and stage-specific references.
- Installing into the real default skill directory during automated verification.
- Creating a GitHub remote, commit, or release.
- Windows support.

## Further Notes

- The development repository and installed skill remain distinct concepts as defined in the project glossary.
- No ADR is needed because the bootstrap choices are conventional and inexpensive to reverse.
- The user will create the GitHub repository and manually commit Phase 0 after verification.
