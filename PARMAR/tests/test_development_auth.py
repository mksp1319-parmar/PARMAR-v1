import http.client
import io
import json
import shutil
import ssl
import subprocess
import threading
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from PARMAR.conversations import InMemoryConversationRepository, SQLiteConversationRepository
from PARMAR.identity import LocalDemoPrincipalResolver
from PARMAR.identity_store import SQLiteIdentityRepository
from PARMAR.interface import futuristic_app
from PARMAR.interface.approvals import PendingApprovalStore
from PARMAR.memories import InMemoryMemoryRepository, SQLiteMemoryRepository
from PARMAR.sessions import (
    InMemorySessionRepository,
    SESSION_COOKIE_NAME,
    SessionManager,
    SessionPolicy,
    SQLiteSessionRepository,
)

REAL_REQUEST_IS_TLS = futuristic_app._request_is_tls
HTTP_SESSION_STORE_KEY = b"isolated-http-test-session-integrity-key"


DEV_AUTH_ENV = {
    "PARMAR_ENVIRONMENT": "development",
    "PARMAR_DEVELOPMENT_AUTH_ENABLED": "true",
    "PARMAR_UI_HOST": "127.0.0.1",
    "PARMAR_UI_TLS_CERTFILE": "/tmp/parmar-test-cert.pem",
    "PARMAR_UI_TLS_KEYFILE": "/tmp/parmar-test-key.pem",
    "PARMAR_UI_ORIGIN": "https://127.0.0.1:8080",
}


@pytest.fixture
def authenticated_https_api(development_auth, monkeypatch, tmp_path):
    openssl = shutil.which("openssl")
    if openssl is None:
        pytest.skip("OpenSSL is required to create an isolated HTTPS test certificate.")

    certificate = tmp_path / "loopback.crt"
    private_key = tmp_path / "loopback.key"
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

    manager = SessionManager(
        SQLiteSessionRepository(
            tmp_path / "sessions.sqlite3",
            integrity_key=HTTP_SESSION_STORE_KEY,
        ),
        SessionPolicy(idle_timeout_seconds=300, absolute_timeout_seconds=900),
    )
    identity_repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    conversations = SQLiteConversationRepository(tmp_path / "conversations.sqlite3")
    memories = SQLiteMemoryRepository(tmp_path / "memories.sqlite3")
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", manager)
    monkeypatch.setattr(futuristic_app, "IDENTITY_REPOSITORY", identity_repository)
    monkeypatch.setattr(futuristic_app, "CONVERSATION_REPOSITORY", conversations)
    monkeypatch.setattr(futuristic_app, "MESSAGE_REPOSITORY", conversations)
    monkeypatch.setattr(futuristic_app, "MEMORY_REPOSITORY", memories)
    monkeypatch.setattr(futuristic_app, "_request_is_tls", REAL_REQUEST_IS_TLS)

    server = ThreadingHTTPServer(("127.0.0.1", 0), futuristic_app.PARMARRequestHandler)
    server.daemon_threads = True
    port = server.server_address[1]
    origin = f"https://127.0.0.1:{port}"
    monkeypatch.setattr(futuristic_app, "UI_PORT", port)
    monkeypatch.setenv("PARMAR_UI_HOST", "127.0.0.1")
    monkeypatch.setenv("PARMAR_UI_TLS_CERTFILE", str(certificate))
    monkeypatch.setenv("PARMAR_UI_TLS_KEYFILE", str(private_key))
    monkeypatch.setenv("PARMAR_UI_ORIGIN", origin)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certificate, private_key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    client_context = ssl._create_unverified_context()

    def request(path, *, method="GET", payload=None, cookie=None, headers=None):
        request_headers = {"Accept": "application/json"}
        if cookie is not None:
            request_headers["Cookie"] = cookie
        if method != "GET":
            request_headers.update({
                "Content-Type": "application/json",
                "Origin": origin,
                "Sec-Fetch-Site": "same-origin",
            })
        request_headers.update(headers or {})
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        connection = http.client.HTTPSConnection(
            "127.0.0.1",
            port,
            context=client_context,
            timeout=5,
        )
        try:
            connection.request(method, path, body=body, headers=request_headers)
            response = connection.getresponse()
            raw_body = response.read()
            content_type = response.getheader("Content-Type", "")
            result = json.loads(raw_body) if "application/json" in content_type else raw_body
            return response.status, response.headers, result
        finally:
            connection.close()

    try:
        yield {
            "manager": manager,
            "identity": identity_repository,
            "conversations": conversations,
            "memories": memories,
            "origin": origin,
            "request": request,
        }
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


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


