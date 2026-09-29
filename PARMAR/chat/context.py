"""Conversation state kept outside the safety policy."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ChatContext:
    language: str = "en"
    persona: str = "neutral"
    memory: list[str] = field(default_factory=list)
