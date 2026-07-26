# Lane 3 live-mode testing (no STT)

Verifies the live cutover on the DGX Spark box **without live transcription**:
hand-edited encounter scripts are posted as text through the existing
`/utterance` endpoint (echo STT mode), so everything after STT runs for real —
NemoClaw-sandboxed completion, pathway classification, corpus-grounded consult,
envelope refusal, permit mint, sandboxed curl egress, mock LIS verification,
and the audit trail.

What is **not** exercised: WhisperX transcription (`TRIAGE_STT_MODE=live`).
That remains open until live STT is available.

## Prerequisites on the box

1. Repo synced to this branch; Python ≥3.12 venv at repo root:
   ```bash
   python3 -m venv .venv && .venv/bin/pip install -e "apps/api[dev]"
   ```
2. NemoClaw sandbox installed and running (`scripts/install-nemoclaw.sh`),
   with the egress policy **applied for real** (install only dry-runs it):
   ```bash
   nemoclaw emergency-trial-agent status
   nemoclaw emergency-trial-agent policy-add --from-file agent/presets/mock-lis.yaml --yes
   ```
3. `openclaw agent` responds inside the sandbox (any prompt returns JSON):
   ```bash
   nemoclaw emergency-trial-agent exec -- openclaw agent --json -m 'Return {"ok": true}'
   ```

## Configure

```bash
cp .env.example .env
```

Edit `.env`:

```bash
TRIAGE_MODE=live          # live completion + live sandboxed egress
TRIAGE_STT_MODE=echo      # text-in-place-of-audio; the point of this exercise
ORDER_PERMIT_SECRET=$(openssl rand -hex 32)   # never ship the default
```

Start the API:

```bash
.venv/bin/uvicorn app.main:app --app-dir apps/api --port 8787
```

Confirm the mode took — `stt_mode` must say `echo`, `mode` must say `live`:

```bash
curl -s localhost:8787/healthz
```

## Run

```bash
.venv/bin/python scripts/live_smoke.py --encounter scripts/encounters/chest-pain-cardiac.json
.venv/bin/python scripts/live_smoke.py --encounter scripts/encounters/chest-pain-pleuritic.json
```

Each run walks one encounter end to end and prints `PASS`/`FAIL` per check;
exit code 0 means all passed. The checks, in order:

| # | Check | What it proves |
|---|---|---|
| 1 | echo STT active, utterances echoed | test harness itself is wired right |
| 2 | pathway reaches `chest_pain.*` | advisory loop classifies live against the closed label set |
| 3 | consult returns proposals with `§` citations | consult loop grounds in the local corpus, live |
| 4 | at least one proposal `refused` | envelope gate operates on live output (soft check — a live model may stay in-envelope; rerun or sharpen the encounter text) |
| 5 | approve → `submitted` with `order_ref` | permit mint → sandboxed curl → L7 policy → mock LIS, the whole egress path |
| 6 | refused proposal 409s on decision | the gate's verdict is not overridable by the client |
| 7 | forged permit → 403 | mock LIS actually verifies, not decoration |
| 8 | approve precedes `order_submission` in audit, identity-stamped | write-ahead audit ordering held under live latency |

## Editing test data

Encounters are plain JSON — edit text, add utterances, or copy a file to
build a new scenario:

```json
{
  "name": "...",
  "expect_pathway_prefix": "chest_pain",
  "utterances": [ { "speaker": "patient", "text": "..." } ]
}
```

`expect_pathway_prefix` is what check 2 asserts against (use
`shortness_of_breath` / `abdominal_pain` for those pathways, or omit to skip).
One utterance per array entry — each is one push-to-talk press.

## Optional: prove deny-by-default at the sandbox

The smoke test proves the *allowed* pinhole works. To watch the wall itself,
try to leave the sandbox toward anywhere else — both must fail:

```bash
nemoclaw emergency-trial-agent exec -- curl -sS --max-time 10 https://example.com
nemoclaw emergency-trial-agent exec -- curl -sS --max-time 10 \
    -X GET http://host.openshell.internal:8787/healthz
```

The second matters more: same host and port as the permitted endpoint, but
wrong method/path — if L7 enforcement is real, host-level reachability is not
enough.

## Troubleshooting

- **`consult returned 200` fails with a 500** — most likely malformed live
  model output; the output-defense hardening is a known open item
  ([lane3-checklist.md](lane3-checklist.md), item 1). Check the uvicorn log
  for the pydantic validation error and note the shape.
- **Consult times out** — raise `--timeout` (and `NEMOCLAW_TIMEOUT_SECONDS`
  in `.env`); first calls on a cold model server are the slowest.
- **`approval submitted through egress` fails with 502** — that's the
  fail-closed path working; the audit trail will show `egress_failed`. Check
  the policy was applied (`--yes`, not just the install dry-run) and that
  `MOCK_LIS_URL` matches the policy's host/port/path exactly.
- **Classification lands on `intake` repeatedly** — the live model isn't
  matching the label set; capture the uvicorn log of the raw completion and
  bring it back to Lane C — likely a prompt fix, not a box problem.
