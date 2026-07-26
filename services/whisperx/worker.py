from __future__ import annotations

import gc
import hashlib
import json
import os
import signal
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://emergency_trial:emergency_trial@postgres:5432/emergency_trial",
)
DATA_ROOT = Path(os.environ.get("DATA_ROOT_CONTAINER", "/data")).resolve()
MODEL_NAME = os.environ.get("WHISPERX_MODEL", "medium")
DEVICE = os.environ.get("WHISPERX_DEVICE", "cuda")
COMPUTE_TYPE = os.environ.get("WHISPERX_COMPUTE_TYPE", "float16")
INITIAL_BATCH_SIZE = int(os.environ.get("WHISPERX_BATCH_SIZE", "4"))
HF_TOKEN = os.environ.get("HF_TOKEN") or None
BLOCK_WHILE_LIVE = os.environ.get("BLOCK_HEAVY_JOBS_WHILE_LIVE", "true").lower() == "true"
POLL_SECONDS = float(os.environ.get("WHISPERX_POLL_SECONDS", "2"))
RETENTION_DAYS = int(os.environ.get("AUDIO_RETENTION_DAYS", "30"))
GPU_LOCK_KEY = 2_147_483_001
WORKER_ID = f"whisperx:{os.uname().nodename}:{os.getpid()}:{uuid.uuid4().hex[:8]}"
RUNNING = True
STOP_EVENT = threading.Event()


@dataclass(frozen=True)
class Job:
    id: str
    recording_id: str
    owner_id: str
    attempts: int
    max_attempts: int


