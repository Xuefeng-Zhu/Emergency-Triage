import { recordingIdSchema } from "@emergency-trial/contracts";
import { db, jobs, recordings } from "@emergency-trial/db";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!recordingIdSchema.safeParse(id).success) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const recording = await db.query.recordings.findFirst({
    where: and(eq(recordings.id, id), eq(recordings.ownerId, session.user.id)),
  });
  if (!recording?.audioPath) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  await db
    .insert(jobs)
    .values({
      idempotencyKey: `finalize:${recording.id}`,
      type: "whisperx_finalize",
      recordingId: recording.id,
      ownerId: session.user.id,
    })
    .onConflictDoUpdate({
      target: jobs.idempotencyKey,
      set: {
        status: "queued",
        attempts: 0,
        availableAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      },
    });
  await db
    .update(recordings)
    .set({ status: "finalizing", updatedAt: new Date() })
    .where(eq(recordings.id, recording.id));
  return Response.json({ queued: true }, { status: 202 });
}
