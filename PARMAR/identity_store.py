"""Persistent PARMAR account, profile, and workspace identity foundations.

Identity and membership are derived from authenticated server context. This
module does not authenticate users or provide an external login integration.
"""

from __future__ import annotations

import os
import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Iterator, Protocol
from uuid import UUID, uuid4

from PARMAR.identity_contracts import (
    AccountIdentity,
    ProviderAccountBindingLookup,
    ProviderIdentity,
)

MAX_PROFILE_NAME_LENGTH = 80
MAX_WORKSPACE_NAME_LENGTH = 100


class IdentityStorageUnavailable(RuntimeError):
    """Raised when local profile/workspace storage cannot be trusted."""


class IdentityAccessDenied(RuntimeError):
    """Raised when the caller does not own or belong to an identity resource."""


class IdentityRecordConflict(RuntimeError):
    """Raised when account provisioning collides with an existing identity."""


class AccountStatus(str, Enum):
    ACTIVE = "ACTIVE"
    DISABLED = "DISABLED"


@dataclass(frozen=True)
class AccountRecord:
    account_identity: AccountIdentity
    created_at: datetime
    status: AccountStatus


@dataclass(frozen=True)
class Profile:
    profile_id: UUID
    owner_user_id: UUID
    name: str
    created_at: datetime


@dataclass(frozen=True)
class Workspace:
    workspace_id: UUID
    owner_user_id: UUID
    name: str
    role: str
    created_at: datetime


class AccountProvisioner(Protocol):
    """Internal server-side boundary for PARMAR account provisioning."""

    def provision_account(self) -> AccountRecord:
        """Create a new account without accepting a client-selected identity."""
        ...


class AccountRegistry(ProviderAccountBindingLookup, Protocol):
    """Read-only trusted lookups for PARMAR account records and bindings."""

    def get_account(self, account_identity: AccountIdentity) -> AccountRecord | None: ...

    def account_exists(self, account_identity: AccountIdentity) -> bool: ...

    def get_account_status(self, account_identity: AccountIdentity) -> AccountStatus | None: ...


