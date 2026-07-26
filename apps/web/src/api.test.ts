import { afterEach, describe, expect, it, vi } from "vitest";

import { createSession } from "./api";

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
});
