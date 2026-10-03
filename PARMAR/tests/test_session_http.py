import io
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from PARMAR.identity import LocalDemoPrincipalResolver
from PARMAR.interface import futuristic_app
from PARMAR.sessions import (
    InMemorySessionRepository,
    SESSION_COOKIE_NAME,
    SessionManager,
    SessionPolicy,
)


@pytest.fixture
def authenticated_session(monkeypatch):
    manager = SessionManager(
        InMemorySessionRepository(),
        SessionPolicy(idle_timeout_seconds=300, absolute_timeout_seconds=900),
    )
    credentials = manager.create_authenticated_session(uuid4(), "http-test")
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", manager)
    monkeypatch.setattr(futuristic_app, "PRINCIPAL_RESOLVER", LocalDemoPrincipalResolver())
    monkeypatch.setattr(futuristic_app, "PENDING_APPROVALS", futuristic_app.PendingApprovalStore())
    return manager, credentials


def make_request(path, *, body=None, credentials=None, csrf=True):
    response = {}
    errors = []
    body_bytes = json.dumps(body if body is not None else {}).encode("utf-8")
    headers = {"Content-Length": str(len(body_bytes))}
    if credentials is not None:
        headers["Cookie"] = f"{SESSION_COOKIE_NAME}={credentials.session_token}"
        manager = futuristic_app.SESSION_MANAGER
        csrf_token = manager.csrf_token(credentials.session.session_id) if manager else None
        if csrf and csrf_token:
            headers["X-CSRF-Token"] = csrf_token
    request = SimpleNamespace(
        path=path,
        headers=headers,
        rfile=io.BytesIO(body_bytes),
        send_error=lambda status, message: errors.append((status, message)),
        _send_json=lambda status, result: response.update(status=status, result=result),
        _send_json_with_headers=lambda status, result, extra_headers: response.update(
            status=status,
            result=result,
            headers=extra_headers,
        ),
    )
    return request, response, errors


@pytest.mark.parametrize("csrf", [False, "invalid"])
def test_authenticated_post_rejects_missing_or_invalid_csrf(csrf, monkeypatch, authenticated_session):
    _manager, credentials = authenticated_session
    request, _response, errors = make_request(
        "/api/chat",
        body={"message": "hello"},
        credentials=credentials,
        csrf=bool(csrf) if isinstance(csrf, bool) else False,
    )
    if csrf == "invalid":
        request.headers["X-CSRF-Token"] = "invalid-token"

    class UnexpectedChatService:
        def __init__(self, external_authorization=None):
            pass

        def respond(self, *_args, **_kwargs):
            pytest.fail("Request reached chat logic without valid CSRF")

    monkeypatch.setattr(futuristic_app, "ChatService", UnexpectedChatService)
    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert errors == [(403, "CSRF validation failed")]


def test_authenticated_post_with_valid_csrf_reaches_chat(monkeypatch, authenticated_session):
    _manager, credentials = authenticated_session
    request, response, errors = make_request(
        "/api/chat",
        body={"message": "hello"},
        credentials=credentials,
    )

    class CapturingChatService:
        def __init__(self, external_authorization=None):
            pass

        def respond(self, prompt, context=None, **_options):
            return {"message": prompt}

    monkeypatch.setattr(futuristic_app, "ChatService", CapturingChatService)
    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert errors == []
    assert response["status"] == 200
    assert response["result"]["message"] == "hello"
    assert response["result"]["conversation_id"]


def test_authenticated_get_needs_no_csrf_and_session_endpoint_never_returns_cookie_token(authenticated_session):
    _manager, credentials = authenticated_session
    request, response, errors = make_request(
        "/api/session",
        credentials=credentials,
        csrf=False,
    )

    futuristic_app.PARMARRequestHandler.do_GET(request)

    assert errors == []
    assert response["status"] == 200
    assert response["result"]["authenticated"] is True
    assert response["result"]["csrf_token"]
    assert credentials.session_token not in json.dumps(response["result"])


def test_trusted_session_issuance_sets_cookie_without_returning_session_token(
    authenticated_session,
):
    _manager, existing = authenticated_session
    response = {}
    errors = []
    request = SimpleNamespace(
        send_error=lambda status, message: errors.append((status, message)),
        _send_json_with_headers=lambda status, result, headers: response.update(
            status=status,
            result=result,
            headers=headers,
        ),
    )

    issued = futuristic_app._issue_authenticated_session_response(
        request,
        uuid4(),
        "trusted-test-auth",
    )

    assert errors == []
    assert issued is not None
    assert response["status"] == 201
    assert issued.session_token in response["headers"]["Set-Cookie"]
    assert "Secure" in response["headers"]["Set-Cookie"]
    assert "HttpOnly" in response["headers"]["Set-Cookie"]
    assert issued.session_token not in json.dumps(response["result"])
    assert existing.session_token not in json.dumps(response["result"])


