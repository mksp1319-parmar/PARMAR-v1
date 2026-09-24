"""Decision engine for PARMAR."""

from __future__ import annotations


class DecisionEngine:
    """Construct a human-approval decision record for a proposed action."""

    def build_decision(
        self,
        goal: str,
        action: str,
        expected_benefit: str,
        required_data: list[str],
        required_permissions: list[str],
        possible_consequences: list[str],
        risk_level: str,
        safety_checks: list[str],
        detected_intent: str | None = None,
        detected_conflicts: list[str] | None = None,
        recommendation: str | None = None,
        human_approval_status: str | None = None,
    ) -> dict:
        risk_key = str(risk_level).lower()
        requires_human_approval = risk_key in {"medium", "high", "critical"}
        approval_status = human_approval_status or (
            "PENDING HUMAN APPROVAL" if requires_human_approval else "NO HUMAN APPROVAL REQUIRED"
        )
        approval_message = (
            "HUMAN APPROVAL REQUIRED. No consequential action may be executed without explicit human authorization."
            if requires_human_approval
            else "Low-risk request remains explainable and does not require automatic approval."
        )

        decision = {
            "Goal": goal,
            "Proposed Action": action,
            "Expected Benefit": expected_benefit,
            "Required Data": required_data,
            "Required Permissions": required_permissions,
            "Possible Consequences": possible_consequences,
            "Risk Level": risk_level,
            "Safety Checks": safety_checks,
            "Detected Intent": detected_intent or "unknown",
            "Detected Conflicts": detected_conflicts or [],
            "Recommendation": recommendation or "Human review required before action.",
            "human_approval_status": approval_status,
            "approval_message": approval_message,
            "requires_human_approval": requires_human_approval,
        }
        return decision
