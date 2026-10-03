import io
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from PARMAR.identity import LocalDemoPrincipalResolver
from PARMAR.interface import futuristic_app
from PARMAR.memories import InMemoryMemoryRepository
from PARMAR.sessions import (
    InMemorySessionRepository,
    SESSION_COOKIE_NAME,
    SessionManager,
    SessionPolicy,
)


@pytest.fixture
def memory_setup(monkeypatch, tmp_path):
    repository = InMemoryMemoryRepository()
    monkeypatch.setattr(futuristic_app, "MEMORY_REPOSITORY", repository)
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", None)
    monkeypatch.setattr(futuristic_app, "PRINCIPAL_RESOLVER", LocalDemoPrincipalResolver())
    original_init = futuristic_app.DecisionLogManager.__init__

    def isolated_audit_init(self, log_path=None):
        original_init(self, log_path or str(tmp_path / "memory-audit.jsonl"))

    monkeypatch.setattr(futuristic_app.DecisionLogManager, "__init__", isolated_audit_init)
    return repository, tmp_path / "memory-audit.jsonl"


def make_session(monkeypatch, *, user_id=None, now=None, manager=None):
    manager = manager or SessionManager(
        InMemorySessionRepository(),
        SessionPolicy(idle_timeout_seconds=300, absolute_timeout_seconds=900),
    )
    credentials = manager.create_authenticated_session(user_id or uuid4(), "memory-http-test", now=now)
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", manager)
    return manager, credentials


def memory_request(path, *, method="GET", body=None, credentials=None, csrf=True, csrf_value=None):
    errors = []
    result = {}
    body_bytes = json.dumps(body if body is not None else {}).encode("utf-8")
    headers = {"Content-Length": str(len(body_bytes))}
    if credentials is not None:
        manager, session_credentials = credentials
        headers["Cookie"] = f"{SESSION_COOKIE_NAME}={session_credentials.session_token}"
        if csrf:
            headers["X-CSRF-Token"] = (
                csrf_value
                if csrf_value is not None
                else manager.csrf_token(session_credentials.session.session_id)
            )
    request = SimpleNamespace(
        path=path,
        headers=headers,
        rfile=io.BytesIO(body_bytes),
        send_error=lambda status, message: errors.append((status, message)),
        _send_json=lambda status, payload: result.update(status=status, result=payload),
        _send_json_with_headers=lambda status, payload, headers: result.update(
            status=status,
            result=payload,
            headers=headers,
        ),
    )
    handler = (
        futuristic_app.PARMARRequestHandler.do_POST
        if method == "POST"
        else futuristic_app.PARMARRequestHandler.do_GET
    )
    handler(request)
    return result, errors


def test_authenticated_memory_requires_consent_then_supports_crud_and_lists_own_records(
    monkeypatch,
    memory_setup,
):
    repository, _audit_path = memory_setup
    credentials = make_session(monkeypatch)
    result, errors = memory_request(
        "/api/memory",
        method="POST",
        body={"action": "save", "content": "Prefers concise summaries"},
        credentials=credentials,
    )
    assert result["status"] == 403
    assert result["result"]["error"] == "MEMORY_CONSENT_REQUIRED"
    assert errors == []
    assert repository.list_owned(credentials[1].session.user_id) == ()

    result, errors = memory_request(
        "/api/memory",
        method="POST",
        body={"action": "consent", "granted": True},
        credentials=credentials,
    )
    assert result["status"] == 200
    assert result["result"] == {"consent": True}
    assert result["headers"] == {"Cache-Control": "no-store"}
    assert errors == []

    result, errors = memory_request(
        "/api/memory",
        method="POST",
        body={"action": "save", "content": "Prefers concise summaries"},
        credentials=credentials,
    )
    memory_id = UUID(result["result"]["memory_id"])
    assert result["status"] == 201
    assert result["result"]["provenance"] == "explicit_user_save"
    assert errors == []

    result, errors = memory_request("/api/memory", credentials=credentials)
    assert result["result"]["consent"] is True
    assert [record["memory_id"] for record in result["result"]["memories"]] == [str(memory_id)]
    assert "owner_user_id" not in json.dumps(result)
    assert errors == []

    result, errors = memory_request(
        "/api/memory",
        method="POST",
        body={"action": "update", "memory_id": str(memory_id), "content": "Prefers short summaries"},
        credentials=credentials,
    )
    assert result["status"] == 200
    assert result["result"]["content"] == "Prefers short summaries"
    assert result["result"]["provenance"] == "explicit_user_update"
    assert errors == []

    result, errors = memory_request(
        "/api/memory",
        method="POST",
        body={"action": "consent", "granted": False},
        credentials=credentials,
    )
    assert result["result"]["consent"] is False
    result, errors = memory_request(
        "/api/memory",
        method="POST",
        body={"action": "save", "content": "No longer consented"},
        credentials=credentials,
    )
    assert result["status"] == 403
    assert errors == []

    result, errors = memory_request(
        "/api/memory",
        method="POST",
        body={"action": "delete", "memory_id": str(memory_id)},
        credentials=credentials,
    )
    assert result["status"] == 200
    assert result["result"] == {"deleted": True}
    assert result["headers"] == {"Cache-Control": "no-store"}
    assert errors == []


