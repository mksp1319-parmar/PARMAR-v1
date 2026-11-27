"""Disposable reference rehearsal for a single transactional authority.

This fixture is not application code, a migration, or an approved production
architecture. It demonstrates only the local SQLite transaction and fencing
properties asserted below, using synthetic identifiers and data.
"""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import sqlite3
import threading
from pathlib import Path

import pytest


class _LeaseLost(Exception):
    pass


@contextmanager
def _connection(path: Path):
    connection = sqlite3.connect(path, timeout=10, isolation_level=None)
    connection.execute("PRAGMA foreign_keys=ON")
    if connection.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
        connection.close()
        raise RuntimeError("SQLite foreign-key enforcement is unavailable.")
    try:
        yield connection
    finally:
        connection.close()


@contextmanager
def _write(path: Path):
    with _connection(path) as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            yield connection
        except Exception:
            connection.rollback()
            raise
        else:
            connection.commit()


def _initialize(path: Path) -> None:
    with _connection(path) as connection:
        connection.executescript(
            """
            CREATE TABLE accounts (
                account_id TEXT PRIMARY KEY,
                status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'DISABLED')),
                security_epoch INTEGER NOT NULL CHECK(security_epoch > 0)
            );
            CREATE TABLE sessions (
                session_id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES accounts(account_id),
                security_epoch INTEGER NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'REVOKED'))
            );
            CREATE TABLE approvals (
                approval_id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES accounts(account_id),
                security_epoch INTEGER NOT NULL,
                state TEXT NOT NULL CHECK(state IN ('APPROVED', 'CANCELLED', 'CONSUMED'))
            );
            CREATE TABLE lifecycle_operations (
                operation_id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES accounts(account_id),
                operation TEXT NOT NULL,
                security_epoch INTEGER NOT NULL
            );
            CREATE TABLE effects (
                effect_id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES accounts(account_id),
                operation_id TEXT NOT NULL UNIQUE
                    REFERENCES lifecycle_operations(operation_id)
            );
            CREATE TABLE outbox (
                event_id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES accounts(account_id),
                state TEXT NOT NULL CHECK(state IN ('READY', 'LEASED', 'COMPLETE', 'FAILED')),
                lease_owner TEXT,
                lease_until INTEGER NOT NULL DEFAULT 0,
                lease_epoch INTEGER NOT NULL DEFAULT 0,
                effect_id TEXT NOT NULL UNIQUE
            );
            CREATE TABLE delivered_effects (
                effect_id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL UNIQUE REFERENCES outbox(event_id)
            );
            CREATE TABLE audit_events (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL UNIQUE,
                account_id TEXT NOT NULL,
                event_type TEXT NOT NULL
            );
            INSERT INTO accounts VALUES ('account-synthetic', 'ACTIVE', 1);
            INSERT INTO sessions VALUES ('session-synthetic', 'account-synthetic', 1, 'ACTIVE');
            INSERT INTO approvals VALUES ('approval-synthetic', 'account-synthetic', 1, 'APPROVED');
            """
        )


@pytest.fixture
def authority_db(tmp_path: Path) -> Path:
    path = tmp_path / "synthetic-authority.sqlite3"
    _initialize(path)
    return path


