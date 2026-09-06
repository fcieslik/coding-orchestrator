import * as z from "zod";

const RUN_ID_PATTERN =
  /^run_(\d{4})(?:(0[13578]|1[02])(0[1-9]|[12]\d|3[01])|(0[469]|11)(0[1-9]|[12]\d|30)|(02)(0[1-9]|1\d|2[0-9]))T([01]\d|2[0-3])([0-5]\d)([0-5]\d)Z_[0-9a-f]{12}$/;

function hasValidRunTimestamp(runId: string): boolean {
  const match = RUN_ID_PATTERN.exec(runId);
  if (!match) return false;
  const [
    ,
    year,
    longMonth,
    longDay,
    shortMonth,
    shortDay,
    february,
    februaryDay,
    hour,
    minute,
    second,
  ] = match;
  const month = longMonth ?? shortMonth ?? february;
  const day = longDay ?? shortDay ?? februaryDay;
  const timestamp = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  try {
    return new Date(timestamp).toISOString() === timestamp;
  } catch {
    return false;
  }
}

export const runIdSchema = z
  .string()
  .regex(RUN_ID_PATTERN)
  .refine(hasValidRunTimestamp, "Run ID contains an invalid UTC timestamp");

export const runPhaseSchema = z.enum([
  "created",
  "preparing",
  "implementing",
  "reviewing",
  "checking",
  "fixing",
  "blocked",
  "failed",
  "cancelled",
  "completed",
]);

export type RunPhase = z.infer<typeof runPhaseSchema>;

const utcTimestampSchema = z.iso.datetime({ precision: 3 });

const objectIdSchema = z.string().regex(/^[0-9a-f]{40,64}$/);

export const gitWorktreeStatusSchema = z.enum(["planned", "ready", "removed"]);

const agentProfileSchema = z.strictObject({
  kind: z.literal("codex"),
});

const agentProfilesSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/), agentProfileSchema)
  .refine((profiles) => Object.keys(profiles).length > 0, {
    message: "at least one Agent profile is required",
  });

const workerRoleSchema = z.strictObject({
  agent: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  skill: z.literal("implement"),
});

const rolesSchema = z
  .strictObject({
    worker: workerRoleSchema,
  })
  .catchall(z.never());

const workflowConfigSchema = z.strictObject({
  workerTimeoutSeconds: z.int().min(60).max(7_200),
  maxWorkerAttempts: z.int().min(1).max(10),
});

export const orchestrationConfigSchema = z
  .strictObject({
    version: z.literal(1),
    agents: agentProfilesSchema,
    roles: rolesSchema,
    workflow: workflowConfigSchema,
  })
  .superRefine((config, context) => {
    const profile = config.agents[config.roles.worker.agent];
    if (!profile) {
      context.addIssue({
        code: "custom",
        path: ["roles", "worker", "agent"],
        message: `Agent profile does not exist: ${config.roles.worker.agent}`,
      });
    }
  });

export type OrchestrationConfig = z.infer<typeof orchestrationConfigSchema>;

export const gitStateSchema = z.looseObject({
  schemaVersion: z.literal(1),
  runBase: objectIdSchema,
  featureBranch: z.string().min(1),
  featureWorktree: z.string().min(1),
  worktreeStatus: gitWorktreeStatusSchema,
  validatedHead: objectIdSchema.optional(),
});

export const stateSnapshotSchema = z.looseObject({
  schemaVersion: z.literal(1),
  runId: runIdSchema,
  revision: z.int().positive(),
  phase: runPhaseSchema,
  specification: z.string().min(1),
  interruptedPhase: runPhaseSchema.optional(),
  fixReturnPhase: z.enum(["reviewing", "checking"]).optional(),
  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema,
  git: gitStateSchema.optional(),
  activeExecution: z
    .looseObject({
      executionId: z.string().min(1),
      ticketId: z.string().min(1),
      attemptId: z.string().min(1),
      path: z.string().min(1),
    })
    .optional(),
  lastExecution: z
    .looseObject({
      executionId: z.string().min(1),
      ticketId: z.string().min(1),
      attemptId: z.string().min(1),
      path: z.string().min(1),
    })
    .optional(),
});

export const runEventSchema = z.looseObject({
  schemaVersion: z.literal(1),
  eventId: z.string().min(1),
  runId: runIdSchema,
  sequence: z.int().positive(),
  stateRevision: z.int().positive(),
  timestamp: utcTimestampSchema,
  type: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/),
  data: z.looseObject({}),
});

const executionStatusSchema = z.enum([
  "prepared",
  "running",
  "reconciling",
  "accepted",
  "blocked",
  "failed",
]);

const executionArtifactSchema = z.looseObject({
  directory: z.string().min(1),
  input: z.string().min(1),
  record: z.string().min(1),
  output: z.string().min(1),
});

const executionTimestampSchema = z.looseObject({
  preparedAt: utcTimestampSchema,
  startedAt: utcTimestampSchema.optional(),
  settledAt: utcTimestampSchema.optional(),
  finalizedAt: utcTimestampSchema.optional(),
});

