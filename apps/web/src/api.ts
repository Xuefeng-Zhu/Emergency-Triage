import type {
  Proposal,
  Session,
  Utterance,
  WhisperXResult,
  WhisperXStatus,
} from "./types";

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

export async function sendUtterance(
  sessionId: string,
  blob: Blob,
  speaker: "nurse" | "patient",
): Promise<Utterance> {
  const form = new FormData();
  form.append("audio", blob, "utterance.webm");
  form.append("speaker", speaker);
  return request(`/session/${sessionId}/utterance`, {
    method: "POST",
    body: form,
  });
}

export function getWhisperXStatus(): Promise<WhisperXStatus> {
  return request("/whisperx/status");
}

export function transcribeWithWhisperX(
  blob: Blob,
  filename = "sample.webm",
): Promise<WhisperXResult> {
  const form = new FormData();
  form.append("audio", blob, filename);
  return request("/whisperx/transcribe", {
    method: "POST",
    body: form,
  });
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
