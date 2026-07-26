from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.governance import OrderSubmitter, evaluate_proposal
from app.main import app
from app.models import Proposal


def test_default_whisperx_model_is_large_v3_turbo():
    assert Settings().whisperx_model == "large-v3-turbo"


def test_direct_whisperx_endpoint_reports_runtime_and_transcript():
    class FakeWhisperXTranscriber:
        async def transcribe(self, audio_bytes: bytes, suffix: str):
            assert audio_bytes == b"speech"
            assert suffix == ".wav"
            return {"text": "The patient reports chest pain.", "duration_ms": 1800}

    with TestClient(app) as client:
        status = client.get("/whisperx/status")
        assert status.status_code == 200
        assert status.json() == {
            "model": "large-v3-turbo",
            "device": "cuda",
            "compute_type": "float16",
            "language": "en",
            "loaded": False,
        }

        app.state.whisperx_transcriber = FakeWhisperXTranscriber()
        response = client.post(
            "/whisperx/transcribe",
            files={"audio": ("sample.wav", b"speech", "audio/wav")},
        )
        assert response.status_code == 200
        assert response.json()["text"] == "The patient reports chest pain."
        assert response.json()["model"] == "large-v3-turbo"
        assert response.json()["device"] == "cuda"
        assert response.json()["duration_ms"] == 1800
        assert response.json()["processing_ms"] >= 0


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
