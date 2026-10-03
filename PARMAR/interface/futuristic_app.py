"""Modern PARMAR UI foundation served by the Python standard library."""

from __future__ import annotations

import json
import os
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlparse
from uuid import UUID

from PARMAR.chat.context import MAX_RECENT_MESSAGES, ChatContext
from PARMAR.chat.orchestration import SINGLE_PROVIDER, VERIFIED_MULTI_MODEL
from PARMAR.chat.service import ChatService
from PARMAR.audit.decision_logs import DecisionLogManager
from PARMAR.conversations import (
    MAX_MESSAGE_LENGTH,
    ConversationRepository,
    ConversationLimitExceeded,
    InMemoryConversationRepository,
    MessageRepository,
)
from PARMAR.identity import HTTPRequestContext, LocalDemoPrincipalResolver, Principal, PrincipalResolver
from PARMAR.memories import (
    InMemoryMemoryRepository,
    MAX_RETRIEVED_MEMORIES,
    MemoryConsentRequired,
    MemoryRepository,
)
from PARMAR.chat.readiness import (
    ProviderConfigurationRegistry,
    external_authorization_from_environment,
)
from PARMAR.interface.ui_adapter import PARMARUIAdapter
from PARMAR.interface.approvals import PendingApprovalStore
from PARMAR.phone.phone_awareness import PhoneAwarenessModule
from PARMAR.sessions import (
    SESSION_COOKIE_NAME,
    SessionManager,
    clear_session_cookie_header,
    session_cookie_header,
    session_manager_from_environment,
)
from PARMAR.simulation.scenarios import get_scenarios
from PARMAR.simulation.simulator import evaluate_scenario

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INDEX_FILE = STATIC_DIR / "index.html"
MAX_POST_BODY_BYTES = 1_048_576
PENDING_APPROVALS = PendingApprovalStore()
PHONE_AWARENESS = PhoneAwarenessModule()
EXTERNAL_AUTHORIZATION = external_authorization_from_environment()
PRINCIPAL_RESOLVER: PrincipalResolver = LocalDemoPrincipalResolver()
SESSION_MANAGER: SessionManager | None = session_manager_from_environment()
_IN_MEMORY_CONVERSATIONS = InMemoryConversationRepository()
CONVERSATION_REPOSITORY: ConversationRepository = _IN_MEMORY_CONVERSATIONS
MESSAGE_REPOSITORY: MessageRepository = _IN_MEMORY_CONVERSATIONS
MEMORY_REPOSITORY: MemoryRepository = InMemoryMemoryRepository()

_CLIENT_IDENTITY_FIELDS = frozenset({
    "user_id",
    "userid",
    "owner_id",
    "ownerid",
    "owner_user_id",
    "owneruserid",
    "session_id",
    "sessionid",
    "principal",
    "principal_id",
    "principalid",
    "authenticated_user_id",
    "authenticateduserid",
})
_CLIENT_IDENTITY_HEADERS = frozenset({
    "authorization",
    "x-authenticated-user",
    "x-authenticated-user-id",
    "x-authenticated-subject",
    "x-auth-subject",
    "x-remote-user",
    "x-user",
    "x-owner",
    "x-session",
    "x-principal",
    "x-identity",
})
_CLIENT_IDENTITY_HEADER_PREFIXES = (
    "x-user-id",
    "x-owner-id",
    "x-session-id",
    "x-principal-id",
    "x-identity-",
)


def _normalized_identity_name(value: object) -> str:
    return str(value).strip().casefold().replace("-", "_")


def _contains_client_identity_field(value: object) -> bool:
    if isinstance(value, dict):
        for key, item in value.items():
            if _normalized_identity_name(key) in _CLIENT_IDENTITY_FIELDS:
                return True
            if _contains_client_identity_field(item):
                return True
    elif isinstance(value, list):
        return any(_contains_client_identity_field(item) for item in value)
    return False


def _contains_client_identity_header(headers: object) -> bool:
    items = getattr(headers, "items", None)
    if not callable(items):
        return False
    for name, _value in items():
        normalized = str(name).strip().casefold().replace("_", "-")
        if normalized in _CLIENT_IDENTITY_HEADERS or normalized.startswith(_CLIENT_IDENTITY_HEADER_PREFIXES):
            return True
    return False


