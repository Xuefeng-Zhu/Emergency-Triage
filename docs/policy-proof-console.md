# Policy proof console (on-stage window)

A second console window for the live demo. It shows the **sandbox's own verdict
for every network call the agent's tooling attempts** — allowed or denied, which
binary tried it, which policy decided, and which engine enforced it.

The main demo window shows the nurse's tablet and the audit trail: evidence that
a human decided. This window answers the sceptic's question instead — *how do we
know anything else was actually prevented?* The audit trail is our record of our
own behaviour. These lines come from the enforcement layer, not from us.

Driver script: [`scripts/policy-proof-console.sh`](../scripts/policy-proof-console.sh).

## What this window proves

- **Every egress attempt is adjudicated.** Each line names the binary and PID
  (`/usr/bin/curl(12640)`), so the audience sees the subject, not just a verdict.
- **Deny-by-default is real.** Unlisted hosts are refused with `policy:-` — no
  policy claimed them, so they lost.
- **Enforcement is L7, not host-level.** The same host *and* the same port as
  the permitted endpoint, with the wrong method/path, is denied. Host-level
  reachability is not enough.
- **The envelope is one pinhole.** Exactly `POST /mock-lis/orders`, by
  `/usr/bin/curl` only.
- **Permit verification is independent of the network policy.** A forged permit
  is *allowed* by policy and then rejected by the LIS on its own merits — two
  separate gates, not one dressed up as two.

## What it does not prove

Say this out loud if asked; it is the honest boundary of the demo.

- Nothing about **clinical correctness**. This is a governance demo.
- Not the `refused` vs `denied` distinction — that lives in the app's audit
  trail. The two records are complementary: the audit trail shows the nurse
  decided; this window shows nothing else could have left.
- Not transcription. The demo runs `TRIAGE_STT_MODE=echo`; see
  [lane3-live-testing.md](lane3-live-testing.md).

## Pre-flight (before the audience is in the room)

```bash
scripts/policy-proof-console.sh policy      # both presets active, pinhole is one POST route
curl -s localhost:8787/healthz              # mode=live, egress_default=deny
scripts/policy-proof-console.sh probe       # all four refused
scripts/policy-proof-console.sh forged      # ALLOWED by policy, http=403 from the LIS
```

Two failure modes worth catching now rather than on stage:

- **`upstream_unreachable` on the forged probe** — uvicorn is bound to
  `127.0.0.1`. It must be `--host 0.0.0.0`, or every approval fails closed.
- **The permitted route denied too** — the egress policy was never applied
  (`policy-add … --yes`, not just the installer's dry-run).

Then run one encounter end to end to warm the model, so the first on-stage
consult isn't the cold-start one.

## The window

```bash
scripts/policy-proof-console.sh watch
```

Large font, and give it real vertical space — a busy approval emits two lines.
It starts from `--since 5s`, so the pane opens clean instead of replaying the
day's backlog. Leave it running for the whole demo.

## Beat sheet

**1 — Show the envelope first (before any traffic).** `policy` mode prints the
active presets and the pinhole itself: one host, one port, one method, one path,
`enforcement: enforce`, and a `binaries:` allowlist. Establish the claim before
demonstrating it, so the audience knows it wasn't retrofitted to the outcome.

**2 — Run the encounter.** Utterances and consult produce **no lines here**.
Worth narrating: reasoning happens on-box against a local model, so there's
simply no egress to adjudicate.

**3 — Approve one proposal.** Two lines appear:

```
  ALLOWED  POST http://host.openshell.internal:8787/mock-lis/orders emergency_trial_mock_lis/l7
  ALLOWED  POST http://host.openshell.internal:8787/mock-lis/orders emergency_trial_mock_lis/opa
```

Two engines, `l7` then `opa`, for one request. This is the *only* traffic the
whole encounter generates.

**4 — Deny or refuse a proposal. Point at the pane and say nothing appears.**
The absence is the evidence: a refused proposal never becomes a network call.

**5 — Attack the wall.** In the other window:

```bash
scripts/policy-proof-console.sh probe
```

```
  DENIED   example.com:443                                -/opa
  DENIED   GET http://169.254.169.254/latest/meta-data/   -/opa
  DENIED   pypi.org:443                                   -/opa
  DENIED   GET http://host.openshell.internal:8787/healthz emergency_trial_mock_lis/l7
```

Land the last two specifically. `169.254.169.254` is the cloud-metadata address
every exfiltration playbook reaches for. And the fourth is the strongest single
line in the demo: **same host, same port** as the permitted call — denied on
method and path alone, by the very policy that allows the order.

**6 — Forge a permit** (`forged` mode). Policy says ALLOWED; the LIS answers
`403 Invalid or expired order permit`. The network policy and the order permit
are independent controls.

## Reading a line

```
  VERDICT  TARGET                                          POLICY/ENGINE
  DENIED   GET http://host.openshell.internal:8787/healthz  emergency_trial_mock_lis/l7
```

- `policy:-` means no policy matched — the deny-by-default floor.
- A named policy with `DENIED` means a policy matched the *endpoint* and still
  refused the *request*. That is L7 doing work.
- `engine:l7` inspects method/path; `engine:opa` is the policy decision layer.

If someone asks why two 403s in the demo look identical, they aren't:

| Origin | Body | Appears in the API's access log? |
|---|---|---|
| Sandbox proxy | includes `"error":"policy_denied"` | **no** — never reached the host |
| Mock LIS | `{"detail":"Invalid or expired order permit"}` | yes, from the docker bridge IP |

The proxy always adds an `error` key; the app never does.

## Cross-check, if challenged

```bash
curl -s localhost:8787/session/<session_id>/audit | python3 -m json.tool
```

Every `order_submission` in the audit trail should have exactly one `ALLOWED`
pair in this pane, and no pane line should lack a corresponding approval. One
record is the app's; the other is the sandbox's. They should agree.

## If it misbehaves on stage

- **Pane empty during an approval** — the follower died, or the approval failed
  closed. Check the audit trail for `egress_failed`, then restart `watch`.
- **Pane replaying old traffic** — a stale follower from an earlier run is still
  attached; kill it and restart.
- **Everything denied, including the order** — policy not applied to this
  sandbox. `policy-add … --yes`. Recoverable live, but check in pre-flight.

## Raw commands (if the script is unavailable)

```bash
nemoclaw emergency-trial-agent logs --follow --since 5s 2>&1 \
  | grep --line-buffered -E '(ALLOWED|DENIED) [^ ]+ -> '
```

Unfiltered lines are wide but carry the same content, plus a `reason:` field
that spells out the refusal in words — occasionally worth showing verbatim to a
sceptic.
