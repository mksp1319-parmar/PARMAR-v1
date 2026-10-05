"""Server-owned, explicitly user-managed memory records."""

from __future__ import annotations

import os
import re
import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator, Protocol
from uuid import UUID, uuid4

MAX_MEMORY_LENGTH = 400
MAX_MEMORY_RECORDS = 25
MAX_RETRIEVED_MEMORIES = 5
MAX_RETRIEVED_MEMORY_CHARS = 1200
MAX_RETRIEVAL_QUERY_CHARS = 1000
MAX_RETRIEVAL_TERMS = 32

_RETRIEVAL_STOPWORDS = frozenset({
    "about", "after", "again", "also", "and", "any", "are", "because", "been",
    "before", "being", "between", "both", "but", "can", "could", "does", "doing",
    "down", "during", "each", "few", "for", "from", "further", "had", "has",
    "have", "having", "here", "hers", "him", "his", "how", "into", "its",
    "just", "more", "most", "not", "off", "once", "only", "other", "our",
    "out", "over", "own", "same", "she", "should", "some", "such", "than",
    "that", "the", "their", "them", "then", "there", "these", "they", "this",
    "those", "through", "too", "under", "until", "very", "was", "were", "what",
    "when", "where", "which", "while", "who", "whom", "why", "will", "with",
    "would", "you", "your",
})
_RETRIEVAL_TERM_PATTERN = re.compile(r"[a-z0-9]{3,}")

_CREDENTIAL_PATTERNS = (
    re.compile(r"\b(?:password|passwd|passcode|secret|credential)\b\s*(?:is|[:=])\s*\S+", re.IGNORECASE),
    re.compile(
        r"\b(?:api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|auth(?:entication)?[\s_-]?token|"
        r"session[\s_-]?token|client[\s_-]?secret|private[\s_-]?key)\b\s*(?:is|[:=])\s*\S+",
        re.IGNORECASE,
    ),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{12,}", re.IGNORECASE),
    re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----", re.IGNORECASE),
    re.compile(r"\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b"),
    re.compile(
        r"\b(?:sk-[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|"
        r"gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|"
        r"AKIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{20,})\b"
    ),
)


class MemoryConsentRequired(ValueError):
    """Raised when creating/updating without active server-owned consent."""


class MemoryStorageUnavailable(RuntimeError):
    """Raised when durable memory storage cannot be safely used."""


@dataclass(frozen=True)
class MemoryConsent:
    owner_user_id: UUID
    granted: bool
    updated_at: datetime


@dataclass(frozen=True)
class MemoryRecord:
    memory_id: UUID
    owner_user_id: UUID
    content: str
    provenance: str
    created_at: datetime
    updated_at: datetime


class MemoryRepository(Protocol):
    def get_consent(self, owner_user_id: UUID) -> MemoryConsent: ...

    def set_consent(self, owner_user_id: UUID, granted: bool) -> MemoryConsent: ...

    def list_owned(self, owner_user_id: UUID) -> tuple[MemoryRecord, ...]: ...

    def retrieve_owned(self, owner_user_id: UUID, query: str) -> tuple[MemoryRecord, ...]: ...

    def create_owned(self, owner_user_id: UUID, content: str) -> MemoryRecord: ...

    def update_owned(self, memory_id: UUID, owner_user_id: UUID, content: str) -> MemoryRecord | None: ...

    def delete_owned(self, memory_id: UUID, owner_user_id: UUID) -> bool: ...

    def clear_owned(self, owner_user_id: UUID) -> int: ...


