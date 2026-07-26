import { createRecordingSchema } from "@emergency-trial/contracts";
import { db, recordings } from "@emergency-trial/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsed = createRecordingSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const retentionDays = Number(process.env.AUDIO_RETENTION_DAYS ?? 30);
  const [recording] = await db
    .insert(recordings)
    .values({
      ownerId: session.user.id,
      title: parsed.data.title,
      status: "recording",
      expiresAt: new Date(Date.now() + retentionDays * 86_400_000),
    })
    .returning({ id: recordings.id, status: recordings.status });

  return Response.json(
    {
      ...recording,
      websocketPath: `${process.env.NEXT_PUBLIC_REALTIME_PATH ?? "/ws"}/recordings/${recording?.id}`,
    },
    { status: 201 },
  );
}
