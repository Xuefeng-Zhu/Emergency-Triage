import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { recordingIdSchema } from "@emergency-trial/contracts";
import { db, recordings } from "@emergency-trial/db";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export const runtime = "nodejs";

export async function GET(
  request: Request,
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
    columns: { audioPath: true, audioPurgedAt: true },
  });
  if (!recording?.audioPath || recording.audioPurgedAt) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const dataRoot = resolve(
    /* turbopackIgnore: true */
    process.env.DATA_ROOT_CONTAINER ?? process.env.DATA_ROOT ?? "/data",
  );
  const audioPath = resolve(
    /* turbopackIgnore: true */
    recording.audioPath,
  );
  if (!audioPath.startsWith(`${dataRoot}/`) || !audioPath.endsWith(".flac")) {
    return Response.json({ error: "unsafe_audio_path" }, { status: 500 });
  }
  const file = await stat(audioPath).catch(() => null);
  if (!file?.isFile()) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const range = request.headers.get("range");
  const common = {
    "accept-ranges": "bytes",
    "content-type": "audio/flac",
    "cache-control": "private, no-store",
  };
  if (!range) {
    const stream = Readable.toWeb(createReadStream(audioPath));
    return new Response(stream as ReadableStream, {
      headers: { ...common, "content-length": String(file.size) },
    });
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) return new Response(null, { status: 416 });
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), file.size - 1) : file.size - 1;
  if (start > end || start >= file.size) return new Response(null, { status: 416 });
  const stream = Readable.toWeb(createReadStream(audioPath, { start, end }));
  return new Response(stream as ReadableStream, {
    status: 206,
    headers: {
      ...common,
      "content-length": String(end - start + 1),
      "content-range": `bytes ${start}-${end}/${file.size}`,
    },
  });
}
