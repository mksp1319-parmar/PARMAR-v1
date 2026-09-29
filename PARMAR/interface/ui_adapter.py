"""Thin UI adapter for the existing PARMAR policy pipeline."""

from __future__ import annotations

from typing import Any

from PARMAR.core.conflict.conflict_detector import ConflictDetector
from PARMAR.core.decision.decision_engine import DecisionEngine
from PARMAR.core.intent.intent_engine import IntentEngine
from PARMAR.core.mediation.mediation_engine import MediationEngine
from PARMAR.core.risk.risk_engine import RiskEngine
from PARMAR.interface.dashboard import TerminalDashboard
from PARMAR.interface.voki import PARMARVoki
from PARMAR.phone.phone_awareness import PhoneAwarenessModule
from PARMAR.safety.autonomy_check import AutonomyCheck
from PARMAR.safety.emergency_gate import EmergencyGate
from PARMAR.safety.enforcement_gate import ActionBoundary, CentralEnforcementGate
from PARMAR.safety.privacy_check import PrivacyCheck
from PARMAR.state import StateSnapshot


class PARMARUIAdapter:
    """Bridge the existing safety pipeline to the futuristic UI state model."""

    STAGES = [
        "INPUT",
        "INTENT",
        "RISK",
        "CONFLICT",
        "MEDIATION",
        "SAFETY CHECKS",
        "ENFORCEMENT",
        "HUMAN DECISION",
    ]

    @staticmethod
    def _stage_state(step_index: int, total_steps: int, current_status: str) -> str:
        if current_status in {"BLOCKED", "APPROVAL_REQUIRED"}:
            if step_index >= total_steps - 1:
                return "ACTIVE"
            return "COMPLETE"
        if current_status == "SAFE":
            return "COMPLETE"
        return "ACTIVE" if step_index <= total_steps - 2 else "COMPLETE"

    @staticmethod
    def _status_message(risk_level: str, enforcement: dict[str, Any], human_approval_required: bool) -> str:
        if enforcement.get("execution_allowed") is False:
            return "Action blocked by safety policy. Human decision remains the authority."
        if human_approval_required:
            return "Human approval required before action can proceed."
        if str(risk_level).lower() in {"medium", "high", "critical"}:
            return "Additional review recommended before any consequential action."
        return "Situation appears low risk and safe for review."

    @staticmethod
    def _state_value(summary: dict[str, Any]) -> str:
        enforcement = summary.get("enforcement", {})
        decision = summary.get("decision", {})

        if enforcement.get("status") == "HUMAN_APPROVAL_REQUIRED":
            return "APPROVAL_REQUIRED"
        if bool(decision.get("requires_human_approval")) and enforcement.get("execution_allowed") is False:
            return "APPROVAL_REQUIRED"
        if enforcement.get("execution_allowed") is False:
            return "BLOCKED"
        if bool(decision.get("requires_human_approval")):
            return "APPROVAL_REQUIRED"
        risk_level = str(summary.get("risk", {}).get("risk_level", "low")).lower()
        if risk_level in {"medium", "high", "critical"}:
            return "RISK_DETECTED"
        return "SAFE"

    @staticmethod
    def _risk_center(summary: dict[str, Any]) -> dict[str, Any]:
        risk = summary.get("risk", {})
        intent = summary.get("intent", {})
        conflict = summary.get("conflict", {})
        categories = [name for name, enabled in (risk.get("category_flags") or {}).items() if enabled]
        return {
            "risk_level": str(risk.get("risk_level", "low")).upper(),
            "risk_categories": categories or ["none_detected"],
            "detected_intent": intent.get("intent", "unknown"),
            "potential_conflict": conflict.get("reasons", ["No explicit conflict detected."]),
            "affected_human_interests": ["privacy", "autonomy", "safety"],
            "safety_checks": [
                summary.get("privacy", {}).get("status", "UNKNOWN"),
                summary.get("autonomy", {}).get("status", "UNKNOWN"),
                summary.get("emergency_gate", {}).get("status", "UNKNOWN"),
            ],
            "reason_for_decision": risk.get("summary", "Risk evaluation completed."),
        }

    @staticmethod
    def _explanation(summary: dict[str, Any], request_text: str) -> dict[str, Any]:
        return {
            "what_requested": request_text,
            "what_detected": summary.get("intent", {}).get("summary", "No intent detected."),
            "what_risks_found": summary.get("risk", {}).get("reasons", ["No specific risks found."]),
            "what_conflict_found": summary.get("conflict", {}).get("reasons", ["No conflict found."]),
            "what_safety_checks_did": [
                summary.get("privacy", {}).get("reasons", ["Privacy check completed."]),
                summary.get("autonomy", {}).get("reasons", ["Autonomy check completed."]),
                summary.get("emergency_gate", {}).get("reason", "Emergency gate completed."),
            ],
            "what_parmar_recommends": summary.get("mediation", {}).get("alternatives", [{"message": "Proceed with a safer, consent-based alternative."}])[0].get("message", "Review with human oversight."),
            "what_human_decided": summary.get("decision", {}).get("human_approval_status", "PENDING HUMAN APPROVAL"),
        }

    @classmethod
    def analyze_request(cls, request_text: str, language: str = "en") -> dict[str, Any]:
        response, _, _ = cls.analyze_request_with_dashboard(request_text, language)
        return response

    @classmethod
    def analyze_request_with_dashboard(
        cls,
        request_text: str,
        language: str = "en",
    ) -> tuple[dict[str, Any], TerminalDashboard | None, dict[str, Any] | None]:
        if not request_text or not str(request_text).strip():
            return ({
                "status": "BLOCKED",
                "human_control": True,
                "message": "No request supplied. PARMAR cannot approve an empty or missing action.",
                "request": "",
                "intent": {"intent": "unknown", "requested_action": "", "confidence": 0.0, "summary": "No request provided."},
                "risk": {"risk_level": "low", "reasons": ["No request text was provided."], "category_flags": {}},
                "conflict": {"conflict_detected": False, "reasons": ["No request supplied."], "matched_rules": [], "severity": "low"},
                "mediation": {"alternatives": [{"title": "Request clarification", "message": "Ask for a clearer proposal before proceeding."}]},
                "privacy": {"allow_execution": False, "status": "BLOCKED", "risk_type": "privacy", "reasons": ["No request was supplied."]},
                "autonomy": {"allow_execution": False, "status": "BLOCKED", "risk_type": "autonomy", "reasons": ["No request was supplied."]},
                "emergency_gate": {"allow_execution": False, "status": "BLOCKED", "reason": "No request was supplied."},
                "decision": {"requires_human_approval": True, "human_approval_status": "PENDING HUMAN APPROVAL", "approval_message": "A request is required before PARMAR can review or act."},
                "enforcement": {"execution_allowed": False, "status": "HUMAN_APPROVAL_REQUIRED", "reason": "Fail-closed: no request was provided."},
                "action_boundary": {"execution_allowed": False, "status": "ACTION_BOUNDARY_DENIED"},
                "language": language,
                "language_independent_safety": True,
                "voki": PARMARVoki().state_for("BLOCKED"),
                "phone_awareness": PhoneAwarenessModule().get_status(),
                "pipeline": [],
                "safer_alternatives": [{"title": "Request clarification", "message": "Ask for a clearer proposal before proceeding."}],
                "human_approval_required": True,
                "risk_center": {"risk_level": "LOW", "risk_categories": ["none_detected"], "detected_intent": "unknown", "potential_conflict": ["No request."], "affected_human_interests": ["privacy", "autonomy", "safety"], "safety_checks": ["BLOCKED", "BLOCKED", "BLOCKED"], "reason_for_decision": "Empty request is fail-closed."},
                "explanation": {"what_requested": "", "what_detected": "No request provided.", "what_risks_found": ["No request provided."], "what_conflict_found": ["No request provided."], "what_safety_checks_did": ["No safety checks could run without a request."], "what_parmar_recommends": "Request clarification before any action.", "what_human_decided": "PENDING HUMAN APPROVAL"},
                "chat_architecture": {"provider": "local-demo", "safety_middleware": True, "requires_human_approval": True},
                "system_state": {"title": "PARMAR Core", "detail": "No request supplied; fail-closed protection remains active."},
                "lifecycle": None,
            }, None, None)

        dashboard = TerminalDashboard()
        summary = dashboard.run_pipeline(
            request_text,
            human_interests=["privacy", "autonomy", "safety"],
            rules=[
                "No external sharing of personal data without approval",
                "No destructive action without explicit human sign-off",
                "Human agency must remain intact",
            ],
        )
        lifecycle_snapshot = dashboard.lifecycle_snapshot

        decision = summary.get("decision", {})
        risk = summary.get("risk", {})
        enforcement = summary.get("enforcement", {})
        action_boundary = summary.get("action_boundary", {})
        state = cls._state_value(summary)
        voki = PARMARVoki().state_for(lifecycle_snapshot.current_state.value)

        pipeline = []
        for index, stage in enumerate(cls.STAGES):
            if stage == "INPUT":
                label = "Request received"
            elif stage == "INTENT":
                label = summary.get("intent", {}).get("intent", "unknown")
            elif stage == "RISK":
                label = str(risk.get("risk_level", "low")).upper()
            elif stage == "CONFLICT":
                label = "Conflict review"
            elif stage == "MEDIATION":
                label = "Alternative generated"
            elif stage == "SAFETY CHECKS":
                label = "Privacy + autonomy + emergency"
            elif stage == "ENFORCEMENT":
                label = "Gate result"
            else:
                label = "Human authority"
            pipeline.append({
                "name": stage,
                "label": label,
                "state": cls._stage_state(index, len(cls.STAGES), state),
            })

        response = {
            "status": state,
            "human_control": True,
            "message": cls._status_message(risk.get("risk_level", "low"), enforcement, bool(decision.get("requires_human_approval"))),
            "request": request_text,
            "intent": summary.get("intent", {}),
            "risk": risk,
            "conflict": summary.get("conflict", {}),
            "mediation": summary.get("mediation", {}),
            "privacy": summary.get("privacy", {}),
            "autonomy": summary.get("autonomy", {}),
            "emergency_gate": summary.get("emergency_gate", {}),
            "decision": decision,
            "enforcement": enforcement,
            "action_boundary": action_boundary,
            "pipeline": pipeline,
            "safer_alternatives": summary.get("mediation", {}).get("alternatives", []),
            "human_approval_required": bool(decision.get("requires_human_approval")),
            "language": language,
            "language_independent_safety": True,
            "voki": voki,
            "lifecycle": cls._lifecycle_payload(lifecycle_snapshot),
            "phone_awareness": PhoneAwarenessModule().get_status(),
            "risk_center": cls._risk_center(summary),
            "explanation": cls._explanation(summary, request_text),
            "chat_architecture": {
                "provider": "local-demo",
                "safety_middleware": True,
                "requires_human_approval": bool(decision.get("requires_human_approval")),
            },
            "system_state": {
                "title": "PARMAR Core",
                "detail": voki.get("message", "Human oversight remains active."),
            },
        }
        return response, dashboard, summary

    @staticmethod
    def _lifecycle_payload(snapshot: StateSnapshot) -> dict[str, Any]:
        return {
            "current_state": snapshot.current_state.value,
            "previous_state": snapshot.previous_state.value if snapshot.previous_state else None,
            "transition_timestamp": snapshot.transition_timestamp.isoformat(),
            "request_id": snapshot.request_id,
            "decision_id": snapshot.decision_id,
            "enforcement_status": snapshot.enforcement_status,
            "risk_level": snapshot.risk_level,
            "intent": snapshot.intent,
            "human_approval_status": snapshot.human_approval_status,
            "reason": snapshot.reason,
        }

    @classmethod
    def process_human_decision(
        cls,
        request_text: str,
        decision: str,
        language: str = "en",
    ) -> dict[str, Any]:
        response, dashboard, summary = cls.analyze_request_with_dashboard(request_text, language)
        if dashboard is None or summary is None:
            return response
        approval_pending = (
            summary.get("enforcement", {}).get("status") == "HUMAN_APPROVAL_REQUIRED"
        )
        if not summary.get("decision", {}).get("requires_human_approval", False) and not approval_pending:
            return response

        outcome = dashboard.handle_human_decision(summary, decision)

        response["decision"] = outcome["decision"]
        response["enforcement"] = outcome["enforcement"]
        response["action_boundary"] = outcome["action_boundary"]
        enforcement_status = outcome["enforcement"].get("status")

        lifecycle_snapshot = dashboard.lifecycle_snapshot
        response["lifecycle"] = cls._lifecycle_payload(lifecycle_snapshot)
        response["voki"] = PARMARVoki().state_for(lifecycle_snapshot.current_state.value)

        if enforcement_status == "REJECTED":
            response["status"] = "BLOCKED"
            response["human_approval_required"] = True
            response["message"] = "The action was rejected by a human reviewer and remains blocked."
        elif enforcement_status == "HUMAN_APPROVAL_REQUIRED":
            response["status"] = "APPROVAL_REQUIRED"
            response["human_approval_required"] = True
            response["message"] = "More information is required before approval can be granted."
        elif enforcement_status == "BLOCKED":
            response["status"] = "BLOCKED"
            response["human_approval_required"] = True
            response["message"] = "This request is already blocked by PARMAR safety controls. Human approval cannot override a hard safety block."
        elif enforcement_status == "READY_FOR_ACTION":
            response["status"] = "APPROVED" if str(decision).strip().upper() in {"APPROVE", "APPROVED"} else "SAFE"
            response["human_approval_required"] = False
            response["message"] = "Human approval granted. The proposal is still limited to simulation and safety review."
        else:
            response["status"] = "SAFE"
            response["human_approval_required"] = False
            response["message"] = "The proposal remains within PARMAR's safe review boundary."

        return response
