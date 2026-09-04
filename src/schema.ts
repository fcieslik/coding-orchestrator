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

export type StateSnapshot = z.infer<typeof stateSnapshotSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;

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
  addCalendarAwareRunId(stateSnapshot);
  addCalendarAwareRunId(runEvent);
  return {
    stateSnapshot,
    runEvent,
  };
}
