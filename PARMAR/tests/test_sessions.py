import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from PARMAR.identity import (
    Principal,
    ProviderBoundIdentityResolver,
    TRUSTED_IDENTITY_SOURCE,
)
from PARMAR.identity_contracts import (
    AccountIdentity,
    AuthenticationContext,
    AuthenticatedPrincipal,
    IdentityEvidenceState,
    ProviderIdentity,
    VerifiedProviderIdentity,
)
from PARMAR.identity_store import SQLiteIdentityRepository, TrustedInternalAccountProvisioner
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
        account_status_lookup=lambda _identity: True,
    ), repository


def fixed_identity_resolver(account_identity, authentication):
    class Resolver:
        def resolve(self, _evidence, *, now=None):
            del now
            return AuthenticatedPrincipal(account_identity, authentication)

    return Resolver()


def create_persisted_identity_session(
    identity_repository,
    session_database_path,
    *,
    account=None,
    account_status_lookup=None,
):
    account = account or TrustedInternalAccountProvisioner(identity_repository).provision_account()
    session_repository = sqlite_repository(session_database_path)
    manager = SessionManager(
        session_repository,
        SessionPolicy(idle_timeout_seconds=60, absolute_timeout_seconds=300),
        account_status_lookup=account_status_lookup or identity_repository.is_account_active,
    )
    authentication = AuthenticationContext(
        START,
        START + timedelta(minutes=5),
    )
    credentials = manager.create_identity_session(
        fixed_identity_resolver(account.account_identity, authentication),
        "verified-test-evidence",
        now=START,
    )
    assert credentials is not None
    return manager, credentials, account


def disable_persisted_account(identity_repository, account):
    with sqlite3.connect(identity_repository.database_path) as connection:
        cursor = connection.execute(
            "UPDATE accounts SET status = 'DISABLED' WHERE account_id = ?",
            (account.account_identity.serialize(),),
        )
        assert cursor.rowcount == 1


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
        "status", "revoked_at", "replaced_by", "active_profile_id",
        "account_identity", "authentication_context", "identity_evidence_id",
    }


def test_identity_session_is_revoked_when_post_creation_account_check_fails():
    repository = InMemorySessionRepository()
    account_identity = AccountIdentity.generate()
    authentication = AuthenticationContext(
        START,
        START + timedelta(minutes=5),
    )
    status_checks = 0

    def account_status(_account_identity):
        nonlocal status_checks
        status_checks += 1
        if status_checks == 1:
            return True
        raise OSError("identity store unavailable")

    manager = SessionManager(
        repository,
        SessionPolicy(idle_timeout_seconds=60, absolute_timeout_seconds=300),
        account_status_lookup=account_status,
    )

    with pytest.raises(SessionStorageUnavailable):
        manager.create_identity_session(
            fixed_identity_resolver(account_identity, authentication),
            "verified-test-evidence",
            now=START,
        )

    sessions = list(repository._sessions.values())
    assert len(sessions) == 1
    assert sessions[0].status == "REVOKED"
    assert repository.get_identity_evidence_state(authentication.evidence_id) is IdentityEvidenceState.REVOKED


def test_invalid_random_session_token_is_anonymous():
    manager, _repository = make_manager()

    assert manager.resolve("not-a-valid-session-token", now=START) is None


def test_idle_expiry_invalidates_session():
    manager, repository = make_manager(idle=5, absolute=30)
    user_id = uuid4()
    credentials = manager.create_authenticated_session(user_id, "test-auth", now=START)
    profile_id = uuid4()
    selected = manager.select_profile(
        credentials.session.session_id,
        user_id,
        profile_id,
        now=START,
    )
    assert selected is not None
    assert selected.active_profile_id == profile_id

    assert manager.resolve(credentials.session_token, now=START + timedelta(seconds=5)) is None
    expired = repository.get_by_session_id(credentials.session.session_id)
    assert expired.status == "EXPIRED"
    assert expired.active_profile_id is None


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


def test_active_profile_is_bound_to_session_owner_and_cleared_on_logout():
    manager, repository = make_manager()
    user_id = uuid4()
    credentials = manager.create_authenticated_session(user_id, "test-auth", now=START)
    profile_id = uuid4()

    assert manager.select_profile(
        credentials.session.session_id,
        uuid4(),
        profile_id,
        now=START,
    ) is None
    selected = manager.select_profile(
        credentials.session.session_id,
        user_id,
        profile_id,
        now=START,
    )
    assert selected is not None
    assert selected.active_profile_id == profile_id

    assert manager.logout(credentials.session_token, now=START + timedelta(seconds=1)) is True
    revoked = repository.get_by_session_id(credentials.session.session_id)
    assert revoked.status == "REVOKED"
    assert revoked.active_profile_id is None


