"""Short-lived, one-use server-side records for human approval requests."""

from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass, fields, replace
from datetime import datetime, timedelta, timezone
from enum import Enum
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sqlite3
import threading
import time
from typing import Any, Callable, Iterator
from uuid import UUID

from PARMAR.chat.context import ChatContext
from PARMAR.interface.dashboard import TerminalDashboard
from PARMAR.identity_contracts import ActionApprovalBinding
from PARMAR.state import LifecycleState


class ApprovalStorageUnavailable(RuntimeError):
    """Raised when persistent approval data cannot be safely accessed."""


class ApprovalState(str, Enum):
    """Persisted lifecycle states for a one-use approval."""

    PENDING = "PENDING"
    APPROVED = "APPROVED"
    EXECUTING = "EXECUTING"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"
    CONSUMED = "CONSUMED"


_APPROVAL_TRANSITIONS = {
    ApprovalState.PENDING: {
        ApprovalState.APPROVED,
        ApprovalState.REJECTED,
        ApprovalState.CANCELLED,
        ApprovalState.EXPIRED,
    },
    ApprovalState.APPROVED: {
        ApprovalState.EXECUTING,
        ApprovalState.CONSUMED,
        ApprovalState.CANCELLED,
        ApprovalState.EXPIRED,
    },
    ApprovalState.EXECUTING: {
        ApprovalState.CONSUMED,
        ApprovalState.CANCELLED,
        ApprovalState.EXPIRED,
    },
    ApprovalState.REJECTED: set(),
    ApprovalState.CANCELLED: set(),
    ApprovalState.EXPIRED: set(),
    ApprovalState.CONSUMED: set(),
}
_CANCELLATION_REASON_CODES = {
    "USER_REQUEST",
    "AUTHORIZATION_WITHDRAWN",
    "CONTEXT_CHANGED",
    "OTHER",
}


def _transition_approval_state(current: ApprovalState, target: ApprovalState) -> ApprovalState:
    if target not in _APPROVAL_TRANSITIONS[current]:
        raise ValueError(f"Invalid approval transition: {current.value} -> {target.value}")
    return target


