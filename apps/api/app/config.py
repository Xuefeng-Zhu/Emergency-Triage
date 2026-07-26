from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    triage_mode: Literal["stub", "live"] = "stub"
    # Overrides STT selection independently of triage_mode. "echo" decodes the
    # uploaded bytes as UTF-8 text — lets live-mode testing run hand-edited
    # transcript files through /utterance while live transcription is unavailable.
    triage_stt_mode: Literal["stub", "echo", "live"] | None = None
    triage_host: str = "0.0.0.0"
    triage_port: int = 8787
    triage_database_path: Path = Path("./data/triage.sqlite3")
    triage_web_origin: str = "http://localhost:5173"

    whisperx_model: str = "large-v3-turbo"
    whisperx_device: str = "cuda"
    whisperx_compute_type: str = "float16"
    whisperx_batch_size: int = 4
    whisperx_language: str = "en"

    nemoclaw_sandbox: str = "emergency-trial-agent"
    nemoclaw_timeout_seconds: int = 90
    mock_lis_url: str = "http://host.openshell.internal:8787/mock-lis/orders"
    order_permit_secret: str = "change-me-before-live-mode"


@lru_cache
def get_settings() -> Settings:
    return Settings()
