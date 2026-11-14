import ast
import io
import json
import runpy
import shutil
import socket
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from PARMAR.chat.context import ChatContext
from PARMAR.identity_store import SQLiteIdentityRepository
from PARMAR.interface import futuristic_app
from PARMAR.identity import HTTPRequestContext, LocalDemoPrincipalResolver, Principal
from PARMAR.sessions import (
    InMemorySessionRepository,
    SESSION_COOKIE_NAME,
    SessionManager,
    SessionPolicy,
)


@pytest.fixture(scope="module")
def tls_keypairs(tmp_path_factory):
    openssl = shutil.which("openssl")
    if openssl is None:
        pytest.skip("OpenSSL is required to create isolated TLS test certificates.")

    directory = tmp_path_factory.mktemp("startup-tls")
    keypairs = {}
    for name in ("first", "second"):
        certificate = directory / f"{name}.crt"
        private_key = directory / f"{name}.key"
        subprocess.run(
            [
                openssl,
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-keyout",
                str(private_key),
                "-out",
                str(certificate),
                "-days",
                "1",
                "-subj",
                "/CN=127.0.0.1",
                "-addext",
                "subjectAltName=IP:127.0.0.1",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        keypairs[name] = (certificate, private_key)
    return keypairs


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


def test_json_responses_are_not_cacheable():
    response = {"headers": {}}
    request = SimpleNamespace(
        send_response=lambda _status: None,
        send_header=lambda name, value: response["headers"].update({name: value}),
        end_headers=lambda: None,
        wfile=io.BytesIO(),
    )

    futuristic_app.PARMARRequestHandler._send_json(request, 200, {"message": "private response"})

    assert response["headers"]["Cache-Control"] == "no-store"


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
    "account",
    "account_id",
    "accountId",
    "parmar_account_id",
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
    "X-Account",
    "X-Account-ID",
    "X-Parmar-Account-ID",
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
    "account_id=attacker",
    "parmar_account_id=attacker",
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


def test_authenticated_principal_is_server_resolved_and_not_passed_to_chat(monkeypatch, tmp_path):
    manager = SessionManager(
        InMemorySessionRepository(),
        SessionPolicy(idle_timeout_seconds=60, absolute_timeout_seconds=300),
    )
    credentials = manager.create_authenticated_session(uuid4(), "test-identity-source")
    identity_repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    profile = identity_repository.create_profile(credentials.session.user_id, "Security test")
    active_profile_id = profile.profile_id
    selected_session = manager.select_profile(
        credentials.session.session_id,
        credentials.session.user_id,
        active_profile_id,
    )
    assert selected_session is not None
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
    monkeypatch.setattr(futuristic_app, "IDENTITY_REPOSITORY", identity_repository)
    monkeypatch.setattr(futuristic_app, "PRINCIPAL_RESOLVER", LocalDemoPrincipalResolver())
    monkeypatch.setattr(futuristic_app, "ChatService", CapturingChatService)

    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert errors == []
    assert request.request_context == HTTPRequestContext(
        Principal.authenticated_user(credentials.session.user_id, "test-identity-source"),
        credentials.session.session_id,
        active_profile_id,
    )
    assert calls[0][0] == "hello"
    assert isinstance(calls[0][1], ChatContext)
    assert calls[0][1].memory == []
    assert set(calls[0][2]) == {"memory_retriever"}
    assert callable(calls[0][2]["memory_retriever"])
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


def test_static_png_is_served_with_image_content_type(tmp_path):
    image_content = b"\x89PNG\r\n\x1a\n"
    image_path = tmp_path / "avatar.png"
    image_path.write_bytes(image_content)
    response = {"headers": {}, "statuses": []}
    request = SimpleNamespace(
        send_response=lambda status: response["statuses"].append(status),
        send_header=lambda name, value: response["headers"].update({name: value}),
        end_headers=lambda: None,
        wfile=io.BytesIO(),
    )

    futuristic_app.PARMARRequestHandler._serve_file(request, image_path)

    assert response["statuses"] == [200]
    assert response["headers"]["Content-Type"] == "image/png"
    assert request.wfile.getvalue() == image_content


def test_static_svg_is_served_with_image_content_type(tmp_path):
    image_content = b"<svg xmlns='http://www.w3.org/2000/svg'></svg>"
    image_path = tmp_path / "reference.svg"
    image_path.write_bytes(image_content)
    response = {"headers": {}, "statuses": []}
    request = SimpleNamespace(
        send_response=lambda status: response["statuses"].append(status),
        send_header=lambda name, value: response["headers"].update({name: value}),
        end_headers=lambda: None,
        wfile=io.BytesIO(),
    )

    futuristic_app.PARMARRequestHandler._serve_file(request, image_path)

    assert response["statuses"] == [200]
    assert response["headers"]["Content-Type"] == "image/svg+xml"
    assert request.wfile.getvalue() == image_content


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


def test_post_rejects_unsupported_transfer_encoding_before_routing():
    request, errors, _ = make_request(
        "/api/logout",
        body=b"0\r\n\r\n",
        content_length=0,
        headers={"Transfer-Encoding": "chunked"},
    )
    response = {}
    request._send_json = lambda status, payload: response.update(status=status, payload=payload)
    request._send_json_with_headers = lambda status, payload, headers: response.update(
        status=status,
        payload=payload,
        headers=headers,
    )

    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert errors == [(400, "Transfer-Encoding is not supported")]
    assert response == {}


def test_post_rejects_duplicate_content_length_before_routing():
    request, errors, _ = make_request("/api/logout", body=b"", content_length=0)

    class DuplicateContentLengthHeaders(dict):
        def get_all(self, name, default=None):
            if name.casefold() == "content-length":
                return ["0", "1"]
            value = self.get(name)
            return [value] if value is not None else default

    request.headers = DuplicateContentLengthHeaders(request.headers)
    response = {}
    request._send_json = lambda status, payload: response.update(status=status, payload=payload)
    request._send_json_with_headers = lambda status, payload, headers: response.update(
        status=status,
        payload=payload,
        headers=headers,
    )

    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert errors == [(400, "Invalid Content-Length")]


@pytest.mark.parametrize(
    ("headers", "expected_status"),
    [
        (
            {
                "Origin": "https://parmar.example",
                "Sec-Fetch-Site": "same-origin",
            },
            404,
        ),
        ({"Origin": "https://attacker.example"}, 403),
        ({"Origin": "null"}, 403),
        ({"Sec-Fetch-Site": "cross-site"}, 403),
        ({"Sec-Fetch-Site": "same-site"}, 403),
        ({"Sec-Fetch-Site": "none"}, 403),
        ({}, 404),
    ],
)
def test_unsafe_request_origin_and_fetch_metadata_policy(
    monkeypatch,
    headers,
    expected_status,
):
    monkeypatch.setenv("PARMAR_UI_ORIGIN", "https://parmar.example")
    request, errors, _ = make_request(
        "/api/not-a-route",
        body=b"{}",
        headers=headers,
    )

    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert errors
    assert errors[0][0] == expected_status


def test_unsafe_request_rejects_duplicate_origin_headers(monkeypatch):
    monkeypatch.setenv("PARMAR_UI_ORIGIN", "https://parmar.example")
    request, errors, _ = make_request(
        "/api/chat",
        body=b"{}",
        headers={
            "Origin": "https://parmar.example",
            "Sec-Fetch-Site": "same-origin",
        },
    )

    class DuplicateOriginHeaders(dict):
        def get_all(self, name, default=None):
            if name.lower() == "origin":
                return ["https://parmar.example", "https://parmar.example"]
            value = self.get(name)
            return [value] if value is not None else default

    request.headers = DuplicateOriginHeaders(request.headers)
    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert errors == [(403, "Unsafe request origin is not allowed")]


def test_unsafe_request_rejects_browser_metadata_without_canonical_origin(monkeypatch):
    monkeypatch.delenv("PARMAR_UI_ORIGIN", raising=False)
    monkeypatch.setenv("PARMAR_UI_HOST", "0.0.0.0")
    request, errors, _ = make_request(
        "/api/chat",
        body=b"{}",
        headers={"Sec-Fetch-Site": "same-origin"},
    )

    futuristic_app.PARMARRequestHandler.do_POST(request)
    assert errors == [(403, "Unsafe request origin is not allowed")]


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


@pytest.mark.parametrize(
    ("host", "expected_host", "environment"),
    [
        (None, "127.0.0.1", None),
        ("", "127.0.0.1", "development"),
        ("localhost", "localhost", "development"),
        ("127.0.0.1", "127.0.0.1", "development"),
        ("::1", "::1", "development"),
    ],
)
def test_server_starts_with_loopback_bind(monkeypatch, host, expected_host, environment):
    captured = {}
    configured_ipv6_family = futuristic_app._IPv6ThreadingHTTPServer.address_family

    class FakeServer:
        def __init__(self, address, handler):
            captured["address"] = address
            captured["server"] = self

        def serve_forever(self):
            raise KeyboardInterrupt

        def server_close(self):
            captured["closed"] = True

    class FakeIPv6Server(FakeServer):
        pass

    if host is None:
        monkeypatch.delenv("PARMAR_UI_HOST", raising=False)
    else:
        monkeypatch.setenv("PARMAR_UI_HOST", host)
    if environment is None:
        monkeypatch.delenv("PARMAR_ENVIRONMENT", raising=False)
    else:
        monkeypatch.setenv("PARMAR_ENVIRONMENT", environment)
    for key in (
        "PARMAR_DEVELOPMENT_AUTH_ENABLED",
        "PARMAR_UI_TLS_CERTFILE",
        "PARMAR_UI_TLS_KEYFILE",
        "PARMAR_UI_ORIGIN",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(futuristic_app, "ThreadingHTTPServer", FakeServer)
    monkeypatch.setattr(futuristic_app, "_IPv6ThreadingHTTPServer", FakeIPv6Server)

    futuristic_app.main()

    assert captured["address"] == (expected_host, futuristic_app.UI_PORT)
    assert captured["closed"] is True
    assert isinstance(captured["server"], FakeIPv6Server) is (host == "::1")
    if host == "::1":
        assert configured_ipv6_family == socket.AF_INET6


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "192.168.1.10", "parmar.example"])
def test_external_listener_is_rejected_before_server_bind(monkeypatch, host):
    monkeypatch.setenv("PARMAR_UI_HOST", host)
    monkeypatch.delenv("PARMAR_UI_ORIGIN", raising=False)
    monkeypatch.delenv("PARMAR_ENVIRONMENT", raising=False)
    monkeypatch.delenv("PARMAR_DEVELOPMENT_AUTH_ENABLED", raising=False)

    class UnexpectedServer:
        def __init__(self, *_args):
            pytest.fail("The server must not bind to an externally reachable address.")

    monkeypatch.setattr(futuristic_app, "ThreadingHTTPServer", UnexpectedServer)
    monkeypatch.setattr(futuristic_app, "_IPv6ThreadingHTTPServer", UnexpectedServer)
    with pytest.raises(ValueError, match="require a valid TLS certificate"):
        futuristic_app.main()


@pytest.mark.parametrize(
    "host",
    [
        "0.0.0.0",
        "192.168.1.10",
        "203.0.113.10",
        "::",
        "2001:4860:4860::8888",
        "parmar.example",
        "bad host",
    ],
)
def test_external_listener_with_tls_is_still_rejected_without_verified_auth(
    monkeypatch,
    host,
    tls_keypairs,
):
    certificate, private_key = tls_keypairs["first"]
    monkeypatch.setenv("PARMAR_UI_HOST", host)
    monkeypatch.setenv("PARMAR_UI_TLS_CERTFILE", str(certificate))
    monkeypatch.setenv("PARMAR_UI_TLS_KEYFILE", str(private_key))
    monkeypatch.delenv("PARMAR_UI_ORIGIN", raising=False)
    monkeypatch.delenv("PARMAR_ENVIRONMENT", raising=False)
    monkeypatch.delenv("PARMAR_DEVELOPMENT_AUTH_ENABLED", raising=False)

    class UnexpectedServer:
        def __init__(self, *_args):
            pytest.fail("TLS alone must not permit an externally reachable listener.")

    monkeypatch.setattr(futuristic_app, "ThreadingHTTPServer", UnexpectedServer)
    monkeypatch.setattr(futuristic_app, "_IPv6ThreadingHTTPServer", UnexpectedServer)
    with pytest.raises(ValueError, match="independently verified"):
        futuristic_app.main()


def test_external_origin_is_rejected_even_with_a_loopback_listener(monkeypatch):
    monkeypatch.setenv("PARMAR_UI_HOST", "127.0.0.1")
    monkeypatch.setenv("PARMAR_UI_ORIGIN", "https://parmar.example")

    class UnexpectedServer:
        def __init__(self, *_args):
            pytest.fail("A public origin must not enable an externally reachable proxy configuration.")

    monkeypatch.setattr(futuristic_app, "ThreadingHTTPServer", UnexpectedServer)
    monkeypatch.setattr(futuristic_app, "_IPv6ThreadingHTTPServer", UnexpectedServer)
    with pytest.raises(ValueError, match="Externally reachable PARMAR_UI_ORIGIN"):
        futuristic_app.main()


@pytest.mark.parametrize(
    "origin",
    [
        "http://127.0.0.1:8081",
        "https://127.0.0.1:8080",
    ],
)
def test_conflicting_local_origin_fails_before_server_bind(monkeypatch, origin):
    monkeypatch.setenv("PARMAR_UI_HOST", "127.0.0.1")
    monkeypatch.setenv("PARMAR_UI_ORIGIN", origin)

    class UnexpectedServer:
        def __init__(self, *_args):
            pytest.fail("A conflicting origin must not allow the listener to start.")

    monkeypatch.setattr(futuristic_app, "ThreadingHTTPServer", UnexpectedServer)
    with pytest.raises(ValueError, match="must match the configured listener"):
        futuristic_app.main()


def test_production_startup_fails_closed_with_explicit_message(monkeypatch, tls_keypairs):
    certificate, private_key = tls_keypairs["first"]
    monkeypatch.setenv("PARMAR_ENVIRONMENT", "Production")
    monkeypatch.setenv("PARMAR_UI_HOST", "127.0.0.1")
    monkeypatch.setenv("PARMAR_UI_TLS_CERTFILE", str(certificate))
    monkeypatch.setenv("PARMAR_UI_TLS_KEYFILE", str(private_key))
    monkeypatch.delenv("PARMAR_UI_ORIGIN", raising=False)
    monkeypatch.delenv("PARMAR_DEVELOPMENT_AUTH_ENABLED", raising=False)

    class UnexpectedServer:
        def __init__(self, *_args):
            pytest.fail("Production startup must be refused before binding.")

    monkeypatch.setattr(futuristic_app, "ThreadingHTTPServer", UnexpectedServer)
    with pytest.raises(
        ValueError,
        match=(
            "production authentication, trusted PARMAR Account ID resolution, and "
            "complete route authorization are not implemented"
        ),
    ):
        futuristic_app.main()


def test_production_startup_rejects_development_authentication(monkeypatch):
    monkeypatch.setenv("PARMAR_ENVIRONMENT", "production")
    monkeypatch.setenv("PARMAR_DEVELOPMENT_AUTH_ENABLED", "true")
    with pytest.raises(ValueError, match="development authentication is unverified"):
        futuristic_app.main()


def test_production_startup_requires_tls_before_authentication_gate(monkeypatch):
    monkeypatch.setenv("PARMAR_ENVIRONMENT", "production")
    monkeypatch.delenv("PARMAR_DEVELOPMENT_AUTH_ENABLED", raising=False)
    monkeypatch.delenv("PARMAR_UI_TLS_CERTFILE", raising=False)
    monkeypatch.delenv("PARMAR_UI_TLS_KEYFILE", raising=False)
    with pytest.raises(ValueError, match="require a valid TLS certificate"):
        futuristic_app.main()


def test_invalid_tls_configuration_fails_before_server_bind(monkeypatch):
    monkeypatch.setenv("PARMAR_UI_TLS_CERTFILE", "/does-not-exist/cert.pem")
    monkeypatch.setenv("PARMAR_UI_TLS_KEYFILE", "/does-not-exist/key.pem")

    class UnexpectedServer:
        def __init__(self, *_args):
            pytest.fail("The server must not bind with invalid TLS configuration.")

    monkeypatch.setattr(futuristic_app, "ThreadingHTTPServer", UnexpectedServer)
    with pytest.raises(
        ValueError,
        match="Configured TLS certificate and private key could not be loaded",
    ) as error:
        futuristic_app.main()
    assert "/does-not-exist" not in str(error.value)


def test_malformed_tls_certificate_fails_before_server_bind(monkeypatch, tmp_path):
    certificate = tmp_path / "malformed.crt"
    private_key = tmp_path / "private.key"
    certificate.write_text("not a PEM certificate", encoding="ascii")
    private_key.write_text("not a PEM private key", encoding="ascii")

    class UnexpectedServer:
        def __init__(self, *_args):
            pytest.fail("The server must not bind with malformed TLS material.")

    monkeypatch.setenv("PARMAR_UI_TLS_CERTFILE", str(certificate))
    monkeypatch.setenv("PARMAR_UI_TLS_KEYFILE", str(private_key))
    monkeypatch.setattr(futuristic_app, "ThreadingHTTPServer", UnexpectedServer)
    with pytest.raises(ValueError, match="could not be loaded"):
        futuristic_app.main()


def test_mismatched_tls_certificate_and_key_fail_before_server_bind(monkeypatch, tls_keypairs):
    certificate, _private_key = tls_keypairs["first"]
    _other_certificate, other_private_key = tls_keypairs["second"]

    class UnexpectedServer:
        def __init__(self, *_args):
            pytest.fail("The server must not bind with mismatched TLS material.")

    monkeypatch.setenv("PARMAR_UI_TLS_CERTFILE", str(certificate))
    monkeypatch.setenv("PARMAR_UI_TLS_KEYFILE", str(other_private_key))
    monkeypatch.setattr(futuristic_app, "ThreadingHTTPServer", UnexpectedServer)
    with pytest.raises(ValueError, match="could not be loaded"):
        futuristic_app.main()


@pytest.mark.parametrize(
    ("certificate", "private_key"),
    [
        ("configured-cert", ""),
        ("", "configured-key"),
    ],
)
def test_incomplete_tls_configuration_fails_before_server_bind(
    monkeypatch,
    certificate,
    private_key,
):
    class UnexpectedServer:
        def __init__(self, *_args):
            pytest.fail("The server must not bind with an incomplete TLS configuration.")

    monkeypatch.setenv("PARMAR_UI_TLS_CERTFILE", certificate)
    monkeypatch.setenv("PARMAR_UI_TLS_KEYFILE", private_key)
    monkeypatch.setattr(futuristic_app, "ThreadingHTTPServer", UnexpectedServer)
    with pytest.raises(ValueError, match="Configure both PARMAR_UI_TLS_CERTFILE"):
        futuristic_app.main()


def test_unknown_environment_fails_closed(monkeypatch):
    monkeypatch.setenv("PARMAR_ENVIRONMENT", "production-like")
    with pytest.raises(ValueError, match="Unsupported PARMAR_ENVIRONMENT"):
        futuristic_app.main()


@pytest.mark.parametrize(
    ("environment", "dev_auth"),
    [
        ("prod", "false"),
        ("production", "TRUE"),
    ],
)
def test_production_mode_aliases_fail_closed(monkeypatch, environment, dev_auth, tls_keypairs):
    certificate, private_key = tls_keypairs["first"]
    monkeypatch.setenv("PARMAR_ENVIRONMENT", environment)
    monkeypatch.setenv("PARMAR_UI_HOST", "127.0.0.1")
    monkeypatch.setenv("PARMAR_DEVELOPMENT_AUTH_ENABLED", dev_auth)
    monkeypatch.setenv("PARMAR_UI_TLS_CERTFILE", str(certificate))
    monkeypatch.setenv("PARMAR_UI_TLS_KEYFILE", str(private_key))
    monkeypatch.delenv("PARMAR_UI_ORIGIN", raising=False)

    class UnexpectedServer:
        def __init__(self, *_args):
            pytest.fail("A production alias must be rejected before listener construction.")

    monkeypatch.setattr(futuristic_app, "ThreadingHTTPServer", UnexpectedServer)
    monkeypatch.setattr(futuristic_app, "_IPv6ThreadingHTTPServer", UnexpectedServer)
    with pytest.raises(ValueError, match="Production startup is disabled"):
        futuristic_app.main()


def test_main_module_ui_entry_uses_same_production_startup_gate(monkeypatch, tls_keypairs):
    from PARMAR.main import run_futuristic_ui

    certificate, private_key = tls_keypairs["first"]
    monkeypatch.setenv("PARMAR_ENVIRONMENT", "production")
    monkeypatch.setenv("PARMAR_UI_TLS_CERTFILE", str(certificate))
    monkeypatch.setenv("PARMAR_UI_TLS_KEYFILE", str(private_key))
    monkeypatch.delenv("PARMAR_DEVELOPMENT_AUTH_ENABLED", raising=False)

    class UnexpectedServer:
        def __init__(self, *_args):
            pytest.fail("The module alias must reject production before listener construction.")

    monkeypatch.setattr(futuristic_app, "ThreadingHTTPServer", UnexpectedServer)
    monkeypatch.setattr(futuristic_app, "_IPv6ThreadingHTTPServer", UnexpectedServer)
    with pytest.raises(ValueError, match="Production startup is disabled"):
        run_futuristic_ui()


def test_guarded_server_factory_is_the_only_ui_listener_constructor():
    package_root = Path(futuristic_app.__file__).resolve().parents[1]
    listener_constructors = []
    for source_path in package_root.rglob("*.py"):
        if "tests" in source_path.parts or "__pycache__" in source_path.parts:
            continue
        source_tree = ast.parse(source_path.read_text(encoding="utf-8"))
        for node in ast.walk(source_tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id in {"HTTPServer", "ThreadingHTTPServer", "server_class"}
            ):
                listener_constructors.append(source_path.relative_to(package_root))
    assert listener_constructors == [Path("interface/futuristic_app.py")]

    module = ast.parse(Path(futuristic_app.__file__).read_text(encoding="utf-8"))
    functions = [node for node in module.body if isinstance(node, ast.FunctionDef)]
    constructor_owners = []
    for function in functions:
        for node in ast.walk(function):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "server_class"
            ):
                constructor_owners.append(function.name)

    assert constructor_owners == ["_create_ui_server"]
    factory = next(function for function in functions if function.name == "_create_ui_server")
    assert any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "_validate_startup_configuration"
        for node in ast.walk(factory)
    )
    main = next(function for function in functions if function.name == "main")
    assert any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "_create_ui_server"
        for node in ast.walk(main)
    )
    module_entrypoint = next(
        node for node in module.body
        if isinstance(node, ast.If)
        and isinstance(node.test, ast.Compare)
        and isinstance(node.test.left, ast.Name)
        and node.test.left.id == "__name__"
    )
    assert any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "main"
        for node in ast.walk(module_entrypoint)
    )


def test_main_py_ui_flag_uses_the_guarded_startup(monkeypatch):
    monkeypatch.setenv("PARMAR_ENVIRONMENT", "production")
    monkeypatch.setenv("PARMAR_DEVELOPMENT_AUTH_ENABLED", "true")
    monkeypatch.setattr(sys, "argv", ["PARMAR/main.py", "--ui"])

    class UnexpectedServer:
        def __init__(self, *_args):
            pytest.fail("The CLI must reject production before listener construction.")

    monkeypatch.setattr(futuristic_app, "ThreadingHTTPServer", UnexpectedServer)
    monkeypatch.setattr(futuristic_app, "_IPv6ThreadingHTTPServer", UnexpectedServer)
    main_path = Path(futuristic_app.__file__).resolve().parents[1] / "main.py"

    with pytest.raises(ValueError, match="development authentication is unverified"):
        runpy.run_path(str(main_path), run_name="__main__")
