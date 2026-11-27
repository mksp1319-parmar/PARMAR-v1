"""Manual Gate 2 synthetic SQLite prototype harness.

The explicit pytest invocation extracts and executes the approved disposable
B2 DDL in a temporary synthetic database. Embedded-NUL length semantics remain
an unresolved data-model decision and are observed without a parity claim.
The synthetic `accounts` parent models only its primary key and foreign-key
behavior; it does not recreate or validate the current account-table triggers.
"""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import multiprocessing
import os
import sqlite3
from pathlib import Path
from threading import Barrier
from typing import cast

import pytest

from PARMAR.identity_contracts import ProviderIdentity
from PARMAR.interface.approvals import SQLitePendingApprovalStore
from PARMAR.memories import SQLiteMemoryRepository
from PARMAR.sessions import SQLiteSessionRepository


_DDL_MARKER = "**Synthetic SQLite prototype DDL — disposable execution only**"


def _validate_binding_version(value: object) -> int:
    if type(value) is not int or value < 1:
        raise ValueError("Binding version must be a positive integer.")
    return value


def _b2_schema_sql() -> str:
    design_path = Path(__file__).resolve().parents[1] / "ACCOUNT-BINDING-B2-SCHEMA-DESIGN.md"
    design = design_path.read_text(encoding="utf-8")
    marker = design.index(_DDL_MARKER)
    fence = design.index("```sql\n", marker) + len("```sql\n")
    end = design.index("\n```", fence)
    return design[fence:end]


