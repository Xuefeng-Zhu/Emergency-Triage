import { analyses, db, recordings, transcripts } from "@emergency-trial/db";
import { and, desc, eq } from "drizzle-orm";
import { requireSession } from "@/lib/session";
import { WorkspaceShell } from "../workspace-shell";

export default async function WorkspacePage() {
  const session = await requireSession();
  const recording = await db.query.recordings.findFirst({
    where: eq(recordings.ownerId, session.user.id),
    orderBy: [desc(recordings.createdAt)],
  });

  const [transcript, recordingAnalyses] = recording
    ? await Promise.all([
        db.query.transcripts.findFirst({
          where: and(
            eq(transcripts.recordingId, recording.id),
            eq(transcripts.kind, "final"),
          ),
        }),
        db.query.analyses.findMany({
          where: eq(analyses.recordingId, recording.id),
          orderBy: [desc(analyses.createdAt)],
          limit: 10,
        }),
      ])
    : [undefined, []];

  return (
    <WorkspaceShell
      user={{
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: (session.user as { role?: string }).role ?? "user",
      }}
      initialRecording={
        recording
          ? {
              id: recording.id,
              title: recording.title,
              status: recording.status,
              durationMs: recording.durationMs ?? 0,
              segments: transcript?.segments ?? [],
              analyses: recordingAnalyses.map((analysis) => ({
                id: analysis.id,
                kind: analysis.kind,
                status: analysis.status,
                markdown: analysis.markdown,
                result: analysis.result,
              })),
            }
          : null
      }
    />
  );
}
