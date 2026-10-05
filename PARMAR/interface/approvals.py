"""Short-lived, one-use server-side records for human approval requests."""

from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass, fields
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sqlite3
import threading
import time
from typing import Any, Iterator
from uuid import UUID

from PARMAR.chat.context import ChatContext
from PARMAR.interface.dashboard import TerminalDashboard
from PARMAR.state import LifecycleState


class ApprovalStorageUnavailable(RuntimeError):
    """Raised when persistent approval data cannot be safely accessed."""


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
        decision: str | None = None,
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


class SQLitePendingApprovalStore:
    """SQLite-backed pending reviews; records are authenticated and one-use."""

    _SCHEMA_VERSION = 1
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
        if version not in (0, self._SCHEMA_VERSION):
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
                    state TEXT NOT NULL CHECK(state IN ('PENDING', 'CONSUMED', 'REJECTED', 'EXPIRED')),
                    expires_at TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    integrity_tag TEXT NOT NULL
                );
                CREATE INDEX pending_approvals_expiry ON pending_approvals(expires_at);
                PRAGMA user_version = 1;
                """
            )
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
    def _decode_pending(cls, payload: str, expires_at: str) -> PendingApproval:
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
                execution["context"] = ChatContext(**execution["context"])
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
    ) -> tuple[PendingApproval | None, sqlite3.Row | None]:
        row = connection.execute(
            "SELECT * FROM pending_approvals WHERE token_hash = ?",
            (token_hash,),
        ).fetchone()
        if row is None:
            return None, None
        state, expires_at, payload, tag = row["state"], row["expires_at"], row["payload"], row["integrity_tag"]
        if (
            state not in {"PENDING", "CONSUMED", "REJECTED", "EXPIRED"}
            or not isinstance(expires_at, str)
            or not isinstance(payload, str)
            or len(payload.encode("utf-8")) > self._MAX_PAYLOAD_BYTES
            or not isinstance(tag, str)
            or len(tag) != 64
            or any(character not in "0123456789abcdef" for character in tag)
            or not hmac.compare_digest(tag, self._tag(token_hash, state, expires_at, payload))
        ):
            raise ApprovalStorageUnavailable("Approval storage is unavailable.")
        if state != "PENDING":
            return None, row
        pending = self._decode_pending(payload, expires_at)
        expiry = datetime.fromisoformat(expires_at)
        if datetime.now(timezone.utc) >= expiry:
            connection.execute(
                "UPDATE pending_approvals SET state = 'EXPIRED', integrity_tag = ? WHERE token_hash = ?",
                (self._tag(token_hash, "EXPIRED", expires_at, payload), token_hash),
            )
            return None, connection.execute(
                "SELECT * FROM pending_approvals WHERE token_hash = ?",
                (token_hash,),
            ).fetchone()
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
        execution_context: dict[str, Any] | None = None,
        now: float | None = None,
    ) -> str:
        if not isinstance(user_id, UUID) or not isinstance(session_id, UUID):
            raise ValueError("Pending approvals require authenticated user and session IDs.")
        if not isinstance(decision_id, str) or not decision_id:
            raise ValueError("Pending approvals require their originating decision ID.")
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
        )
        payload = self._canonical(self._encode_pending(pending))
        expiry = datetime.now(timezone.utc) + timedelta(seconds=self._ttl_seconds)
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
            pending, _row = self._read_pending(connection, token_hash)
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
        now: float | None = None,
    ) -> tuple[PendingApproval | None, str]:
        token_hash = self._token_hash(token)
        if token_hash is None or not isinstance(user_id, UUID) or not isinstance(session_id, UUID):
            return None, "MISSING"
        with self._connection(write=True) as connection:
            pending, row = self._read_pending(connection, token_hash)
            if row is None:
                return None, "NOT_FOUND"
            if pending is None:
                return None, "EXPIRED" if row["state"] == "EXPIRED" else "NOT_FOUND"
            if not self._record_matches_owner(pending, user_id, session_id):
                return None, "OWNER_MISMATCH"
            if request_text is not None and request_text != pending.request_text:
                return None, "REQUEST_MISMATCH"
            state = "REJECTED" if decision in {"REJECT", "REJECTED"} else "CONSUMED"
            expiry = row["expires_at"]
            payload = row["payload"]
            cursor = connection.execute(
                "UPDATE pending_approvals SET state = ?, integrity_tag = ? "
                "WHERE token_hash = ? AND state = 'PENDING'",
                (state, self._tag(token_hash, state, expiry, payload), token_hash),
            )
            if cursor.rowcount != 1:
                return None, "NOT_FOUND"
            return pending, "OK"


class UnavailablePendingApprovalStore:
    """Fail-closed placeholder when persistent approval integrity is unconfigured."""

    def create(self, *args, **kwargs) -> str:
        raise ApprovalStorageUnavailable("Approval storage is unavailable.")

    def inspect(self, *args, **kwargs) -> None:
        raise ApprovalStorageUnavailable("Approval storage is unavailable.")

    def consume(self, *args, **kwargs) -> tuple[None, str]:
        raise ApprovalStorageUnavailable("Approval storage is unavailable.")


def pending_approval_store_from_environment(
    environ: dict[str, str] | None = None,
) -> SQLitePendingApprovalStore | UnavailablePendingApprovalStore:
    values = os.environ if environ is None else environ
    if not values.get("PARMAR_APPROVAL_STORE_KEY") and not values.get("PARMAR_SESSION_STORE_KEY"):
        return UnavailablePendingApprovalStore()
    return SQLitePendingApprovalStore.from_environment(values)