def test_authenticated_profile_conversation_workflow_uses_owned_backend_state(
    development_auth,
    monkeypatch,
    tmp_path,
):
    identity_repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    conversations = InMemoryConversationRepository()
    memories = InMemoryMemoryRepository()
    monkeypatch.setattr(futuristic_app, "IDENTITY_REPOSITORY", identity_repository)
    monkeypatch.setattr(futuristic_app, "CONVERSATION_REPOSITORY", conversations)
    monkeypatch.setattr(futuristic_app, "MESSAGE_REPOSITORY", conversations)
    monkeypatch.setattr(futuristic_app, "MEMORY_REPOSITORY", memories)

    _login_request, login_response, login_errors = development_login()
    assert login_errors == []
    assert login_response["status"] == 201
    token = login_response["headers"]["Set-Cookie"].split(";", 1)[0].split("=", 1)[1]
    cookie = f"{SESSION_COOKIE_NAME}={token}"

    def api_request(path, *, method="GET", payload=None, csrf=None, origin=None):
        headers = {"Cookie": cookie}
        if method == "POST":
            headers.update({
                "Origin": origin or DEV_AUTH_ENV["PARMAR_UI_ORIGIN"],
                "Sec-Fetch-Site": "same-origin",
            })
        if csrf is not None:
            headers["X-CSRF-Token"] = csrf
        request, response, errors = make_request(path, body=payload, headers=headers)
        if method == "GET":
            futuristic_app.PARMARRequestHandler.do_GET(request)
        else:
            futuristic_app.PARMARRequestHandler.do_POST(request)
        return request, response, errors

    _request, session_response, errors = api_request("/api/session")
    assert errors == []
    assert session_response["status"] == 200
    csrf_token = session_response["result"]["csrf_token"]
    authenticated_session = development_auth.resolve(token)
    assert authenticated_session is not None
    user_id = authenticated_session.user_id
    session_id = authenticated_session.session_id

    _request, profiles_response, errors = api_request("/api/identity/profiles")
    assert errors == []
    assert profiles_response["result"]["profiles"] == []

    _request, no_csrf_response, errors = api_request(
        "/api/identity/profiles",
        method="POST",
        payload={"name": "Personal"},
    )
    assert no_csrf_response == {}
    assert errors == [(403, "CSRF validation failed")]

    _request, cross_origin_response, errors = api_request(
        "/api/identity/profiles",
        method="POST",
        payload={"name": "Personal"},
        csrf=csrf_token,
        origin="https://attacker.invalid",
    )
    assert cross_origin_response == {}
    assert errors == [(403, "Unsafe request origin is not allowed")]

    _request, personal_response, errors = api_request(
        "/api/identity/profiles",
        method="POST",
        payload={"name": "Personal"},
        csrf=csrf_token,
    )
    assert errors == []
    assert personal_response["status"] == 201
    personal_id = personal_response["result"]["profile_id"]

    _request, work_response, errors = api_request(
        "/api/identity/profiles",
        method="POST",
        payload={"name": "Work"},
        csrf=csrf_token,
    )
    assert errors == []
    assert work_response["status"] == 201
    work_id = work_response["result"]["profile_id"]

    _request, profiles_response, errors = api_request("/api/identity/profiles")
    assert errors == []
    assert [profile["profile_id"] for profile in profiles_response["result"]["profiles"]] == [
        personal_id,
        work_id,
    ]

    _request, selected_response, errors = api_request(
        "/api/session/profile",
        method="POST",
        payload={"profile_id": personal_id},
        csrf=csrf_token,
    )
    assert errors == []
    assert selected_response["result"]["active_profile"]["profile_id"] == personal_id

    memories.set_consent(user_id, True)
    owned_memory = memories.create_owned(user_id, "Project planning preference.")
    foreign_user = uuid4()
    memories.set_consent(foreign_user, True)
    memories.create_owned(foreign_user, "Project planning belongs to another user.")
    retrieved_memories = []

    class ReleasedChatService:
        def __init__(self, external_authorization=None):
            pass

        def respond(self, _prompt, context=None, **options):
            memory_retriever = options.get("memory_retriever")
            if memory_retriever is not None:
                context.memory = memory_retriever()
                retrieved_memories.extend(context.memory)
            return {
                "message": "Personal profile response.",
                "provider_status": "COMPLETED",
                "response_disposition": "RELEASED",
                "voki_contract": {
                    "lifecycle": {"state": "RELEASED"},
                    "provider": {"status": "COMPLETED"},
                    "response_safety": {"status": "PASS"},
                    "response_disposition": "RELEASED",
                },
            }

    monkeypatch.setattr(futuristic_app, "ChatService", ReleasedChatService)
    _request, chat_response, errors = api_request(
        "/api/chat",
        method="POST",
        payload={"message": "Help with project planning."},
        csrf=csrf_token,
    )
    assert errors == []
    assert chat_response["status"] == 200
    assert retrieved_memories == [owned_memory.content]
    conversation_id = chat_response["result"]["conversation_id"]
    stored = conversations.get_owned(UUID(conversation_id), user_id)
    assert stored is not None and stored.profile_id == UUID(personal_id)

    _request, history_response, errors = api_request("/api/conversations")
    assert errors == []
    assert [item["conversation_id"] for item in history_response["result"]["conversations"]] == [
        conversation_id,
    ]
    _request, retrieved_response, errors = api_request(f"/api/conversations/{conversation_id}")
    assert errors == []
    assert [message["content"] for message in retrieved_response["result"]["messages"]] == [
        "Help with project planning.",
        "Personal profile response.",
    ]

    _request, selected_response, errors = api_request(
        "/api/session/profile",
        method="POST",
        payload={"profile_id": work_id},
        csrf=csrf_token,
    )
    assert errors == []
    assert selected_response["result"]["active_profile"]["profile_id"] == work_id
    _request, history_response, errors = api_request("/api/conversations")
    assert errors == []
    assert history_response["result"]["conversations"] == []
    _request, hidden_response, errors = api_request(f"/api/conversations/{conversation_id}")
    assert hidden_response == {}
    assert errors == [(404, "Conversation not found")]

    _request, logout_response, errors = api_request(
        "/api/logout",
        method="POST",
        payload={},
        csrf=csrf_token,
    )
    assert errors == []
    assert logout_response["result"]["logged_out"] is True
    assert "Max-Age=0" in logout_response["headers"]["Set-Cookie"]
    revoked = development_auth.repository.get_by_session_id(session_id)
    assert revoked is not None
    assert revoked.status == "REVOKED"
    assert revoked.active_profile_id is None
    _request, anonymous_response, errors = api_request("/api/session")
    assert errors == []
    assert anonymous_response["result"]["authenticated"] is False


