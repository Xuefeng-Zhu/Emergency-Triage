import {
  meetingBriefSchema,
  millisecondsToTimestamp,
  type MeetingBrief,
  type TranscriptSegment,
} from "@emergency-trial/contracts";

export interface TranscriptChunk {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

export function chunkTranscript(
  segments: TranscriptSegment[],
  maxCharacters = 42_000,
): TranscriptChunk[] {
  if (maxCharacters < 1_000) {
    throw new Error("Chunk size must reserve enough analysis context");
  }

  const chunks: TranscriptChunk[] = [];
  let lines: string[] = [];
  let characters = 0;
  let startMs = 0;
  let endMs = 0;

  const flush = () => {
    if (lines.length === 0) return;
    chunks.push({
      index: chunks.length,
      startMs,
      endMs,
      text: lines.join("\n"),
    });
    lines = [];
    characters = 0;
  };

  for (const segment of segments) {
    const speaker = segment.speaker ? `${segment.speaker}: ` : "";
    const line = `[${millisecondsToTimestamp(segment.startMs)}] ${speaker}${segment.text.trim()}`;
    if (lines.length > 0 && characters + line.length + 1 > maxCharacters) {
      flush();
    }
    if (lines.length === 0) startMs = segment.startMs;
    endMs = segment.endMs;
    lines.push(line);
    characters += line.length + 1;
  }
  flush();
  return chunks;
}

export function parseJsonObject(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Agent returned no JSON object");
  return JSON.parse(candidate.slice(start, end + 1));
}

export function validateMeetingBrief(raw: string): MeetingBrief {
  return meetingBriefSchema.parse(parseJsonObject(raw));
}

export function validateCustomMarkdown(raw: string): string {
  const markdown = raw.trim();
  if (markdown.length < 1 || markdown.length > 100_000) {
    throw new Error("Custom analysis must contain 1 to 100000 characters");
  }
  if (!/\[\d{2}:\d{2}:\d{2}\]/.test(markdown)) {
    throw new Error("Custom analysis must include a [HH:MM:SS] reference");
  }
  return markdown;
}

export function renderMeetingBrief(brief: MeetingBrief): string {
  const at = (milliseconds: number | null) =>
    milliseconds === null ? "" : ` [${millisecondsToTimestamp(milliseconds)}]`;
  const timestamped = (
    items: Array<{
      text: string;
      atMs: number | null;
      speaker?: string | null | undefined;
    }>,
  ) =>
    items.length === 0
      ? "- None identified"
      : items
          .map(
            (item) =>
              `- ${item.text}${item.speaker ? ` — ${item.speaker}` : ""}${at(item.atMs)}`,
          )
          .join("\n");

  return [
    "# Meeting brief",
    "",
    "## Summary",
    "",
    brief.summary,
    "",
    "## Key points",
    "",
    timestamped(brief.keyPoints),
    "",
    "## Decisions",
    "",
    timestamped(brief.decisions),
    "",
    "## Action items",
    "",
    brief.actionItems.length === 0
      ? "- None identified"
      : brief.actionItems
          .map(
            (item) =>
              `- ${item.task}${item.owner ? ` — ${item.owner}` : ""}${item.due ? ` (due ${item.due})` : ""}${at(item.atMs)}`,
          )
          .join("\n"),
    "",
    "## Risks",
    "",
    timestamped(brief.risks),
    "",
    "## Notable quotes",
    "",
    brief.notableQuotes.length === 0
      ? "- None identified"
      : brief.notableQuotes
          .map(
            (quote) =>
              `- “${quote.text}”${quote.speaker ? ` — ${quote.speaker}` : ""} [${millisecondsToTimestamp(quote.startMs)}]`,
          )
          .join("\n"),
  ].join("\n");
}
