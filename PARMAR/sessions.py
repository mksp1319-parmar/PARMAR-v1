"""Ephemeral server-side authenticated sessions for the HTTP boundary.

The repository protocol is provider-neutral. The included implementation is
process-local only; it is not suitable for multi-process production hosting.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import threading
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from typing import Protocol
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
    """Enable ephemeral sessions only when both timeout values are explicit."""
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
    return SessionManager(InMemorySessionRepository(), policy)