def test_authenticated_profile_conversation_and_memory_workflow_over_https(
    authenticated_https_api,
    monkeypatch,
):
    api = authenticated_https_api
    request = api["request"]

    status, headers, _payload = request(
        "/api/auth/development",
        method="POST",
        payload={"user_id": str(uuid4())},
    )
    assert status == 400
    assert headers.get("Set-Cookie") is None

    status, headers, payload = request(
        "/api/auth/development",
        method="POST",
        payload={},
    )
    assert status == 201
    assert payload == {"authenticated": True}
    cookie_header = headers.get("Set-Cookie")
    assert cookie_header is not None
    assert "Secure" in cookie_header
    assert "HttpOnly" in cookie_header
    assert "SameSite=Lax" in cookie_header
    assert "csrf_token" not in payload
    cookie = cookie_header.split(";", 1)[0]

    status, _headers, session_payload = request("/api/session", cookie=cookie)
    assert status == 200
    assert session_payload["authentication_state"] == "DEVELOPMENT_UNVERIFIED"
    csrf_token = session_payload["csrf_token"]
    session = api["manager"].resolve(cookie.split("=", 1)[1])
    assert session is not None
    user_id = session.user_id

    foreign_profile = api["identity"].create_profile(uuid4(), "Not owned")
    status, _headers, _payload = request(
        "/api/identity/profiles",
        method="POST",
        payload={"name": "Personal", "owner_user_id": str(uuid4())},
        cookie=cookie,
        headers={"X-CSRF-Token": csrf_token},
    )
    assert status == 400

    status, _headers, _payload = request(
        "/api/identity/profiles",
        method="POST",
        payload={"name": "Personal"},
        cookie=cookie,
    )
    assert status == 403
    status, _headers, _payload = request(
        "/api/identity/profiles",
        method="POST",
        payload={"name": "Personal"},
        cookie=cookie,
        headers={"X-CSRF-Token": "invalid-csrf-token"},
    )
    assert status == 403
    status, _headers, _payload = request(
        "/api/identity/profiles",
        method="POST",
        payload={"name": "Personal"},
        cookie=cookie,
        headers={
            "X-CSRF-Token": csrf_token,
            "Origin": "https://attacker.invalid",
            "Sec-Fetch-Site": "cross-site",
        },
    )
    assert status == 403
    status, _headers, _payload = request(
        "/api/identity/profiles",
        method="GET",
        cookie=cookie,
        headers={"X-User-ID": str(uuid4())},
    )
    assert status == 400

    status, _headers, first = request(
        "/api/identity/profiles",
        method="POST",
        payload={"name": "Personal"},
        cookie=cookie,
        headers={"X-CSRF-Token": csrf_token},
    )
    assert status == 201
    status, _headers, second = request(
        "/api/identity/profiles",
        method="POST",
        payload={"name": "Work"},
        cookie=cookie,
        headers={"X-CSRF-Token": csrf_token},
    )
    assert status == 201
    first_profile_id = first["profile_id"]
    second_profile_id = second["profile_id"]

    status, _headers, profiles = request("/api/identity/profiles", cookie=cookie)
    assert status == 200
    assert [profile["profile_id"] for profile in profiles["profiles"]] == [
        first_profile_id,
        second_profile_id,
    ]

    status, _headers, _payload = request(
        "/api/session/profile",
        method="POST",
        payload={"profile_id": first_profile_id, "user_id": str(uuid4())},
        cookie=cookie,
        headers={"X-CSRF-Token": csrf_token},
    )
    assert status == 400
    status, _headers, _payload = request(
        "/api/session/profile",
        method="POST",
        payload={"profile_id": str(foreign_profile.profile_id)},
        cookie=cookie,
        headers={"X-CSRF-Token": csrf_token},
    )
    assert status == 404

    status, _headers, selected = request(
        "/api/session/profile",
        method="POST",
        payload={"profile_id": first_profile_id},
        cookie=cookie,
        headers={"X-CSRF-Token": csrf_token},
    )
    assert status == 200
    assert selected["active_profile"]["profile_id"] == first_profile_id

    api["memories"].set_consent(user_id, True)
    owned_memory = api["memories"].create_owned(user_id, "Project planning checklist.")
    foreign_user = uuid4()
    api["memories"].set_consent(foreign_user, True)
    api["memories"].create_owned(foreign_user, "Project planning from another user.")
    retrieved_memory = []

    class ReleasedChatService:
        def __init__(self, external_authorization=None):
            pass

        def respond(self, _prompt, context=None, **options):
            retriever = options.get("memory_retriever")
            if retriever is not None:
                context.memory = retriever()
                retrieved_memory.extend(context.memory)
            return {
                "message": "Released test response.",
                "provider_status": "COMPLETED",
                "response_disposition": "RELEASED",
                "voki_contract": {
                    "lifecycle": {"state": "RELEASED"},
                    "provider": {"status": "COMPLETED"},
                    "response_safety": {"status": "PASS"},
                    "response_disposition": "RELEASED",
                },
            }

    monkeypatch.setattr(futuristic_app, "ChatService", ReleasedChatService)
    status, _headers, chat = request(
        "/api/chat",
        method="POST",
        payload={"message": "Help with project planning."},
        cookie=cookie,
        headers={"X-CSRF-Token": csrf_token},
    )
    assert status == 200
    assert retrieved_memory == [owned_memory.content]
    conversation_id = chat["conversation_id"]
    stored = api["conversations"].get_owned(UUID(conversation_id), user_id)
    assert stored is not None
    assert stored.profile_id == UUID(first_profile_id)

    status, _headers, history = request("/api/conversations", cookie=cookie)
    assert status == 200
    assert [item["conversation_id"] for item in history["conversations"]] == [conversation_id]
    status, _headers, conversation = request(
        f"/api/conversations/{conversation_id}",
        cookie=cookie,
    )
    assert status == 200
    assert [message["content"] for message in conversation["messages"]] == [
        "Help with project planning.",
        "Released test response.",
    ]

    status, _headers, _selected = request(
        "/api/session/profile",
        method="POST",
        payload={"profile_id": second_profile_id},
        cookie=cookie,
        headers={"X-CSRF-Token": csrf_token},
    )
    assert status == 200
    status, _headers, history = request("/api/conversations", cookie=cookie)
    assert status == 200
    assert history["conversations"] == []
    status, _headers, _payload = request(
        f"/api/conversations/{conversation_id}",
        cookie=cookie,
    )
    assert status == 404

    status, headers, logout = request(
        "/api/logout",
        method="POST",
        payload={},
        cookie=cookie,
        headers={"X-CSRF-Token": csrf_token},
    )
    assert status == 200
    assert logout["logged_out"] is True
    assert "Max-Age=0" in headers.get("Set-Cookie", "")
    status, _headers, session_payload = request("/api/session", cookie=cookie)
    assert status == 200
    assert session_payload["authenticated"] is False
    status, _headers, _payload = request("/api/conversations", cookie=cookie)
    assert status == 401


