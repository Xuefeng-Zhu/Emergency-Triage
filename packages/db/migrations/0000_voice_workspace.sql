CREATE TYPE "public"."recording_status" AS ENUM('recording', 'interrupted', 'finalizing', 'ready', 'failed', 'audio_expired');
CREATE TYPE "public"."job_status" AS ENUM('queued', 'leased', 'running', 'succeeded', 'failed', 'cancelled');
CREATE TYPE "public"."job_type" AS ENUM('whisperx_finalize', 'analysis_meeting_brief', 'analysis_custom');
CREATE TYPE "public"."analysis_kind" AS ENUM('meeting_brief', 'custom');
CREATE TYPE "public"."transcript_kind" AS ENUM('provisional', 'final');
CREATE TYPE "public"."invitation_role" AS ENUM('user', 'admin');

CREATE TABLE "user" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "email_verified" boolean DEFAULT false NOT NULL,
  "image" text,
  "role" text DEFAULT 'user' NOT NULL,
  "banned" boolean DEFAULT false,
  "ban_reason" text,
  "ban_expires" timestamp with time zone,
  "must_change_password" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "user_role_idx" ON "user" ("role");

CREATE TABLE "session" (
  "id" text PRIMARY KEY NOT NULL,
  "token" text NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "impersonated_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "session_user_idx" ON "session" ("user_id");

CREATE TABLE "account" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamp with time zone,
  "refresh_token_expires_at" timestamp with time zone,
  "scope" text,
  "password" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "account_user_idx" ON "account" ("user_id");
CREATE UNIQUE INDEX "account_provider_account_idx" ON "account" ("provider_id", "account_id");

CREATE TABLE "verification" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");

CREATE TABLE "invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "email" text NOT NULL,
  "name" text NOT NULL,
  "role" "invitation_role" DEFAULT 'user' NOT NULL,
  "invited_by_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "invitations_email_idx" ON "invitations" ("email");
CREATE INDEX "invitations_expiry_idx" ON "invitations" ("expires_at");

CREATE TABLE "recordings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "status" "recording_status" DEFAULT 'recording' NOT NULL,
  "audio_path" text,
  "audio_sha256" text,
  "audio_bytes" integer,
  "duration_ms" integer,
  "failure_code" text,
  "failure_message" text,
  "expires_at" timestamp with time zone NOT NULL,
  "audio_purged_at" timestamp with time zone,
  "recording_started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "recording_stopped_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "recordings_owner_created_idx" ON "recordings" ("owner_id", "created_at");
CREATE INDEX "recordings_status_idx" ON "recordings" ("status");
CREATE INDEX "recordings_expiry_idx" ON "recordings" ("expires_at");

CREATE TABLE "recording_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recording_id" uuid NOT NULL REFERENCES "recordings"("id") ON DELETE CASCADE,
  "sequence" integer NOT NULL,
  "path" text NOT NULL,
  "sha256" text NOT NULL,
  "bytes" integer NOT NULL,
  "duration_ms" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "recording_chunks_sequence_idx" ON "recording_chunks" ("recording_id", "sequence");

CREATE TABLE "transcripts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recording_id" uuid NOT NULL REFERENCES "recordings"("id") ON DELETE CASCADE,
  "kind" "transcript_kind" NOT NULL,
  "language" text,
  "model" text,
  "text" text NOT NULL,
  "segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "transcripts_recording_kind_idx" ON "transcripts" ("recording_id", "kind");

CREATE TABLE "analyses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recording_id" uuid NOT NULL REFERENCES "recordings"("id") ON DELETE CASCADE,
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "kind" "analysis_kind" NOT NULL,
  "prompt" text,
  "status" "job_status" DEFAULT 'queued' NOT NULL,
  "markdown" text,
  "result" jsonb,
  "model" text,
  "failure_code" text,
  "failure_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "analyses_recording_idx" ON "analyses" ("recording_id", "created_at");
CREATE INDEX "analyses_owner_idx" ON "analyses" ("owner_id");

CREATE TABLE "jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "idempotency_key" text NOT NULL UNIQUE,
  "type" "job_type" NOT NULL,
  "status" "job_status" DEFAULT 'queued' NOT NULL,
  "recording_id" uuid NOT NULL REFERENCES "recordings"("id") ON DELETE CASCADE,
  "analysis_id" uuid REFERENCES "analyses"("id") ON DELETE CASCADE,
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_owner" text,
  "lease_expires_at" timestamp with time zone,
  "last_error" text,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_heartbeats" (
	"service" text PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "recording_id" uuid REFERENCES "recordings"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "audit_events_recording_idx" ON "audit_events" ("recording_id", "created_at");
CREATE INDEX "jobs_claim_idx" ON "jobs" ("type", "status", "available_at");
CREATE INDEX "jobs_recording_idx" ON "jobs" ("recording_id");