def test_sqlite_active_profile_persists_and_logout_clears_profile_context(tmp_path):
    database_path = tmp_path / "sessions.sqlite3"
    policy = SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30)
    manager = SessionManager(sqlite_repository(database_path), policy)
    user_id = uuid4()
    profile_id = uuid4()
    credentials = manager.create_authenticated_session(user_id, "trusted-test-auth", now=START)

    selected = manager.select_profile(
        credentials.session.session_id,
        user_id,
        profile_id,
        now=START,
    )
    assert selected is not None and selected.active_profile_id == profile_id
    restarted = SessionManager(
        sqlite_repository(database_path),
        policy,
        account_status_lookup=lambda _identity: True,
    )
    assert restarted.resolve(credentials.session_token, now=START + timedelta(seconds=1)).active_profile_id == profile_id

    assert restarted.logout(credentials.session_token, now=START + timedelta(seconds=2)) is True
    revoked = restarted.repository.get_by_session_id(credentials.session.session_id)
    assert revoked.active_profile_id is None


def test_sqlite_session_migrates_v1_without_invalidating_existing_session(tmp_path):
    database_path = tmp_path / "legacy-sessions.sqlite3"
    policy = SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30)
    manager = SessionManager(sqlite_repository(database_path), policy)
    credentials = manager.create_authenticated_session(uuid4(), "trusted-test-auth", now=START)
    with sqlite3.connect(database_path) as connection:
        connection.execute("ALTER TABLE sessions DROP COLUMN active_profile_id")
        connection.execute("ALTER TABLE sessions DROP COLUMN identity_expires_at")
        connection.execute("ALTER TABLE sessions DROP COLUMN identity_authenticated_at")
        connection.execute("ALTER TABLE sessions DROP COLUMN account_identity")
        connection.execute("ALTER TABLE sessions DROP COLUMN identity_evidence_id")
        connection.execute("DROP TABLE identity_evidence")
        connection.execute("PRAGMA user_version = 1")

    migrated = SessionManager(sqlite_repository(database_path), policy)
    restored = migrated.resolve(credentials.session_token, now=START + timedelta(seconds=1))

    assert restored is not None
    assert restored.active_profile_id is None
    with sqlite3.connect(database_path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 4
        assert "active_profile_id" in {
            row[1] for row in connection.execute("PRAGMA table_info(sessions)")
        }
        assert "account_identity" in {
            row[1] for row in connection.execute("PRAGMA table_info(sessions)")
        }


def test_sqlite_session_migrates_v2_as_unmapped_and_preserves_profile_context(tmp_path):
    database_path = tmp_path / "v2-sessions.sqlite3"
    policy = SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30)
    manager = SessionManager(sqlite_repository(database_path), policy)
    user_id = uuid4()
    credentials = manager.create_authenticated_session(user_id, "legacy-test-auth", now=START)
    profile_id = uuid4()
    assert manager.select_profile(
        credentials.session.session_id,
        user_id,
        profile_id,
        now=START,
    ) is not None
    with sqlite3.connect(database_path) as connection:
        connection.execute("ALTER TABLE sessions DROP COLUMN identity_expires_at")
        connection.execute("ALTER TABLE sessions DROP COLUMN identity_authenticated_at")
        connection.execute("ALTER TABLE sessions DROP COLUMN account_identity")
        connection.execute("ALTER TABLE sessions DROP COLUMN identity_evidence_id")
        connection.execute("DROP TABLE identity_evidence")
        connection.execute("PRAGMA user_version = 2")

    restarted = SessionManager(
        sqlite_repository(database_path),
        policy,
        account_status_lookup=lambda _identity: True,
    )
    restored = restarted.resolve(credentials.session_token, now=START + timedelta(seconds=1))

    assert restored is not None
    assert restored.account_identity is None
    assert restored.authentication_context is None
    assert restored.active_profile_id == profile_id
    with sqlite3.connect(database_path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 4


def test_trusted_identity_session_is_resolved_and_persisted_without_client_identity(tmp_path):
    database_path = tmp_path / "identity-sessions.sqlite3"
    account = AccountIdentity.generate()
    provider = ProviderIdentity("issuer", "subject-1")
    authentication = AuthenticationContext(START, START + timedelta(minutes=5))

    class Adapter:
        def verify(self, evidence):
            if evidence != "verified-provider-proof":
                return None
            return VerifiedProviderIdentity(provider, authentication)

    class Bindings:
        def find_existing_account(self, identity):
            return account if identity == provider else None

    resolver = ProviderBoundIdentityResolver(Adapter(), Bindings())
    policy = SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30)
    manager = SessionManager(
        sqlite_repository(database_path),
        policy,
        account_status_lookup=lambda _identity: True,
    )
    credentials = manager.create_identity_session(
        resolver,
        "verified-provider-proof",
        now=START + timedelta(seconds=1),
    )

    assert credentials is not None
    assert credentials.session.user_id == account.value
    assert credentials.session.authentication_source == TRUSTED_IDENTITY_SOURCE
    assert credentials.session.account_identity == account
    resolved = manager.resolve_identity(
        credentials.session_token,
        now=START + timedelta(seconds=2),
    )
    assert resolved == AuthenticatedPrincipal(account, authentication)
    assert manager.identity_evidence_state(authentication.evidence_id) is IdentityEvidenceState.ACTIVE

    restarted = SessionManager(
        sqlite_repository(database_path),
        policy,
        account_status_lookup=lambda _identity: True,
    )
    assert restarted.resolve_identity(
        credentials.session_token,
        now=START + timedelta(seconds=3),
    ) == AuthenticatedPrincipal(account, authentication)
    rotated = restarted.rotate(
        credentials.session_token,
        now=START + timedelta(seconds=4),
    )
    assert rotated is not None
    after_rotation_restart = SessionManager(
        sqlite_repository(database_path),
        policy,
        account_status_lookup=lambda _identity: True,
    )
    assert after_rotation_restart.resolve_identity(
        rotated.session_token,
        now=START + timedelta(seconds=5),
    ) == AuthenticatedPrincipal(account, authentication)
    assert after_rotation_restart.resolve_identity(
        rotated.session_token,
        now=START + timedelta(minutes=5),
    ) is None
    assert after_rotation_restart.identity_evidence_state(
        authentication.evidence_id,
    ) is IdentityEvidenceState.EXPIRED


