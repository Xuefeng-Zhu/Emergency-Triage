import type { Proposal, Session } from "./types";

const API = import.meta.env.VITE_API_BASE ?? "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function createSession(): Promise<Session> {
  const created = await request<{ session_id: string }>("/session", {
    method: "POST",
  });
  return getSession(created.session_id);
}

export function getSession(sessionId: string): Promise<Session> {
  return request(`/session/${sessionId}`);
}

// TRIAGE_STT_MODE=echo decodes the uploaded bytes as UTF-8 text instead of
// transcribing audio — lets us drive the full pipeline with typed text and
// no microphone. Real MediaRecorder capture can replace this blob later
// without touching any other call site.
export async function sendUtterance(
  sessionId: string,
  text: string,
  speaker: "nurse" | "patient",
): Promise<Session> {
  const form = new FormData();
  form.append("audio", new Blob([text], { type: "text/plain" }), "utterance.txt");
  form.append("speaker", speaker);
  await request(`/session/${sessionId}/utterance`, {
    method: "POST",
    body: form,
  });
  return getSession(sessionId);
}

export function requestConsult(
  sessionId: string,
): Promise<{ consult_id: string; proposals: Proposal[] }> {
  return request(`/session/${sessionId}/consult`, { method: "POST" });
}

export function decideProposal(
  proposalId: string,
  decision: "approve" | "deny",
  approver: { id: string; name: string },
): Promise<{ status: string; order_ref?: string }> {
  return request(`/proposal/${proposalId}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      decision,
      approver_id: approver.id,
      approver_name: approver.name,
    }),
  });
}