def _connect(database_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(database_path, timeout=10, isolation_level=None)
    connection.execute("PRAGMA foreign_keys = ON")
    if connection.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
        connection.close()
        raise RuntimeError("SQLite foreign-key enforcement is unavailable.")
    return connection


def _crash_with_uncommitted_activation(database_path: str) -> None:
    connection = _connect(Path(database_path))
    connection.execute("BEGIN IMMEDIATE")
    connection.execute(
        """
        UPDATE account_identity_binding
        SET state = 'ACTIVE', binding_version = 2
        WHERE binding_id = 'binding-a'
        """
    )
    os._exit(0)


@contextmanager
def _connection(database_path: Path):
    connection = _connect(database_path)
    try:
        yield connection
    finally:
        connection.close()


def _create_schema(database_path: Path) -> None:
    if sqlite3.sqlite_version_info < (3, 8, 0):
        raise RuntimeError("SQLite 3.8.0 or later is required for partial indexes.")
    with _connection(database_path) as connection:
        connection.execute(
            "CREATE TABLE accounts (account_id TEXT NOT NULL PRIMARY KEY)"
        )
        connection.executescript(_b2_schema_sql())


def _add_account(connection: sqlite3.Connection, account_id: str) -> None:
    connection.execute("INSERT INTO accounts(account_id) VALUES (?)", (account_id,))


def _add_provider_identity(
    connection: sqlite3.Connection,
    provider_identity_id: str,
    adapter_id: str,
    issuer: str,
    subject: str,
) -> None:
    connection.execute(
        """
        INSERT INTO provider_identity(
            provider_identity_id, adapter_id, issuer_namespace, subject_key
        ) VALUES (?, ?, ?, ?)
        """,
        (provider_identity_id, adapter_id, issuer, subject),
    )


def _add_pending_binding(
    connection: sqlite3.Connection,
    binding_id: str,
    account_id: str,
    provider_identity_id: str,
) -> None:
    connection.execute(
        """
        INSERT INTO account_identity_binding(
            binding_id, account_id, provider_identity_id, state, binding_version
        ) VALUES (?, ?, ?, 'PENDING', 1)
        """,
        (binding_id, account_id, provider_identity_id),
    )


@pytest.fixture
def schema_database(tmp_path: Path) -> Path:
    database_path = tmp_path / "synthetic-b2-schema.sqlite3"
    _create_schema(database_path)
    return database_path


def test_provider_identity_sql_constraints_match_application_validation(
    schema_database: Path,
) -> None:
    invalid_pairs = (
        ("", "subject"),
        ("issuer", ""),
        ("issuer", "   "),
        (" issuer", "subject"),
        ("issuer", "subject "),
        ("\u2003issuer", "subject"),
        ("issuer", "subject\u3000"),
        ("i" * 2049, "subject"),
        ("issuer", "s" * 1025),
    )

    with _connection(schema_database) as connection:
        for index, (issuer, subject) in enumerate(invalid_pairs):
            with pytest.raises(ValueError):
                ProviderIdentity(issuer, subject)
            with pytest.raises(sqlite3.IntegrityError):
                _add_provider_identity(
                    connection,
                    f"invalid-{index}",
                    "adapter-a",
                    issuer,
                    subject,
                )


def test_provider_identity_length_bounds_match_for_non_nul_strings(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        for index, (issuer, subject) in enumerate(
            (("i" * 2048, "subject"), ("issuer", "s" * 1024))
        ):
            identity = ProviderIdentity(issuer, subject)
            _add_provider_identity(
                connection,
                f"boundary-{index}",
                "adapter-a",
                identity.issuer,
                identity.subject,
            )

        for index, (issuer, subject) in enumerate(
            (("i" * 2049, "subject"), ("issuer", "s" * 1025))
        ):
            with pytest.raises(ValueError):
                ProviderIdentity(issuer, subject)
            with pytest.raises(sqlite3.IntegrityError):
                _add_provider_identity(
                    connection,
                    f"over-boundary-{index}",
                    "adapter-a",
                    issuer,
                    subject,
                )


def test_provider_identity_rejects_non_string_parts() -> None:
    for issuer, subject in (
        (None, "subject"),
        (b"issuer", "subject"),
        ("issuer", 1),
        ("issuer", 1.0),
    ):
        with pytest.raises(ValueError):
            ProviderIdentity(cast(str, issuer), cast(str, subject))


def test_internal_whitespace_is_preserved_without_normalization(
    schema_database: Path,
) -> None:
    identity = ProviderIdentity("issuer\tinternal", "subject\tinternal")
    with _connection(schema_database) as connection:
        _add_provider_identity(
            connection,
            "provider-1",
            "adapter-a",
            identity.issuer,
            identity.subject,
        )
        stored = connection.execute(
            """
            SELECT issuer_namespace, subject_key
            FROM provider_identity WHERE provider_identity_id = ?
            """,
            ("provider-1",),
        ).fetchone()

    assert stored == (identity.issuer, identity.subject)


def test_provider_identity_tuple_is_unique_across_adapter_ids(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )
        with pytest.raises(sqlite3.IntegrityError):
            _add_provider_identity(
                connection, "provider-b", "adapter-b", "issuer", "subject"
            )


def test_foreign_keys_are_enabled_on_each_connection(schema_database: Path) -> None:
    for _ in range(2):
        with _connection(schema_database) as connection:
            assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1

    with _connection(schema_database) as connection:
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )
        with pytest.raises(sqlite3.IntegrityError):
            _add_pending_binding(
                connection, "orphan-binding", "missing-account", "provider-a"
            )
        _add_account(connection, "account-a")
        with pytest.raises(sqlite3.IntegrityError):
            _add_pending_binding(
                connection, "orphan-provider-binding", "account-a", "missing-provider"
            )
        _add_pending_binding(connection, "binding-a", "account-a", "provider-a")
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute("DELETE FROM accounts WHERE account_id = 'account-a'")


def test_invalid_binding_writes_preserve_state_and_version(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        _add_account(connection, "account-a")
        _add_account(connection, "account-b")
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )

        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO account_identity_binding(
                    binding_id, account_id, provider_identity_id, state, binding_version
                ) VALUES ('direct-active', 'account-a', 'provider-a', 'ACTIVE', 1)
                """
            )
        _add_pending_binding(connection, "binding-a", "account-a", "provider-a")
        with pytest.raises(sqlite3.IntegrityError):
            _add_pending_binding(
                connection, "duplicate-binding", "account-a", "provider-a"
            )

        invalid_updates = (
            ("ACTIVE", 1),
            ("ACTIVE", 3),
            ("FAILED", 3),
            ("REVOKED", 2),
        )
        for state, version in invalid_updates:
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute(
                    """
                    UPDATE account_identity_binding
                    SET state = ?, binding_version = ?
                    WHERE binding_id = 'binding-a'
                    """,
                    (state, version),
                )

        unchanged = connection.execute(
            """
            SELECT state, binding_version FROM account_identity_binding
            WHERE binding_id = 'binding-a'
            """
        ).fetchone()
        assert unchanged == ("PENDING", 1)

        connection.execute(
            """
            UPDATE account_identity_binding
            SET state = 'ACTIVE', binding_version = 2
            WHERE binding_id = 'binding-a'
            """
        )
        for mutation in (
            "binding_id = 'replacement-id'",
            "account_id = 'account-b'",
        ):
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute(
                    f"""
                    UPDATE account_identity_binding
                    SET {mutation}, state = 'PENDING_UNLINK', binding_version = 3
                    WHERE binding_id = 'binding-a'
                    """
                )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "DELETE FROM account_identity_binding WHERE binding_id = 'binding-a'"
            )
        for column, value in (
            ("provider_identity_id", "replacement-provider"),
            ("adapter_id", "adapter-b"),
            ("issuer_namespace", "replacement-issuer"),
            ("subject_key", "replacement-subject"),
        ):
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute(
                    f"UPDATE provider_identity SET {column} = ? "
                    "WHERE provider_identity_id = 'provider-a'",
                    (value,),
                )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "DELETE FROM provider_identity WHERE provider_identity_id = 'provider-a'"
            )


def test_active_pending_unlink_and_revoked_owner_block_competing_activation(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        _add_account(connection, "account-a")
        _add_account(connection, "account-b")
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )
        _add_pending_binding(connection, "binding-a", "account-a", "provider-a")
        _add_pending_binding(connection, "binding-b", "account-b", "provider-a")

        connection.execute(
            """
            UPDATE account_identity_binding SET state = 'ACTIVE', binding_version = 2
            WHERE binding_id = 'binding-a'
            """
        )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                UPDATE account_identity_binding SET state = 'ACTIVE', binding_version = 2
                WHERE binding_id = 'binding-b'
                """
            )

        connection.execute(
            """
            UPDATE account_identity_binding
            SET state = 'PENDING_UNLINK', binding_version = 3
            WHERE binding_id = 'binding-a'
            """
        )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                UPDATE account_identity_binding SET state = 'ACTIVE', binding_version = 2
                WHERE binding_id = 'binding-b'
                """
            )

        connection.execute(
            """
            UPDATE account_identity_binding SET state = 'REVOKED', binding_version = 4
            WHERE binding_id = 'binding-a'
            """
        )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                UPDATE account_identity_binding SET state = 'ACTIVE', binding_version = 2
                WHERE binding_id = 'binding-b'
                """
            )
        assert connection.execute(
            """
            SELECT state FROM account_identity_binding WHERE binding_id = 'binding-b'
            """
        ).fetchone() == ("PENDING",)