def test_sqlite_session_identity_binding_rejects_database_substitution(tmp_path):
    database_path = tmp_path / "substituted-identity.sqlite3"
    account = AccountIdentity.generate()

    class Resolver:
        def resolve(self, _evidence, *, now=None):
            current = now or START
            return AuthenticatedPrincipal(
                account,
                AuthenticationContext(current, current + timedelta(minutes=5)),
            )

    manager = SessionManager(
        sqlite_repository(database_path),
        SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30),
        account_status_lookup=lambda _identity: True,
    )
    credentials = manager.create_identity_session(Resolver(), "evidence", now=START)
    assert credentials is not None
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "UPDATE sessions SET account_identity = ? WHERE session_id = ?",
            (AccountIdentity.generate().serialize(), str(credentials.session.session_id)),
        )

    with pytest.raises(SessionStorageUnavailable):
        SessionManager(
            sqlite_repository(database_path),
            SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30),
        ).resolve_identity(credentials.session_token, now=START + timedelta(seconds=1))


def test_v3_trusted_session_without_evidence_record_migrates_as_revoked(tmp_path):
    database_path = tmp_path / "v3-identity-session.sqlite3"
    policy = SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30)
    account = AccountIdentity.generate()
    authentication = AuthenticationContext(START, START + timedelta(minutes=5))
    manager = SessionManager(
        sqlite_repository(database_path),
        policy,
        account_status_lookup=lambda _identity: True,
    )
    credentials = manager.create_identity_session(
        fixed_identity_resolver(account, authentication),
        "proof",
        now=START,
    )
    assert credentials is not None
    token_hash = sha256(credentials.session_token.encode("ascii")).hexdigest()
    legacy_session = replace(credentials.session, identity_evidence_id=None)
    legacy_tag = SQLiteSessionRepository._session_integrity_tag(
        legacy_session,
        token_hash,
        SESSION_STORE_KEY,
    )
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "UPDATE sessions SET identity_evidence_id = NULL, integrity_tag = ? WHERE session_id = ?",
            (legacy_tag, str(credentials.session.session_id)),
        )
        connection.execute("DROP TABLE identity_evidence")
        connection.execute("ALTER TABLE sessions DROP COLUMN identity_evidence_id")
        connection.execute("PRAGMA user_version = 3")

    restarted = SessionManager(
        sqlite_repository(database_path),
        policy,
        account_status_lookup=lambda _identity: True,
    )
    assert restarted.resolve(credentials.session_token, now=START + timedelta(seconds=1)) is None
    migrated = restarted.repository.get_by_session_id(credentials.session.session_id)
    assert migrated.status == "REVOKED"


