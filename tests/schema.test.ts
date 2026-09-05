import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import {
  generateJsonSchemas,
  orchestrationConfigSchema,
  runEventSchema,
  stateSnapshotSchema,
} from "../src/schema.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const timestamp = "2026-09-04T12:00:00.000Z";

test("runtime schemas validate and preserve additive object properties", () => {
  const snapshot = stateSnapshotSchema.parse({
    schemaVersion: 1,
    runId: "run_20260904T120000Z_012345abcdef",
    revision: 1,
    phase: "created",
    specification: "specs/feature.md",
    createdAt: timestamp,
    updatedAt: timestamp,
    futureSnapshotField: { enabled: true },
  });
  const event = runEventSchema.parse({
    schemaVersion: 1,
    eventId: "event_123",
    runId: snapshot.runId,
    sequence: 1,
    stateRevision: 1,
    timestamp,
    type: "run.created",
    data: {
      specification: snapshot.specification,
      futureEventData: { source: "test" },
    },
    futureEnvelopeField: "kept",
  });

  expect(snapshot.futureSnapshotField).toEqual({ enabled: true });
  expect(event.futureEnvelopeField).toBe("kept");
  expect(event.data.futureEventData).toEqual({ source: "test" });
});

test("runtime schemas reject unsupported versions and Run phases", () => {
  const validSnapshot = {
    schemaVersion: 1,
    runId: "run_20260904T120000Z_012345abcdef",
    revision: 1,
    phase: "created",
    specification: "specs/feature.md",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  expect(() =>
    stateSnapshotSchema.parse({ ...validSnapshot, schemaVersion: 2 }),
  ).toThrow();
  expect(() =>
    stateSnapshotSchema.parse({ ...validSnapshot, phase: "future" }),
  ).toThrow();
});

test("runtime schemas reject impossible run ID timestamps", () => {
  expect(() =>
    stateSnapshotSchema.parse({
      schemaVersion: 1,
      runId: "run_20269999T999999Z_012345abcdef",
      revision: 1,
      phase: "created",
      specification: "specs/feature.md",
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  ).toThrow();
});

test("runtime schema validates additive Git worktree state", () => {
  const snapshot = stateSnapshotSchema.parse({
    schemaVersion: 1,
    runId: "run_20260904T120000Z_012345abcdef",
    revision: 2,
    phase: "preparing",
    specification: "specs/feature.md",
    createdAt: timestamp,
    updatedAt: timestamp,
    git: {
      schemaVersion: 1,
      runBase: "0123456789012345678901234567890123456789",
      featureBranch: "orchestrator/run_20260904T120000Z_012345abcdef",
      featureWorktree:
        "/tmp/project-worktrees/run_20260904T120000Z_012345abcdef",
      worktreeStatus: "planned",
      futureGitField: true,
    },
  });
  expect(snapshot.git?.futureGitField).toBe(true);
  expect(() =>
    stateSnapshotSchema.parse({
      ...snapshot,
      git: { ...snapshot.git, worktreeStatus: "unknown" },
    }),
  ).toThrow();
});

test("orchestration configuration validates worker contract and bounds", () => {
  expect(
    orchestrationConfigSchema.parse({
      version: 1,
      agents: { codex: { kind: "codex" } },
      roles: { worker: { agent: "codex", skill: "implement" } },
      workflow: { workerTimeoutSeconds: 1800, maxWorkerAttempts: 2 },
    }),
  ).toMatchObject({ version: 1 });
  expect(() =>
    orchestrationConfigSchema.parse({
      version: 2,
      agents: { codex: { kind: "codex" } },
      roles: { worker: { agent: "codex", skill: "implement" } },
      workflow: { workerTimeoutSeconds: 1800, maxWorkerAttempts: 2 },
    }),
  ).toThrow();
  expect(() =>
    orchestrationConfigSchema.parse({
      version: 1,
      agents: { codex: { kind: "claude" } },
      roles: { worker: { agent: "codex", skill: "implement" } },
      workflow: { workerTimeoutSeconds: 1800, maxWorkerAttempts: 2 },
    }),
  ).toThrow();
  expect(() =>
    orchestrationConfigSchema.parse({
      version: 1,
      agents: { codex: { kind: "codex", args: ["--danger"] } },
      roles: { worker: { agent: "codex", skill: "implement" } },
      workflow: { workerTimeoutSeconds: 1800, maxWorkerAttempts: 2 },
    }),
  ).toThrow();
});

test("committed JSON Schemas match their deterministic runtime sources", async () => {
  const generated = generateJsonSchemas();

  await expect(
    readFile(`${projectRoot}/schemas/state-snapshot.schema.json`, "utf8"),
  ).resolves.toBe(`${JSON.stringify(generated.stateSnapshot, null, 2)}\n`);
  await expect(
    readFile(`${projectRoot}/schemas/run-event.schema.json`, "utf8"),
  ).resolves.toBe(`${JSON.stringify(generated.runEvent, null, 2)}\n`);
  await expect(
    readFile(`${projectRoot}/schemas/orchestration-config.schema.json`, "utf8"),
  ).resolves.toBe(
    `${JSON.stringify(generated.orchestrationConfig, null, 2)}\n`,
  );
});