def log(level: str, message: str, **fields: Any) -> None:
    print(
        json.dumps(
            {
                "timestamp": datetime.now(UTC).isoformat(),
                "level": level,
                "service": "whisperx-worker",
                "message": message,
                **fields,
            },
            default=str,
        ),
        flush=True,
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_audio_path(raw_path: str) -> Path:
    path = Path(raw_path).resolve()
    if path != DATA_ROOT and DATA_ROOT not in path.parents:
        raise ValueError("Audio path is outside DATA_ROOT")
    if path.suffix.lower() != ".flac":
        raise ValueError("Expected a FLAC source")
    return path


def normalize_segments(raw_segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for raw in raw_segments:
        start_ms = max(0, round(float(raw.get("start", 0)) * 1000))
        end_ms = max(start_ms, round(float(raw.get("end", 0)) * 1000))
        words = []
        for word in raw.get("words") or []:
            start = word.get("start")
            end = word.get("end")
            words.append(
                {
                    "word": str(word.get("word", "")).strip(),
                    "startMs": round(float(start) * 1000) if start is not None else None,
                    "endMs": round(float(end) * 1000) if end is not None else None,
                    "score": word.get("score"),
                    "speaker": word.get("speaker"),
                }
            )
        segments.append(
            {
                "startMs": start_ms,
                "endMs": end_ms,
                "text": str(raw.get("text", "")).strip(),
                "speaker": raw.get("speaker"),
                "words": words,
            }
        )
    return segments


def transcribe(path: Path) -> tuple[str | None, list[dict[str, Any]]]:
    import torch
    import whisperx

    audio = whisperx.load_audio(str(path))
    last_error: Exception | None = None
    for batch_size in sorted({INITIAL_BATCH_SIZE, 2, 1}, reverse=True):
        model = None
        align_model = None
        try:
            model = whisperx.load_model(
                MODEL_NAME,
                DEVICE,
                compute_type=COMPUTE_TYPE,
            )
            result = model.transcribe(audio, batch_size=batch_size)
            language = result.get("language")
            del model
            gc.collect()
            if DEVICE == "cuda":
                torch.cuda.empty_cache()

            align_model, metadata = whisperx.load_align_model(
                language_code=language,
                device=DEVICE,
            )
            aligned = whisperx.align(
                result["segments"],
                align_model,
                metadata,
                audio,
                DEVICE,
                return_char_alignments=False,
            )
            del align_model
            gc.collect()
            if DEVICE == "cuda":
                torch.cuda.empty_cache()

            if HF_TOKEN:
                try:
                    from whisperx.diarize import DiarizationPipeline

                    diarizer = DiarizationPipeline(token=HF_TOKEN, device=DEVICE)
                    diarized = diarizer(audio)
                    aligned = whisperx.assign_word_speakers(diarized, aligned)
                    del diarizer
                except Exception as error:  # diarization is intentionally optional
                    log("warning", "diarization unavailable; continuing", error=str(error))

            return language, normalize_segments(aligned["segments"])
        except RuntimeError as error:
            last_error = error
            model = None
            align_model = None
            if "out of memory" not in str(error).lower() or batch_size == 1:
                raise
            log("warning", "gpu oom; retrying with smaller batch", batch_size=batch_size)
            gc.collect()
            if DEVICE == "cuda":
                torch.cuda.empty_cache()
    raise last_error or RuntimeError("WhisperX failed without an error")


def claim_job(connection: psycopg.Connection[Any]) -> Job | None:
    with connection.transaction(), connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            with candidate as (
              select id
              from jobs
              where type = 'whisperx_finalize'
                and (
                  (status = 'queued' and available_at <= now())
                  or (status in ('leased', 'running') and lease_expires_at < now())
                )
                and attempts < max_attempts
              order by available_at, created_at
              for update skip locked
              limit 1
            )
            update jobs
            set status = 'leased',
                lease_owner = %s,
                lease_expires_at = now() + interval '30 minutes',
                attempts = attempts + 1,
                updated_at = now()
            where id = (select id from candidate)
            returning id, recording_id, owner_id, attempts, max_attempts
            """,
            (WORKER_ID,),
        )
        row = cursor.fetchone()
        return Job(**row) if row else None


def defer_job(
    connection: psycopg.Connection[Any], job: Job, seconds: int, reason: str
) -> None:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            update jobs
            set status = 'queued',
                available_at = now() + (%s * interval '1 second'),
                attempts = greatest(attempts - 1, 0),
                lease_owner = null,
                lease_expires_at = null,
                last_error = %s,
                updated_at = now()
            where id = %s and lease_owner = %s
            """,
            (seconds, reason, job.id, WORKER_ID),
        )


def try_gpu_lock(connection: psycopg.Connection[Any]) -> bool:
    with connection.cursor() as cursor:
        cursor.execute("select pg_try_advisory_lock(%s)", (GPU_LOCK_KEY,))
        return bool(cursor.fetchone()[0])


def release_gpu_lock(connection: psycopg.Connection[Any]) -> None:
    with connection.cursor() as cursor:
        cursor.execute("select pg_advisory_unlock(%s)", (GPU_LOCK_KEY,))


def live_recording_exists(connection: psycopg.Connection[Any]) -> bool:
    with connection.cursor() as cursor:
        cursor.execute("select exists(select 1 from recordings where status = 'recording')")
        return bool(cursor.fetchone()[0])


def load_recording(
    connection: psycopg.Connection[Any], job: Job
) -> dict[str, Any]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            select id, owner_id, audio_path, audio_sha256
            from recordings
            where id = %s and owner_id = %s
            """,
            (job.recording_id, job.owner_id),
        )
        row = cursor.fetchone()
        if not row:
            raise ValueError("Recording no longer exists")
        if not row["audio_path"] or not row["audio_sha256"]:
            raise ValueError("Recording has no finalized audio source")
        return row


def persist_success(
    connection: psycopg.Connection[Any],
    job: Job,
    language: str | None,
    segments: list[dict[str, Any]],
) -> None:
    transcript_text = " ".join(segment["text"] for segment in segments).strip()
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            insert into transcripts
              (id, recording_id, kind, language, model, text, segments, version)
            values (%s, %s, 'final', %s, %s, %s, %s::jsonb, 1)
            on conflict (recording_id, kind) do update
            set language = excluded.language,
                model = excluded.model,
                text = excluded.text,
                segments = excluded.segments,
                version = transcripts.version + 1,
                updated_at = now()
            """,
            (
                str(uuid.uuid4()),
                job.recording_id,
                language,
                MODEL_NAME,
                transcript_text,
                json.dumps(segments),
            ),
        )
        cursor.execute(
            """
            update recordings
            set status = 'ready',
                failure_code = null,
                failure_message = null,
                updated_at = now()
            where id = %s
            """,
            (job.recording_id,),
        )
        cursor.execute(
            """
            select id
            from analyses
            where recording_id = %s and kind = 'meeting_brief'
            order by created_at
            limit 1
            """,
            (job.recording_id,),
        )
        existing_analysis = cursor.fetchone()
        analysis_id = (
            str(existing_analysis[0]) if existing_analysis else str(uuid.uuid4())
        )
        if not existing_analysis:
            cursor.execute(
                """
                insert into analyses
                  (id, recording_id, owner_id, kind, status)
                values (%s, %s, %s, 'meeting_brief', 'queued')
                """,
                (analysis_id, job.recording_id, job.owner_id),
            )
        cursor.execute(
            """
            insert into jobs
              (id, idempotency_key, type, status, recording_id, analysis_id, owner_id)
            values (%s, %s, 'analysis_meeting_brief', 'queued', %s, %s, %s)
            on conflict (idempotency_key) do nothing
            """,
            (
                str(uuid.uuid4()),
                f"brief:{job.recording_id}",
                job.recording_id,
                analysis_id,
                job.owner_id,
            ),
        )
        cursor.execute(
            """
            update jobs
            set status = 'succeeded',
                finished_at = now(),
                lease_owner = null,
                lease_expires_at = null,
                updated_at = now()
            where id = %s and lease_owner = %s
            """,
            (job.id, WORKER_ID),
        )