def test_tampered_identity_evidence_lifecycle_fails_closed(tmp_path):
    database_path = tmp_path / "tampered-evidence.sqlite3"
    policy = SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30)
    account = AccountIdentity.generate()
    authentication = AuthenticationContext(START, START + timedelta(minutes=5))
    manager = SessionManager(
        sqlite_repository(database_path),
        policy,
        account_status_lookup=lambda _identity: True,
    )
    credentials = manager.create_identity_session(
        fixed_identity_resolver(account, authentication),
        "proof",
        now=START,
    )
    assert credentials is not None
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "UPDATE identity_evidence SET state = 'REVOKED' WHERE evidence_id = ?",
            (str(authentication.evidence_id),),
        )

    with pytest.raises(SessionStorageUnavailable):
        SessionManager(sqlite_repository(database_path), policy).resolve(
            credentials.session_token,
            now=START + timedelta(seconds=1),
        )


def test_trusted_identity_survives_session_rotation_without_substitution():
    manager, _repository = make_manager(absolute=30)
    account = AccountIdentity.generate()

    class Resolver:
        def resolve(self, _evidence, *, now=None):
            current = now or START
            return AuthenticatedPrincipal(
                account,
                AuthenticationContext(current, current + timedelta(minutes=5)),
            )

    credentials = manager.create_identity_session(Resolver(), "evidence", now=START)
    assert credentials is not None
    rotated = manager.rotate(
        credentials.session_token,
        now=START + timedelta(seconds=1),
    )

    assert rotated is not None
    assert rotated.session.account_identity == account
    assert rotated.session.authentication_context == credentials.session.authentication_context
    assert manager.resolve_identity(
        credentials.session_token,
        now=START + timedelta(seconds=2),
    ) is None
    assert manager.resolve_identity(
        rotated.session_token,
        now=START + timedelta(seconds=2),
    ) == AuthenticatedPrincipal(
        account,
        credentials.session.authentication_context,
    )
    assert manager.identity_evidence_state(
        credentials.session.identity_evidence_id,
    ) is IdentityEvidenceState.ACTIVE


def test_identity_evidence_replay_and_cross_account_reuse_are_denied():
    manager, _repository = make_manager()
    authentication = AuthenticationContext(START, START + timedelta(minutes=5))
    first_account = AccountIdentity.generate()
    first_resolver = fixed_identity_resolver(first_account, authentication)

    credentials = manager.create_identity_session(first_resolver, "proof", now=START)
    assert credentials is not None
    assert manager.create_identity_session(first_resolver, "proof", now=START) is None
    assert manager.create_identity_session(
        fixed_identity_resolver(AccountIdentity.generate(), authentication),
        "proof",
        now=START,
    ) is None
    assert manager.resolve_identity(credentials.session_token, now=START) == AuthenticatedPrincipal(
        first_account,
        authentication,
    )
    assert manager.identity_evidence_state(authentication.evidence_id) is IdentityEvidenceState.ACTIVE