def test_expired_sqlite_session_cannot_access_profiles_or_conversations_over_https(
    authenticated_https_api,
):
    api = authenticated_https_api
    request = api["request"]
    status, headers, _payload = request(
        "/api/auth/development",
        method="POST",
        payload={},
    )
    assert status == 201
    cookie = headers.get("Set-Cookie").split(";", 1)[0]
    token = cookie.split("=", 1)[1]
    manager = api["manager"]
    session = manager.resolve(token)
    assert session is not None
    profile = api["identity"].create_profile(session.user_id, "Expiry")
    selected = manager.select_profile(
        session.session_id,
        session.user_id,
        profile.profile_id,
    )
    assert selected is not None

    assert manager.resolve(
        token,
        now=datetime.now(timezone.utc) + timedelta(seconds=901),
    ) is None
    expired = manager.repository.get_by_session_id(session.session_id)
    assert expired is not None
    assert expired.status == "EXPIRED"
    assert expired.active_profile_id is None

    status, _headers, session_payload = request("/api/session", cookie=cookie)
    assert status == 200
    assert session_payload["authenticated"] is False
    status, _headers, _payload = request("/api/identity/profiles", cookie=cookie)
    assert status == 401
    status, _headers, _payload = request("/api/conversations", cookie=cookie)
    assert status == 401


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
