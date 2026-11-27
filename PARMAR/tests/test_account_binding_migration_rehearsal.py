"""Disposable migration/recovery rehearsal; not a production migration."""

import hashlib
import json
import sqlite3
from pathlib import Path

import pytest

from PARMAR.identity_contracts import ProviderIdentity


def _connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path, timeout=10, isolation_level=None)
    connection.execute("PRAGMA foreign_keys=ON")
    if connection.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
        connection.close()
        raise RuntimeError("SQLite foreign-key enforcement is unavailable.")
    return connection


def _create_source(path: Path, rows: list[tuple[str, str, str, str]]) -> None:
    with _connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE source_accounts(account_id TEXT PRIMARY KEY);
            CREATE TABLE legacy_bindings(
                source_row_id TEXT PRIMARY KEY,
                issuer TEXT NOT NULL,
                subject TEXT NOT NULL,
                account_id TEXT NOT NULL
            );
            """
        )
        account_ids = sorted({row[3] for row in rows if row[3] != "missing-account"})
        connection.executemany(
            "INSERT INTO source_accounts(account_id) VALUES (?)",
            ((account_id,) for account_id in account_ids),
        )
        connection.executemany(
            "INSERT INTO legacy_bindings VALUES (?, ?, ?, ?)",
            rows,
        )


def _create_destination(path: Path, accounts: set[str]) -> None:
    with _connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE accounts(account_id TEXT PRIMARY KEY);
            CREATE TABLE migration_runs(
                migration_id TEXT PRIMARY KEY,
                source_digest TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('COMPLETE'))
            );
            CREATE TABLE migration_review_rows(
                migration_id TEXT NOT NULL REFERENCES migration_runs(migration_id),
                source_row_id TEXT NOT NULL,
                disposition TEXT NOT NULL CHECK(disposition IN (
                    'REVIEW_REQUIRED',
                    'QUARANTINE_DUPLICATE',
                    'QUARANTINE_CONFLICT',
                    'QUARANTINE_ORPHAN',
                    'QUARANTINE_INVALID'
                )),
                PRIMARY KEY(migration_id, source_row_id)
            );
            """
        )
        connection.executemany(
            "INSERT INTO accounts(account_id) VALUES (?)",
            ((account_id,) for account_id in sorted(accounts)),
        )


def _source_snapshot(path: Path) -> list[tuple[str, str, str, str]]:
    with _connect(path) as connection:
        return connection.execute(
            "SELECT source_row_id, issuer, subject, account_id "
            "FROM legacy_bindings ORDER BY source_row_id"
        ).fetchall()