def test_session_and_evidence_revocation_are_atomic_and_persisted(tmp_path):
    database_path = tmp_path / "revoked-evidence.sqlite3"
    policy = SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30)
    account = AccountIdentity.generate()
    authentication = AuthenticationContext(START, START + timedelta(minutes=5))
    manager = SessionManager(
        sqlite_repository(database_path),
        policy,
        account_status_lookup=lambda _identity: True,
    )
    credentials = manager.create_identity_session(
        fixed_identity_resolver(account, authentication),
        "proof",
        now=START,
    )
    assert credentials is not None
    assert manager.revoke_identity_evidence(
        authentication.evidence_id,
        now=START + timedelta(seconds=1),
    )

    revoked = manager.repository.get_by_session_id(credentials.session.session_id)
    assert revoked.status == "REVOKED"
    assert revoked.active_profile_id is None
    assert manager.identity_evidence_state(authentication.evidence_id) is IdentityEvidenceState.REVOKED
    assert manager.resolve(credentials.session_token, now=START + timedelta(seconds=2)) is None
    assert manager.rotate(credentials.session_token, now=START + timedelta(seconds=2)) is None
    assert manager.create_identity_session(
        fixed_identity_resolver(account, authentication),
        "replayed-proof",
        now=START + timedelta(seconds=2),
    ) is None

    restarted = SessionManager(
        sqlite_repository(database_path),
        policy,
        account_status_lookup=lambda _identity: True,
    )
    assert restarted.resolve(credentials.session_token, now=START + timedelta(seconds=3)) is None
    assert restarted.identity_evidence_state(authentication.evidence_id) is IdentityEvidenceState.REVOKED
    assert restarted.create_identity_session(
        fixed_identity_resolver(account, authentication),
        "replayed-after-restart",
        now=START + timedelta(seconds=3),
    ) is None


def test_disabled_account_revokes_existing_persistent_session_and_survives_restart(tmp_path):
    identity_repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    manager, credentials, account = create_persisted_identity_session(
        identity_repository,
        tmp_path / "sessions.sqlite3",
    )
    evidence_id = credentials.session.identity_evidence_id
    assert evidence_id is not None

    disable_persisted_account(identity_repository, account)

    assert manager.resolve_identity(credentials.session_token, now=START) is None
    persisted = manager.repository.get_by_session_id(credentials.session.session_id)
    assert persisted is not None
    assert persisted.status == "REVOKED"
    assert persisted.active_profile_id is None
    assert manager.identity_evidence_state(evidence_id) is IdentityEvidenceState.REVOKED
    assert manager.csrf_token(credentials.session.session_id, now=START) is None

    restarted = SessionManager(
        sqlite_repository(tmp_path / "sessions.sqlite3"),
        manager.policy,
        account_status_lookup=identity_repository.is_account_active,
    )
    assert restarted.resolve(credentials.session_token, now=START) is None
    assert restarted.rotate(credentials.session_token, now=START) is None


def test_account_disable_revokes_all_devices_without_affecting_other_accounts(tmp_path):
    identity_repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    session_database_path = tmp_path / "sessions.sqlite3"
    manager, first_device, account = create_persisted_identity_session(
        identity_repository,
        session_database_path,
    )
    second_device = manager.create_identity_session(
        fixed_identity_resolver(
            account.account_identity,
            AuthenticationContext(START, START + timedelta(minutes=5)),
        ),
        "second-device-evidence",
        now=START,
    )
    other_identity = TrustedInternalAccountProvisioner(identity_repository).provision_account()
    other_device = manager.create_identity_session(
        fixed_identity_resolver(
            other_identity.account_identity,
            AuthenticationContext(START, START + timedelta(minutes=5)),
        ),
        "other-account-evidence",
        now=START,
    )
    assert second_device is not None and other_device is not None

    disable_persisted_account(identity_repository, account)

    assert manager.resolve(first_device.session_token, now=START) is None
    assert manager.resolve(second_device.session_token, now=START) is None
    assert manager.resolve(other_device.session_token, now=START) is not None
    assert (
        manager.repository.get_by_session_id(other_device.session.session_id).status
        == "ACTIVE"
    )


def test_disablement_during_session_resolution_denies_request_and_revokes_session(tmp_path):
    identity_repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    _, credentials, account = create_persisted_identity_session(
        identity_repository,
        tmp_path / "sessions.sqlite3",
    )
    first_status_check = threading.Event()
    account_disabled = threading.Event()
    lookup_count = 0
    lookup_lock = threading.Lock()

    def synchronized_status_lookup(identity):
        nonlocal lookup_count
        with lookup_lock:
            lookup_count += 1
            current_lookup = lookup_count
        is_active = identity_repository.is_account_active(identity)
        if current_lookup == 1:
            first_status_check.set()
            assert account_disabled.wait(timeout=5)
        return is_active

    manager = SessionManager(
        sqlite_repository(tmp_path / "sessions.sqlite3"),
        SessionPolicy(idle_timeout_seconds=60, absolute_timeout_seconds=300),
        account_status_lookup=synchronized_status_lookup,
    )
    with ThreadPoolExecutor(max_workers=1) as executor:
        resolving = executor.submit(
            manager.resolve,
            credentials.session_token,
            now=START,
        )
        assert first_status_check.wait(timeout=5)
        disable_persisted_account(identity_repository, account)
        account_disabled.set()
        assert resolving.result(timeout=5) is None

    persisted = manager.repository.get_by_session_id(credentials.session.session_id)
    assert persisted is not None and persisted.status == "REVOKED"


