import { describe, expect, it } from "vitest";
import { parseLiveAsrMessage } from "../src/live-asr";

describe("WhisperLiveKit message adapter", () => {
  it("normalizes native partial messages", () => {
    expect(
      parseLiveAsrMessage(
        JSON.stringify({ text: "hello world", final: false, start: 1.2 }),
        2_000,
      ),
    ).toMatchObject({
      text: "hello world",
      committed: false,
      startMs: 1_200,
      endMs: 2_000,
    });
  });

  it("normalizes Deepgram-compatible committed messages", () => {
    expect(
      parseLiveAsrMessage(
        JSON.stringify({
          is_final: true,
          channel: { alternatives: [{ transcript: "committed text" }] },
        }),
        4_000,
      ),
    ).toMatchObject({
      text: "committed text",
      committed: true,
    });
  });

  it("ignores malformed and empty messages", () => {
    expect(parseLiveAsrMessage("not-json", 1_000)).toBeNull();
    expect(parseLiveAsrMessage(JSON.stringify({ text: "" }), 1_000)).toBeNull();
  });
});
