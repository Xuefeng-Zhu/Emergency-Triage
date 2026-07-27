# Triage Local — in brief

The short-form telling. For the full project documentation, see the [README](../README.md).

Local-first clinical decision support for an ER triage nurse. Runs entirely on one GB10 box.

The agent proposes. The nurse decides.

---

## The scenario

A triage nurse works a patient encounter with a tablet in hand. They talk; the tablet listens.
The transcript is spoken PHI from the instant it exists — a patient describing their own
symptoms, before de-identification is even possible.

That artifact cannot be sent to a third-party model. Not as a preference. As a
business-associate and data-residency problem.

So the box does not have the option. Audio is captured, transcribed, reasoned over, and acted
on in one process, with network egress denied by default. The constraint is physical, not
contractual.

This demo proves two things: **data cannot leave the device**, and **proposals cannot escape a
declared order envelope**. It makes no claim about clinical correctness.

---

## Architecture

One box. One process. Three surfaces.

```
  tablet (React, LAN)
        │  HTTP
        ▼
  FastAPI on GB10  ── owns Session state (in-memory + SQLite journal)
        ├─ STT                  WhisperX, in-process
        ├─ Advisory loop        pathway state machine
        ├─ Consult loop         proposals, pre-gated
        └─ Order egress    ──►  OpenShell gate ──► mock LIS
```

**Two loops, deliberately separate.** The advisory loop runs on every utterance: it maps the
transcript onto one node of a hand-authored JSON pathway graph and surfaces that node's next
questions. Closed label set, deterministic, ungoverned, a UI hint. The consult loop runs only
when the nurse asks: it proposes diagnostic tests with rationale and citation. Every proposal
is a governed action. Merging them is the mistake that eats the day.

**The gate runs before the human sees the card.** An out-of-envelope test code arrives already
`refused` — the nurse never had the option to approve it. `refused` (the gate said no) is not
`denied` (the nurse said no). They mean different things and they render differently.

**Approval mints a 60-second HMAC permit** and submits to the mock LIS. Egress fails closed: if
submission fails, the approval is still in the audit trail and the endpoint returns 502. Every
transition writes an audit row stamped with a nurse's name. The audit trail is the evidence,
not an afterthought.

---

## Local inference

Nothing in the agent names a model. Inference is reached only through two functions —
`transcribe(audio)` and `complete(prompt, schema, tier)` — behind Python Protocols.

`TRIAGE_MODE` picks what sits behind them.

- **stub** — canned JSON, no GPU. Exercises the entire transcript → suggestion → consult →
  refusal → approval → order → audit path. This is how you develop and test everything.
- **live** — WhisperX for speech, in-process via CTranslate2, built for the GB10's compute
  capability. Reasoning goes to a NemoClaw-sandboxed vLLM model through `openclaw agent`.

`tier="fast"` is how the advisory loop asks for a smaller model without knowing its name.
Governance code never references a model. Model code never writes a prompt. Neither side
makes a network call.

---

## Policy, hot-loaded

The egress envelope is a file: [`agent/presets/mock-lis.yaml`](../agent/presets/mock-lis.yaml).
One host, one port, one method, one path, one binary allowed to make the call.

It is applied to the **running** sandbox — no rebuild, no restart, no redeploy:

```bash
nemoclaw emergency-trial-agent policy-add --from-file agent/presets/mock-lis.yaml --dry-run
nemoclaw emergency-trial-agent policy-add --from-file agent/presets/mock-lis.yaml --yes
nemoclaw emergency-trial-agent policy-get     # what is actually live, right now
```

Three consequences.

Policy is version-controlled next to the code it constrains, and reviewed the same way.
It is validated before it is enforced — `--dry-run` first, always.
And it can be tightened or widened against a live encounter, mid-demo, with the model still
warm and the session still open.

Enforcement is L7, and the sandbox reports its own verdicts. The same host and the same port
as the permitted call, with the wrong method, is denied. That line is the demo:

```
  DENIED   GET  http://host.openshell.internal:8787/healthz    emergency_trial_mock_lis/l7
  ALLOWED  POST http://host.openshell.internal:8787/mock-lis/orders  emergency_trial_mock_lis/l7
```

Watch it live with `scripts/policy-proof-console.sh watch`. The audit trail is our record of
our own behaviour. These lines come from the enforcement layer instead.

---

## Run it

```bash
cp .env.example .env
scripts/dev.sh          # uvicorn :8787, Vite :5174 — stub mode, no GPU
```

```bash
.venv/bin/pytest apps/api/tests
```

---

## Docs

- [er-triage-agent-scope.md](er-triage-agent-scope.md) — architecture contract and design intent. Source of truth.
- [native-gb10-runbook.md](native-gb10-runbook.md) — bootstrap and the stub → live cutover.
- [policy-proof-console.md](policy-proof-console.md) — the enforcement window and its beat sheet.
- [lane3-live-testing.md](lane3-live-testing.md) — live-mode verification without STT.

Generate a real `ORDER_PERMIT_SECRET` before enabling live mode.