def test_same_owner_reactivation_reuses_retained_binding_history(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        _add_account(connection, "account-a")
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )
        _add_pending_binding(connection, "binding-a", "account-a", "provider-a")
        for state, version in (
            ("ACTIVE", 2),
            ("PENDING_UNLINK", 3),
            ("REVOKED", 4),
            ("PENDING", 5),
            ("ACTIVE", 6),
        ):
            connection.execute(
                """
                UPDATE account_identity_binding
                SET state = ?, binding_version = ?
                WHERE binding_id = 'binding-a'
                """,
                (state, version),
            )

        assert connection.execute(
            """
            SELECT state, binding_version
            FROM account_identity_binding WHERE binding_id = 'binding-a'
            """
        ).fetchone() == ("ACTIVE", 6)


def test_each_allowed_transition_accepts_only_the_next_version(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        _add_account(connection, "account-a")
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )
        _add_pending_binding(connection, "binding-a", "account-a", "provider-a")

        transitions = (
            ("FAILED", 2),
            ("PENDING", 3),
            ("ACTIVE", 4),
            ("PENDING_UNLINK", 5),
            ("ACTIVE", 6),
            ("PENDING_UNLINK", 7),
            ("REVOKED", 8),
            ("PENDING", 9),
            ("ACTIVE", 10),
        )
        for state, version in transitions:
            connection.execute(
                """
                UPDATE account_identity_binding
                SET state = ?, binding_version = ?
                WHERE binding_id = 'binding-a'
                """,
                (state, version),
            )

        assert connection.execute(
            """
            SELECT state, binding_version
            FROM account_identity_binding WHERE binding_id = 'binding-a'
            """
        ).fetchone() == ("ACTIVE", 10)