def _disable_account(path: Path, operation_id: str, *, fail_before_commit: bool = False) -> int:
    with _write(path) as connection:
        previous = connection.execute(
            "SELECT security_epoch FROM lifecycle_operations WHERE operation_id = ?",
            (operation_id,),
        ).fetchone()
        if previous is not None:
            return previous[0]
        account = connection.execute(
            "SELECT status, security_epoch FROM accounts WHERE account_id = ?",
            ("account-synthetic",),
        ).fetchone()
        if account is None:
            raise ValueError("Synthetic account is missing.")
        if account[0] == "ACTIVE":
            epoch = account[1] + 1
            connection.execute(
                "UPDATE accounts SET status='DISABLED', security_epoch=? WHERE account_id=?",
                (epoch, "account-synthetic"),
            )
            connection.execute(
                "UPDATE sessions SET status='REVOKED' "
                "WHERE account_id=? AND status='ACTIVE'",
                ("account-synthetic",),
            )
            connection.execute(
                "UPDATE approvals SET state='CANCELLED' "
                "WHERE account_id=? AND state='APPROVED'",
                ("account-synthetic",),
            )
        else:
            epoch = account[1]
        event_id = f"account-disabled:{operation_id}"
        connection.execute(
            "INSERT INTO lifecycle_operations VALUES (?, ?, 'DISABLE', ?)",
            (operation_id, "account-synthetic", epoch),
        )
        connection.execute(
            "INSERT OR IGNORE INTO outbox(event_id, account_id, state, effect_id) "
            "VALUES (?, ?, 'READY', ?)",
            (event_id, "account-synthetic", event_id),
        )
        connection.execute(
            "INSERT OR IGNORE INTO audit_events(event_id, account_id, event_type) "
            "VALUES (?, ?, 'ACCOUNT_DISABLED')",
            (event_id, "account-synthetic"),
        )
        if fail_before_commit:
            raise RuntimeError("Injected failure before lifecycle commit.")
        return epoch


def _apply_protected_local_effect(path: Path, operation_id: str) -> bool:
    with _write(path) as connection:
        existing = connection.execute(
            "SELECT 1 FROM effects WHERE operation_id = ?",
            (operation_id,),
        ).fetchone()
        if existing is not None:
            return False
        account = connection.execute(
            "SELECT status, security_epoch FROM accounts WHERE account_id=?",
            ("account-synthetic",),
        ).fetchone()
        session = connection.execute(
            "SELECT security_epoch, status FROM sessions WHERE session_id=?",
            ("session-synthetic",),
        ).fetchone()
        approval = connection.execute(
            "SELECT security_epoch, state FROM approvals WHERE approval_id=?",
            ("approval-synthetic",),
        ).fetchone()
        if (
            account is None
            or account != ("ACTIVE", 1)
            or session != (account[1], "ACTIVE")
            or approval != (account[1], "APPROVED")
        ):
            return False
        connection.execute(
            "INSERT INTO lifecycle_operations VALUES (?, ?, 'PROTECTED_LOCAL_EFFECT', ?)",
            (operation_id, "account-synthetic", account[1]),
        )
        connection.execute(
            "UPDATE approvals SET state='CONSUMED' WHERE approval_id=? AND state='APPROVED'",
            ("approval-synthetic",),
        )
        connection.execute(
            "INSERT INTO effects VALUES (?, ?, ?)",
            (operation_id, "account-synthetic", operation_id),
        )
        connection.execute(
            "INSERT INTO audit_events(event_id, account_id, event_type) VALUES (?, ?, ?)",
            (f"effect:{operation_id}", "account-synthetic", "PROTECTED_LOCAL_EFFECT"),
        )
        return True


def _claim_outbox(path: Path, worker: str, now: int, lease_seconds: int) -> tuple[str, int] | None:
    with _write(path) as connection:
        row = connection.execute(
            "SELECT event_id, lease_epoch FROM outbox "
            "WHERE state='READY' OR (state='LEASED' AND lease_until <= ?) "
            "ORDER BY event_id LIMIT 1",
            (now,),
        ).fetchone()
        if row is None:
            return None
        event_id, prior_epoch = row
        epoch = prior_epoch + 1
        cursor = connection.execute(
            "UPDATE outbox SET state='LEASED', lease_owner=?, lease_until=?, lease_epoch=? "
            "WHERE event_id=? AND lease_epoch=? AND (state='READY' OR lease_until <= ?)",
            (worker, now + lease_seconds, epoch, event_id, prior_epoch, now),
        )
        if cursor.rowcount != 1:
            return None
        return event_id, epoch


