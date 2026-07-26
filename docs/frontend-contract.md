# Frontend Contract — Message & Payload Shapes

> Companion to [`er-triage-agent-scope.md`](./er-triage-agent-scope.md) (frozen architecture,
> §6 "the frozen seam") and [`nextjs-voice-agent-boilerplate-plan.md`](./nextjs-voice-agent-boilerplate-plan.md)
> (typed event / shared-schema conventions this contract borrows the *style* of).
>
> This file is the single source of truth for Lane A ↔ Lane B wire shapes. If you change a
> shape here, both lanes update in the same commit. Stub every payload below behind the
> real endpoints in hour one — that stubbing is the point of freezing this doc.

## 0. Conventions

- Shapes are given as TypeScript types. Lane A consumes them as-is; Lane B's FastAPI models
  should serialize to exactly this JSON shape (field names, casing, optionality).
- Timestamps are ISO-8601 strings (`ts: string`), not epoch millis — matches SQLite journal
  storage and keeps the audit log human-readable when someone inevitably `cat`s it on stage.
- Every WebSocket server push is wrapped in a discriminated envelope (`type` field), the same
  pattern the Next.js boilerplate plan uses for its realtime gateway (`partial_caption`,
  `committed_caption`, etc.). One socket, one message union, exhaustive switch on the client.
- Transport stays as decided in the scope doc: HTTP request/response is authoritative
  (§6 endpoints); the WebSocket is a **read-only push channel** that mirrors those same
  responses to the tablet the instant session state changes, so Lane A never has to poll.
  Nothing is invented over the socket that doesn't also exist as an HTTP shape.
- No PHI leaves the box in either transport — this doc only fixes shape, not destination.

---

## 1. Live transcript / suggestion messages

### 1.1 HTTP (authoritative, per scope doc §6)

```ts
// POST /session/{id}/utterance   (multipart audio blob)
type UtteranceResponse = {
  utterance_id: string;
  text: string;
  speaker: "nurse" | "patient";
  ts: string;
};

// GET /session/{id}/suggestions
type SuggestionsResponse = {
  pathway_node: string;          // node id in the JSON pathway graph
  questions: Array<{
    id: string;
    text: string;
    rationale: string;
  }>;
  ts: string;
};
```

### 1.2 WebSocket push envelope

Socket: `GET /ws/session/{id}` (upgrade). Server-to-client only; the client sends nothing but
`ping`/`pong` for keepalive. Every session-state change that Lane A needs to render live goes
out as one of these:

```ts
type ServerEvent =
  | { type: "session_ready"; session_id: string; started_at: string }
  | { type: "utterance"; data: UtteranceResponse }
  | { type: "suggestions"; data: SuggestionsResponse }
  | { type: "proposal_status"; data: ProposalStatusEvent }   // see §2.3
  | { type: "audit"; data: AuditRow }                         // see §2.4
  | { type: "error"; code: ErrorCode; message: string; retryable: boolean };

type ClientEvent = { type: "ping" };

type ErrorCode =
  | "stt_unavailable"
  | "session_not_found"
  | "malformed_audio"
  | "internal_error";
```

Rendering rules for Lane A:

- `utterance` events append to the running transcript in order of arrival; `utterance_id` is
  the de-dupe key if an HTTP response and a WS push race.