def test_trusted_session_resolution_fails_closed_when_account_status_is_unavailable(tmp_path):
    identity_repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    _, credentials, _account = create_persisted_identity_session(
        identity_repository,
        tmp_path / "sessions.sqlite3",
    )

    def unavailable_status(_identity):
        raise OSError("identity store unavailable")

    manager = SessionManager(
        sqlite_repository(tmp_path / "sessions.sqlite3"),
        SessionPolicy(idle_timeout_seconds=60, absolute_timeout_seconds=300),
        account_status_lookup=unavailable_status,
    )
    with pytest.raises(SessionStorageUnavailable):
        manager.resolve(credentials.session_token, now=START)


def test_session_revocation_revokes_evidence_and_superseded_evidence_cannot_rotate():
    manager, repository = make_manager()
    account = AccountIdentity.generate()
    authentication = AuthenticationContext(START, START + timedelta(minutes=5))
    credentials = manager.create_identity_session(
        fixed_identity_resolver(account, authentication),
        "proof",
        now=START,
    )
    assert credentials is not None
    assert manager.revoke(credentials.session.session_id, now=START + timedelta(seconds=1))
    assert manager.identity_evidence_state(authentication.evidence_id) is IdentityEvidenceState.REVOKED
    assert manager.resolve(credentials.session_token, now=START + timedelta(seconds=2)) is None

    second_evidence = AuthenticationContext(START, START + timedelta(minutes=5))
    second_credentials = manager.create_identity_session(
        fixed_identity_resolver(account, second_evidence),
        "fresh-proof",
        now=START,
    )
    assert second_credentials is not None
    assert manager.supersede_identity_evidence(
        second_evidence.evidence_id,
        now=START + timedelta(seconds=1),
    )
    assert manager.identity_evidence_state(second_evidence.evidence_id) is IdentityEvidenceState.SUPERSEDED
    assert repository.get_by_session_id(second_credentials.session.session_id).status == "REVOKED"
    assert manager.rotate(
        second_credentials.session_token,
        now=START + timedelta(seconds=2),
    ) is None


def test_expired_evidence_is_terminal_after_restart_and_rotation_fails(tmp_path):
    database_path = tmp_path / "expired-evidence.sqlite3"
    policy = SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30)
    account = AccountIdentity.generate()
    authentication = AuthenticationContext(START, START + timedelta(seconds=5))
    manager = SessionManager(
        sqlite_repository(database_path),
        policy,
        account_status_lookup=lambda _identity: True,
    )
    credentials = manager.create_identity_session(
        fixed_identity_resolver(account, authentication),
        "proof",
        now=START,
    )
    assert credentials is not None

    assert manager.rotate(
        credentials.session_token,
        now=START + timedelta(seconds=5),
    ) is None
    assert manager.identity_evidence_state(authentication.evidence_id) is IdentityEvidenceState.EXPIRED
    assert manager.repository.get_by_session_id(credentials.session.session_id).status == "EXPIRED"

    restarted = SessionManager(sqlite_repository(database_path), policy)
    assert restarted.resolve(credentials.session_token, now=START + timedelta(seconds=6)) is None
    assert restarted.identity_evidence_state(authentication.evidence_id) is IdentityEvidenceState.EXPIRED


