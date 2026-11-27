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
from typing import Callable, Iterator, Protocol
from uuid import UUID, uuid4

from PARMAR.identity import Principal, TRUSTED_IDENTITY_SOURCE
from PARMAR.identity_contracts import (
    AccountIdentity,
    AuthenticationContext,
    AuthenticatedPrincipal,
    IdentityEvidenceState,
    TrustedIdentityResolver,
    authentication_is_current,
)

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
    active_profile_id: UUID | None = None
    account_identity: AccountIdentity | None = None
    authentication_context: AuthenticationContext | None = None
    identity_evidence_id: UUID | None = None

    def __post_init__(self) -> None:
        if self.account_identity is None:
            if (
                self.authentication_context is not None
                or self.identity_evidence_id is not None
                or self.authentication_source == TRUSTED_IDENTITY_SOURCE
            ):
                raise ValueError("Trusted identity sessions require a canonical account binding.")
        elif (
            type(self.account_identity) is not AccountIdentity
            or type(self.authentication_context) is not AuthenticationContext
            or self.user_id != self.account_identity.value
            or self.authentication_source != TRUSTED_IDENTITY_SOURCE
            or (
                self.identity_evidence_id is not None
                and (
                    type(self.identity_evidence_id) is not UUID
                    or self.identity_evidence_id != self.authentication_context.evidence_id
                )
            )
            or not (
                self.authentication_context.authenticated_at
                <= self.created_at
                < self.authentication_context.expires_at
            )
            or self.absolute_expires_at > self.authentication_context.expires_at
        ):
            raise ValueError("Trusted identity session binding is invalid.")


@dataclass(frozen=True)
class SessionCredentials:
    """One-time server result containing the cookie value, excluded from repr."""

    session: ServerSession
    session_token: str = field(repr=False)


@dataclass(frozen=True)
class _IdentityEvidenceRecord:
    evidence_id: UUID
    account_identity: AccountIdentity
    authentication_context: AuthenticationContext
    state: IdentityEvidenceState
    session_id: UUID


class SessionStorageUnavailable(RuntimeError):
    """Raised when persistent authenticated session storage is unavailable."""


