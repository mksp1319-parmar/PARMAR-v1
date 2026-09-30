"""Provider abstraction used by the PARMAR chat architecture."""

from __future__ import annotations

from typing import Any

from .models import ChatResponse


class LocalDemoProvider:
    """A local provider used for safe demo purposes without external keys."""

    name = "local-demo"

    def generate(self, prompt: str, context: Any | None = None) -> ChatResponse:
        text = (prompt or "").strip()
        if not text:
            return ChatResponse(provider=self.name, content="Please provide a question or proposal to assess.", safe=True, status="NO_INPUT")

        content = (
            "I can help explain the request, identify risks, and suggest a safer path. "
            "I do not execute actions or bypass PARMAR controls."
        )
        return ChatResponse(provider=self.name, content=f"{content} User prompt: {text[:160]}", safe=True, status="OK")
