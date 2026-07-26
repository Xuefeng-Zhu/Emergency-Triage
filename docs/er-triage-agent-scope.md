# ER Triage Agent — Architecture & Lane Split

> Scope contract for the GB10 hackathon build. Three builders, four lanes, one day.
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
        ├─ STT endpoint            (local Whisper-class model)          [Lane B]
        ├─ Inference interface     (§6.2 — transcribe / complete)       [Lane B]
        ├─ Advisory loop           (pathway state machine)              [Lane C]
        ├─ Consult loop            (retrieval → proposals, pre-gated)   [Lane C]
        └─ Order egress            ──► OpenShell gate ──► mock LIS      [Lane C]
```

Lane B owns the bottom two GPU-facing rows; Lane C owns the three above them and reaches the
models only through §6.2. Lane A is the tablet. Lane D is the clock.

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

Three builders, four lanes, two frozen seams. Lane D has no owner by design — see below.

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

### Lane B — Inference serving
Everything that touches a GPU. Nothing that touches a prompt.

- Serving both models co-resident on the box (STT + reasoning model).
- `/utterance` transcription path.
- The co-residency memory budget and the sequential-pipeline guarantee (§8.1) — first task
  of the day, not the last.
- Exposing inference to Lane C behind the frozen interface in §6.2, including the smaller
  fallback model the advisory loop may need (§8.2).

Lane B is a thin, deep lane: little surface area, all of it hard. Its deliverable is a stable
inference interface, not features. Lane B never writes a prompt; Lane C never names a model.

### Lane C — Agent & governance *(Charles)*
Everything that reasons and everything that governs.

- Advisory loop: pathway node classification + child expansion.
- Consult loop: retrieval + proposal generation with rationale.
- The pathway JSON graph itself (the prompt and the graph are co-designed, so they live in
  one lane).
- OpenShell policy: deny-by-default egress, the declared order envelope.
- Mock LIS / order-entry service (local, the only permitted egress destination).
- The approve → egress-permit mint, and the identity-stamped audit record.

**Why the loops live here.** The envelope check has to run during `POST /consult`, not at
approval time — an out-of-envelope proposal must arrive already `refused`, so the
nurse never had the option to approve it. That puts policy evaluation inside the consult
response path. It also requires the proposal space to *deliberately* include out-of-envelope
test codes, so the gate has something legitimate to refuse; a consult prompt narrowed to labs
for accuracy would delete the money shot. Both of those were cross-lane coordination when the
loops sat in Lane B. Both are now internal to one lane. That is the point of the split.

**Note on ownership (revised).** Lane C is now the largest code lane *and* the highest-judged
surface — it is the critical path. The old failure mode was Lane C being quietly deprioritized
until 3pm. The new one is Lane C's owner being pulled into firefighting A and B while holding
the critical path. Protect the lane harder, not less: A and B triage their own fires.

### Lane D — Demo planning & convergence *(shared, time-boxed)*
No owner. A shared lane with a hard clock, because a lane everyone owns is a lane nobody owns
unless the clock forces it.

- Scripted patient encounters — the actual spoken content of the demo.
- Beat choreography (§9) — selected late, from what is actually integrated.
- Integration: all three lanes wired end to end on the real box, not against stubs.
- The pitch and the writeup.

**Time-box (locked).** Feature work in Lanes A, B, and C stops at **T−3h**; from that point
the entire team is in Lane D. A second checkpoint at **T−1h** is a full dry run, and no code
changes are permitted after it. Anything not integrated at T−3h is cut, not finished — that
is the whole function of the checkpoint, and it only works if it is treated as a deadline
rather than a suggestion.

---

## 6. The frozen seams

There are now **two** seams, and both get stubbed in hour one. Canned responses behind every
endpoint and every function before anyone builds the real thing. This is still the single
highest-leverage 30 minutes of the day.

### 6.1 External — Lane A ↔ Lane C (HTTP)

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

### 6.2 Internal — Lane C ↔ Lane B (in-process function calls)

Lane C no longer owns inference; it calls Lane B. This interface is as load-bearing as the
HTTP contract above and fails the same way if it is not frozen early.

```
transcribe(audio_bytes)                → { text, duration_ms }

complete(prompt, schema, max_tokens,   → parsed dict conforming to `schema`
         tier="reason"|"fast")
