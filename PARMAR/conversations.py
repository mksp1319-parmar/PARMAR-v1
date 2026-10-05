"""Provider-neutral repositories for server-owned conversations and messages."""

from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Protocol
from uuid import UUID, uuid4

from PARMAR.chat.context import sanitize_provider_text
from PARMAR.research.models import (
    CONTRACT_VERSION,
    ResearchResult,
    ResearchStatus,
    SourceValidationError,
    research_result_from_payload,
)

MAX_CONVERSATIONS_PER_USER = 50
MAX_TOTAL_CONVERSATIONS = 10_000
MAX_MESSAGES_PER_CONVERSATION = 100
MAX_MESSAGE_LENGTH = 4_000
MAX_CONVERSATION_CHARACTERS = 50_000
MAX_TOTAL_STORED_MESSAGE_CHARACTERS = 50_000_000
MAX_CONVERSATION_TITLE_LENGTH = 56
MAX_RESEARCH_ENVELOPE_BYTES = 128 * 1024


def _serialize_research(result: ResearchResult) -> str:
    if not isinstance(result, ResearchResult) or result.status not in {
        ResearchStatus.RESULTS,
        ResearchStatus.NO_RESULTS,
    }:
        raise ConversationStorageUnavailable("Research metadata is invalid.")
    try:
        validated = research_result_from_payload(result.public_payload())
        payload = json.dumps(
            validated.public_payload(),
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (SourceValidationError, TypeError, ValueError) as error:
        raise ConversationStorageUnavailable("Research metadata is invalid.") from error
    if len(payload.encode("utf-8")) > MAX_RESEARCH_ENVELOPE_BYTES:
        raise ConversationLimitExceeded("Research metadata exceeds the storage limit.")
    return payload


_NON_PERSISTABLE_MESSAGE_PATTERNS = (
    re.compile(r"(?im)^\s*(?:cookie|set-cookie)\s*:\s*[^\r\n]*"),
    re.compile(r"(?im)^\s*(?:x-csrf-token|x-session-token|x-approval-token)\s*:\s*[^\r\n]*"),
    re.compile(
        r"\b(?:session|csrf|approval)[\s_-]?token\b\s*(?:is|[:=]|\s)\s*\S+",
        re.IGNORECASE,
    ),
)


def generate_conversation_title(user_message: str) -> str:
    """Create a compact title from the first user message without retaining secrets."""
    if not isinstance(user_message, str):
        return ""
    title = sanitize_provider_text(user_message).strip()
    for pattern in _NON_PERSISTABLE_MESSAGE_PATTERNS:
        title = pattern.sub("[REDACTED]", title)
    title = " ".join(title.split())
    if not title or title == "[REDACTED]":
        return ""
    if len(title) > MAX_CONVERSATION_TITLE_LENGTH:
        title = title[: MAX_CONVERSATION_TITLE_LENGTH - 3].rstrip() + "..."
    return title


class ConversationLimitExceeded(ValueError):
    """Raised when an append or create would exceed a fixed storage quota."""


class ConversationStorageUnavailable(RuntimeError):
    """Raised when persistent conversation storage cannot be read or written."""


@dataclass(frozen=True)
class Conversation:
    conversation_id: UUID
    owner_user_id: UUID
    created_at: datetime
    updated_at: datetime
    title: str = ""


@dataclass(frozen=True)
class ConversationMessage:
    message_id: UUID
    conversation_id: UUID
    role: str
    content: str
    created_at: datetime
    research: ResearchResult | None = None
    research_retrieved_at: datetime | None = None


class ConversationRepository(Protocol):
    """Storage operations for server-owned conversations."""

    def create(self, owner_user_id: UUID) -> Conversation: ...

    def create_for_message(self, owner_user_id: UUID, user_message: str) -> Conversation: ...

    def get_owned(self, conversation_id: UUID, owner_user_id: UUID) -> Conversation | None: ...

    def list_owned(self, owner_user_id: UUID) -> tuple[Conversation, ...]: ...

    def delete_owned(self, conversation_id: UUID, owner_user_id: UUID) -> bool: ...


class MessageRepository(Protocol):
    """Storage operations for messages scoped to an owned conversation."""

    def recent_owned(
        self,
        conversation_id: UUID,
        owner_user_id: UUID,
        limit: int,
    ) -> tuple[ConversationMessage, ...] | None: ...

    def can_append_owned(
        self,
        conversation_id: UUID,
        owner_user_id: UUID,
        user_message: str,
    ) -> bool | None: ...

    def append_owned(
        self,
        conversation_id: UUID,
        owner_user_id: UUID,
        messages: tuple[tuple[str, str], ...],
        *,
        research: ResearchResult | None = None,
    ) -> tuple[ConversationMessage, ...] | None: ...


class InMemoryConversationRepository:
    """Thread-safe in-memory implementation for development and tests."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._conversations: dict[UUID, Conversation] = {}
        self._messages: dict[UUID, list[ConversationMessage]] = {}
        self._conversations_by_owner: dict[UUID, set[UUID]] = {}
        self._message_counts: dict[UUID, int] = {}
        self._conversation_characters: dict[UUID, int] = {}
        self._total_message_characters = 0

    def create(self, owner_user_id: UUID) -> Conversation:
        if not isinstance(owner_user_id, UUID):
            raise TypeError("Conversation owners must be server-established user IDs.")
        with self._lock:
            return self._create_locked(owner_user_id)

    def create_for_message(self, owner_user_id: UUID, user_message: str) -> Conversation:
        if not isinstance(owner_user_id, UUID):
            raise TypeError("Conversation owners must be server-established user IDs.")
        if not isinstance(user_message, str):
            raise ValueError("A user message is required to create a conversation.")
        cleaned_message = sanitize_provider_text(user_message).strip()
        if not cleaned_message or len(cleaned_message) > MAX_MESSAGE_LENGTH:
            raise ConversationLimitExceeded("The conversation storage limit has been reached.")
        with self._lock:
            if (
                self._total_message_characters + len(cleaned_message) + MAX_MESSAGE_LENGTH
                > MAX_TOTAL_STORED_MESSAGE_CHARACTERS
            ):
                raise ConversationLimitExceeded("The conversation storage limit has been reached.")
            return self._create_locked(owner_user_id)

    def _create_locked(self, owner_user_id: UUID) -> Conversation:
        owner_conversations = self._conversations_by_owner.get(owner_user_id, set())
        if len(owner_conversations) >= MAX_CONVERSATIONS_PER_USER:
            raise ConversationLimitExceeded("The user conversation limit has been reached.")
        if len(self._conversations) >= MAX_TOTAL_CONVERSATIONS:
            raise ConversationLimitExceeded("The server conversation limit has been reached.")
        now = datetime.now(timezone.utc)
        conversation_id = uuid4()
        while conversation_id in self._conversations:
            conversation_id = uuid4()
        conversation = Conversation(
            conversation_id=conversation_id,
            owner_user_id=owner_user_id,
            created_at=now,
            updated_at=now,
            title="",
        )
        self._conversations[conversation_id] = conversation
        self._messages[conversation_id] = []
        self._conversations_by_owner.setdefault(owner_user_id, set()).add(conversation_id)
        self._message_counts[conversation_id] = 0
        self._conversation_characters[conversation_id] = 0
        return conversation

    def get_owned(self, conversation_id: UUID, owner_user_id: UUID) -> Conversation | None:
        if not isinstance(conversation_id, UUID) or not isinstance(owner_user_id, UUID):
            return None
        with self._lock:
            conversation = self._conversations.get(conversation_id)
            if conversation is None or conversation.owner_user_id != owner_user_id:
                return None
            return conversation

    def list_owned(self, owner_user_id: UUID) -> tuple[Conversation, ...]:
        if not isinstance(owner_user_id, UUID):
            return ()
        with self._lock:
            conversations = [
                self._conversations[conversation_id]
                for conversation_id in self._conversations_by_owner.get(owner_user_id, set())
                if self._conversations[conversation_id].title
            ]
            return tuple(sorted(conversations, key=lambda item: item.updated_at, reverse=True))

    def delete_owned(self, conversation_id: UUID, owner_user_id: UUID) -> bool:
        if not isinstance(conversation_id, UUID) or not isinstance(owner_user_id, UUID):
            return False
        with self._lock:
            conversation = self._conversations.get(conversation_id)
            if conversation is None or conversation.owner_user_id != owner_user_id:
                return False
            del self._conversations[conversation_id]
            del self._messages[conversation_id]
            del self._message_counts[conversation_id]
            self._total_message_characters -= self._conversation_characters.pop(conversation_id)
            owner_conversations = self._conversations_by_owner[owner_user_id]
            owner_conversations.remove(conversation_id)
            if not owner_conversations:
                del self._conversations_by_owner[owner_user_id]
            return True

    def recent_owned(
        self,
        conversation_id: UUID,
        owner_user_id: UUID,
        limit: int,
    ) -> tuple[ConversationMessage, ...] | None:
        if (
            not isinstance(conversation_id, UUID)
            or not isinstance(owner_user_id, UUID)
            or not isinstance(limit, int)
            or isinstance(limit, bool)
            or limit <= 0
        ):
            return None
        with self._lock:
            conversation = self._conversations.get(conversation_id)
            if conversation is None or conversation.owner_user_id != owner_user_id:
                return None
            return tuple(self._messages[conversation_id][-limit:])

    def can_append_owned(
        self,
        conversation_id: UUID,
        owner_user_id: UUID,
        user_message: str,
    ) -> bool | None:
        if (
            not isinstance(conversation_id, UUID)
            or not isinstance(owner_user_id, UUID)
            or not isinstance(user_message, str)
        ):
            return None
        cleaned_message = sanitize_provider_text(user_message).strip()
        if not cleaned_message or len(cleaned_message) > MAX_MESSAGE_LENGTH:
            return False
        with self._lock:
            conversation = self._conversations.get(conversation_id)
            if conversation is None or conversation.owner_user_id != owner_user_id:
                return None
            return (
                self._message_counts[conversation_id] + 2 <= MAX_MESSAGES_PER_CONVERSATION
                and self._conversation_characters[conversation_id] + len(cleaned_message) + MAX_MESSAGE_LENGTH
                <= MAX_CONVERSATION_CHARACTERS
                and self._total_message_characters + len(cleaned_message) + MAX_MESSAGE_LENGTH
                <= MAX_TOTAL_STORED_MESSAGE_CHARACTERS
            )

    def append_owned(
        self,
        conversation_id: UUID,
        owner_user_id: UUID,
        messages: tuple[tuple[str, str], ...],
        *,
        research: ResearchResult | None = None,
    ) -> tuple[ConversationMessage, ...] | None:
        if (
            not isinstance(conversation_id, UUID)
            or not isinstance(owner_user_id, UUID)
            or not isinstance(messages, tuple)
            or not messages
        ):
            return None
        cleaned_messages: list[tuple[str, str]] = []
        for entry in messages:
            if (
                not isinstance(entry, tuple)
                or len(entry) != 2
                or not isinstance(entry[0], str)
                or entry[0] not in {"user", "assistant"}
                or not isinstance(entry[1], str)
            ):
                return None
            content = sanitize_provider_text(entry[1]).strip()
            for pattern in _NON_PERSISTABLE_MESSAGE_PATTERNS:
                content = pattern.sub("[REDACTED]", content)
            if not content:
                return None
            if len(content) > MAX_MESSAGE_LENGTH:
                raise ConversationLimitExceeded("A conversation message exceeds the size limit.")
            cleaned_messages.append((entry[0], content))

        research_payload = _serialize_research(research) if research is not None else None
        assistant_index = next(
            (index for index in range(len(cleaned_messages) - 1, -1, -1)
             if cleaned_messages[index][0] == "assistant"),
            None,
        )
        if research_payload is not None and assistant_index is None:
            return None

        with self._lock:
            conversation = self._conversations.get(conversation_id)
            if conversation is None or conversation.owner_user_id != owner_user_id:
                return None
            added_characters = sum(len(content) for _, content in cleaned_messages)
            if (
                self._message_counts[conversation_id] + len(cleaned_messages) > MAX_MESSAGES_PER_CONVERSATION
                or self._conversation_characters[conversation_id] + added_characters > MAX_CONVERSATION_CHARACTERS
                or self._total_message_characters + added_characters > MAX_TOTAL_STORED_MESSAGE_CHARACTERS
            ):
                raise ConversationLimitExceeded("The conversation storage limit has been reached.")
            now = datetime.now(timezone.utc)
            records = tuple(
                ConversationMessage(
                    message_id=uuid4(),
                    conversation_id=conversation_id,
                    role=role,
                    content=content,
                    created_at=now,
                )
                for role, content in cleaned_messages
            )
            if research_payload is not None and assistant_index is not None:
                records = tuple(
                    replace(
                        record,
                        research=research,
                        research_retrieved_at=now,
                    ) if index == assistant_index else record
                    for index, record in enumerate(records)
                )
            self._messages[conversation_id].extend(records)
            self._message_counts[conversation_id] += len(records)
            self._conversation_characters[conversation_id] += added_characters
            self._total_message_characters += added_characters
            first_user_message = next(
                (content for role, content in cleaned_messages if role == "user"),
                None,
            )
            self._conversations[conversation_id] = Conversation(
                conversation_id=conversation.conversation_id,
                owner_user_id=conversation.owner_user_id,
                created_at=conversation.created_at,
                updated_at=now,
                title=(
                    conversation.title
                    or (generate_conversation_title(first_user_message) if first_user_message else "")
                ),
            )
            return records


class SQLiteConversationRepository:
    """SQLite-backed conversation repository for local, offline persistence."""

    _SCHEMA_VERSION = 2

    def __init__(self, database_path: str | Path) -> None:
        path = Path(database_path).expanduser()
        if not str(path):
            raise ValueError("A conversation database path is required.")
        self.database_path = path if path.is_absolute() else Path.cwd() / path
        self._lock = threading.RLock()
        self._initialized = False
        self._fresh_database = False
        self._database_identity: tuple[int, int] | None = None

    @classmethod
    def from_environment(cls, environ: dict[str, str] | None = None) -> "SQLiteConversationRepository":
        values = os.environ if environ is None else environ
        configured_path = values.get("PARMAR_CONVERSATION_DB_PATH")
        if configured_path is not None and not configured_path.strip():
            raise ValueError("PARMAR_CONVERSATION_DB_PATH must not be empty.")
        path = (
            Path(configured_path).expanduser()
            if configured_path is not None
            else Path.home() / ".local" / "share" / "parmar" / "conversations.sqlite3"
        )
        return cls(path)

    @staticmethod
    def _timestamp(value: str) -> datetime:
        try:
            parsed = datetime.fromisoformat(value)
        except (TypeError, ValueError) as error:
            raise ConversationStorageUnavailable("Conversation storage is unavailable.") from error
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ConversationStorageUnavailable("Conversation storage is unavailable.")
        return parsed.astimezone(timezone.utc)

    @classmethod
    def _conversation_from_row(cls, row: sqlite3.Row) -> Conversation:
        try:
            title = row["title"]
            if not isinstance(title, str) or len(title) > MAX_CONVERSATION_TITLE_LENGTH:
                raise ValueError("Invalid stored conversation title.")
            return Conversation(
                conversation_id=UUID(row["conversation_id"]),
                owner_user_id=UUID(row["owner_user_id"]),
                created_at=cls._timestamp(row["created_at"]),
                updated_at=cls._timestamp(row["updated_at"]),
                title=title,
            )
        except (KeyError, TypeError, ValueError) as error:
            raise ConversationStorageUnavailable("Conversation storage is unavailable.") from error

    @classmethod
    def _message_from_row(cls, row: sqlite3.Row) -> ConversationMessage:
        try:
            role = row["role"]
            content = row["content"]
            if (
                role not in {"user", "assistant"}
                or not isinstance(content, str)
                or not content
                or len(content) > MAX_MESSAGE_LENGTH
            ):
                raise ValueError("Invalid stored message.")
            research = None
            research_retrieved_at = None
            if row["research_payload"] is not None:
                payload = row["research_payload"]
                if (
                    not isinstance(payload, str)
                    or len(payload.encode("utf-8")) > MAX_RESEARCH_ENVELOPE_BYTES
                ):
                    raise ValueError("Invalid stored research metadata.")
                decoded = json.loads(payload)
                research = research_result_from_payload(decoded)
                if (
                    row["research_contract_version"] != CONTRACT_VERSION
                    or row["research_status"] != research.status.value
                    or research.status not in {ResearchStatus.RESULTS, ResearchStatus.NO_RESULTS}
                ):
                    raise ValueError("Invalid stored research metadata.")
                research_retrieved_at = cls._timestamp(row["research_retrieved_at"])
            elif (
                row["research_contract_version"] is not None
                or row["research_status"] is not None
                or row["research_retrieved_at"] is not None
            ):
                raise ValueError("Incomplete stored research metadata.")
            return ConversationMessage(
                message_id=UUID(row["message_id"]),
                conversation_id=UUID(row["conversation_id"]),
                role=role,
                content=content,
                created_at=cls._timestamp(row["created_at"]),
                research=research,
                research_retrieved_at=research_retrieved_at,
            )
        except (
            KeyError,
            TypeError,
            ValueError,
            SourceValidationError,
            UnicodeError,
            RecursionError,
        ) as error:
            raise ConversationStorageUnavailable("Conversation storage is unavailable.") from error

    def _prepare_file(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.database_path.is_symlink():
            raise OSError("Conversation database must not be a symbolic link.")
        if not self.database_path.exists():
            if self._initialized:
                raise OSError("Conversation database is missing.")
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
            raise OSError("Conversation database path is not a file.")
        os.chmod(self.database_path, 0o600)
        stat = self.database_path.stat()
        identity = (stat.st_dev, stat.st_ino)
        if self._initialized and identity != self._database_identity:
            raise OSError("Conversation database has changed.")

    @staticmethod
    def _validate_schema(connection: sqlite3.Connection) -> None:
        integrity = connection.execute("PRAGMA quick_check").fetchone()
        if integrity is None or integrity[0] != "ok":
            raise ConversationStorageUnavailable("Conversation storage is unavailable.")
        required_tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        if not {"conversations", "messages", "message_research"}.issubset(required_tables):
            raise ConversationStorageUnavailable("Conversation storage is unavailable.")
        required_columns = {
            "conversations": {
                "conversation_id", "owner_user_id", "created_at", "updated_at", "title",
            },
            "messages": {
                "message_id", "conversation_id", "role", "content", "created_at",
            },
            "message_research": {
                "message_id", "conversation_id", "contract_version", "status", "payload",
                "retrieved_at",
            },
        }
        for table, columns in required_columns.items():
            actual = {
                row["name"]
                for row in connection.execute(f"PRAGMA table_info({table})").fetchall()
            }
            if not columns.issubset(actual):
                raise ConversationStorageUnavailable("Conversation storage is unavailable.")
        message_foreign_keys = connection.execute(
            "PRAGMA foreign_key_list(messages)"
        ).fetchall()
        if not any(
            row["table"] == "conversations" and row["on_delete"] == "CASCADE"
            for row in message_foreign_keys
        ):
            raise ConversationStorageUnavailable("Conversation storage is unavailable.")
        research_foreign_keys = connection.execute(
            "PRAGMA foreign_key_list(message_research)"
        ).fetchall()
        if not any(
            row["table"] == "messages" and row["on_delete"] == "CASCADE"
            for row in research_foreign_keys
        ) or not any(
            row["table"] == "conversations" and row["on_delete"] == "CASCADE"
            for row in research_foreign_keys
        ):
            raise ConversationStorageUnavailable("Conversation storage is unavailable.")
        required_triggers = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'trigger'"
            ).fetchall()
        }
        if not {
            "message_research_assistant_only",
            "message_research_assistant_only_update",
        }.issubset(required_triggers):
            raise ConversationStorageUnavailable("Conversation storage is unavailable.")
        if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ConversationStorageUnavailable("Conversation storage is unavailable.")

    def _initialize(self, connection: sqlite3.Connection) -> None:
        if self._initialized:
            return
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version not in (0, 1, self._SCHEMA_VERSION):
            raise ConversationStorageUnavailable("Conversation storage is unavailable.")
        if version == 0:
            if not self._fresh_database:
                raise ConversationStorageUnavailable("Conversation storage is unavailable.")
            existing_objects = connection.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('table', 'view', 'trigger') "
                "AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
            if existing_objects:
                raise ConversationStorageUnavailable("Conversation storage is unavailable.")
        connection.execute("BEGIN IMMEDIATE")
        try:
            if version == 0:
                connection.execute(
                    "CREATE TABLE conversations ("
                    "conversation_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, "
                    "created_at TEXT NOT NULL, updated_at TEXT NOT NULL, title TEXT NOT NULL DEFAULT '')"
                )
                connection.execute(
                    "CREATE INDEX conversations_owner_updated "
                    "ON conversations(owner_user_id, updated_at DESC)"
                )
                connection.execute(
                    "CREATE TABLE messages ("
                    "message_id TEXT PRIMARY KEY, "
                    "conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE, "
                    "role TEXT NOT NULL CHECK(role IN ('user', 'assistant')), "
                    "content TEXT NOT NULL, created_at TEXT NOT NULL)"
                )
                connection.execute(
                    "CREATE INDEX messages_conversation_created "
                    "ON messages(conversation_id, created_at, message_id)"
                )
            if version in (0, 1):
                required_columns = {
                    "conversations": {
                        "conversation_id", "owner_user_id", "created_at", "updated_at", "title",
                    },
                    "messages": {
                        "message_id", "conversation_id", "role", "content", "created_at",
                    },
                }
                for table, columns in required_columns.items():
                    actual = {
                        row["name"]
                        for row in connection.execute(f"PRAGMA table_info({table})").fetchall()
                    }
                    if not columns.issubset(actual):
                        raise ConversationStorageUnavailable("Conversation storage is unavailable.")
                connection.execute(
                    "CREATE UNIQUE INDEX messages_message_conversation "
                    "ON messages(message_id, conversation_id)"
                )
                connection.execute(
                    "CREATE TABLE message_research ("
                    "message_id TEXT PRIMARY KEY, "
                    "conversation_id TEXT NOT NULL, "
                    "contract_version TEXT NOT NULL, "
                    "status TEXT NOT NULL CHECK(status IN ('RESULTS', 'NO_RESULTS')), "
                    f"payload TEXT NOT NULL CHECK(length(CAST(payload AS BLOB)) <= {MAX_RESEARCH_ENVELOPE_BYTES}), "
                    "retrieved_at TEXT NOT NULL, "
                    "FOREIGN KEY(message_id, conversation_id) "
                    "REFERENCES messages(message_id, conversation_id) ON DELETE CASCADE, "
                    "FOREIGN KEY(conversation_id) "
                    "REFERENCES conversations(conversation_id) ON DELETE CASCADE)"
                )
                connection.execute(
                    "CREATE TRIGGER message_research_assistant_only "
                    "BEFORE INSERT ON message_research "
                    "WHEN (SELECT role FROM messages WHERE message_id = NEW.message_id) <> 'assistant' "
                    "BEGIN SELECT RAISE(ABORT, 'research metadata requires assistant message'); END"
                )
                connection.execute(
                    "CREATE TRIGGER message_research_assistant_only_update "
                    "BEFORE UPDATE ON message_research "
                    "WHEN (SELECT role FROM messages WHERE message_id = NEW.message_id) <> 'assistant' "
                    "BEGIN SELECT RAISE(ABORT, 'research metadata requires assistant message'); END"
                )
                connection.execute(f"PRAGMA user_version = {self._SCHEMA_VERSION}")
            self._validate_schema(connection)
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        stat = self.database_path.stat()
        self._database_identity = (stat.st_dev, stat.st_ino)
        self._initialized = True

    @contextmanager
    def _connection(self, *, write: bool = False) -> Iterator[sqlite3.Connection]:
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
                    connection.execute("PRAGMA foreign_keys = ON")
                    self._initialize(connection)
                    if write:
                        connection.execute("BEGIN IMMEDIATE")
                    try:
                        yield connection
                    except Exception:
                        if write:
                            connection.rollback()
                        raise
                    else:
                        if write:
                            connection.commit()
                finally:
                    connection.close()
        except ConversationLimitExceeded:
            raise
        except ConversationStorageUnavailable:
            raise
        except (OSError, sqlite3.Error) as error:
            raise ConversationStorageUnavailable("Conversation storage is unavailable.") from error

    @staticmethod
    def _clean_message(content: str) -> str:
        cleaned = sanitize_provider_text(content).strip()
        for pattern in _NON_PERSISTABLE_MESSAGE_PATTERNS:
            cleaned = pattern.sub("[REDACTED]", cleaned)
        return cleaned

    def _create_locked(self, connection: sqlite3.Connection, owner_user_id: UUID) -> Conversation:
        owner_count = connection.execute(
            "SELECT COUNT(*) FROM conversations WHERE owner_user_id = ?",
            (str(owner_user_id),),
        ).fetchone()[0]
        total_count = connection.execute("SELECT COUNT(*) FROM conversations").fetchone()[0]
        if owner_count >= MAX_CONVERSATIONS_PER_USER:
            raise ConversationLimitExceeded("The user conversation limit has been reached.")
        if total_count >= MAX_TOTAL_CONVERSATIONS:
            raise ConversationLimitExceeded("The server conversation limit has been reached.")
        now = datetime.now(timezone.utc)
        conversation = Conversation(
            conversation_id=uuid4(),
            owner_user_id=owner_user_id,
            created_at=now,
            updated_at=now,
        )
        connection.execute(
            "INSERT INTO conversations(conversation_id, owner_user_id, created_at, updated_at, title) "
            "VALUES (?, ?, ?, ?, '')",
            (
                str(conversation.conversation_id),
                str(owner_user_id),
                now.isoformat(),
                now.isoformat(),
            ),
        )
        return conversation

    def create(self, owner_user_id: UUID) -> Conversation:
        if not isinstance(owner_user_id, UUID):
            raise TypeError("Conversation owners must be server-established user IDs.")
        with self._connection(write=True) as connection:
            return self._create_locked(connection, owner_user_id)

    def create_for_message(self, owner_user_id: UUID, user_message: str) -> Conversation:
        if not isinstance(owner_user_id, UUID):
            raise TypeError("Conversation owners must be server-established user IDs.")
        if not isinstance(user_message, str):
            raise ValueError("A user message is required to create a conversation.")
        cleaned_message = self._clean_message(user_message)
        if not cleaned_message or len(cleaned_message) > MAX_MESSAGE_LENGTH:
            raise ConversationLimitExceeded("The conversation storage limit has been reached.")
        with self._connection(write=True) as connection:
            total_characters = connection.execute(
                "SELECT COALESCE(SUM(length(content)), 0) FROM messages"
            ).fetchone()[0]
            if total_characters + len(cleaned_message) + MAX_MESSAGE_LENGTH > MAX_TOTAL_STORED_MESSAGE_CHARACTERS:
                raise ConversationLimitExceeded("The conversation storage limit has been reached.")
            return self._create_locked(connection, owner_user_id)

    def get_owned(self, conversation_id: UUID, owner_user_id: UUID) -> Conversation | None:
        if not isinstance(conversation_id, UUID) or not isinstance(owner_user_id, UUID):
            return None
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM conversations WHERE conversation_id = ? AND owner_user_id = ?",
                (str(conversation_id), str(owner_user_id)),
            ).fetchone()
            return self._conversation_from_row(row) if row is not None else None

    def list_owned(self, owner_user_id: UUID) -> tuple[Conversation, ...]:
        if not isinstance(owner_user_id, UUID):
            return ()
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT * FROM conversations WHERE owner_user_id = ? AND title <> '' "
                "ORDER BY updated_at DESC",
                (str(owner_user_id),),
            ).fetchall()
            return tuple(self._conversation_from_row(row) for row in rows)

    def delete_owned(self, conversation_id: UUID, owner_user_id: UUID) -> bool:
        if not isinstance(conversation_id, UUID) or not isinstance(owner_user_id, UUID):
            return False
        with self._connection(write=True) as connection:
            cursor = connection.execute(
                "DELETE FROM conversations WHERE conversation_id = ? AND owner_user_id = ?",
                (str(conversation_id), str(owner_user_id)),
            )
            return cursor.rowcount == 1

    def recent_owned(
        self,
        conversation_id: UUID,
        owner_user_id: UUID,
        limit: int,
    ) -> tuple[ConversationMessage, ...] | None:
        if (
            not isinstance(conversation_id, UUID)
            or not isinstance(owner_user_id, UUID)
            or not isinstance(limit, int)
            or isinstance(limit, bool)
            or limit <= 0
        ):
            return None
        with self._connection() as connection:
            owned = connection.execute(
                "SELECT 1 FROM conversations WHERE conversation_id = ? AND owner_user_id = ?",
                (str(conversation_id), str(owner_user_id)),
            ).fetchone()
            if owned is None:
                return None
            rows = connection.execute(
                "SELECT * FROM (SELECT m.rowid AS sequence, m.*, "
                "r.contract_version AS research_contract_version, "
                "r.status AS research_status, r.payload AS research_payload, "
                "r.retrieved_at AS research_retrieved_at "
                "FROM messages m LEFT JOIN message_research r ON r.message_id = m.message_id "
                "WHERE m.conversation_id = ? ORDER BY m.rowid DESC LIMIT ?) "
                "ORDER BY sequence",
                (str(conversation_id), limit),
            ).fetchall()
            return tuple(self._message_from_row(row) for row in rows)

    def can_append_owned(
        self,
        conversation_id: UUID,
        owner_user_id: UUID,
        user_message: str,
    ) -> bool | None:
        if (
            not isinstance(conversation_id, UUID)
            or not isinstance(owner_user_id, UUID)
            or not isinstance(user_message, str)
        ):
            return None
        cleaned_message = sanitize_provider_text(user_message).strip()
        if not cleaned_message or len(cleaned_message) > MAX_MESSAGE_LENGTH:
            return False
        with self._connection() as connection:
            conversation = connection.execute(
                "SELECT 1 FROM conversations WHERE conversation_id = ? AND owner_user_id = ?",
                (str(conversation_id), str(owner_user_id)),
            ).fetchone()
            if conversation is None:
                return None
            message_count, conversation_characters = connection.execute(
                "SELECT COUNT(*), COALESCE(SUM(length(content)), 0) FROM messages "
                "WHERE conversation_id = ?",
                (str(conversation_id),),
            ).fetchone()
            total_characters = connection.execute(
                "SELECT COALESCE(SUM(length(content)), 0) FROM messages"
            ).fetchone()[0]
            return (
                message_count + 2 <= MAX_MESSAGES_PER_CONVERSATION
                and conversation_characters + len(cleaned_message) + MAX_MESSAGE_LENGTH
                <= MAX_CONVERSATION_CHARACTERS
                and total_characters + len(cleaned_message) + MAX_MESSAGE_LENGTH
                <= MAX_TOTAL_STORED_MESSAGE_CHARACTERS
            )

    def append_owned(
        self,
        conversation_id: UUID,
        owner_user_id: UUID,
        messages: tuple[tuple[str, str], ...],
        *,
        research: ResearchResult | None = None,
    ) -> tuple[ConversationMessage, ...] | None:
        if (
            not isinstance(conversation_id, UUID)
            or not isinstance(owner_user_id, UUID)
            or not isinstance(messages, tuple)
            or not messages
        ):
            return None
        cleaned_messages: list[tuple[str, str]] = []
        for entry in messages:
            if (
                not isinstance(entry, tuple)
                or len(entry) != 2
                or not isinstance(entry[0], str)
                or entry[0] not in {"user", "assistant"}
                or not isinstance(entry[1], str)
            ):
                return None
            content = self._clean_message(entry[1])
            if not content:
                return None
            if len(content) > MAX_MESSAGE_LENGTH:
                raise ConversationLimitExceeded("A conversation message exceeds the size limit.")
            cleaned_messages.append((entry[0], content))

        research_payload = _serialize_research(research) if research is not None else None
        assistant_index = next(
            (index for index in range(len(cleaned_messages) - 1, -1, -1)
             if cleaned_messages[index][0] == "assistant"),
            None,
        )
        if research_payload is not None and assistant_index is None:
            return None

        with self._connection(write=True) as connection:
            row = connection.execute(
                "SELECT * FROM conversations WHERE conversation_id = ? AND owner_user_id = ?",
                (str(conversation_id), str(owner_user_id)),
            ).fetchone()
            if row is None:
                return None
            message_count, conversation_characters = connection.execute(
                "SELECT COUNT(*), COALESCE(SUM(length(content)), 0) FROM messages "
                "WHERE conversation_id = ?",
                (str(conversation_id),),
            ).fetchone()
            total_characters = connection.execute(
                "SELECT COALESCE(SUM(length(content)), 0) FROM messages"
            ).fetchone()[0]
            added_characters = sum(len(content) for _, content in cleaned_messages)
            if (
                message_count + len(cleaned_messages) > MAX_MESSAGES_PER_CONVERSATION
                or conversation_characters + added_characters > MAX_CONVERSATION_CHARACTERS
                or total_characters + added_characters > MAX_TOTAL_STORED_MESSAGE_CHARACTERS
            ):
                raise ConversationLimitExceeded("The conversation storage limit has been reached.")
            now = datetime.now(timezone.utc)
            records = tuple(
                ConversationMessage(
                    message_id=uuid4(),
                    conversation_id=conversation_id,
                    role=role,
                    content=content,
                    created_at=now,
                )
                for role, content in cleaned_messages
            )
            connection.executemany(
                "INSERT INTO messages(message_id, conversation_id, role, content, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                [
                    (
                        str(record.message_id),
                        str(conversation_id),
                        record.role,
                        record.content,
                        now.isoformat(),
                    )
                    for record in records
                ],
            )
            if research_payload is not None and assistant_index is not None:
                assistant_record = records[assistant_index]
                connection.execute(
                    "INSERT INTO message_research("
                    "message_id, conversation_id, contract_version, status, payload, retrieved_at"
                    ") VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        str(assistant_record.message_id),
                        str(conversation_id),
                        research.contract_version,
                        research.status.value,
                        research_payload,
                        now.isoformat(),
                    ),
                )
                records = tuple(
                    replace(
                        record,
                        research=research,
                        research_retrieved_at=now,
                    ) if index == assistant_index else record
                    for index, record in enumerate(records)
                )
            first_user_message = next(
                (content for role, content in cleaned_messages if role == "user"),
                None,
            )
            title = row["title"] or (
                generate_conversation_title(first_user_message) if first_user_message else ""
            )
            connection.execute(
                "UPDATE conversations SET updated_at = ?, title = ? WHERE conversation_id = ?",
                (now.isoformat(), title, str(conversation_id)),
            )
            return records