class InMemoryMemoryRepository:
    """Thread-safe process-local memory and consent repository."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._consents: dict[UUID, MemoryConsent] = {}
        self._memories: dict[UUID, MemoryRecord] = {}
        self._memory_ids_by_owner: dict[UUID, list[UUID]] = {}

    @staticmethod
    def _validated_content(content: object) -> str:
        if not isinstance(content, str):
            raise ValueError("Memory content must be a string.")
        cleaned = content.strip()
        if not cleaned or len(cleaned) > MAX_MEMORY_LENGTH:
            raise ValueError("Memory content must contain 1 to 400 characters.")
        if any(pattern.search(cleaned) for pattern in _CREDENTIAL_PATTERNS):
            raise ValueError("Memory content appears to contain credential-like data.")
        return cleaned

    @staticmethod
    def _validate_owner(owner_user_id: object) -> UUID:
        if not isinstance(owner_user_id, UUID):
            raise TypeError("Memory owners must be server-established user IDs.")
        return owner_user_id

    def get_consent(self, owner_user_id: UUID) -> MemoryConsent:
        owner = self._validate_owner(owner_user_id)
        with self._lock:
            return self._consents.get(
                owner,
                MemoryConsent(owner, False, datetime.now(timezone.utc)),
            )

    def set_consent(self, owner_user_id: UUID, granted: bool) -> MemoryConsent:
        owner = self._validate_owner(owner_user_id)
        if not isinstance(granted, bool):
            raise ValueError("Memory consent must be boolean.")
        with self._lock:
            consent = MemoryConsent(owner, granted, datetime.now(timezone.utc))
            self._consents[owner] = consent
            return consent

    def list_owned(self, owner_user_id: UUID) -> tuple[MemoryRecord, ...]:
        owner = self._validate_owner(owner_user_id)
        with self._lock:
            return tuple(sorted(
                (
                    self._memories[memory_id]
                    for memory_id in self._memory_ids_by_owner.get(owner, ())
                    if memory_id in self._memories
                ),
                key=lambda record: record.created_at,
                reverse=True,
            ))

    def retrieve_owned(self, owner_user_id: UUID, query: str) -> tuple[MemoryRecord, ...]:
        owner = self._validate_owner(owner_user_id)
        if not isinstance(query, str):
            return ()
        query_terms = set(
            _RETRIEVAL_TERM_PATTERN.findall(query[:MAX_RETRIEVAL_QUERY_CHARS].casefold())[:MAX_RETRIEVAL_TERMS]
        )
        query_terms.difference_update(_RETRIEVAL_STOPWORDS)
        if not query_terms:
            return ()

        with self._lock:
            consent = self._consents.get(owner)
            if consent is None or not consent.granted:
                return ()
            owned_records = tuple(
                self._memories[memory_id]
                for memory_id in self._memory_ids_by_owner.get(owner, ())[:MAX_MEMORY_RECORDS]
                if memory_id in self._memories
            )

        scored_records = []
        for record in owned_records:
            memory_terms = set(_RETRIEVAL_TERM_PATTERN.findall(record.content.casefold()))
            score = len(query_terms.intersection(memory_terms))
            if score:
                scored_records.append((score, record))
        scored_records.sort(key=lambda item: (
            -item[0],
            -item[1].created_at.timestamp(),
            str(item[1].memory_id),
        ))

        selected: list[MemoryRecord] = []
        remaining_chars = MAX_RETRIEVED_MEMORY_CHARS
        for _, record in scored_records:
            if len(selected) >= MAX_RETRIEVED_MEMORIES:
                break
            if len(record.content) > remaining_chars:
                continue
            selected.append(record)
            remaining_chars -= len(record.content)
            if remaining_chars == 0:
                break
        return tuple(selected)

    def create_owned(self, owner_user_id: UUID, content: str) -> MemoryRecord:
        owner = self._validate_owner(owner_user_id)
        cleaned = self._validated_content(content)
        with self._lock:
            if not self._consents.get(owner, MemoryConsent(owner, False, datetime.now(timezone.utc))).granted:
                raise MemoryConsentRequired("Explicit memory consent is required.")
            if sum(record.owner_user_id == owner for record in self._memories.values()) >= MAX_MEMORY_RECORDS:
                raise ValueError("A maximum of 25 memories may be saved.")
            now = datetime.now(timezone.utc)
            memory_id = uuid4()
            record = MemoryRecord(
                memory_id=memory_id,
                owner_user_id=owner,
                content=cleaned,
                provenance="explicit_user_save",
                created_at=now,
                updated_at=now,
            )
            self._memories[memory_id] = record
            self._memory_ids_by_owner.setdefault(owner, []).append(memory_id)
            return record

    def update_owned(self, memory_id: UUID, owner_user_id: UUID, content: str) -> MemoryRecord | None:
        owner = self._validate_owner(owner_user_id)
        if not isinstance(memory_id, UUID):
            return None
        with self._lock:
            current = self._memories.get(memory_id)
            if current is None or current.owner_user_id != owner:
                return None
            if not self._consents.get(owner, MemoryConsent(owner, False, datetime.now(timezone.utc))).granted:
                raise MemoryConsentRequired("Explicit memory consent is required.")
            cleaned = self._validated_content(content)
            updated = MemoryRecord(
                memory_id=current.memory_id,
                owner_user_id=current.owner_user_id,
                content=cleaned,
                provenance="explicit_user_update",
                created_at=current.created_at,
                updated_at=datetime.now(timezone.utc),
            )
            self._memories[memory_id] = updated
            return updated

    def delete_owned(self, memory_id: UUID, owner_user_id: UUID) -> bool:
        owner = self._validate_owner(owner_user_id)
        with self._lock:
            record = self._memories.get(memory_id)
            if record is None or record.owner_user_id != owner:
                return False
            del self._memories[memory_id]
            self._memory_ids_by_owner[owner].remove(memory_id)
            if not self._memory_ids_by_owner[owner]:
                del self._memory_ids_by_owner[owner]
            return True

    def clear_owned(self, owner_user_id: UUID) -> int:
        owner = self._validate_owner(owner_user_id)
        with self._lock:
            memory_ids = self._memory_ids_by_owner.pop(owner, [])
            for memory_id in memory_ids:
                self._memories.pop(memory_id, None)
            return len(memory_ids)


class SQLiteMemoryRepository:
    """SQLite-backed durable memory repository with owner-scoped operations."""

    _SCHEMA_VERSION = 1
    _PROVENANCE_VALUES = frozenset({"explicit_user_save", "explicit_user_update"})

    def __init__(self, database_path: str | Path) -> None:
        path = Path(database_path).expanduser()
        if not str(path):
            raise ValueError("A memory database path is required.")
        self.database_path = path if path.is_absolute() else Path.cwd() / path
        self._lock = threading.RLock()
        self._initialized = False
        self._fresh_database = False
        self._database_identity: tuple[int, int] | None = None

    @classmethod
    def from_environment(cls, environ: dict[str, str] | None = None) -> "SQLiteMemoryRepository":
        values = os.environ if environ is None else environ
        configured_path = values.get("PARMAR_MEMORY_DB_PATH")
        if configured_path is not None and not configured_path.strip():
            raise ValueError("PARMAR_MEMORY_DB_PATH must not be empty.")
        path = (
            Path(configured_path).expanduser()
            if configured_path is not None
            else Path.home() / ".local" / "share" / "parmar" / "memories.sqlite3"
        )
        return cls(path)

    @staticmethod
    def _timestamp(value: str) -> datetime:
        try:
            parsed = datetime.fromisoformat(value)
        except (TypeError, ValueError) as error:
            raise MemoryStorageUnavailable("Memory storage is unavailable.") from error
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise MemoryStorageUnavailable("Memory storage is unavailable.")
        return parsed.astimezone(timezone.utc)

    @classmethod
    def _record_from_row(cls, row: sqlite3.Row) -> MemoryRecord:
        try:
            content = InMemoryMemoryRepository._validated_content(row["content"])
            provenance = row["provenance"]
            if content != row["content"] or provenance not in cls._PROVENANCE_VALUES:
                raise ValueError("Invalid stored memory record.")
            return MemoryRecord(
                memory_id=UUID(row["memory_id"]),
                owner_user_id=UUID(row["owner_user_id"]),
                content=content,
                provenance=provenance,
                created_at=cls._timestamp(row["created_at"]),
                updated_at=cls._timestamp(row["updated_at"]),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise MemoryStorageUnavailable("Memory storage is unavailable.") from error

    @staticmethod
    def _owner_id(owner_user_id: UUID) -> str:
        return str(InMemoryMemoryRepository._validate_owner(owner_user_id))

    def _prepare_file(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.database_path.is_symlink():
            raise OSError("Memory database must not be a symbolic link.")
        if not self.database_path.exists():
            if self._initialized:
                raise OSError("Memory database is missing.")
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
            raise OSError("Memory database path is not a file.")
        os.chmod(self.database_path, 0o600)
        stat = self.database_path.stat()
        identity = (stat.st_dev, stat.st_ino)
        if self._initialized and identity != self._database_identity:
            raise OSError("Memory database has changed.")

    def _initialize(self, connection: sqlite3.Connection) -> None:
        if self._initialized:
            return
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version not in (0, self._SCHEMA_VERSION):
            raise MemoryStorageUnavailable("Memory storage is unavailable.")
        if version == 0:
            if not self._fresh_database:
                objects = connection.execute(
                    "SELECT name FROM sqlite_master WHERE type IN ('table', 'view', 'trigger') "
                    "AND name NOT LIKE 'sqlite_%'"
                ).fetchall()
                if objects:
                    raise MemoryStorageUnavailable("Memory storage is unavailable.")
            connection.executescript(
                """
                CREATE TABLE memory_consents (
                    owner_user_id TEXT PRIMARY KEY,
                    granted INTEGER NOT NULL CHECK(granted IN (0, 1)),
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE memories (
                    memory_id TEXT PRIMARY KEY,
                    owner_user_id TEXT NOT NULL,
                    content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 400),
                    provenance TEXT NOT NULL CHECK(provenance IN ('explicit_user_save', 'explicit_user_update')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX memories_owner_created
                    ON memories(owner_user_id, created_at DESC, memory_id);
                PRAGMA user_version = 1;
                """
            )
        integrity = connection.execute("PRAGMA quick_check").fetchone()
        if integrity is None or integrity[0] != "ok":
            raise MemoryStorageUnavailable("Memory storage is unavailable.")
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        if not {"memory_consents", "memories"}.issubset(tables):
            raise MemoryStorageUnavailable("Memory storage is unavailable.")
        stat = self.database_path.stat()
        self._database_identity = (stat.st_dev, stat.st_ino)
        self._initialized = True

    @contextmanager
    def _connection(self, *, write: bool = False) -> Generator[sqlite3.Connection, None, None]:
        try:
            with self._lock:
                self._prepare_file()
                connection = sqlite3.connect(
                    self.database_path,
                    timeout=5,
                    isolation_level=None,
                )
                connection.row_factory = sqlite3.Row
                try:
                    self._initialize(connection)
                    if write:
                        connection.execute("BEGIN IMMEDIATE")
                    else:
                        connection.execute("BEGIN")
                    try:
                        yield connection
                    except Exception:
                        connection.rollback()
                        raise
                    else:
                        connection.commit()
                finally:
                    connection.close()
        except MemoryStorageUnavailable:
            raise
        except (OSError, sqlite3.Error) as error:
            raise MemoryStorageUnavailable("Memory storage is unavailable.") from error

    def get_consent(self, owner_user_id: UUID) -> MemoryConsent:
        owner = self._owner_id(owner_user_id)
        with self._connection() as connection:
            row = connection.execute(
                "SELECT owner_user_id, granted, updated_at FROM memory_consents WHERE owner_user_id = ?",
                (owner,),
            ).fetchone()
        if row is None:
            return MemoryConsent(UUID(owner), False, datetime.now(timezone.utc))
        try:
            if row["granted"] not in (0, 1):
                raise ValueError("Invalid stored consent.")
            consent_owner = UUID(row["owner_user_id"])
            if consent_owner != UUID(owner):
                raise ValueError("Invalid stored consent owner.")
            return MemoryConsent(
                consent_owner,
                bool(row["granted"]),
                self._timestamp(row["updated_at"]),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise MemoryStorageUnavailable("Memory storage is unavailable.") from error

    def set_consent(self, owner_user_id: UUID, granted: bool) -> MemoryConsent:
        owner = self._owner_id(owner_user_id)
        if not isinstance(granted, bool):
            raise ValueError("Memory consent must be boolean.")
        now = datetime.now(timezone.utc)
        with self._connection(write=True) as connection:
            connection.execute(
                """
                INSERT INTO memory_consents(owner_user_id, granted, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(owner_user_id) DO UPDATE SET
                    granted = excluded.granted, updated_at = excluded.updated_at
                """,
                (owner, int(granted), now.isoformat()),
            )
        return MemoryConsent(UUID(owner), granted, now)

    def list_owned(self, owner_user_id: UUID) -> tuple[MemoryRecord, ...]:
        owner = self._owner_id(owner_user_id)
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT memory_id, owner_user_id, content, provenance, created_at, updated_at "
                "FROM memories WHERE owner_user_id = ? ORDER BY created_at DESC, memory_id",
                (owner,),
            ).fetchall()
        records = tuple(self._record_from_row(row) for row in rows)
        if len(records) > MAX_MEMORY_RECORDS or any(record.owner_user_id != UUID(owner) for record in records):
            raise MemoryStorageUnavailable("Memory storage is unavailable.")
        return records

    def retrieve_owned(self, owner_user_id: UUID, query: str) -> tuple[MemoryRecord, ...]:
        owner = self._owner_id(owner_user_id)
        if not isinstance(query, str):
            return ()
        query_terms = set(
            _RETRIEVAL_TERM_PATTERN.findall(query[:MAX_RETRIEVAL_QUERY_CHARS].casefold())[:MAX_RETRIEVAL_TERMS]
        )
        query_terms.difference_update(_RETRIEVAL_STOPWORDS)
        if not query_terms:
            return ()

        with self._connection() as connection:
            row = connection.execute(
                "SELECT granted FROM memory_consents WHERE owner_user_id = ?",
                (owner,),
            ).fetchone()
            if row is None:
                return ()
            if row["granted"] not in (0, 1):
                raise MemoryStorageUnavailable("Memory storage is unavailable.")
            if row["granted"] != 1:
                return ()
            rows = connection.execute(
                "SELECT memory_id, owner_user_id, content, provenance, created_at, updated_at "
                "FROM memories WHERE owner_user_id = ? ORDER BY created_at DESC, memory_id LIMIT ?",
                (owner, MAX_MEMORY_RECORDS + 1),
            ).fetchall()
        if len(rows) > MAX_MEMORY_RECORDS:
            raise MemoryStorageUnavailable("Memory storage is unavailable.")
        owned_records = tuple(self._record_from_row(item) for item in rows)
        if any(record.owner_user_id != UUID(owner) for record in owned_records):
            raise MemoryStorageUnavailable("Memory storage is unavailable.")
        scored_records = []
        for record in owned_records:
            memory_terms = set(_RETRIEVAL_TERM_PATTERN.findall(record.content.casefold()))
            score = len(query_terms.intersection(memory_terms))
            if score:
                scored_records.append((score, record))
        scored_records.sort(key=lambda item: (
            -item[0],
            -item[1].created_at.timestamp(),
            str(item[1].memory_id),
        ))
        selected: list[MemoryRecord] = []
        remaining_chars = MAX_RETRIEVED_MEMORY_CHARS
        for _, record in scored_records:
            if len(selected) >= MAX_RETRIEVED_MEMORIES:
                break
            if len(record.content) <= remaining_chars:
                selected.append(record)
                remaining_chars -= len(record.content)
                if remaining_chars == 0:
                    break
        return tuple(selected)

    def create_owned(self, owner_user_id: UUID, content: str) -> MemoryRecord:
        owner = self._owner_id(owner_user_id)
        cleaned = InMemoryMemoryRepository._validated_content(content)
        now = datetime.now(timezone.utc)
        record = MemoryRecord(uuid4(), UUID(owner), cleaned, "explicit_user_save", now, now)
        with self._connection(write=True) as connection:
            consent = connection.execute(
                "SELECT granted FROM memory_consents WHERE owner_user_id = ?",
                (owner,),
            ).fetchone()
            if consent is None or consent["granted"] != 1:
                raise MemoryConsentRequired("Explicit memory consent is required.")
            count = connection.execute(
                "SELECT COUNT(*) FROM memories WHERE owner_user_id = ?",
                (owner,),
            ).fetchone()[0]
            if count >= MAX_MEMORY_RECORDS:
                raise ValueError("A maximum of 25 memories may be saved.")
            connection.execute(
                "INSERT INTO memories(memory_id, owner_user_id, content, provenance, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    str(record.memory_id), owner, cleaned, record.provenance,
                    now.isoformat(), now.isoformat(),
                ),
            )
        return record

    def update_owned(
        self,
        memory_id: UUID,
        owner_user_id: UUID,
        content: str,
    ) -> MemoryRecord | None:
        owner = self._owner_id(owner_user_id)
        if not isinstance(memory_id, UUID):
            return None
        with self._connection(write=True) as connection:
            row = connection.execute(
                "SELECT memory_id, owner_user_id, content, provenance, created_at, updated_at "
                "FROM memories WHERE memory_id = ? AND owner_user_id = ?",
                (str(memory_id), owner),
            ).fetchone()
            if row is None:
                return None
            consent = connection.execute(
                "SELECT granted FROM memory_consents WHERE owner_user_id = ?",
                (owner,),
            ).fetchone()
            if consent is None or consent["granted"] != 1:
                raise MemoryConsentRequired("Explicit memory consent is required.")
            current = self._record_from_row(row)
            cleaned = InMemoryMemoryRepository._validated_content(content)
            updated_at = datetime.now(timezone.utc)
            connection.execute(
                "UPDATE memories SET content = ?, provenance = 'explicit_user_update', updated_at = ? "
                "WHERE memory_id = ? AND owner_user_id = ?",
                (cleaned, updated_at.isoformat(), str(memory_id), owner),
            )
        return MemoryRecord(
            current.memory_id, current.owner_user_id, cleaned, "explicit_user_update",
            current.created_at, updated_at,
        )

    def delete_owned(self, memory_id: UUID, owner_user_id: UUID) -> bool:
        owner = self._owner_id(owner_user_id)
        if not isinstance(memory_id, UUID):
            return False
        with self._connection(write=True) as connection:
            cursor = connection.execute(
                "DELETE FROM memories WHERE memory_id = ? AND owner_user_id = ?",
                (str(memory_id), owner),
            )
            return cursor.rowcount == 1

    def clear_owned(self, owner_user_id: UUID) -> int:
        owner = self._owner_id(owner_user_id)
        with self._connection(write=True) as connection:
            cursor = connection.execute(
                "DELETE FROM memories WHERE owner_user_id = ?",
                (owner,),
            )
            return cursor.rowcount
