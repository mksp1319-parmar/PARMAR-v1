import io
import json
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from PARMAR.identity import LocalDemoPrincipalResolver
from PARMAR.interface import futuristic_app
from PARMAR.interface.approvals import PendingApprovalStore
from PARMAR.sessions import (
    InMemorySessionRepository,
    SESSION_COOKIE_NAME,
    SessionManager,
    SessionPolicy,
)


DEV_AUTH_ENV = {
    "PARMAR_ENVIRONMENT": "development",
    "PARMAR_DEVELOPMENT_AUTH_ENABLED": "true",
    "PARMAR_UI_HOST": "127.0.0.1",
    "PARMAR_UI_TLS_CERTFILE": "/tmp/parmar-test-cert.pem",
    "PARMAR_UI_TLS_KEYFILE": "/tmp/parmar-test-key.pem",
    "PARMAR_UI_ORIGIN": "https://127.0.0.1:8080",
}


@pytest.fixture
def development_auth(monkeypatch):
    for key, value in DEV_AUTH_ENV.items():
        monkeypatch.setenv(key, value)
    manager = SessionManager(
        InMemorySessionRepository(),
        SessionPolicy(idle_timeout_seconds=300, absolute_timeout_seconds=900),
    )
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", manager)
    monkeypatch.setattr(futuristic_app, "PENDING_APPROVALS", PendingApprovalStore())
    monkeypatch.setattr(futuristic_app, "PRINCIPAL_RESOLVER", LocalDemoPrincipalResolver())
    monkeypatch.setattr(futuristic_app, "_request_is_tls", lambda _request: True)
    return manager


def make_request(path, *, body=None, headers=None):
    body_bytes = json.dumps(body if body is not None else {}).encode("utf-8")
    response = {}
    errors = []
    request_headers = {
        "Content-Length": str(len(body_bytes)),
        "Content-Type": "application/json",
    }
    request_headers.update(headers or {})
    request = SimpleNamespace(
        path=path,
        headers=request_headers,
        rfile=io.BytesIO(body_bytes),
        send_error=lambda status, message: errors.append((status, message)),
        _send_json=lambda status, payload: response.update(status=status, result=payload),
        _send_json_with_headers=lambda status, payload, extra: response.update(
            status=status,
            result=payload,
            headers=extra,
        ),
    )
    return request, response, errors


def development_login(*, headers=None, body=None):
    request_headers = {
        "Origin": DEV_AUTH_ENV["PARMAR_UI_ORIGIN"],
        "Sec-Fetch-Site": "same-origin",
    }
    request_headers.update(headers or {})
    request, response, errors = make_request(
        "/api/auth/development",
        body=body,
        headers=request_headers,
    )
    futuristic_app.PARMARRequestHandler.do_POST(request)
    return request, response, errors


def test_development_auth_is_disabled_by_default(monkeypatch):
    monkeypatch.delenv("PARMAR_DEVELOPMENT_AUTH_ENABLED", raising=False)
    assert futuristic_app._validate_development_auth_configuration() is None


def test_disabled_development_auth_route_never_issues_a_session(monkeypatch, development_auth):
    monkeypatch.setenv("PARMAR_DEVELOPMENT_AUTH_ENABLED", "false")
    _request, response, errors = development_login()
    assert response == {}
    assert errors == [(404, "Development authentication is unavailable")]
    assert development_auth.resolve("unissued") is None


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"PARMAR_ENVIRONMENT": "production"}, "PARMAR_ENVIRONMENT=development"),
        ({"PARMAR_UI_HOST": "0.0.0.0"}, "loopback"),
        ({"PARMAR_UI_TLS_KEYFILE": ""}, "HTTPS certificate"),
        ({"PARMAR_UI_ORIGIN": "http://127.0.0.1:8080"}, "exact HTTPS origin"),
        ({"PARMAR_UI_ORIGIN": "https://127.0.0.1:8443"}, "exact HTTPS origin"),
    ],
)
def test_development_auth_configuration_fails_closed(development_auth, overrides, message):
    settings = dict(DEV_AUTH_ENV)
    settings.update(overrides)
    with pytest.raises(ValueError, match=message):
        futuristic_app._validate_development_auth_configuration(
            settings,
            host=settings["PARMAR_UI_HOST"],
        )


def test_development_auth_requires_persistent_approval_storage(monkeypatch, development_auth):
    monkeypatch.setattr(
        futuristic_app,
        "PENDING_APPROVALS",
        futuristic_app.UnavailablePendingApprovalStore(),
    )
    with pytest.raises(ValueError, match="persistent approval storage"):
        futuristic_app._validate_development_auth_configuration()


def test_enabled_development_auth_fails_before_non_loopback_server_bind(monkeypatch, development_auth):
    monkeypatch.setenv("PARMAR_UI_HOST", "0.0.0.0")
    constructed = False

    class UnexpectedServer:
        def __init__(self, *_args):
            nonlocal constructed
            constructed = True
            pytest.fail("Server must not bind when development auth has a non-loopback host")

    monkeypatch.setattr(futuristic_app, "ThreadingHTTPServer", UnexpectedServer)
    with pytest.raises(ValueError, match="loopback"):
        futuristic_app.main()
    assert constructed is False


def test_development_login_rejects_cross_origin_request(development_auth):
    _request, response, errors = development_login(
        headers={
            "Origin": "https://attacker.invalid",
            "Sec-Fetch-Site": "cross-site",
        },
    )
    assert errors == []
    assert response["status"] == 403
    assert response["headers"]["Cache-Control"] == "no-store"
    assert development_auth.resolve("unissued") is None


