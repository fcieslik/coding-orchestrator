# Installation

This repository contains the `orchestrate` Codex skill and its bundled
runtime helper. Install it as a packaged snapshot with `install-skill.sh`.

## Requirements

- Node.js `>=24`
- pnpm `11.25.0` or compatible
- a built runtime artifact in `dist/cli.js`

## Fresh installation

From the repository root, build the runtime and run the installer:

```bash
pnpm build
./install-skill.sh
```

The default destination is:

```text
~/.agents/skills/orchestrate/
```

The installer copies only the runtime files needed by the skill, including
`SKILL.md`, `scripts/flow`, `dist/`, `schemas/`, and optional `assets/` or
`references/` directories. Development files such as `src/`, `tests/`, and
`node_modules/` are not installed.

## Updating an existing installation

The installer refuses to replace an existing destination unless `--force` is
provided. To install the current build over the existing skill:

```bash
pnpm build
./install-skill.sh --force
```

The replacement is staged first, so a failed installation does not remove the
previous working installation.

## Installing to another directory

Pass a narrow destination explicitly:

```bash
./install-skill.sh --target /path/to/orchestrate
```

The target must not be the home directory, a broad parent directory, the
repository itself, or `/`.

## Recommended verification

Before installing a release candidate, run the project checks and then install
the built package:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm format:check
pnpm build
./install-skill.sh --force
```

Verify the installed helper directly:

```bash
~/.agents/skills/orchestrate/scripts/flow --version
```

The command should print the current orchestrator version.

## Uninstalling

The installer does not provide an uninstall command. Remove only the installed
skill directory if it is no longer needed:

```bash
rm -rf ~/.agents/skills/orchestrate
```

This removes the installed skill snapshot, not the development repository.
