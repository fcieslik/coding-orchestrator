import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, expect, test } from "vitest";

import { createRun } from "../src/workflow-run.js";

const run = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("createRun accepts injected time and randomness and retries generated collisions", async () => {
  const repository = await mkdtemp(join(tmpdir(), "flow-run-"));
  temporaryDirectories.push(repository);
  await run("git", ["init", "--quiet", repository]);
  await mkdir(join(repository, "specs"));
  await writeFile(join(repository, "specs", "feature.md"), "# Feature\n");

  const collidingRunId = "run_20260904T120000Z_012345abcdef";
  const replacementRunId = "run_20260904T120000Z_fedcba987654";
  await createRun({
    repository,
    specification: "specs/feature.md",
    runId: collidingRunId,
  });

  const randomValues = [
    Buffer.from("012345abcdef", "hex"),
    Buffer.from("fedcba987654", "hex"),
  ];
  let randomCalls = 0;
  const generatedRunId = await createRun(
    { repository, specification: "specs/feature.md" },
    {
      clock: () => new Date("2026-09-04T12:00:00.123Z"),
      randomBytes: () => {
        const value = randomValues[randomCalls];
        randomCalls += 1;
        if (!value) throw new Error("random source exhausted");
        return value;
      },
    },
  );

  expect(generatedRunId).toBe(replacementRunId);
  expect(randomCalls).toBe(2);
  const snapshot = JSON.parse(
    await readFile(
      join(repository, ".orchestrator", "runs", replacementRunId, "state.json"),
      "utf8",
    ),
  );
  expect(snapshot.createdAt).toBe("2026-09-04T12:00:00.123Z");
});
