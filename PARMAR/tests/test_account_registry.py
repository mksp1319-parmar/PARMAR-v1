import io
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import FrozenInstanceError
from datetime import datetime, timedelta, timezone
from threading import Barrier
from types import SimpleNamespace
from uuid import uuid4

import pytest

from PARMAR.identity_contracts import (
    AccountIdentity,
    AuthenticationContext,
    ProviderIdentity,
    VerifiedProviderIdentity,
    resolve_authenticated_principal,
)
from PARMAR.identity_store import (
    AccountStatus,
    IdentityRecordConflict,
    IdentityStorageUnavailable,
    SQLiteIdentityRepository,
    TrustedInternalAccountProvisioner,
)
from PARMAR.interface import futuristic_app


def account_provisioner(repository):
    return TrustedInternalAccountProvisioner(repository)


@contextmanager
def registry_database_connection(database_path):
    connection = sqlite3.connect(database_path)
    try:
        connection.execute("PRAGMA foreign_keys=ON")
        with connection:
            yield connection
    finally:
        connection.close()


# These definitions reproduce the identity database schema before registry v2.
def create_v1_database(database_path, user_id, profile_id, workspace_id, created_at):
    with registry_database_connection(database_path) as connection:
        connection.executescript(
            """
            BEGIN IMMEDIATE;
            CREATE TABLE profiles (
                profile_id TEXT NOT NULL PRIMARY KEY,
                owner_user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX profiles_owner_created
                ON profiles(owner_user_id, created_at, profile_id);
            CREATE TABLE workspaces (
                workspace_id TEXT NOT NULL PRIMARY KEY,
                owner_user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE workspace_members (
                workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
                user_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('OWNER', 'ADMIN', 'MEMBER')),
                created_at TEXT NOT NULL,
                PRIMARY KEY(workspace_id, user_id)
            );
            CREATE INDEX workspace_members_user
                ON workspace_members(user_id, workspace_id);
            CREATE TABLE workspace_profiles (
                workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
                profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
                granted_by_user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY(workspace_id, profile_id)
            );
            PRAGMA user_version=1;
            COMMIT;
            """
        )
        connection.execute(
            "INSERT INTO profiles(profile_id, owner_user_id, name, created_at) VALUES (?, ?, ?, ?)",
            (str(profile_id), str(user_id), "Legacy profile", created_at),
        )
        connection.execute(
            "INSERT INTO workspaces(workspace_id, owner_user_id, name, created_at) VALUES (?, ?, ?, ?)",
            (str(workspace_id), str(user_id), "Legacy workspace", created_at),
        )
        connection.execute(
            """
            INSERT INTO workspace_members(workspace_id, user_id, role, created_at)
            VALUES (?, ?, 'OWNER', ?)
            """,
            (str(workspace_id), str(user_id), created_at),
        )
        connection.execute(
            """
            INSERT INTO workspace_profiles(
                workspace_id, profile_id, granted_by_user_id, created_at
            ) VALUES (?, ?, ?, ?)
            """,
            (str(workspace_id), str(profile_id), str(user_id), created_at),
        )


