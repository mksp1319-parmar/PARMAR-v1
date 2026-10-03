"""Server-owned, explicitly user-managed memory records."""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol
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
        for _score, record in scored_records:
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
