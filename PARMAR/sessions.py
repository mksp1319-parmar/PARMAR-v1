"""Server-side authenticated sessions for the HTTP boundary.

The repository protocol is provider-neutral. Persistent sessions store only a
hash of the opaque browser token.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator, Protocol
from uuid import UUID, uuid4

from PARMAR.identity import Principal

SESSION_COOKIE_NAME = "__Host-parmar_session"
_SESSION_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}\Z")


@dataclass(frozen=True)
class SessionPolicy:
    """Explicit session timeouts; deployments must provide both values."""

    idle_timeout_seconds: int
    absolute_timeout_seconds: int

    def __post_init__(self) -> None:
        for value in (self.idle_timeout_seconds, self.absolute_timeout_seconds):
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                raise ValueError("Session timeout values must be positive integers.")


@dataclass(frozen=True)
class ServerSession:
    """Server-owned session state; never serialized into a browser token."""

    session_id: UUID
    user_id: UUID
    authentication_source: str
    created_at: datetime
    last_activity_at: datetime
    idle_expires_at: datetime
    absolute_expires_at: datetime
    status: str = "ACTIVE"
    revoked_at: datetime | None = None
    replaced_by: UUID | None = None


@dataclass(frozen=True)
class SessionCredentials:
    """One-time server result containing the cookie value, excluded from repr."""

    session: ServerSession
    session_token: str = field(repr=False)


class SessionStorageUnavailable(RuntimeError):
    """Raised when persistent authenticated session storage is unavailable."""


class SessionRepository(Protocol):
    """Atomic persistence operations required by the session manager."""

    def create(self, session: ServerSession, token_hash: str) -> None: ...

    def get_by_token_hash(self, token_hash: str) -> ServerSession | None: ...

    def get_by_session_id(self, session_id: UUID) -> ServerSession | None: ...

    def resolve_and_touch(
        self,
        token_hash: str,
        now: datetime,
        idle_timeout_seconds: int,
    ) -> ServerSession | None: ...

    def revoke(self, session_id: UUID, now: datetime) -> bool: ...

    def rotate(
        self,
        old_token_hash: str,
        replacement: ServerSession,
        new_token_hash: str,
        now: datetime,
    ) -> ServerSession | None: ...


class InMemorySessionRepository:
    """Thread-safe, process-local repository for development and tests only."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._sessions: dict[UUID, ServerSession] = {}
        self._token_sessions: dict[str, UUID] = {}

    def create(self, session: ServerSession, token_hash: str) -> None:
        with self._lock:
            if session.session_id in self._sessions or token_hash in self._token_sessions:
                raise ValueError("Session identifier collision.")
            self._sessions[session.session_id] = session
            self._token_sessions[token_hash] = session.session_id

    def get_by_token_hash(self, token_hash: str) -> ServerSession | None:
        with self._lock:
            session_id = self._token_sessions.get(token_hash)
            return self._sessions.get(session_id) if session_id is not None else None

    def get_by_session_id(self, session_id: UUID) -> ServerSession | None:
        with self._lock:
            return self._sessions.get(session_id)

    def resolve_and_touch(
        self,
        token_hash: str,
        now: datetime,
        idle_timeout_seconds: int,
    ) -> ServerSession | None:
        with self._lock:
            session_id = self._token_sessions.get(token_hash)
            session = self._sessions.get(session_id) if session_id is not None else None
            if session is None or session.status != "ACTIVE":
                return None
            if now >= session.idle_expires_at or now >= session.absolute_expires_at:
                self._sessions[session.session_id] = replace(session, status="EXPIRED")
                return None
            next_idle_expiry = min(
                now + timedelta(seconds=idle_timeout_seconds),
                session.absolute_expires_at,
            )
            updated = replace(
                session,
                last_activity_at=now,
                idle_expires_at=next_idle_expiry,
            )
            self._sessions[session.session_id] = updated
            return updated

    def revoke(self, session_id: UUID, now: datetime) -> bool:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None or session.status != "ACTIVE":
                return False
            self._sessions[session_id] = replace(
                session,
                status="REVOKED",
                revoked_at=now,
            )
            return True

    def rotate(
        self,
        old_token_hash: str,
        replacement: ServerSession,
        new_token_hash: str,
        now: datetime,
    ) -> ServerSession | None:
        with self._lock:
            old_session_id = self._token_sessions.get(old_token_hash)
            old_session = self._sessions.get(old_session_id) if old_session_id is not None else None
            if (
                old_session is None
                or old_session.status != "ACTIVE"
                or now >= old_session.idle_expires_at
                or now >= old_session.absolute_expires_at
                or replacement.session_id in self._sessions
                or new_token_hash in self._token_sessions
            ):
                return None
            self._sessions[old_session.session_id] = replace(
                old_session,
                status="REVOKED",
                revoked_at=now,
                replaced_by=replacement.session_id,
            )
            self._sessions[replacement.session_id] = replacement
            self._token_sessions[new_token_hash] = replacement.session_id
            return replacement


