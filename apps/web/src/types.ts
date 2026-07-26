export type ProposalStatus =
  | "proposed"
  | "approved"
  | "submitted"
  | "denied"
  | "refused";

export interface Utterance {
  utterance_id: string;
  text: string;
  speaker: "nurse" | "patient";
  created_at: string;
  duration_ms: number;
}

export interface WhisperXStatus {
  model: string;
  device: string;
  compute_type: string;
  language: string;
  loaded: boolean;
}

export interface WhisperXResult {
  text: string;
  duration_ms: number;
  processing_ms: number;
  model: string;
  device: string;
}

export interface Question {
  id: string;
  text: string;
  rationale: string;
}

export interface Proposal {
  proposal_id: string;
  test_code: string;
  label: string;
  rationale: string;
  citation: string;
  status: ProposalStatus;
  policy_reason?: string | null;
}

export interface AuditEntry {
  audit_id: string;
  ts: string;
  actor: string;
  action: string;
  proposal_id?: string | null;
  outcome: string;
}

export interface Session {
  session_id: string;
  started_at: string;
  transcript: Utterance[];
  suggestions: {
    pathway_node: string;
    questions: Question[];
  };
  proposals: Proposal[];
  audit: AuditEntry[];
}
