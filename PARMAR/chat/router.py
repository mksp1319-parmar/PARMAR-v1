"""Route chat requests through a provider abstraction without bypassing PARMAR."""

from __future__ import annotations

from typing import Any

from .providers import LocalDemoProvider


class ChatRouter:
    """Choose a safe, local provider by default."""

    def __init__(self, provider: Any | None = None):
        self.provider = provider or LocalDemoProvider()

    def route(self, prompt: str, context: Any | None = None):
        return self.provider.generate(prompt, context=context)
