import { db } from "@emergency-trial/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET() {
  const checks: Record<string, string> = {
    database: "unavailable",
    queue: "unavailable",
    realtimeAsr: "unavailable",
    whisperxWorker: "unavailable",
    nemoclaw: "unavailable",
  };
  try {
    await db.execute(sql`select 1 as ready`);
    checks.database = "ok";
    const queue = await db.execute<{ queued: number }>(sql`
      select count(*)::int as queued
      from jobs
      where status in ('queued', 'leased', 'running')
    `);
    checks.queue = `ok:${queue.rows[0]?.queued ?? 0}_active`;
    const heartbeats = await db.execute<{
      service: string;
      fresh: boolean;
    }>(sql`
      select service, updated_at > now() - interval '30 seconds' as fresh
      from service_heartbeats
      where service in ('whisperx', 'nemoclaw-agent')
    `);
    const byService = new Map(
      heartbeats.rows.map((heartbeat) => [
        heartbeat.service,
        heartbeat.fresh ? "ok" : "stale",
      ]),
    );
    checks.whisperxWorker = byService.get("whisperx") ?? "missing";
    checks.nemoclaw = byService.get("nemoclaw-agent") ?? "missing";

    try {
      const response = await fetch(
        process.env.REALTIME_HEALTH_URL ?? "http://realtime:3001/health/ready",
        { cache: "no-store", signal: AbortSignal.timeout(2_000) },
      );
      checks.realtimeAsr = response.ok ? "ok" : "degraded";
    } catch {
      checks.realtimeAsr = "unavailable";
    }

    const ready = Object.values(checks).every((check) => check.startsWith("ok"));
    return Response.json({
      status: ready ? "ready" : "not_ready",
      checks,
      timestamp: new Date().toISOString(),
    }, { status: ready ? 200 : 503 });
  } catch {
    return Response.json(
      {
        status: "not_ready",
        checks,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
