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
3. The sandboxed agent responds (returns a JSON envelope):
   ```bash
   nemoclaw emergency-trial-agent agent --agent main --json -m 'Return {"ok": true}'
   ```
   Use the `agent` subcommand, **not** `exec -- openclaw agent`: OpenShell
   `exec` rejects argv containing a newline, and every prompt the API sends is
   multi-line. A session selector (`--agent`) is also required, or the call
   exits 2 with `No target session selected`. The reply lives at
   `result.payloads[].text` as a JSON string, not at the envelope root.

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
.venv/bin/uvicorn app.main:app --app-dir apps/api --host 0.0.0.0 --port 8787
```

`--host 0.0.0.0` is **required**, not cosmetic. The mock LIS is served by this
same process, and the sandbox reaches it through `host.openshell.internal`.
uvicorn's CLI default is `127.0.0.1` — `TRIAGE_HOST` in `.env` does not reach
it — and a loopback bind makes every approval fail closed with a 502 while the
sandbox proxy reports `upstream_unreachable`.

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

For the stage version of this — the sandbox's own allow/deny line for every
attempted call, in a window the audience watches — see
[policy-proof-console.md](policy-proof-console.md).

## Troubleshooting

- **`consult returned 200` passes but no proposals appear** — the payload was
  located but carried nothing, or a single malformed item sank the batch.
  Per-item validation is still a known open item
  ([lane3-checklist.md](lane3-checklist.md), item 1). Extraction itself is
  schema-aware: it strips code fences and selects the object carrying the
  schema's required keys, and raises rather than silently returning `[]`.

- **`consult returned 200` fails with a 500** — check the uvicorn log for the
  raised reason. `nemoclaw agent exited …` carries the sandbox CLI's stderr
  verbatim; `OpenClaw returned no JSON object carrying the required keys …`
  means the model answered in prose.
- **Consult times out** — raise `--timeout` (and `NEMOCLAW_TIMEOUT_SECONDS`
  in `.env`); first calls on a cold model server are the slowest.
- **`approval submitted through egress` fails with 502** — that's the
  fail-closed path working; the audit trail will show `egress_failed`, and the
  uvicorn log now carries curl's stderr and the proxy's response body. Check,
  in this order: uvicorn is bound to `0.0.0.0` (not `127.0.0.1` — see above);
  the policy was applied (`--yes`, not just the install dry-run); and
  `MOCK_LIS_URL` matches the policy's host/port/path exactly. A proxy body of
  `upstream_unreachable` means the policy allowed the call and the *host*
  wasn't listening — a bind problem, not a policy problem.
- **Classification lands on `intake` repeatedly** — the live model isn't
  matching the label set; capture the uvicorn log of the raw completion and
  bring it back to Lane C — likely a prompt fix, not a box problem.