def test_concurrent_connections_allow_only_one_owner_to_activate(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        _add_account(connection, "account-a")
        _add_account(connection, "account-b")
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )
        _add_pending_binding(connection, "binding-a", "account-a", "provider-a")
        _add_pending_binding(connection, "binding-b", "account-b", "provider-a")

    start = Barrier(2)

    def activate(binding_id: str) -> bool:
        with _connection(schema_database) as connection:
            start.wait(timeout=5)
            connection.execute("BEGIN IMMEDIATE")
            try:
                cursor = connection.execute(
                    """
                    UPDATE account_identity_binding
                    SET state = 'ACTIVE', binding_version = 2
                    WHERE binding_id = ? AND state = 'PENDING' AND binding_version = 1
                    """,
                    (binding_id,),
                )
                if cursor.rowcount != 1:
                    connection.execute("ROLLBACK")
                    return False
            except sqlite3.IntegrityError:
                connection.execute("ROLLBACK")
                return False
            connection.execute("COMMIT")
            return True

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(activate, ("binding-a", "binding-b")))

    assert sorted(outcomes) == [False, True]
    with _connection(schema_database) as connection:
        rows = connection.execute(
            """
            SELECT state, COUNT(*)
            FROM account_identity_binding
            GROUP BY state
            """
        ).fetchall()
    assert dict(rows) == {"ACTIVE": 1, "PENDING": 1}


def test_concurrent_unlink_and_competing_activation_keep_original_owner(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        _add_account(connection, "account-a")
        _add_account(connection, "account-b")
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )
        _add_pending_binding(connection, "binding-a", "account-a", "provider-a")
        _add_pending_binding(connection, "binding-b", "account-b", "provider-a")
        connection.execute(
            """
            UPDATE account_identity_binding
            SET state = 'ACTIVE', binding_version = 2
            WHERE binding_id = 'binding-a'
            """
        )

    start = Barrier(2)

    def transition(binding_id: str, new_state: str, version: int) -> bool:
        with _connection(schema_database) as connection:
            start.wait(timeout=5)
            connection.execute("BEGIN IMMEDIATE")
            try:
                cursor = connection.execute(
                    """
                    UPDATE account_identity_binding
                    SET state = ?, binding_version = ?
                    WHERE binding_id = ? AND binding_version = ?
                    """,
                    (new_state, version + 1, binding_id, version),
                )
                if cursor.rowcount != 1:
                    connection.execute("ROLLBACK")
                    return False
            except sqlite3.IntegrityError:
                connection.execute("ROLLBACK")
                return False
            connection.execute("COMMIT")
            return True

    with ThreadPoolExecutor(max_workers=2) as executor:
        unlink = executor.submit(transition, "binding-a", "PENDING_UNLINK", 2)
        activation = executor.submit(transition, "binding-b", "ACTIVE", 1)
        assert unlink.result() is True
        assert activation.result() is False

    with _connection(schema_database) as connection:
        rows = connection.execute(
            """
            SELECT account_id, state
            FROM account_identity_binding
            WHERE state IN ('ACTIVE', 'PENDING_UNLINK')
            """
        ).fetchall()
    assert rows == [("account-a", "PENDING_UNLINK")]


def test_uncommitted_transition_is_rolled_back_after_reopen(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        _add_account(connection, "account-a")
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )
        _add_pending_binding(connection, "binding-a", "account-a", "provider-a")

    interrupted = _connect(schema_database)
    interrupted.execute("BEGIN IMMEDIATE")
    interrupted.execute(
        """
        UPDATE account_identity_binding
        SET state = 'ACTIVE', binding_version = 2
        WHERE binding_id = 'binding-a'
        """
    )
    interrupted.close()

    with _connection(schema_database) as reopened:
        assert reopened.execute(
            """
            SELECT state, binding_version
            FROM account_identity_binding WHERE binding_id = 'binding-a'
            """
        ).fetchone() == ("PENDING", 1)


def test_process_exit_before_commit_rolls_back_after_restart(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        _add_account(connection, "account-a")
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )
        _add_pending_binding(connection, "binding-a", "account-a", "provider-a")

    process = multiprocessing.get_context("spawn").Process(
        target=_crash_with_uncommitted_activation,
        args=(str(schema_database),),
    )
    process.start()
    process.join(timeout=10)
    if process.is_alive():
        process.terminate()
        process.join(timeout=5)
        pytest.fail("Synthetic writer process did not exit.")
    assert process.exitcode == 0

    with _connection(schema_database) as reopened:
        assert reopened.execute(
            """
            SELECT state, binding_version
            FROM account_identity_binding WHERE binding_id = 'binding-a'
            """
        ).fetchone() == ("PENDING", 1)


