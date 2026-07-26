# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local-first ER triage clinical-decision-support demo (GB10 hackathon build). An ER nurse
runs a patient encounter on a tablet; audio is transcribed and reasoned over **entirely on
the box**, with deny-by-default network egress. The agent *proposes*, the nurse *decides* —
never phrase any output as a diagnosis or directive. The demo proves two things only: data
cannot leave the device, and proposals cannot escape a declared order envelope. It does **not**
claim clinical correctness. See `docs/er-triage-agent-scope.md` for the full architecture
contract and demo choreography — it is the source of truth for design intent.

## Layout

- `apps/api` — FastAPI backend (Python ≥3.12), the entire agent + governance surface.
- `apps/web` — React 19 + Vite + TypeScript tablet client (pnpm workspace `@emergency-trial/web`).
- `agent/` — the sandbox agent contract (`AGENTS.md`) and NemoClaw policy preset for live mode.
- `docs/` — architecture scope, hackathon brief, and the GB10 runbook.
- `scripts/` — `dev.sh` (run both apps), `bootstrap-dell.sh`, `install-nemoclaw.sh`.

## Commands

Run both apps locally (creates `.venv`, installs, starts uvicorn on :8787 and Vite on :5173):
```bash
cp .env.example .env   # first time
scripts/dev.sh
```
Web (from repo root, via pnpm workspace):
```bash
pnpm run dev:web        # vite dev server
pnpm run build          # tsc -b && vite build
pnpm run typecheck      # tsc -b
pnpm run test:web       # vitest run
```
Run a single web test: `pnpm --filter @emergency-trial/web exec vitest run src/api.test.ts`

API (Python; the venv lives at repo-root `.venv`, package installed editable as `apps/api[dev]`):
```bash
.venv/bin/pytest apps/api/tests            # full suite
.venv/bin/pytest apps/api/tests/test_api.py::<name>   # single test
.venv/bin/uvicorn app.main:app --app-dir apps/api --port 8787
```
Note: `pytest` is configured with `pythonpath=["."]` and `testpaths=["tests"]` relative to
`apps/api`, and `asyncio_mode=auto` — async tests need no decorator.
`apps/api/tests/conftest.py` pins `TRIAGE_MODE=stub` so a live `.env` on the box
can't drag the suite onto the GPU; `TRIAGE_TEST_ALLOW_ENV=1` opts out.

## Architecture

### Stub vs. live mode (the key seam)
`TRIAGE_MODE` (env, default `stub`) selects the inference backends via `build_inference()` in
`apps/api/app/inference.py`. **Stub mode returns canned JSON and loads no GPU models** — it
exercises the entire transcript → suggestion → consult → policy-refusal → approval → mock-order
→ audit path end to end, and is how you develop and test everything. Live mode swaps in
`WhisperXTranscriber` (STT) and `NemoClawCompletionEngine` (reasoning via a sandboxed
`nemoclaw … openclaw agent` subprocess). Nothing in the codebase names a model directly from
the agent logic — inference is reached only through the `Transcriber` / `CompletionEngine`
Protocols. Preserve that boundary: agent/governance code must not reference model names, and
must not add network calls.

### The two loops are deliberately separate (`service.py`)
This is the load-bearing structural decision — do not merge them:
- **Advisory loop** — runs on *every* utterance (`POST /session/{id}/utterance`). Classifies
  the transcript onto exactly one node of a hand-authored JSON pathway graph (closed label
  set, `fast` tier) and returns that node's suggested questions. Deterministic, ungoverned, UI
  hint only. The pathway is a **state machine, not RAG** (`pathways.py` reads
  `app/data/pathways.json`).
- **Consult loop** — runs only on explicit `POST /session/{id}/consult`. Generates test-order
  proposals with rationale + citation (`reason` tier). Each proposal is a *governed action*.

### Governance / the order envelope (`governance.py`)
The envelope check runs **inside the consult response path**, not at approval time
(`evaluate_proposal` marks out-of-envelope test codes `refused` before a human sees them). The
consult prompt is deliberately allowed to propose out-of-envelope tests so the gate has
something legitimate to refuse. Proposal state machine (rendered by the web client, governed
by the API): `proposed → approved → submitted` / `proposed → denied` / `proposed → refused`.
**`refused` (gate rejected it pre-human) is distinct from `denied` (nurse said no)** — they
render differently and mean different things; keep them distinct.

Approval mints a short-lived HMAC order permit (`OrderSubmitter.mint_permit`, 60s TTL) and
submits to the mock LIS. Egress **fails closed**: if submission raises, the approval is still
recorded in the audit trail and the endpoint returns 502 (see `decide()` in `service.py`).
Every state transition writes an `AuditEntry` stamped with the approving nurse's name — the
audit trail is the evidence the governance claim is real, not an afterthought.

### State
`SessionRepository` (`repository.py`) is in-memory (`dict`) with a SQLite JSON journal for
demo recovery; sessions reload from the journal on startup. One encounter at a time —
multi-session concurrency is a non-goal.

### Web client
Single-screen three-panel app (`apps/web/src/App.tsx`): transcript (push-to-talk via
`MediaRecorder`, one utterance per press), live suggestions, consult + proposal cards + audit.
Talks to the API through the `/api` prefix, which Vite proxies to the backend (`vite.config.ts`,
`TRIAGE_API_URL`). Nurse identity is a dropdown (`NURSES`) — required because every approval
must carry a name.

## Deployment
Native Ubuntu on GB10 (no Docker Compose; Docker is only for the NemoClaw/OpenShell sandbox).
Systemd units in `deploy/systemd/`. Full bootstrap and the stub→live cutover checklist are in
`docs/native-gb10-runbook.md`. Before enabling live mode, generate a real `ORDER_PERMIT_SECRET`.
