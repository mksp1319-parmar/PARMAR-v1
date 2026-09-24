"""Central runtime enforcement gate for PARMAR V1."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from PARMAR.audit.decision_logs import DecisionLogManager


class EnforcementState:
    """Explicit state machine values for controlled execution gating."""

    PROPOSED = "PROPOSED"
    SAFETY_REVIEW = "SAFETY_REVIEW"
    HUMAN_APPROVAL_REQUIRED = "HUMAN_APPROVAL_REQUIRED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    BLOCKED = "BLOCKED"
    READY_FOR_ACTION = "READY_FOR_ACTION"


class ActionBoundary:
    """Safe action boundary that only returns whether execution would be permitted."""

    def __init__(self):
        self.started = True

    def can_execute(self, enforcement_result: dict[str, Any]) -> bool:
        return bool(enforcement_result.get("execution_allowed", False))

    def evaluate(self, enforcement_result: dict[str, Any]) -> dict[str, Any]:
        return {
            "execution_allowed": self.can_execute(enforcement_result),
            "status": "ACTION_BOUNDARY_OK" if self.can_execute(enforcement_result) else "ACTION_BOUNDARY_DENIED",
            "decision_id": enforcement_result.get("decision_id"),
            "reason": enforcement_result.get("reason"),
        }


class CentralEnforcementGate:
    """Enforce a single, centralized runtime decision rule for PARMAR proposals."""

    def __init__(self):
        self.logger = DecisionLogManager()

    @staticmethod
    def _normalize_approval(value: Any) -> str:
        normalized = str(value or "").strip().upper()
        if normalized in {"APPROVE", "APPROVED"}:
            return "APPROVED"
        if normalized in {"REJECT", "REJECTED"}:
            return "REJECTED"
        if normalized in {"PENDING", "PENDING HUMAN APPROVAL", "HUMAN_APPROVAL_REQUIRED"}:
            return "PENDING HUMAN APPROVAL"
        if normalized in {"NO HUMAN APPROVAL REQUIRED", "NO_APPROVAL_REQUIRED", "NOT_REQUIRED"}:
            return "NO HUMAN APPROVAL REQUIRED"
        return "INVALID"

    def _log(self, event_type: str, payload: dict[str, Any]) -> None:
        safe_payload = {
            "decision_id": payload.get("decision_id"),
            "status": payload.get("status"),
            "event": payload.get("event"),
            "risk_level": payload.get("risk_level"),
            "human_approval": payload.get("human_approval"),
        }
        self.logger.log_event(event_type, safe_payload)

    def evaluate_decision(
        self,
        decision: dict[str, Any],
        privacy_result: dict[str, Any] | None = None,
        autonomy_result: dict[str, Any] | None = None,
        emergency_result: dict[str, Any] | None = None,
        human_approval: str | None = None,
    ) -> dict[str, Any]:
        decision_id = str(uuid4())
        risk_level = str(
            (decision.get("risk") or {}).get("risk_level")
            or decision.get("risk_level")
            or "low"
        ).lower()

        decision_record = decision.get("decision") or decision
        requires_human_approval = bool(
            decision_record.get("requires_human_approval")
            or decision.get("requires_human_approval")
            or decision.get("human_approval_required")
            or (risk_level in {"medium", "high", "critical"})
        )

        privacy_allowed = bool((privacy_result or {}).get("allow_execution", True))
        autonomy_allowed = bool((autonomy_result or {}).get("allow_execution", True))
        emergency_allowed = bool((emergency_result or {}).get("allow_execution", True))

        self._log("proposal_received", {
            "decision_id": decision_id,
            "event": "proposal_received",
            "risk_level": risk_level,
            "human_approval": human_approval,
        })

        if not privacy_allowed or not autonomy_allowed or not emergency_allowed:
            result = {
                "status": EnforcementState.BLOCKED,
                "state": EnforcementState.BLOCKED,
                "execution_allowed": False,
                "human_approval_required": requires_human_approval,
                "human_approval": self._normalize_approval(human_approval),
                "reason": "Safety gate blocked the proposal before action permission could be granted.",
                "decision_id": decision_id,
            }
            self._log("blocked", {
                "decision_id": decision_id,
                "status": EnforcementState.BLOCKED,
                "event": "blocked",
                "risk_level": risk_level,
                "human_approval": result["human_approval"],
            })
            self._log("execution_permission_denied", {
                "decision_id": decision_id,
                "status": EnforcementState.BLOCKED,
                "event": "execution_permission_denied",
                "risk_level": risk_level,
                "human_approval": result["human_approval"],
            })
            return result

        if requires_human_approval:
            normalized_approval = self._normalize_approval(human_approval)
            self._log("safety_review", {
                "decision_id": decision_id,
                "status": EnforcementState.SAFETY_REVIEW,
                "event": "safety_review",
                "risk_level": risk_level,
                "human_approval": normalized_approval,
            })

            if normalized_approval == "REJECTED":
                result = {
                    "status": EnforcementState.REJECTED,
                    "state": EnforcementState.REJECTED,
                    "execution_allowed": False,
                    "human_approval_required": True,
                    "human_approval": "REJECTED",
                    "reason": "The proposal was explicitly rejected by a human reviewer.",
                    "decision_id": decision_id,
                }
                self._log("rejected", {
                    "decision_id": decision_id,
                    "status": EnforcementState.REJECTED,
                    "event": "rejected",
                    "risk_level": risk_level,
                    "human_approval": "REJECTED",
                })
                self._log("execution_permission_denied", {
                    "decision_id": decision_id,
                    "status": EnforcementState.REJECTED,
                    "event": "execution_permission_denied",
                    "risk_level": risk_level,
                    "human_approval": "REJECTED",
                })
                return result

            if normalized_approval in {"INVALID", "PENDING HUMAN APPROVAL", "NO HUMAN APPROVAL REQUIRED"}:
                result = {
                    "status": EnforcementState.HUMAN_APPROVAL_REQUIRED,
                    "state": EnforcementState.HUMAN_APPROVAL_REQUIRED,
                    "execution_allowed": False,
                    "human_approval_required": True,
                    "human_approval": None,
                    "reason": "Human approval is required before the proposal may reach an action boundary.",
                    "decision_id": decision_id,
                }
                self._log("approval_requested", {
                    "decision_id": decision_id,
                    "status": EnforcementState.HUMAN_APPROVAL_REQUIRED,
                    "event": "approval_requested",
                    "risk_level": risk_level,
                    "human_approval": None,
                })
                self._log("execution_permission_denied", {
                    "decision_id": decision_id,
                    "status": EnforcementState.HUMAN_APPROVAL_REQUIRED,
                    "event": "execution_permission_denied",
                    "risk_level": risk_level,
                    "human_approval": None,
                })
                return result

            if normalized_approval == "APPROVED":
                result = {
                    "status": EnforcementState.READY_FOR_ACTION,
                    "state": EnforcementState.APPROVED,
                    "execution_allowed": True,
                    "human_approval_required": True,
                    "human_approval": "APPROVED",
                    "reason": "The action has explicit human approval and passed the safety review gate.",
                    "decision_id": decision_id,
                }
                self._log("approved", {
                    "decision_id": decision_id,
                    "status": EnforcementState.READY_FOR_ACTION,
                    "event": "approved",
                    "risk_level": risk_level,
                    "human_approval": "APPROVED",
                })
                return result

        result = {
            "status": EnforcementState.READY_FOR_ACTION,
            "state": EnforcementState.READY_FOR_ACTION,
            "execution_allowed": True,
            "human_approval_required": False,
            "human_approval": "NO HUMAN APPROVAL REQUIRED",
            "reason": "The proposal is low-risk and passed all safety checks without requiring explicit human approval.",
            "decision_id": decision_id,
        }
        self._log("approved", {
            "decision_id": decision_id,
            "status": EnforcementState.READY_FOR_ACTION,
            "event": "approved",
            "risk_level": risk_level,
            "human_approval": "NO HUMAN APPROVAL REQUIRED",
        })
        return result