def test_trusted_rotation_replaces_cookie_and_invalidates_old_token(authenticated_session):
    manager, existing = authenticated_session
    response = {}
    errors = []
    request = SimpleNamespace(
        headers={"Cookie": f"{SESSION_COOKIE_NAME}={existing.session_token}"},
        send_error=lambda status, message: errors.append((status, message)),
        _send_json_with_headers=lambda status, result, headers: response.update(
            status=status,
            result=result,
            headers=headers,
        ),
    )

    rotated = futuristic_app._rotate_authenticated_session_response(request)

    assert errors == []
    assert rotated is not None
    assert rotated.session_token != existing.session_token
    assert rotated.session_token in response["headers"]["Set-Cookie"]
    assert rotated.session_token not in json.dumps(response["result"])
    assert manager.resolve(existing.session_token) is None
    assert manager.resolve(rotated.session_token) is not None


def test_authenticated_readiness_get_does_not_require_csrf(authenticated_session):
    _manager, credentials = authenticated_session
    request, response, errors = make_request(
        "/api/providers",
        credentials=credentials,
        csrf=False,
    )

    futuristic_app.PARMARRequestHandler.do_GET(request)

    assert errors == []
    assert response["status"] == 200
    assert request.request_context.principal.authenticated is True


def test_expired_session_cookie_resolves_to_anonymous(monkeypatch):
    manager = SessionManager(
        InMemorySessionRepository(),
        SessionPolicy(idle_timeout_seconds=1, absolute_timeout_seconds=5),
    )
    created_at = datetime.now(timezone.utc) - timedelta(seconds=10)
    credentials = manager.create_authenticated_session(
        uuid4(),
        "http-test",
        now=created_at,
    )
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", manager)
    monkeypatch.setattr(futuristic_app, "PRINCIPAL_RESOLVER", LocalDemoPrincipalResolver())
    request, response, errors = make_request(
        "/api/session",
        credentials=credentials,
        csrf=False,
    )

    futuristic_app.PARMARRequestHandler.do_GET(request)

    assert errors == []
    assert response["result"] == {"authenticated": False}
    assert request.request_context.principal.authenticated is False


def test_authenticated_logout_requires_csrf_then_revokes_and_clears_cookie(
    authenticated_session,
):
    manager, credentials = authenticated_session
    missing_request, _missing_response, missing_errors = make_request(
        "/api/logout",
        credentials=credentials,
        csrf=False,
    )
    futuristic_app.PARMARRequestHandler.do_POST(missing_request)
    assert missing_errors == [(403, "CSRF validation failed")]
    assert manager.resolve(credentials.session_token) is not None

    request, response, errors = make_request("/api/logout", credentials=credentials)
    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert errors == []
    assert response["status"] == 200
    assert response["result"] == {"logged_out": True, "authenticated": False}
    assert "Set-Cookie" in response["headers"]
    assert "Max-Age=0" in response["headers"]["Set-Cookie"]
    assert manager.resolve(credentials.session_token) is None


def test_forged_cookie_and_anonymous_post_remain_local_demo(authenticated_session, monkeypatch):
    manager, _credentials = authenticated_session
    request, response, errors = make_request(
        "/api/chat",
        body={"message": "hello"},
        credentials=None,
    )
    request.headers["Cookie"] = f"{SESSION_COOKIE_NAME}=forged-token-value"

    class CapturingChatService:
        def __init__(self, external_authorization=None):
            pass

        def respond(self, prompt, context=None, **_options):
            return {"message": prompt}

    monkeypatch.setattr(futuristic_app, "ChatService", CapturingChatService)
    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert errors == []
    assert request.request_context.principal.authenticated is False
    assert request.request_context.principal.authentication_source == "local-demo"
    assert response["status"] == 200


def test_anonymous_approval_request_is_rejected_even_with_valid_token(
    authenticated_session,
):
    _manager, credentials = authenticated_session
    create_request, created, create_errors = make_request(
        "/api/analyze",
        body={"request": "Purchase a $500 software license"},
        credentials=credentials,
    )
    futuristic_app.PARMARRequestHandler.do_POST(create_request)
    assert create_errors == []
    approval_id = created["result"].get("approval_id")
    assert approval_id

    request, response, errors = make_request(
        "/api/approval",
        body={"approval_id": approval_id, "decision": "APPROVE"},
    )
    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert errors == []
    assert response["status"] == 403
    assert response["result"]["status"] == "APPROVAL_INVALID"