def persist_failure(
    connection: psycopg.Connection[Any], job: Job, error: Exception
) -> None:
    terminal = job.attempts >= job.max_attempts
    message = str(error)[:2000]
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            update jobs
            set status = case when %s then 'failed'::job_status else 'queued'::job_status end,
                available_at = case
                  when %s then available_at
                  else now() + (least(300, power(2, attempts)::int * 5) * interval '1 second')
                end,
                finished_at = case when %s then now() else null end,
                lease_owner = null,
                lease_expires_at = null,
                last_error = %s,
                updated_at = now()
            where id = %s and lease_owner = %s
            """,
            (terminal, terminal, terminal, message, job.id, WORKER_ID),
        )
        if terminal:
            cursor.execute(
                """
                update recordings
                set status = 'failed',
                    failure_code = 'WHISPERX_FAILED',
                    failure_message = %s,
                    updated_at = now()
                where id = %s
                """,
                (message, job.recording_id),
            )


def purge_expired_audio(connection: psycopg.Connection[Any]) -> int:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            select id
            from recordings
            where expires_at < now()
              and audio_path is not null
              and audio_purged_at is null
              and status not in ('recording', 'finalizing')
              and not exists (
                select 1
                from jobs
                where jobs.recording_id = recordings.id
                  and jobs.status in ('queued', 'leased', 'running')
              )
            limit 100
            """
        )
        rows = cursor.fetchall()
    purged = 0
    for row in rows:
        try:
            with (
                connection.transaction(),
                connection.cursor(row_factory=dict_row) as cursor,
            ):
                cursor.execute(
                    """
                    select id, owner_id, audio_path
                    from recordings
                    where id = %s
                      and expires_at < now()
                      and audio_path is not null
                      and audio_purged_at is null
                      and status not in ('recording', 'finalizing')
                      and not exists (
                        select 1
                        from jobs
                        where jobs.recording_id = recordings.id
                          and jobs.status in ('queued', 'leased', 'running')
                      )
                    for update
                    """,
                    (row["id"],),
                )
                candidate = cursor.fetchone()
                if not candidate:
                    continue
                path = safe_audio_path(candidate["audio_path"])
                path.unlink(missing_ok=True)
                cursor.execute(
                    """
                    update recordings
                    set audio_path = null,
                        audio_sha256 = null,
                        audio_bytes = null,
                        audio_purged_at = now(),
                        status = 'audio_expired',
                        updated_at = now()
                    where id = %s
                    """,
                    (row["id"],),
                )
                cursor.execute(
                    """
                    insert into audit_events
                      (owner_id, recording_id, action, details)
                    values (%s, %s, 'audio.retention_purged', %s::jsonb)
                    """,
                    (
                        candidate["owner_id"],
                        candidate["id"],
                        json.dumps({"retention_days": RETENTION_DAYS}),
                    ),
                )
            purged += 1
        except Exception as error:
            log("error", "audio retention purge failed", recording_id=row["id"], error=error)
    return purged


