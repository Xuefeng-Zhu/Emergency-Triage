import type { JobType } from "@emergency-trial/contracts";
import { sql } from "drizzle-orm";
import { db, pool } from "./client";

export const GPU_ADVISORY_LOCK_KEY = 2_147_483_001;

export interface LeasedJob extends Record<string, unknown> {
  id: string;
  idempotencyKey: string;
  type: JobType;
  recordingId: string;
  analysisId: string | null;
  ownerId: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export async function claimJob(
  workerId: string,
  types: JobType[],
  leaseSeconds = 900,
): Promise<LeasedJob | null> {
  if (types.length === 0) return null;
  const result = await db.execute<LeasedJob>(sql`
    with candidate as (
      select id
      from jobs
      where type = any(${types}::job_type[])
        and (
          (status = 'queued' and available_at <= now())
          or (status in ('leased', 'running') and lease_expires_at < now())
        )
        and attempts < max_attempts
      order by available_at asc, created_at asc
      for update skip locked
      limit 1
    )
    update jobs
    set status = 'leased',
        lease_owner = ${workerId},
        lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),
        attempts = attempts + 1,
        updated_at = now()
    where id = (select id from candidate)
    returning
      id,
      idempotency_key as "idempotencyKey",
      type,
      recording_id as "recordingId",
      analysis_id as "analysisId",
      owner_id as "ownerId",
      payload,
      attempts,
      max_attempts as "maxAttempts"
  `);
  return result.rows[0] ?? null;
}

export async function hasActiveRecording(): Promise<boolean> {
  const result = await db.execute<{ active: boolean }>(sql`
    select exists(
      select 1 from recordings where status = 'recording'
    ) as active
  `);
  return result.rows[0]?.active ?? false;
}

export interface GpuLease {
  release(): Promise<void>;
}

export async function acquireGpuLease(): Promise<GpuLease | null> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [GPU_ADVISORY_LOCK_KEY],
    );
    if (!result.rows[0]?.locked) {
      client.release();
      return null;
    }
    let released = false;
    return {
      async release() {
        if (released) return;
        released = true;
        try {
          await client.query("select pg_advisory_unlock($1)", [
            GPU_ADVISORY_LOCK_KEY,
          ]);
        } finally {
          client.release();
        }
      },
    };
  } catch (error) {
    client.release();
    throw error;
  }
}

export async function deferJob(
  jobId: string,
  workerId: string,
  seconds: number,
  reason: string,
): Promise<void> {
  await db.execute(sql`
    update jobs
    set status = 'queued',
        available_at = now() + (${seconds} * interval '1 second'),
        lease_owner = null,
        lease_expires_at = null,
        last_error = ${reason},
        attempts = greatest(attempts - 1, 0),
        updated_at = now()
    where id = ${jobId}::uuid and lease_owner = ${workerId}
  `);
}

export async function startJob(
  jobId: string,
  workerId: string,
): Promise<void> {
  await db.execute(sql`
    update jobs
    set status = 'running', started_at = coalesce(started_at, now()), updated_at = now()
    where id = ${jobId}::uuid and lease_owner = ${workerId}
  `);
}

export async function finishJob(
  jobId: string,
  workerId: string,
): Promise<void> {
  await db.execute(sql`
    update jobs
    set status = 'succeeded',
        finished_at = now(),
        lease_owner = null,
        lease_expires_at = null,
        updated_at = now()
    where id = ${jobId}::uuid and lease_owner = ${workerId}
  `);
}

export async function failJob(
  job: LeasedJob,
  workerId: string,
  error: unknown,
): Promise<void> {
  const message =
    error instanceof Error ? error.message.slice(0, 2_000) : String(error);
  const terminal = job.attempts >= job.maxAttempts;
  await db.execute(sql`
    update jobs
    set status = ${terminal ? "failed" : "queued"}::job_status,
        available_at = case
          when ${terminal} then available_at
          else now() + (least(300, power(2, attempts)::int * 5) * interval '1 second')
        end,
        finished_at = case when ${terminal} then now() else null end,
        lease_owner = null,
        lease_expires_at = null,
        last_error = ${message},
        updated_at = now()
    where id = ${job.id}::uuid and lease_owner = ${workerId}
  `);
}
