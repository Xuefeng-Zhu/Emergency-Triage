import logging
from contextlib import asynccontextmanager
from pathlib import Path
from time import perf_counter

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .governance import OrderSubmitter
from .inference import WhisperXTranscriber, build_inference
from .models import (
    AuditEntry,
    ConsultResponse,
    DecisionRequest,
    DecisionResponse,
    MockOrderRequest,
    MockOrderResponse,
    SessionCreated,
    Suggestions,
    TranscriptionResponse,
    TriageSession,
    Utterance,
)
from .repository import SessionRepository
from .service import TriageService

logger = logging.getLogger(__name__)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    repository = SessionRepository(settings.triage_database_path)
    transcriber, completion = build_inference(settings)
    whisperx_transcriber = (
        transcriber
        if isinstance(transcriber, WhisperXTranscriber)
        else WhisperXTranscriber(settings)
    )
    submitter = OrderSubmitter(settings)
    app.state.service = TriageService(
        repository, transcriber, completion, submitter
    )
    app.state.submitter = submitter
    app.state.whisperx_transcriber = whisperx_transcriber
    app.state.whisperx_preload_error = None

    # Only when STT is genuinely live: in stub and echo modes `whisperx_transcriber`
    # is a spare instance backing the /whisperx debug endpoints, and preloading it
    # would pull a GPU model into a run that is meant to stay off the GPU.
    if settings.whisperx_preload and isinstance(transcriber, WhisperXTranscriber):
        started_at = perf_counter()
        try:
            await transcriber.preload()
        except Exception as error:  # noqa: BLE001 - reported, never fatal
            # Not fatal: the unit runs Restart=on-failure, so raising here would
            # crash-loop the whole governance surface over a degraded GPU. Report
            # it on /whisperx/status instead and let the operator decide.
            app.state.whisperx_preload_error = str(error)
            logger.exception("WhisperX preload failed; STT will retry per utterance")
        else:
            logger.info(
                "WhisperX preloaded in %d ms",
                round((perf_counter() - started_at) * 1000),
            )
    yield


app = FastAPI(
    title="Emergency Trial Triage API",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.triage_web_origin],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def service() -> TriageService:
    return app.state.service


@app.get("/healthz")
def health() -> dict:
    return {
        "status": "ok",
        "mode": settings.triage_mode,
        "stt_mode": settings.triage_stt_mode or settings.triage_mode,
        "local_processing": True,
        "egress_default": "deny",
    }


@app.get("/whisperx/status")
def whisperx_status() -> dict:
    return {
        "model": settings.whisperx_model,
        "device": settings.whisperx_device,
        "compute_type": settings.whisperx_compute_type,
        "language": settings.whisperx_language,
        "loaded": app.state.whisperx_transcriber._model is not None,
        "preload_error": app.state.whisperx_preload_error,
    }


@app.post("/whisperx/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(audio: UploadFile = File(...)) -> TranscriptionResponse:
    audio_bytes = await audio.read()
    suffix = Path(audio.filename or "sample.webm").suffix
    started_at = perf_counter()
    try:
        result = await app.state.whisperx_transcriber.transcribe(audio_bytes, suffix)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return TranscriptionResponse(
        text=result["text"],
        duration_ms=result["duration_ms"],
        processing_ms=round((perf_counter() - started_at) * 1000),
        model=settings.whisperx_model,
        device=settings.whisperx_device,
    )


@app.post("/session", response_model=SessionCreated)
def create_session() -> SessionCreated:
    return service().create_session()


@app.get("/session/{session_id}", response_model=TriageSession)
def get_session(session_id: str) -> TriageSession:
    return service().get_session(session_id)


@app.post("/session/{session_id}/utterance", response_model=Utterance)
async def add_utterance(
    session_id: str,
    audio: UploadFile = File(...),
    speaker: str = Form("patient"),
) -> Utterance:
    return await service().add_utterance(session_id, audio, speaker)


@app.get("/session/{session_id}/suggestions", response_model=Suggestions)
def suggestions(session_id: str) -> Suggestions:
    return service().get_session(session_id).suggestions


@app.post("/session/{session_id}/consult", response_model=ConsultResponse)
async def consult(session_id: str) -> ConsultResponse:
    return await service().consult(session_id)


@app.post("/proposal/{proposal_id}/decision", response_model=DecisionResponse)
async def decide(
    proposal_id: str, request: DecisionRequest
) -> DecisionResponse:
    return await service().decide(proposal_id, request)


@app.get("/session/{session_id}/audit", response_model=list[AuditEntry])
def audit(session_id: str) -> list[AuditEntry]:
    return service().get_session(session_id).audit


@app.post("/mock-lis/orders", response_model=MockOrderResponse)
def mock_lis(
    order: MockOrderRequest,
    x_order_permit: str = Header(default=""),
) -> MockOrderResponse:
    if not app.state.submitter.verify_permit(
        x_order_permit, order.proposal_id, order.test_code
    ):
        raise HTTPException(status_code=403, detail="Invalid or expired order permit")
    return MockOrderResponse()
