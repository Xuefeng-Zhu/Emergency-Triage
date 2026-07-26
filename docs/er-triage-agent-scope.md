# ER Triage Agent — Architecture & Lane Split

> Scope contract for the GB10 hackathon build. Three builders, one day.
> This doc freezes the system shape, the integration seams, and the ownership
> boundaries. Per-lane implementation detail is drilled down *inside* each lane,
> not here.
>
> Companion docs: `hackathon-project-brief.md` (rules, hardware, stack),
> `00-elevator-pitch-and-demo.md` (pitch framing discipline).

---

## 1. The workflow

An ER triage nurse works a patient encounter with a tablet in hand. They talk to the
patient; the tablet captures audio; a local model transcribes it; a local agent does two
things with the transcript:

1. **Advises** — surfaces the next questions worth asking, driven by a clinical triage
   pathway. The nurse remains the decision-maker; the agent proposes, never directs.
2. **Proposes orders** — on explicit request ("what do you think?"), proposes a set of
   diagnostic tests. Each proposal is a *governed action*: it surfaces as an approve/deny
   card, and only an approval permits the corresponding order request to leave the agent.

Nothing in this loop touches the network. The transcript is spoken PHI; it is generated,
transcribed, reasoned over, and acted on entirely inside the box.

**Why local is forced (state this narrowly on stage):** the artifact under processing is a
recording of a patient describing their symptoms — PHI at the moment of capture, before any
de-identification is even possible. Routing it to a third-party model is a business-associate
and data-residency problem, not a preference. The demo makes the constraint physical rather
than contractual: egress is deny-by-default and the box proves it live.

---

## 2. System shape

One box, one process, three surfaces. **No queue, no message bus, no microservices.** A
FastAPI app on the GB10 owns a `Session` object; a React app served from that same box over
LAN is the tablet client.

```
  tablet (React, LAN)
        │  HTTP + WebSocket
        ▼
  FastAPI on GB10  ── owns Session state (in-memory + SQLite journal)
        ├─ STT endpoint            (local Whisper-class model)
        ├─ Advisory loop           (pathway state machine + Nemotron)
        ├─ Consult loop            (retrieval + Nemotron → order proposals)
        └─ Order egress            ──► OpenShell gate ──► mock LIS/order service
```

The forwarding question ("how does audio get to the agent") resolves to: **it doesn't
forward.** Same process, function call. Audio posts to an endpoint, the endpoint transcribes,
appends to session state, and the loops read session state. Any architecture with a hop
between STT and the agent is buying a distributed-systems problem the demo does not need.

---

## 3. The two loops are not one loop

This is the load-bearing structural decision. Building these as a single agent loop is the
mistake that eats the afternoon.

| | **Advisory loop** | **Consult loop** |
|---|---|---|
| Trigger | Every utterance, automatic | Explicit nurse request |
| Output | Suggested next questions | Test order proposals |
| Governance | None — pure UI hint | Approval-gated, egress-gated |
| Latency budget | ~2s (nurse is mid-conversation) | ~10s (nurse is deliberately waiting) |
| Failure mode | Unhelpful | Unsafe |
| Prompt | Short, pathway-anchored | Long, retrieval-grounded, rationale-bearing |

Separate endpoints, separate prompts, separate code paths. They share only the session
transcript.

---

## 4. Pathway as state machine, not RAG

A triage pathway is **structured data**, not prose to retrieve over. Encoding it as a
retrieval problem puts nondeterminism in the most visible, most demoed part of the system —
the suggestion pane the judges watch update in real time.

**Decision:** the advisory loop reads a hand-authored JSON pathway graph — roughly 30 nodes
covering two or three chief complaints (e.g. chest pain, shortness of breath, abdominal
pain). The model's job is narrow: *map the transcript onto a node, return the node's
children.* That is a classification task with a closed label set, which the model does
reliably and identically on every run.

Retrieval stays in the **consult loop only**, where the model genuinely needs source text to
justify a proposed test. Grounding a recommendation in a citable line is worth the
nondeterminism; picking the next question is not.

---

## 5. Lanes

Three builders, three lanes, one frozen seam between them.

### Lane A — Client & capture
Everything above the HTTP boundary.

- React app served from the box over LAN; tablet form factor.
- **Push-to-talk capture** (locked, see §7): hold to record, release to post one utterance.
- Session view: running transcript, live suggestion pane, proposal cards.
- Approve/deny interaction on each proposal card.
- **Nurse identity stamp.** A dropdown is sufficient, but it must exist — the audit line
  needs a name attached to every approval. This is not cosmetic; it is the thing that makes
  the governance claim true.

Builds entirely against stubs from hour one. Should never be blocked on Lane B.

### Lane B — Inference
Everything that touches a GPU.

- Serving both models co-resident on the box (STT + Nemotron).
- `/utterance` transcription path.
- Advisory loop: pathway node classification + child expansion.
- Consult loop: retrieval + proposal generation with rationale.
- The pathway JSON graph itself (authoring it is Lane B's, since the prompt and the graph
  are co-designed).

First task is the memory budget, not the last. See §8.

### Lane C — Governance & demo *(Charles)*
The lane with the least code and the most judged surface.

- OpenShell policy: deny-by-default egress, the declared order envelope.
- Mock LIS / order-entry service (local, the only permitted egress destination).
- The approve → egress-permit mint, and the identity-stamped audit record.
- The fail-closed beat (§9) and the injection beat.
- Scripted patient encounters — the actual spoken content of the demo.
- The pitch and the writeup.

