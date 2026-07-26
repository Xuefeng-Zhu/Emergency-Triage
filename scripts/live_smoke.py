#!/usr/bin/env python
"""Lane 3 live-mode smoke test.

Drives a scripted encounter through the running API — utterances (as text,
via echo STT mode), advisory suggestions, consult, approve/deny, permit
rejection, and audit ordering — and reports PASS/FAIL per check.

Usage (from repo root, with the API running):
    .venv/bin/python scripts/live_smoke.py \
        --encounter scripts/encounters/chest-pain-cardiac.json \
        [--base-url http://localhost:8787] [--approver "RN Alex Morgan"]

Requires TRIAGE_STT_MODE=echo on the server (see docs/lane3-live-testing.md).
"""

import argparse
import json
import sys
from pathlib import Path

import httpx

CHECKS: list[tuple[str, bool, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    CHECKS.append((name, passed, detail))
    marker = "PASS" if passed else "FAIL"
    print(f"  [{marker}] {name}" + (f" — {detail}" if detail else ""))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8787")
    parser.add_argument(
        "--encounter",
        default="scripts/encounters/chest-pain-cardiac.json",
        type=Path,
    )
    parser.add_argument("--approver", default="RN Alex Morgan")
    parser.add_argument(
        "--timeout", type=float, default=180.0,
        help="Per-request timeout; consult on live models is slow.",
    )
    args = parser.parse_args()

    encounter = json.loads(args.encounter.read_text())
    client = httpx.Client(base_url=args.base_url, timeout=args.timeout)

    print(f"\n=== {encounter['name']} → {args.base_url} ===\n")

    # 0. Health & mode
    health = client.get("/healthz").json()
    print(f"Server: mode={health.get('mode')} stt_mode={health.get('stt_mode')}")
    check("server reachable", health.get("status") == "ok")
    check(
        "echo STT active",
        health.get("stt_mode") == "echo",
        "set TRIAGE_STT_MODE=echo in .env and restart"
        if health.get("stt_mode") != "echo" else "",
    )

    # 1. Session
    session_id = client.post("/session").json()["session_id"]
    print(f"\nSession {session_id}")

    # 2. Utterances → advisory loop
    last_node = "intake"
    for index, utterance in enumerate(encounter["utterances"], 1):
        response = client.post(
            f"/session/{session_id}/utterance",
            files={"audio": ("utterance.txt", utterance["text"].encode(), "text/plain")},
            data={"speaker": utterance.get("speaker", "patient")},
        )
        check(f"utterance {index} accepted", response.status_code == 200,
              response.text[:120] if response.status_code != 200 else "")
        if response.status_code != 200:
            continue
        echoed = response.json()["text"]
        check(f"utterance {index} echoed verbatim", echoed == utterance["text"])
        suggestions = client.get(f"/session/{session_id}/suggestions").json()
        last_node = suggestions["pathway_node"]
        print(f"    → node={last_node}  next-q: {suggestions['questions'][0]['text']!r}"
              if suggestions["questions"] else f"    → node={last_node}")

    prefix = encounter.get("expect_pathway_prefix")
    if prefix:
        check(
            f"pathway reached {prefix}.*",
            last_node.startswith(prefix),
            f"got {last_node}",
        )

    # 3. Consult
    print("\nConsult (live models are slow here — waiting)…")
    response = client.post(f"/session/{session_id}/consult")
    check("consult returned 200", response.status_code == 200,
          response.text[:200] if response.status_code != 200 else "")
    proposals = response.json().get("proposals", []) if response.status_code == 200 else []
    for proposal in proposals:
        print(f"    {proposal['status']:>8}  {proposal['test_code']:<14} "
              f"{proposal['label']}  [{proposal['citation']}]")
    proposed = [p for p in proposals if p["status"] == "proposed"]
    refused = [p for p in proposals if p["status"] == "refused"]
    check("at least one in-envelope proposal", bool(proposed))
    check(
        "envelope refused at least one code", bool(refused),
        "not fatal — model may have proposed only in-envelope tests; rerun or "
        "edit the encounter" if not refused else
        f"refused: {', '.join(p['test_code'] for p in refused)}",
    )
    check(
        "citations carry section refs",
        all("§" in p.get("citation", "") for p in proposals) if proposals else False,
    )

    # 4. Approve one (live: permit → sandboxed curl → mock LIS)
    order_ref = None
    if proposed:
        response = client.post(
            f"/proposal/{proposed[0]['proposal_id']}/decision",
            json={"decision": "approve", "approver_id": "rn-smoke",
                  "approver_name": args.approver},
        )
        body = response.json()
        check("approval submitted through egress", response.status_code == 200
              and body.get("status") == "submitted",
              body.get("detail", "") if response.status_code != 200 else "")
        order_ref = body.get("order_ref")
        if order_ref:
            print(f"    order_ref={order_ref}")

    # 5. Deny one
    if len(proposed) > 1:
        response = client.post(
            f"/proposal/{proposed[1]['proposal_id']}/decision",
            json={"decision": "deny", "approver_id": "rn-smoke",
                  "approver_name": args.approver},
        )
        check("denial recorded", response.status_code == 200
              and response.json().get("status") == "denied")

    # 6. Refused proposals must not be decidable
    if refused:
        response = client.post(
            f"/proposal/{refused[0]['proposal_id']}/decision",
            json={"decision": "approve", "approver_id": "rn-smoke",
                  "approver_name": args.approver},
        )
        check("refused proposal cannot be approved", response.status_code == 409)

    # 7. Mock LIS rejects a bogus permit
    response = client.post(
        "/mock-lis/orders",
        json={"proposal_id": "prop_forged", "test_code": "LAB-CBC", "label": "x"},
        headers={"X-Order-Permit": "forged.token"},
    )
    check("mock LIS rejects forged permit", response.status_code == 403)

    # 8. Audit ordering
    audit = client.get(f"/session/{session_id}/audit").json()
    actions = [entry["action"] for entry in audit]
    print("\nAudit trail:")
    for entry in audit:
        print(f"    {entry['ts']}  {entry['actor']:<16} {entry['action']:<18} "
              f"→ {entry['outcome']}")
    check("audit has proposal prechecks", "proposal_precheck" in actions)
    if proposed:
        check(
            "approve precedes order_submission",
            "approve" in actions and "order_submission" in actions
            and actions.index("approve") < actions.index("order_submission"),
        )
        approve_rows = [e for e in audit if e["action"] == "approve"]
        check(
            "approval is identity-stamped",
            all(e["actor"] == args.approver for e in approve_rows),
        )

    failed = [name for name, passed, _ in CHECKS if not passed]
    print(f"\n=== {len(CHECKS) - len(failed)}/{len(CHECKS)} checks passed ===")
    if failed:
        print("Failed: " + "; ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
