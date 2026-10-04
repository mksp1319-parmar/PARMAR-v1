"""Short-lived, one-use in-process records for human approval requests."""

from __future__ import annotations

from copy import deepcopy
import hashlib
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Any
from uuid import UUID


@dataclass(frozen=True)
class PendingApproval:
    request_text: str
    response: dict[str, Any]
    dashboard: Any
    summary: dict[str, Any]
    expires_at: float
    user_id: UUID | None
    session_id: UUID | None
    decision_id: str | None
    request_fingerprint: str | None
    execution_context: dict[str, Any] | None


class PendingApprovalStore:
    """Bind an approval token to one server-held review and expire it quickly."""

    def __init__(self, ttl_seconds: float = 300.0) -> None:
        self._ttl_seconds = ttl_seconds
        self._lock = threading.Lock()
        self._pending: dict[str, PendingApproval] = {}

    def create(
        self,
        request_text: str,
        response: dict[str, Any],
        dashboard: Any,
        summary: dict[str, Any],
        *,
        user_id: UUID,
        session_id: UUID,
        decision_id: str,
        execution_context: dict[str, Any] | None = None,
        now: float | None = None,
    ) -> str:
        if not isinstance(user_id, UUID) or not isinstance(session_id, UUID):
            raise ValueError("Pending approvals require authenticated user and session IDs.")
        if not isinstance(decision_id, str) or not decision_id:
            raise ValueError("Pending approvals require their originating decision ID.")
        token = secrets.token_urlsafe(32)
        expiry = (time.monotonic() if now is None else now) + self._ttl_seconds
        token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
        request_fingerprint = hashlib.sha256(request_text.encode("utf-8")).hexdigest()
        with self._lock:
            self._pending[token_hash] = PendingApproval(
                request_text=request_text,
                response=response,
                dashboard=dashboard,
                summary=summary,
                expires_at=expiry,
                user_id=user_id,
                session_id=session_id,
                decision_id=decision_id,
                request_fingerprint=request_fingerprint,
                execution_context=deepcopy(execution_context),
            )
        return token

    @staticmethod
    def _token_hash(token: object) -> str | None:
        if not isinstance(token, str) or not token or len(token) > 256:
            return None
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    @staticmethod
    def _record_matches_owner(
        pending: PendingApproval,
        user_id: UUID,
        session_id: UUID,
    ) -> bool:
        if (
            pending.user_id is None
            or pending.session_id is None
            or not pending.decision_id
            or pending.request_fingerprint is None
            or pending.user_id != user_id
            or pending.session_id != session_id
            or hashlib.sha256(pending.request_text.encode("utf-8")).hexdigest() != pending.request_fingerprint
        ):
            return False
        stored_summary_decision = pending.summary.get("enforcement", {}).get("decision_id")
        reviewed_response = pending.response.get("analysis", pending.response)
        stored_response_decision = reviewed_response.get("enforcement", {}).get("decision_id")
        stored_review_text = reviewed_response.get(
            "request",
            pending.response.get("request"),
        )
        return (
            stored_review_text == pending.request_text
            and (stored_summary_decision is None or stored_summary_decision == pending.decision_id)
            and (stored_response_decision is None or stored_response_decision == pending.decision_id)
        )

    def inspect(
        self,
        token: object,
        *,
        user_id: object,
        session_id: object,
        now: float | None = None,
    ) -> PendingApproval | None:
        token_hash = self._token_hash(token)
        if token_hash is None or not isinstance(user_id, UUID) or not isinstance(session_id, UUID):
            return None
        current_time = time.monotonic() if now is None else now
        with self._lock:
            pending = self._pending.get(token_hash)
            if pending is None:
                return None
            if pending.expires_at <= current_time:
                del self._pending[token_hash]
                return None
            if not self._record_matches_owner(pending, user_id, session_id):
                return None
            return pending

    def consume(
        self,
        token: object,
        *,
        user_id: object,
        session_id: object,
        request_text: object = None,
        now: float | None = None,
    ) -> tuple[PendingApproval | None, str]:
        token_hash = self._token_hash(token)
        if token_hash is None or not isinstance(user_id, UUID) or not isinstance(session_id, UUID):
            return None, "MISSING"
        current_time = time.monotonic() if now is None else now
        with self._lock:
            pending = self._pending.get(token_hash)
            if pending is None:
                return None, "NOT_FOUND"
            if pending.expires_at <= current_time:
                del self._pending[token_hash]
                return None, "EXPIRED"
            if not self._record_matches_owner(pending, user_id, session_id):
                return None, "OWNER_MISMATCH"
            if request_text is not None and request_text != pending.request_text:
                return None, "REQUEST_MISMATCH"
            del self._pending[token_hash]
            return pending, "OK"