def _deliver_outbox(
    path: Path,
    event_id: str,
    worker: str,
    epoch: int,
    now: int,
    *,
    fail_before_commit: bool = False,
) -> bool:
    try:
        with _write(path) as connection:
            row = connection.execute(
                "SELECT state, lease_owner, lease_until, lease_epoch, effect_id "
                "FROM outbox WHERE event_id=?",
                (event_id,),
            ).fetchone()
            if (
                row is None
                or row[0] != "LEASED"
                or row[1] != worker
                or row[2] <= now
                or row[3] != epoch
            ):
                return False
            connection.execute(
                "INSERT OR IGNORE INTO delivered_effects(effect_id, event_id) VALUES (?, ?)",
                (row[4], event_id),
            )
            cursor = connection.execute(
                "UPDATE outbox SET state='COMPLETE' "
                "WHERE event_id=? AND state='LEASED' AND lease_owner=? "
                "AND lease_epoch=? AND lease_until>?",
                (event_id, worker, epoch, now),
            )
            if cursor.rowcount != 1:
                raise _LeaseLost
            if fail_before_commit:
                raise RuntimeError("Injected failure before delivery commit.")
            return True
    except _LeaseLost:
        return False


def test_disable_is_one_transaction_for_epoch_session_approval_audit_and_outbox(authority_db):
    epoch = _disable_account(authority_db, "disable-op-1")
    assert _disable_account(authority_db, "disable-op-1") == epoch == 2
    with _connection(authority_db) as connection:
        assert connection.execute(
            "SELECT status, security_epoch FROM accounts"
        ).fetchone() == ("DISABLED", 2)
        assert connection.execute("SELECT status FROM sessions").fetchone() == ("REVOKED",)
        assert connection.execute("SELECT state FROM approvals").fetchone() == ("CANCELLED",)
        assert connection.execute("SELECT count(*) FROM outbox").fetchone()[0] == 1
        assert connection.execute("SELECT count(*) FROM audit_events").fetchone()[0] == 1


def test_disable_failure_rolls_back_all_authority_and_reconciliation_state(authority_db):
    with pytest.raises(RuntimeError, match="Injected failure"):
        _disable_account(authority_db, "disable-op-failed", fail_before_commit=True)
    with _connection(authority_db) as connection:
        assert connection.execute(
            "SELECT status, security_epoch FROM accounts"
        ).fetchone() == ("ACTIVE", 1)
        assert connection.execute("SELECT status FROM sessions").fetchone() == ("ACTIVE",)
        assert connection.execute("SELECT state FROM approvals").fetchone() == ("APPROVED",)
        assert connection.execute("SELECT count(*) FROM outbox").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM audit_events").fetchone()[0] == 0


@pytest.mark.parametrize("table", ["sessions", "approvals"])
def test_disable_invalidation_failure_rolls_back_entire_lifecycle(authority_db, table):
    with _connection(authority_db) as connection:
        connection.execute(
            f"CREATE TRIGGER reject_invalidation BEFORE UPDATE ON {table} "
            "BEGIN SELECT RAISE(ABORT, 'injected invalidation failure'); END"
        )

    with pytest.raises(sqlite3.IntegrityError, match="injected invalidation failure"):
        _disable_account(authority_db, "disable-invalidation-failure")
    with _connection(authority_db) as connection:
        assert connection.execute(
            "SELECT status, security_epoch FROM accounts"
        ).fetchone() == ("ACTIVE", 1)
        assert connection.execute("SELECT status FROM sessions").fetchone() == ("ACTIVE",)
        assert connection.execute("SELECT state FROM approvals").fetchone() == ("APPROVED",)
        assert connection.execute("SELECT count(*) FROM lifecycle_operations").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM outbox").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM audit_events").fetchone()[0] == 0


