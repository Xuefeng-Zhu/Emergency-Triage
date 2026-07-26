import { z } from "zod";

export const recordingStatuses = [
  "recording",
  "interrupted",
  "finalizing",
  "ready",
  "failed",
  "audio_expired",
] as const;
export const recordingStatusSchema = z.enum(recordingStatuses);
export type RecordingStatus = z.infer<typeof recordingStatusSchema>;

const recordingTransitions: Record<
  RecordingStatus,
  readonly RecordingStatus[]
> = {
  recording: ["interrupted", "finalizing", "failed"],
  interrupted: ["recording", "finalizing", "failed"],
  finalizing: ["ready", "failed"],
  ready: ["finalizing", "audio_expired"],
  failed: ["finalizing", "audio_expired"],
  audio_expired: [],
};

export function canTransitionRecordingStatus(
  from: RecordingStatus,
  to: RecordingStatus,
): boolean {
  return from === to || recordingTransitions[from].includes(to);
}

export const jobStatuses = [
  "queued",
  "leased",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export const jobStatusSchema = z.enum(jobStatuses);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const analysisKinds = ["meeting_brief", "custom"] as const;
export const analysisKindSchema = z.enum(analysisKinds);
export type AnalysisKind = z.infer<typeof analysisKindSchema>;

export const jobTypes = [
  "whisperx_finalize",
  "analysis_meeting_brief",
  "analysis_custom",
] as const;
export const jobTypeSchema = z.enum(jobTypes);
export type JobType = z.infer<typeof jobTypeSchema>;

export const transcriptWordSchema = z.object({
  word: z.string(),
  startMs: z.number().int().nonnegative().nullable(),
  endMs: z.number().int().nonnegative().nullable(),
  score: z.number().min(0).max(1).nullable().optional(),
  speaker: z.string().nullable().optional(),
});
export type TranscriptWord = z.infer<typeof transcriptWordSchema>;

export const transcriptSegmentSchema = z.object({
  id: z.string().optional(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
  speaker: z.string().nullable().optional(),
  words: z.array(transcriptWordSchema).default([]),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const timestampedItemSchema = z.object({
  text: z.string().min(1),
  atMs: z.number().int().nonnegative().nullable(),
  speaker: z.string().nullable().optional(),
});

export const actionItemSchema = z.object({
  task: z.string().min(1),
  owner: z.string().nullable(),
  due: z.string().nullable(),
  atMs: z.number().int().nonnegative().nullable(),
});

export const meetingBriefSchema = z.object({
  summary: z.string().min(1),
  keyPoints: z.array(timestampedItemSchema),
  decisions: z.array(timestampedItemSchema),
  actionItems: z.array(actionItemSchema),
  risks: z.array(timestampedItemSchema),
  notableQuotes: z.array(
    z.object({
      text: z.string().min(1),
      startMs: z.number().int().nonnegative(),
      speaker: z.string().nullable(),
    }),
  ),
});
export type MeetingBrief = z.infer<typeof meetingBriefSchema>;

export const realtimeStartSchema = z.object({
  type: z.literal("start"),
  sampleRate: z.literal(16_000),
  encoding: z.literal("pcm_s16le").default("pcm_s16le"),
});
export const realtimeStopSchema = z.object({ type: z.literal("stop") });
export const realtimeResumeSchema = z.object({
  type: z.literal("resume"),
  lastSequence: z.number().int().nonnegative(),
});
export const realtimePingSchema = z.object({
  type: z.literal("ping"),
  sentAt: z.number().int().nonnegative(),
});
export const realtimeClientMessageSchema = z.discriminatedUnion("type", [
  realtimeStartSchema,
  realtimeStopSchema,
  realtimeResumeSchema,
  realtimePingSchema,
]);
export type RealtimeClientMessage = z.infer<
  typeof realtimeClientMessageSchema
>;

const realtimeBaseSchema = z.object({
  recordingId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
});

export const realtimeServerEventSchema = z.discriminatedUnion("type", [
  realtimeBaseSchema.extend({
    type: z.literal("ready"),
    reconnectGraceMs: z.number().int().positive(),
  }),
  realtimeBaseSchema.extend({
    type: z.literal("partial_caption"),
    text: z.string(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
  }),
  realtimeBaseSchema.extend({
    type: z.literal("committed_caption"),
    segment: transcriptSegmentSchema,
  }),
  realtimeBaseSchema.extend({
    type: z.literal("recording_status"),
    status: recordingStatusSchema,
  }),
  realtimeBaseSchema.extend({
    type: z.literal("finalization_queued"),
    jobId: z.string().uuid(),
  }),
  realtimeBaseSchema.extend({
    type: z.literal("pong"),
    sentAt: z.number().int().nonnegative(),
  }),
  realtimeBaseSchema.extend({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
]);
export type RealtimeServerEvent = z.infer<typeof realtimeServerEventSchema>;

export const createRecordingSchema = z.object({
  title: z.string().trim().min(1).max(120).default("Untitled recording"),
});
export const recordingIdSchema = z.string().uuid();

export const createAnalysisSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("meeting_brief") }),
  z.object({
    kind: z.literal("custom"),
    prompt: z.string().trim().min(1).max(4_000),
  }),
]);

export const createInvitationSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  name: z.string().trim().min(2).max(100),
  role: z.enum(["user", "admin"]).default("user"),
});

export const acceptInvitationSchema = z
  .object({
    token: z.string().min(32).max(256),
    password: z.string().min(12).max(128),
    passwordConfirmation: z.string().min(12).max(128),
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ["passwordConfirmation"],
    message: "Passwords do not match",
  });

export function safeRecordingRelativePath(
  ownerId: string,
  recordingId: string,
  filename: string,
): string {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(ownerId)) {
    throw new Error("Unsafe owner id");
  }
  z.string().uuid().parse(recordingId);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(filename)) {
    throw new Error("Unsafe filename");
  }
  return `${ownerId}/${recordingId}/${filename}`;
}

export function millisecondsToTimestamp(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
