# 01: Bootstrap the executable development repository

**What to build:** Initialize the development repository and provide the smallest tested TypeScript executable that builds and displays help.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Git is initialized on `main` without creating a commit or remote.
- [ ] The private `coding-orchestrator` package is version `0.1.0`, supports Node 24+, and pins `pnpm@11.25.0`.
- [ ] Strict TypeScript, ESM, Vitest, and tsup are configured.
- [ ] The pnpm lockfile is tracked; dependencies and generated outputs are ignored.
- [ ] The executable wrapper invokes the bundled CLI relative to its installation root.
- [ ] `pnpm test`, `pnpm build`, and `./scripts/flow --help` pass.
