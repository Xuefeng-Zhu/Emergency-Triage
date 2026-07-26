import json
import sqlite3
from pathlib import Path
from threading import RLock

from .models import TriageSession


class SessionRepository:
    """In-memory session state with a SQLite JSON journal for demo recovery."""

    def __init__(self, database_path: Path):
        self._database_path = database_path
        self._sessions: dict[str, TriageSession] = {}
        self._lock = RLock()
        database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS session_journal (
                    session_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            rows = connection.execute(
                "SELECT session_id, payload FROM session_journal"
            ).fetchall()
        for session_id, payload in rows:
            self._sessions[session_id] = TriageSession.model_validate_json(payload)

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._database_path)

    def save(self, session: TriageSession) -> TriageSession:
        with self._lock:
            snapshot = session.model_copy(deep=True)
            self._sessions[session.session_id] = snapshot
            with self._connect() as connection:
                connection.execute(
                    """
                    INSERT INTO session_journal(session_id, payload, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(session_id) DO UPDATE SET
                      payload = excluded.payload,
                      updated_at = CURRENT_TIMESTAMP
                    """,
                    (session.session_id, json.dumps(snapshot.model_dump(mode="json"))),
                )
            return snapshot.model_copy(deep=True)

    def get(self, session_id: str) -> TriageSession | None:
        with self._lock:
            session = self._sessions.get(session_id)
            return session.model_copy(deep=True) if session else None

    def all(self) -> list[TriageSession]:
        with self._lock:
            return [session.model_copy(deep=True) for session in self._sessions.values()]
