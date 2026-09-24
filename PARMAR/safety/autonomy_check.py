"""Autonomy safety check."""

from __future__ import annotations


class AutonomyCheck:
    """Prevent proposals that override human agency or independent decision-making."""

    def evaluate(self, request_text: str) -> dict:
        text = (request_text or "").lower()
        autonomy_keywords = [
            "disable user choice", "disable a user's decision-making rights", "override",
            "bypass approval", "remove decision-making rights", "decision-making rights",
            "automatic consent", "take control", "without permission", "disable"
        ]
        if any(keyword in text for keyword in autonomy_keywords):
            return {
                "allow_execution": False,
                "status": "BLOCKED",
                "risk_type": "autonomy",
                "reasons": ["This action undermines the human decision-maker by removing agency or bypassing informed consent."],
            }
        return {
            "allow_execution": True,
            "status": "PASS",
            "risk_type": "autonomy",
            "reasons": ["No direct autonomy override detected."],
        }