def test_anonymous_memory_access_is_rejected_and_local_demo_does_not_create_records(
    monkeypatch,
    memory_setup,
):
    repository, _audit_path = memory_setup

    result, errors = memory_request("/api/memory")
    assert result == {}
    assert errors == [(401, "An authenticated session is required")]
    result, errors = memory_request(
        "/api/memory",
        method="POST",
        body={"action": "consent", "granted": True},
    )
    assert result == {}
    assert errors == [(401, "An authenticated session is required")]
    assert repository._memories == {}
    assert repository._consents == {}


@pytest.mark.parametrize("revocation", ["revoked", "expired"])
def test_revoked_or_expired_session_cannot_access_memory(monkeypatch, memory_setup, revocation):
    repository, _audit_path = memory_setup
    now = datetime.now(timezone.utc) - timedelta(hours=1) if revocation == "expired" else None
    credentials = make_session(monkeypatch, now=now)
    if revocation == "revoked":
        credentials[0].revoke(credentials[1].session.session_id)
    result, errors = memory_request(
        "/api/memory",
        method="POST",
        body={"action": "consent", "granted": True},
        credentials=credentials,
    )
    assert result == {}
    assert errors == [(401, "An authenticated session is required")]
    assert repository._consents == {}


@pytest.mark.parametrize("csrf", [False, "invalid"])
def test_memory_mutations_require_valid_csrf(monkeypatch, memory_setup, csrf):
    repository, _audit_path = memory_setup
    credentials = make_session(monkeypatch)
    result, errors = memory_request(
        "/api/memory",
        method="POST",
        body={"action": "consent", "granted": True},
        credentials=credentials,
        csrf=bool(csrf) if isinstance(csrf, bool) else True,
        csrf_value="invalid" if csrf == "invalid" else None,
    )
    assert result == {}
    assert errors == [(403, "CSRF validation failed")]
    assert repository._consents == {}


@pytest.mark.parametrize("identity_field", ["user_id", "owner_id", "owner_user_id", "session_id"])
def test_memory_consent_and_mutations_reject_client_identity_substitution(
    monkeypatch,
    memory_setup,
    identity_field,
):
    repository, _audit_path = memory_setup
    credentials = make_session(monkeypatch)
    result, errors = memory_request(
        "/api/memory",
        method="POST",
        body={"action": "consent", "granted": True, identity_field: str(uuid4())},
        credentials=credentials,
    )
    assert result == {}
    assert errors == [(400, "Client-supplied identity is not accepted")]
    assert repository._consents == {}


@pytest.mark.parametrize("server_field", ["provenance", "created_at", "updated_at", "source"])
def test_memory_save_rejects_client_supplied_server_metadata(
    monkeypatch,
    memory_setup,
    server_field,
):
    repository, _audit_path = memory_setup
    credentials = make_session(monkeypatch)
    repository.set_consent(credentials[1].session.user_id, True)
    result, errors = memory_request(
        "/api/memory",
        method="POST",
        body={
            "action": "save",
            "content": "A user-provided note",
            server_field: "forged",
        },
        credentials=credentials,
    )

    assert result == {}
    assert errors == [(400, "Unsupported memory fields")]
    assert repository.list_owned(credentials[1].session.user_id) == ()


def test_memory_ownership_and_bad_ids_are_not_disclosed(monkeypatch, memory_setup):
    repository, _audit_path = memory_setup
    owner = make_session(monkeypatch)
    repository.set_consent(owner[1].session.user_id, True)
    record = repository.create_owned(owner[1].session.user_id, "Owner-only note")
    other = make_session(monkeypatch, manager=owner[0])

    result, errors = memory_request(
        "/api/memory",
        method="POST",
        body={"action": "update", "memory_id": str(record.memory_id), "content": "stolen"},
        credentials=other,
    )
    assert result == {}
    assert errors == [(404, "Memory not found")]
    result, errors = memory_request(
        "/api/memory",
        method="POST",
        body={"action": "delete", "memory_id": str(record.memory_id)},
        credentials=other,
    )
    assert result == {}
    assert errors == [(404, "Memory not found")]
    result, errors = memory_request(
        "/api/memory",
        method="POST",
        body={"action": "delete", "memory_id": "malformed"},
        credentials=owner,
    )
    assert result == {}
    assert errors == [(404, "Memory not found")]
    assert repository.list_owned(owner[1].session.user_id) == (record,)


def test_credential_like_memory_is_refused_and_never_written_to_audit(monkeypatch, memory_setup):
    repository, audit_path = memory_setup
    credentials = make_session(monkeypatch)
    repository.set_consent(credentials[1].session.user_id, True)
    secret = "sk-12345678901234567890"

    result, errors = memory_request(
        "/api/memory",
        method="POST",
        body={"action": "save", "content": f"My API key is {secret}"},
        credentials=credentials,
    )

    assert result["status"] == 400
    assert secret not in json.dumps(result)
    assert errors == []
    assert repository.list_owned(credentials[1].session.user_id) == ()
    assert not audit_path.exists()


def test_memory_audit_contains_only_fixed_metadata(monkeypatch, memory_setup):
    repository, audit_path = memory_setup
    credentials = make_session(monkeypatch)
    repository.set_consent(credentials[1].session.user_id, True)
    secretish_note = "Prefers careful explanations"

    result, errors = memory_request(
        "/api/memory",
        method="POST",
        body={"action": "save", "content": secretish_note},
        credentials=credentials,
    )

    audit = audit_path.read_text(encoding="utf-8")
    assert result["status"] == 201
    assert errors == []
    assert "memory_operation" in audit
    assert "explicit_user_save" not in audit
    assert secretish_note not in audit
    assert "content" not in audit
