from datetime import datetime, timedelta, timezone
from hashlib import sha256
from uuid import uuid4

import pytest

from PARMAR.sessions import (
    InMemorySessionRepository,
    SESSION_COOKIE_NAME,
    SessionManager,
    SessionPolicy,
    clear_session_cookie_header,
    session_cookie_header,
    session_manager_from_environment,
)

START = datetime(2026, 10, 3, tzinfo=timezone.utc)


def make_manager(*, idle=10, absolute=30, csrf_secret=b"c" * 32):
    repository = InMemorySessionRepository()
    return SessionManager(
        repository,
        SessionPolicy(idle_timeout_seconds=idle, absolute_timeout_seconds=absolute),
        csrf_secret=csrf_secret,
    ), repository


def test_session_creation_stores_only_token_hash_and_resolves_server_identity():
    manager, repository = make_manager()
    user_id = uuid4()
    credentials = manager.create_authenticated_session(user_id, "test-auth", now=START)
    token_hash = sha256(credentials.session_token.encode("ascii")).hexdigest()

    assert credentials.session.user_id == user_id
    assert repository.get_by_token_hash(token_hash) == credentials.session
    assert repository.get_by_token_hash(credentials.session_token) is None
    assert manager.resolve(credentials.session_token, now=START + timedelta(seconds=1)).user_id == user_id
    assert str(user_id) not in credentials.session_token
    assert credentials.session_token not in repr(credentials)
    assert set(credentials.session.__dataclass_fields__) == {
        "session_id", "user_id", "authentication_source", "created_at",
        "last_activity_at", "idle_expires_at", "absolute_expires_at",
        "status", "revoked_at", "replaced_by",
    }


def test_invalid_random_session_token_is_anonymous():
    manager, _repository = make_manager()

    assert manager.resolve("not-a-valid-session-token", now=START) is None


def test_idle_expiry_invalidates_session():
    manager, repository = make_manager(idle=5, absolute=30)
    credentials = manager.create_authenticated_session(uuid4(), "test-auth", now=START)

    assert manager.resolve(credentials.session_token, now=START + timedelta(seconds=5)) is None
    assert repository.get_by_session_id(credentials.session.session_id).status == "EXPIRED"


def test_activity_extends_idle_expiry_but_not_absolute_expiry():
    manager, _repository = make_manager(idle=10, absolute=20)
    credentials = manager.create_authenticated_session(uuid4(), "test-auth", now=START)

    active = manager.resolve(credentials.session_token, now=START + timedelta(seconds=9))
    assert active is not None
    assert active.idle_expires_at == START + timedelta(seconds=19)
    assert manager.resolve(credentials.session_token, now=START + timedelta(seconds=18)) is not None
    assert manager.resolve(credentials.session_token, now=START + timedelta(seconds=19)) is not None
    assert manager.resolve(credentials.session_token, now=START + timedelta(seconds=20)) is None


def test_revocation_and_logout_immediately_invalidate_session():
    manager, _repository = make_manager()
    credentials = manager.create_authenticated_session(uuid4(), "test-auth", now=START)

    assert manager.logout(credentials.session_token, now=START + timedelta(seconds=1)) is True
    assert manager.resolve(credentials.session_token, now=START + timedelta(seconds=1)) is None


def test_rotation_revokes_old_token_and_preserves_user_and_absolute_expiry():
    manager, repository = make_manager(idle=10, absolute=30)
    credentials = manager.create_authenticated_session(uuid4(), "test-auth", now=START)

    rotated = manager.rotate(credentials.session_token, now=START + timedelta(seconds=2))

    assert rotated is not None
    assert rotated.session.user_id == credentials.session.user_id
    assert rotated.session.session_id != credentials.session.session_id
    assert rotated.session.absolute_expires_at == credentials.session.absolute_expires_at
    assert manager.resolve(credentials.session_token, now=START + timedelta(seconds=2)) is None
    assert manager.resolve(rotated.session_token, now=START + timedelta(seconds=2)) is not None
    old_record = repository.get_by_session_id(credentials.session.session_id)
    assert old_record.status == "REVOKED"
    assert old_record.replaced_by == rotated.session.session_id


def test_csrf_token_is_bound_to_active_session_and_not_an_authenticator():
    manager, _repository = make_manager(csrf_secret=b"k" * 32)
    credentials = manager.create_authenticated_session(uuid4(), "test-auth", now=START)
    csrf_token = manager.csrf_token(credentials.session.session_id, now=START)

    assert csrf_token
    assert manager.validate_csrf(credentials.session.session_id, csrf_token, now=START)
    assert not manager.validate_csrf(uuid4(), csrf_token, now=START)
    assert manager.resolve("forged-cookie-value-that-is-not-a-session", now=START) is None
    assert manager.validate_csrf(credentials.session.session_id, "invalid", now=START) is False


def test_cookie_headers_are_host_scoped_secure_and_cleared_on_logout():
    manager, _repository = make_manager()
    credentials = manager.create_authenticated_session(uuid4(), "test-auth", now=START)
    header = session_cookie_header(credentials.session_token)
    cleared = clear_session_cookie_header()

    assert header.startswith(f"{SESSION_COOKIE_NAME}=")
    assert "Path=/" in header
    assert "HttpOnly" in header
    assert "Secure" in header
    assert "SameSite=Lax" in header
    assert "Domain=" not in header
    assert credentials.session_token in header
    assert credentials.session_token not in repr({"authenticated": True})
    assert "Max-Age=0" in cleared
    assert "Secure" in cleared
    with pytest.raises(ValueError):
        session_cookie_header("A" * 30 + ";\r\nSet-Cookie: forged=1")


def test_session_timeouts_must_be_explicit_and_valid(monkeypatch):
    assert session_manager_from_environment({}) is None
    with pytest.raises(ValueError):
        session_manager_from_environment({"PARMAR_SESSION_IDLE_SECONDS": "10"})
    with pytest.raises(ValueError):
        SessionPolicy(idle_timeout_seconds=0, absolute_timeout_seconds=20)

    manager = session_manager_from_environment({
        "PARMAR_SESSION_IDLE_SECONDS": "10",
        "PARMAR_SESSION_ABSOLUTE_SECONDS": "20",
    })
    assert manager is not None
    assert manager.policy.idle_timeout_seconds == 10
    assert manager.policy.absolute_timeout_seconds == 20