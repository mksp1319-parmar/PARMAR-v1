import io
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from PARMAR.identity import LocalDemoPrincipalResolver
from PARMAR.identity_store import SQLiteIdentityRepository
from PARMAR.interface import futuristic_app
from PARMAR.sessions import (
    InMemorySessionRepository,
    SESSION_COOKIE_NAME,
    SessionManager,
    SessionPolicy,
)


@pytest.fixture
def identity_api(monkeypatch, tmp_path):
    manager = SessionManager(
        InMemorySessionRepository(),
        SessionPolicy(idle_timeout_seconds=300, absolute_timeout_seconds=900),
    )
    repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", manager)
    monkeypatch.setattr(futuristic_app, "IDENTITY_REPOSITORY", repository)
    monkeypatch.setattr(futuristic_app, "PRINCIPAL_RESOLVER", LocalDemoPrincipalResolver())
    return manager, repository


def credentials(manager, user_id=None):
    return manager.create_authenticated_session(user_id or uuid4(), "identity-http-test")


def request_for(manager, path, *, method, session=None, payload=None):
    body = json.dumps(payload if payload is not None else {}).encode("utf-8")
    response = {}
    errors = []
    headers = {"Content-Length": str(len(body))}
    if session is not None:
        headers["Cookie"] = f"{SESSION_COOKIE_NAME}={session.session_token}"
        csrf = manager.csrf_token(session.session.session_id)
        if csrf is not None:
            headers["X-CSRF-Token"] = csrf
    request = SimpleNamespace(
        path=path,
        headers=headers,
        rfile=io.BytesIO(body),
        send_error=lambda status, message: errors.append((status, message)),
        _send_json=lambda status, result: response.update(status=status, result=result),
        _send_json_with_headers=lambda status, result, extra_headers: response.update(
            status=status,
            result=result,
            headers=extra_headers,
        ),
    )
    if method == "GET":
        futuristic_app.PARMARRequestHandler.do_GET(request)
    else:
        futuristic_app.PARMARRequestHandler.do_POST(request)
    return response, errors


def test_profile_workspace_api_requires_authenticated_session(identity_api):
    manager, _repository = identity_api

    for path in ("/api/identity/profiles", "/api/identity/workspaces"):
        response, errors = request_for(manager, path, method="GET")
        assert response == {}
        assert errors == [(401, "An authenticated session is required")]

        response, errors = request_for(manager, path, method="POST", payload={"name": "Private"})
        assert response == {}
        assert errors == [(401, "An authenticated session is required")]


def test_api_isolates_profiles_and_workspaces_between_users(identity_api):
    manager, _repository = identity_api
    first_user = credentials(manager)
    second_user = credentials(manager)

    first_profile_response, errors = request_for(
        manager,
        "/api/identity/profiles",
        method="POST",
        session=first_user,
        payload={"name": "Private profile"},
    )
    assert errors == []
    assert first_profile_response["status"] == 201
    first_profile_id = first_profile_response["result"]["profile_id"]

    first_workspace_response, errors = request_for(
        manager,
        "/api/identity/workspaces",
        method="POST",
        session=first_user,
        payload={"name": "Private workspace"},
    )
    assert errors == []
    first_workspace_id = first_workspace_response["result"]["workspace_id"]

    second_profile_response, errors = request_for(
        manager,
        "/api/identity/profiles",
        method="POST",
        session=second_user,
        payload={"name": "Other profile"},
    )
    assert errors == []
    second_profile_id = second_profile_response["result"]["profile_id"]

    response, errors = request_for(
        manager,
        "/api/identity/profiles",
        method="GET",
        session=second_user,
    )
    assert errors == []
    assert [item["name"] for item in response["result"]["profiles"]] == ["Other profile"]

    response, errors = request_for(
        manager,
        f"/api/identity/workspaces/{first_workspace_id}/profiles",
        method="GET",
        session=second_user,
    )
    assert response == {}
    assert errors == [(404, "Workspace not found")]

    response, errors = request_for(
        manager,
        f"/api/identity/workspaces/{first_workspace_id}/profiles/{second_profile_id}",
        method="POST",
        session=second_user,
    )
    assert response == {}
    assert errors == [(404, "Workspace or profile not found")]

    response, errors = request_for(
        manager,
        f"/api/identity/workspaces/{first_workspace_id}/profiles/{first_profile_id}",
        method="POST",
        session=first_user,
    )
    assert errors == []
    assert response["result"] == {"shared": True}

    response, errors = request_for(
        manager,
        f"/api/identity/workspaces/{first_workspace_id}/profiles",
        method="GET",
        session=first_user,
    )
    assert errors == []
    assert [item["profile_id"] for item in response["result"]["profiles"]] == [first_profile_id]


def test_profile_create_rejects_client_supplied_owner(identity_api):
    manager, _repository = identity_api
    session = credentials(manager)

    response, errors = request_for(
        manager,
        "/api/identity/profiles",
        method="POST",
        session=session,
        payload={"name": "Forged", "owner_user_id": str(uuid4())},
    )

    assert response == {}
    assert errors == [(400, "Client-supplied identity is not accepted")]


def test_authenticated_session_can_switch_owned_profiles_and_rejects_foreign_profile(identity_api):
    manager, repository = identity_api
    owner_session = credentials(manager)
    other_session = credentials(manager)
    first_profile = repository.create_profile(owner_session.session.user_id, "First")
    second_profile = repository.create_profile(owner_session.session.user_id, "Second")
    foreign_profile = repository.create_profile(other_session.session.user_id, "Foreign")

    response, errors = request_for(
        manager,
        "/api/session/profile",
        method="POST",
        session=owner_session,
        payload={"profile_id": str(first_profile.profile_id)},
    )
    assert errors == []
    assert response["status"] == 200
    assert response["result"]["active_profile"]["profile_id"] == str(first_profile.profile_id)

    response, errors = request_for(manager, "/api/session", method="GET", session=owner_session)
    assert errors == []
    assert response["result"]["active_profile_id"] == str(first_profile.profile_id)

    response, errors = request_for(
        manager,
        "/api/session/profile",
        method="POST",
        session=owner_session,
        payload={"profile_id": str(second_profile.profile_id)},
    )
    assert errors == []
    assert response["result"]["active_profile"]["profile_id"] == str(second_profile.profile_id)

    response, errors = request_for(
        manager,
        "/api/session/profile",
        method="POST",
        session=owner_session,
        payload={"profile_id": str(foreign_profile.profile_id)},
    )
    assert response == {}
    assert errors == [(404, "Profile not found")]
    selected = manager.resolve(owner_session.session_token)
    assert selected.active_profile_id == second_profile.profile_id


def test_logout_clears_active_profile_from_server_session(identity_api):
    manager, repository = identity_api
    session = credentials(manager)
    profile = repository.create_profile(session.session.user_id, "Private")
    selected = manager.select_profile(
        session.session.session_id,
        session.session.user_id,
        profile.profile_id,
    )
    assert selected.active_profile_id == profile.profile_id

    response, errors = request_for(
        manager,
        "/api/logout",
        method="POST",
        session=session,
    )

    assert errors == []
    assert response["result"]["logged_out"] is True
    revoked = manager.repository.get_by_session_id(session.session.session_id)
    assert revoked.status == "REVOKED"
    assert revoked.active_profile_id is None
