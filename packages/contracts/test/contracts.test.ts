import { describe, expect, it } from "vitest";
import {
  canTransitionRecordingStatus,
  meetingBriefSchema,
  millisecondsToTimestamp,
  realtimeClientMessageSchema,
  safeRecordingRelativePath,
} from "../src/index";

describe("public contracts", () => {
  it("accepts the fixed PCM start message", () => {
    expect(
      realtimeClientMessageSchema.parse({
        type: "start",
        sampleRate: 16_000,
      }),
    ).toEqual({
      type: "start",
      sampleRate: 16_000,
      encoding: "pcm_s16le",
    });
  });

  it("rejects path traversal", () => {
    expect(() =>
      safeRecordingRelativePath(
        "35df9708-7e27-4de9-aa60-69b4a13e8660",
        "99f06759-46d5-4443-a9b8-2266911fe86f",
        "../source.flac",
      ),
    ).toThrow("Unsafe filename");
  });

  it("validates a structured meeting brief", () => {
    const result = meetingBriefSchema.safeParse({
      summary: "The team agreed on a safe rollout.",
      keyPoints: [],
      decisions: [],
      actionItems: [],
      risks: [],
      notableQuotes: [],
    });
    expect(result.success).toBe(true);
  });

  it("formats timestamps consistently", () => {
    expect(millisecondsToTimestamp(1_122_000)).toBe("00:18:42");
  });

  it("enforces terminal and retry recording transitions", () => {
    expect(canTransitionRecordingStatus("recording", "finalizing")).toBe(true);
    expect(canTransitionRecordingStatus("failed", "finalizing")).toBe(true);
    expect(canTransitionRecordingStatus("audio_expired", "recording")).toBe(
      false,
    );
    expect(canTransitionRecordingStatus("ready", "recording")).toBe(false);
  });
});
