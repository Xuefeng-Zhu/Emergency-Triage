from datetime import UTC, datetime
from enum import StrEnum
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


class ProposalStatus(StrEnum):
    PROPOSED = "proposed"
    APPROVED = "approved"
    SUBMITTED = "submitted"
    DENIED = "denied"
    REFUSED = "refused"


class Utterance(BaseModel):
    utterance_id: str = Field(default_factory=lambda: new_id("utt"))
    text: str
    speaker: Literal["nurse", "patient"] = "patient"
    created_at: str = Field(default_factory=now_iso)
    duration_ms: int = 0


class Question(BaseModel):
    id: str
    text: str
    rationale: str


class Suggestions(BaseModel):
    pathway_node: str
    questions: list[Question]


class Proposal(BaseModel):
    proposal_id: str = Field(default_factory=lambda: new_id("prop"))
    test_code: str
    label: str
    rationale: str
    citation: str
    status: ProposalStatus = ProposalStatus.PROPOSED
    policy_reason: str | None = None


class AuditEntry(BaseModel):
    audit_id: str = Field(default_factory=lambda: new_id("audit"))
    ts: str = Field(default_factory=now_iso)
    actor: str
    action: str
    proposal_id: str | None = None
    outcome: str


class TriageSession(BaseModel):
    session_id: str = Field(default_factory=lambda: new_id("session"))
    started_at: str = Field(default_factory=now_iso)
    transcript: list[Utterance] = Field(default_factory=list)
    suggestions: Suggestions = Field(
        default_factory=lambda: Suggestions(pathway_node="intake", questions=[])
    )
    proposals: list[Proposal] = Field(default_factory=list)
    audit: list[AuditEntry] = Field(default_factory=list)


class SessionCreated(BaseModel):
    session_id: str
    started_at: str


class ConsultResponse(BaseModel):
    consult_id: str = Field(default_factory=lambda: new_id("consult"))
    proposals: list[Proposal]


class DecisionRequest(BaseModel):
    decision: Literal["approve", "deny"]
    approver_id: str = Field(min_length=1, max_length=80)
    approver_name: str = Field(min_length=1, max_length=120)


class DecisionResponse(BaseModel):
    proposal_id: str
    status: ProposalStatus
    order_ref: str | None = None
    audit_id: str


class MockOrderRequest(BaseModel):
    proposal_id: str
    test_code: str
    label: str


class MockOrderResponse(BaseModel):
    order_ref: str = Field(default_factory=lambda: new_id("LIS"))
    status: Literal["accepted"] = "accepted"