@pytest.mark.parametrize("table", ["outbox", "audit_events"])
def test_disable_durable_evidence_enqueue_failure_rolls_back_lifecycle(authority_db, table):
    with _connection(authority_db) as connection:
        connection.execute(
            f"CREATE TRIGGER reject_evidence BEFORE INSERT ON {table} "
            "BEGIN SELECT RAISE(ABORT, 'injected evidence enqueue failure'); END"
        )

    with pytest.raises(sqlite3.IntegrityError, match="injected evidence enqueue failure"):
        _disable_account(authority_db, "disable-evidence-failure")
    with _connection(authority_db) as connection:
        assert connection.execute(
            "SELECT status, security_epoch FROM accounts"
        ).fetchone() == ("ACTIVE", 1)
        assert connection.execute("SELECT status FROM sessions").fetchone() == ("ACTIVE",)
        assert connection.execute("SELECT state FROM approvals").fetchone() == ("APPROVED",)
        assert connection.execute("SELECT count(*) FROM lifecycle_operations").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM outbox").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM audit_events").fetchone()[0] == 0


def test_protected_local_effect_is_serialized_before_or_denied_after_disable(authority_db):
    assert _apply_protected_local_effect(authority_db, "effect-before-disable")
    _disable_account(authority_db, "disable-after-effect")
    assert not _apply_protected_local_effect(authority_db, "effect-after-disable")
    with _connection(authority_db) as connection:
        effect_sequence = connection.execute(
            "SELECT sequence FROM audit_events WHERE event_type='PROTECTED_LOCAL_EFFECT'"
        ).fetchone()[0]
        disable_sequence = connection.execute(
            "SELECT sequence FROM audit_events WHERE event_type='ACCOUNT_DISABLED'"
        ).fetchone()[0]
        assert effect_sequence < disable_sequence
        assert connection.execute("SELECT count(*) FROM effects").fetchone()[0] == 1


def test_concurrent_protected_effect_and_disable_have_a_single_database_order(authority_db):
    barrier = threading.Barrier(2)

    def apply():
        barrier.wait()
        return _apply_protected_local_effect(authority_db, "racing-effect")

    def disable():
        barrier.wait()
        return _disable_account(authority_db, "racing-disable")

    with ThreadPoolExecutor(max_workers=2) as executor:
        effect = executor.submit(apply)
        disablement = executor.submit(disable)
        effect.result(timeout=10)
        disablement.result(timeout=10)

    with _connection(authority_db) as connection:
        assert connection.execute(
            "SELECT status, security_epoch FROM accounts"
        ).fetchone() == ("DISABLED", 2)
        assert connection.execute("SELECT status FROM sessions").fetchone() == ("REVOKED",)
        effects = connection.execute(
            "SELECT event_id FROM audit_events WHERE event_type='PROTECTED_LOCAL_EFFECT'"
        ).fetchall()
        if effects:
            effect_sequence = connection.execute(
                "SELECT sequence FROM audit_events "
                "WHERE event_type='PROTECTED_LOCAL_EFFECT'"
            ).fetchone()[0]
            disable_sequence = connection.execute(
                "SELECT sequence FROM audit_events "
                "WHERE event_type='ACCOUNT_DISABLED'"
            ).fetchone()[0]
            assert effect_sequence < disable_sequence
            assert connection.execute(
                "SELECT state FROM approvals"
            ).fetchone() == ("CONSUMED",)
        else:
            assert connection.execute(
                "SELECT count(*) FROM audit_events WHERE event_type='ACCOUNT_DISABLED'"
            ).fetchone()[0] == 1
            assert connection.execute("SELECT state FROM approvals").fetchone() == ("CANCELLED",)


