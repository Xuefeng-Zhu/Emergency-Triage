import { recordingIdSchema } from "@emergency-trial/contracts";
import { db, recordings } from "@emergency-trial/db";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const serviceToken = request.headers.get("x-internal-service-token");
  if (
    !process.env.INTERNAL_SERVICE_TOKEN ||
    serviceToken !== process.env.INTERNAL_SERVICE_TOKEN
  ) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsedRecordingId = recordingIdSchema.safeParse(
    new URL(request.url).searchParams.get("recordingId"),
  );
  if (!parsedRecordingId.success) {
    return Response.json({ error: "recording_id_required" }, { status: 400 });
  }
  const recordingId = parsedRecordingId.data;
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const recording = await db.query.recordings.findFirst({
    where: and(
      eq(recordings.id, recordingId),
      eq(recordings.ownerId, session.user.id),
      eq(recordings.status, "recording"),
    ),
    columns: { id: true, ownerId: true },
  });
  if (!recording) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({
    authorized: true,
    userId: session.user.id,
    recordingId: recording.id,
  });
}