def _contains_client_identity_query(query: str) -> bool:
    return any(
        _normalized_identity_name(name) in _CLIENT_IDENTITY_FIELDS
        for name, _value in parse_qsl(query, keep_blank_values=True)
    )


def _reject_client_identity(request: object, parsed, payload: object = None) -> bool:
    if (
        _contains_client_identity_header(getattr(request, "headers", None))
        or _contains_client_identity_query(parsed.query)
        or _contains_client_identity_field(payload)
    ):
        request.send_error(400, "Client-supplied identity is not accepted")
        return True
    return False


def _read_session_cookie(request: object) -> str | None:
    headers = getattr(request, "headers", None)
    get_header = getattr(headers, "get", None)
    raw_cookie = get_header("Cookie", "") if callable(get_header) else ""
    if not isinstance(raw_cookie, str) or not raw_cookie:
        return None
    parsed_cookie = SimpleCookie()
    try:
        parsed_cookie.load(raw_cookie)
    except CookieError:
        return None
    morsel = parsed_cookie.get(SESSION_COOKIE_NAME)
    return morsel.value if morsel is not None else None


def _resolve_request_context(request: object) -> bool:
    token = _read_session_cookie(request)
    if token is not None and SESSION_MANAGER is not None:
        session = SESSION_MANAGER.resolve(token)
        if session is not None:
            principal = Principal.authenticated_user(session.user_id, session.authentication_source)
            request.request_context = HTTPRequestContext(principal, session.session_id)
            return True
    try:
        principal = PRINCIPAL_RESOLVER.resolve(request)
    except Exception:
        request.send_error(503, "Principal resolution is unavailable")
        return False
    if type(principal) is not Principal:
        request.send_error(503, "Principal resolution is unavailable")
        return False
    if principal.authenticated:
        request.send_error(401, "A valid server-side session is required")
        return False
    request.request_context = HTTPRequestContext(principal=principal)
    return True


def _require_csrf(request: object, parsed) -> bool:
    context = getattr(request, "request_context", None)
    if context is None or not context.principal.authenticated:
        return True
    if SESSION_MANAGER is None or context.session_id is None:
        request.send_error(401, "A valid server-side session is required")
        return False
    headers = getattr(request, "headers", None)
    get_header = getattr(headers, "get", None)
    token = get_header("X-CSRF-Token") if callable(get_header) else None
    if not SESSION_MANAGER.validate_csrf(context.session_id, token):
        request.send_error(403, "CSRF validation failed")
        return False
    return True


def _send_json_with_headers(request: object, status_code: int, payload: dict, headers: dict[str, str]) -> None:
    test_sender = getattr(request, "_send_json_with_headers", None)
    if callable(test_sender):
        test_sender(status_code, payload, headers)
        return
    body = json.dumps(payload, indent=2).encode("utf-8")
    request.send_response(status_code)
    request.send_header("Content-Type", "application/json")
    request.send_header("Content-Length", str(len(body)))
    for name, value in headers.items():
        request.send_header(name, value)
    request.end_headers()
    request.wfile.write(body)


def _public_memory(record) -> dict[str, object]:
    return {
        "memory_id": str(record.memory_id),
        "content": record.content,
        "provenance": record.provenance,
        "created_at": record.created_at.isoformat(),
        "updated_at": record.updated_at.isoformat(),
    }


def _log_memory_operation(
    user_id: UUID,
    operation: str,
    memory_id: UUID | None = None,
    retrieved_count: int | None = None,
) -> None:
    payload: dict[str, str | int | None] = {
        "user_id": str(user_id),
        "operation": operation,
        "memory_id": str(memory_id) if memory_id is not None else None,
    }
    if isinstance(retrieved_count, int) and not isinstance(retrieved_count, bool):
        payload["retrieved_count"] = max(0, min(retrieved_count, MAX_RETRIEVED_MEMORIES))
    DecisionLogManager().log_event("memory_operation", payload)