class SessionRepository(Protocol):
    """Atomic persistence operations required by the session manager."""

    def create(self, session: ServerSession, token_hash: str) -> None: ...

    def create_identity(self, session: ServerSession, token_hash: str) -> bool: ...

    def get_by_token_hash(self, token_hash: str) -> ServerSession | None: ...

    def get_by_session_id(self, session_id: UUID) -> ServerSession | None: ...

    def resolve_and_touch(
        self,
        token_hash: str,
        now: datetime,
        idle_timeout_seconds: int,
    ) -> ServerSession | None: ...

    def revoke(self, session_id: UUID, now: datetime) -> bool: ...

    def revoke_account(self, account_identity: AccountIdentity, now: datetime) -> bool: ...

    def revoke_identity_evidence(
        self,
        evidence_id: UUID,
        now: datetime,
        state: IdentityEvidenceState,
    ) -> bool: ...

    def get_identity_evidence_state(
        self,
        evidence_id: UUID,
    ) -> IdentityEvidenceState | None: ...

    def select_profile(
        self,
        session_id: UUID,
        user_id: UUID,
        profile_id: UUID,
        now: datetime,
    ) -> ServerSession | None: ...

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
        self._identity_evidence: dict[UUID, _IdentityEvidenceRecord] = {}

    def create(self, session: ServerSession, token_hash: str) -> None:
        with self._lock:
            if (
                session.account_identity is not None
                or session.session_id in self._sessions
                or token_hash in self._token_sessions
            ):
                raise ValueError("Session identifier collision.")
            self._sessions[session.session_id] = session
            self._token_sessions[token_hash] = session.session_id

    @staticmethod
    def _identity_record_matches(
        session: ServerSession,
        record: _IdentityEvidenceRecord | None,
    ) -> bool:
        return (
            record is not None
            and record.state is IdentityEvidenceState.ACTIVE
            and session.identity_evidence_id == record.evidence_id
            and session.account_identity == record.account_identity
            and session.authentication_context == record.authentication_context
            and session.session_id == record.session_id
        )

    def _terminate_identity_session(
        self,
        session: ServerSession,
        now: datetime,
        state: IdentityEvidenceState,
    ) -> None:
        evidence_id = session.identity_evidence_id
        record = self._identity_evidence.get(evidence_id) if evidence_id is not None else None
        if self._identity_record_matches(session, record):
            self._identity_evidence[evidence_id] = replace(record, state=state)
        self._sessions[session.session_id] = replace(
            session,
            status="EXPIRED" if state is IdentityEvidenceState.EXPIRED else "REVOKED",
            revoked_at=now if state is not IdentityEvidenceState.EXPIRED else None,
            active_profile_id=None,
        )

    def create_identity(self, session: ServerSession, token_hash: str) -> bool:
        if (
            not isinstance(session, ServerSession)
            or session.account_identity is None
            or session.authentication_context is None
            or session.identity_evidence_id is None
            or session.status != "ACTIVE"
            or not isinstance(token_hash, str)
            or not re.fullmatch(r"[0-9a-f]{64}", token_hash)
        ):
            return False
        with self._lock:
            if (
                session.session_id in self._sessions
                or token_hash in self._token_sessions
                or session.identity_evidence_id in self._identity_evidence
                or not authentication_is_current(
                    session.authentication_context,
                    now=session.created_at,
                )
            ):
                return False
            self._sessions[session.session_id] = session
            self._token_sessions[token_hash] = session.session_id
            self._identity_evidence[session.identity_evidence_id] = _IdentityEvidenceRecord(
                session.identity_evidence_id,
                session.account_identity,
                session.authentication_context,
                IdentityEvidenceState.ACTIVE,
                session.session_id,
            )
            return True

    def get_identity_evidence_state(
        self,
        evidence_id: UUID,
    ) -> IdentityEvidenceState | None:
        if type(evidence_id) is not UUID:
            return None
        with self._lock:
            record = self._identity_evidence.get(evidence_id)
            return record.state if record is not None else None

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
            if session.account_identity is not None:
                record = self._identity_evidence.get(session.identity_evidence_id)
                if not self._identity_record_matches(session, record):
                    self._sessions[session.session_id] = replace(
                        session,
                        status="REVOKED",
                        revoked_at=now,
                        active_profile_id=None,
                    )
                    return None
                if not authentication_is_current(session.authentication_context, now=now):
                    self._terminate_identity_session(
                        session,
                        now,
                        IdentityEvidenceState.EXPIRED,
                    )
                    return None
            if now >= session.idle_expires_at or now >= session.absolute_expires_at:
                if session.account_identity is not None:
                    self._terminate_identity_session(
                        session,
                        now,
                        IdentityEvidenceState.EXPIRED,
                    )
                else:
                    self._sessions[session.session_id] = replace(
                        session,
                        status="EXPIRED",
                        active_profile_id=None,
                    )
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
            if session.account_identity is not None:
                record = self._identity_evidence.get(session.identity_evidence_id)
                if self._identity_record_matches(session, record):
                    self._identity_evidence[session.identity_evidence_id] = replace(
                        record,
                        state=IdentityEvidenceState.REVOKED,
                    )
            self._sessions[session_id] = replace(
                session,
                status="REVOKED",
                revoked_at=now,
                active_profile_id=None,
            )
            return True

    def revoke_account(self, account_identity: AccountIdentity, now: datetime) -> bool:
        if type(account_identity) is not AccountIdentity:
            return False
        revoked_any = False
        with self._lock:
            for session in tuple(self._sessions.values()):
                if session.account_identity != account_identity or session.status != "ACTIVE":
                    continue
                record = self._identity_evidence.get(session.identity_evidence_id)
                if self._identity_record_matches(session, record):
                    self._identity_evidence[record.evidence_id] = replace(
                        record,
                        state=IdentityEvidenceState.REVOKED,
                    )
                self._sessions[session.session_id] = replace(
                    session,
                    status="REVOKED",
                    revoked_at=now,
                    active_profile_id=None,
                )
                revoked_any = True
        return revoked_any

    def revoke_identity_evidence(
        self,
        evidence_id: UUID,
        now: datetime,
        state: IdentityEvidenceState,
    ) -> bool:
        if (
            type(state) is not IdentityEvidenceState
            or state not in (IdentityEvidenceState.REVOKED, IdentityEvidenceState.SUPERSEDED)
        ):
            return False
        with self._lock:
            record = self._identity_evidence.get(evidence_id)
            if record is None or record.state is not IdentityEvidenceState.ACTIVE:
                return False
            session = self._sessions.get(record.session_id)
            if session is None or not self._identity_record_matches(session, record):
                return False
            if not authentication_is_current(record.authentication_context, now=now):
                self._terminate_identity_session(
                    session,
                    now,
                    IdentityEvidenceState.EXPIRED,
                )
                return False
            self._identity_evidence[evidence_id] = replace(record, state=state)
            self._sessions[session.session_id] = replace(
                session,
                status="REVOKED",
                revoked_at=now,
                active_profile_id=None,
            )
            return True

    def select_profile(
        self,
        session_id: UUID,
        user_id: UUID,
        profile_id: UUID,
        now: datetime,
    ) -> ServerSession | None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None or session.user_id != user_id or session.status != "ACTIVE":
                return None
            if session.account_identity is not None:
                record = self._identity_evidence.get(session.identity_evidence_id)
                if not self._identity_record_matches(session, record):
                    self._sessions[session.session_id] = replace(
                        session,
                        status="REVOKED",
                        revoked_at=now,
                        active_profile_id=None,
                    )
                    return None
                if (
                    now >= session.idle_expires_at
                    or now >= session.absolute_expires_at
                    or not authentication_is_current(session.authentication_context, now=now)
                ):
                    self._terminate_identity_session(
                        session,
                        now,
                        IdentityEvidenceState.EXPIRED,
                    )
                    return None
            elif now >= session.idle_expires_at or now >= session.absolute_expires_at:
                return None
            updated = replace(session, active_profile_id=profile_id)
            self._sessions[session_id] = updated
            return updated

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
            evidence_record = (
                self._identity_evidence.get(old_session.identity_evidence_id)
                if old_session is not None and old_session.identity_evidence_id is not None
                else None
            )
            if (
                old_session is None
                or old_session.status != "ACTIVE"
                or now >= old_session.idle_expires_at
                or now >= old_session.absolute_expires_at
                or replacement.user_id != old_session.user_id
                or replacement.account_identity != old_session.account_identity
                or replacement.authentication_context != old_session.authentication_context
                or replacement.identity_evidence_id != old_session.identity_evidence_id
                or replacement.authentication_source != old_session.authentication_source
                or replacement.absolute_expires_at != old_session.absolute_expires_at
                or replacement.status != "ACTIVE"
                or replacement.session_id in self._sessions
                or new_token_hash in self._token_sessions
            ):
                return None
            if old_session.account_identity is not None and (
                not self._identity_record_matches(old_session, evidence_record)
                or not authentication_is_current(old_session.authentication_context, now=now)
            ):
                if self._identity_record_matches(old_session, evidence_record):
                    self._terminate_identity_session(
                        old_session,
                        now,
                        IdentityEvidenceState.EXPIRED,
                    )
                else:
                    self._sessions[old_session.session_id] = replace(
                        old_session,
                        status="REVOKED",
                        revoked_at=now,
                        active_profile_id=None,
                    )
                return None
            self._sessions[old_session.session_id] = replace(
                old_session,
                status="REVOKED",
                revoked_at=now,
                replaced_by=replacement.session_id,
                active_profile_id=None,
            )
            self._sessions[replacement.session_id] = replacement
            self._token_sessions[new_token_hash] = replacement.session_id
            if evidence_record is not None:
                self._identity_evidence[old_session.identity_evidence_id] = replace(
                    evidence_record,
                    session_id=replacement.session_id,
                )
            return replacement


