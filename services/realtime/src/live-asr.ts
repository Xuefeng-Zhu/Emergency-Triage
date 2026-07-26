export interface CaptionUpdate {
  text: string;
  committed: boolean;
  startMs: number;
  endMs: number;
  speaker?: string | null;
}

export function parseLiveAsrMessage(
  input: string,
  elapsedMs: number,
): CaptionUpdate | null {
  let payload: unknown;
  try {
    payload = JSON.parse(input);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  const textCandidates = [
    data.text,
    data.transcript,
    (data.channel as Record<string, unknown> | undefined)?.alternatives &&
      (
        (
          (data.channel as Record<string, unknown>).alternatives as Array<
            Record<string, unknown>
          >
        )[0] ?? {}
      ).transcript,
  ];
  const text = textCandidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
  if (!text) return null;
  const committed =
    data.is_final === true ||
    data.final === true ||
    data.type === "committed" ||
    data.type === "final";
  const startMs =
    typeof data.start === "number"
      ? Math.max(0, Math.round(data.start * 1_000))
      : Math.max(0, elapsedMs - 2_000);
  const endMs =
    typeof data.end === "number"
      ? Math.max(startMs, Math.round(data.end * 1_000))
      : elapsedMs;
  return {
    text: text.trim(),
    committed,
    startMs,
    endMs,
    speaker: typeof data.speaker === "string" ? data.speaker : null,
  };
}