def test_concurrent_evidence_revocation_and_rotation_leave_no_active_session(tmp_path):
    database_path = tmp_path / "concurrent-revocation.sqlite3"
    policy = SessionPolicy(idle_timeout_seconds=10, absolute_timeout_seconds=30)
    account = AccountIdentity.generate()
    authentication = AuthenticationContext(START, START + timedelta(minutes=5))
    manager = SessionManager(
        sqlite_repository(database_path),
        policy,
        account_status_lookup=lambda _identity: True,
    )
    revoker = SessionManager(
        sqlite_repository(database_path),
        policy,
        account_status_lookup=lambda _identity: True,
    )
    credentials = manager.create_identity_session(
        fixed_identity_resolver(account, authentication),
        "proof",
        now=START,
    )
    assert credentials is not None
    barrier = threading.Barrier(2)

    def rotate():
        barrier.wait()
        return manager.rotate(credentials.session_token, now=START + timedelta(seconds=1))

    def revoke():
        barrier.wait()
        return revoker.revoke_identity_evidence(
            authentication.evidence_id,
            now=START + timedelta(seconds=1),
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        rotation = executor.submit(rotate)
        revocation = executor.submit(revoke)
        rotated = rotation.result()
        assert revocation.result()

    assert revoker.identity_evidence_state(authentication.evidence_id) is IdentityEvidenceState.REVOKED
    assert manager.resolve(credentials.session_token, now=START + timedelta(seconds=2)) is None
    if rotated is not None:
        assert manager.resolve(rotated.session_token, now=START + timedelta(seconds=2)) is None
        assert manager.repository.get_by_session_id(rotated.session.session_id).status == "REVOKED"


def test_malformed_identity_evidence_identifier_is_rejected():
    non_v4_identifier = UUID("00000000-0000-1000-8000-000000000001")
    with pytest.raises(ValueError):
        AuthenticationContext(
            START,
            START + timedelta(minutes=5),
            non_v4_identifier,
        )


def test_trusted_identity_session_fails_closed_for_missing_forged_expired_or_revoked_evidence():
    manager, _repository = make_manager()
    account = AccountIdentity.generate()
    provider = ProviderIdentity("issuer", "subject-2")

    class Adapter:
        def verify(self, evidence):
            if evidence != "valid":
                return None
            return VerifiedProviderIdentity(
                provider,
                AuthenticationContext(START, START + timedelta(seconds=5)),
            )

    class Bindings:
        def find_existing_account(self, identity):
            return account if identity == provider else None

    resolver = ProviderBoundIdentityResolver(Adapter(), Bindings())
    assert manager.create_identity_session(None, "valid", now=START) is None
    assert manager.create_identity_session(resolver, "forged", now=START) is None
    assert manager.create_identity_session(resolver, "valid", now=START + timedelta(seconds=5)) is None
    with pytest.raises(ValueError):
        manager.create_authenticated_session(
            account.value,
            TRUSTED_IDENTITY_SOURCE,
            now=START,
        )

    credentials = manager.create_identity_session(resolver, "valid", now=START + timedelta(seconds=1))
    assert credentials is not None
    assert manager.logout(credentials.session_token, now=START + timedelta(seconds=2))
    assert manager.resolve_identity(
        credentials.session_token,
        now=START + timedelta(seconds=3),
    ) is None


def test_development_principal_cannot_be_used_as_trusted_identity_evidence():
    manager, _repository = make_manager()

    class DevelopmentResolver:
        def resolve(self, _evidence, *, now=None):
            del now
            return Principal.authenticated_user(uuid4(), "local-development-unverified")

    assert manager.create_identity_session(DevelopmentResolver(), "development-user", now=START) is None


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


def test_environment_session_managers_share_csrf_validation_across_workers(tmp_path):
    settings = {
        "PARMAR_SESSION_IDLE_SECONDS": "60",
        "PARMAR_SESSION_ABSOLUTE_SECONDS": "300",
        "PARMAR_SESSION_STORE_KEY": SESSION_STORE_KEY.decode("ascii"),
        "PARMAR_SESSION_DB_PATH": str(tmp_path / "shared-sessions.sqlite3"),
    }
    first_worker = session_manager_from_environment(settings)
    second_worker = session_manager_from_environment(settings)
    assert first_worker is not None and second_worker is not None

    credentials = first_worker.create_authenticated_session(
        uuid4(),
        "test-auth",
        now=START,
    )
    csrf_token = first_worker.csrf_token(credentials.session.session_id, now=START)

    assert csrf_token is not None
    assert second_worker.validate_csrf(
        credentials.session.session_id,
        csrf_token,
        now=START,
    )
    direct_worker = SessionManager(
        sqlite_repository(tmp_path / "shared-sessions.sqlite3"),
        SessionPolicy(idle_timeout_seconds=60, absolute_timeout_seconds=300),
    )
    assert direct_worker.validate_csrf(
        credentials.session.session_id,
        csrf_token,
        now=START,
    )


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