def process_job(connection: psycopg.Connection[Any], job: Job) -> None:
    if BLOCK_WHILE_LIVE and live_recording_exists(connection):
        defer_job(connection, job, 10, "Waiting for active live recording")
        return
    if not try_gpu_lock(connection):
        defer_job(connection, job, 5, "Waiting for GPU advisory lock")
        return
    if BLOCK_WHILE_LIVE and live_recording_exists(connection):
        release_gpu_lock(connection)
        defer_job(connection, job, 10, "Waiting for active live recording")
        return
    try:
        with connection.transaction(), connection.cursor() as cursor:
            cursor.execute(
                """
                update jobs
                set status = 'running', started_at = coalesce(started_at, now()), updated_at = now()
                where id = %s and lease_owner = %s
                """,
                (job.id, WORKER_ID),
            )
        recording = load_recording(connection, job)
        audio_path = safe_audio_path(recording["audio_path"])
        if not audio_path.is_file():
            raise FileNotFoundError("Audio source is missing")
        if sha256_file(audio_path) != recording["audio_sha256"]:
            raise ValueError("Audio source checksum mismatch")
        language, segments = transcribe(audio_path)
        persist_success(connection, job, language, segments)
        log(
            "info",
            "final transcript ready",
            job_id=job.id,
            recording_id=job.recording_id,
            segments=len(segments),
        )
    except Exception as error:
        persist_failure(connection, job, error)
        log(
            "error",
            "finalization failed",
            job_id=job.id,
            recording_id=job.recording_id,
            error=error,
        )
    finally:
        release_gpu_lock(connection)
        gc.collect()


def stop(_signum: int, _frame: Any) -> None:
    global RUNNING
    RUNNING = False
    STOP_EVENT.set()


def heartbeat_loop() -> None:
    while not STOP_EVENT.is_set():
        try:
            with (
                psycopg.connect(DATABASE_URL, autocommit=True) as connection,
                connection.cursor() as cursor,
            ):
                cursor.execute(
                    """
                    insert into service_heartbeats
                      (service, worker_id, status, details, updated_at)
                    values ('whisperx', %s, 'ok', %s::jsonb, now())
                    on conflict (service) do update
                    set worker_id = excluded.worker_id,
                        status = excluded.status,
                        details = excluded.details,
                        updated_at = now()
                    """,
                    (
                        WORKER_ID,
                        json.dumps(
                            {
                                "model": MODEL_NAME,
                                "device": DEVICE,
                                "batch_size": INITIAL_BATCH_SIZE,
                            }
                        ),
                    ),
                )
        except Exception as error:
            log("error", "heartbeat failed", error=error)
        STOP_EVENT.wait(10)


def main() -> None:
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    Path("/tmp/whisperx-worker-ready").touch(mode=0o600)
    last_retention = datetime.min.replace(tzinfo=UTC)
    log("info", "worker started", worker_id=WORKER_ID, model=MODEL_NAME)
    heartbeat_thread = threading.Thread(
        target=heartbeat_loop,
        name="whisperx-heartbeat",
        daemon=True,
    )
    heartbeat_thread.start()
    try:
        with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
            while RUNNING:
                now = datetime.now(UTC)
                if now - last_retention > timedelta(hours=1):
                    purged = purge_expired_audio(connection)
                    if purged:
                        log("info", "expired audio purged", count=purged)
                    last_retention = now
                job = claim_job(connection)
                if job:
                    process_job(connection, job)
                else:
                    time.sleep(POLL_SECONDS)
    finally:
        STOP_EVENT.set()
        heartbeat_thread.join(timeout=5)
        Path("/tmp/whisperx-worker-ready").unlink(missing_ok=True)
        log("info", "worker stopped")


if __name__ == "__main__":
    main()
