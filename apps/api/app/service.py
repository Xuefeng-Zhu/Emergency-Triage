from pathlib import Path

from fastapi import HTTPException, UploadFile

from .governance import OrderSubmitter, evaluate_proposal
from .inference import CompletionEngine, Transcriber
from .models import (
    AuditEntry,
    ConsultResponse,
    DecisionRequest,
    DecisionResponse,
    Proposal,
    ProposalStatus,
    SessionCreated,
    TriageSession,
    Utterance,
)
from .pathways import questions_for
from .repository import SessionRepository

CLASSIFICATION_SCHEMA = {
    "type": "object",
    "required": ["pathway_node"],
    "properties": {
        "pathway_node": {
            "enum": [
                "intake",
                "chest_pain.initial",
                "shortness_of_breath.initial",
                "abdominal_pain.initial",
            ]
        }
    },
}

CONSULT_SCHEMA = {
    "type": "object",
    "required": ["proposals"],
    "properties": {
        "proposals": {
            "type": "array",
            "items": {
                "type": "object",
                "required": [
                    "test_code",
                    "label",
                    "rationale",
                    "citation",
                ],
            },
        }
    },
}


class TriageService:
    def __init__(
        self,
        repository: SessionRepository,
        transcriber: Transcriber,
        completion: CompletionEngine,
        submitter: OrderSubmitter,
    ):
        self.repository = repository
        self.transcriber = transcriber
        self.completion = completion
        self.submitter = submitter

    def create_session(self) -> SessionCreated:
        session = TriageSession()
        session.suggestions = questions_for("intake")
        self.repository.save(session)
        return SessionCreated(
            session_id=session.session_id, started_at=session.started_at
        )

    def get_session(self, session_id: str) -> TriageSession:
        session = self.repository.get(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        return session

    async def add_utterance(
        self, session_id: str, audio: UploadFile, speaker: str
    ) -> Utterance:
        session = self.get_session(session_id)
        audio_bytes = await audio.read()
        suffix = Path(audio.filename or "utterance.webm").suffix
        try:
            result = await self.transcriber.transcribe(audio_bytes, suffix)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        utterance = Utterance(
            text=result["text"],
            duration_ms=result["duration_ms"],
            speaker="nurse" if speaker == "nurse" else "patient",
        )
        session.transcript.append(utterance)
        transcript = "\n".join(
            f"{item.speaker}: {item.text}" for item in session.transcript
        )
        classification = await self.completion.complete(
            (
                "Map this transcript to exactly one pathway node. Do not diagnose. "
                f"Transcript:\n{transcript}"
            ),
            CLASSIFICATION_SCHEMA,
            "fast",
        )
        session.suggestions = questions_for(
            classification.get("pathway_node", "intake")
        )
        self.repository.save(session)
        return utterance

    async def consult(self, session_id: str) -> ConsultResponse:
        session = self.get_session(session_id)
        transcript = "\n".join(
            f"{item.speaker}: {item.text}" for item in session.transcript
        )
        result = await self.completion.complete(
            (
                "Generate diagnostic test proposals with rationale and a local reference "
                "citation. Include clinically plausible proposals even when they may be "
                "outside the permitted order envelope; policy evaluation happens next. "
                f"Transcript:\n{transcript}"
            ),
            CONSULT_SCHEMA,
            "reason",
        )
        proposals = [
            evaluate_proposal(Proposal.model_validate(item))
            for item in result.get("proposals", [])
        ]
        session.proposals = proposals
        for proposal in proposals:
            session.audit.append(
                AuditEntry(
                    actor="System policy",
                    action="proposal_precheck",
                    proposal_id=proposal.proposal_id,
                    outcome=proposal.status,
                )
            )
        self.repository.save(session)
        return ConsultResponse(proposals=proposals)

    async def decide(
        self, proposal_id: str, request: DecisionRequest
    ) -> DecisionResponse:
        session = next(
            (
                candidate
                for candidate in self.repository.all()
                if any(p.proposal_id == proposal_id for p in candidate.proposals)
            ),
            None,
        )
        if not session:
            raise HTTPException(status_code=404, detail="Proposal not found")
        proposal = next(p for p in session.proposals if p.proposal_id == proposal_id)
        if proposal.status != ProposalStatus.PROPOSED:
            raise HTTPException(
                status_code=409,
                detail=f"Proposal is already {proposal.status}",
            )

        order_ref = None
        if request.decision == "deny":
            proposal.status = ProposalStatus.DENIED
        else:
            proposal.status = ProposalStatus.APPROVED
            self.repository.save(session)
            try:
                order_ref = await self.submitter.submit(proposal)
            except Exception as error:
                proposal.status = ProposalStatus.APPROVED
                audit = AuditEntry(
                    actor=request.approver_name,
                    action="approve",
                    proposal_id=proposal_id,
                    outcome="egress_failed",
                )
                session.audit.append(audit)
                self.repository.save(session)
                raise HTTPException(
                    status_code=502,
                    detail="Order egress failed closed; the approval remains recorded.",
                ) from error
            proposal.status = ProposalStatus.SUBMITTED

        audit = AuditEntry(
            actor=request.approver_name,
            action=request.decision,
            proposal_id=proposal_id,
            outcome=proposal.status,
        )
        session.audit.append(audit)
        self.repository.save(session)
        return DecisionResponse(
            proposal_id=proposal_id,
            status=proposal.status,
            order_ref=order_ref,
            audit_id=audit.audit_id,
        )