class SQLiteSessionRepository:
    """SQLite-backed local session store with atomic expiry and rotation."""

    _SCHEMA_VERSION = 1

    def __init__(self, database_path: str | Path, *, integrity_key: bytes) -> None:
        path = Path(database_path).expanduser()
        if not str(path):
            raise ValueError("A session database path is required.")
        if not isinstance(integrity_key, bytes) or len(integrity_key) < 32:
            raise ValueError("The session storage integrity key must contain at least 32 bytes.")
        self.database_path = path if path.is_absolute() else Path.cwd() / path
        self._integrity_key = integrity_key
        self._lock = threading.RLock()
        self._initialized = False
        self._fresh_database = False
        self._database_identity: tuple[int, int] | None = None

    @classmethod
    def from_environment(cls, environ: dict[str, str] | None = None) -> "SQLiteSessionRepository":
        values = os.environ if environ is None else environ
        configured_path = values.get("PARMAR_SESSION_DB_PATH")
        if configured_path is not None and not configured_path.strip():
            raise ValueError("PARMAR_SESSION_DB_PATH must not be empty.")
        configured_key = values.get("PARMAR_SESSION_STORE_KEY")
        if configured_key is None:
            raise ValueError("PARMAR_SESSION_STORE_KEY is required when authenticated sessions are enabled.")
        integrity_key = configured_key.encode("utf-8")
        if len(integrity_key) < 32:
            raise ValueError("PARMAR_SESSION_STORE_KEY must contain at least 32 bytes.")
        path = (
            Path(configured_path).expanduser()
            if configured_path is not None
            else Path.home() / ".local" / "share" / "parmar" / "sessions.sqlite3"
        )
        return cls(path, integrity_key=integrity_key)

    @staticmethod
    def _timestamp(value: str) -> datetime:
        try:
            parsed = datetime.fromisoformat(value)
        except (TypeError, ValueError) as error:
            raise SessionStorageUnavailable("Authenticated session storage is unavailable.") from error
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise SessionStorageUnavailable("Authenticated session storage is unavailable.")
        return parsed.astimezone(timezone.utc)

    @staticmethod
    def _session_integrity_tag(session: ServerSession, token_hash: str, key: bytes) -> str:
        payload = [
            str(session.session_id),
            token_hash,
            str(session.user_id),
            session.authentication_source,
            session.created_at.isoformat(),
            session.last_activity_at.isoformat(),
            session.idle_expires_at.isoformat(),
            session.absolute_expires_at.isoformat(),
            session.status,
            session.revoked_at.isoformat() if session.revoked_at is not None else None,
            str(session.replaced_by) if session.replaced_by is not None else None,
        ]
        message = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("ascii")
        return hmac.new(key, b"PARMAR-SESSION-RECORD-v1:" + message, hashlib.sha256).hexdigest()

    def _session_from_row(self, row: sqlite3.Row) -> ServerSession:
        try:
            status = row["status"]
            authentication_source = row["authentication_source"]
            token_hash = row["token_hash"]
            if (
                status not in {"ACTIVE", "EXPIRED", "REVOKED"}
                or not isinstance(authentication_source, str)
                or not authentication_source.strip()
                or authentication_source.casefold() == "local-demo"
                or not isinstance(token_hash, str)
                or not re.fullmatch(r"[0-9a-f]{64}", token_hash)
                or not isinstance(row["integrity_tag"], str)
                or not re.fullmatch(r"[0-9a-f]{64}", row["integrity_tag"])
            ):
                raise ValueError("Invalid stored session.")
            session = ServerSession(
                session_id=UUID(row["session_id"]),
                user_id=UUID(row["user_id"]),
                authentication_source=authentication_source,
                created_at=self._timestamp(row["created_at"]),
                last_activity_at=self._timestamp(row["last_activity_at"]),
                idle_expires_at=self._timestamp(row["idle_expires_at"]),
                absolute_expires_at=self._timestamp(row["absolute_expires_at"]),
                status=status,
                revoked_at=self._timestamp(row["revoked_at"]) if row["revoked_at"] else None,
                replaced_by=UUID(row["replaced_by"]) if row["replaced_by"] else None,
            )
            if (
                session.last_activity_at < session.created_at
                or session.idle_expires_at <= session.last_activity_at
                or session.absolute_expires_at <= session.created_at
                or session.idle_expires_at > session.absolute_expires_at
                or (session.status == "REVOKED") != (session.revoked_at is not None)
                or (
                    session.status != "REVOKED"
                    and (session.revoked_at is not None or session.replaced_by is not None)
                )
            ):
                raise ValueError("Invalid stored session timestamps.")
            expected_tag = self._session_integrity_tag(session, token_hash, self._integrity_key)
            if not hmac.compare_digest(expected_tag, row["integrity_tag"]):
                raise ValueError("Invalid stored session integrity tag.")
            return session
        except (KeyError, TypeError, ValueError) as error:
            raise SessionStorageUnavailable("Authenticated session storage is unavailable.") from error

    def _prepare_file(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.database_path.is_symlink():
            raise OSError("Session database must not be a symbolic link.")
        if not self.database_path.exists():
            if self._initialized:
                raise OSError("Session database is missing.")
            try:
                descriptor = os.open(
                    self.database_path,
                    os.O_CREAT | os.O_EXCL | os.O_WRONLY,
                    0o600,
                )
            except FileExistsError:
                pass
            else:
                os.close(descriptor)
                self._fresh_database = True
        if not self.database_path.is_file():
            raise OSError("Session database path is not a file.")
        os.chmod(self.database_path, 0o600)
        stat = self.database_path.stat()
        identity = (stat.st_dev, stat.st_ino)
        if self._initialized and identity != self._database_identity:
            raise OSError("Session database has changed.")

    def _initialize(self, connection: sqlite3.Connection) -> None:
        if self._initialized:
            return
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version not in (0, self._SCHEMA_VERSION):
            raise SessionStorageUnavailable("Authenticated session storage is unavailable.")
        if version == 0:
            if not self._fresh_database:
                raise SessionStorageUnavailable("Authenticated session storage is unavailable.")
            existing_objects = connection.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('table', 'view', 'trigger') "
                "AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
            if existing_objects:
                raise SessionStorageUnavailable("Authenticated session storage is unavailable.")
            connection.executescript(
                """
                CREATE TABLE sessions (
                    session_id TEXT PRIMARY KEY,
                    token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64),
                    user_id TEXT NOT NULL,
                    authentication_source TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_activity_at TEXT NOT NULL,
                    idle_expires_at TEXT NOT NULL,
                    absolute_expires_at TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
                    revoked_at TEXT,
                    replaced_by TEXT,
                    integrity_tag TEXT NOT NULL CHECK(length(integrity_tag) = 64)
                );
                CREATE INDEX sessions_expiry ON sessions(status, idle_expires_at, absolute_expires_at);
                PRAGMA user_version = 1;
                """
            )
        integrity_result = connection.execute("PRAGMA quick_check").fetchone()
        if integrity_result is None or integrity_result[0] != "ok":
            raise SessionStorageUnavailable("Authenticated session storage is unavailable.")
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        if "sessions" not in tables:
            raise SessionStorageUnavailable("Authenticated session storage is unavailable.")
        columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(sessions)").fetchall()
        }
        if not {
            "session_id",
            "token_hash",
            "user_id",
            "authentication_source",
            "created_at",
            "last_activity_at",
            "idle_expires_at",
            "absolute_expires_at",
            "status",
            "revoked_at",
            "replaced_by",
            "integrity_tag",
        }.issubset(columns):
            raise SessionStorageUnavailable("Authenticated session storage is unavailable.")
        stat = self.database_path.stat()
        self._database_identity = (stat.st_dev, stat.st_ino)
        self._initialized = True

    @contextmanager
    def _connection(self, *, write: bool = False) -> Iterator[sqlite3.Connection]:
        try:
            with self._lock:
                self._prepare_file()
                connection = sqlite3.connect(self.database_path, timeout=5, isolation_level=None)
                connection.row_factory = sqlite3.Row
                try:
                    self._initialize(connection)
                    if write:
                        connection.execute("BEGIN IMMEDIATE")
                    try:
                        yield connection
                    except Exception:
                        if write:
                            connection.rollback()
                        raise
                    else:
                        if write:
                            connection.commit()
                finally:
                    connection.close()
        except SessionStorageUnavailable:
            raise
        except (OSError, sqlite3.Error) as error:
            raise SessionStorageUnavailable("Authenticated session storage is unavailable.") from error

    @staticmethod
    def _session_values(session: ServerSession) -> tuple[str, ...]:
        return (
            str(session.session_id),
            str(session.user_id),
            session.authentication_source,
            session.created_at.isoformat(),
            session.last_activity_at.isoformat(),
            session.idle_expires_at.isoformat(),
            session.absolute_expires_at.isoformat(),
            session.status,
            session.revoked_at.isoformat() if session.revoked_at is not None else None,
            str(session.replaced_by) if session.replaced_by is not None else None,
        )

    def create(self, session: ServerSession, token_hash: str) -> None:
        if (
            not isinstance(session, ServerSession)
            or not isinstance(token_hash, str)
            or not re.fullmatch(r"[0-9a-f]{64}", token_hash)
        ):
            raise ValueError("Invalid session record.")
        with self._connection(write=True) as connection:
            connection.execute(
                "INSERT INTO sessions(session_id, user_id, authentication_source, created_at, "
                "last_activity_at, idle_expires_at, absolute_expires_at, status, revoked_at, "
                "replaced_by, token_hash, integrity_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    *self._session_values(session),
                    token_hash,
                    self._session_integrity_tag(session, token_hash, self._integrity_key),
                ),
            )

    def get_by_token_hash(self, token_hash: str) -> ServerSession | None:
        if not isinstance(token_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", token_hash):
            return None
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM sessions WHERE token_hash = ?",
                (token_hash,),
            ).fetchone()
            return self._session_from_row(row) if row is not None else None

    def get_by_session_id(self, session_id: UUID) -> ServerSession | None:
        if not isinstance(session_id, UUID):
            return None
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM sessions WHERE session_id = ?",
                (str(session_id),),
            ).fetchone()
            return self._session_from_row(row) if row is not None else None

    def resolve_and_touch(
        self,
        token_hash: str,
        now: datetime,
        idle_timeout_seconds: int,
    ) -> ServerSession | None:
        if not isinstance(token_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", token_hash):
            return None
        with self._connection(write=True) as connection:
            row = connection.execute(
                "SELECT * FROM sessions WHERE token_hash = ?",
                (token_hash,),
            ).fetchone()
            if row is None:
                return None
            session = self._session_from_row(row)
            if session.status != "ACTIVE":
                return None
            if now >= session.idle_expires_at or now >= session.absolute_expires_at:
                expired = replace(session, status="EXPIRED")
                connection.execute(
                    "UPDATE sessions SET status = 'EXPIRED', integrity_tag = ? WHERE session_id = ?",
                    (
                        self._session_integrity_tag(expired, row["token_hash"], self._integrity_key),
                        str(session.session_id),
                    ),
                )
                return None
            updated_idle_expiry = min(
                now + timedelta(seconds=idle_timeout_seconds),
                session.absolute_expires_at,
            )
            connection.execute(
                "UPDATE sessions SET last_activity_at = ?, idle_expires_at = ?, integrity_tag = ? "
                "WHERE session_id = ? AND status = 'ACTIVE'",
                (
                    now.isoformat(),
                    updated_idle_expiry.isoformat(),
                    self._session_integrity_tag(
                        replace(
                            session,
                            last_activity_at=now,
                            idle_expires_at=updated_idle_expiry,
                        ),
                        row["token_hash"],
                        self._integrity_key,
                    ),
                    str(session.session_id),
                ),
            )
            return replace(
                session,
                last_activity_at=now,
                idle_expires_at=updated_idle_expiry,
            )

    def revoke(self, session_id: UUID, now: datetime) -> bool:
        if not isinstance(session_id, UUID):
            return False
        with self._connection(write=True) as connection:
            row = connection.execute(
                "SELECT * FROM sessions WHERE session_id = ?",
                (str(session_id),),
            ).fetchone()
            if row is None:
                return False
            session = self._session_from_row(row)
            if session.status != "ACTIVE":
                return False
            revoked = replace(session, status="REVOKED", revoked_at=now)
            cursor = connection.execute(
                "UPDATE sessions SET status = 'REVOKED', revoked_at = ?, integrity_tag = ? "
                "WHERE session_id = ? AND status = 'ACTIVE'",
                (
                    now.isoformat(),
                    self._session_integrity_tag(revoked, row["token_hash"], self._integrity_key),
                    str(session_id),
                ),
            )
            return cursor.rowcount == 1

    def rotate(
        self,
        old_token_hash: str,
        replacement: ServerSession,
        new_token_hash: str,
        now: datetime,
    ) -> ServerSession | None:
        if (
            not isinstance(old_token_hash, str)
            or not re.fullmatch(r"[0-9a-f]{64}", old_token_hash)
            or not isinstance(new_token_hash, str)
            or not re.fullmatch(r"[0-9a-f]{64}", new_token_hash)
        ):
            return None
        with self._connection(write=True) as connection:
            row = connection.execute(
                "SELECT * FROM sessions WHERE token_hash = ?",
                (old_token_hash,),
            ).fetchone()
            if row is None:
                return None
            old_session = self._session_from_row(row)
            if (
                old_session.status != "ACTIVE"
                or now >= old_session.idle_expires_at
                or now >= old_session.absolute_expires_at
                or replacement.user_id != old_session.user_id
                or replacement.authentication_source != old_session.authentication_source
                or replacement.status != "ACTIVE"
                or replacement.session_id == old_session.session_id
                or replacement.absolute_expires_at != old_session.absolute_expires_at
            ):
                return None
            revoked = replace(
                old_session,
                status="REVOKED",
                revoked_at=now,
                replaced_by=replacement.session_id,
            )
            cursor = connection.execute(
                "UPDATE sessions SET status = 'REVOKED', revoked_at = ?, replaced_by = ?, integrity_tag = ? "
                "WHERE session_id = ? AND status = 'ACTIVE'",
                (
                    now.isoformat(),
                    str(replacement.session_id),
                    self._session_integrity_tag(revoked, row["token_hash"], self._integrity_key),
                    str(old_session.session_id),
                ),
            )
            if cursor.rowcount != 1:
                return None
            connection.execute(
                "INSERT INTO sessions(session_id, user_id, authentication_source, created_at, "
                "last_activity_at, idle_expires_at, absolute_expires_at, status, revoked_at, "
                "replaced_by, token_hash, integrity_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    *self._session_values(replacement),
                    new_token_hash,
                    self._session_integrity_tag(replacement, new_token_hash, self._integrity_key),
                ),
            )
            return replacement


