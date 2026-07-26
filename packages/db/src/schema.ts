import type {
  AnalysisKind,
  JobStatus,
  JobType,
  RecordingStatus,
  TranscriptSegment,
} from "@emergency-trial/contracts";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const recordingStatusEnum = pgEnum("recording_status", [
  "recording",
  "interrupted",
  "finalizing",
  "ready",
  "failed",
  "audio_expired",
]);
export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "leased",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export const jobTypeEnum = pgEnum("job_type", [
  "whisperx_finalize",
  "analysis_meeting_brief",
  "analysis_custom",
]);
export const analysisKindEnum = pgEnum("analysis_kind", [
  "meeting_brief",
  "custom",
]);
export const transcriptKindEnum = pgEnum("transcript_kind", [
  "provisional",
  "final",
]);
export const invitationRoleEnum = pgEnum("invitation_role", ["user", "admin"]);

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    role: text("role").default("user").notNull(),
    banned: boolean("banned").default(false),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true }),
    mustChangePassword: boolean("must_change_password")
      .default(false)
      .notNull(),
    ...timestamps,
  },
  (table) => [index("user_role_idx").on(table.role)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
    ...timestamps,
  },
  (table) => [index("session_user_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (table) => [
    index("account_user_idx").on(table.userId),
    uniqueIndex("account_provider_account_idx").on(
      table.providerId,
      table.accountId,
    ),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: invitationRoleEnum("role").default("user").notNull(),
    invitedById: text("invited_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("invitations_email_idx").on(table.email),
    index("invitations_expiry_idx").on(table.expiresAt),
  ],
);

export const recordings = pgTable(
  "recordings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: recordingStatusEnum("status")
      .$type<RecordingStatus>()
      .default("recording")
      .notNull(),
    audioPath: text("audio_path"),
    audioSha256: text("audio_sha256"),
    audioBytes: integer("audio_bytes"),
    durationMs: integer("duration_ms"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    audioPurgedAt: timestamp("audio_purged_at", { withTimezone: true }),
    recordingStartedAt: timestamp("recording_started_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    recordingStoppedAt: timestamp("recording_stopped_at", {
      withTimezone: true,
    }),
    ...timestamps,
  },
  (table) => [
    index("recordings_owner_created_idx").on(table.ownerId, table.createdAt),
    index("recordings_status_idx").on(table.status),
    index("recordings_expiry_idx").on(table.expiresAt),
  ],
);

export const recordingChunks = pgTable(
  "recording_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    path: text("path").notNull(),
    sha256: text("sha256").notNull(),
    bytes: integer("bytes").notNull(),
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("recording_chunks_sequence_idx").on(
      table.recordingId,
      table.sequence,
    ),
  ],
);

export const transcripts = pgTable(
  "transcripts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    kind: transcriptKindEnum("kind").notNull(),
    language: text("language"),
    model: text("model"),
    text: text("text").notNull(),
    segments: jsonb("segments")
      .$type<TranscriptSegment[]>()
      .default([])
      .notNull(),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("transcripts_recording_kind_idx").on(
      table.recordingId,
      table.kind,
    ),
  ],
);

export const analyses = pgTable(
  "analyses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: analysisKindEnum("kind").$type<AnalysisKind>().notNull(),
    prompt: text("prompt"),
    status: jobStatusEnum("status")
      .$type<JobStatus>()
      .default("queued")
      .notNull(),
    markdown: text("markdown"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    model: text("model"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    ...timestamps,
  },
  (table) => [
    index("analyses_recording_idx").on(table.recordingId, table.createdAt),
    index("analyses_owner_idx").on(table.ownerId),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    type: jobTypeEnum("type").$type<JobType>().notNull(),
    status: jobStatusEnum("status")
      .$type<JobStatus>()
      .default("queued")
      .notNull(),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    analysisId: uuid("analysis_id").references(() => analyses.id, {
      onDelete: "cascade",
    }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("jobs_claim_idx").on(table.type, table.status, table.availableAt),
    index("jobs_recording_idx").on(table.recordingId),
  ],
);

export const serviceHeartbeats = pgTable("service_heartbeats", {
  service: text("service").primaryKey(),
  workerId: text("worker_id").notNull(),
  status: text("status").default("ok").notNull(),
  details: jsonb("details")
    .$type<Record<string, unknown>>()
    .default({})
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id").references(() => user.id, {
      onDelete: "set null",
    }),
    recordingId: uuid("recording_id").references(() => recordings.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    details: jsonb("details")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_events_recording_idx").on(
      table.recordingId,
      table.createdAt,
    ),
  ],
);