def test_expired_outbox_lease_fences_old_worker_and_retry_is_idempotent(authority_db):
    _disable_account(authority_db, "disable-for-outbox")
    first = _claim_outbox(authority_db, "worker-old", now=10, lease_seconds=5)
    assert first is not None
    event_id, first_epoch = first
    second = _claim_outbox(authority_db, "worker-new", now=16, lease_seconds=5)
    assert second == (event_id, first_epoch + 1)
    assert not _deliver_outbox(
        authority_db,
        event_id,
        "worker-old",
        first_epoch,
        now=16,
    )
    assert _deliver_outbox(
        authority_db,
        event_id,
        "worker-new",
        second[1],
        now=16,
    )
    assert not _deliver_outbox(
        authority_db,
        event_id,
        "worker-new",
        second[1],
        now=16,
    )
    with _connection(authority_db) as connection:
        assert connection.execute("SELECT state FROM outbox").fetchone() == ("COMPLETE",)
        assert connection.execute("SELECT count(*) FROM delivered_effects").fetchone()[0] == 1


def test_delivery_crash_rolls_back_effect_and_completion_then_retry_succeeds(authority_db):
    _disable_account(authority_db, "disable-before-delivery")
    claim = _claim_outbox(authority_db, "worker-one", now=100, lease_seconds=5)
    assert claim is not None
    event_id, epoch = claim
    with pytest.raises(RuntimeError, match="Injected failure"):
        _deliver_outbox(
            authority_db,
            event_id,
            "worker-one",
            epoch,
            now=101,
            fail_before_commit=True,
        )
    with _connection(authority_db) as connection:
        assert connection.execute("SELECT state FROM outbox").fetchone() == ("LEASED",)
        assert connection.execute("SELECT count(*) FROM delivered_effects").fetchone()[0] == 0
    takeover = _claim_outbox(authority_db, "worker-two", now=106, lease_seconds=5)
    assert takeover == (event_id, epoch + 1)
    assert _deliver_outbox(
        authority_db,
        event_id,
        "worker-two",
        takeover[1],
        now=106,
    )


def test_fenced_outbox_update_rolls_back_inserted_effect(authority_db):
    _disable_account(authority_db, "disable-before-fenced-update")
    claim = _claim_outbox(authority_db, "worker-one", now=100, lease_seconds=5)
    assert claim is not None
    event_id, epoch = claim
    with _connection(authority_db) as connection:
        connection.execute(
            "CREATE TRIGGER suppress_outbox_completion "
            "BEFORE UPDATE OF state ON outbox "
            "WHEN NEW.state='COMPLETE' BEGIN SELECT RAISE(IGNORE); END"
        )

    assert not _deliver_outbox(authority_db, event_id, "worker-one", epoch, now=101)
    with _connection(authority_db) as connection:
        assert connection.execute("SELECT state FROM outbox").fetchone() == ("LEASED",)
        assert connection.execute("SELECT count(*) FROM delivered_effects").fetchone()[0] == 0


def test_terminal_outbox_failure_cannot_be_claimed_or_delivered(authority_db):
    _disable_account(authority_db, "disable-before-terminal-failure")
    claim = _claim_outbox(authority_db, "worker-one", now=100, lease_seconds=5)
    assert claim is not None
    event_id, epoch = claim
    with _connection(authority_db) as connection:
        connection.execute(
            "UPDATE outbox SET state='FAILED' WHERE event_id=? AND lease_epoch=?",
            (event_id, epoch),
        )

    assert _claim_outbox(authority_db, "worker-retry", now=106, lease_seconds=5) is None
    assert not _deliver_outbox(authority_db, event_id, "worker-one", epoch, now=101)
    with _connection(authority_db) as connection:
        assert connection.execute("SELECT state FROM outbox").fetchone() == ("FAILED",)
        assert connection.execute("SELECT count(*) FROM delivered_effects").fetchone()[0] == 0


def test_unknown_or_stale_session_and_approval_fail_closed(authority_db):
    with _connection(authority_db) as connection:
        connection.execute("UPDATE sessions SET security_epoch=0")
    assert not _apply_protected_local_effect(authority_db, "stale-session")
    with _connection(authority_db) as connection:
        assert connection.execute("SELECT count(*) FROM effects").fetchone()[0] == 0
