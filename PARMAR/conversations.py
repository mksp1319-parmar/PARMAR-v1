"""Provider-neutral, process-local conversation and message repositories."""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol
from uuid import UUID, uuid4

from PARMAR.chat.context import sanitize_provider_text

MAX_CONVERSATIONS_PER_USER = 50
MAX_TOTAL_CONVERSATIONS = 10_000
MAX_MESSAGES_PER_CONVERSATION = 100
MAX_MESSAGE_LENGTH = 4_000
MAX_CONVERSATION_CHARACTERS = 50_000
MAX_TOTAL_STORED_MESSAGE_CHARACTERS = 50_000_000


_NON_PERSISTABLE_MESSAGE_PATTERNS = (
    re.compile(r"(?im)^\s*(?:cookie|set-cookie)\s*:\s*[^\r\n]*"),
    re.compile(r"(?im)^\s*(?:x-csrf-token|x-session-token|x-approval-token)\s*:\s*[^\r\n]*"),
    re.compile(
        r"\b(?:session|csrf|approval)[\s_-]?token\b\s*(?:is|[:=]|\s)\s*\S+",
        re.IGNORECASE,
    ),
)


class ConversationLimitExceeded(ValueError):
    """Raised when an append or create would exceed a fixed storage quota."""


@dataclass(frozen=True)
class Conversation:
    conversation_id: UUID
    owner_user_id: UUID
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class ConversationMessage:
    message_id: UUID
    conversation_id: UUID
    role: str
    content: str
    created_at: datetime


class ConversationRepository(Protocol):
    """Storage operations for server-owned conversations."""

    def create(self, owner_user_id: UUID) -> Conversation: ...

    def create_for_message(self, owner_user_id: UUID, user_message: str) -> Conversation: ...

    def get_owned(self, conversation_id: UUID, owner_user_id: UUID) -> Conversation | None: ...

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
    ) -> tuple[ConversationMessage, ...] | None: ...


class InMemoryConversationRepository:
    """Thread-safe in-memory implementation for the current local deployment."""

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

        with self._lock:
            conversation = self._conversations.get(conversation_id)
            if conversation is None or conversation.owner_user_id != owner_user_id:
                return None
            added_characters = sum(len(content) for _role, content in cleaned_messages)
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
            self._messages[conversation_id].extend(records)
            self._message_counts[conversation_id] += len(records)
            self._conversation_characters[conversation_id] += added_characters
            self._total_message_characters += added_characters
            self._conversations[conversation_id] = Conversation(
                conversation_id=conversation.conversation_id,
                owner_user_id=conversation.owner_user_id,
                created_at=conversation.created_at,
                updated_at=now,
            )
            return records
