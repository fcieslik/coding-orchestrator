import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, expect, test } from "vitest";

const run = promisify(execFile);
const executable = fileURLToPath(new URL("../scripts/flow", import.meta.url));
const temporaryDirectories: string[] = [];

async function targetRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "flow-setup-test-"));
  temporaryDirectories.push(repository);
  await run("git", ["init", "--quiet", repository]);
  return repository;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test("setup creates the contract and repeats as an exact no-op", async () => {
  const repository = await targetRepository();
  const first = JSON.parse(
    (await run(executable, ["setup", "--repo", repository, "--json"])).stdout,
  );
  expect(first.created).toEqual([
    ".orchestrator/config.yaml",
    ".orchestrator/README.md",
    ".orchestrator/runs/ ignore rule",
  ]);
  expect(first.config).toMatchObject({
    version: 1,
    agents: { codex: { kind: "codex" } },
    roles: { worker: { agent: "codex", skill: "implement" } },
    workflow: {
      workerTimeoutSeconds: 1800,
      maxWorkerAttempts: 2,
      validation: {
        test: "pnpm test",
        lint: "pnpm lint",
        typecheck: "pnpm typecheck",
        formatCheck: "pnpm format:check",
        build: "pnpm build",
        timeoutSeconds: 900,
      },
    },
  });
  const paths = [
    join(repository, ".orchestrator/config.yaml"),
    join(repository, ".orchestrator/README.md"),
    join(repository, ".gitignore"),
  ];
  const before = await Promise.all(paths.map((path) => readFile(path, "utf8")));
  const second = JSON.parse(
    (await run(executable, ["setup", "--repo", repository, "--json"])).stdout,
  );
  expect(second.created).toEqual([]);
  expect(
    await Promise.all(paths.map((path) => readFile(path, "utf8"))),
  ).toEqual(before);
});

test("setup preserves partial files and reports invalid configuration structurally", async () => {
  const repository = await targetRepository();
  await mkdir(join(repository, ".orchestrator"));
  const readme = "project-owned documentation\n";
  await writeFile(join(repository, ".orchestrator/README.md"), readme);
  await writeFile(
    join(repository, ".orchestrator/config.yaml"),
    "version: 1\nagents:\n  codex:\n    kind: codex\nroles:\n  worker:\n    agent: missing\n    skill: implement\nworkflow:\n  workerTimeoutSeconds: 1800\n  maxWorkerAttempts: 2\n",
  );
  await expect(
    run(executable, ["setup", "--repo", repository, "--json"]),
  ).rejects.toMatchObject({ code: 2, stdout: "" });
  expect(
    await readFile(join(repository, ".orchestrator/README.md"), "utf8"),
  ).toBe(readme);
});

test("setup appends the runtime ignore rule without replacing user content", async () => {
  const repository = await targetRepository();
  const existing = "dist/\n# project rule\n";
  await writeFile(join(repository, ".gitignore"), existing);
  await run(executable, ["setup", "--repo", repository]);
  expect(await readFile(join(repository, ".gitignore"), "utf8")).toBe(
    `${existing}.orchestrator/runs/\n`,
  );
});

test("setup rejects unsupported versions and non-repositories", async () => {
  const repository = await targetRepository();
  await mkdir(join(repository, ".orchestrator"));
  await writeFile(
    join(repository, ".orchestrator/config.yaml"),
    "version: 2\nagents: {}\nroles: {}\nworkflow: {}\n",
  );
  await expect(
    run(executable, ["setup", "--repo", repository, "--json"]),
  ).rejects.toMatchObject({ code: 2, stdout: "" });

  const nonRepository = await mkdtemp(join(tmpdir(), "flow-setup-nonrepo-"));
  temporaryDirectories.push(nonRepository);
  await expect(
    run(executable, ["setup", "--repo", nonRepository, "--json"]),
  ).rejects.toMatchObject({ code: 3, stdout: "" });
});
