"""Conversation state kept outside the safety policy."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import ClassVar


MAX_MEMORY_ENTRIES = 5
MAX_MEMORY_ENTRY_LENGTH = 400
MAX_MEMORY_CONTEXT_LENGTH = 1200
MAX_CONTEXT_ENTRIES = 25
MAX_CONTEXT_TOTAL_LENGTH = MAX_CONTEXT_ENTRIES * MAX_MEMORY_ENTRY_LENGTH
MAX_RECENT_MESSAGES = 12
MAX_RECENT_MESSAGE_LENGTH = 4000
MAX_RECENT_CONTEXT_LENGTH = 12000

_SENSITIVE_MEMORY_PATTERNS = (
    re.compile(r"\b(?:password|passwd|pwd|passcode|secret|credential)\b\s*(?:is|[:=])\s*\S+", re.IGNORECASE),
    re.compile(r"\b(?:api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|auth(?:entication)?[\s_-]?token|client[\s_-]?secret|private[\s_-]?key)\b\s*(?:is|[:=])\s*\S+", re.IGNORECASE),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{12,}", re.IGNORECASE),
    re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----", re.IGNORECASE),
    re.compile(r"\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"https?://[^\s/@:]+:[^\s/@]+@", re.IGNORECASE),
    re.compile(r"\b(?:sk-[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{20,})\b"),
)

_PROVIDER_REDACTION_PATTERNS = (
    re.compile(r"\b(?:password|passwd|pwd|passcode|secret|credential|api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|auth(?:entication)?[\s_-]?token|client[\s_-]?secret)\b\s*(?:is|[:=])\s*\S+", re.IGNORECASE),
    re.compile(r"\bAuthorization\s*:\s*[^\r\n]*", re.IGNORECASE),
    re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)", re.IGNORECASE),
    *_SENSITIVE_MEMORY_PATTERNS[2:],
)


def sanitize_provider_text(text: str) -> str:
    """Remove credential-like values before request text crosses the provider boundary."""
    if not isinstance(text, str):
        return ""
    sanitized = text
    for pattern in _PROVIDER_REDACTION_PATTERNS:
        sanitized = pattern.sub("[REDACTED]", sanitized)
    return sanitized


def _safe_context_entries(values: object, *, limit: int, total_length: int) -> list[str]:
    if not isinstance(values, list):
        return []

    entries: list[str] = []
    remaining = total_length
    for entry in values[:limit]:
        if not isinstance(entry, str):
            continue
        cleaned = entry.strip()
        if not cleaned or len(cleaned) > MAX_MEMORY_ENTRY_LENGTH:
            continue
        if any(pattern.search(cleaned) for pattern in _SENSITIVE_MEMORY_PATTERNS):
            continue
        if len(cleaned) > remaining:
            continue
        entries.append(cleaned)
        remaining -= len(cleaned)
        if len(entries) == limit or remaining == 0:
            break
    return entries


def sanitize_recent_messages(messages: object) -> list[dict[str, str]]:
    """Bound and redact conversational history before it reaches a provider."""
    if not isinstance(messages, list):
        return []

    safe_messages: list[dict[str, str]] = []
    remaining = MAX_RECENT_CONTEXT_LENGTH
    for message in messages[-MAX_RECENT_MESSAGES:]:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        content = message.get("content")
        if not isinstance(role, str) or role not in {"user", "assistant"} or not isinstance(content, str):
            continue
        cleaned = sanitize_provider_text(content).strip()
        if not cleaned:
            continue
        cleaned = cleaned[:min(MAX_RECENT_MESSAGE_LENGTH, remaining)]
        if not cleaned:
            break
        safe_messages.append({"role": role, "content": cleaned})
        remaining -= len(cleaned)
        if remaining <= 0:
            break
    return safe_messages


@dataclass
class ChatContext:
    """Structured chat data; saved memory is always untrusted user-owned context."""

    memory_trust: ClassVar[str] = "untrusted_user_owned_data"
    language: str = "en"
    persona: str = "neutral"
    memory: list[str] = field(default_factory=list)
    policy_rules: list[str] = field(default_factory=list)
    safety_status: str | None = None
    risk_level: str | None = None
    approval_required: bool | None = None
    approval_state: str | None = None
    required_permissions: list[str] = field(default_factory=list)
    enforcement_result: dict[str, str | bool] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.language = sanitize_provider_text(self.language)[:32] if isinstance(self.language, str) else "en"
        self.persona = sanitize_provider_text(self.persona)[:80] if isinstance(self.persona, str) else "neutral"
        self.memory = _safe_context_entries(
            self.memory,
            limit=MAX_MEMORY_ENTRIES,
            total_length=MAX_MEMORY_CONTEXT_LENGTH,
        )
        self.policy_rules = _safe_context_entries(
            self.policy_rules,
            limit=MAX_CONTEXT_ENTRIES,
            total_length=MAX_CONTEXT_TOTAL_LENGTH,
        )
        self.required_permissions = _safe_context_entries(
            self.required_permissions,
            limit=MAX_CONTEXT_ENTRIES,
            total_length=MAX_CONTEXT_TOTAL_LENGTH,
        )