def test_sqlite_backup_restore_preserves_synthetic_schema_and_state(
    schema_database: Path,
    tmp_path: Path,
) -> None:
    with _connection(schema_database) as connection:
        _add_account(connection, "account-a")
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )
        _add_pending_binding(connection, "binding-a", "account-a", "provider-a")
        connection.execute(
            """
            UPDATE account_identity_binding
            SET state = 'ACTIVE', binding_version = 2
            WHERE binding_id = 'binding-a'
            """
        )

    backup_path = tmp_path / "synthetic-b2-backup.sqlite3"
    restored_path = tmp_path / "synthetic-b2-restored.sqlite3"
    with _connection(schema_database) as source, sqlite3.connect(backup_path) as backup:
        source.backup(backup)
    with sqlite3.connect(backup_path) as backup, sqlite3.connect(restored_path) as restored:
        backup.backup(restored)

    with _connection(restored_path) as restored:
        assert restored.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert restored.execute("PRAGMA foreign_key_check").fetchall() == []
        assert restored.execute(
            """
            SELECT account_id, provider_identity_id, state, binding_version
            FROM account_identity_binding
            """
        ).fetchall() == [("account-a", "provider-a", "ACTIVE", 2)]


def test_failed_retry_and_duplicate_operations(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        _add_account(connection, "account-a")
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )
        _add_pending_binding(connection, "binding-a", "account-a", "provider-a")

        connection.execute(
            """
            UPDATE account_identity_binding
            SET state = 'FAILED', binding_version = 2
            WHERE binding_id = 'binding-a'
            """
        )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                UPDATE account_identity_binding
                SET state = 'FAILED', binding_version = 3
                WHERE binding_id = 'binding-a'
                """
            )
        connection.execute(
            """
            UPDATE account_identity_binding
            SET state = 'PENDING', binding_version = 3
            WHERE binding_id = 'binding-a'
            """
        )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                UPDATE account_identity_binding
                SET state = 'PENDING', binding_version = 3
                WHERE binding_id = 'binding-a'
                """
            )

        assert connection.execute(
            """
            SELECT state, binding_version
            FROM account_identity_binding WHERE binding_id = 'binding-a'
            """
        ).fetchone() == ("PENDING", 3)


def test_pending_unlink_cancellation_and_revocation(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        _add_account(connection, "account-a")
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )
        _add_pending_binding(connection, "binding-a", "account-a", "provider-a")

        connection.execute(
            """
            UPDATE account_identity_binding
            SET state = 'ACTIVE', binding_version = 2
            WHERE binding_id = 'binding-a'
            """
        )
        connection.execute(
            """
            UPDATE account_identity_binding
            SET state = 'PENDING_UNLINK', binding_version = 3
            WHERE binding_id = 'binding-a'
            """
        )
        connection.execute(
            """
            UPDATE account_identity_binding
            SET state = 'ACTIVE', binding_version = 4
            WHERE binding_id = 'binding-a'
            """
        )
        connection.execute(
            """
            UPDATE account_identity_binding
            SET state = 'PENDING_UNLINK', binding_version = 5
            WHERE binding_id = 'binding-a'
            """
        )
        connection.execute(
            """
            UPDATE account_identity_binding
            SET state = 'REVOKED', binding_version = 6
            WHERE binding_id = 'binding-a'
            """
        )

        assert connection.execute(
            """
            SELECT state, binding_version
            FROM account_identity_binding WHERE binding_id = 'binding-a'
            """
        ).fetchone() == ("REVOKED", 6)


def test_forbidden_and_malformed_binding_writes_roll_back(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        _add_account(connection, "account-a")
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )

        malformed_inserts = (
            ("malformed-state", "NOT_A_STATE", 1),
            ("malformed-version", "PENDING", 0),
            ("malformed-active", "ACTIVE", 1),
            ("malformed-failed", "FAILED", 1),
        )
        for binding_id, state, version in malformed_inserts:
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute(
                    """
                    INSERT INTO account_identity_binding(
                        binding_id, account_id, provider_identity_id, state,
                        binding_version
                    ) VALUES (?, 'account-a', 'provider-a', ?, ?)
                    """,
                    (binding_id, state, version),
                )

        _add_pending_binding(connection, "binding-a", "account-a", "provider-a")
        connection.execute("BEGIN")
        try:
            connection.execute(
                """
                UPDATE account_identity_binding
                SET state = 'ACTIVE', binding_version = 2
                WHERE binding_id = 'binding-a'
                """
            )
            connection.execute(
                """
                UPDATE account_identity_binding
                SET state = 'UNKNOWN', binding_version = 3
                WHERE binding_id = 'binding-a'
                """
            )
        except sqlite3.IntegrityError:
            connection.execute("ROLLBACK")
        else:
            connection.execute("ROLLBACK")
            raise AssertionError("Malformed state unexpectedly committed.")

        assert connection.execute(
            """
            SELECT state, binding_version
            FROM account_identity_binding WHERE binding_id = 'binding-a'
            """
        ).fetchone() == ("PENDING", 1)