@pytest.mark.parametrize(
    "payload",
    [
        {"username": "not-an-identity"},
        {"user_id": str(uuid4())},
        {"display": "not-accepted"},
    ],
)
def test_development_login_rejects_identity_and_other_fields(development_auth, payload):
    _request, response, errors = development_login(body=payload)
    assert errors == []
    assert response["status"] == 400
    assert response["headers"]["Cache-Control"] == "no-store"
    assert "Set-Cookie" not in response["headers"]


def test_development_login_creates_only_the_fixed_server_principal(development_auth):
    _request, response, errors = development_login()

    assert errors == []
    assert response["status"] == 201
    assert response["result"] == {"authenticated": True}
    assert response["headers"]["Cache-Control"] == "no-store"
    cookie_header = response["headers"]["Set-Cookie"]
    assert "Secure" in cookie_header
    assert "HttpOnly" in cookie_header
    assert "SameSite=Lax" in cookie_header
    assert "Path=/" in cookie_header

    token = cookie_header.split(";", 1)[0].split("=", 1)[1]
    session = development_auth.resolve(token)
    assert session is not None
    assert session.user_id == futuristic_app.DEVELOPMENT_AUTH_USER_ID
    assert session.user_id == UUID("00000000-0000-4000-8000-000000000005")
    assert session.authentication_source == futuristic_app.DEVELOPMENT_AUTH_SOURCE
    assert token not in json.dumps(response["result"])
    assert "csrf_token" not in response["result"]

    status_request, status_response, status_errors = make_request(
        "/api/session",
        headers={"Cookie": f"{SESSION_COOKIE_NAME}={token}"},
    )
    futuristic_app.PARMARRequestHandler.do_GET(status_request)
    assert status_errors == []
    assert status_response["result"]["authenticated"] is True
    assert status_response["result"]["authentication_state"] == "DEVELOPMENT_UNVERIFIED"
    assert status_response["result"]["csrf_token"]
    assert token not in json.dumps(status_response["result"])


def test_development_login_requires_https_and_same_origin_metadata(monkeypatch, development_auth):
    monkeypatch.setattr(futuristic_app, "_request_is_tls", lambda _request: False)
    _request, response, errors = development_login()
    assert response == {}
    assert errors == [(404, "Development authentication is unavailable")]

    monkeypatch.setattr(futuristic_app, "_request_is_tls", lambda _request: True)
    _request, response, errors = development_login(headers={"Sec-Fetch-Site": "same-site"})
    assert errors == []
    assert response["status"] == 403


def test_development_session_logout_revokes_only_that_session(development_auth):
    _request, login_response, _errors = development_login()
    token = login_response["headers"]["Set-Cookie"].split(";", 1)[0].split("=", 1)[1]
    session = development_auth.resolve(token)
    assert session is not None
    csrf_token = development_auth.csrf_token(session.session_id)
    assert csrf_token is not None

    logout_request, logout_response, logout_errors = make_request(
        "/api/logout",
        headers={
            "Cookie": f"{SESSION_COOKIE_NAME}={token}",
            "X-CSRF-Token": csrf_token,
        },
    )
    futuristic_app.PARMARRequestHandler.do_POST(logout_request)

    assert logout_errors == []
    assert logout_response["status"] == 200
    assert development_auth.resolve(token) is None


@pytest.mark.parametrize("csrf", [None, "invalid"])
def test_development_session_mutations_require_csrf(development_auth, csrf):
    _request, login_response, _errors = development_login()
    token = login_response["headers"]["Set-Cookie"].split(";", 1)[0].split("=", 1)[1]
    headers = {"Cookie": f"{SESSION_COOKIE_NAME}={token}"}
    if csrf is not None:
        headers["X-CSRF-Token"] = csrf
    logout_request, logout_response, logout_errors = make_request(
        "/api/logout",
        headers=headers,
    )
    futuristic_app.PARMARRequestHandler.do_POST(logout_request)

    assert logout_response == {}
    assert logout_errors == [(403, "CSRF validation failed")]
    assert development_auth.resolve(token) is not None


def test_development_login_does_not_replace_an_active_session(development_auth):
    _request, login_response, _errors = development_login()
    token = login_response["headers"]["Set-Cookie"].split(";", 1)[0].split("=", 1)[1]
    session = development_auth.resolve(token)
    csrf_token = development_auth.csrf_token(session.session_id)

    _request, response, errors = development_login(
        headers={
            "Cookie": f"{SESSION_COOKIE_NAME}={token}",
            "X-CSRF-Token": csrf_token,
        },
    )

    assert errors == []
    assert response["status"] == 409
    assert response["headers"]["Cache-Control"] == "no-store"
    assert "Set-Cookie" not in response["headers"]
    assert development_auth.resolve(token) is not None


def test_browser_auth_ui_uses_shared_session_and_does_not_persist_tokens():
    static_dir = futuristic_app.STATIC_DIR
    app_source = (static_dir / "app.js").read_text(encoding="utf-8")
    html_source = (static_dir / "index.html").read_text(encoding="utf-8")
    voki_source = (static_dir / "voki-interface.js").read_text(encoding="utf-8")

    assert "Start Local Development Session" in html_source
    assert "NOT identity verification" in html_source
    assert "Anonymous / Local Demo" in html_source
    assert "Development Session — Unverified Identity" in app_source
    assert "Authenticated Session" in app_source
    assert "fetch('/api/auth/development'" in app_source
    assert "refresh-session-btn" in app_source
    assert "request: apiRequest" in app_source
    assert "parmar-auth-state-changed" in app_source
    assert "parmar-auth-state-changed" in voki_source
    assert "state.csrfToken" in app_source
    assert "localStorage.setItem('csrf" not in app_source
    assert "sessionStorage.setItem('csrf" not in app_source
