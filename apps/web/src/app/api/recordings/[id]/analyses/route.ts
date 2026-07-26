import {
  createAnalysisSchema,
  recordingIdSchema,
} from "@emergency-trial/contracts";
import { analyses, db, jobs, recordings } from "@emergency-trial/db";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export const runtime = "nodejs";

export async function GET(
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
    where: and(
      eq(recordings.id, id),
      eq(recordings.ownerId, session.user.id),
    ),
    columns: { id: true },
  });
  if (!recording) return Response.json({ error: "not_found" }, { status: 404 });
  const rows = await db.query.analyses.findMany({
    where: and(
      eq(analyses.recordingId, recording.id),
      eq(analyses.ownerId, session.user.id),
    ),
    orderBy: [desc(analyses.createdAt)],
    limit: 50,
    columns: {
      id: true,
      kind: true,
      status: true,
      prompt: true,
      markdown: true,
      result: true,
      model: true,
      failureCode: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return Response.json({ analyses: rows });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsed = createAnalysisSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const { id } = await params;
  if (!recordingIdSchema.safeParse(id).success) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const recording = await db.query.recordings.findFirst({
    where: and(
      eq(recordings.id, id),
      eq(recordings.ownerId, session.user.id),
      eq(recordings.status, "ready"),
    ),
  });
  if (!recording) return Response.json({ error: "not_found" }, { status: 404 });

  const created = await db.transaction(async (tx) => {
    const [analysis] = await tx
      .insert(analyses)
      .values({
        recordingId: recording.id,
        ownerId: session.user.id,
        kind: parsed.data.kind,
        prompt: parsed.data.kind === "custom" ? parsed.data.prompt : null,
      })
      .returning();
    if (!analysis) throw new Error("Could not create analysis");
    const [job] = await tx
      .insert(jobs)
      .values({
        idempotencyKey: `analysis:${analysis.id}`,
        type:
          parsed.data.kind === "custom"
            ? "analysis_custom"
            : "analysis_meeting_brief",
        recordingId: recording.id,
        analysisId: analysis.id,
        ownerId: session.user.id,
      })
      .returning({ id: jobs.id });
    return { analysis, job };
  });

  return Response.json(created, { status: 202 });
}