def create_v2_database_with_malformed_binding(database_path):
    user_id, profile_id, workspace_id = uuid4(), uuid4(), uuid4()
    created_at = datetime.now(timezone.utc).isoformat()
    create_v1_database(database_path, user_id, profile_id, workspace_id, created_at)
    account_identity = AccountIdentity.generate()
    with registry_database_connection(database_path) as connection:
        connection.executescript(
            """
            BEGIN IMMEDIATE;
            CREATE TABLE accounts (
                account_id TEXT NOT NULL PRIMARY KEY
                    CHECK(
                        length(account_id) = 36
                        AND account_id = lower(account_id)
                        AND substr(account_id, 9, 1) = '-'
                        AND substr(account_id, 14, 1) = '-'
                        AND substr(account_id, 19, 1) = '-'
                        AND substr(account_id, 24, 1) = '-'
                        AND substr(account_id, 15, 1) = '4'
                        AND substr(account_id, 20, 1) IN ('8', '9', 'a', 'b')
                        AND replace(account_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                    ),
                created_at TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'DISABLED'))
            );
            CREATE TABLE provider_account_bindings (
                issuer TEXT NOT NULL
                    CHECK(length(issuer) BETWEEN 1 AND 2048 AND issuer = trim(issuer)),
                subject TEXT NOT NULL
                    CHECK(length(subject) BETWEEN 1 AND 1024 AND subject = trim(subject)),
                account_id TEXT NOT NULL
                    REFERENCES accounts(account_id) ON DELETE RESTRICT,
                created_at TEXT NOT NULL,
                PRIMARY KEY(issuer, subject)
            );
            CREATE TRIGGER accounts_identity_immutable
            BEFORE UPDATE OF account_id ON accounts
            FOR EACH ROW WHEN NEW.account_id <> OLD.account_id
            BEGIN
                SELECT RAISE(ABORT, 'account_id is immutable');
            END;
            CREATE TRIGGER accounts_no_delete
            BEFORE DELETE ON accounts
            BEGIN
                SELECT RAISE(ABORT, 'account records cannot be deleted');
            END;
            PRAGMA user_version=2;
            COMMIT;
            """
        )
        connection.execute(
            "INSERT INTO accounts(account_id, created_at, status) VALUES (?, ?, 'ACTIVE')",
            (account_identity.serialize(), created_at),
        )
        connection.execute(
            """
            INSERT INTO provider_account_bindings(issuer, subject, account_id, created_at)
            VALUES (?, ?, ?, ?)
            """,
            ("\t", "legacy-invalid-subject", account_identity.serialize(), created_at),
        )
        connection.execute(
            """
            INSERT INTO provider_account_bindings(issuer, subject, account_id, created_at)
            VALUES (?, ?, ?, ?)
            """,
            ("legacy-issuer", "legacy-subject", account_identity.serialize(), created_at),
        )
    return user_id, profile_id, workspace_id, account_identity


def test_accounts_are_random_immutable_and_persist_across_database_reopen(tmp_path):
    database_path = tmp_path / "identity.sqlite3"
    repository = SQLiteIdentityRepository(database_path)
    provisioner = account_provisioner(repository)

    account = provisioner.provision_account()
    reloaded = SQLiteIdentityRepository(database_path).get_account(account.account_identity)

    assert account.account_identity.value.version == 4
    assert account.status is AccountStatus.ACTIVE
    assert account.created_at.tzinfo is timezone.utc
    assert reloaded == account
    assert repository.account_exists(account.account_identity)
    assert repository.get_account_status(account.account_identity) is AccountStatus.ACTIVE
    with pytest.raises(FrozenInstanceError):
        account.account_identity = AccountIdentity.generate()
    with registry_database_connection(database_path) as connection:
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "UPDATE accounts SET account_id = ? WHERE account_id = ?",
                (str(uuid4()), account.account_identity.serialize()),
            )
        with pytest.raises(sqlite3.IntegrityError, match="cannot be deleted"):
            connection.execute(
                "DELETE FROM accounts WHERE account_id = ?",
                (account.account_identity.serialize(),),
            )


def test_account_lookup_is_exact_and_unknown_or_malformed_ids_fail_closed(tmp_path):
    repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    first = account_provisioner(repository).provision_account()
    second = account_provisioner(repository).provision_account()
    unknown = AccountIdentity.generate()

    assert repository.get_account(first.account_identity) == first
    assert repository.get_account(second.account_identity) == second
    assert repository.get_account(unknown) is None
    assert repository.get_account(first.account_identity.serialize()) is None
    assert not repository.account_exists(unknown)
    assert repository.get_account_status(unknown) is None


