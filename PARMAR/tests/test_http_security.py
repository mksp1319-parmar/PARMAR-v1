import io
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from PARMAR.chat.context import ChatContext
from PARMAR.interface import futuristic_app
from PARMAR.identity import HTTPRequestContext, LocalDemoPrincipalResolver, Principal
from PARMAR.sessions import (
    InMemorySessionRepository,
    SESSION_COOKIE_NAME,
    SessionManager,
    SessionPolicy,
)


def make_request(path, *, body=b"", content_length=None, headers=None):
    errors = []
    served = []
    request_headers = {
        "Content-Length": str(len(body) if content_length is None else content_length),
    }
    request_headers.update(headers or {})
    request = SimpleNamespace(
        path=path,
        headers=request_headers,
        rfile=io.BytesIO(body),
        send_error=lambda status, message: errors.append((status, message)),
        _serve_file=lambda target: served.append(target),
        _send_json=lambda status, payload: None,
    )
    request._serve_static_file = lambda relative_path: futuristic_app.PARMARRequestHandler._serve_static_file(
        request, relative_path
    )
    return request, errors, served


def test_principal_contract_distinguishes_anonymous_and_authenticated_identity():
    anonymous = Principal.anonymous_local_demo()
    authenticated_id = uuid4()
    authenticated = Principal.authenticated_user(authenticated_id, "test-identity-source")

    assert anonymous.authenticated is False
    assert anonymous.user_id is None
    assert anonymous.authentication_source == "local-demo"
    assert authenticated.authenticated is True
    assert authenticated.user_id == authenticated_id
    assert authenticated.authentication_source == "test-identity-source"
    assert set(Principal.__dataclass_fields__) == {
        "authenticated", "user_id", "authentication_source",
    }


def test_chat_context_is_not_an_identity_or_authorization_authority():
    context = ChatContext()

    assert not hasattr(context, "user_id")
    assert not hasattr(context, "principal")
    assert not hasattr(context, "permissions")
    assert not hasattr(context, "approval_decision")


def test_local_demo_resolver_ignores_client_identity_values():
    request = SimpleNamespace(
        path="/api/chat?user_id=attacker",
        headers={"X-User-ID": "attacker", "Cookie": "parmar_session=attacker"},
        payload={"user_id": "attacker"},
    )

    principal = LocalDemoPrincipalResolver().resolve(request)

    assert principal == Principal.anonymous_local_demo()


@pytest.mark.parametrize("identity_field", [
    "user_id",
    "owner_id",
    "session_id",
    "principal_id",
])
def test_post_rejects_client_identity_fields_before_resolution(identity_field, monkeypatch):
    body = json.dumps({"message": "hello", identity_field: "attacker"}).encode("utf-8")
    request, errors, _ = make_request(
        "/api/chat",
        body=body,
        headers={"Cookie": "parmar_session=forged-client-value"},
    )

    class UnexpectedResolver:
        def resolve(self, _request):
            pytest.fail("Identity-bearing client input reached principal resolution")

    monkeypatch.setattr(futuristic_app, "PRINCIPAL_RESOLVER", UnexpectedResolver())
    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert errors == [(400, "Client-supplied identity is not accepted")]


@pytest.mark.parametrize("header_name", [
    "X-User-ID",
    "X-Owner-ID",
    "X-Session-ID",
    "X-Principal-ID",
    "X-Authenticated-User",
    "Authorization",
])
def test_post_rejects_client_identity_headers_before_resolution(header_name, monkeypatch):
    body = json.dumps({"message": "hello"}).encode("utf-8")
    request, errors, _ = make_request(
        "/api/chat",
        body=body,
        headers={header_name: "attacker"},
    )

    class UnexpectedResolver:
        def resolve(self, _request):
            pytest.fail("Identity-bearing client header reached principal resolution")

    monkeypatch.setattr(futuristic_app, "PRINCIPAL_RESOLVER", UnexpectedResolver())
    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert errors == [(400, "Client-supplied identity is not accepted")]


@pytest.mark.parametrize("query", [
    "user_id=attacker",
    "owner_id=attacker",
    "session_id=attacker",
])
def test_get_rejects_identity_query_parameters_before_resolution(query, monkeypatch):
    request, errors, _ = make_request(f"/api/providers?{query}")

    class UnexpectedResolver:
        def resolve(self, _request):
            pytest.fail("Identity-bearing query parameter reached principal resolution")

    monkeypatch.setattr(futuristic_app, "PRINCIPAL_RESOLVER", UnexpectedResolver())
    futuristic_app.PARMARRequestHandler.do_GET(request)

    assert errors == [(400, "Client-supplied identity is not accepted")]


def test_nested_identity_fields_are_rejected_but_non_authority_metadata_is_allowed(monkeypatch):
    nested = json.dumps({"message": "hello", "context": {"user_id": "attacker"}}).encode("utf-8")
    request, errors, _ = make_request("/api/chat", body=nested)
    futuristic_app.PARMARRequestHandler.do_POST(request)
    assert errors == [(400, "Client-supplied identity is not accepted")]

    body = json.dumps({"message": "hello", "client_version": "demo-1"}).encode("utf-8")
    request, errors, _ = make_request("/api/chat", body=body)

    class CapturingChatService:
        def __init__(self, external_authorization=None):
            pass

        def respond(self, prompt, context=None, **_options):
            return {"message": prompt}

    monkeypatch.setattr(futuristic_app, "ChatService", CapturingChatService)
    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert errors == []