def _cancellation_audit(
    pending: "PendingApproval",
    token_hash: str,
    user_id: UUID,
    session_id: UUID,
    reason_code: str,
) -> dict[str, Any]:
    binding = pending.approval_binding
    if binding is None:
        raise ApprovalStorageUnavailable("Approval storage is unavailable.")
    return {
        "version": 1,
        "event": "APPROVAL_CANCELLED",
        "approval_ref": token_hash,
        "actor_user_id": str(user_id),
        "session_id": str(session_id),
        "decision_id": pending.decision_id,
        "binding_fingerprint": binding.scope_fingerprint,
        "reason_code": reason_code,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _approval_now(now: float | None) -> datetime:
    if now is None:
        return datetime.now(timezone.utc)
    if type(now) not in {int, float} or not isinstance(now, (int, float)):
        raise ApprovalStorageUnavailable("Approval storage is unavailable.")
    try:
        timestamp = float(now)
        if not (float("-inf") < timestamp < float("inf")):
            raise ApprovalStorageUnavailable("Approval storage is unavailable.")
        return datetime.fromtimestamp(timestamp, tz=timezone.utc)
    except (OverflowError, OSError, ValueError) as error:
        raise ApprovalStorageUnavailable("Approval storage is unavailable.") from error


def _execution_audit(
    pending: "PendingApproval",
    token_hash: str,
    user_id: UUID,
    session_id: UUID,
    execution_claim_id: str,
    now: float | None,
) -> dict[str, Any]:
    binding = pending.approval_binding
    if binding is None:
        raise ApprovalStorageUnavailable("Approval storage is unavailable.")
    timestamp = _approval_now(now).isoformat()
    return {
        "version": 1,
        "event": "APPROVAL_EXECUTION_COMPLETED",
        "approval_ref": token_hash,
        "actor_user_id": str(user_id),
        "session_id": str(session_id),
        "decision_id": pending.decision_id,
        "binding_fingerprint": binding.scope_fingerprint,
        "execution_claim_id": execution_claim_id,
        "timestamp": timestamp,
    }


def _valid_approval_binding(binding: object, actor_id: UUID | None = None) -> bool:
    if type(binding) is not ActionApprovalBinding or type(binding.actor_id) is not UUID:
        return False
    if actor_id is not None and binding.actor_id != actor_id:
        return False
    for value, limit in (
        (binding.action, 128),
        (binding.resource_id, 256),
        (binding.resource_scope, 128),
        (binding.permission_scope, 128),
    ):
        if (
            not isinstance(value, str)
            or not value
            or value != value.strip()
            or len(value) > limit
            or not value.isprintable()
        ):
            return False
    return (
        isinstance(binding.scope_fingerprint, str)
        and len(binding.scope_fingerprint) == 64
        and all(character in "0123456789abcdef" for character in binding.scope_fingerprint)
    )


def approval_binding_for_pending(
    actor_id: UUID,
    decision_id: str,
    execution_context: dict[str, Any] | None,
) -> ActionApprovalBinding:
    if not isinstance(actor_id, UUID) or not isinstance(decision_id, str) or not decision_id:
        raise ApprovalStorageUnavailable("Approval storage is unavailable.")
    if execution_context is None:
        action = "proposal.review"
        resource_id = decision_id
        resource_scope = "decision"
        permission_scope = "parmar:proposal:review"
        scope_material: dict[str, Any] = {"decision_id": decision_id}
    else:
        if not isinstance(execution_context, dict):
            raise ApprovalStorageUnavailable("Approval storage is unavailable.")
        conversation_id = execution_context.get("conversation_id")
        has_conversation = isinstance(conversation_id, str) and bool(conversation_id)
        action = "chat.respond"
        resource_id = conversation_id if has_conversation else decision_id
        resource_scope = "conversation" if has_conversation else "chat-request"
        permission_scope = "parmar:chat:respond"
        chat_context = execution_context.get("context")
        serialized_context = (
            {field.name: getattr(chat_context, field.name) for field in fields(ChatContext)}
            if isinstance(chat_context, ChatContext)
            else chat_context
        )
        scope_material = {
            "decision_id": decision_id,
            "context": serialized_context,
            "selected_provider": execution_context.get("selected_provider"),
            "orchestration_mode": execution_context.get("orchestration_mode"),
            "recent_messages": execution_context.get("recent_messages"),
            "research": execution_context.get("research", False),
            "conversation_id": conversation_id,
            "profile_id": execution_context.get("profile_id"),
        }
    try:
        scope_payload = json.dumps(
            scope_material,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError, RecursionError) as error:
        raise ApprovalStorageUnavailable("Approval storage is unavailable.") from error
    binding = ActionApprovalBinding(
        actor_id=actor_id,
        action=action,
        resource_id=resource_id,
        resource_scope=resource_scope,
        permission_scope=permission_scope,
        scope_fingerprint=hashlib.sha256(scope_payload).hexdigest(),
    )
    if not _valid_approval_binding(binding, actor_id):
        raise ApprovalStorageUnavailable("Approval storage is unavailable.")
    return binding


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
    approval_binding: ActionApprovalBinding | None = None
    state: ApprovalState = ApprovalState.PENDING
    audit_evidence: dict[str, Any] | None = None
    execution_claim_id: str | None = None


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
        approval_binding: ActionApprovalBinding,
        execution_context: dict[str, Any] | None = None,
        now: float | None = None,
    ) -> str:
        if not isinstance(user_id, UUID) or not isinstance(session_id, UUID):
            raise ValueError("Pending approvals require authenticated user and session IDs.")
        if not isinstance(decision_id, str) or not decision_id:
            raise ValueError("Pending approvals require their originating decision ID.")
        if not _valid_approval_binding(approval_binding, user_id):
            raise ValueError("Pending approvals require an exact actor and action binding.")
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
                approval_binding=approval_binding,
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
            or not _valid_approval_binding(pending.approval_binding, user_id)
            or hashlib.sha256(pending.request_text.encode("utf-8")).hexdigest() != pending.request_fingerprint
        ):
            return False
        summary_enforcement = pending.summary.get("enforcement")
        if not isinstance(summary_enforcement, dict):
            return False
        stored_summary_decision = summary_enforcement.get("decision_id")
        reviewed_response = pending.response.get("analysis", pending.response)
        if not isinstance(reviewed_response, dict):
            return False
        response_enforcement = reviewed_response.get("enforcement")
        if response_enforcement is not None and not isinstance(response_enforcement, dict):
            return False
        stored_response_decision = (
            response_enforcement.get("decision_id")
            if isinstance(response_enforcement, dict)
            else None
        )
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
            if pending.state is not ApprovalState.PENDING:
                return None
            if pending.expires_at <= current_time:
                self._pending[token_hash] = replace(
                    pending,
                    state=_transition_approval_state(
                        pending.state,
                        ApprovalState.EXPIRED,
                    ),
                )
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
        decision: str | None = None,
        approval_binding: ActionApprovalBinding | None = None,
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
            if pending.state is not ApprovalState.PENDING:
                return None, "EXPIRED" if pending.state is ApprovalState.EXPIRED else "NOT_FOUND"
            if pending.expires_at <= current_time:
                self._pending[token_hash] = replace(
                    pending,
                    state=_transition_approval_state(
                        pending.state,
                        ApprovalState.EXPIRED,
                    ),
                )
                return None, "EXPIRED"
            if not self._record_matches_owner(pending, user_id, session_id):
                return None, "OWNER_MISMATCH"
            if request_text is not None and request_text != pending.request_text:
                return None, "REQUEST_MISMATCH"
            if decision not in {"APPROVE", "APPROVED", "REJECT", "REJECTED"}:
                return None, "INVALID_DECISION"
            if type(approval_binding) is not ActionApprovalBinding:
                return None, "BINDING_MISSING"
            if approval_binding != pending.approval_binding:
                return None, "BINDING_MISMATCH"
            resulting_state = (
                _transition_approval_state(pending.state, ApprovalState.REJECTED)
                if decision in {"REJECT", "REJECTED"}
                else _transition_approval_state(
                    _transition_approval_state(pending.state, ApprovalState.APPROVED),
                    ApprovalState.CONSUMED,
                )
            )
            self._pending[token_hash] = replace(pending, state=resulting_state)
            return pending, "OK"

    def approve_for_execution(
        self,
        token: object,
        *,
        user_id: object,
        session_id: object,
        request_text: object = None,
        approval_binding: ActionApprovalBinding | None = None,
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
            if pending.state is not ApprovalState.PENDING:
                return None, "EXPIRED" if pending.state is ApprovalState.EXPIRED else "NOT_FOUND"
            if pending.expires_at <= current_time:
                self._pending[token_hash] = replace(
                    pending,
                    state=_transition_approval_state(pending.state, ApprovalState.EXPIRED),
                )
                return None, "EXPIRED"
            if not self._record_matches_owner(pending, user_id, session_id):
                return None, "OWNER_MISMATCH"
            if request_text is not None and request_text != pending.request_text:
                return None, "REQUEST_MISMATCH"
            if type(approval_binding) is not ActionApprovalBinding:
                return None, "BINDING_MISSING"
            if approval_binding != pending.approval_binding:
                return None, "BINDING_MISMATCH"
            approved = replace(
                pending,
                state=_transition_approval_state(pending.state, ApprovalState.APPROVED),
            )
            executing = replace(
                approved,
                state=_transition_approval_state(approved.state, ApprovalState.EXECUTING),
            )
            self._pending[token_hash] = executing
            return executing, "OK"

    def authorize_execution(
        self,
        token: object,
        *,
        user_id: object,
        session_id: object,
        approval_binding: ActionApprovalBinding,
        now: float | None = None,
    ) -> bool:
        token_hash = self._token_hash(token)
        if token_hash is None or not isinstance(user_id, UUID) or not isinstance(session_id, UUID):
            return False
        current_time = time.monotonic() if now is None else now
        with self._lock:
            pending = self._pending.get(token_hash)
            if (
                pending is None
                or pending.state is not ApprovalState.EXECUTING
                or not self._record_matches_owner(pending, user_id, session_id)
                or type(approval_binding) is not ActionApprovalBinding
                or pending.approval_binding != approval_binding
            ):
                return False
            if pending.expires_at <= current_time:
                self._pending[token_hash] = replace(
                    pending,
                    state=_transition_approval_state(pending.state, ApprovalState.EXPIRED),
                )
                return False
            return True

    def complete_execution(
        self,
        token: object,
        *,
        user_id: object,
        session_id: object,
        approval_binding: ActionApprovalBinding,
        now: float | None = None,
    ) -> bool:
        token_hash = self._token_hash(token)
        if token_hash is None or not isinstance(user_id, UUID) or not isinstance(session_id, UUID):
            return False
        current_time = time.monotonic() if now is None else now
        with self._lock:
            pending = self._pending.get(token_hash)
            if (
                pending is None
                or pending.state is not ApprovalState.EXECUTING
                or not self._record_matches_owner(pending, user_id, session_id)
                or type(approval_binding) is not ActionApprovalBinding
                or pending.approval_binding != approval_binding
            ):
                return False
            if pending.expires_at <= current_time:
                self._pending[token_hash] = replace(
                    pending,
                    state=_transition_approval_state(pending.state, ApprovalState.EXPIRED),
                )
                return False
            self._pending[token_hash] = replace(
                pending,
                state=_transition_approval_state(pending.state, ApprovalState.CONSUMED),
            )
            return True

    def cancel(
        self,
        token: object,
        *,
        user_id: object,
        session_id: object,
        reason_code: str,
        approval_binding: ActionApprovalBinding | None = None,
        now: float | None = None,
    ) -> str:
        token_hash = self._token_hash(token)
        if (
            token_hash is None
            or not isinstance(user_id, UUID)
            or not isinstance(session_id, UUID)
            or not isinstance(reason_code, str)
            or reason_code not in _CANCELLATION_REASON_CODES
        ):
            return "MISSING"
        current_time = time.monotonic() if now is None else now
        with self._lock:
            pending = self._pending.get(token_hash)
            if pending is None:
                return "NOT_FOUND"
            if not self._record_matches_owner(pending, user_id, session_id):
                return "OWNER_MISMATCH"
            try:
                expected_binding = approval_binding_for_pending(
                    user_id,
                    pending.decision_id,
                    pending.execution_context,
                )
            except ApprovalStorageUnavailable:
                return "BINDING_MISMATCH"
            if (
                pending.approval_binding != expected_binding
                or (
                    approval_binding is not None
                    and (
                        type(approval_binding) is not ActionApprovalBinding
                        or approval_binding != expected_binding
                    )
                )
            ):
                return "BINDING_MISMATCH"
            if pending.state is ApprovalState.CANCELLED:
                return "ALREADY_CANCELLED"
            if pending.state not in {
                ApprovalState.PENDING,
                ApprovalState.APPROVED,
                ApprovalState.EXECUTING,
            }:
                return "EXPIRED" if pending.state is ApprovalState.EXPIRED else "NOT_PENDING"
            if pending.expires_at <= current_time:
                self._pending[token_hash] = replace(
                    pending,
                    state=_transition_approval_state(pending.state, ApprovalState.EXPIRED),
                )
                return "EXPIRED"
            self._pending[token_hash] = replace(
                pending,
                state=_transition_approval_state(pending.state, ApprovalState.CANCELLED),
                audit_evidence=_cancellation_audit(
                    pending,
                    token_hash,
                    user_id,
                    session_id,
                    reason_code,
                ),
            )
            return "CANCELLED"


class SQLitePendingApprovalStore:
    """SQLite-backed pending reviews; records are authenticated and one-use."""

    _SCHEMA_VERSION = 3
    _MAX_PAYLOAD_BYTES = 1_048_576

    def __init__(
        self,
        database_path: str | Path,
        integrity_key: bytes,
        ttl_seconds: float = 300.0,
    ) -> None:
        if not isinstance(integrity_key, bytes) or len(integrity_key) < 32:
            raise ValueError("Approval storage requires a stable server-side integrity key.")
        if ttl_seconds <= 0:
            raise ValueError("Approval lifetime must be positive.")
        path = Path(database_path).expanduser()
        if not str(path):
            raise ValueError("An approval database path is required.")
        self.database_path = path if path.is_absolute() else Path.cwd() / path
        self._integrity_key = integrity_key
        self._ttl_seconds = ttl_seconds
        self._lock = threading.RLock()
        self._initialized = False
        self._fresh_database = False
        self._database_identity: tuple[int, int] | None = None

    @classmethod
    def from_environment(cls, environ: dict[str, str] | None = None) -> "SQLitePendingApprovalStore":
        values = os.environ if environ is None else environ
        secret = values.get("PARMAR_APPROVAL_STORE_KEY") or values.get("PARMAR_SESSION_STORE_KEY")
        if secret is None or len(secret.encode("utf-8")) < 32:
            raise ValueError(
                "PARMAR_APPROVAL_STORE_KEY or PARMAR_SESSION_STORE_KEY must contain at least 32 bytes."
            )
        configured_path = values.get("PARMAR_APPROVAL_DB_PATH")
        if configured_path is not None and not configured_path.strip():
            raise ValueError("PARMAR_APPROVAL_DB_PATH must not be empty.")
        path = (
            Path(configured_path).expanduser()
            if configured_path is not None
            else Path.home() / ".local" / "share" / "parmar" / "approvals.sqlite3"
        )
        key = hashlib.sha256(b"PARMAR-APPROVAL-STORE-v1\0" + secret.encode("utf-8")).digest()
        return cls(path, key)

    def _prepare_file(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.database_path.is_symlink():
            raise OSError("Approval database must not be a symbolic link.")
        if not self.database_path.exists():
            if self._initialized:
                raise OSError("Approval database is missing.")
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
            raise OSError("Approval database path is not a file.")
        os.chmod(self.database_path, 0o600)
        stat = self.database_path.stat()
        identity = (stat.st_dev, stat.st_ino)
        if self._initialized and identity != self._database_identity:
            raise OSError("Approval database has changed.")

    def _initialize(self, connection: sqlite3.Connection) -> None:
        if self._initialized:
            return
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version not in (0, 1, 2, self._SCHEMA_VERSION):
            raise ApprovalStorageUnavailable("Approval storage is unavailable.")
        if version == 0:
            if not self._fresh_database:
                objects = connection.execute(
                    "SELECT name FROM sqlite_master WHERE type IN ('table', 'view', 'trigger') "
                    "AND name NOT LIKE 'sqlite_%'"
                ).fetchall()
                if objects:
                    raise ApprovalStorageUnavailable("Approval storage is unavailable.")
            connection.executescript(
                """
                CREATE TABLE pending_approvals (
                    token_hash TEXT PRIMARY KEY,
                    state TEXT NOT NULL CHECK(state IN (
                        'PENDING', 'APPROVED', 'EXECUTING', 'REJECTED', 'CANCELLED', 'EXPIRED', 'CONSUMED'
                    )),
                    expires_at TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    integrity_tag TEXT NOT NULL
                );
                CREATE INDEX pending_approvals_expiry ON pending_approvals(expires_at);
                PRAGMA user_version = 3;
                """
            )
        elif version == 1:
            connection.execute("BEGIN IMMEDIATE")
            try:
                legacy_states = {"PENDING", "CONSUMED", "REJECTED", "EXPIRED"}
                rows = connection.execute(
                    "SELECT token_hash, state, expires_at, payload, integrity_tag FROM pending_approvals"
                ).fetchall()
                for row in rows:
                    if (
                        row["state"] not in legacy_states
                        or not isinstance(row["token_hash"], str)
                        or not isinstance(row["expires_at"], str)
                        or not isinstance(row["payload"], str)
                        or not isinstance(row["integrity_tag"], str)
                        or len(row["integrity_tag"]) != 64
                        or any(
                            character not in "0123456789abcdef"
                            for character in row["integrity_tag"]
                        )
                        or not hmac.compare_digest(
                            row["integrity_tag"],
                            self._tag(
                                row["token_hash"],
                                row["state"],
                                row["expires_at"],
                                row["payload"],
                            ),
                        )
                    ):
                        raise ApprovalStorageUnavailable("Approval storage is unavailable.")
                connection.execute(
                    """
                    CREATE TABLE pending_approvals_v2 (
                        token_hash TEXT PRIMARY KEY,
                        state TEXT NOT NULL CHECK(state IN (
                            'PENDING', 'APPROVED', 'EXECUTING', 'REJECTED', 'CANCELLED', 'EXPIRED', 'CONSUMED'
                        )),
                        expires_at TEXT NOT NULL,
                        payload TEXT NOT NULL,
                        integrity_tag TEXT NOT NULL
                    )
                    """
                )
                connection.execute(
                    "INSERT INTO pending_approvals_v2 "
                    "(token_hash, state, expires_at, payload, integrity_tag) "
                    "SELECT token_hash, state, expires_at, payload, integrity_tag FROM pending_approvals"
                )
                connection.execute("DROP TABLE pending_approvals")
                connection.execute("ALTER TABLE pending_approvals_v2 RENAME TO pending_approvals")
                connection.execute(
                    "CREATE INDEX pending_approvals_expiry ON pending_approvals(expires_at)"
                )
                connection.execute("PRAGMA user_version = 3")
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        elif version == 2:
            connection.execute("BEGIN IMMEDIATE")
            try:
                legacy_states = {
                    "PENDING",
                    "APPROVED",
                    "REJECTED",
                    "CANCELLED",
                    "EXPIRED",
                    "CONSUMED",
                }
                rows = connection.execute(
                    "SELECT token_hash, state, expires_at, payload, integrity_tag FROM pending_approvals"
                ).fetchall()
                for row in rows:
                    if (
                        row["state"] not in legacy_states
                        or not isinstance(row["token_hash"], str)
                        or not isinstance(row["expires_at"], str)
                        or not isinstance(row["payload"], str)
                        or not isinstance(row["integrity_tag"], str)
                        or len(row["integrity_tag"]) != 64
                        or any(character not in "0123456789abcdef" for character in row["integrity_tag"])
                        or not hmac.compare_digest(
                            row["integrity_tag"],
                            self._tag(
                                row["token_hash"],
                                row["state"],
                                row["expires_at"],
                                row["payload"],
                            ),
                        )
                    ):
                        raise ApprovalStorageUnavailable("Approval storage is unavailable.")
                connection.execute(
                    """
                    CREATE TABLE pending_approvals_v3 (
                        token_hash TEXT PRIMARY KEY,
                        state TEXT NOT NULL CHECK(state IN (
                            'PENDING', 'APPROVED', 'EXECUTING', 'REJECTED',
                            'CANCELLED', 'EXPIRED', 'CONSUMED'
                        )),
                        expires_at TEXT NOT NULL,
                        payload TEXT NOT NULL,
                        integrity_tag TEXT NOT NULL
                    )
                    """
                )
                connection.execute(
                    "INSERT INTO pending_approvals_v3 "
                    "(token_hash, state, expires_at, payload, integrity_tag) "
                    "SELECT token_hash, state, expires_at, payload, integrity_tag FROM pending_approvals"
                )
                connection.execute("DROP TABLE pending_approvals")
                connection.execute("ALTER TABLE pending_approvals_v3 RENAME TO pending_approvals")
                connection.execute(
                    "CREATE INDEX pending_approvals_expiry ON pending_approvals(expires_at)"
                )
                connection.execute("PRAGMA user_version = 3")
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        integrity = connection.execute("PRAGMA quick_check").fetchone()
        if integrity is None or integrity[0] != "ok":
            raise ApprovalStorageUnavailable("Approval storage is unavailable.")
        tables = {
            row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        if "pending_approvals" not in tables:
            raise ApprovalStorageUnavailable("Approval storage is unavailable.")
        stat = self.database_path.stat()
        self._database_identity = (stat.st_dev, stat.st_ino)
        self._initialized = True

    @contextmanager
    def _connection(self, *, write: bool = False) -> Iterator[sqlite3.Connection]:
        try:
            with self._lock:
                self._prepare_file()
                connection = sqlite3.connect(
                    self.database_path,
                    timeout=5,
                    isolation_level=None,
                )
                connection.row_factory = sqlite3.Row
                try:
                    connection.execute("PRAGMA foreign_keys=ON")
                    if connection.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
                        raise ApprovalStorageUnavailable("Approval storage is unavailable.")
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
        except ApprovalStorageUnavailable:
            raise
        except (OSError, sqlite3.Error, UnicodeError) as error:
            raise ApprovalStorageUnavailable("Approval storage is unavailable.") from error

    @staticmethod
    def _canonical(payload: dict[str, Any]) -> str:
        try:
            encoded = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
        except (TypeError, ValueError, RecursionError) as error:
            raise ApprovalStorageUnavailable("Approval storage is unavailable.") from error
        if len(encoded.encode("utf-8")) > SQLitePendingApprovalStore._MAX_PAYLOAD_BYTES:
            raise ApprovalStorageUnavailable("Approval storage is unavailable.")
        return encoded

    def _tag(self, token_hash: str, state: str, expires_at: str, payload: str) -> str:
        message = "\0".join((token_hash, state, expires_at, payload)).encode("utf-8")
        return hmac.new(self._integrity_key, message, hashlib.sha256).hexdigest()

    @classmethod
    def _encode_pending(cls, pending: PendingApproval) -> dict[str, Any]:
        if (
            not isinstance(pending.user_id, UUID)
            or not isinstance(pending.session_id, UUID)
            or not isinstance(pending.decision_id, str)
            or not pending.decision_id
            or not isinstance(pending.request_text, str)
            or not isinstance(pending.response, dict)
            or not isinstance(pending.summary, dict)
            or not _valid_approval_binding(pending.approval_binding, pending.user_id)
        ):
            raise ApprovalStorageUnavailable("Approval storage is unavailable.")
        enforcement = pending.summary.get("enforcement")
        reviewed_response = pending.response.get("analysis", pending.response)
        response_enforcement = (
            reviewed_response.get("enforcement")
            if isinstance(reviewed_response, dict)
            else None
        )
        if (
            not isinstance(enforcement, dict)
            or enforcement.get("decision_id") != pending.decision_id
            or not isinstance(reviewed_response, dict)
            or reviewed_response.get("request") != pending.request_text
            or (
                response_enforcement is not None
                and (
                    not isinstance(response_enforcement, dict)
                    or response_enforcement.get("decision_id") != pending.decision_id
                )
            )
        ):
            raise ApprovalStorageUnavailable("Approval storage is unavailable.")
        context = pending.execution_context
        if context is not None:
            if not isinstance(context, dict) or not isinstance(context.get("context"), ChatContext):
                raise ApprovalStorageUnavailable("Approval storage is unavailable.")
            chat_context = context["context"]
            profile_id = context.get("profile_id")
            if profile_id is not None:
                try:
                    if not isinstance(profile_id, str) or str(UUID(profile_id)) != profile_id:
                        raise ValueError
                except ValueError as error:
                    raise ApprovalStorageUnavailable("Approval storage is unavailable.") from error
            context = {
                "context": {
                    field.name: getattr(chat_context, field.name)
                    for field in fields(ChatContext)
                },
                "selected_provider": context.get("selected_provider"),
                "orchestration_mode": context.get("orchestration_mode"),
                "recent_messages": context.get("recent_messages"),
                "research": context.get("research", False),
                "conversation_id": context.get("conversation_id"),
                "profile_id": profile_id,
            }
        return {
            "request_text": pending.request_text,
            "response": pending.response,
            "summary": pending.summary,
            "user_id": str(pending.user_id),
            "session_id": str(pending.session_id),
            "decision_id": pending.decision_id,
            "request_fingerprint": pending.request_fingerprint,
            "execution_context": context,
            "approval_binding": {
                "actor_id": str(pending.approval_binding.actor_id),
                "action": pending.approval_binding.action,
                "resource_id": pending.approval_binding.resource_id,
                "resource_scope": pending.approval_binding.resource_scope,
                "permission_scope": pending.approval_binding.permission_scope,
                "scope_fingerprint": pending.approval_binding.scope_fingerprint,
            },
        }

    @staticmethod
    def _restore_dashboard(summary: dict[str, Any], response: dict[str, Any]) -> TerminalDashboard:
        enforcement = summary.get("enforcement")
        risk = summary.get("risk")
        decision = summary.get("decision")
        if (
            not isinstance(enforcement, dict)
            or enforcement.get("status") != "HUMAN_APPROVAL_REQUIRED"
            or enforcement.get("execution_allowed") is not False
            or not isinstance(risk, dict)
            or not isinstance(decision, dict)
            or decision.get("requires_human_approval") is not True
        ):
            raise ApprovalStorageUnavailable("Approval storage is unavailable.")
        lifecycle = response.get("lifecycle")
        request_id = lifecycle.get("request_id") if isinstance(lifecycle, dict) else None
        if request_id is not None and not isinstance(request_id, str):
            raise ApprovalStorageUnavailable("Approval storage is unavailable.")

        dashboard = TerminalDashboard()
        dashboard._continue_lifecycle = True
        dashboard.state_machine.transition(
            LifecycleState.LISTENING,
            request_id=request_id,
            reset_context=True,
        )
        dashboard.state_machine.transition(LifecycleState.THINKING)
        dashboard.state_machine.transition(LifecycleState.ANALYZING)
        dashboard.state_machine.transition(
            LifecycleState.RISK_CHECK,
            risk_level=risk.get("risk_level"),
            intent=summary.get("intent", {}).get("intent")
            if isinstance(summary.get("intent"), dict)
            else None,
        )
        dashboard._lifecycle_snapshot = dashboard.state_machine.apply_enforcement_result(
            enforcement,
            risk_level=risk.get("risk_level"),
        )
        return dashboard

    @classmethod
    def _decode_pending(
        cls,
        payload: str,
        expires_at: str,
        *,
        state: ApprovalState = ApprovalState.PENDING,
        token_hash: str | None = None,
    ) -> PendingApproval:
        try:
            raw = json.loads(payload)
            if not isinstance(raw, dict):
                raise ValueError("Invalid approval payload.")
            request_text = raw["request_text"]
            response = raw["response"]
            summary = raw["summary"]
            decision_id = raw["decision_id"]
            request_fingerprint = raw["request_fingerprint"]
            user_id = UUID(raw["user_id"])
            session_id = UUID(raw["session_id"])
            if (
                not isinstance(request_text, str)
                or not isinstance(response, dict)
                or not isinstance(summary, dict)
                or not isinstance(decision_id, str)
                or not decision_id
                or not isinstance(request_fingerprint, str)
                or not hmac.compare_digest(
                    request_fingerprint,
                    hashlib.sha256(request_text.encode("utf-8")).hexdigest(),
                )
            ):
                raise ValueError("Invalid approval payload.")
            stored_enforcement = summary.get("enforcement")
            if (
                not isinstance(stored_enforcement, dict)
                or stored_enforcement.get("decision_id") != decision_id
            ):
                raise ValueError("Invalid approval decision binding.")
            reviewed_response = response.get("analysis", response)
            if not isinstance(reviewed_response, dict) or reviewed_response.get("request") != request_text:
                raise ValueError("Invalid approval request binding.")
            response_enforcement = reviewed_response.get("enforcement")
            if (
                response_enforcement is not None
                and (
                    not isinstance(response_enforcement, dict)
                    or response_enforcement.get("decision_id") != decision_id
                )
            ):
                raise ValueError("Invalid approval response binding.")
            execution = raw["execution_context"]
            if execution is not None:
                if not isinstance(execution, dict) or not isinstance(execution.get("context"), dict):
                    raise ValueError("Invalid approval context.")
                execution = dict(execution)
                if "research" in execution and not isinstance(execution["research"], bool):
                    raise ValueError("Invalid approval research mode.")
                execution.setdefault("research", False)
                profile_id = execution.get("profile_id")
                if profile_id is not None and (
                    not isinstance(profile_id, str)
                    or str(UUID(profile_id)) != profile_id
                ):
                    raise ValueError("Invalid approval profile binding.")
                execution["context"] = ChatContext(**execution["context"])
            raw_binding = raw.get("approval_binding")
            approval_binding = None
            if raw_binding is not None:
                if not isinstance(raw_binding, dict):
                    raise ValueError("Invalid approval action binding.")
                approval_binding = ActionApprovalBinding(
                    actor_id=UUID(raw_binding["actor_id"]),
                    action=raw_binding["action"],
                    resource_id=raw_binding["resource_id"],
                    resource_scope=raw_binding["resource_scope"],
                    permission_scope=raw_binding["permission_scope"],
                    scope_fingerprint=raw_binding["scope_fingerprint"],
                )
                if not _valid_approval_binding(approval_binding, user_id):
                    raise ValueError("Invalid approval action binding.")
            execution_claim_id = raw.get("execution_claim_id")
            if execution_claim_id is not None and (
                not isinstance(execution_claim_id, str)
                or len(execution_claim_id) != 64
                or any(character not in "0123456789abcdef" for character in execution_claim_id)
            ):
                raise ValueError("Invalid approval execution claim.")
            if execution_claim_id is not None and state not in {
                ApprovalState.EXECUTING,
                ApprovalState.CONSUMED,
            }:
                raise ValueError("Unexpected approval execution claim.")
            audit_evidence = raw.get("lifecycle_audit")
            if state is ApprovalState.CANCELLED:
                if (
                    not isinstance(audit_evidence, dict)
                    or audit_evidence.get("version") != 1
                    or audit_evidence.get("event") != "APPROVAL_CANCELLED"
                    or audit_evidence.get("approval_ref") != token_hash
                    or audit_evidence.get("actor_user_id") != str(user_id)
                    or audit_evidence.get("session_id") != str(session_id)
                    or audit_evidence.get("decision_id") != decision_id
                    or audit_evidence.get("binding_fingerprint")
                    != (approval_binding.scope_fingerprint if approval_binding else None)
                    or execution_claim_id is not None
                    or audit_evidence.get("reason_code") not in _CANCELLATION_REASON_CODES
                ):
                    raise ValueError("Invalid approval cancellation audit.")
                audit_timestamp = datetime.fromisoformat(audit_evidence["timestamp"])
                if audit_timestamp.tzinfo is None or audit_timestamp.utcoffset() is None:
                    raise ValueError("Invalid approval cancellation timestamp.")
            elif state is ApprovalState.CONSUMED and audit_evidence is not None:
                if (
                    not isinstance(audit_evidence, dict)
                    or audit_evidence.get("version") != 1
                    or audit_evidence.get("event") != "APPROVAL_EXECUTION_COMPLETED"
                    or audit_evidence.get("approval_ref") != token_hash
                    or audit_evidence.get("actor_user_id") != str(user_id)
                    or audit_evidence.get("session_id") != str(session_id)
                    or audit_evidence.get("decision_id") != decision_id
                    or audit_evidence.get("binding_fingerprint")
                    != (approval_binding.scope_fingerprint if approval_binding else None)
                    or execution_claim_id is None
                    or audit_evidence.get("execution_claim_id") != execution_claim_id
                ):
                    raise ValueError("Invalid approval execution audit.")
                audit_timestamp = datetime.fromisoformat(audit_evidence["timestamp"])
                if audit_timestamp.tzinfo is None or audit_timestamp.utcoffset() is None:
                    raise ValueError("Invalid approval execution timestamp.")
            elif audit_evidence is not None:
                raise ValueError("Unexpected approval lifecycle audit.")
            expiry = datetime.fromisoformat(expires_at)
            if expiry.tzinfo is None or expiry.utcoffset() is None:
                raise ValueError("Invalid approval expiry.")
            dashboard = cls._restore_dashboard(summary, response)
            return PendingApproval(
                request_text=request_text,
                response=response,
                dashboard=dashboard,
                summary=summary,
                expires_at=expiry.timestamp(),
                user_id=user_id,
                session_id=session_id,
                decision_id=decision_id,
                request_fingerprint=request_fingerprint,
                execution_context=execution,
                approval_binding=approval_binding,
                state=state,
                audit_evidence=audit_evidence,
                execution_claim_id=execution_claim_id,
            )
        except ApprovalStorageUnavailable:
            raise
        except (KeyError, TypeError, ValueError, json.JSONDecodeError, RecursionError) as error:
            raise ApprovalStorageUnavailable("Approval storage is unavailable.") from error

    @staticmethod
    def _token_hash(token: object) -> str | None:
        if not isinstance(token, str) or not token or len(token) > 256:
            return None
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    @staticmethod
    def _record_matches_owner(pending: PendingApproval, user_id: UUID, session_id: UUID) -> bool:
        return PendingApprovalStore._record_matches_owner(pending, user_id, session_id)

    def _read_pending(
        self,
        connection: sqlite3.Connection,
        token_hash: str,
        *,
        include_terminal: bool = False,
        now: float | None = None,
    ) -> tuple[PendingApproval | None, sqlite3.Row | None]:
        row = connection.execute(
            "SELECT * FROM pending_approvals WHERE token_hash = ?",
            (token_hash,),
        ).fetchone()
        if row is None:
            return None, None
        state, expires_at, payload, tag = row["state"], row["expires_at"], row["payload"], row["integrity_tag"]
        if (
            state not in {item.value for item in ApprovalState}
            or not isinstance(expires_at, str)
            or not isinstance(payload, str)
            or len(payload.encode("utf-8")) > self._MAX_PAYLOAD_BYTES
            or not isinstance(tag, str)
            or len(tag) != 64
            or any(character not in "0123456789abcdef" for character in tag)
            or not hmac.compare_digest(tag, self._tag(token_hash, state, expires_at, payload))
        ):
            raise ApprovalStorageUnavailable("Approval storage is unavailable.")
        lifecycle_state = ApprovalState(state)
        if lifecycle_state is not ApprovalState.PENDING and not include_terminal:
            return None, row
        pending = self._decode_pending(
            payload,
            expires_at,
            state=lifecycle_state,
            token_hash=token_hash,
        )
        if lifecycle_state is not ApprovalState.PENDING:
            return pending, row
        expiry = datetime.fromisoformat(expires_at)
        if _approval_now(now) >= expiry:
            expired_state = _transition_approval_state(
                lifecycle_state,
                ApprovalState.EXPIRED,
            )
            connection.execute(
                "UPDATE pending_approvals SET state = ?, integrity_tag = ? WHERE token_hash = ?",
                (expired_state.value, self._tag(token_hash, expired_state.value, expires_at, payload), token_hash),
            )
            refreshed_row = connection.execute(
                "SELECT * FROM pending_approvals WHERE token_hash = ?",
                (token_hash,),
            ).fetchone()
            return (pending, refreshed_row) if include_terminal else (None, refreshed_row)
        return pending, row

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
        approval_binding: ActionApprovalBinding,
        execution_context: dict[str, Any] | None = None,
        now: float | None = None,
    ) -> str:
        if not isinstance(user_id, UUID) or not isinstance(session_id, UUID):
            raise ValueError("Pending approvals require authenticated user and session IDs.")
        if not isinstance(decision_id, str) or not decision_id:
            raise ValueError("Pending approvals require their originating decision ID.")
        if not _valid_approval_binding(approval_binding, user_id):
            raise ValueError("Pending approvals require an exact actor and action binding.")
        if (
            not isinstance(request_text, str)
            or not isinstance(response, dict)
            or not isinstance(summary, dict)
        ):
            raise ApprovalStorageUnavailable("Approval storage is unavailable.")
        if not isinstance(dashboard, TerminalDashboard):
            raise ApprovalStorageUnavailable("Approval storage is unavailable.")
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
        request_fingerprint = hashlib.sha256(request_text.encode("utf-8")).hexdigest()
        pending = PendingApproval(
            request_text=request_text,
            response=deepcopy(response),
            dashboard=dashboard,
            summary=deepcopy(summary),
            expires_at=0.0,
            user_id=user_id,
            session_id=session_id,
            decision_id=decision_id,
            request_fingerprint=request_fingerprint,
            execution_context=deepcopy(execution_context),
            approval_binding=approval_binding,
        )
        payload = self._canonical(self._encode_pending(pending))
        expiry = _approval_now(now) + timedelta(seconds=self._ttl_seconds)
        expires_at = expiry.isoformat()
        tag = self._tag(token_hash, "PENDING", expires_at, payload)
        with self._connection(write=True) as connection:
            connection.execute(
                "INSERT INTO pending_approvals(token_hash, state, expires_at, payload, integrity_tag) "
                "VALUES (?, 'PENDING', ?, ?, ?)",
                (token_hash, expires_at, payload, tag),
            )
        return token

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
        with self._connection(write=True) as connection:
            pending, _row = self._read_pending(connection, token_hash, now=now)
            if pending is None or not self._record_matches_owner(pending, user_id, session_id):
                return None
            return pending

    def consume(
        self,
        token: object,
        *,
        user_id: object,
        session_id: object,
        request_text: object = None,
        decision: str | None = None,
        approval_binding: ActionApprovalBinding | None = None,
        now: float | None = None,
    ) -> tuple[PendingApproval | None, str]:
        token_hash = self._token_hash(token)
        if token_hash is None or not isinstance(user_id, UUID) or not isinstance(session_id, UUID):
            return None, "MISSING"
        with self._connection(write=True) as connection:
            pending, row = self._read_pending(connection, token_hash, now=now)
            if row is None:
                return None, "NOT_FOUND"
            if pending is None:
                return None, "EXPIRED" if row["state"] == "EXPIRED" else "NOT_FOUND"
            if not self._record_matches_owner(pending, user_id, session_id):
                return None, "OWNER_MISMATCH"
            if request_text is not None and request_text != pending.request_text:
                return None, "REQUEST_MISMATCH"
            if decision not in {"APPROVE", "APPROVED", "REJECT", "REJECTED"}:
                return None, "INVALID_DECISION"
            if type(approval_binding) is not ActionApprovalBinding:
                return None, "BINDING_MISSING"
            if approval_binding != pending.approval_binding:
                return None, "BINDING_MISMATCH"
            state = (
                _transition_approval_state(ApprovalState.PENDING, ApprovalState.REJECTED)
                if decision in {"REJECT", "REJECTED"}
                else _transition_approval_state(
                    _transition_approval_state(ApprovalState.PENDING, ApprovalState.APPROVED),
                    ApprovalState.CONSUMED,
                )
            )
            expiry = row["expires_at"]
            payload = row["payload"]
            cursor = connection.execute(
                "UPDATE pending_approvals SET state = ?, integrity_tag = ? "
                "WHERE token_hash = ? AND state = 'PENDING'",
                (state.value, self._tag(token_hash, state.value, expiry, payload), token_hash),
            )
            if cursor.rowcount != 1:
                return None, "NOT_FOUND"
            return pending, "OK"

    def approve_for_execution(
        self,
        token: object,
        *,
        user_id: object,
        session_id: object,
        request_text: object = None,
        approval_binding: ActionApprovalBinding | None = None,
        now: float | None = None,
    ) -> tuple[PendingApproval | None, str]:
        token_hash = self._token_hash(token)
        if token_hash is None or not isinstance(user_id, UUID) or not isinstance(session_id, UUID):
            return None, "MISSING"
        with self._connection(write=True) as connection:
            pending, row = self._read_pending(connection, token_hash, now=now)
            if row is None:
                return None, "NOT_FOUND"
            if pending is None:
                return None, "EXPIRED" if row["state"] == "EXPIRED" else "NOT_FOUND"
            if not self._record_matches_owner(pending, user_id, session_id):
                return None, "OWNER_MISMATCH"
            if request_text is not None and request_text != pending.request_text:
                return None, "REQUEST_MISMATCH"
            if type(approval_binding) is not ActionApprovalBinding:
                return None, "BINDING_MISSING"
            if approval_binding != pending.approval_binding:
                return None, "BINDING_MISMATCH"
            state = _transition_approval_state(
                _transition_approval_state(ApprovalState.PENDING, ApprovalState.APPROVED),
                ApprovalState.EXECUTING,
            )
            cursor = connection.execute(
                "UPDATE pending_approvals SET state = ?, integrity_tag = ? "
                "WHERE token_hash = ? AND state = 'PENDING'",
                (
                    state.value,
                    self._tag(token_hash, state.value, row["expires_at"], row["payload"]),
                    token_hash,
                ),
            )
            if cursor.rowcount != 1:
                return None, "NOT_FOUND"
            return replace(pending, state=state), "OK"

    def claim_execution_effect(
        self,
        token: object,
        *,
        user_id: object,
        session_id: object,
        approval_binding: ActionApprovalBinding,
        now: float | None = None,
    ) -> str | None:
        token_hash = self._token_hash(token)
        if token_hash is None or not isinstance(user_id, UUID) or not isinstance(session_id, UUID):
            return None
        with self._connection(write=True) as connection:
            pending, row = self._read_pending(
                connection,
                token_hash,
                include_terminal=True,
                now=now,
            )
            if (
                pending is None
                or row is None
                or row["state"] != ApprovalState.EXECUTING.value
                or pending.execution_claim_id is not None
                or not self._record_matches_owner(pending, user_id, session_id)
                or type(approval_binding) is not ActionApprovalBinding
                or pending.approval_binding != approval_binding
            ):
                return None
            if _approval_now(now) >= datetime.fromisoformat(row["expires_at"]):
                expired_state = _transition_approval_state(
                    ApprovalState.EXECUTING,
                    ApprovalState.EXPIRED,
                )
                connection.execute(
                    "UPDATE pending_approvals SET state = ?, integrity_tag = ? "
                    "WHERE token_hash = ? AND state = 'EXECUTING'",
                    (
                        expired_state.value,
                        self._tag(
                            token_hash,
                            expired_state.value,
                            row["expires_at"],
                            row["payload"],
                        ),
                        token_hash,
                    ),
                )
                return None
            execution_claim_id = secrets.token_hex(32)
            payload_data = json.loads(row["payload"])
            payload_data["execution_claim_id"] = execution_claim_id
            payload = self._canonical(payload_data)
            cursor = connection.execute(
                "UPDATE pending_approvals SET payload = ?, integrity_tag = ? "
                "WHERE token_hash = ? AND state = 'EXECUTING'",
                (
                    payload,
                    self._tag(token_hash, row["state"], row["expires_at"], payload),
                    token_hash,
                ),
            )
            return execution_claim_id if cursor.rowcount == 1 else None

    def execute_approved_effect(
        self,
        token: object,
        *,
        user_id: object,
        session_id: object,
        approval_binding: ActionApprovalBinding,
        effect: Callable[[str, Callable[[], bool]], Any],
        now: float | None = None,
    ) -> tuple[bool, Any]:
        if not callable(effect):
            raise TypeError("An approved effect callback is required.")
        execution_claim_id = self.claim_execution_effect(
            token,
            user_id=user_id,
            session_id=session_id,
            approval_binding=approval_binding,
            now=now,
        )
        if execution_claim_id is None:
            return False, None
        execution_check = lambda: self.authorize_execution(
            token,
            user_id=user_id,
            session_id=session_id,
            approval_binding=approval_binding,
            execution_claim_id=execution_claim_id,
        )
        if not execution_check():
            return False, None
        result = effect(execution_claim_id, execution_check)
        if not self._complete_execution(
            token,
            user_id=user_id,
            session_id=session_id,
            approval_binding=approval_binding,
            execution_claim_id=execution_claim_id,
            now=now,
        ):
            raise ApprovalStorageUnavailable("Approval storage is unavailable.")
        return True, result

    def authorize_execution(
        self,
        token: object,
        *,
        user_id: object,
        session_id: object,
        approval_binding: ActionApprovalBinding,
        execution_claim_id: str | None = None,
        now: float | None = None,
    ) -> bool:
        token_hash = self._token_hash(token)
        if token_hash is None or not isinstance(user_id, UUID) or not isinstance(session_id, UUID):
            return False
        with self._connection(write=True) as connection:
            pending, row = self._read_pending(
                connection,
                token_hash,
                include_terminal=True,
                now=now,
            )
            if (
                pending is None
                or row is None
                or row["state"] != ApprovalState.EXECUTING.value
                or not self._record_matches_owner(pending, user_id, session_id)
                or type(approval_binding) is not ActionApprovalBinding
                or pending.approval_binding != approval_binding
                or not isinstance(execution_claim_id, str)
                or pending.execution_claim_id is None
                or not hmac.compare_digest(
                    pending.execution_claim_id,
                    execution_claim_id,
                )
            ):
                return False
            return True

    def _complete_execution(
        self,
        token: object,
        *,
        user_id: object,
        session_id: object,
        approval_binding: ActionApprovalBinding,
        execution_claim_id: str,
        now: float | None = None,
    ) -> bool:
        token_hash = self._token_hash(token)
        if token_hash is None or not isinstance(user_id, UUID) or not isinstance(session_id, UUID):
            return False
        with self._connection(write=True) as connection:
            pending, row = self._read_pending(
                connection,
                token_hash,
                include_terminal=True,
                now=now,
            )
            if (
                pending is None
                or row is None
                or row["state"] != ApprovalState.EXECUTING.value
                or not self._record_matches_owner(pending, user_id, session_id)
                or type(approval_binding) is not ActionApprovalBinding
                or pending.approval_binding != approval_binding
                or pending.execution_claim_id is None
                or not isinstance(execution_claim_id, str)
                or not hmac.compare_digest(
                    pending.execution_claim_id,
                    execution_claim_id,
                )
            ):
                return False
            state = _transition_approval_state(ApprovalState.EXECUTING, ApprovalState.CONSUMED)
            audit_evidence = _execution_audit(
                pending,
                token_hash,
                user_id,
                session_id,
                execution_claim_id,
                now,
            )
            payload_data = json.loads(row["payload"])
            payload_data["lifecycle_audit"] = audit_evidence
            payload = self._canonical(payload_data)
            cursor = connection.execute(
                "UPDATE pending_approvals SET state = ?, payload = ?, integrity_tag = ? "
                "WHERE token_hash = ? AND state = 'EXECUTING'",
                (
                    state.value,
                    payload,
                    self._tag(token_hash, state.value, row["expires_at"], payload),
                    token_hash,
                ),
            )
            return cursor.rowcount == 1

    def completion_audit(
        self,
        token: object,
        *,
        user_id: object,
        session_id: object,
    ) -> dict[str, Any] | None:
        token_hash = self._token_hash(token)
        if token_hash is None or not isinstance(user_id, UUID) or not isinstance(session_id, UUID):
            return None
        with self._connection() as connection:
            pending, row = self._read_pending(
                connection,
                token_hash,
                include_terminal=True,
            )
            if (
                pending is None
                or row is None
                or row["state"] != ApprovalState.CONSUMED.value
                or not self._record_matches_owner(pending, user_id, session_id)
                or not isinstance(pending.audit_evidence, dict)
                or pending.audit_evidence.get("event") != "APPROVAL_EXECUTION_COMPLETED"
            ):
                return None
            return deepcopy(pending.audit_evidence)

    def cancel(
        self,
        token: object,
        *,
        user_id: object,
        session_id: object,
        reason_code: str,
        approval_binding: ActionApprovalBinding | None = None,
    ) -> str:
        token_hash = self._token_hash(token)
        if (
            token_hash is None
            or not isinstance(user_id, UUID)
            or not isinstance(session_id, UUID)
            or not isinstance(reason_code, str)
            or reason_code not in _CANCELLATION_REASON_CODES
        ):
            return "MISSING"
        with self._connection(write=True) as connection:
            pending, row = self._read_pending(
                connection,
                token_hash,
                include_terminal=True,
            )
            if row is None:
                return "NOT_FOUND"
            if pending is None or not self._record_matches_owner(pending, user_id, session_id):
                return "OWNER_MISMATCH"
            if pending.execution_claim_id is not None:
                return "EXECUTION_STARTED"
            try:
                expected_binding = approval_binding_for_pending(
                    user_id,
                    pending.decision_id,
                    pending.execution_context,
                )
            except ApprovalStorageUnavailable:
                return "BINDING_MISMATCH"
            if (
                pending.approval_binding != expected_binding
                or (
                    approval_binding is not None
                    and (
                        type(approval_binding) is not ActionApprovalBinding
                        or approval_binding != expected_binding
                    )
                )
            ):
                return "BINDING_MISMATCH"
            state = ApprovalState(row["state"])
            if state is ApprovalState.CANCELLED:
                return "ALREADY_CANCELLED"
            if state is ApprovalState.EXPIRED:
                return "EXPIRED"
            if state not in {
                ApprovalState.PENDING,
                ApprovalState.APPROVED,
                ApprovalState.EXECUTING,
            }:
                return "NOT_PENDING"
            audit_evidence = _cancellation_audit(
                pending,
                token_hash,
                user_id,
                session_id,
                reason_code,
            )
            payload_data = json.loads(row["payload"])
            payload_data["lifecycle_audit"] = audit_evidence
            payload = self._canonical(payload_data)
            cancelled_state = _transition_approval_state(
                state,
                ApprovalState.CANCELLED,
            )
            cursor = connection.execute(
                "UPDATE pending_approvals SET state = ?, payload = ?, integrity_tag = ? "
                "WHERE token_hash = ? AND state IN ('PENDING', 'APPROVED', 'EXECUTING')",
                (
                    cancelled_state.value,
                    payload,
                    self._tag(
                        token_hash,
                        cancelled_state.value,
                        row["expires_at"],
                        payload,
                    ),
                    token_hash,
                ),
            )
            return "CANCELLED" if cursor.rowcount == 1 else "NOT_PENDING"


class UnavailablePendingApprovalStore:
    """Fail-closed placeholder when persistent approval integrity is unconfigured."""

    def create(self, *args, **kwargs) -> str:
        raise ApprovalStorageUnavailable("Approval storage is unavailable.")

    def inspect(self, *args, **kwargs) -> None:
        raise ApprovalStorageUnavailable("Approval storage is unavailable.")

    def consume(self, *args, **kwargs) -> tuple[None, str]:
        raise ApprovalStorageUnavailable("Approval storage is unavailable.")

    def approve_for_execution(self, *args, **kwargs) -> tuple[None, str]:
        raise ApprovalStorageUnavailable("Approval storage is unavailable.")

    def authorize_execution(self, *args, **kwargs) -> bool:
        raise ApprovalStorageUnavailable("Approval storage is unavailable.")

    def complete_execution(self, *args, **kwargs) -> bool:
        raise ApprovalStorageUnavailable("Approval storage is unavailable.")

    def cancel(self, *args, **kwargs) -> str:
        raise ApprovalStorageUnavailable("Approval storage is unavailable.")


def pending_approval_store_from_environment(
    environ: dict[str, str] | None = None,
) -> SQLitePendingApprovalStore | UnavailablePendingApprovalStore:
    values = os.environ if environ is None else environ
    if not values.get("PARMAR_APPROVAL_STORE_KEY") and not values.get("PARMAR_SESSION_STORE_KEY"):
        return UnavailablePendingApprovalStore()
    return SQLitePendingApprovalStore.from_environment(values)