def test_duplicate_and_invalid_account_ids_are_rejected_by_storage(tmp_path):
    repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    existing = account_provisioner(repository).provision_account()

    with pytest.raises(IdentityRecordConflict):
        repository._provision_account(existing.account_identity)

    with registry_database_connection(repository.database_path) as connection:
        malformed_chars = ["0"] * 36
        for index in (0, 8, 13, 18, 23):
            malformed_chars[index] = "-"
        malformed_chars[14] = "4"
        malformed_chars[19] = "8"
        malformed_uuid = "".join(malformed_chars)
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO accounts(account_id, created_at, status) VALUES (?, ?, ?)",
                ("not-an-account-id", datetime.now(timezone.utc).isoformat(), "ACTIVE"),
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO accounts(account_id, created_at, status) VALUES (?, ?, ?)",
                (malformed_uuid, datetime.now(timezone.utc).isoformat(), "ACTIVE"),
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO accounts(account_id, created_at, status) VALUES (?, ?, ?)",
                (str(uuid4()), datetime.now(timezone.utc).isoformat(), "UNKNOWN"),
            )

    assert repository.get_account(existing.account_identity) == existing


def test_registry_migration_preserves_legacy_profiles_without_assigning_accounts(tmp_path):
    database_path = tmp_path / "identity.sqlite3"
    legacy_user_id, profile_id, workspace_id = uuid4(), uuid4(), uuid4()
    created_at = datetime.now(timezone.utc).isoformat()
    create_v1_database(database_path, legacy_user_id, profile_id, workspace_id, created_at)

    migrated = SQLiteIdentityRepository(database_path)

    assert [item.profile_id for item in migrated.list_profiles(legacy_user_id)] == [profile_id]
    assert [item.workspace_id for item in migrated.list_workspaces(legacy_user_id)] == [workspace_id]
    assert [item.profile_id for item in migrated.list_workspace_profiles(
        legacy_user_id,
        workspace_id,
    )] == [profile_id]
    with registry_database_connection(database_path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 3
        assert connection.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0
        assert connection.execute(
            "SELECT owner_user_id FROM profiles WHERE profile_id = ?",
            (str(profile_id),),
        ).fetchone()[0] == str(legacy_user_id)
    reopened = SQLiteIdentityRepository(database_path)
    assert [item.profile_id for item in reopened.list_profiles(legacy_user_id)] == [profile_id]
    assert [item.workspace_id for item in reopened.list_workspaces(legacy_user_id)] == [workspace_id]


def test_v2_migration_failure_is_atomic_and_reopen_completes_migration(tmp_path):
    database_path = tmp_path / "identity-v2.sqlite3"
    user_id, profile_id, workspace_id, account_identity = (
        create_v2_database_with_malformed_binding(database_path)
    )

    with pytest.raises(IdentityStorageUnavailable):
        SQLiteIdentityRepository(database_path).list_profiles(user_id)

    with registry_database_connection(database_path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 2
        assert connection.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 1
        assert connection.execute(
            "SELECT COUNT(*) FROM provider_account_bindings"
        ).fetchone()[0] == 2
        assert connection.execute(
            "SELECT issuer FROM provider_account_bindings WHERE issuer = ?",
            ("\t",),
        ).fetchone()[0] == "\t"
        assert connection.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE '%_v3'"
        ).fetchone()[0] == 0
        connection.execute("DELETE FROM provider_account_bindings WHERE issuer = ?", ("\t",))

    reopened = SQLiteIdentityRepository(database_path)
    assert reopened.get_account_status(account_identity) is AccountStatus.ACTIVE
    assert reopened.find_existing_account(
        ProviderIdentity("legacy-issuer", "legacy-subject")
    ) == account_identity
    assert [item.profile_id for item in reopened.list_profiles(user_id)] == [profile_id]
    assert [item.workspace_id for item in reopened.list_workspaces(user_id)] == [workspace_id]
    with registry_database_connection(database_path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 3
    assert SQLiteIdentityRepository(database_path).get_account(account_identity) is not None


def test_provider_binding_lookup_is_explicit_provider_neutral_and_task36_compatible(tmp_path):
    repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    account = account_provisioner(repository).provision_account()
    provider_identity = ProviderIdentity(
        "https://issuer.example",
        "00000000-0000-4000-8000-000000000001",
    )

    class TrustedTestAdapter:
        def verify(self, assertion):
            del assertion
            now = datetime.now(timezone.utc)
            return VerifiedProviderIdentity(
                provider_identity,
                AuthenticationContext(now, now + timedelta(minutes=5)),
            )

    assert repository.find_existing_account(provider_identity) is None
    assert repository.find_existing_account("https://issuer.example") is None
    assert repository.account_exists(AccountIdentity.parse(provider_identity.subject)) is False
    assert resolve_authenticated_principal(
        TrustedTestAdapter(),
        repository,
        "test-only verified assertion",
    ) is None

    with registry_database_connection(repository.database_path) as connection:
        connection.execute(
            """
            INSERT INTO provider_account_bindings(issuer, subject, account_id, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (
                provider_identity.issuer,
                provider_identity.subject,
                account.account_identity.serialize(),
                datetime.now(timezone.utc).isoformat(),
            ),
        )

    assert repository.find_existing_account(provider_identity) == account.account_identity
    assert resolve_authenticated_principal(
        TrustedTestAdapter(),
        repository,
        "test-only verified assertion",
    ).account_identity == account.account_identity
    assert AccountIdentity.parse(provider_identity.subject) != account.account_identity


def test_provider_identity_uniqueness_and_validation_are_enforced_by_database(tmp_path):
    repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    first = account_provisioner(repository).provision_account()
    second = account_provisioner(repository).provision_account()
    now = datetime.now(timezone.utc).isoformat()

    with registry_database_connection(repository.database_path) as connection:
        with repository._connection() as repository_connection:
            assert repository_connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        connection.execute(
            """
            INSERT INTO provider_account_bindings(issuer, subject, account_id, created_at)
            VALUES ('issuer-a', 'subject', ?, ?)
            """,
            (first.account_identity.serialize(), now),
        )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO provider_account_bindings(issuer, subject, account_id, created_at)
                VALUES ('issuer-a', 'subject', ?, ?)
                """,
                (second.account_identity.serialize(), now),
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO provider_account_bindings(issuer, subject, account_id, created_at)
                VALUES ('issuer-c', 'orphan', ?, ?)
                """,
                (str(uuid4()), now),
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO provider_account_bindings(issuer, subject, account_id, created_at)
                VALUES ('issuer-b', '   ', ?, ?)
                """,
                (second.account_identity.serialize(), now),
            )
        connection.execute(
            """
            INSERT INTO provider_account_bindings(issuer, subject, account_id, created_at)
            VALUES ('issuer-b', 'subject', ?, ?)
            """,
            (second.account_identity.serialize(), now),
        )

    assert repository.find_existing_account(ProviderIdentity("issuer-a", "subject")) == (
        first.account_identity
    )
    assert repository.find_existing_account(ProviderIdentity("issuer-b", "subject")) == (
        second.account_identity
    )
    assert repository.find_existing_account(ProviderIdentity("issuer-c", "subject")) is None


def test_provider_identity_constraints_match_contract_whitespace_validation(tmp_path):
    repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    account = account_provisioner(repository).provision_account()
    now = datetime.now(timezone.utc).isoformat()

    with registry_database_connection(repository.database_path) as connection:
        for issuer, subject in (
            ("\t", "subject"),
            ("issuer", "\t"),
            (" \t ", "subject"),
            ("\u2003", "subject"),
        ):
            with pytest.raises(ValueError):
                ProviderIdentity(issuer, subject)
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute(
                    """
                    INSERT INTO provider_account_bindings(issuer, subject, account_id, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (issuer, subject, account.account_identity.serialize(), now),
                )

        valid_identity = ProviderIdentity("issuer\tinternal", "subject\tinternal")
        connection.execute(
            """
            INSERT INTO provider_account_bindings(issuer, subject, account_id, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (
                valid_identity.issuer,
                valid_identity.subject,
                account.account_identity.serialize(),
                now,
            ),
        )
    assert repository.find_existing_account(valid_identity) == account.account_identity


def test_concurrent_duplicate_provider_binding_is_rejected_across_connections(tmp_path):
    database_path = tmp_path / "identity.sqlite3"
    repository = SQLiteIdentityRepository(database_path)
    account = account_provisioner(repository).provision_account()
    identity = ProviderIdentity("issuer", "subject")
    created_at = datetime.now(timezone.utc).isoformat()
    barrier = Barrier(2)

    def insert_binding():
        with registry_database_connection(database_path) as connection:
            barrier.wait(timeout=5)
            try:
                connection.execute(
                    """
                    INSERT INTO provider_account_bindings(
                        issuer, subject, account_id, created_at
                    ) VALUES (?, ?, ?, ?)
                    """,
                    (
                        identity.issuer,
                        identity.subject,
                        account.account_identity.serialize(),
                        created_at,
                    ),
                )
                return "inserted"
            except sqlite3.IntegrityError:
                return "conflict"

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(lambda _index: insert_binding(), range(2)))

    assert sorted(outcomes) == ["conflict", "inserted"]
    assert repository.find_existing_account(identity) == account.account_identity


def test_inactive_accounts_do_not_resolve_from_existing_provider_bindings(tmp_path):
    repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    account = account_provisioner(repository).provision_account()
    identity = ProviderIdentity("issuer", "subject")

    with registry_database_connection(repository.database_path) as connection:
        connection.execute(
            """
            INSERT INTO provider_account_bindings(issuer, subject, account_id, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (
                identity.issuer,
                identity.subject,
                account.account_identity.serialize(),
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        connection.execute(
            "UPDATE accounts SET status = 'DISABLED' WHERE account_id = ?",
            (account.account_identity.serialize(),),
        )

    assert repository.get_account_status(account.account_identity) is AccountStatus.DISABLED
    assert repository.find_existing_account(identity) is None


def test_account_creation_rolls_back_if_record_validation_fails(tmp_path, monkeypatch):
    repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    repository.list_profiles(uuid4())

    def fail_validation(_row):
        del _row
        raise IdentityStorageUnavailable("injected registry validation failure")

    monkeypatch.setattr(repository, "_account", fail_validation)
    with pytest.raises(IdentityStorageUnavailable, match="injected registry validation failure"):
        account_provisioner(repository).provision_account()

    monkeypatch.undo()
    with registry_database_connection(repository.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0


def test_concurrent_provisioning_preserves_account_id_uniqueness(tmp_path):
    database_path = tmp_path / "identity.sqlite3"
    SQLiteIdentityRepository(database_path).list_profiles(uuid4())
    repositories = [SQLiteIdentityRepository(database_path) for _ in range(12)]

    with ThreadPoolExecutor(max_workers=len(repositories)) as executor:
        records = list(executor.map(
            lambda repository: account_provisioner(repository).provision_account(),
            repositories,
        ))

    account_ids = [record.account_identity for record in records]
    assert len(set(account_ids)) == len(repositories)
    with registry_database_connection(database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == len(
            repositories
        )


def test_account_creation_is_not_exposed_by_unauthenticated_http_routes(
    tmp_path,
    monkeypatch,
):
    repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    repository.list_profiles(uuid4())
    monkeypatch.setattr(futuristic_app, "IDENTITY_REPOSITORY", repository)
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", None)
    monkeypatch.setattr(
        futuristic_app,
        "PRINCIPAL_RESOLVER",
        futuristic_app.LocalDemoPrincipalResolver(),
    )

    for path in ("/api/accounts", "/api/identity/accounts"):
        response, errors = request_for_registry(path, method="GET")
        assert response == {}
        assert errors == [(404, "Not found")]

        response, errors = request_for_registry(path, method="POST")
        assert response == {}
        assert errors == [(404, "Not found")]

    with registry_database_connection(repository.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0


def request_for_registry(path, *, method):
    errors = []
    request = SimpleNamespace(
        path=path,
        headers={"Content-Length": "2"},
        rfile=io.BytesIO(b"{}"),
        send_error=lambda status, message: errors.append((status, message)),
        _send_json=lambda status, payload: (status, payload),
        _send_json_with_headers=lambda status, payload, headers: (status, payload, headers),
    )
    if method == "GET":
        futuristic_app.PARMARRequestHandler.do_GET(request)
    else:
        futuristic_app.PARMARRequestHandler.do_POST(request)
    return {}, errors
