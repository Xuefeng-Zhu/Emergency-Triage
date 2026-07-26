import { afterEach, describe, expect, it, vi } from "vitest";

import { createSession, transcribeWithWhisperX } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API client", () => {
  it("creates a session and fetches its initial state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ session_id: "session_demo" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            session_id: "session_demo",
            started_at: "2026-01-01T00:00:00Z",
            transcript: [],
            suggestions: { pathway_node: "intake", questions: [] },
            proposals: [],
            audit: [],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const session = await createSession();

    expect(session.session_id).toBe("session_demo");
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/session", {
      method: "POST",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/session/session_demo",
      undefined,
    );
  });

  it("uploads an audio sample to the direct WhisperX endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          text: "The patient reports chest pain.",
          duration_ms: 1800,
          processing_ms: 420,
          model: "large-v3-turbo",
          device: "cuda",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeWithWhisperX(
      new Blob(["speech"], { type: "audio/wav" }),
      "sample.wav",
    );

    expect(result.model).toBe("large-v3-turbo");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/whisperx/transcribe",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
  });
});