**Note on ownership:** on a three-person team this lane is the one that quietly gets
deprioritized until 3pm and then determines the score. Assigning it to the person with the
deepest OpenShell context is correct; the risk is that Lane C's owner gets pulled into
firefighting A and B. Protect the lane.

---

## 6. The frozen seam

**Write these down and stub every one of them in hour one.** Canned responses behind every
endpoint before anyone builds the real thing. This is the single highest-leverage 30 minutes
of the day.

```
POST /session                          → { session_id, started_at }

POST /session/{id}/utterance           multipart audio blob
                                       → { utterance_id, text, speaker }

GET  /session/{id}/suggestions         → { pathway_node, questions: [
                                             { id, text, rationale } ] }

POST /session/{id}/consult             → { consult_id, proposals: [
                                             { proposal_id, test_code, label,
                                               rationale, citation, status } ] }

POST /proposal/{id}/decision           { decision: approve|deny,
                                         approver_id, approver_name }
                                       → { proposal_id, status, order_ref?,
                                           audit_id }

GET  /session/{id}/audit               → [ { audit_id, ts, actor, action,
                                             proposal_id, outcome } ]
```

Contract rules:

- `status` on a proposal is the state machine Lane A renders and Lane C governs:
  `proposed → approved → submitted` / `proposed → denied` / `proposed → refused`.
- **`refused` is distinct from `denied`.** `denied` means the nurse said no. `refused` means
  the gate rejected the proposal before a human ever saw it. Lane A must render these
  differently — the refusal card is the demo's money shot and it needs to look like a wall,
  not like a decline.
- Every state transition writes an audit row. The audit endpoint is not an afterthought; it
  is the evidence the governance claim is real.

---

## 7. Locked decisions

| Decision | Ruling | Rationale |
|---|---|---|
| Audio capture | **Push-to-talk** | Continuous streaming STT is the single biggest technical liability in this design. One utterance per press is dramatically safer and demos identically. Streaming is a stretch goal to be cut without regret. |
| Pathway | **JSON state machine**, not retrieval | Determinism in the most-watched surface. |
| Retrieval | Consult loop only | Grounding a test recommendation is worth nondeterminism; picking a question is not. |
| Transport | Same-process function calls | No hop between STT and agent. Simplest thing that demos. |
| Model pipeline | **Sequential, never parallel** | Co-residency on 128 GB unified; see §8. |
| Lane C owner | Charles | Deepest OpenShell context; highest judged surface. |

---

## 8. Risks

### 8.1 Co-residency memory budget *(Lane B, first task)*
Whisper-class STT plus Nemotron resident simultaneously on one GB10. `--gpu-memory-utilization`
must drop from the 0.9 default to roughly 0.5–0.55 to leave room for the second model. The
pipeline must be **strictly sequential** — transcribe, release, reason — because naive
concurrent calls will OOM. Measure this before building anything on top of it; do not trust
arithmetic.

### 8.2 Advisory latency
The advisory loop fires on every utterance and the nurse is mid-conversation. If it takes
more than a few seconds it stops being useful and starts being a distraction on screen.
Mitigations, in order of preference: keep the classification prompt short and the output
schema tiny; use the smaller fallback model for the advisory loop and reserve Nemotron for
consult; debounce so a rapid sequence of utterances only triggers one classification.

### 8.3 The seam slipping
If the contracts in §6 are not frozen and stubbed in hour one, Lane A blocks on Lane B by
mid-morning and the day is lost. This is a process risk, not a technical one, and it is the
most likely single cause of failure.

### 8.4 Lane C erosion
See §5. The governance lane has the least visible progress during the build and the most
weight in the score.

---

## 9. Demo beats

**Beat 1 — Capture (30s).** Nurse holds the button, describes a chest-pain presentation.
Transcript appears. Suggestion pane updates with the pathway's next questions. Narrate: this
audio is PHI from the instant it exists, and it has not left the box.

**Beat 2 — Consult (45s).** Nurse asks for a recommendation. Agent returns three test
proposals with rationale and citation. They appear as cards — proposed, not ordered.

**Beat 3 — The gate (45s).** Nurse approves two. Each approval mints a narrow, identity-
stamped permit and the order request goes to the local order service. The third proposal is
**outside the declared envelope** — an imaging order where policy permits only labs — and it
comes back `refused`. The nurse never had the option to approve it. Show the audit line.

> This is the strongest available fail-closed beat because it shows the constraint operating
> on the agent's *legitimate* output, not on an obvious attack. The agent was not
> compromised; it proposed something reasonable; the envelope refused it anyway.

**Beat 4 — Injection (30s, pocket).** Something in the patient's speech attempts to redirect
egress. Blocked at L7, logged. Keep this as the second beat, not the first — it is the more
familiar demo and lands harder after Beat 3 has established that the gate constrains normal
operation too.

---

## 10. Framing discipline

- The agent **proposes**; the nurse **decides**. Never phrase any output as a diagnosis or a
  directive. Every surface — UI copy, prompt output, pitch language — holds this line.
- We prove **data cannot leave** and **proposals cannot escape the declared envelope**. We do
  not prove the agent is clinically correct. In-envelope correctness is a separate problem
  and claiming otherwise in a clinical setting is the fastest way to lose a judge.
- The pathway content is illustrative scaffolding, not a validated clinical protocol. Say so
  before anyone asks.

---

## 11. Non-goals

- Real EHR/LIS integration — the order service is a local mock.
- Speaker diarization — one microphone, nurse-mediated, no attribution needed.
- Streaming transcription — explicitly cut, see §7.
- Multi-session concurrency — one encounter at a time.
- Any clinical validation claim whatsoever.
- Authentication beyond an identity dropdown — we need the audit stamp, not an IdP.