def _issue_authenticated_session_response(
    request: object,
    user_id,
    authentication_source: str,
):
    """Issue a session only for a trusted server-side authentication event."""
    if SESSION_MANAGER is None:
        request.send_error(503, "Authenticated sessions are not configured")
        return None
    credentials = SESSION_MANAGER.create_authenticated_session(user_id, authentication_source)
    csrf_token = SESSION_MANAGER.csrf_token(credentials.session.session_id)
    if csrf_token is None:
        request.send_error(503, "Authenticated session creation failed")
        return None
    _send_json_with_headers(
        request,
        201,
        {"authenticated": True, "csrf_token": csrf_token},
        {
            "Set-Cookie": session_cookie_header(credentials.session_token),
            "Cache-Control": "no-store",
        },
    )
    return credentials


def _rotate_authenticated_session_response(request: object):
    """Rotate a session after a trusted authentication/privilege boundary."""
    if SESSION_MANAGER is None:
        request.send_error(503, "Authenticated sessions are not configured")
        return None
    credentials = SESSION_MANAGER.rotate(_read_session_cookie(request))
    if credentials is None:
        request.send_error(401, "A valid server-side session is required")
        return None
    csrf_token = SESSION_MANAGER.csrf_token(credentials.session.session_id)
    if csrf_token is None:
        request.send_error(503, "Authenticated session rotation failed")
        return None
    _send_json_with_headers(
        request,
        200,
        {"authenticated": True, "csrf_token": csrf_token},
        {
            "Set-Cookie": session_cookie_header(credentials.session_token),
            "Cache-Control": "no-store",
        },
    )
    return credentials