- `suggestions` events **replace** the suggestion pane wholesale (it's a snapshot of "current
  node + its children," not a diff).
- `error` with `retryable: true` shows a transient banner; `retryable: false` (e.g.
  `stt_unavailable`) disables push-to-talk until the socket reconnects.

---

## 2. Test-order approval payloads

This is the governed path — every shape here traces back to scope doc §6 and §9 (Beat 3, the
fail-closed demo beat). `status` is the state machine; nothing skips a state.

### 2.1 Requesting a consult

```ts
// POST /session/{id}/consult
type ConsultRequest = { requested_by: string };  // nurse identity stamp, see §7 of scope doc

type ConsultResponse = {
  consult_id: string;
  proposals: Proposal[];
};

type Proposal = {
  proposal_id: string;
  test_code: string;       // e.g. LOINC-ish local code, mock LIS vocabulary
  label: string;           // human-readable test name for the card
  rationale: string;       // why the model proposed it
  citation: string;        // retrieval source line — required, never empty
  status: ProposalStatus;
};

type ProposalStatus =
  | "proposed"
  | "approved"
  | "submitted"
  | "denied"
  | "refused";
```

### 2.2 Approving / denying a proposal

```ts
// POST /proposal/{id}/decision
type DecisionRequest = {
  decision: "approve" | "deny";
  approver_id: string;
  approver_name: string;   // from the identity dropdown, always present
};

type DecisionResponse = {
  proposal_id: string;
  status: ProposalStatus;   // "submitted" | "denied" | "refused"
  order_ref?: string;       // present only when status === "submitted"
  audit_id: string;
};
```

**Card rendering contract (Lane A must implement this distinction — it's the money shot):**

| `status` after decision | Card treatment |
|---|---|
| `submitted` | Green, order ref shown, reads as success |
| `denied` | Neutral/gray, reads as "nurse chose not to" |
| `refused` | Red, wall-like — no order ref, no retry action. This did not go to the nurse's judgment; the gate stopped it before that. Never render this the same as `denied`. |

An `approve` decision can still resolve to `refused` — the nurse approving doesn't guarantee
egress; the OpenShell gate has the last word. `DecisionResponse.status` is the actual
outcome, not an echo of the request.

### 2.3 Live proposal updates (WS)

```ts
type ProposalStatusEvent = {
  proposal_id: string;
  status: ProposalStatus;
  order_ref?: string;
  audit_id?: string;
};
```

Pushed whenever a proposal's status changes, so a card update lands even if the decision was
triggered from a different tab/device than the one rendering it.

### 2.4 Audit rows

```ts
// GET /session/{id}/audit
type AuditRow = {
  audit_id: string;
  ts: string;
  actor: string;            // approver_name, or "system" for a refusal
  action: "propose" | "approve" | "deny" | "refuse" | "submit";
  proposal_id: string;
  outcome: string;          // short human-readable outcome, shown verbatim in the audit list
};
```

---

## 3. Final visit note structure

Not an endpoint the scope doc froze — this is new surface, assembled client-side (or via a
`GET /session/{id}/note` endpoint if Lane B has time) entirely from data already produced by
§1 and §2. No new model calls, no new PHI paths. It exists to close the loop for the demo and
give the nurse something they can review/print at encounter end.

```ts
type VisitNote = {
  session_id: string;
  started_at: string;
  ended_at: string;
  nurse: { id: string; name: string };

  chief_complaint_path: Array<{
    pathway_node: string;
    entered_at: string;
  }>;                          // the sequence of pathway nodes traversed, for context

  transcript: UtteranceResponse[];

  consults: Array<{
    consult_id: string;
    requested_at: string;
    proposals: Array<{
      proposal_id: string;
      label: string;
      rationale: string;
      citation: string;
      final_status: ProposalStatus;
      decided_by?: string;      // approver_name, absent for a system refusal
      order_ref?: string;
    }>;
  }>;

  audit_trail: AuditRow[];

  disclaimers: {
    not_a_diagnosis: true;      // always true, always rendered — scope doc §10
    pathway_illustrative: true; // scope doc §10 — pathway is scaffolding, not validated protocol
  };
};
```

Rendering rules:

- The note is a **read-only summary**, never an editable clinical record — it has no save
  path back into the pathway or the model. It's assembled, not authored.
- `disclaimers` fields are always `true` and always rendered visibly on the note; they are not
  conditional flags to check, they're the framing-discipline line from scope doc §10 made
  literal in the data shape so no future refactor can quietly drop the disclaimer copy.
- Any proposal still `proposed` (i.e. the session ended before a decision) appears with
  `final_status: "proposed"` and no `decided_by` — the note must not silently resolve an
  undecided proposal into something else.

---

## 4. Ownership

- Lane A owns rendering for all shapes above; Lane B owns producing them; Lane C owns the
  `refuse` path in §2 and everything in the `audit_trail`.
- Any shape change here is a cross-lane change — announce it, don't drift silently. Given §8.3
  of the scope doc (seam-slippage is the most likely cause of failure), treat this file as
  higher-priority to keep in sync than any single lane's internal code.
