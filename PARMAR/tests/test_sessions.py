import sqlite3
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
from uuid import uuid4

import pytest

from PARMAR.sessions import (
    InMemorySessionRepository,
    SESSION_COOKIE_NAME,
    SessionManager,
    SessionPolicy,
    SessionStorageUnavailable,
    SQLiteSessionRepository,
    clear_session_cookie_header,
    session_cookie_header,
    session_manager_from_environment,
)

START = datetime(2026, 10, 3, tzinfo=timezone.utc)
SESSION_STORE_KEY = b"test-only-session-store-integrity-key"


def sqlite_repository(path, integrity_key=SESSION_STORE_KEY):
    return SQLiteSessionRepository(path, integrity_key=integrity_key)


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
        session_manager_from_environment({
            "PARMAR_SESSION_IDLE_SECONDS": "10",
            "PARMAR_SESSION_ABSOLUTE_SECONDS": "20",
        })
    with pytest.raises(ValueError):
        SessionPolicy(idle_timeout_seconds=0, absolute_timeout_seconds=20)

    manager = session_manager_from_environment({
        "PARMAR_SESSION_IDLE_SECONDS": "10",
        "PARMAR_SESSION_ABSOLUTE_SECONDS": "20",
        "PARMAR_SESSION_STORE_KEY": SESSION_STORE_KEY.decode("ascii"),
    })
    assert manager is not None
    assert manager.policy.idle_timeout_seconds == 10
    assert manager.policy.absolute_timeout_seconds == 20


def test_sqlite_session_is_resolved_after_repository_and_manager_restart(tmp_path):
    database_path = tmp_path / "private" / "sessions.sqlite3"
    user_id = uuid4()
    first_repository = sqlite_repository(database_path)
    first_manager = SessionManager(
        first_repository,
        SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30),
    )
    credentials = first_manager.create_authenticated_session(user_id, "trusted-test-auth", now=START)
    token_hash = sha256(credentials.session_token.encode("ascii")).hexdigest()

    restarted_manager = SessionManager(
        sqlite_repository(database_path),
        SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30),
    )
    restored = restarted_manager.resolve(
        credentials.session_token,
        now=START + timedelta(seconds=1),
    )

    assert restored is not None
    assert restored.user_id == user_id
    assert restored.session_id == credentials.session.session_id
    assert restored.authentication_source == "trusted-test-auth"
    assert credentials.session_token.encode("ascii") not in database_path.read_bytes()
    assert token_hash.encode("ascii") in database_path.read_bytes()
    assert database_path.stat().st_mode & 0o777 == 0o600
    assert database_path.parent.stat().st_mode & 0o077 == 0
    wrong_key_manager = SessionManager(
        sqlite_repository(database_path, integrity_key=b"x" * 32),
        SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30),
    )
    with pytest.raises(SessionStorageUnavailable):
        wrong_key_manager.resolve(credentials.session_token, now=START + timedelta(seconds=2))


def test_sqlite_session_enforces_idle_and_absolute_expiry_after_restart(tmp_path):
    database_path = tmp_path / "sessions.sqlite3"
    manager = SessionManager(
        sqlite_repository(database_path),
        SessionPolicy(idle_timeout_seconds=5, absolute_timeout_seconds=20),
    )
    credentials = manager.create_authenticated_session(uuid4(), "trusted-test-auth", now=START)

    idle_restart = SessionManager(
        sqlite_repository(database_path),
        SessionPolicy(idle_timeout_seconds=5, absolute_timeout_seconds=20),
    )
    assert idle_restart.resolve(
        credentials.session_token,
        now=START + timedelta(seconds=5),
    ) is None
    assert idle_restart.repository.get_by_session_id(credentials.session.session_id).status == "EXPIRED"

    absolute_database_path = tmp_path / "absolute.sqlite3"
    absolute_manager = SessionManager(
        sqlite_repository(absolute_database_path),
        SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=20),
    )
    absolute_credentials = absolute_manager.create_authenticated_session(
        uuid4(),
        "trusted-test-auth",
        now=START,
    )
    for elapsed in (9, 18):
        assert SessionManager(
            sqlite_repository(absolute_database_path),
            SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=20),
        ).resolve(absolute_credentials.session_token, now=START + timedelta(seconds=elapsed)) is not None
    restarted = SessionManager(
        sqlite_repository(absolute_database_path),
        SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=20),
    )
    assert restarted.resolve(
        absolute_credentials.session_token,
        now=START + timedelta(seconds=20),
    ) is None