def test_embedded_nul_observation_is_not_a_parity_claim(
    schema_database: Path,
) -> None:
    issuer = "issuer\u0000suffix"
    subject = "subject\u0000suffix"
    with pytest.raises(ValueError):
        ProviderIdentity(issuer, subject)
    with _connection(schema_database) as connection:
        with pytest.raises(sqlite3.IntegrityError):
            _add_provider_identity(
                connection,
                "provider-nul",
                "adapter-a",
                issuer,
                subject,
            )


def test_direct_text_affinity_and_blob_behavior(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        connection.execute(
            """
            INSERT INTO provider_identity(
                provider_identity_id, adapter_id, issuer_namespace, subject_key
            ) VALUES ('numeric-text', 'adapter-a', 123, 456)
            """
        )
        row = connection.execute(
            """
            SELECT typeof(issuer_namespace), issuer_namespace,
                   typeof(subject_key), subject_key
            FROM provider_identity WHERE provider_identity_id = 'numeric-text'
            """
        ).fetchone()
        assert row == ("text", "123", "text", "456")

        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO provider_identity(
                    provider_identity_id, adapter_id, issuer_namespace, subject_key
                ) VALUES ('blob-issuer', 'adapter-a', ?, 'subject')
                """,
                (sqlite3.Binary(b"issuer"),),
            )


def test_identity_mutations_provider_deletion_and_binding_deletion_are_rejected(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        _add_account(connection, "account-a")
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )
        _add_pending_binding(connection, "binding-a", "account-a", "provider-a")

        for update in (
            "binding_id = 'binding-b'",
            "account_id = 'account-b'",
            "provider_identity_id = 'provider-b'",
            "binding_version = 2",
        ):
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute(
                    f"""
                    UPDATE account_identity_binding
                    SET {update}
                    WHERE binding_id = 'binding-a'
                    """
                )

        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "DELETE FROM account_identity_binding WHERE binding_id = 'binding-a'"
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "DELETE FROM provider_identity WHERE provider_identity_id = 'provider-a'"
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "DELETE FROM accounts WHERE account_id = 'account-a'"
            )


@pytest.mark.parametrize(
    ("old_state", "new_state"),
    (
        ("PENDING", "PENDING_UNLINK"),
        ("PENDING", "REVOKED"),
        ("PENDING", "PENDING"),
        ("ACTIVE", "ACTIVE"),
        ("ACTIVE", "FAILED"),
        ("ACTIVE", "REVOKED"),
        ("ACTIVE", "PENDING"),
        ("PENDING_UNLINK", "PENDING"),
        ("PENDING_UNLINK", "FAILED"),
        ("PENDING_UNLINK", "PENDING_UNLINK"),
        ("REVOKED", "ACTIVE"),
        ("REVOKED", "PENDING_UNLINK"),
        ("REVOKED", "FAILED"),
        ("REVOKED", "REVOKED"),
        ("FAILED", "ACTIVE"),
        ("FAILED", "PENDING_UNLINK"),
        ("FAILED", "REVOKED"),
        ("FAILED", "FAILED"),
    ),
)
def test_forbidden_lifecycle_transitions(
    schema_database: Path,
    old_state: str,
    new_state: str,
) -> None:
    with _connection(schema_database) as connection:
        _add_account(connection, "account-a")
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )
        _add_pending_binding(connection, "binding-a", "account-a", "provider-a")

        state = "PENDING"
        version = 1
        if old_state == "ACTIVE":
            state = "ACTIVE"
            version = 2
            connection.execute(
                """
                UPDATE account_identity_binding
                SET state = 'ACTIVE', binding_version = 2
                WHERE binding_id = 'binding-a'
                """
            )
        elif old_state == "PENDING_UNLINK":
            for next_state, next_version in (("ACTIVE", 2), ("PENDING_UNLINK", 3)):
                connection.execute(
                    """
                    UPDATE account_identity_binding
                    SET state = ?, binding_version = ?
                    WHERE binding_id = 'binding-a'
                    """,
                    (next_state, next_version),
                )
            state = "PENDING_UNLINK"
            version = 3
        elif old_state == "REVOKED":
            for next_state, next_version in (
                ("ACTIVE", 2),
                ("PENDING_UNLINK", 3),
                ("REVOKED", 4),
            ):
                connection.execute(
                    """
                    UPDATE account_identity_binding
                    SET state = ?, binding_version = ?
                    WHERE binding_id = 'binding-a'
                    """,
                    (next_state, next_version),
                )
            state = "REVOKED"
            version = 4
        elif old_state == "FAILED":
            connection.execute(
                """
                UPDATE account_identity_binding
                SET state = 'FAILED', binding_version = 2
                WHERE binding_id = 'binding-a'
                """
            )
            state = "FAILED"
            version = 2

        assert state == old_state
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                UPDATE account_identity_binding
                SET state = ?, binding_version = ?
                WHERE binding_id = 'binding-a'
                """,
                (new_state, version + 1),
            )