def test_authenticated_principal_is_server_resolved_and_not_passed_to_chat(monkeypatch):
    manager = SessionManager(
        InMemorySessionRepository(),
        SessionPolicy(idle_timeout_seconds=60, absolute_timeout_seconds=300),
    )
    credentials = manager.create_authenticated_session(uuid4(), "test-identity-source")
    body = json.dumps({"message": "hello"}).encode("utf-8")
    csrf_token = manager.csrf_token(credentials.session.session_id)
    request, errors, _ = make_request(
        "/api/chat",
        body=body,
        headers={
            "Cookie": f"{SESSION_COOKIE_NAME}={credentials.session_token}",
            "X-CSRF-Token": csrf_token,
        },
    )
    calls = []

    class CapturingChatService:
        def __init__(self, external_authorization=None):
            pass

        def respond(self, prompt, context=None, **options):
            calls.append((prompt, context, options))
            return {"message": "model output cannot establish identity"}

    response = {}
    request._send_json = lambda status, result: response.update(status=status, result=result)
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", manager)
    monkeypatch.setattr(futuristic_app, "PRINCIPAL_RESOLVER", LocalDemoPrincipalResolver())
    monkeypatch.setattr(futuristic_app, "ChatService", CapturingChatService)

    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert errors == []
    assert request.request_context == HTTPRequestContext(
        Principal.authenticated_user(credentials.session.user_id, "test-identity-source"),
        credentials.session.session_id,
    )
    assert calls[0][0] == "hello"
    assert isinstance(calls[0][1], ChatContext)
    assert calls[0][1].memory == []
    assert calls[0][2] == {}
    assert "user_id" not in response["result"]


def test_local_demo_chat_remains_anonymous_and_functional(monkeypatch, tmp_path):
    from PARMAR.audit.decision_logs import DecisionLogManager

    monkeypatch.setenv("PARMAR_CHAT_PROVIDER", "local-demo")
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", None)
    original_init = DecisionLogManager.__init__

    def isolated_init(self, log_path=None):
        original_init(self, log_path or str(tmp_path / "principal-audit.jsonl"))

    monkeypatch.setattr(DecisionLogManager, "__init__", isolated_init)
    body = json.dumps({"message": "Plan a team lunch."}).encode("utf-8")
    request, errors, _ = make_request("/api/chat", body=body)
    response = {}
    request._send_json = lambda status, result: response.update(status=status, result=result)

    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert errors == []
    assert request.request_context.principal == Principal.anonymous_local_demo()
    assert response["status"] == 200
    assert response["result"]["provider"] == "local-demo"


def test_static_request_rejects_parent_traversal():
    request, errors, served = make_request("/static/%2e%2e/README.md")

    futuristic_app.PARMARRequestHandler.do_GET(request)

    assert errors == [(404, "Not found")]
    assert served == []


def test_static_request_rejects_symlink_escape(tmp_path, monkeypatch):
    static_root = tmp_path / "static"
    static_root.mkdir()
    outside_file = tmp_path / "private.txt"
    outside_file.write_text("private", encoding="utf-8")
    (static_root / "outside.txt").symlink_to(outside_file)
    monkeypatch.setattr(futuristic_app, "STATIC_DIR", static_root)
    request, errors, served = make_request("/static/outside.txt")

    futuristic_app.PARMARRequestHandler.do_GET(request)

    assert errors == [(404, "Not found")]
    assert served == []


def test_root_index_rejects_symlink_escape(tmp_path, monkeypatch):
    static_root = tmp_path / "static"
    static_root.mkdir()
    outside_file = tmp_path / "private.html"
    outside_file.write_text("private", encoding="utf-8")
    (static_root / "index.html").symlink_to(outside_file)
    monkeypatch.setattr(futuristic_app, "STATIC_DIR", static_root)
    request, errors, served = make_request("/")

    futuristic_app.PARMARRequestHandler.do_GET(request)

    assert errors == [(404, "Not found")]
    assert served == []


@pytest.mark.parametrize(
    ("body", "content_length", "expected_status"),
    [
        (b"{invalid", None, 400),
        (b"[]", None, 400),
        (b"{}", "not-a-number", 400),
        (b"", -1, 400),
        (b"", futuristic_app.MAX_POST_BODY_BYTES + 1, 413),
    ],
)
def test_post_rejects_invalid_or_oversized_json(body, content_length, expected_status):
    request, errors, _ = make_request(
        "/api/chat",
        body=body,
        content_length=content_length,
    )

    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert errors
    assert errors[0][0] == expected_status


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        ("/api/chat", {"message": ["not", "text"]}),
        ("/api/chat", {"context": []}),
        ("/api/phone", {"action": "simulate_event", "event": 7}),
        ("/api/phone", {"action": "toggle_permission", "enabled": "false"}),
    ],
)
def test_post_rejects_malformed_endpoint_field_types(path, payload):
    body = json.dumps(payload).encode("utf-8")
    request, errors, _ = make_request(path, body=body)

    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert errors
    assert errors[0][0] == 400


@pytest.mark.parametrize(("environment", "expected_host"), [(None, "127.0.0.1"), ("0.0.0.0", "0.0.0.0")])
def test_server_host_defaults_to_loopback_and_allows_explicit_override(monkeypatch, environment, expected_host):
    captured = {}

    class FakeServer:
        def __init__(self, address, handler):
            captured["address"] = address

        def serve_forever(self):
            raise KeyboardInterrupt

        def server_close(self):
            captured["closed"] = True

    if environment is None:
        monkeypatch.delenv("PARMAR_UI_HOST", raising=False)
    else:
        monkeypatch.setenv("PARMAR_UI_HOST", environment)
    monkeypatch.setattr(futuristic_app, "ThreadingHTTPServer", FakeServer)

    futuristic_app.main()

    assert captured["address"] == (expected_host, 8000)
    assert captured["closed"] is True
