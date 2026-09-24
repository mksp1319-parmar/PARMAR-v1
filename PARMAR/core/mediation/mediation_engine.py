"""Mediation engine for safer alternatives."""

from __future__ import annotations


class MediationEngine:
    """Generate safer alternatives when a proposal conflicts with human priorities or risk policies."""

    def generate_alternatives(self, conflict_reasons: list[str], risk_level: str, intent: str) -> dict:
        reasons = conflict_reasons or ["The proposal requires human review before any decision."]

        alternatives = []

        if "share" in intent or "data" in intent or any("privacy" in reason.lower() for reason in reasons):
            alternatives.append({
                "title": "Minimize exposure with consent-based review",
                "message": "Share only de-identified or minimal data after explicit human consent and a limited-scope approval step.",
                "reason": "This reduces privacy exposure while preserving the original goal with reduced risk.",
            })

        if risk_level in {"high", "critical"} or any("safety" in reason.lower() for reason in reasons):
            alternatives.append({
                "title": "Pause and escalate to supervised review",
                "message": "Stop the proposed action, escalate it to a human reviewer, and evaluate safer operational controls before any action proceeds.",
                "reason": "This prevents unsafe or irreversible action while preserving the human decision authority.",
            })

        if not alternatives:
            alternatives.append({
                "title": "Request a lower-risk alternative",
                "message": "Choose a narrower action with explicit human approval, limited permissions, and a monitored review stage.",
                "reason": "A smaller-scope action often reduces risk without abandoning the intended objective.",
            })

        return {
            "alternatives": alternatives,
            "risk_level": risk_level,
            "needs_human_review": True,
            "summary": "Mediation generated safer alternatives and suspended automatic action.",
        }
