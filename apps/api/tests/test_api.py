from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.governance import ORDER_ENVELOPE, OrderSubmitter, evaluate_proposal
from app.main import app
from app.models import Proposal
from app.pathways import (
    consult_hint_for,
    load_pathways,
    node_ids,
    questions_for,
    reference_slice,
)


def test_stub_workflow(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(
        "app.main.settings.triage_database_path", tmp_path / "triage.sqlite3"
    )
    with TestClient(app) as client:
        created = client.post("/session").json()
        session_id = created["session_id"]

        utterance = client.post(
            f"/session/{session_id}/utterance",
            files={"audio": ("utterance.webm", b"demo audio", "audio/webm")},
            data={"speaker": "patient"},
        )
        assert utterance.status_code == 200
        assert "chest tightness" in utterance.json()["text"]

        # The advisory loop moved the session onto a real pathway node.
        suggestions = client.get(f"/session/{session_id}/suggestions").json()
        assert suggestions["pathway_node"] == "chest_pain.initial"
        assert suggestions["questions"]

        consult = client.post(f"/session/{session_id}/consult")
        assert consult.status_code == 200
        proposals = consult.json()["proposals"]
        assert [proposal["status"] for proposal in proposals] == [
            "proposed",
            "refused",
        ]

        approved = client.post(
            f"/proposal/{proposals[0]['proposal_id']}/decision",
            json={
                "decision": "approve",
                "approver_id": "rn-alex",
                "approver_name": "RN Alex Morgan",
            },
        )
        assert approved.status_code == 200
        assert approved.json()["status"] == "submitted"
        assert approved.json()["order_ref"].startswith("LIS_STUB_")

        # Write-ahead ordering: the nurse's approval row precedes the
        # egress row, and both name the same proposal.
        audit = client.get(f"/session/{session_id}/audit").json()
        actions = [entry["action"] for entry in audit]
        assert actions.index("approve") < actions.index("order_submission")
        approve_row = audit[actions.index("approve")]
        assert approve_row["actor"] == "RN Alex Morgan"
        assert approve_row["proposal_id"] == proposals[0]["proposal_id"]


def test_egress_failure_fails_closed_with_audit(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(
        "app.main.settings.triage_database_path", tmp_path / "triage.sqlite3"
    )
    with TestClient(app) as client:
        session_id = client.post("/session").json()["session_id"]
        client.post(
            f"/session/{session_id}/utterance",
            files={"audio": ("utterance.webm", b"demo audio", "audio/webm")},
        )
        proposals = client.post(f"/session/{session_id}/consult").json()["proposals"]

        async def broken_submit(proposal):
            raise RuntimeError("mock LIS unreachable")

        monkeypatch.setattr(
            app.state.service.submitter, "submit", broken_submit
        )
        response = client.post(
            f"/proposal/{proposals[0]['proposal_id']}/decision",
            json={
                "decision": "approve",
                "approver_id": "rn-alex",
                "approver_name": "RN Alex Morgan",
            },
        )
        assert response.status_code == 502

        session = client.get(f"/session/{session_id}").json()
        proposal = session["proposals"][0]
        # Approval survives the egress failure; the order never became real.
        assert proposal["status"] == "approved"
        actions = [entry["action"] for entry in session["audit"]]
        outcomes = [entry["outcome"] for entry in session["audit"]]
        assert actions.index("approve") < outcomes.index("egress_failed")
        assert "submitted" not in outcomes


def test_pathway_graph_is_internally_consistent():
    pathways = load_pathways()
    assert pathways["root"] == "intake"
    for node_id, node in pathways["nodes"].items():
        assert node["label"], node_id
        assert node["questions"], f"{node_id} has no questions"
        for question in node["questions"]:
            assert question["text"].endswith("?"), question["id"]
            assert question["rationale"], question["id"]


def test_every_consult_hint_has_a_citable_reference():
    hints = {
        node.get("consult_hint")
        for node in load_pathways()["nodes"].values()
        if node.get("consult_hint")
    }
    assert hints
    for hint in hints:
        slice_text = reference_slice(hint)
        assert "§1" in slice_text, hint
        assert "Not a validated" in slice_text, hint


def test_reference_corpus_seeds_out_of_envelope_codes():
    # Beat-3 precondition kept as a property of the corpus: the grounding
    # text must mention at least one test code the envelope will refuse.
    hints = {
        node.get("consult_hint")
        for node in load_pathways()["nodes"].values()
        if node.get("consult_hint")
    }
    corpus = "".join(reference_slice(hint) for hint in hints)
    assert any(code in corpus for code in ("IMG-CTPA", "IMG-CXR", "IMG-CT-AORTA"))
    for code in ORDER_ENVELOPE:
        assert code in corpus


def test_unknown_pathway_node_falls_back_to_intake():
    suggestions = questions_for("no.such.node")
    assert suggestions.pathway_node == "intake"
    assert consult_hint_for("no.such.node") is None


def test_classification_label_set_matches_pathway_file():
    from app.service import classification_schema

    assert classification_schema()["properties"]["pathway_node"]["enum"] == node_ids()


async def test_echo_transcriber_decodes_text():
    from app.inference import EchoTranscriber

    result = await EchoTranscriber().transcribe(b"My chest hurts.\n", ".txt")
    assert result["text"] == "My chest hurts."

    with pytest.raises(ValueError):
        await EchoTranscriber().transcribe(b"", ".txt")
    with pytest.raises(ValueError):
        await EchoTranscriber().transcribe(b"\xff\xfe\x00", ".webm")


def test_stt_mode_override_selects_transcriber():
    from app.inference import EchoTranscriber, StubTranscriber, build_inference

    stub_settings = Settings(triage_mode="stub")
    transcriber, _ = build_inference(stub_settings)
    assert isinstance(transcriber, StubTranscriber)

    echo_settings = Settings(triage_mode="stub", triage_stt_mode="echo")
    transcriber, _ = build_inference(echo_settings)
    assert isinstance(transcriber, EchoTranscriber)


def test_order_envelope_refuses_unknown_code():
    proposal = Proposal(
        test_code="IMG-CTPA",
        label="CT pulmonary angiogram",
        rationale="Demo",
        citation="Local reference",
    )
    evaluated = evaluate_proposal(proposal)
    assert evaluated.status == "refused"
    assert "outside" in evaluated.policy_reason


def test_order_permit_is_bound_to_proposal_and_code():
    settings = Settings(order_permit_secret="test-secret")
    submitter = OrderSubmitter(settings)
    proposal = Proposal(
        test_code="LAB-CBC",
        label="Complete blood count",
        rationale="Demo",
        citation="Local reference",
    )
    permit = submitter.mint_permit(proposal)
    assert submitter.verify_permit(
        permit.token, proposal.proposal_id, proposal.test_code
    )
    assert not submitter.verify_permit(permit.token, "other", proposal.test_code)