class SQLiteSessionRepository:
    """SQLite-backed local session store with atomic expiry and rotation."""

    _SCHEMA_VERSION = 4

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

    def _csrf_signing_secret(self) -> bytes:
        return hashlib.sha256(
            b"PARMAR-CSRF-SIGNING-KEY-v1\0" + self._integrity_key
        ).digest()

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
        if session.account_identity is not None:
            if session.active_profile_id is not None:
                payload.append(str(session.active_profile_id))
            payload.append(session.account_identity.serialize())
            payload.extend((
                session.authentication_context.authenticated_at.isoformat(),
                session.authentication_context.expires_at.isoformat(),
            ))
            if session.identity_evidence_id is None:
                prefix = b"PARMAR-SESSION-RECORD-v3:"
            else:
                payload.append(str(session.identity_evidence_id))
                prefix = b"PARMAR-SESSION-RECORD-v4:"
        elif session.active_profile_id is None:
            prefix = b"PARMAR-SESSION-RECORD-v1:"
        else:
            payload.append(str(session.active_profile_id))
            prefix = b"PARMAR-SESSION-RECORD-v2:"
        message = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("ascii")
        return hmac.new(key, prefix + message, hashlib.sha256).hexdigest()

    @staticmethod
    def _identity_evidence_integrity_tag(
        record: _IdentityEvidenceRecord,
        key: bytes,
    ) -> str:
        payload = [
            str(record.evidence_id),
            record.account_identity.serialize(),
            record.authentication_context.authenticated_at.isoformat(),
            record.authentication_context.expires_at.isoformat(),
            record.state.value,
            str(record.session_id),
        ]
        message = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("ascii")
        return hmac.new(
            key,
            b"PARMAR-IDENTITY-EVIDENCE-v1:" + message,
            hashlib.sha256,
        ).hexdigest()

    def _identity_evidence_from_row(self, row: sqlite3.Row) -> _IdentityEvidenceRecord:
        try:
            evidence_id = UUID(row["evidence_id"])
            record = _IdentityEvidenceRecord(
                evidence_id=evidence_id,
                account_identity=AccountIdentity.parse(row["account_identity"]),
                authentication_context=AuthenticationContext(
                    self._timestamp(row["authenticated_at"]),
                    self._timestamp(row["expires_at"]),
                    evidence_id,
                ),
                state=IdentityEvidenceState(row["state"]),
                session_id=UUID(row["session_id"]),
            )
            if (
                evidence_id.version != 4
                or not isinstance(row["integrity_tag"], str)
                or not re.fullmatch(r"[0-9a-f]{64}", row["integrity_tag"])
                or not hmac.compare_digest(
                    self._identity_evidence_integrity_tag(record, self._integrity_key),
                    row["integrity_tag"],
                )
            ):
                raise ValueError("Invalid stored identity evidence.")
            return record
        except (KeyError, TypeError, ValueError) as error:
            raise SessionStorageUnavailable(
                "Authenticated session storage is unavailable."
            ) from error

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
                active_profile_id=(
                    UUID(row["active_profile_id"]) if row["active_profile_id"] else None
                ),
                account_identity=(
                    AccountIdentity.parse(row["account_identity"])
                    if row["account_identity"] is not None
                    else None
                ),
                authentication_context=(
                    AuthenticationContext(
                        self._timestamp(row["identity_authenticated_at"]),
                        self._timestamp(row["identity_expires_at"]),
                        UUID(row["identity_evidence_id"])
                        if row["identity_evidence_id"] is not None
                        else uuid4(),
                    )
                    if row["identity_authenticated_at"] is not None
                    and row["identity_expires_at"] is not None
                    else None
                ),
                identity_evidence_id=(
                    UUID(row["identity_evidence_id"])
                    if row["identity_evidence_id"] is not None
                    else None
                ),
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
                or (session.status != "ACTIVE" and session.active_profile_id is not None)
                or (
                    session.account_identity is not None
                    and (
                        session.account_identity.value != session.user_id
                        or session.authentication_source != TRUSTED_IDENTITY_SOURCE
                        or session.authentication_context is None
                        or (
                            session.identity_evidence_id is not None
                            and session.identity_evidence_id
                            != session.authentication_context.evidence_id
                        )
                    )
                )
                or (
                    session.authentication_source == TRUSTED_IDENTITY_SOURCE
                    and session.account_identity is None
                )
                or (
                    (row["identity_authenticated_at"] is None)
                    != (row["identity_expires_at"] is None)
                )
                or (
                    session.account_identity is None
                    and (
                        row["identity_authenticated_at"] is not None
                        or row["identity_expires_at"] is not None
                    )
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
        if version not in (0, 1, 2, 3, self._SCHEMA_VERSION):
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
                    account_identity TEXT,
                    identity_authenticated_at TEXT,
                    identity_expires_at TEXT,
                    identity_evidence_id TEXT,
                    authentication_source TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_activity_at TEXT NOT NULL,
                    idle_expires_at TEXT NOT NULL,
                    absolute_expires_at TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
                    revoked_at TEXT,
                    replaced_by TEXT,
                    active_profile_id TEXT,
                    integrity_tag TEXT NOT NULL CHECK(length(integrity_tag) = 64)
                );
                CREATE INDEX sessions_expiry ON sessions(status, idle_expires_at, absolute_expires_at);
                CREATE TABLE identity_evidence (
                    evidence_id TEXT PRIMARY KEY,
                    account_identity TEXT NOT NULL,
                    authenticated_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    state TEXT NOT NULL CHECK(state IN ('ACTIVE', 'EXPIRED', 'REVOKED', 'SUPERSEDED')),
                    session_id TEXT NOT NULL,
                    integrity_tag TEXT NOT NULL CHECK(length(integrity_tag) = 64)
                );
                PRAGMA user_version = 4;
                """
            )
        elif version == 1:
            connection.execute("BEGIN IMMEDIATE")
            try:
                connection.execute("ALTER TABLE sessions ADD COLUMN active_profile_id TEXT")
                connection.execute("PRAGMA user_version = 2")
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            version = 2
        if version == 2:
            connection.execute("BEGIN IMMEDIATE")
            try:
                connection.execute("ALTER TABLE sessions ADD COLUMN account_identity TEXT")
                connection.execute("ALTER TABLE sessions ADD COLUMN identity_authenticated_at TEXT")
                connection.execute("ALTER TABLE sessions ADD COLUMN identity_expires_at TEXT")
                connection.execute("PRAGMA user_version = 3")
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            version = 3
        if version == 3:
            connection.execute("BEGIN IMMEDIATE")
            try:
                connection.execute("ALTER TABLE sessions ADD COLUMN identity_evidence_id TEXT")
                connection.execute(
                    "CREATE TABLE identity_evidence ("
                    "evidence_id TEXT PRIMARY KEY, account_identity TEXT NOT NULL, "
                    "authenticated_at TEXT NOT NULL, expires_at TEXT NOT NULL, "
                    "state TEXT NOT NULL CHECK(state IN "
                    "('ACTIVE', 'EXPIRED', 'REVOKED', 'SUPERSEDED')), "
                    "session_id TEXT NOT NULL, "
                    "integrity_tag TEXT NOT NULL CHECK(length(integrity_tag) = 64))"
                )
                rows = connection.execute(
                    "SELECT * FROM sessions WHERE authentication_source = ? AND status = 'ACTIVE'",
                    (TRUSTED_IDENTITY_SOURCE,),
                ).fetchall()
                for row in rows:
                    old_session = self._session_from_row(row)
                    revoked = replace(
                        old_session,
                        status="REVOKED",
                        revoked_at=datetime.now(timezone.utc),
                        active_profile_id=None,
                    )
                    connection.execute(
                        "UPDATE sessions SET status = 'REVOKED', revoked_at = ?, "
                        "active_profile_id = NULL, integrity_tag = ? WHERE session_id = ?",
                        (
                            revoked.revoked_at.isoformat(),
                            self._session_integrity_tag(
                                revoked,
                                row["token_hash"],
                                self._integrity_key,
                            ),
                            str(revoked.session_id),
                        ),
                    )
                connection.execute("PRAGMA user_version = 4")
                connection.commit()
            except Exception:
                connection.rollback()
                raise
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
        if "identity_evidence" not in tables:
            raise SessionStorageUnavailable("Authenticated session storage is unavailable.")
        columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(sessions)").fetchall()
        }
        if not {
            "session_id",
            "token_hash",
            "user_id",
            "account_identity",
            "identity_authenticated_at",
            "identity_expires_at",
            "identity_evidence_id",
            "authentication_source",
            "created_at",
            "last_activity_at",
            "idle_expires_at",
            "absolute_expires_at",
            "status",
            "revoked_at",
            "replaced_by",
            "active_profile_id",
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
                    connection.execute("PRAGMA foreign_keys=ON")
                    if connection.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
                        raise SessionStorageUnavailable("Authenticated session storage is unavailable.")
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
            session.account_identity.serialize() if session.account_identity is not None else None,
            (
                session.authentication_context.authenticated_at.isoformat()
                if session.authentication_context is not None
                else None
            ),
            (
                session.authentication_context.expires_at.isoformat()
                if session.authentication_context is not None
                else None
            ),
            (
                str(session.identity_evidence_id)
                if session.identity_evidence_id is not None
                else None
            ),
            session.authentication_source,
            session.created_at.isoformat(),
            session.last_activity_at.isoformat(),
            session.idle_expires_at.isoformat(),
            session.absolute_expires_at.isoformat(),
            session.status,
            session.revoked_at.isoformat() if session.revoked_at is not None else None,
            str(session.replaced_by) if session.replaced_by is not None else None,
            str(session.active_profile_id) if session.active_profile_id is not None else None,
        )

    def create(self, session: ServerSession, token_hash: str) -> None:
        if (
            not isinstance(session, ServerSession)
            or session.account_identity is not None
            or not isinstance(token_hash, str)
            or not re.fullmatch(r"[0-9a-f]{64}", token_hash)
        ):
            raise ValueError("Invalid session record.")
        with self._connection(write=True) as connection:
            connection.execute(
                "INSERT INTO sessions(session_id, user_id, account_identity, identity_authenticated_at, "
                "identity_expires_at, identity_evidence_id, authentication_source, created_at, "
                "last_activity_at, idle_expires_at, absolute_expires_at, status, revoked_at, "
                "replaced_by, active_profile_id, token_hash, integrity_tag) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    *self._session_values(session),
                    token_hash,
                    self._session_integrity_tag(session, token_hash, self._integrity_key),
                ),
            )

    def create_identity(self, session: ServerSession, token_hash: str) -> bool:
        if (
            not isinstance(session, ServerSession)
            or session.account_identity is None
            or session.authentication_context is None
            or session.identity_evidence_id is None
            or session.status != "ACTIVE"
            or not isinstance(token_hash, str)
            or not re.fullmatch(r"[0-9a-f]{64}", token_hash)
            or not authentication_is_current(
                session.authentication_context,
                now=session.created_at,
            )
        ):
            return False
        evidence = _IdentityEvidenceRecord(
            session.identity_evidence_id,
            session.account_identity,
            session.authentication_context,
            IdentityEvidenceState.ACTIVE,
            session.session_id,
        )
        with self._connection(write=True) as connection:
            if connection.execute(
                "SELECT 1 FROM identity_evidence WHERE evidence_id = ?",
                (str(evidence.evidence_id),),
            ).fetchone() is not None:
                return False
            if connection.execute(
                "SELECT 1 FROM sessions WHERE session_id = ? OR token_hash = ?",
                (str(session.session_id), token_hash),
            ).fetchone() is not None:
                return False
            connection.execute(
                "INSERT INTO sessions(session_id, user_id, account_identity, identity_authenticated_at, "
                "identity_expires_at, identity_evidence_id, authentication_source, created_at, "
                "last_activity_at, idle_expires_at, absolute_expires_at, status, revoked_at, "
                "replaced_by, active_profile_id, token_hash, integrity_tag) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    *self._session_values(session),
                    token_hash,
                    self._session_integrity_tag(session, token_hash, self._integrity_key),
                ),
            )
            connection.execute(
                "INSERT INTO identity_evidence(evidence_id, account_identity, authenticated_at, "
                "expires_at, state, session_id, integrity_tag) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    str(evidence.evidence_id),
                    evidence.account_identity.serialize(),
                    evidence.authentication_context.authenticated_at.isoformat(),
                    evidence.authentication_context.expires_at.isoformat(),
                    evidence.state.value,
                    str(evidence.session_id),
                    self._identity_evidence_integrity_tag(evidence, self._integrity_key),
                ),
            )
            return True

    def _active_evidence_for_session(
        self,
        connection: sqlite3.Connection,
        session: ServerSession,
    ) -> _IdentityEvidenceRecord | None:
        if session.identity_evidence_id is None:
            return None
        row = connection.execute(
            "SELECT * FROM identity_evidence WHERE evidence_id = ?",
            (str(session.identity_evidence_id),),
        ).fetchone()
        if row is None:
            return None
        record = self._identity_evidence_from_row(row)
        if (
            record.state is not IdentityEvidenceState.ACTIVE
            or record.evidence_id != session.identity_evidence_id
            or record.account_identity != session.account_identity
            or record.authentication_context != session.authentication_context
            or record.session_id != session.session_id
        ):
            return None
        return record

    def _write_evidence_state(
        self,
        connection: sqlite3.Connection,
        record: _IdentityEvidenceRecord,
        state: IdentityEvidenceState,
        *,
        session_id: UUID | None = None,
    ) -> _IdentityEvidenceRecord:
        updated = replace(
            record,
            state=state,
            session_id=session_id if session_id is not None else record.session_id,
        )
        connection.execute(
            "UPDATE identity_evidence SET state = ?, session_id = ?, integrity_tag = ? "
            "WHERE evidence_id = ?",
            (
                updated.state.value,
                str(updated.session_id),
                self._identity_evidence_integrity_tag(updated, self._integrity_key),
                str(updated.evidence_id),
            ),
        )
        return updated

    def _terminate_identity_session(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
        session: ServerSession,
        now: datetime,
        state: IdentityEvidenceState,
    ) -> None:
        record = self._active_evidence_for_session(connection, session)
        if record is not None:
            self._write_evidence_state(connection, record, state)
        expired = state is IdentityEvidenceState.EXPIRED
        terminal = replace(
            session,
            status="EXPIRED" if expired else "REVOKED",
            revoked_at=None if expired else now,
            active_profile_id=None,
        )
        connection.execute(
            "UPDATE sessions SET status = ?, revoked_at = ?, active_profile_id = NULL, "
            "integrity_tag = ? WHERE session_id = ? AND status = 'ACTIVE'",
            (
                terminal.status,
                terminal.revoked_at.isoformat() if terminal.revoked_at else None,
                self._session_integrity_tag(
                    terminal,
                    row["token_hash"],
                    self._integrity_key,
                ),
                str(session.session_id),
            ),
        )

    def get_identity_evidence_state(
        self,
        evidence_id: UUID,
    ) -> IdentityEvidenceState | None:
        if type(evidence_id) is not UUID:
            return None
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM identity_evidence WHERE evidence_id = ?",
                (str(evidence_id),),
            ).fetchone()
            return (
                self._identity_evidence_from_row(row).state
                if row is not None
                else None
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
            if session.account_identity is not None:
                evidence = self._active_evidence_for_session(connection, session)
                if evidence is None:
                    self._terminate_identity_session(
                        connection,
                        row,
                        session,
                        now,
                        IdentityEvidenceState.REVOKED,
                    )
                    return None
                if not authentication_is_current(session.authentication_context, now=now):
                    self._terminate_identity_session(
                        connection,
                        row,
                        session,
                        now,
                        IdentityEvidenceState.EXPIRED,
                    )
                    return None
            if now >= session.idle_expires_at or now >= session.absolute_expires_at:
                if session.account_identity is not None:
                    self._terminate_identity_session(
                        connection,
                        row,
                        session,
                        now,
                        IdentityEvidenceState.EXPIRED,
                    )
                else:
                    expired = replace(session, status="EXPIRED", active_profile_id=None)
                    connection.execute(
                        "UPDATE sessions SET status = 'EXPIRED', active_profile_id = NULL, integrity_tag = ? "
                        "WHERE session_id = ?",
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
            if session.account_identity is not None:
                evidence = self._active_evidence_for_session(connection, session)
                if evidence is not None:
                    self._write_evidence_state(
                        connection,
                        evidence,
                        IdentityEvidenceState.REVOKED,
                    )
            revoked = replace(session, status="REVOKED", revoked_at=now, active_profile_id=None)
            cursor = connection.execute(
                "UPDATE sessions SET status = 'REVOKED', revoked_at = ?, active_profile_id = NULL, integrity_tag = ? "
                "WHERE session_id = ? AND status = 'ACTIVE'",
                (
                    now.isoformat(),
                    self._session_integrity_tag(revoked, row["token_hash"], self._integrity_key),
                    str(session_id),
                ),
            )
            return cursor.rowcount == 1

    def revoke_account(self, account_identity: AccountIdentity, now: datetime) -> bool:
        if type(account_identity) is not AccountIdentity:
            return False
        revoked_any = False
        with self._connection(write=True) as connection:
            rows = connection.execute(
                "SELECT * FROM sessions WHERE account_identity = ? AND status = 'ACTIVE'",
                (account_identity.serialize(),),
            ).fetchall()
            for row in rows:
                session = self._session_from_row(row)
                if session.account_identity != account_identity:
                    raise SessionStorageUnavailable(
                        "Authenticated session storage is unavailable."
                    )
                evidence = self._active_evidence_for_session(connection, session)
                if evidence is not None:
                    self._write_evidence_state(
                        connection,
                        evidence,
                        IdentityEvidenceState.REVOKED,
                    )
                revoked = replace(
                    session,
                    status="REVOKED",
                    revoked_at=now,
                    active_profile_id=None,
                )
                cursor = connection.execute(
                    "UPDATE sessions SET status = 'REVOKED', revoked_at = ?, "
                    "active_profile_id = NULL, integrity_tag = ? "
                    "WHERE session_id = ? AND status = 'ACTIVE'",
                    (
                        now.isoformat(),
                        self._session_integrity_tag(
                            revoked,
                            row["token_hash"],
                            self._integrity_key,
                        ),
                        str(session.session_id),
                    ),
                )
                revoked_any = revoked_any or cursor.rowcount == 1
        return revoked_any

    def revoke_identity_evidence(
        self,
        evidence_id: UUID,
        now: datetime,
        state: IdentityEvidenceState,
    ) -> bool:
        if (
            type(evidence_id) is not UUID
            or type(state) is not IdentityEvidenceState
            or state not in (IdentityEvidenceState.REVOKED, IdentityEvidenceState.SUPERSEDED)
        ):
            return False
        with self._connection(write=True) as connection:
            evidence_row = connection.execute(
                "SELECT * FROM identity_evidence WHERE evidence_id = ?",
                (str(evidence_id),),
            ).fetchone()
            if evidence_row is None:
                return False
            evidence = self._identity_evidence_from_row(evidence_row)
            if evidence.state is not IdentityEvidenceState.ACTIVE:
                return False
            session_row = connection.execute(
                "SELECT * FROM sessions WHERE session_id = ?",
                (str(evidence.session_id),),
            ).fetchone()
            if session_row is None:
                return False
            session = self._session_from_row(session_row)
            if (
                session.status != "ACTIVE"
                or session.identity_evidence_id != evidence_id
                or session.account_identity != evidence.account_identity
                or session.authentication_context != evidence.authentication_context
            ):
                return False
            if not authentication_is_current(evidence.authentication_context, now=now):
                self._terminate_identity_session(
                    connection,
                    session_row,
                    session,
                    now,
                    IdentityEvidenceState.EXPIRED,
                )
                return False
            self._write_evidence_state(connection, evidence, state)
            revoked = replace(
                session,
                status="REVOKED",
                revoked_at=now,
                active_profile_id=None,
            )
            connection.execute(
                "UPDATE sessions SET status = 'REVOKED', revoked_at = ?, active_profile_id = NULL, "
                "integrity_tag = ? WHERE session_id = ? AND status = 'ACTIVE'",
                (
                    now.isoformat(),
                    self._session_integrity_tag(
                        revoked,
                        session_row["token_hash"],
                        self._integrity_key,
                    ),
                    str(session.session_id),
                ),
            )
            return True

    def select_profile(
        self,
        session_id: UUID,
        user_id: UUID,
        profile_id: UUID,
        now: datetime,
    ) -> ServerSession | None:
        if not all(isinstance(value, UUID) for value in (session_id, user_id, profile_id)):
            return None
        with self._connection(write=True) as connection:
            row = connection.execute(
                "SELECT * FROM sessions WHERE session_id = ?",
                (str(session_id),),
            ).fetchone()
            if row is None:
                return None
            session = self._session_from_row(row)
            if (
                session.user_id != user_id
                or session.status != "ACTIVE"
            ):
                return None
            if session.account_identity is not None:
                evidence = self._active_evidence_for_session(connection, session)
                if evidence is None:
                    self._terminate_identity_session(
                        connection,
                        row,
                        session,
                        now,
                        IdentityEvidenceState.REVOKED,
                    )
                    return None
                if (
                    now >= session.idle_expires_at
                    or now >= session.absolute_expires_at
                    or not authentication_is_current(session.authentication_context, now=now)
                ):
                    self._terminate_identity_session(
                        connection,
                        row,
                        session,
                        now,
                        IdentityEvidenceState.EXPIRED,
                    )
                    return None
            elif now >= session.idle_expires_at or now >= session.absolute_expires_at:
                return None
            updated = replace(session, active_profile_id=profile_id)
            connection.execute(
                "UPDATE sessions SET active_profile_id = ?, integrity_tag = ? "
                "WHERE session_id = ? AND status = 'ACTIVE'",
                (
                    str(profile_id),
                    self._session_integrity_tag(updated, row["token_hash"], self._integrity_key),
                    str(session_id),
                ),
            )
            return updated

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
            evidence = (
                self._active_evidence_for_session(connection, old_session)
                if old_session.account_identity is not None
                else None
            )
            if (
                old_session.status != "ACTIVE"
                or now >= old_session.idle_expires_at
                or now >= old_session.absolute_expires_at
                or replacement.user_id != old_session.user_id
                or replacement.account_identity != old_session.account_identity
                or replacement.authentication_context != old_session.authentication_context
                or replacement.identity_evidence_id != old_session.identity_evidence_id
                or replacement.authentication_source != old_session.authentication_source
                or replacement.status != "ACTIVE"
                or replacement.session_id == old_session.session_id
                or replacement.absolute_expires_at != old_session.absolute_expires_at
            ):
                return None
            if old_session.account_identity is not None and (
                evidence is None
                or not authentication_is_current(
                    old_session.authentication_context,
                    now=now,
                )
            ):
                if evidence is not None:
                    self._terminate_identity_session(
                        connection,
                        row,
                        old_session,
                        now,
                        IdentityEvidenceState.EXPIRED,
                    )
                return None
            revoked = replace(
                old_session,
                status="REVOKED",
                revoked_at=now,
                replaced_by=replacement.session_id,
                active_profile_id=None,
            )
            cursor = connection.execute(
                "UPDATE sessions SET status = 'REVOKED', revoked_at = ?, replaced_by = ?, "
                "active_profile_id = NULL, integrity_tag = ? "
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
                "INSERT INTO sessions(session_id, user_id, account_identity, identity_authenticated_at, "
                "identity_expires_at, identity_evidence_id, authentication_source, created_at, "
                "last_activity_at, idle_expires_at, absolute_expires_at, status, revoked_at, "
                "replaced_by, active_profile_id, token_hash, integrity_tag) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    *self._session_values(replacement),
                    new_token_hash,
                    self._session_integrity_tag(replacement, new_token_hash, self._integrity_key),
                ),
            )
            if evidence is not None:
                self._write_evidence_state(
                    connection,
                    evidence,
                    IdentityEvidenceState.ACTIVE,
                    session_id=replacement.session_id,
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
        account_status_lookup: Callable[[AccountIdentity], bool] | None = None,
    ) -> None:
        required_methods = (
            "create",
            "create_identity",
            "get_by_token_hash",
            "get_by_session_id",
            "resolve_and_touch",
            "revoke",
            "revoke_account",
            "revoke_identity_evidence",
            "get_identity_evidence_state",
            "select_profile",
            "rotate",
        )
        if any(not callable(getattr(repository, name, None)) for name in required_methods):
            raise TypeError("A session repository implementation is required.")
        self.repository = repository
        self.policy = policy
        self._account_status_lookup = account_status_lookup
        if csrf_secret is None:
            csrf_secret = (
                repository._csrf_signing_secret()
                if isinstance(repository, SQLiteSessionRepository)
                else secrets.token_bytes(32)
            )
        self._csrf_secret = csrf_secret
        if len(self._csrf_secret) < 32:
            raise ValueError("The CSRF signing secret must contain at least 32 bytes.")

    def set_account_status_lookup(
        self,
        lookup: Callable[[AccountIdentity], bool],
    ) -> None:
        if not callable(lookup):
            raise TypeError("An account status lookup is required.")
        self._account_status_lookup = lookup

    def _trusted_account_is_active(
        self,
        account_identity: AccountIdentity,
        now: datetime,
    ) -> bool:
        lookup = self._account_status_lookup
        if lookup is None:
            raise SessionStorageUnavailable(
                "Authenticated account status is unavailable."
            )
        try:
            active = lookup(account_identity)
        except Exception as error:
            raise SessionStorageUnavailable(
                "Authenticated account status is unavailable."
            ) from error
        if type(active) is not bool:
            raise SessionStorageUnavailable(
                "Authenticated account status is unavailable."
            )
        if not active:
            self.repository.revoke_account(account_identity, now)
        return active

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
        if authentication_source == TRUSTED_IDENTITY_SOURCE:
            raise ValueError("Canonical identity sessions require trusted identity resolution.")
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

    def create_identity_session(
        self,
        resolver: TrustedIdentityResolver | None,
        evidence: object,
        *,
        now: datetime | None = None,
    ) -> SessionCredentials | None:
        """Create a session only from a current, server-resolved account identity."""
        resolve = getattr(resolver, "resolve", None)
        if resolver is None or not callable(resolve):
            return None
        principal = resolve(evidence, now=self._now(now))
        current = self._now(now)
        if (
            type(principal) is not AuthenticatedPrincipal
            or not authentication_is_current(principal.authentication, now=current)
        ):
            return None
        if not self._trusted_account_is_active(principal.account_identity, current):
            return None
        absolute_expiry = min(
            current + timedelta(seconds=self.policy.absolute_timeout_seconds),
            principal.authentication.expires_at,
        )
        session = ServerSession(
            session_id=uuid4(),
            user_id=principal.account_identity.value,
            authentication_source=TRUSTED_IDENTITY_SOURCE,
            created_at=current,
            last_activity_at=current,
            idle_expires_at=min(
                current + timedelta(seconds=self.policy.idle_timeout_seconds),
                absolute_expiry,
            ),
            absolute_expires_at=absolute_expiry,
            account_identity=principal.account_identity,
            authentication_context=principal.authentication,
            identity_evidence_id=principal.authentication.evidence_id,
        )
        token = secrets.token_urlsafe(32)
        token_hash = self._token_hash(token)
        if token_hash is None:
            raise RuntimeError("Session token generation failed.")
        if not self.repository.create_identity(session, token_hash):
            return None
        try:
            account_is_active = self._trusted_account_is_active(
                principal.account_identity,
                current,
            )
        except SessionStorageUnavailable:
            self.repository.revoke(session.session_id, current)
            raise
        if not account_is_active:
            self.repository.revoke(session.session_id, current)
            return None
        return SessionCredentials(session=session, session_token=token)

    def resolve_identity(
        self,
        token: object,
        *,
        now: datetime | None = None,
    ) -> AuthenticatedPrincipal | None:
        """Return the identity bound to this active session, never from request data."""
        current = self._now(now)
        session = self.resolve(token, now=current)
        if (
            session is None
            or session.account_identity is None
            or session.authentication_context is None
            or not authentication_is_current(session.authentication_context, now=current)
        ):
            return None
        return AuthenticatedPrincipal(
            session.account_identity,
            session.authentication_context,
        )

    def resolve_trusted_session(
        self,
        token: object,
        *,
        expected_session_id: UUID,
        expected_account_identity: AccountIdentity,
        expected_evidence_id: UUID,
        now: datetime | None = None,
    ) -> ServerSession | None:
        """Revalidate the same trusted session/evidence binding at an execution boundary."""
        if (
            type(expected_session_id) is not UUID
            or type(expected_account_identity) is not AccountIdentity
            or type(expected_evidence_id) is not UUID
        ):
            return None
        session = self.resolve(token, now=now)
        if (
            session is None
            or session.status != "ACTIVE"
            or session.session_id != expected_session_id
            or session.account_identity != expected_account_identity
            or session.user_id != expected_account_identity.value
            or session.identity_evidence_id != expected_evidence_id
            or session.authentication_context is None
            or session.authentication_context.evidence_id != expected_evidence_id
            or not authentication_is_current(
                session.authentication_context,
                now=self._now(now),
            )
        ):
            return None
        return session

    def resolve(self, token: object, *, now: datetime | None = None) -> ServerSession | None:
        token_hash = self._token_hash(token)
        if token_hash is None:
            return None
        current = self._now(now)
        existing = self.repository.get_by_token_hash(token_hash)
        if existing is None or existing.status != "ACTIVE":
            return None
        if (
            existing.account_identity is not None
            and not self._trusted_account_is_active(existing.account_identity, current)
        ):
            return None
        session = self.repository.resolve_and_touch(
            token_hash,
            current,
            self.policy.idle_timeout_seconds,
        )
        if (
            session is not None
            and session.account_identity is not None
            and not self._trusted_account_is_active(session.account_identity, current)
        ):
            return None
        return session

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
            account_identity=old_session.account_identity,
            authentication_context=old_session.authentication_context,
            identity_evidence_id=old_session.identity_evidence_id,
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
        if (
            rotated.account_identity is not None
            and not self._trusted_account_is_active(rotated.account_identity, current)
        ):
            return None
        return SessionCredentials(session=rotated, session_token=new_token)

    def revoke(self, session_id: UUID, *, now: datetime | None = None) -> bool:
        return self.repository.revoke(session_id, self._now(now))

    def revoke_identity_evidence(
        self,
        evidence_id: UUID,
        *,
        now: datetime | None = None,
    ) -> bool:
        if type(evidence_id) is not UUID:
            return False
        return self.repository.revoke_identity_evidence(
            evidence_id,
            self._now(now),
            IdentityEvidenceState.REVOKED,
        )

    def supersede_identity_evidence(
        self,
        evidence_id: UUID,
        *,
        now: datetime | None = None,
    ) -> bool:
        if type(evidence_id) is not UUID:
            return False
        return self.repository.revoke_identity_evidence(
            evidence_id,
            self._now(now),
            IdentityEvidenceState.SUPERSEDED,
        )

    def identity_evidence_state(
        self,
        evidence_id: UUID,
    ) -> IdentityEvidenceState | None:
        if type(evidence_id) is not UUID:
            return None
        return self.repository.get_identity_evidence_state(evidence_id)

    def select_profile(
        self,
        session_id: UUID,
        user_id: UUID,
        profile_id: UUID,
        *,
        now: datetime | None = None,
    ) -> ServerSession | None:
        current = self._now(now)
        session = self.repository.get_by_session_id(session_id)
        if (
            session is None
            or session.status != "ACTIVE"
            or (
                session.account_identity is not None
                and not self._trusted_account_is_active(session.account_identity, current)
            )
        ):
            return None
        selected = self.repository.select_profile(
            session_id,
            user_id,
            profile_id,
            current,
        )
        if (
            selected is not None
            and selected.account_identity is not None
            and not self._trusted_account_is_active(selected.account_identity, current)
        ):
            return None
        return selected

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
            or (
                session.account_identity is not None
                and not self._trusted_account_is_active(session.account_identity, current)
            )
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