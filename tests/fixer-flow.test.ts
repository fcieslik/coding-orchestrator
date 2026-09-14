import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
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
const executable = fileURLToPath(new URL("../scripts/flow", import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

test("a resolution launches one fresh Fixer and accepts its separate commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "fixer-flow-"));
  roots.push(root);
  const repository = join(root, "repo");
  await mkdir(repository);
  await run("git", ["init", "--quiet", repository]);
  await writeFile(join(repository, "README.md"), "initial\n");
  await run("git", ["-C", repository, "add", "README.md"]);
  await run("git", [
    "-C",
    repository,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--quiet",
    "-m",
    "initial",
  ]);
  const packageDirectory = join(repository, "feature");
  await mkdir(join(packageDirectory, "issues"), { recursive: true });
  await writeFile(join(packageDirectory, "spec.md"), "# Feature\n");
  await writeFile(
    join(packageDirectory, "issues", "01-review.md"),
    "# Review\nResolve the reported finding.\n",
  );
  const fake = join(root, "herdr");
  const state = join(root, "herdr-state.json");
  const launches = join(root, "launches.log");
  const closes = join(root, "closes.log");
  await writeFile(
    fake,
    `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
const args = process.argv.slice(2);
if (args[0] === "--version") console.log("fake-herdr 1.0.0");
else if (args[0] === "pane" && args[1] === "split") console.log(JSON.stringify({result:{pane:{pane_id:"fake:pane"}}}));
else if (args[0] === "agent" && args[1] === "start") {
  const child = args.slice(args.indexOf("--") + 1);
  writeFileSync(process.env.FAKE_STATE, JSON.stringify({worktree: child[child.indexOf("-C") + 1]}));
  appendFileSync(process.env.FAKE_LAUNCHES, args[2] + "\\n");
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:pane",agent_status:"idle"}}}));
} else if (args[0] === "agent" && args[1] === "prompt") {
  const current = JSON.parse(readFileSync(process.env.FAKE_STATE, "utf8"));
  const prompt = args[3];
  const worktree = current.worktree;
  const ticket = prompt.match(/- Ticket: ([^\\n]+)/)[1];
  const resultPath = prompt.match(/result to: "([^"]+)"/)[1];
  const isFixer = prompt.includes("bounded Fixer execution");
  writeFileSync(worktree + (isFixer ? "/correction.txt" : "/candidate.txt"), isFixer ? "correction\\n" : "candidate\\n");
  execFileSync("git", ["-C", worktree, "add", "."]);
  execFileSync("git", ["-C", worktree, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", isFixer ? "correction" : "candidate"]);
  const commit = execFileSync("git", ["-C", worktree, "rev-parse", "HEAD"], {encoding:"utf8"}).trim();
  const value = isFixer
    ? {schemaVersion:1,ticketId:ticket,status:"completed",summary:"Correction applied.",commit}
    : {schemaVersion:1,ticketId:ticket,status:"completed",summary:"Candidate requires a decision.",commit,commands:[],review:{status:"attention",findings:[{axis:"spec",summary:"The behavior needs a decision.",requiredDecision:"Choose the behavior."}]}};
  writeFileSync(resultPath + ".tmp", JSON.stringify(value));
  renameSync(resultPath + ".tmp", resultPath);
  console.log(JSON.stringify({result:{agent:{name:args[2],pane_id:"fake:pane",agent_status:"done"}}}));
} else if (args[0] === "agent" && args[1] === "read") process.stdout.write("done\\n");
else if (args[0] === "pane" && args[1] === "close") { appendFileSync(process.env.FAKE_CLOSES, args[2] + "\\n"); console.log("{}"); }
else process.exit(2);
`,
    "utf8",
  );
  await chmod(fake, 0o755);
  const environment = {
    ...process.env,
    HERDR_ENV: "1",
    HERDR_PANE_ID: "caller",
    HERDR_BIN_PATH: fake,
    FAKE_STATE: state,
    FAKE_LAUNCHES: launches,
    FAKE_CLOSES: closes,
  };
  const initialHead = (
    await run("git", ["-C", repository, "rev-parse", "HEAD"])
  ).stdout.trim();
  const first = JSON.parse(
    (
      await run(
        executable,
        ["orchestrate", "feature", "01-review", "--repo", repository, "--json"],
        { cwd: repository, env: environment },
      )
    ).stdout,
  );
  expect(first.status).toBe("attention");
  expect(first.candidateCommit).toMatch(/^[0-9a-f]{40}$/);
  const second = JSON.parse(
    (
      await run(
        executable,
        [
          "orchestrate",
          "feature",
          "01-review",
          "--repo",
          repository,
          "--resolution",
          "Choose the behavior.",
          "--json",
        ],
        { cwd: repository, env: environment },
      )
    ).stdout,
  );
  expect(second.status).toBe("accepted");
  expect(second.acceptedCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(second.acceptedCommit).not.toBe(first.candidateCommit);
  expect(second.fixer.status).toBe("accepted");
  expect(second.snapshot.tickets["01-review"]).toMatchObject({
    status: "accepted",
    commit: second.acceptedCommit,
  });
  expect(second.snapshot.reviewAttention).toBeUndefined();
  expect((await readFile(launches, "utf8")).trim().split("\n")).toHaveLength(2);
  expect((await readFile(closes, "utf8")).trim().split("\n")).toHaveLength(2);
  expect(
    (await run("git", ["-C", repository, "rev-parse", "HEAD"])).stdout.trim(),
  ).toBe(initialHead);
  const repeated = JSON.parse(
    (
      await run(
        executable,
        [
          "orchestrate",
          "feature",
          "01-review",
          "--repo",
          repository,
          "--resolution",
          "Choose the behavior.",
          "--json",
        ],
        { cwd: repository, env: environment },
      )
    ).stdout,
  );
  expect(repeated.status).toBe("noop");
  expect((await readFile(launches, "utf8")).trim().split("\n")).toHaveLength(2);
}, 30_000);
