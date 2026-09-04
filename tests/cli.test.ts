import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, test } from "vitest";

const run = promisify(execFile);
const executable = fileURLToPath(new URL("../scripts/flow", import.meta.url));
const outsideInstallationRoot = fileURLToPath(new URL(".", import.meta.url));

test("flow --help displays usage", async () => {
  const { stderr, stdout } = await run(executable, ["--help"], {
    cwd: outsideInstallationRoot,
  });

  expect(stdout).toContain("Usage: flow");
  expect(stderr).toBe("");
});
