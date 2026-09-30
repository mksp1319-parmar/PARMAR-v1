"""Safe chat service that enforces PARMAR policy before responding with actions."""

from __future__ import annotations

from typing import Any

from PARMAR.chat.context import ChatContext
from PARMAR.chat.router import ChatRouter
from PARMAR.interface.ui_adapter import PARMARUIAdapter


class ChatService:
    """Wrap model output in PARMAR safety analysis so no action bypasses controls."""

    def __init__(self, router: ChatRouter | None = None):
        self.router = router or ChatRouter()

    def respond(self, prompt: str, context: ChatContext | None = None) -> dict[str, Any]:
        analysis = PARMARUIAdapter.analyze_request(prompt)

        if analysis.get("status") in {"BLOCKED", "APPROVAL_REQUIRED"}:
            return {
                "safe": False,
                "status": analysis.get("status"),
                "message": analysis.get("message", "The request requires a human decision before any proposal is allowed."),
                "provider": self.router.provider.name,
                "analysis": analysis,
            }

        result = self.router.route(prompt, context=context)
        return {
            "safe": bool(result.safe),
            "status": result.status or analysis.get("status"),
            "message": result.content,
            "provider": result.provider,
            "analysis": analysis,
        }
