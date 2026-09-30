"""Chat contracts used by the PARMAR provider abstraction."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ChatMessage:
    role: str
    content: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ChatResponse:
    provider: str
    content: str
    safe: bool
    status: str = "OK"
    metadata: dict[str, Any] = field(default_factory=dict)