```

Contract rules:

- **Synchronous and strictly sequential.** Never concurrent — see §8.1.
- `schema` is mandatory and Lane B is responsible for returning something that validates
  against it. Lane C does not parse free text.
- `tier` is how Lane C asks for the smaller fallback model without naming it. Lane B decides
  what backs each tier. Lane C must never reference a model name in code or prompt.
- Lane B ships a **canned stub of both functions in hour one**, returning fixed JSON. Lane C
  builds the advisory loop, the consult loop, and the whole gate against that stub while Lane
  B is still fighting the memory budget. Lane C should never be blocked on a GPU.

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
| Loop ownership | **Lane C, not Lane B** | The envelope pre-check sits in the consult response path; keeping the loops and the gate in one lane makes that ordering internal instead of a cross-lane negotiation. See §5. |
| Lane B/C boundary | Inference interface, not features | Lane C never names a model; Lane B never writes a prompt. |
| Lane D | **Shared, hard stop at T−3h** | Convergence has no owner, so it needs a clock instead. Nothing integrates itself at the last minute. |

---

## 8. Risks

### 8.1 Co-residency memory budget *(Lane B, first task)*
Whisper-class STT plus Nemotron resident simultaneously on one GB10. `--gpu-memory-utilization`
must drop from the 0.9 default to roughly 0.5–0.55 to leave room for the second model. The
pipeline must be **strictly sequential** — transcribe, release, reason — because naive
concurrent calls will OOM. Measure this before building anything on top of it; do not trust
arithmetic.

### 8.2 Advisory latency *(Lane C, needs a Lane B dependency early)*
The advisory loop fires on every utterance and the nurse is mid-conversation. If it takes
more than a few seconds it stops being useful and starts being a distraction on screen.
Mitigations, in order of preference: keep the classification prompt short and the output
schema tiny; route the advisory loop to the `fast` tier and reserve the reasoning model for
consult; debounce so a rapid sequence of utterances only triggers one classification.

The middle mitigation is now **cross-lane** — Lane C can only ask for `tier="fast"` if Lane B
has actually stood a second, smaller model up behind it. Make that request in the morning. It
is worthless discovered at T−4h, because by then Lane B has no room in the memory budget to
add a model.

### 8.3 A seam slipping
Two seams now, and either one loses the day. If §6.1 is not stubbed, Lane A blocks on Lane C
by mid-morning. If §6.2 is not stubbed, Lane C blocks on the GPU — which means the critical
path blocks on the hardest, least predictable task in the build. §6.2 is the more dangerous of
the two for exactly that reason. Both are process risks, not technical ones, and together they
remain the most likely single cause of failure.

### 8.4 Lane C is the critical path
The restructure concentrated the reasoning *and* the governance in one lane held by one
person. Lane A can degrade gracefully (stubs, rougher UI) and Lane B can degrade to a slower
model, but there is no degraded version of Lane C that still demos — no loops means no
proposals, and no gate means no story. Two implications: Lane C's owner does not take
firefighting duty for A or B, and if Lane C slips, the cut is *pathway breadth* (drop to one
chief complaint) rather than anything in the governance path.

### 8.5 Lane D belongs to nobody
A shared lane is unowned until the clock makes it everyone's. The failure mode is three
builders each assuming another is writing the script, and a demo assembled in the last
twenty minutes. The T−3h checkpoint is the only mitigation, and it works only if someone
calls it out loud when the time arrives.

---

## 9. Demo beats *(Lane D)*

**Beat 1 — Capture (30s).** Nurse holds the button, describes a chest-pain presentation.
Transcript appears. Suggestion pane updates with the pathway's next questions. Narrate: this
audio is PHI from the instant it exists, and it has not left the box.

**Beat 2 — Consult (45s).** Nurse asks for a recommendation. Agent returns three test
proposals with rationale and citation. They appear as cards — proposed, not ordered.

> **The rest of the beats are deliberately unspecified.** The remaining choreography — how the
> fail-closed story gets shown, and whether an injection beat exists at all — will be
> determined closer to demo time, subject to what is actually working on the box. Locking a
> script now to capabilities that may not land is the failure mode; Lane D picks the beats from
> what integrates by the T−3h checkpoint. The architecture above does not depend on which
> beats get chosen.

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