def test_actual_schema_objects_and_application_only_guarantees(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        objects = {
            row[0]: row[1]
            for row in connection.execute(
                """
                SELECT name, type
                FROM sqlite_schema
                WHERE name NOT LIKE 'sqlite_%'
                """
            )
        }
        assert objects["provider_identity"] == "table"
        assert objects["account_identity_binding"] == "table"
        assert objects["one_owned_binding_per_provider_identity"] == "index"
        assert objects["binding_insert_pending_only"] == "trigger"
        assert objects["binding_update_guard"] == "trigger"
        assert objects["binding_delete_rejected"] == "trigger"
        assert objects["binding_reject_provider_delete"] == "trigger"
        assert objects["provider_identity_key_immutable"] == "trigger"

        binding_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(account_identity_binding)")
        }
        assert binding_columns == {
            "binding_id",
            "account_id",
            "provider_identity_id",
            "state",
            "binding_version",
        }
        assert not binding_columns.intersection(
            {
                "proof_reference",
                "confirmation_reference",
                "recovery_evidence",
                "last_method",
                "actor_authority",
            }
        )


def test_raw_connection_requires_external_foreign_key_initialization(
    schema_database: Path,
) -> None:
    with sqlite3.connect(schema_database, isolation_level=None) as connection:
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 0
        connection.execute("INSERT INTO provider_identity VALUES (?, ?, ?, ?)",
                           ("provider-a", "adapter-a", "issuer", "subject"))
        connection.execute(
            """
            INSERT INTO account_identity_binding(
                binding_id, account_id, provider_identity_id, state, binding_version
            ) VALUES ('binding-a', 'missing-account', 'provider-a', 'PENDING', 1)
            """
        )
        assert connection.execute(
            "SELECT COUNT(*) FROM account_identity_binding"
        ).fetchone()[0] == 1


def test_direct_sql_activation_has_no_sql_proof_or_confirmation_fields(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        _add_account(connection, "account-a")
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )
        _add_pending_binding(connection, "binding-a", "account-a", "provider-a")

        connection.execute(
            """
            UPDATE account_identity_binding
            SET state = 'ACTIVE', binding_version = 2
            WHERE binding_id = 'binding-a'
            """
        )
        assert connection.execute(
            """
            SELECT state, binding_version
            FROM account_identity_binding WHERE binding_id = 'binding-a'
            """
        ).fetchone() == ("ACTIVE", 2)


def test_embedded_nul_is_rejected_by_application_and_sql_constraints(
    schema_database: Path,
) -> None:
    issuer = "a" * 2047 + "\u0000" + "z"
    subject = "s" * 1023 + "\u0000" + "z"
    with pytest.raises(ValueError):
        ProviderIdentity(issuer, subject)

    assert len(issuer) == 2049
    assert len(subject) == 1025
    with _connection(schema_database) as connection:
        with pytest.raises(sqlite3.IntegrityError):
            _add_provider_identity(
                connection,
                "provider-nul-boundary",
                "adapter-a",
                issuer,
                subject,
            )