class SQLiteIdentityRepository:
    """SQLite-backed profile/workspace directory and Core account registry."""

    _SCHEMA_VERSION = 3
    _PROVIDER_IDENTITY_STRIP_CHARS = (
        "char(9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 133, 160, 5760, "
        "8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, "
        "8202, 8232, 8233, 8239, 8287, 12288)"
    )

    def __init__(self, database_path: str | Path) -> None:
        path = Path(database_path).expanduser()
        if not str(path):
            raise ValueError("An identity database path is required.")
        self.database_path = path if path.is_absolute() else Path.cwd() / path
        self._lock = threading.RLock()
        self._initialized = False
        self._fresh_database = False
        self._database_identity: tuple[int, int] | None = None

    @classmethod
    def from_environment(
        cls,
        environ: dict[str, str] | None = None,
    ) -> "SQLiteIdentityRepository":
        values = os.environ if environ is None else environ
        configured_path = values.get("PARMAR_IDENTITY_DB_PATH")
        if configured_path is not None and not configured_path.strip():
            raise ValueError("PARMAR_IDENTITY_DB_PATH must not be empty.")
        path = (
            Path(configured_path).expanduser()
            if configured_path is not None
            else Path.home() / ".local" / "share" / "parmar" / "identity.sqlite3"
        )
        return cls(path)

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    @staticmethod
    def _name(value: object, *, limit: int, kind: str) -> str:
        if not isinstance(value, str):
            raise ValueError(f"{kind} name must be a string.")
        normalized = value.strip()
        if not normalized or len(normalized) > limit:
            raise ValueError(f"{kind} name must contain 1 to {limit} characters.")
        return normalized

    @staticmethod
    def _timestamp(value: object) -> datetime:
        try:
            parsed = datetime.fromisoformat(value)
        except (TypeError, ValueError) as error:
            raise IdentityStorageUnavailable("Identity storage is unavailable.") from error
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise IdentityStorageUnavailable("Identity storage is unavailable.")
        return parsed.astimezone(timezone.utc)

    def _prepare_file(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.database_path.is_symlink():
            raise OSError("Identity database must not be a symbolic link.")
        if not self.database_path.exists():
            if self._initialized:
                raise OSError("Identity database is missing.")
            try:
                descriptor = os.open(
                    self.database_path,
                    os.O_CREAT | os.O_EXCL | os.O_WRONLY,
                    0o600,
                )
            except FileExistsError:
                pass
            else:
                os.close(descriptor)
                self._fresh_database = True
        if not self.database_path.is_file():
            raise OSError("Identity database path is not a file.")
        os.chmod(self.database_path, 0o600)
        stat = self.database_path.stat()
        identity = (stat.st_dev, stat.st_ino)
        if self._initialized and identity != self._database_identity:
            raise OSError("Identity database has changed.")

    @staticmethod
    def _validate_base_schema(
        connection: sqlite3.Connection,
        *,
        expected_version: int,
    ) -> None:
        integrity = connection.execute("PRAGMA quick_check").fetchone()
        if integrity is None or integrity[0] != "ok":
            raise IdentityStorageUnavailable("Identity storage is unavailable.")
        if connection.execute("PRAGMA user_version").fetchone()[0] != expected_version:
            raise IdentityStorageUnavailable("Identity storage is unavailable.")
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        if not {"profiles", "workspaces", "workspace_members", "workspace_profiles"}.issubset(tables):
            raise IdentityStorageUnavailable("Identity storage is unavailable.")
        required_columns = {
            "profiles": {"profile_id", "owner_user_id", "name", "created_at"},
            "workspaces": {"workspace_id", "owner_user_id", "name", "created_at"},
            "workspace_members": {"workspace_id", "user_id", "role", "created_at"},
            "workspace_profiles": {
                "workspace_id", "profile_id", "granted_by_user_id", "created_at",
            },
        }
        for table, expected in required_columns.items():
            columns = {
                row["name"]
                for row in connection.execute(f"PRAGMA table_info({table})").fetchall()
            }
            if not expected.issubset(columns):
                raise IdentityStorageUnavailable("Identity storage is unavailable.")
        member_foreign_keys = connection.execute(
            "PRAGMA foreign_key_list(workspace_members)"
        ).fetchall()
        if not any(
            row["table"] == "workspaces" and row["on_delete"] == "CASCADE"
            for row in member_foreign_keys
        ):
            raise IdentityStorageUnavailable("Identity storage is unavailable.")
        profile_foreign_keys = connection.execute(
            "PRAGMA foreign_key_list(workspace_profiles)"
        ).fetchall()
        if not {
            (row["table"], row["on_delete"])
            for row in profile_foreign_keys
        }.issuperset({("profiles", "CASCADE"), ("workspaces", "CASCADE")}):
            raise IdentityStorageUnavailable("Identity storage is unavailable.")

    @classmethod
    def _validate_registry_schema(
        cls,
        connection: sqlite3.Connection,
        *,
        expected_version: int,
    ) -> None:
        cls._validate_base_schema(connection, expected_version=expected_version)
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        if not {"accounts", "provider_account_bindings"}.issubset(tables):
            raise IdentityStorageUnavailable("Identity storage is unavailable.")
        account_columns = {
            row["name"]: row
            for row in connection.execute("PRAGMA table_info(accounts)").fetchall()
        }
        if not {"account_id", "created_at", "status"}.issubset(account_columns):
            raise IdentityStorageUnavailable("Identity storage is unavailable.")
        if account_columns["account_id"]["pk"] != 1 or any(
            account_columns[name]["notnull"] != 1
            for name in ("account_id", "created_at", "status")
        ):
            raise IdentityStorageUnavailable("Identity storage is unavailable.")
        binding_column_info = {
            row["name"]: row
            for row in connection.execute(
                "PRAGMA table_info(provider_account_bindings)"
            ).fetchall()
        }
        if not {"issuer", "subject", "account_id", "created_at"}.issubset(binding_column_info):
            raise IdentityStorageUnavailable("Identity storage is unavailable.")
        if any(
            binding_column_info[name]["notnull"] != 1
            for name in ("issuer", "subject", "account_id", "created_at")
        ):
            raise IdentityStorageUnavailable("Identity storage is unavailable.")
        unique_identity = False
        for index in connection.execute(
            "PRAGMA index_list(provider_account_bindings)"
        ).fetchall():
            if not index["unique"]:
                continue
            index_name = index["name"]
            if not isinstance(index_name, str):
                raise IdentityStorageUnavailable("Identity storage is unavailable.")
            quoted_index_name = '"' + index_name.replace('"', '""') + '"'
            indexed_columns = [
                row["name"]
                for row in connection.execute(
                    f"PRAGMA index_info({quoted_index_name})"
                ).fetchall()
            ]
            if indexed_columns == ["issuer", "subject"]:
                unique_identity = True
                break
        if not unique_identity:
            raise IdentityStorageUnavailable("Identity storage is unavailable.")
        binding_foreign_keys = connection.execute(
            "PRAGMA foreign_key_list(provider_account_bindings)"
        ).fetchall()
        if not any(
            row["table"] == "accounts"
            and row["from"] == "account_id"
            and row["to"] == "account_id"
            and row["on_delete"] == "RESTRICT"
            for row in binding_foreign_keys
        ):
            raise IdentityStorageUnavailable("Identity storage is unavailable.")
        triggers = {
            row["name"]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'trigger'"
            ).fetchall()
        }
        if not {
            "accounts_identity_immutable",
            "accounts_no_delete",
        }.issubset(triggers):
            raise IdentityStorageUnavailable("Identity storage is unavailable.")

    @classmethod
    def _create_accounts_table(
        cls,
        connection: sqlite3.Connection,
        table_name: str,
    ) -> None:
        if table_name not in {"accounts", "accounts_v3"}:
            raise ValueError("Invalid account table name.")
        connection.execute(
            f"""
            CREATE TABLE {table_name} (
                account_id TEXT NOT NULL PRIMARY KEY
                    CHECK(
                        length(account_id) = 36
                        AND length(replace(account_id, '-', '')) = 32
                        AND length(account_id) - length(replace(account_id, '-', '')) = 4
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
            )
            """
        )

    @classmethod
    def _create_provider_bindings_table(
        cls,
        connection: sqlite3.Connection,
        *,
        table_name: str,
        accounts_table: str,
    ) -> None:
        if table_name not in {"provider_account_bindings", "provider_account_bindings_v3"}:
            raise ValueError("Invalid provider binding table name.")
        if accounts_table not in {"accounts", "accounts_v3"}:
            raise ValueError("Invalid account table name.")
        strip_chars = cls._PROVIDER_IDENTITY_STRIP_CHARS
        connection.execute(
            f"""
            CREATE TABLE {table_name} (
                issuer TEXT NOT NULL
                    CHECK(
                        length(issuer) BETWEEN 1 AND 2048
                        AND issuer = trim(issuer, {strip_chars})
                    ),
                subject TEXT NOT NULL
                    CHECK(
                        length(subject) BETWEEN 1 AND 1024
                        AND subject = trim(subject, {strip_chars})
                    ),
                account_id TEXT NOT NULL
                    REFERENCES {accounts_table}(account_id) ON DELETE RESTRICT,
                created_at TEXT NOT NULL,
                PRIMARY KEY(issuer, subject)
            )
            """
        )

    @staticmethod
    def _create_account_triggers(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            CREATE TRIGGER accounts_identity_immutable
            BEFORE UPDATE OF account_id ON accounts
            FOR EACH ROW WHEN NEW.account_id <> OLD.account_id
            BEGIN
                SELECT RAISE(ABORT, 'account_id is immutable');
            END
            """
        )
        connection.execute(
            """
            CREATE TRIGGER accounts_no_delete
            BEFORE DELETE ON accounts
            BEGIN
                SELECT RAISE(ABORT, 'account records cannot be deleted');
            END
            """
        )

    @classmethod
    def _create_account_tables(cls, connection: sqlite3.Connection) -> None:
        connection.execute("BEGIN IMMEDIATE")
        try:
            cls._create_accounts_table(connection, "accounts")
            cls._create_provider_bindings_table(
                connection,
                table_name="provider_account_bindings",
                accounts_table="accounts",
            )
            cls._create_account_triggers(connection)
            connection.execute(f"PRAGMA user_version = {cls._SCHEMA_VERSION}")
            connection.execute("COMMIT")
        except Exception:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise

    @classmethod
    def _migrate_v2_registry_tables(cls, connection: sqlite3.Connection) -> None:
        connection.execute("BEGIN IMMEDIATE")
        try:
            cls._create_accounts_table(connection, "accounts_v3")
            cls._create_provider_bindings_table(
                connection,
                table_name="provider_account_bindings_v3",
                accounts_table="accounts_v3",
            )
            connection.execute(
                """
                INSERT INTO accounts_v3(account_id, created_at, status)
                SELECT account_id, created_at, status FROM accounts
                """
            )
            connection.execute(
                """
                INSERT INTO provider_account_bindings_v3(issuer, subject, account_id, created_at)
                SELECT issuer, subject, account_id, created_at
                FROM provider_account_bindings
                """
            )
            connection.execute("DROP TABLE provider_account_bindings")
            connection.execute("DROP TABLE accounts")
            connection.execute("ALTER TABLE accounts_v3 RENAME TO accounts")
            connection.execute(
                "ALTER TABLE provider_account_bindings_v3 RENAME TO provider_account_bindings"
            )
            cls._create_account_triggers(connection)
            connection.execute(f"PRAGMA user_version = {cls._SCHEMA_VERSION}")
            if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise IdentityStorageUnavailable("Identity storage is unavailable.")
            connection.execute("COMMIT")
        except Exception:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise

    @classmethod
    def _validate_schema(cls, connection: sqlite3.Connection) -> None:
        cls._validate_registry_schema(
            connection,
            expected_version=cls._SCHEMA_VERSION,
        )

    def _initialize(self, connection: sqlite3.Connection) -> None:
        if self._initialized:
            self._validate_schema(connection)
            return
        if self._fresh_database:
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
            self._fresh_database = False
            self._create_account_tables(connection)
        else:
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version == 1:
                self._validate_base_schema(connection, expected_version=1)
                self._create_account_tables(connection)
            elif version == 2:
                self._validate_registry_schema(connection, expected_version=2)
                self._migrate_v2_registry_tables(connection)
            elif version != self._SCHEMA_VERSION:
                raise IdentityStorageUnavailable("Identity storage is unavailable.")
        self._validate_schema(connection)
        stat = self.database_path.stat()
        self._database_identity = (stat.st_dev, stat.st_ino)
        self._initialized = True

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        try:
            with self._lock:
                self._prepare_file()
                connection = sqlite3.connect(
                    self.database_path,
                    timeout=5,
                    isolation_level=None,
                )
                try:
                    connection.row_factory = sqlite3.Row
                    connection.execute("PRAGMA foreign_keys=ON")
                    if connection.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
                        raise IdentityStorageUnavailable("Identity storage is unavailable.")
                    connection.execute("PRAGMA busy_timeout=5000")
                    self._initialize(connection)
                    yield connection
                finally:
                    connection.close()
        except IdentityStorageUnavailable:
            raise
        except (OSError, sqlite3.Error) as error:
            raise IdentityStorageUnavailable("Identity storage is unavailable.") from error

    @staticmethod
    def _profile(row: sqlite3.Row) -> Profile:
        try:
            name = row["name"]
            if (
                not isinstance(name, str)
                or SQLiteIdentityRepository._name(
                    name,
                    limit=MAX_PROFILE_NAME_LENGTH,
                    kind="Profile",
                ) != name
            ):
                raise ValueError("Invalid stored profile name.")
            return Profile(
                profile_id=UUID(row["profile_id"]),
                owner_user_id=UUID(row["owner_user_id"]),
                name=name,
                created_at=SQLiteIdentityRepository._timestamp(row["created_at"]),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise IdentityStorageUnavailable("Identity storage is unavailable.") from error

    @staticmethod
    def _workspace(row: sqlite3.Row) -> Workspace:
        try:
            name = row["name"]
            role = row["role"]
            if (
                not isinstance(name, str)
                or SQLiteIdentityRepository._name(
                    name,
                    limit=MAX_WORKSPACE_NAME_LENGTH,
                    kind="Workspace",
                ) != name
                or role not in {"OWNER", "ADMIN", "MEMBER"}
            ):
                raise ValueError("Invalid stored workspace.")
            return Workspace(
                workspace_id=UUID(row["workspace_id"]),
                owner_user_id=UUID(row["owner_user_id"]),
                name=name,
                role=role,
                created_at=SQLiteIdentityRepository._timestamp(row["created_at"]),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise IdentityStorageUnavailable("Identity storage is unavailable.") from error

    @staticmethod
    def _account(row: sqlite3.Row) -> AccountRecord:
        try:
            status = AccountStatus(row["status"])
            return AccountRecord(
                account_identity=AccountIdentity.parse(row["account_id"]),
                created_at=SQLiteIdentityRepository._timestamp(row["created_at"]),
                status=status,
            )
        except (KeyError, TypeError, ValueError) as error:
            raise IdentityStorageUnavailable("Identity storage is unavailable.") from error

    def _provision_account(self, account_identity: AccountIdentity) -> AccountRecord:
        if type(account_identity) is not AccountIdentity:
            raise ValueError("A generated PARMAR account identity is required.")
        created_at = self._now().isoformat()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                connection.execute(
                    "INSERT INTO accounts(account_id, created_at, status) VALUES (?, ?, ?)",
                    (account_identity.serialize(), created_at, AccountStatus.ACTIVE.value),
                )
                row = connection.execute(
                    "SELECT account_id, created_at, status FROM accounts WHERE account_id = ?",
                    (account_identity.serialize(),),
                ).fetchone()
                if row is None:
                    raise IdentityStorageUnavailable("Identity storage is unavailable.")
                account = self._account(row)
                connection.execute("COMMIT")
                return account
            except sqlite3.IntegrityError as error:
                connection.execute("ROLLBACK")
                raise IdentityRecordConflict("The account identity already exists.") from error
            except Exception:
                connection.execute("ROLLBACK")
                raise

    def get_account(self, account_identity: AccountIdentity) -> AccountRecord | None:
        if type(account_identity) is not AccountIdentity:
            return None
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT account_id, created_at, status FROM accounts WHERE account_id = ?",
                (account_identity.serialize(),),
            ).fetchall()
            if len(rows) > 1:
                raise IdentityStorageUnavailable("Identity storage is unavailable.")
            return self._account(rows[0]) if rows else None

    def account_exists(self, account_identity: AccountIdentity) -> bool:
        return self.get_account(account_identity) is not None

    def get_account_status(self, account_identity: AccountIdentity) -> AccountStatus | None:
        account = self.get_account(account_identity)
        return account.status if account is not None else None

    def find_existing_account(self, identity: ProviderIdentity) -> AccountIdentity | None:
        if type(identity) is not ProviderIdentity:
            return None
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT b.issuer, b.subject, a.account_id, a.created_at, a.status
                FROM provider_account_bindings AS b
                JOIN accounts AS a ON a.account_id = b.account_id
                WHERE b.issuer = ? AND b.subject = ?
                """,
                (identity.issuer, identity.subject),
            ).fetchall()
            if len(rows) > 1:
                raise IdentityStorageUnavailable("Identity storage is unavailable.")
            if not rows:
                return None
            row = rows[0]
            try:
                stored_identity = ProviderIdentity(row["issuer"], row["subject"])
            except (KeyError, TypeError, ValueError) as error:
                raise IdentityStorageUnavailable("Identity storage is unavailable.") from error
            if stored_identity != identity:
                raise IdentityStorageUnavailable("Identity storage is unavailable.")
            account = self._account(row)
            return account.account_identity if account.status is AccountStatus.ACTIVE else None

    def list_profiles(self, user_id: UUID) -> list[Profile]:
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT profile_id, owner_user_id, name, created_at
                FROM profiles WHERE owner_user_id = ?
                ORDER BY created_at, profile_id
                """,
                (str(user_id),),
            ).fetchall()
            return [self._profile(row) for row in rows]

    def get_owned_profile(self, user_id: UUID, profile_id: UUID) -> Profile | None:
        if not isinstance(user_id, UUID) or not isinstance(profile_id, UUID):
            return None
        with self._connection() as connection:
            row = connection.execute(
                "SELECT profile_id, owner_user_id, name, created_at FROM profiles "
                "WHERE profile_id = ? AND owner_user_id = ?",
                (str(profile_id), str(user_id)),
            ).fetchone()
            return self._profile(row) if row is not None else None

    def create_profile(self, user_id: UUID, name: object) -> Profile:
        normalized = self._name(name, limit=MAX_PROFILE_NAME_LENGTH, kind="Profile")
        profile_id = uuid4()
        created_at = self._now().isoformat()
        with self._connection() as connection:
            connection.execute(
                "INSERT INTO profiles(profile_id, owner_user_id, name, created_at) VALUES (?, ?, ?, ?)",
                (str(profile_id), str(user_id), normalized, created_at),
            )
            row = connection.execute(
                "SELECT profile_id, owner_user_id, name, created_at FROM profiles WHERE profile_id = ? AND owner_user_id = ?",
                (str(profile_id), str(user_id)),
            ).fetchone()
            if row is None:
                raise IdentityStorageUnavailable("Identity storage is unavailable.")
            return self._profile(row)

    def create_workspace(self, user_id: UUID, name: object) -> Workspace:
        normalized = self._name(name, limit=MAX_WORKSPACE_NAME_LENGTH, kind="Workspace")
        workspace_id = uuid4()
        created_at = self._now().isoformat()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                connection.execute(
                    "INSERT INTO workspaces(workspace_id, owner_user_id, name, created_at) VALUES (?, ?, ?, ?)",
                    (str(workspace_id), str(user_id), normalized, created_at),
                )
                connection.execute(
                    "INSERT INTO workspace_members(workspace_id, user_id, role, created_at) VALUES (?, ?, 'OWNER', ?)",
                    (str(workspace_id), str(user_id), created_at),
                )
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            row = connection.execute(
                """
                SELECT w.workspace_id, w.owner_user_id, w.name, m.role, w.created_at
                FROM workspaces w JOIN workspace_members m USING(workspace_id)
                WHERE w.workspace_id = ? AND m.user_id = ?
                """,
                (str(workspace_id), str(user_id)),
            ).fetchone()
            if row is None:
                raise IdentityStorageUnavailable("Identity storage is unavailable.")
            return self._workspace(row)

    def list_workspaces(self, user_id: UUID) -> list[Workspace]:
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT w.workspace_id, w.owner_user_id, w.name, m.role, w.created_at
                FROM workspaces w JOIN workspace_members m USING(workspace_id)
                WHERE m.user_id = ?
                ORDER BY w.created_at, w.workspace_id
                """,
                (str(user_id),),
            ).fetchall()
            return [self._workspace(row) for row in rows]

    def add_profile_to_workspace(
        self,
        user_id: UUID,
        workspace_id: UUID,
        profile_id: UUID,
    ) -> None:
        created_at = self._now().isoformat()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                profile = connection.execute(
                    "SELECT 1 FROM profiles WHERE profile_id = ? AND owner_user_id = ?",
                    (str(profile_id), str(user_id)),
                ).fetchone()
                workspace = connection.execute(
                    """
                    SELECT 1 FROM workspace_members
                    WHERE workspace_id = ? AND user_id = ? AND role IN ('OWNER', 'ADMIN')
                    """,
                    (str(workspace_id), str(user_id)),
                ).fetchone()
                if profile is None or workspace is None:
                    raise IdentityAccessDenied("Profile or workspace is not available.")
                connection.execute(
                    """
                    INSERT INTO workspace_profiles(
                        workspace_id, profile_id, granted_by_user_id, created_at
                    ) VALUES (?, ?, ?, ?)
                    ON CONFLICT(workspace_id, profile_id) DO NOTHING
                    """,
                    (str(workspace_id), str(profile_id), str(user_id), created_at),
                )
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise

    def list_workspace_profiles(self, user_id: UUID, workspace_id: UUID) -> list[Profile]:
        with self._connection() as connection:
            membership = connection.execute(
                "SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
                (str(workspace_id), str(user_id)),
            ).fetchone()
            if membership is None:
                raise IdentityAccessDenied("Workspace is not available.")
            rows = connection.execute(
                """
                SELECT p.profile_id, p.owner_user_id, p.name, p.created_at
                FROM workspace_profiles wp JOIN profiles p USING(profile_id)
                WHERE wp.workspace_id = ?
                ORDER BY p.created_at, p.profile_id
                """,
                (str(workspace_id),),
            ).fetchall()
            return [self._profile(row) for row in rows]


class TrustedInternalAccountProvisioner:
    """Inactive internal-code interface, not a production authorization boundary."""

    def __init__(self, repository: SQLiteIdentityRepository) -> None:
        if type(repository) is not SQLiteIdentityRepository:
            raise TypeError("A trusted PARMAR identity repository is required.")
        self._repository = repository

    def provision_account(self) -> AccountRecord:
        """Mint a random account ID; callers cannot select an ID or provider."""
        return self._repository._provision_account(AccountIdentity.generate())
