import asyncio
import base64
import hashlib
import hmac
import json
import subprocess
import time
from dataclasses import dataclass

from .config import Settings
from .models import MockOrderResponse, Proposal, ProposalStatus


ORDER_ENVELOPE: dict[str, str] = {
    "LAB-CBC": "Complete blood count",
    "LAB-CMP": "Comprehensive metabolic panel",
    "LAB-TROP-HS": "High-sensitivity troponin I",
    "ECG-12": "12-lead ECG",
}


def evaluate_proposal(proposal: Proposal) -> Proposal:
    if proposal.test_code not in ORDER_ENVELOPE:
        proposal.status = ProposalStatus.REFUSED
        proposal.policy_reason = (
            f"{proposal.test_code} is outside the demo's declared order envelope."
        )
    return proposal


@dataclass(frozen=True)
class OrderPermit:
    token: str
    expires_at: int


class OrderSubmitter:
    def __init__(self, settings: Settings):
        self.settings = settings

    def mint_permit(self, proposal: Proposal) -> OrderPermit:
        expires_at = int(time.time()) + 60
        payload = f"{proposal.proposal_id}:{proposal.test_code}:{expires_at}"
        signature = hmac.new(
            self.settings.order_permit_secret.encode(),
            payload.encode(),
            hashlib.sha256,
        ).digest()
        encoded_payload = base64.urlsafe_b64encode(payload.encode()).decode()
        encoded_signature = base64.urlsafe_b64encode(signature).decode()
        token = f"{encoded_payload}.{encoded_signature}"
        return OrderPermit(token=token, expires_at=expires_at)

    def verify_permit(self, token: str, proposal_id: str, test_code: str) -> bool:
        try:
            encoded_payload, encoded_signature = token.split(".", 1)
            payload_bytes = base64.urlsafe_b64decode(encoded_payload.encode())
            signature = base64.urlsafe_b64decode(encoded_signature.encode())
            payload = payload_bytes.decode()
            signed_proposal, signed_code, expiry = payload.split(":")
            expected = hmac.new(
                self.settings.order_permit_secret.encode(),
                payload_bytes,
                hashlib.sha256,
            ).digest()
            return (
                hmac.compare_digest(signature, expected)
                and signed_proposal == proposal_id
                and signed_code == test_code
                and int(expiry) >= int(time.time())
            )
        except (ValueError, UnicodeDecodeError):
            return False

    def _submit_live(self, proposal: Proposal, permit: OrderPermit) -> str:
        body = json.dumps(
            {
                "proposal_id": proposal.proposal_id,
                "test_code": proposal.test_code,
                "label": proposal.label,
            }
        )
        completed = subprocess.run(
            [
                "nemoclaw",
                self.settings.nemoclaw_sandbox,
                "exec",
                "--",
                "curl",
                "--fail-with-body",
                "--silent",
                "--show-error",
                "-X",
                "POST",
                "-H",
                "Content-Type: application/json",
                "-H",
                f"X-Order-Permit: {permit.token}",
                "--data-binary",
                body,
                self.settings.mock_lis_url,
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return MockOrderResponse.model_validate_json(completed.stdout).order_ref

    async def submit(self, proposal: Proposal) -> str:
        permit = self.mint_permit(proposal)
        if self.settings.triage_mode == "stub":
            return f"LIS_STUB_{proposal.proposal_id[-6:]}"
        return await asyncio.to_thread(self._submit_live, proposal, permit)
