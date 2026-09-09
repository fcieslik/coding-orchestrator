import { execFile } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, expect, test } from "vitest";

const run = promisify(execFile);
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const installer = join(projectRoot, "install-skill.sh");
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "orchestrate-installer-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function createDevelopmentRepositoryFixture(
  temporaryRoot: string,
): Promise<string> {
  const fixture = join(temporaryRoot, "development-repository");
  await mkdir(fixture);
  await cp(installer, join(fixture, "install-skill.sh"));
  await chmod(join(fixture, "install-skill.sh"), 0o755);
  await cp(join(projectRoot, "SKILL.md"), join(fixture, "SKILL.md"));
  await mkdir(join(fixture, "scripts"));
  await cp(
    join(projectRoot, "scripts", "flow"),
    join(fixture, "scripts", "flow"),
  );
  await mkdir(join(fixture, "dist"));
  await writeFile(join(fixture, "dist", "cli.js"), "// bundled CLI\n");
  return fixture;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("installer creates a fresh runtime snapshot", async () => {
  const temporaryRoot = await temporaryDirectory();
  const target = join(temporaryRoot, "orchestrate");

  const { stderr } = await run(installer, ["--target", target]);

  expect(stderr).toBe("");
  expect((await readdir(target)).sort()).toEqual([
    "SKILL.md",
    "assets",
    "dist",
    "schemas",
    "scripts",
  ]);
  expect(
    await readFile(
      join(target, "schemas", "state-snapshot.schema.json"),
      "utf8",
    ),
  ).not.toBe("");
  expect(
    await readFile(join(target, "schemas", "run-event.schema.json"), "utf8"),
  ).not.toBe("");
  expect(await readFile(join(target, "SKILL.md"), "utf8")).toContain(
    "name: orchestrate",
  );
  expect(await readFile(join(target, "SKILL.md"), "utf8")).toContain(
    "$orchestrate <workflow-package> <ticket-id>",
  );
  expect(await readFile(join(target, "SKILL.md"), "utf8")).toContain(
    "flow validate <workflow-package>",
  );
  expect(await readFile(join(target, "SKILL.md"), "utf8")).toContain(
    "Treat `flow orchestrate` as a long-running foreground operation",
  );
  expect(await readFile(join(target, "SKILL.md"), "utf8")).toContain(
    "Never invoke the same Workflow step again to poll its progress",
  );
  expect(await readFile(join(target, "SKILL.md"), "utf8")).toContain(
    "flow validate <workflow-package>",
  );
  expect(await readFile(join(target, "dist", "cli.js"), "utf8")).not.toBe("");
  expect(await readFile(join(target, "scripts", "flow"), "utf8")).not.toBe("");
  const { stdout } = await run(join(target, "scripts", "flow"), ["--version"]);
  expect(stdout).toBe("0.1.0\n");
});

test("installer packages the canonical Worker safeguards unchanged", async () => {
  const temporaryRoot = await temporaryDirectory();
  const fixture = await createDevelopmentRepositoryFixture(temporaryRoot);
  const sourceSafeguards = join(
    projectRoot,
    "assets",
    "prompts",
    "worker-safeguards.md",
  );
  const fixtureSafeguards = join(
    fixture,
    "assets",
    "prompts",
    "worker-safeguards.md",
  );
  await mkdir(join(fixture, "assets", "prompts"), { recursive: true });
  await cp(sourceSafeguards, fixtureSafeguards);
  const target = join(temporaryRoot, "installed-skill");

  await run(join(fixture, "install-skill.sh"), ["--target", target]);

  await expect(
    readFile(join(target, "assets/prompts/worker-safeguards.md"), "utf8"),
  ).resolves.toBe(await readFile(sourceSafeguards, "utf8"));
});

test("installer refuses to modify an existing destination", async () => {
  const temporaryRoot = await temporaryDirectory();
  const target = join(temporaryRoot, "orchestrate");
  const existingFile = join(target, "existing.txt");
  await mkdir(target);
  await writeFile(existingFile, "keep this installation\n");

  await expect(run(installer, ["--target", target])).rejects.toMatchObject({
    code: 1,
  });

  expect(await readdir(target)).toEqual(["existing.txt"]);
  expect(await readFile(existingFile, "utf8")).toBe("keep this installation\n");
});

test("installer force-replaces an existing destination", async () => {
  const temporaryRoot = await temporaryDirectory();
  const target = join(temporaryRoot, "orchestrate");
  await mkdir(target);
  await writeFile(join(target, "stale.txt"), "remove me\n");

  await run(installer, ["--target", target, "--force"]);

  expect((await readdir(target)).sort()).toEqual([
    "SKILL.md",
    "assets",
    "dist",
    "schemas",
    "scripts",
  ]);
});

test("installer copies only allowlisted runtime artifacts", async () => {
  const temporaryRoot = await temporaryDirectory();
  const fixture = await createDevelopmentRepositoryFixture(temporaryRoot);
  const target = join(temporaryRoot, "installed-skill");

  for (const directory of ["references", "assets", "schemas"]) {
    await mkdir(join(fixture, directory));
    await writeFile(join(fixture, directory, "runtime.txt"), `${directory}\n`);
  }
  for (const directory of ["src", "tests", "node_modules", ".git"]) {
    await mkdir(join(fixture, directory));
    await writeFile(join(fixture, directory, "development.txt"), "excluded\n");
  }
  await writeFile(join(fixture, "package.json"), "{}\n");

  await run(join(fixture, "install-skill.sh"), ["--target", target]);

  expect((await readdir(target)).sort()).toEqual([
    "SKILL.md",
    "assets",
    "dist",
    "references",
    "schemas",
    "scripts",
  ]);
  for (const directory of ["references", "assets", "schemas"]) {
    expect(await readFile(join(target, directory, "runtime.txt"), "utf8")).toBe(
      `${directory}\n`,
    );
  }
});

test("installer defaults to the user skill directory", async () => {
  const temporaryHome = await temporaryDirectory();

  await run(installer, [], {
    env: { ...process.env, HOME: temporaryHome },
  });

  expect(
    await readFile(
      join(temporaryHome, ".agents", "skills", "orchestrate", "SKILL.md"),
      "utf8",
    ),
  ).toContain("name: orchestrate");
});

test("installer checks build artifacts before modifying the destination", async () => {
  const temporaryRoot = await temporaryDirectory();
  const fixture = await createDevelopmentRepositoryFixture(temporaryRoot);
  const target = join(temporaryRoot, "installed-skill");
  const existingFile = join(target, "existing.txt");
  await rm(join(fixture, "dist", "cli.js"));
  await mkdir(target);
  await writeFile(existingFile, "keep this installation\n");

  await expect(
    run(join(fixture, "install-skill.sh"), ["--target", target, "--force"]),
  ).rejects.toMatchObject({ code: 1 });

  expect(await readdir(target)).toEqual(["existing.txt"]);
  expect(await readFile(existingFile, "utf8")).toBe("keep this installation\n");
});

test("installer rejects unsafe broad targets", async () => {
  await expect(run(installer, ["--target", "/"])).rejects.toMatchObject({
    code: 2,
  });

  const temporaryHome = await temporaryDirectory();
  await expect(
    run(
      installer,
      ["--target", `${temporaryHome}/.agents/skills/`, "--force"],
      { env: { ...process.env, HOME: temporaryHome } },
    ),
  ).rejects.toMatchObject({ code: 2 });

  const nestedHome = join(temporaryHome, "users", "developer");
  await mkdir(nestedHome, { recursive: true });
  await expect(
    run(installer, ["--target", join(temporaryHome, "users"), "--force"], {
      env: { ...process.env, HOME: nestedHome },
    }),
  ).rejects.toMatchObject({ code: 2 });
});

test("installer rejects an option in place of a target directory", async () => {
  await expect(run(installer, ["--target", "--force"])).rejects.toMatchObject({
    code: 2,
  });
});

test("installer accepts a narrow destination directly under a system temporary directory", async () => {
  const target = `/tmp/orchestrate-installer-${process.pid}-${Date.now()}`;
  temporaryDirectories.push(target);

  await run(installer, ["--target", target]);

  expect(await readFile(join(target, "SKILL.md"), "utf8")).toContain(
    "name: orchestrate",
  );
});

test("installer restores the existing destination when activation fails", async () => {
  const temporaryRoot = await temporaryDirectory();
  const target = join(temporaryRoot, "installed-skill");
  const existingFile = join(target, "existing.txt");
  const fakeBinaryDirectory = join(temporaryRoot, "bin");
  const moveCounter = join(temporaryRoot, "move-count");
  await mkdir(target);
  await writeFile(existingFile, "keep this installation\n");
  await mkdir(fakeBinaryDirectory);
  await writeFile(moveCounter, "0\n");
  await writeFile(
    join(fakeBinaryDirectory, "mv"),
    `#!/usr/bin/env bash
set -euo pipefail
count="$(<"$MV_COUNT_FILE")"
count="$((count + 1))"
printf '%s\\n' "$count" > "$MV_COUNT_FILE"
if [[ "$count" -eq 2 ]]; then
  mkdir -p "$2"
  printf 'partial activation\\n' > "$2/partial.txt"
  exit 73
fi
exec /bin/mv "$@"
`,
  );
  await chmod(join(fakeBinaryDirectory, "mv"), 0o755);

  await expect(
    run(installer, ["--target", target, "--force"], {
      env: {
        ...process.env,
        MV_COUNT_FILE: moveCounter,
        PATH: `${fakeBinaryDirectory}:${process.env.PATH ?? ""}`,
      },
    }),
  ).rejects.toMatchObject({ code: 1 });

  expect(await readdir(target)).toEqual(["existing.txt"]);
  expect(await readFile(existingFile, "utf8")).toBe("keep this installation\n");
});
