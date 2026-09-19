import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import {
  generateJsonSchemas,
  orchestrationConfigSchema,
  executionRecordSchema,
  runEventSchema,
  stateSnapshotSchema,
  validationResultSchema,
  workerResultSchema,
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

test("execution and Worker result schemas keep their independent version-one contracts", () => {
  const execution = executionRecordSchema.parse({
    schemaVersion: 1,
    executionId: "exec_1",
    runId: "run_20260904T120000Z_012345abcdef",
    ticketId: "03-ticket",
    attemptId: "attempt-01",
    attempt: 1,
    status: "accepted",
    role: "worker",
    agentProfile: "codex",
    agentKind: "codex",
    skill: "implement",
    ticket: {
      source: "tickets/03-ticket.md",
      input: "/repo/.orchestrator/runs/run/input/ticket.md",
      hash: "a".repeat(64),
    },
    specification: "/repo/.orchestrator/runs/run/input/package/spec.md",
    worktree: "/repo/.worktrees/feature",
    artifacts: {
      directory: "/repo/.orchestrator/runs/run/workers/03-ticket/attempt-01",
      input: "/repo/.orchestrator/runs/run/input/ticket.md",
      record: "/repo/.orchestrator/runs/run/execution.json",
      output: "/repo/.orchestrator/runs/run/output/result.json",
    },
    promptHash: "b".repeat(64),
    timestamps: { preparedAt: timestamp },
    futureExecutionField: true,
  });
  const result = workerResultSchema.parse({
    schemaVersion: 1,
    ticketId: "03-ticket",
    status: "completed",
    summary: "done",
    commit: "c".repeat(40),
    commands: [{ command: "test", status: "passed" }],
    futureResultField: "kept",
  });

  expect(execution.futureExecutionField).toBe(true);
  expect(execution.specification).toBe(
    "/repo/.orchestrator/runs/run/input/package/spec.md",
  );
  expect(result.futureResultField).toBe("kept");
  expect(() =>
    workerResultSchema.parse({ ...result, schemaVersion: 2 }),
  ).toThrow();
  expect(
    workerResultSchema.parse({
      schemaVersion: 1,
      ticketId: "03-ticket",
      status: "blocked",
      summary: "A decision is required.",
      blocker: {
        type: "product",
        summary: "The requirement is ambiguous.",
        requiredDecision: "Choose the supported behavior.",
      },
      filesChanged: [],
      notesForNextTask: ["Keep the decision explicit."],
    }),
  ).toMatchObject({
    blocker: { requiredDecision: "Choose the supported behavior." },
  });
  expect(() =>
    workerResultSchema.parse({
      schemaVersion: 1,
      ticketId: "03-ticket",
      status: "blocked",
      summary: "A decision is required.",
      blocker: { type: "product" },
    }),
  ).toThrow();
});

test("completed Worker results support clean and unresolved review outcomes", () => {
  const commit = "c".repeat(40);
  const clean = workerResultSchema.parse({
    schemaVersion: 1,
    ticketId: "03-ticket",
    status: "completed",
    summary: "done",
    commit,
    commands: [],
    review: { status: "clean", findings: [] },
  });
  expect(clean).toMatchObject({ review: { status: "clean", findings: [] } });

  const attention = workerResultSchema.parse({
    schemaVersion: 1,
    ticketId: "03-ticket",
    status: "completed",
    summary: "implemented, but a decision is required",
    commit,
    commands: [],
    review: {
      status: "attention",
      findings: [
        {
          axis: "standards",
          summary: "The public helper duplicates an existing boundary.",
          evidence: "src/helper.ts:12",
          requiredDecision: "Choose whether to reuse the existing boundary.",
        },
        {
          axis: "spec",
          summary:
            "The specification does not define the empty-state behavior.",
          requiredDecision: "Choose the empty-state behavior for this ticket.",
        },
      ],
    },
  });
  expect(attention).toMatchObject({
    review: {
      status: "attention",
      findings: [{ axis: "standards" }, { axis: "spec" }],
    },
  });

  // Existing completed results remain valid without review data.
  expect(
    workerResultSchema.parse({
      schemaVersion: 1,
      ticketId: "03-ticket",
      status: "completed",
      summary: "legacy result",
      commit,
      commands: [],
    }),
  ).not.toHaveProperty("review");

  expect(() =>
    workerResultSchema.parse({
      schemaVersion: 1,
      ticketId: "03-ticket",
      status: "completed",
      summary: "missing decision",
      commit,
      commands: [],
      review: {
        status: "attention",
        findings: [{ axis: "standards", summary: "Needs a decision." }],
      },
    }),
  ).toThrow();
  expect(() =>
    workerResultSchema.parse({
      schemaVersion: 1,
      ticketId: "03-ticket",
      status: "completed",
      summary: "invalid review",
      commit,
      commands: [],
      review: { status: "clean", findings: [{ axis: "spec" }] },
    }),
  ).toThrow();
  expect(() =>
    workerResultSchema.parse({
      schemaVersion: 1,
      ticketId: "03-ticket",
      status: "completed",
      summary: "invalid axis",
      commit,
      commands: [],
      review: {
        status: "attention",
        findings: [
          {
            axis: "security",
            summary: "Needs a decision.",
            requiredDecision: "Choose.",
          },
        ],
      },
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

test("orchestration configuration supports minimal native Agent profiles", () => {
  const config = orchestrationConfigSchema.parse({
    version: 1,
    agents: {
      codex: { kind: "codex" },
      claude: { kind: "claude-code" },
      "pi-openai": {
        kind: "pi",
        provider: "openai",
        model: "gpt-5.6-luna",
      },
    },
    roles: { worker: { agent: "pi-openai", skill: "implement" } },
    workflow: { workerTimeoutSeconds: 1800, maxWorkerAttempts: 2 },
  });

  expect(config.agents).toEqual({
    codex: { kind: "codex" },
    claude: { kind: "claude-code" },
    "pi-openai": {
      kind: "pi",
      provider: "openai",
      model: "gpt-5.6-luna",
    },
  });
});

test("orchestration configuration rejects invalid Agent profile overrides", () => {
  const base = {
    version: 1,
    agents: { pi: { kind: "pi" } },
    roles: { worker: { agent: "pi", skill: "implement" } },
    workflow: { workerTimeoutSeconds: 1800, maxWorkerAttempts: 2 },
  };

  for (const profile of [
    { kind: "pi", provider: "" },
    { kind: "pi", model: "model\nwith-newline" },
    { kind: "pi", model: "--unsafe" },
    { kind: "pi", provider: " openai" },
    { kind: "pi", model: "gpt-5", unsupported: true },
    { kind: "unknown" },
  ]) {
    expect(() =>
      orchestrationConfigSchema.parse({
        ...base,
        agents: { pi: profile },
      }),
    ).toThrow();
  }
});

test("orchestration configuration validates the optional five-check contract", () => {
  const base = {
    version: 1,
    agents: { codex: { kind: "codex" } },
    roles: { worker: { agent: "codex", skill: "implement" } },
    workflow: { workerTimeoutSeconds: 1800, maxWorkerAttempts: 2 },
  };

  // Existing Phase 0–5 configurations remain valid without a validation block.
  expect(orchestrationConfigSchema.parse(base)).toMatchObject({ version: 1 });
  expect(
    orchestrationConfigSchema.parse({
      ...base,
      workflow: {
        ...base.workflow,
        validation: {
          test: "pnpm test",
          lint: "pnpm lint",
          typecheck: "pnpm typecheck",
          formatCheck: "pnpm format:check",
          build: "pnpm build",
          timeoutSeconds: 900,
        },
      },
    }),
  ).toMatchObject({
    workflow: {
      validation: { timeoutSeconds: 900 },
    },
  });
  // Check names define the five gates; projects may intentionally reuse one command.
  expect(
    orchestrationConfigSchema.parse({
      ...base,
      workflow: {
        ...base.workflow,
        validation: {
          test: "project-check",
          lint: "project-check",
          typecheck: "project-check",
          formatCheck: "project-check",
          build: "project-check",
          timeoutSeconds: 900,
        },
      },
    }),
  ).toMatchObject({ workflow: { validation: { test: "project-check" } } });
  expect(() =>
    orchestrationConfigSchema.parse({
      ...base,
      workflow: {
        ...base.workflow,
        validation: { test: "pnpm test", timeoutSeconds: 900 },
      },
    }),
  ).toThrow();
  expect(() =>
    orchestrationConfigSchema.parse({
      ...base,
      workflow: {
        ...base.workflow,
        validation: {
          test: "pnpm test",
          lint: "pnpm lint",
          typecheck: "pnpm typecheck",
          formatCheck: "pnpm format:check",
          build: "pnpm build",
          stages: ["extra"],
          timeoutSeconds: 900,
        },
      },
    }),
  ).toThrow();
});

test("state snapshot keeps validation data additive and run-owned", () => {
  const base = {
    schemaVersion: 1,
    runId: "run_20260904T120000Z_012345abcdef",
    revision: 2,
    phase: "completed",
    specification: "specs/feature.md",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  // Existing Phase 0–5 snapshots without validation data remain readable.
  expect(stateSnapshotSchema.parse(base)).toMatchObject({ phase: "completed" });
  const snapshot = stateSnapshotSchema.parse({
    ...base,
    validation: {
      status: "passed",
      validatedHead: "0".repeat(40),
      result: "validation.json",
      at: timestamp,
      futureValidationField: true,
    },
  });
  expect(snapshot.validation?.futureValidationField).toBe(true);
  expect(() =>
    stateSnapshotSchema.parse({
      ...base,
      validation: { status: "passed" },
    }),
  ).toThrow();
});

test("validation result schema fixes the five named checks", () => {
  const check = (
    name:
      "test" | "lint" | "typecheck" | "formatCheck" | "build" | (string & {}),
    status: string,
  ) => ({
    name,
    command: `run-${name}`,
    status,
    exitCode: 0,
    durationMs: 5,
  });
  const base = {
    schemaVersion: 1,
    runId: "run_20260904T120000Z_012345abcdef",
    validatedHead: "0".repeat(40),
    status: "passed",
    startedAt: timestamp,
    finishedAt: timestamp,
    git: { cleanAfterValidation: true },
  };

  expect(
    validationResultSchema.parse({
      ...base,
      checks: [
        check("test", "passed"),
        check("lint", "passed"),
        check("typecheck", "passed"),
        check("formatCheck", "passed"),
        check("build", "passed"),
      ],
    }),
  ).toMatchObject({ status: "passed" });
  expect(() =>
    validationResultSchema.parse({
      ...base,
      checks: [
        check("lint", "passed"),
        check("test", "passed"),
        check("typecheck", "passed"),
        check("formatCheck", "passed"),
        check("build", "passed"),
      ],
    }),
  ).toThrow();
  expect(() =>
    validationResultSchema.parse({
      ...base,
      checks: [
        check("test", "passed"),
        check("lint", "passed"),
        check("typecheck", "passed"),
        check("formatCheck", "passed"),
      ],
    }),
  ).toThrow();
  expect(() =>
    validationResultSchema.parse({
      ...base,
      checks: [
        check("test", "passed"),
        check("lint", "passed"),
        check("typecheck", "passed"),
        check("formatCheck", "passed"),
        check("build", "passed"),
        check("review", "passed"),
      ],
    }),
  ).toThrow();
  const parsed = validationResultSchema.parse({
    ...base,
    checks: [
      { ...check("test", "timed_out"), exitCode: null, stdout: "partial" },
      { ...check("lint", "passed"), stderr: "warning" },
      check("typecheck", "passed"),
      check("formatCheck", "passed"),
      check("build", "passed"),
    ],
  });
  expect(parsed.checks[0]).toMatchObject({
    name: "test",
    status: "timed_out",
    exitCode: null,
    stdout: "partial",
  });
  expect(parsed.checks[1]).toMatchObject({ name: "lint", stderr: "warning" });
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
  await expect(
    readFile(`${projectRoot}/schemas/execution-record.schema.json`, "utf8"),
  ).resolves.toBe(`${JSON.stringify(generated.executionRecord, null, 2)}\n`);
  await expect(
    readFile(`${projectRoot}/schemas/worker-result.schema.json`, "utf8"),
  ).resolves.toBe(`${JSON.stringify(generated.workerResult, null, 2)}\n`);
});
