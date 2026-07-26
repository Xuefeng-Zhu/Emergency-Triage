import { describe, expect, it } from "vitest";
import {
  chunkTranscript,
  validateCustomMarkdown,
  validateMeetingBrief,
} from "../src/analysis";

describe("agent analysis boundary", () => {
  it("preserves timestamps while chunking long transcripts", () => {
    const chunks = chunkTranscript(
      [
        { startMs: 0, endMs: 500, text: "a".repeat(700), words: [] },
        { startMs: 1_000, endMs: 1_500, text: "b".repeat(700), words: [] },
      ],
      1_000,
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.text).toContain("[00:00:01]");
  });

  it("rejects custom output without timestamp evidence", () => {
    expect(() => validateCustomMarkdown("A claim without evidence")).toThrow(
      "[HH:MM:SS]",
    );
  });

  it("validates the structured brief contract", () => {
    expect(
      validateMeetingBrief(
        JSON.stringify({
          summary: "Summary",
          keyPoints: [],
          decisions: [],
          actionItems: [],
          risks: [],
          notableQuotes: [],
        }),
      ).summary,
    ).toBe("Summary");
  });
});