def _source_digest(rows: list[tuple[str, str, str, str]]) -> str:
    encoded = json.dumps(rows, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _classify_rows(
    rows: list[tuple[str, str, str, str]],
    destination_accounts: set[str],
) -> dict[str, str]:
    grouped: dict[tuple[str, str], list[tuple[str, str]]] = {}
    invalid: set[str] = set()
    for row_id, issuer, subject, account_id in rows:
        try:
            identity = ProviderIdentity(issuer, subject)
        except ValueError:
            invalid.add(row_id)
            continue
        grouped.setdefault((identity.issuer, identity.subject), []).append(
            (row_id, account_id)
        )

    dispositions: dict[str, str] = {
        row_id: "QUARANTINE_INVALID" for row_id in invalid
    }
    for members in grouped.values():
        if len(members) > 1:
            owner_ids = {account_id for _row_id, account_id in members}
            status = (
                "QUARANTINE_CONFLICT"
                if len(owner_ids) > 1
                else "QUARANTINE_DUPLICATE"
            )
            dispositions.update((row_id, status) for row_id, _owner in members)
            continue
        row_id, account_id = members[0]
        dispositions[row_id] = (
            "REVIEW_REQUIRED"
            if account_id in destination_accounts
            else "QUARANTINE_ORPHAN"
        )
    return dispositions


def _run_synthetic_migration(
    source_path: Path,
    destination_path: Path,
    migration_id: str,
    *,
    fail_after_rows: int | None = None,
) -> dict[str, int]:
    rows = _source_snapshot(source_path)
    digest = _source_digest(rows)
    dispositions_by_row = _classify_rows(
        rows,
        {
            row[0]
            for row in _query(destination_path, "SELECT account_id FROM accounts")
        },
    )
    connection = _connect(destination_path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        existing = connection.execute(
            "SELECT source_digest, status FROM migration_runs WHERE migration_id=?",
            (migration_id,),
        ).fetchone()
        if existing is not None:
            if existing != (digest, "COMPLETE"):
                raise RuntimeError("Migration ID is bound to different source evidence.")
            result = connection.execute(
                "SELECT disposition, count(*) FROM migration_review_rows "
                "WHERE migration_id=? GROUP BY disposition",
                (migration_id,),
            ).fetchall()
            connection.commit()
            return dict(result)
        connection.execute(
            "INSERT INTO migration_runs VALUES (?, ?, 'COMPLETE')",
            (migration_id, digest),
        )
        for index, (row_id, _issuer, _subject, _account_id) in enumerate(rows, start=1):
            connection.execute(
                "INSERT INTO migration_review_rows VALUES (?, ?, ?)",
                (migration_id, row_id, dispositions_by_row[row_id]),
            )
            if fail_after_rows == index:
                raise RuntimeError("Injected interruption during synthetic migration.")
        connection.commit()
        return {
            disposition: count
            for disposition, count in connection.execute(
                "SELECT disposition, count(*) FROM migration_review_rows "
                "WHERE migration_id=? GROUP BY disposition",
                (migration_id,),
            )
        }
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise
    finally:
        connection.close()


def _query(path: Path, statement: str) -> list[tuple]:
    with _connect(path) as connection:
        return connection.execute(statement).fetchall()


def _backup_restore(source: Path, backup: Path, restored: Path) -> None:
    with _connect(source) as source_connection, _connect(backup) as backup_connection:
        source_connection.backup(backup_connection)
    with _connect(backup) as backup_connection, _connect(restored) as restored_connection:
        backup_connection.backup(restored_connection)
        assert restored_connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert restored_connection.execute("PRAGMA foreign_key_check").fetchall() == []


@pytest.fixture
def migration_databases(tmp_path: Path):
    rows = [
        ("unique", "https://issuer.synthetic", "subject-a", "account-a"),
        ("duplicate-a", "https://issuer.synthetic", "subject-b", "account-a"),
        ("duplicate-b", "https://issuer.synthetic", "subject-b", "account-a"),
        ("conflict-a", "https://issuer.synthetic", "subject-c", "account-a"),
        ("conflict-b", "https://issuer.synthetic", "subject-c", "account-b"),
        ("orphan", "https://issuer.synthetic", "subject-d", "missing-account"),
        ("invalid-nul", "https://issuer.synthetic", "subject\u0000bad", "account-a"),
    ]
    source = tmp_path / "synthetic-source.sqlite3"
    destination = tmp_path / "synthetic-destination.sqlite3"
    _create_source(source, rows)
    _create_destination(destination, {"account-a", "account-b"})
    return source, destination, rows


def test_synthetic_migration_quarantines_ambiguity_and_never_activates(migration_databases):
    source, destination, rows = migration_databases
    result = _run_synthetic_migration(source, destination, "migration-synthetic-1")
    assert result == {
        "QUARANTINE_CONFLICT": 2,
        "QUARANTINE_DUPLICATE": 2,
        "QUARANTINE_INVALID": 1,
        "QUARANTINE_ORPHAN": 1,
        "REVIEW_REQUIRED": 1,
    }
    assert len(_query(destination, "SELECT * FROM migration_review_rows")) == len(rows)
    assert _query(destination, "SELECT status FROM migration_runs") == [("COMPLETE",)]
    assert _query(destination, "SELECT count(*) FROM accounts") == [(2,)]


def test_synthetic_migration_interruption_rolls_back_and_restart_is_idempotent(
    migration_databases,
):
    source, destination, _rows = migration_databases
    with pytest.raises(RuntimeError, match="Injected interruption"):
        _run_synthetic_migration(
            source,
            destination,
            "migration-synthetic-2",
            fail_after_rows=3,
        )
    assert _query(destination, "SELECT count(*) FROM migration_runs") == [(0,)]
    assert _query(destination, "SELECT count(*) FROM migration_review_rows") == [(0,)]

    first = _run_synthetic_migration(source, destination, "migration-synthetic-2")
    second = _run_synthetic_migration(source, destination, "migration-synthetic-2")
    assert first == second
    assert len(_query(destination, "SELECT * FROM migration_review_rows")) == 7


def test_synthetic_migration_id_cannot_be_replayed_with_changed_source(migration_databases):
    source, destination, _rows = migration_databases
    _run_synthetic_migration(source, destination, "migration-synthetic-3")
    with _connect(source) as connection:
        connection.execute(
            "UPDATE legacy_bindings SET subject='changed' WHERE source_row_id='unique'"
        )
    with pytest.raises(RuntimeError, match="different source evidence"):
        _run_synthetic_migration(source, destination, "migration-synthetic-3")
    assert _query(destination, "SELECT count(*) FROM migration_review_rows") == [(7,)]


def test_synthetic_backup_restore_and_rollback_snapshot_preserve_authority_state(
    migration_databases,
    tmp_path,
):
    source, destination, _rows = migration_databases
    backup = tmp_path / "synthetic-before-migration.sqlite3"
    restored = tmp_path / "synthetic-restored.sqlite3"
    _backup_restore(destination, backup, restored)
    _run_synthetic_migration(source, destination, "migration-synthetic-4")
    assert _query(destination, "SELECT count(*) FROM migration_runs") == [(1,)]
    assert _query(restored, "SELECT count(*) FROM migration_runs") == [(0,)]
    assert _query(restored, "SELECT count(*) FROM accounts") == [(2,)]