const executionRetrySchema = z.looseObject({
  previousAttemptId: z.string().min(1),
  previousExecutionId: z.string().min(1).optional(),
  previousInputHash: z.string().regex(/^[0-9a-f]{64}$/),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  refreshed: z.boolean(),
});

const executionCheckpointSchema = z.looseObject({
  previousValidatedHead: z.string().regex(/^[0-9a-f]{40,64}$/),
  acceptedCommit: z.string().regex(/^[0-9a-f]{40,64}$/),
});

export const executionRecordSchema = z.looseObject({
  schemaVersion: z.literal(1),
  executionId: z.string().min(1),
  runId: runIdSchema,
  ticketId: z.string().min(1),
  attemptId: z.string().min(1),
  attempt: z.int().positive(),
  status: executionStatusSchema,
  role: z.literal("worker"),
  agentProfile: z.string().min(1),
  agentKind: z.literal("codex"),
  skill: z.literal("implement"),
  ticket: z.looseObject({
    source: z.string().min(1),
    input: z.string().min(1),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  worktree: z.string().min(1),
  artifacts: executionArtifactSchema,
  promptHash: z.string().regex(/^[0-9a-f]{64}$/),
  promptDelivery: z.enum(["not-started", "unknown", "confirmed"]).optional(),
  retry: executionRetrySchema.optional(),
  checkpoint: executionCheckpointSchema.optional(),
  timestamps: executionTimestampSchema,
  herdr: z
    .looseObject({
      callerPaneId: z.string().min(1),
      paneId: z.string().min(1).optional(),
      agentName: z.string().min(1),
      version: z.string().min(1).optional(),
      lifecycle: z.string().min(1).optional(),
    })
    .optional(),
  cleanup: z
    .looseObject({
      status: z.enum(["not-attempted", "closed", "failed"]),
      error: z.string().min(1).optional(),
    })
    .optional(),
  diagnostics: z
    .looseObject({
      output: z.string().optional(),
      truncated: z.boolean().optional(),
    })
    .optional(),
});

const workerCommandOutcomeSchema = z.looseObject({
  command: z.string().min(1),
  status: z.enum(["passed", "failed", "skipped"]),
  exitCode: z.int().optional(),
  summary: z.string().optional(),
});

const workerResultCommonSchema = z.looseObject({
  schemaVersion: z.literal(1),
  ticketId: z.string().min(1),
  summary: z.string().min(1),
});

export const workerResultSchema = z.discriminatedUnion("status", [
  workerResultCommonSchema.extend({
    status: z.literal("completed"),
    commit: objectIdSchema,
    commands: z.array(workerCommandOutcomeSchema),
  }),
  workerResultCommonSchema.extend({
    status: z.literal("blocked"),
    blocker: z
      .looseObject({
        type: z.string().min(1),
        decision: z.string().min(1).optional(),
        requiredDecision: z.string().min(1).optional(),
        summary: z.string().min(1).optional(),
      })
      .refine(
        (blocker) =>
          blocker.decision !== undefined ||
          blocker.requiredDecision !== undefined,
        { message: "a smallest required decision is required" },
      ),
  }),
  workerResultCommonSchema.extend({
    status: z.literal("failed"),
    diagnostics: z.looseObject({
      message: z.string().min(1),
      command: z.string().optional(),
    }),
  }),
]);

export type StateSnapshot = z.infer<typeof stateSnapshotSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;
export type ExecutionRecord = z.infer<typeof executionRecordSchema>;
export type WorkerResult = z.infer<typeof workerResultSchema>;

function addCalendarAwareRunId(schema: z.core.JSONSchema.BaseSchema): void {
  const document = schema as z.core.JSONSchema.BaseSchema & {
    properties?: Record<string, z.core.JSONSchema.BaseSchema>;
  };
  const runId = document.properties?.runId;
  if (!runId) return;
  document.properties!.runId = {
    anyOf: [
      {
        allOf: [runId, { not: { pattern: String.raw`^run_\d{4}0229T` } }],
      },
      {
        type: "string",
        pattern: String.raw`^run_(?:\d{2}(?:0[48]|[2468][048]|[13579][26])|(?:[02468][048]|[13579][26])00)0229T(?:[01]\d|2[0-3])[0-5]\d[0-5]\dZ_[0-9a-f]{12}$`,
      },
    ],
  };
}

export function generateJsonSchemas() {
  const stateSnapshot = z.toJSONSchema(stateSnapshotSchema, {
    target: "draft-2020-12",
  });
  const runEvent = z.toJSONSchema(runEventSchema, {
    target: "draft-2020-12",
  });
  const orchestrationConfig = z.toJSONSchema(orchestrationConfigSchema, {
    target: "draft-2020-12",
  });
  const executionRecord = z.toJSONSchema(executionRecordSchema, {
    target: "draft-2020-12",
  });
  const workerResult = z.toJSONSchema(workerResultSchema, {
    target: "draft-2020-12",
  });
  addCalendarAwareRunId(stateSnapshot);
  addCalendarAwareRunId(runEvent);
  return {
    stateSnapshot,
    runEvent,
    orchestrationConfig,
    executionRecord,
    workerResult,
  };
}