def test_sqlite_session_rejects_tampered_unknown_and_revoked_tokens_after_restart(tmp_path):
    database_path = tmp_path / "sessions.sqlite3"
    manager = SessionManager(
        sqlite_repository(database_path),
        SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30),
    )
    credentials = manager.create_authenticated_session(uuid4(), "trusted-test-auth", now=START)
    assert manager.logout(credentials.session_token, now=START + timedelta(seconds=1)) is True

    restarted = SessionManager(
        sqlite_repository(database_path),
        SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30),
    )
    assert restarted.resolve(credentials.session_token, now=START + timedelta(seconds=2)) is None
    assert restarted.resolve("A" * 43, now=START + timedelta(seconds=2)) is None
    assert restarted.resolve("not-a-token", now=START + timedelta(seconds=2)) is None


def test_sqlite_session_rotation_survives_restart_and_revokes_old_token(tmp_path):
    database_path = tmp_path / "sessions.sqlite3"
    manager = SessionManager(
        sqlite_repository(database_path),
        SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30),
    )
    credentials = manager.create_authenticated_session(uuid4(), "trusted-test-auth", now=START)

    rotated = manager.rotate(credentials.session_token, now=START + timedelta(seconds=2))
    assert rotated is not None

    restarted = SessionManager(
        sqlite_repository(database_path),
        SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30),
    )
    assert restarted.resolve(credentials.session_token, now=START + timedelta(seconds=3)) is None
    restored_replacement = restarted.resolve(rotated.session_token, now=START + timedelta(seconds=3))
    assert restored_replacement is not None
    assert restored_replacement.user_id == credentials.session.user_id
    assert restored_replacement.absolute_expires_at == credentials.session.absolute_expires_at


def test_sqlite_session_storage_fails_closed_for_corrupt_missing_or_incompatible_store(tmp_path):
    corrupt_path = tmp_path / "corrupt.sqlite3"
    corrupt_path.write_bytes(b"not sqlite")
    with pytest.raises(SessionStorageUnavailable):
        sqlite_repository(corrupt_path).get_by_session_id(uuid4())

    missing_path = tmp_path / "missing.sqlite3"
    missing_repository = sqlite_repository(missing_path)
    missing_manager = SessionManager(
        missing_repository,
        SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30),
    )
    credentials = missing_manager.create_authenticated_session(uuid4(), "trusted-test-auth", now=START)
    missing_path.unlink()
    with pytest.raises(SessionStorageUnavailable):
        missing_manager.resolve(credentials.session_token, now=START + timedelta(seconds=1))
    assert not missing_path.exists()

    incompatible_path = tmp_path / "incompatible.sqlite3"
    sqlite_repository(incompatible_path).get_by_session_id(uuid4())
    with sqlite3.connect(incompatible_path) as connection:
        connection.execute("PRAGMA user_version = 999")
    with pytest.raises(SessionStorageUnavailable):
        sqlite_repository(incompatible_path).get_by_session_id(uuid4())


def test_sqlite_session_rejects_malformed_persisted_identity_after_tampering(tmp_path):
    database_path = tmp_path / "tampered.sqlite3"
    manager = SessionManager(
        sqlite_repository(database_path),
        SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30),
    )
    credentials = manager.create_authenticated_session(uuid4(), "trusted-test-auth", now=START)

    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "UPDATE sessions SET user_id = ? WHERE session_id = ?",
            (str(uuid4()), str(credentials.session.session_id)),
        )

    restarted = SessionManager(
        sqlite_repository(database_path),
        SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30),
    )
    with pytest.raises(SessionStorageUnavailable):
        restarted.resolve(credentials.session_token, now=START + timedelta(seconds=1))


def test_session_manager_configuration_selects_persistent_repository(tmp_path):
    database_path = tmp_path / "configured-sessions.sqlite3"
    manager = session_manager_from_environment({
        "PARMAR_SESSION_IDLE_SECONDS": "10",
        "PARMAR_SESSION_ABSOLUTE_SECONDS": "20",
        "PARMAR_SESSION_DB_PATH": str(database_path),
        "PARMAR_SESSION_STORE_KEY": SESSION_STORE_KEY.decode("ascii"),
    })

    assert manager is not None
    assert isinstance(manager.repository, SQLiteSessionRepository)
    assert manager.repository.database_path == Path(database_path)

    with pytest.raises(ValueError):
        session_manager_from_environment({
            "PARMAR_SESSION_IDLE_SECONDS": "10",
            "PARMAR_SESSION_ABSOLUTE_SECONDS": "20",
            "PARMAR_SESSION_DB_PATH": "",
            "PARMAR_SESSION_STORE_KEY": SESSION_STORE_KEY.decode("ascii"),
        })