class SessionManager:
    """Create, resolve, rotate, revoke, and CSRF-bind server-side sessions."""

    def __init__(
        self,
        repository: SessionRepository,
        policy: SessionPolicy,
        *,
        csrf_secret: bytes | None = None,
    ) -> None:
        required_methods = (
            "create",
            "get_by_token_hash",
            "get_by_session_id",
            "resolve_and_touch",
            "revoke",
            "rotate",
        )
        if any(not callable(getattr(repository, name, None)) for name in required_methods):
            raise TypeError("A session repository implementation is required.")
        self.repository = repository
        self.policy = policy
        self._csrf_secret = csrf_secret or secrets.token_bytes(32)
        if len(self._csrf_secret) < 32:
            raise ValueError("The CSRF signing secret must contain at least 32 bytes.")

    @staticmethod
    def _now(value: datetime | None) -> datetime:
        current = value or datetime.now(timezone.utc)
        if current.tzinfo is None or current.utcoffset() is None:
            raise ValueError("Session timestamps must be timezone-aware.")
        return current.astimezone(timezone.utc)

    @staticmethod
    def _token_hash(token: object) -> str | None:
        if not isinstance(token, str) or not _SESSION_TOKEN_PATTERN.fullmatch(token):
            return None
        return hashlib.sha256(token.encode("ascii")).hexdigest()

    def create_authenticated_session(
        self,
        user_id: UUID,
        authentication_source: str,
        *,
        now: datetime | None = None,
    ) -> SessionCredentials:
        principal = Principal.authenticated_user(user_id, authentication_source)
        current = self._now(now)
        absolute_expiry = current + timedelta(seconds=self.policy.absolute_timeout_seconds)
        session = ServerSession(
            session_id=uuid4(),
            user_id=principal.user_id,
            authentication_source=principal.authentication_source,
            created_at=current,
            last_activity_at=current,
            idle_expires_at=min(
                current + timedelta(seconds=self.policy.idle_timeout_seconds),
                absolute_expiry,
            ),
            absolute_expires_at=absolute_expiry,
        )
        token = secrets.token_urlsafe(32)
        token_hash = self._token_hash(token)
        if token_hash is None:
            raise RuntimeError("Session token generation failed.")
        self.repository.create(session, token_hash)
        return SessionCredentials(session=session, session_token=token)

    def resolve(self, token: object, *, now: datetime | None = None) -> ServerSession | None:
        token_hash = self._token_hash(token)
        if token_hash is None:
            return None
        return self.repository.resolve_and_touch(
            token_hash,
            self._now(now),
            self.policy.idle_timeout_seconds,
        )

    def rotate(
        self,
        token: object,
        *,
        now: datetime | None = None,
    ) -> SessionCredentials | None:
        token_hash = self._token_hash(token)
        if token_hash is None:
            return None
        current = self._now(now)
        old_session = self.resolve(token, now=current)
        if old_session is None:
            return None
        replacement_id = uuid4()
        replacement = ServerSession(
            session_id=replacement_id,
            user_id=old_session.user_id,
            authentication_source=old_session.authentication_source,
            created_at=current,
            last_activity_at=current,
            idle_expires_at=min(
                current + timedelta(seconds=self.policy.idle_timeout_seconds),
                old_session.absolute_expires_at,
            ),
            absolute_expires_at=old_session.absolute_expires_at,
        )
        new_token = secrets.token_urlsafe(32)
        new_token_hash = self._token_hash(new_token)
        if new_token_hash is None:
            raise RuntimeError("Session token generation failed.")
        rotated = self.repository.rotate(
            token_hash,
            replacement,
            new_token_hash,
            current,
        )
        if rotated is None:
            return None
        return SessionCredentials(session=rotated, session_token=new_token)

    def revoke(self, session_id: UUID, *, now: datetime | None = None) -> bool:
        return self.repository.revoke(session_id, self._now(now))

    def logout(self, token: object, *, now: datetime | None = None) -> bool:
        token_hash = self._token_hash(token)
        if token_hash is None:
            return False
        session = self.repository.get_by_token_hash(token_hash)
        if session is None:
            return False
        return self.revoke(session.session_id, now=now)

    def csrf_token(self, session_id: UUID, *, now: datetime | None = None) -> str | None:
        session = self.repository.get_by_session_id(session_id)
        current = self._now(now)
        if (
            session is None
            or session.status != "ACTIVE"
            or current >= session.idle_expires_at
            or current >= session.absolute_expires_at
        ):
            return None
        digest = hmac.new(
            self._csrf_secret,
            b"PARMAR-CSRF-v1:" + session_id.bytes,
            hashlib.sha256,
        ).digest()
        return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")

    def validate_csrf(
        self,
        session_id: UUID,
        token: object,
        *,
        now: datetime | None = None,
    ) -> bool:
        expected = self.csrf_token(session_id, now=now)
        return (
            expected is not None
            and isinstance(token, str)
            and hmac.compare_digest(expected, token)
        )


def session_cookie_header(token: str) -> str:
    """Format the authenticated cookie; Secure is mandatory for __Host cookies."""
    if SessionManager._token_hash(token) is None:
        raise ValueError("Invalid session token.")
    return f"{SESSION_COOKIE_NAME}={token}; Path=/; HttpOnly; Secure; SameSite=Lax"


def clear_session_cookie_header() -> str:
    return f"{SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"


def session_manager_from_environment(
    environ: dict[str, str] | None = None,
) -> SessionManager | None:
    """Enable persistent sessions only when both timeout values are explicit."""
    values = os.environ if environ is None else environ
    idle = values.get("PARMAR_SESSION_IDLE_SECONDS")
    absolute = values.get("PARMAR_SESSION_ABSOLUTE_SECONDS")
    if idle is None and absolute is None:
        return None
    if idle is None or absolute is None:
        raise ValueError("Both PARMAR session timeout settings are required.")
    try:
        policy = SessionPolicy(
            idle_timeout_seconds=int(idle),
            absolute_timeout_seconds=int(absolute),
        )
    except (TypeError, ValueError):
        raise ValueError("PARMAR session timeout settings must be positive integers.") from None
    return SessionManager(SQLiteSessionRepository.from_environment(values), policy)