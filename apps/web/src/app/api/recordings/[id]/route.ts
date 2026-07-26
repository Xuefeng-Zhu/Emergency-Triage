import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  recordingIdSchema,
  safeRecordingRelativePath,
} from "@emergency-trial/contracts";
import { auditEvents, db, recordings } from "@emergency-trial/db";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export const runtime = "nodejs";

async function ownedRecording(id: string, ownerId: string) {
  return db.query.recordings.findFirst({
    where: and(eq(recordings.id, id), eq(recordings.ownerId, ownerId)),
  });
}

function validId(id: string): boolean {
  return recordingIdSchema.safeParse(id).success;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!validId(id)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const recording = await db.query.recordings.findFirst({
    where: and(
      eq(recordings.id, id),
      eq(recordings.ownerId, session.user.id),
    ),
    columns: {
      id: true,
      title: true,
      status: true,
      audioPath: true,
      durationMs: true,
      failureCode: true,
      expiresAt: true,
      audioPurgedAt: true,
      recordingStartedAt: true,
      recordingStoppedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!recording) return Response.json({ error: "not_found" }, { status: 404 });
  const { audioPath, ...publicRecording } = recording;
  return Response.json({
    ...publicRecording,
    audioAvailable: audioPath !== null && recording.audioPurgedAt === null,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!validId(id)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const recording = await ownedRecording(id, session.user.id);
  if (!recording) return Response.json({ error: "not_found" }, { status: 404 });
  if (recording.status === "recording" || recording.status === "finalizing") {
    return Response.json({ error: "recording_busy" }, { status: 409 });
  }

  const dataRoot = resolve(
    /* turbopackIgnore: true */
    process.env.DATA_ROOT_CONTAINER ?? process.env.DATA_ROOT ?? "/data",
  );
  const directory = resolve(
    /* turbopackIgnore: true */
    dirname(
      join(
        /* turbopackIgnore: true */
        dataRoot,
        safeRecordingRelativePath(session.user.id, recording.id, "placeholder"),
      ),
    ),
  );
  if (directory === dataRoot || !directory.startsWith(`${dataRoot}/`)) {
    return Response.json({ error: "unsafe_audio_path" }, { status: 500 });
  }
  await rm(directory, { recursive: true, force: true });
  await db.transaction(async (tx) => {
    await tx.insert(auditEvents).values({
      ownerId: session.user.id,
      recordingId: recording.id,
      action: "recording.deleted",
      details: { recordingId: recording.id },
    });
    await tx
      .delete(recordings)
      .where(and(eq(recordings.id, id), eq(recordings.ownerId, session.user.id)));
  });
  return Response.json({ deleted: true });
}