class PARMARRequestHandler(BaseHTTPRequestHandler):
    """Serve the futuristic PARMAR interface and its API."""

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api" or parsed.path.startswith("/api/"):
            if _reject_client_identity(self, parsed) or not _resolve_request_context(self):
                return
        if parsed.path == "/api/session":
            context = self.request_context
            if context.principal.authenticated:
                csrf_token = SESSION_MANAGER.csrf_token(context.session_id) if SESSION_MANAGER else None
                if csrf_token is None:
                    self.send_error(401, "A valid server-side session is required")
                    return
                _send_json_with_headers(
                    self,
                    200,
                    {"authenticated": True, "csrf_token": csrf_token},
                    {"Cache-Control": "no-store"},
                )
            else:
                _send_json_with_headers(
                    self,
                    200,
                    {"authenticated": False},
                    {"Cache-Control": "no-store"},
                )
            return
        if parsed.path == "/api/memory":
            context = self.request_context
            if not context.principal.authenticated or context.principal.user_id is None:
                self.send_error(401, "An authenticated session is required")
                return
            consent = MEMORY_REPOSITORY.get_consent(context.principal.user_id)
            _send_json_with_headers(self, 200, {
                "consent": consent.granted,
                "memories": [
                    _public_memory(record)
                    for record in MEMORY_REPOSITORY.list_owned(context.principal.user_id)
                ],
            }, {"Cache-Control": "no-store"})
            return
        if parsed.path == "/api/providers":
            readiness = ProviderConfigurationRegistry.discover(
                authorization=EXTERNAL_AUTHORIZATION,
            )
            self._send_json(200, readiness.public_payload())
            return
        if parsed.path == "/":
            self._serve_static_file(INDEX_FILE.name)
            return
        if parsed.path.startswith("/static/"):
            self._serve_static_file(unquote(parsed.path.removeprefix("/static/")))
            return
        if parsed.path == "/api/scenarios":
            self._send_json(200, {"scenarios": get_scenarios()})
            return
        if parsed.path == "/api/phone":
            if self.request_context.principal.authenticated:
                self.send_error(403, "Phone awareness is available only in anonymous local-demo mode")
                return
            # This endpoint processes simulated events only; it never accesses device APIs.
            self._send_json(200, PHONE_AWARENESS.get_status())
            return
        self.send_error(404, "Not found")

    def _serve_static_file(self, relative_path: str) -> None:
        root = STATIC_DIR.resolve()
        try:
            target = (root / relative_path).resolve()
            target.relative_to(root)
        except (OSError, RuntimeError, ValueError):
            self.send_error(404, "Not found")
            return
        if not target.is_file():
            self.send_error(404, "Not found")
            return
        self._serve_file(target)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if _reject_client_identity(self, parsed):
            return
        raw_content_length = self.headers.get("Content-Length", "0")
        try:
            content_length = int(raw_content_length)
        except (TypeError, ValueError):
            self.send_error(400, "Invalid Content-Length")
            return
        if content_length < 0:
            self.send_error(400, "Invalid Content-Length")
            return
        if content_length > MAX_POST_BODY_BYTES:
            self.send_error(413, "Request body too large")
            return
        body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            payload = json.loads(body.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
            self.send_error(400, "Invalid JSON")
            return
        if not isinstance(payload, dict):
            self.send_error(400, "JSON body must be an object")
            return
        if _reject_client_identity(self, parsed, payload):
            return
        if not _resolve_request_context(self):
            return
        if not _require_csrf(self, parsed):
            return

        if parsed.path == "/api/logout":
            context = self.request_context
            if context.principal.authenticated and SESSION_MANAGER is not None:
                SESSION_MANAGER.revoke(context.session_id)
            _send_json_with_headers(
                self,
                200,
                {"logged_out": True, "authenticated": False},
                {
                    "Set-Cookie": clear_session_cookie_header(),
                    "Cache-Control": "no-store",
                },
            )
            return

        if parsed.path == "/api/memory":
            context = self.request_context
            if not context.principal.authenticated or context.principal.user_id is None:
                self.send_error(401, "An authenticated session is required")
                return
            user_id = context.principal.user_id
            action = payload.get("action")
            allowed_fields = {
                "consent": {"action", "granted"},
                "save": {"action", "content"},
                "update": {"action", "memory_id", "content"},
                "delete": {"action", "memory_id"},
            }
            if not isinstance(action, str) or action not in allowed_fields:
                self.send_error(400, "Unsupported memory operation")
                return
            if set(payload) - allowed_fields[action]:
                self.send_error(400, "Unsupported memory fields")
                return
            if action == "consent":
                granted = payload.get("granted")
                if not isinstance(granted, bool):
                    self.send_error(400, "Memory consent must be boolean")
                    return
                consent = MEMORY_REPOSITORY.set_consent(user_id, granted)
                _log_memory_operation(user_id, "consent_granted" if granted else "consent_revoked")
                _send_json_with_headers(self, 200, {"consent": consent.granted}, {"Cache-Control": "no-store"})
                return
            if action in {"update", "delete"}:
                memory_id_value = payload.get("memory_id")
                if not isinstance(memory_id_value, str):
                    self.send_error(404, "Memory not found")
                    return
                try:
                    memory_id = UUID(memory_id_value)
                except ValueError:
                    self.send_error(404, "Memory not found")
                    return
            else:
                memory_id = None
            if action == "delete":
                if not MEMORY_REPOSITORY.delete_owned(memory_id, user_id):
                    self.send_error(404, "Memory not found")
                    return
                _log_memory_operation(user_id, "delete", memory_id)
                _send_json_with_headers(self, 200, {"deleted": True}, {"Cache-Control": "no-store"})
                return
            content = payload.get("content")
            try:
                if action == "save":
                    record = MEMORY_REPOSITORY.create_owned(user_id, content)
                else:
                    record = MEMORY_REPOSITORY.update_owned(memory_id, user_id, content)
            except MemoryConsentRequired:
                self._send_json(403, {
                    "error": "MEMORY_CONSENT_REQUIRED",
                    "message": "Explicit memory consent is required before saving or updating.",
                })
                return
            except ValueError as error:
                self._send_json(400, {
                    "error": "INVALID_MEMORY",
                    "message": str(error),
                })
                return
            if record is None:
                self.send_error(404, "Memory not found")
                return
            _log_memory_operation(user_id, action, record.memory_id)
            _send_json_with_headers(
                self,
                201 if action == "save" else 200,
                _public_memory(record),
                {"Cache-Control": "no-store"},
            )
            return

        if parsed.path == "/api/analyze":
            request_value = payload.get("request", "")
            if not isinstance(request_value, str):
                self.send_error(400, "Request must be a string")
                return
            language = payload.get("language", "en")
            if not isinstance(language, str):
                self.send_error(400, "Language must be a string")
                return
            request_text = request_value.strip()
            result, dashboard, summary = PARMARUIAdapter.analyze_request_with_dashboard(
                request_text,
                language=language,
            )
            if (
                dashboard is not None
                and summary is not None
                and result.get("status") == "APPROVAL_REQUIRED"
                and summary.get("enforcement", {}).get("status") == "HUMAN_APPROVAL_REQUIRED"
                and self.request_context.principal.authenticated
                and self.request_context.session_id is not None
            ):
                decision_id = summary.get("enforcement", {}).get("decision_id")
                if isinstance(decision_id, str) and decision_id:
                    result["approval_id"] = PENDING_APPROVALS.create(
                        request_text,
                        result.copy(),
                        dashboard,
                        summary,
                        user_id=self.request_context.principal.user_id,
                        session_id=self.request_context.session_id,
                        decision_id=decision_id,
                    )
            self._send_json(200, result)
            return

        if parsed.path == "/api/scenarios/evaluate":
            scenario_id = payload.get("scenario_id")
            if not isinstance(scenario_id, str) or not scenario_id:
                self.send_error(400, "Scenario ID must be a string")
                return
            scenario = next(
                (item for item in get_scenarios() if item["scenario_id"] == scenario_id),
                None,
            )
            if scenario is None:
                self.send_error(404, "Scenario not found")
                return
            evaluation = evaluate_scenario(scenario)
            actual_result = dict(evaluation["actual_result"])
            actual_behavior = evaluation["actual_behavior"]
            actual_status = {
                "SAFE_TO_REVIEW": "SAFE",
                "HUMAN_REVIEW_REQUIRED": "APPROVAL_REQUIRED",
                "PHONE_AWARENESS_REJECTED": "BLOCKED",
                "EMERGENCY_STOP": "BLOCKED",
                "APPROVED": "APPROVED",
                "REJECTED": "BLOCKED",
            }.get(actual_behavior, actual_behavior)
            actual_result.update({
                "status": actual_status,
                "request": scenario["proposed_ai_action"],
                "risk": {"risk_level": evaluation["actual_risk_level"]},
                "human_approval_required": evaluation["actual_human_approval_required"],
                "message": (
                    f"Scenario {'matched' if evaluation['passed'] else 'did not match'} expected policy. "
                    f"Expected {evaluation['expected_parmar_behavior']}; actual {actual_behavior}."
                ),
            })
            self._send_json(200, {
                "evaluation": {
                    key: evaluation[key]
                    for key in (
                        "scenario_id",
                        "description",
                        "expected_risk_level",
                        "expected_parmar_behavior",
                        "actual_risk_level",
                        "actual_behavior",
                        "passed",
                        "mismatch",
                    )
                },
                "result": actual_result,
            })
            return

        if parsed.path == "/api/approval":
            context = self.request_context
            if (
                not context.principal.authenticated
                or context.principal.user_id is None
                or context.session_id is None
            ):
                self._send_json(403, {
                    "status": "APPROVAL_INVALID",
                    "safe": False,
                    "message": "An authenticated session that owns this review is required.",
                })
                return
            approval_id = payload.get("approval_id")
            decision = payload.get("decision")
            request_text = payload.get("request")
            if request_text is not None and not isinstance(request_text, str):
                self.send_error(400, "Request must be a string when supplied")
                return
            if not isinstance(decision, str):
                self.send_error(400, "Decision must be a string")
                return
            decision = decision.strip().upper()
            if decision not in {"APPROVE", "APPROVED", "REJECT", "REJECTED", "INFO", "ALTERNATIVE"}:
                self.send_error(400, "Unsupported decision")
                return
            pending = PENDING_APPROVALS.inspect(
                approval_id,
                user_id=context.principal.user_id,
                session_id=context.session_id,
            )
            if pending is None:
                self._send_json(410, {
                    "status": "APPROVAL_INVALID",
                    "safe": False,
                    "message": "The pending approval is missing, expired, or already used.",
                })
                return
            if request_text is not None and request_text.strip() != pending.request_text:
                self._send_json(409, {
                    "status": "APPROVAL_REQUEST_MISMATCH",
                    "safe": False,
                    "message": "The supplied request does not match the pending review.",
                })
                return
            if decision in {"INFO", "ALTERNATIVE"}:
                result = pending.response.copy()
                result["approval_id"] = approval_id
                result["message"] = (
                    "Review the recorded risks and safer alternative before deciding."
                    if decision == "INFO"
                    else "The safer alternative is displayed in the review. The original proposal remains pending."
                )
                self._send_json(200, result)
                return
            pending, state = PENDING_APPROVALS.consume(
                approval_id,
                user_id=context.principal.user_id,
                session_id=context.session_id,
                request_text=request_text.strip() if request_text is not None else None,
            )
            if pending is None:
                status = 409 if state == "REQUEST_MISMATCH" else 410
                self._send_json(status, {
                    "status": "APPROVAL_INVALID",
                    "safe": False,
                    "message": "The pending approval is missing, expired, mismatched, or already used.",
                })
                return
            result = PARMARUIAdapter.apply_pending_human_decision(
                pending.response.copy(),
                pending.dashboard,
                pending.summary,
                decision,
            )
            result.pop("approval_id", None)
            self._send_json(200, result)
            return

        if parsed.path == "/api/chat":
            message_value = payload.get("message", "")
            language = payload.get("language", "en")
            conversation_id_value = payload.get("conversation_id")
            context_payload = payload.get("context")
            if not isinstance(message_value, str):
                self.send_error(400, "Message must be a string")
                return
            if not isinstance(language, str):
                self.send_error(400, "Language must be a string")
                return
            if context_payload is not None and not isinstance(context_payload, dict):
                self.send_error(400, "Context must be an object")
                return
            if conversation_id_value is not None and not isinstance(conversation_id_value, str):
                self.send_error(400, "Conversation ID must be a string")
                return
            if isinstance(context_payload, dict):
                if "memory" in context_payload and not isinstance(context_payload["memory"], list):
                    self.send_error(400, "Context memory must be an array")
                    return
                if "recent_messages" in context_payload and not isinstance(context_payload["recent_messages"], list):
                    self.send_error(400, "Recent messages must be an array")
                    return
            if "provider" in payload and not isinstance(payload["provider"], str):
                self.send_error(400, "Provider must be a string")
                return
            message = message_value.strip()
            if len(message) > MAX_MESSAGE_LENGTH:
                self.send_error(413, "Chat message exceeds the conversation storage limit")
                return
            orchestration_mode = payload.get("orchestration_mode", SINGLE_PROVIDER)
            if not isinstance(orchestration_mode, str) or orchestration_mode not in {
                SINGLE_PROVIDER,
                VERIFIED_MULTI_MODEL,
            }:
                self._send_json(400, {
                    "safe": False,
                    "status": "INVALID_ORCHESTRATION_MODE",
                    "message": "The requested orchestration mode is not supported.",
                    "provider_error": True,
                })
                return
            request_context = self.request_context
            context = ChatContext(language=language)
            conversation_id = None
            recent_messages = context_payload.get("recent_messages") if isinstance(context_payload, dict) else None
            if request_context.principal.authenticated:
                owner_user_id = request_context.principal.user_id
                if owner_user_id is None:
                    self.send_error(401, "A valid server-side session is required")
                    return
                created_for_message = conversation_id_value is None
                if created_for_message:
                    try:
                        conversation = CONVERSATION_REPOSITORY.create_for_message(owner_user_id, message)
                    except ConversationLimitExceeded:
                        self.send_error(429, "Conversation storage limit reached")
                        return
                else:
                    try:
                        conversation_id = UUID(conversation_id_value)
                    except (ValueError, AttributeError):
                        conversation_id = None
                    conversation = (
                        CONVERSATION_REPOSITORY.get_owned(conversation_id, owner_user_id)
                        if conversation_id is not None
                        else None
                    )
                    if conversation is None:
                        self.send_error(404, "Conversation not found")
                        return
                conversation_id = conversation.conversation_id
                stored_messages = MESSAGE_REPOSITORY.recent_owned(
                    conversation_id,
                    owner_user_id,
                    MAX_RECENT_MESSAGES,
                )
                if stored_messages is None:
                    self.send_error(404, "Conversation not found")
                    return
                recent_messages = [
                    {"role": stored.role, "content": stored.content}
                    for stored in stored_messages
                ]
                if not created_for_message:
                    can_append = MESSAGE_REPOSITORY.can_append_owned(
                        conversation_id,
                        owner_user_id,
                        message,
                    )
                    if can_append is None:
                        self.send_error(404, "Conversation not found")
                        return
                    if not can_append:
                        self.send_error(429, "Conversation storage limit reached")
                        return
                retrieved_memories = MEMORY_REPOSITORY.retrieve_owned(owner_user_id, message)
                context = ChatContext(
                    language=language,
                    memory=[record.content for record in retrieved_memories],
                )
                _log_memory_operation(
                    owner_user_id,
                    "retrieval",
                    retrieved_count=len(context.memory),
                )
            elif conversation_id_value is not None:
                self.send_error(404, "Conversation not found")
                return
            service = ChatService(external_authorization=EXTERNAL_AUTHORIZATION)
            service_options = {}
            if isinstance(recent_messages, list) and recent_messages:
                service_options["recent_messages"] = recent_messages
            if "provider" in payload:
                service_options["selected_provider"] = payload.get("provider")
            if "orchestration_mode" in payload:
                service_options["orchestration_mode"] = orchestration_mode
            response = service.respond(message, context=context, **service_options)
            if conversation_id is not None:
                owner_user_id = request_context.principal.user_id
                if owner_user_id is None:
                    self.send_error(401, "A valid server-side session is required")
                    return
                response_message = response.get("message")
                if isinstance(response_message, str) and response_message.strip():
                    try:
                        persisted = MESSAGE_REPOSITORY.append_owned(
                            conversation_id,
                            owner_user_id,
                            (
                                ("user", message),
                                ("assistant", response_message),
                            ),
                        )
                    except ConversationLimitExceeded:
                        self.send_error(413, "Conversation response exceeds the storage limit")
                        return
                    if persisted is None:
                        self.send_error(404, "Conversation not found")
                        return
                response["conversation_id"] = str(conversation_id)
            self._send_json(200, response)
            return

        if parsed.path == "/api/phone":
            if self.request_context.principal.authenticated:
                self.send_error(403, "Phone awareness is available only in anonymous local-demo mode")
                return
            # This endpoint processes simulated events only; it never accesses device APIs.
            module = PHONE_AWARENESS
            action_value = payload.get("action", "status")
            if not isinstance(action_value, str):
                self.send_error(400, "Phone action must be a string")
                return
            action = action_value.lower()

            if action == "toggle_permission":
                enabled = payload.get("enabled", True)
                if not isinstance(enabled, bool):
                    self.send_error(400, "Permission state must be a boolean")
                    return
                if enabled:
                    module.grant_permission("phone_awareness")
                else:
                    module.revoke_permission("phone_awareness")
                self._send_json(200, {
                    "success": True,
                    "enabled": module.has_permission("phone_awareness"),
                    "status": module.get_status(),
                    "message": "Phone awareness permission was updated.",
                })
                return

            if action == "simulate_event":
                event = payload.get("event") or {"event_type": "battery_low", "source": "simulated"}
                if not isinstance(event, (dict, str)):
                    self.send_error(400, "Phone event must be an object or string")
                    return
                if isinstance(event, dict):
                    for field in ("event_type", "source"):
                        if field in event and not isinstance(event[field], str):
                            self.send_error(400, f"Phone event {field} must be a string")
                            return
                    for field in ("permission_required", "permission_granted"):
                        if field in event and not isinstance(event[field], bool):
                            self.send_error(400, f"Phone event {field} must be a boolean")
                            return
                    for field in ("requested_data", "data_collected"):
                        if field in event and (
                            not isinstance(event[field], list)
                            or any(not isinstance(item, str) for item in event[field])
                        ):
                            self.send_error(400, f"Phone event {field} must be an array of strings")
                            return
                result = module.process_event(event)
                self._send_json(200, {
                    "success": True,
                    "status": result.get("status", "SAFE_TO_CONTINUE"),
                    "result": result,
                    "message": result.get("explanation", "Phone awareness simulation completed."),
                })
                return

            self._send_json(200, module.get_status())
            return

        self.send_error(404, "Not found")

    def _serve_file(self, file_path: Path) -> None:
        try:
            content = file_path.read_bytes()
        except FileNotFoundError:
            self.send_error(404, "Not found")
            return

        mime_type = "text/html"
        if file_path.suffix == ".css":
            mime_type = "text/css"
        elif file_path.suffix == ".js":
            mime_type = "application/javascript"
        elif file_path.suffix == ".json":
            mime_type = "application/json"

        self.send_response(200)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _send_json(self, status_code: int, payload: dict) -> None:
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


def main() -> None:
    host = os.environ.get("PARMAR_UI_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = 8080
    server = ThreadingHTTPServer((host, port), PARMARRequestHandler)
    print(f"PARMAR UI is running at http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