def test_float_identity_is_coerced_by_sql_affinity(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        connection.execute(
            """
            INSERT INTO provider_identity(
                provider_identity_id, adapter_id, issuer_namespace, subject_key
            ) VALUES ('provider-float', 'adapter-a', 12.3, 45.6)
            """
        )
        row = connection.execute(
            """
            SELECT typeof(issuer_namespace), issuer_namespace,
                   typeof(subject_key), subject_key
            FROM provider_identity WHERE provider_identity_id = 'provider-float'
            """
        ).fetchone()
    assert row == ("text", "12.3", "text", "45.6")


def test_unicode_canonical_equivalents_remain_distinct(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        _add_provider_identity(
            connection, "provider-nfd", "adapter-a", "e\u0301", "subject"
        )
        _add_provider_identity(
            connection, "provider-nfc", "adapter-a", "\u00e9", "subject"
        )
        rows = connection.execute(
            """
            SELECT issuer_namespace, count(*)
            FROM provider_identity
            WHERE provider_identity_id IN ('provider-nfd', 'provider-nfc')
            GROUP BY issuer_namespace
            ORDER BY issuer_namespace
            """
        ).fetchall()

    assert rows == [("e\u0301", 1), ("\u00e9", 1)]


def test_concurrent_pending_duplicate_insert_allows_one_binding(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        _add_account(connection, "account-a")
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )

    start = Barrier(2)

    def insert(binding_id: str) -> bool:
        with _connection(schema_database) as connection:
            start.wait(timeout=5)
            connection.execute("BEGIN IMMEDIATE")
            try:
                connection.execute(
                    """
                    INSERT INTO account_identity_binding(
                        binding_id, account_id, provider_identity_id, state, binding_version
                    ) VALUES (?, 'account-a', 'provider-a', 'PENDING', 1)
                    """,
                    (binding_id,),
                )
            except sqlite3.IntegrityError:
                connection.execute("ROLLBACK")
                return False
            connection.execute("COMMIT")
            return True

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(insert, ("binding-a", "binding-b")))

    assert sorted(outcomes) == [False, True]
    with _connection(schema_database) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM account_identity_binding"
        ).fetchone()[0] == 1


def test_binding_version_affinity_observation_requires_application_guard(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        _add_account(connection, "account-a")
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )
        for binding_id, binding_version in (
            ("binding-text", "1"),
            ("binding-float", 1.0),
        ):
            provider_id = "provider-a" if binding_id == "binding-text" else "provider-b"
            if provider_id == "provider-b":
                _add_provider_identity(
                    connection,
                    "provider-b",
                    "adapter-b",
                    "issuer-b",
                    "subject-b",
                )
            connection.execute(
                """
                INSERT INTO account_identity_binding(
                    binding_id, account_id, provider_identity_id, state, binding_version
                ) VALUES (?, 'account-a', ?, 'PENDING', ?)
                """,
                (binding_id, provider_id, binding_version),
            )
            row = connection.execute(
                """
                SELECT typeof(binding_version), binding_version
                FROM account_identity_binding WHERE binding_id = ?
                """,
                (binding_id,),
            ).fetchone()
            assert row == ("integer", 1)


@pytest.mark.parametrize("value", (None, True, False, "1", 1.0, 1.2, 0, -1))
def test_application_binding_version_guard_rejects_malformed_values(value: object) -> None:
    with pytest.raises(ValueError):
        _validate_binding_version(value)


def test_application_binding_version_guard_accepts_positive_integer() -> None:
    assert _validate_binding_version(1) == 1
    assert _validate_binding_version(2) == 2


def test_application_sqlite_stores_enable_and_verify_foreign_keys(tmp_path: Path) -> None:
    stores = (
        SQLiteSessionRepository(
            tmp_path / "sessions.sqlite3",
            integrity_key=b"s" * 32,
        ),
        SQLitePendingApprovalStore(
            tmp_path / "approvals.sqlite3",
            b"a" * 32,
        ),
        SQLiteMemoryRepository(tmp_path / "memories.sqlite3"),
    )

    for store in stores:
        with store._connection() as connection:
            assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_schema_writer_can_remove_trigger_protections(
    schema_database: Path,
) -> None:
    with _connection(schema_database) as connection:
        connection.execute("DROP TRIGGER binding_insert_pending_only")
        connection.execute("DROP TRIGGER binding_update_guard")

        _add_account(connection, "account-a")
        _add_provider_identity(
            connection, "provider-a", "adapter-a", "issuer", "subject"
        )
        connection.execute(
            """
            INSERT INTO account_identity_binding(
                binding_id, account_id, provider_identity_id, state, binding_version
            ) VALUES ('direct-active', 'account-a', 'provider-a', 'ACTIVE', 1)
            """
        )
        assert connection.execute(
            """
            SELECT state, binding_version
            FROM account_identity_binding WHERE binding_id = 'direct-active'
            """
        ).fetchone() == ("ACTIVE", 1)
