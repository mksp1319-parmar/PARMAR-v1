"""Short-lived, one-use in-process records for human approval requests."""

from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class PendingApproval:
    request_text: str
    response: dict[str, Any]
    dashboard: Any
    summary: dict[str, Any]
    expires_at: float


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
        now: float | None = None,
    ) -> str:
        token = secrets.token_urlsafe(32)
        expiry = (time.monotonic() if now is None else now) + self._ttl_seconds
        with self._lock:
            self._pending[token] = PendingApproval(
                request_text=request_text,
                response=response,
                dashboard=dashboard,
                summary=summary,
                expires_at=expiry,
            )
        return token

    def inspect(self, token: object, *, now: float | None = None) -> PendingApproval | None:
        if not isinstance(token, str) or not token:
            return None
        current_time = time.monotonic() if now is None else now
        with self._lock:
            pending = self._pending.get(token)
            if pending is None:
                return None
            if pending.expires_at <= current_time:
                del self._pending[token]
                return None
            return pending

    def consume(
        self,
        token: object,
        *,
        request_text: object = None,
        now: float | None = None,
    ) -> tuple[PendingApproval | None, str]:
        if not isinstance(token, str) or not token:
            return None, "MISSING"
        current_time = time.monotonic() if now is None else now
        with self._lock:
            pending = self._pending.get(token)
            if pending is None:
                return None, "NOT_FOUND"
            if pending.expires_at <= current_time:
                del self._pending[token]
                return None, "EXPIRED"
            if request_text is not None and request_text != pending.request_text:
                return None, "REQUEST_MISMATCH"
            del self._pending[token]
            return pending, "OK"