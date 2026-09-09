import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, test } from "vitest";

const run = promisify(execFile);
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const installer = join(projectRoot, "install-skill.sh");

test("the Installed skill contains the same canonical Worker safeguards", async () => {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "orchestrate-safeguards-"),
  );
  try {
    const target = join(temporaryRoot, "installed-skill");
    const sourceSafeguards = join(
      projectRoot,
      "assets",
      "prompts",
      "worker-safeguards.md",
    );

    await run(installer, ["--target", target]);

    await expect(
      readFile(join(target, "assets/prompts/worker-safeguards.md"), "utf8"),
    ).resolves.toBe(await readFile(sourceSafeguards, "utf8"));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
