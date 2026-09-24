"""Privacy-safe phone awareness module for PARMAR.

This module does not access real device APIs or private user data. It works on
simulated, locally processed event payloads and applies governance checks before any
processing or action is considered.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from PARMAR.audit.decision_logs import DecisionLogManager
from PARMAR.core.conflict.conflict_detector import ConflictDetector
from PARMAR.core.decision.decision_engine import DecisionEngine
from PARMAR.core.intent.intent_engine import IntentEngine
from PARMAR.core.risk.risk_engine import RiskEngine
from PARMAR.safety.autonomy_check import AutonomyCheck
from PARMAR.safety.emergency_gate import EmergencyGate
from PARMAR.safety.privacy_check import PrivacyCheck


class PhoneAwarenessModule:
    """Evaluate privacy-safe phone events with explicit human permission and local-only processing."""

    SENSITIVE_PHONE_DATA = {
        "passwords",
        "private_messages",
        "photos",
        "videos",
        "contacts",
        "location",
        "microphone",
        "camera",
        "messages",
        "call_log",
        "browser_history",
    }

    LOW_RISK_EVENTS = {"battery_low", "battery_status", "signal_strength", "screen_state", "notification"}
    HIGH_RISK_EVENTS = {
        "read_private_messages",
        "read_sms",
        "record_microphone",
        "record_camera",
        "read_contacts",
        "read_call_log",
        "track_location",
        "access_photos",
    }

    def __init__(self, permission_name: str = "phone_awareness"):
        self.permission_name = permission_name
        self.permissions: dict[str, bool] = {permission_name: False}
        self.logger = DecisionLogManager()

    def grant_permission(self, permission_name: str | None = None) -> bool:
        name = permission_name or self.permission_name
        self.permissions[name] = True
        return True

    def revoke_permission(self, permission_name: str | None = None) -> bool:
        name = permission_name or self.permission_name
        self.permissions[name] = False
        return True

    def has_permission(self, permission_name: str | None = None) -> bool:
        name = permission_name or self.permission_name
        return bool(self.permissions.get(name, False))

    def _normalize_event(self, event: dict[str, Any] | str) -> dict[str, Any]:
        if isinstance(event, str):
            normalized = {
                "event_type": event,
                "source": "simulated",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "permission_required": True,
                "permission_granted": False,
                "data_collected": [],
            }
            return normalized

        normalized = dict(event)
        normalized.setdefault("event_type", "unknown_phone_event")
        normalized.setdefault("source", "simulated")
        normalized.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
        normalized.setdefault("permission_required", True)
        normalized.setdefault("permission_granted", False)
        normalized.setdefault("data_collected", [])
        normalized.setdefault("risk_level", "LOW")
        normalized.setdefault("explanation", "No explanation provided.")
        return normalized

    def _detected_intent(self, event_type: str, requested_data: list[str]) -> str:
        requested = [item.lower() for item in requested_data]
        if any(item in event_type.lower() or item in requested for item in ["microphone", "camera", "messages", "contacts", "location", "photos"]):
            return "sensitive_phone_access"
        if event_type.lower() in self.LOW_RISK_EVENTS or not requested:
            return "phone_awareness_status"
        return "phone_event_processing"

    def _risk_from_event(self, event_type: str, requested_data: list[str]) -> str:
        event_name = event_type.lower()
        requested = {item.lower() for item in requested_data}
        if event_name in self.HIGH_RISK_EVENTS or requested.intersection(self.SENSITIVE_PHONE_DATA):
            return "HIGH"
        if event_name in self.LOW_RISK_EVENTS:
            return "LOW"
        if requested:
            return "MEDIUM"
        return "LOW"

    def _build_event_record(self, event: dict[str, Any], permission_granted: bool, risk_level: str, explanation: str, recommendation: str, human_decision: str) -> dict[str, Any]:
        data_collected = []
        if permission_granted:
            data_collected = [
                "event_type",
                "source",
                "timestamp",
            ]
        return {
            "event_type": event.get("event_type", "unknown_phone_event"),
            "source": event.get("source", "simulated"),
            "timestamp": event.get("timestamp", datetime.now(timezone.utc).isoformat()),
            "permission_required": bool(event.get("permission_required", True)),
            "permission_granted": permission_granted,
            "data_collected": data_collected,
            "risk_level": risk_level,
            "explanation": explanation,
            "recommendation": recommendation,
            "human_decision": human_decision,
        }

    def process_event(self, event: dict[str, Any] | str) -> dict[str, Any]:
        event_record = self._normalize_event(event)
        event_type = str(event_record.get("event_type", "unknown_phone_event"))
        requested_data = list(event_record.get("requested_data") or event_record.get("data_collected") or [])
        permission_required = bool(event_record.get("permission_required", True))
        permission_granted = bool(event_record.get("permission_granted", False)) or self.has_permission()

        if not self.has_permission():
            result = self._build_event_record(
                event_record,
                permission_granted=False,
                risk_level="LOW",
                explanation="PHONE AWARENESS DISABLED. PARMAR rejected the phone event before processing and did not access any phone data.",
                recommendation="Enable Phone Awareness Permission before processing any simulated phone event.",
                human_decision="REJECTED - PHONE AWARENESS DISABLED",
            )
            result.update({
                "detected_intent": "permission_denied",
                "safety_checks": ["permission_check"],
                "human_approval_status": "NOT REQUIRED UNTIL PERMISSION IS EXPLICITLY GRANTED",
                "decision": {
                    "requires_human_approval": False,
                    "status": "BLOCKED",
                },
                "status": "PHONE AWARENESS DISABLED",
            })
            self.logger.log_event("phone_event_rejected", {
                "event": event_type,
                "risk_level": "LOW",
                "human_decision": result["human_decision"],
                "reason": "Phone Awareness Permission was disabled.",
            })
            return result

        if permission_required and not permission_granted:
            result = self._build_event_record(
                event_record,
                permission_granted=False,
                risk_level="LOW",
                explanation="Phone awareness was not permitted. PARMAR did not collect or process phone data.",
                recommendation="Request explicit user permission before processing any phone-related awareness signal.",
                human_decision="DENIED - PERMISSION REQUIRED",
            )
            result.update({
                "detected_intent": "permission_denied",
                "safety_checks": ["permission_check"],
                "human_approval_status": "NOT REQUIRED UNTIL PERMISSION IS EXPLICITLY GRANTED",
                "decision": {
                    "requires_human_approval": False,
                    "status": "BLOCKED",
                },
            })
            self.logger.log_event("phone_event", {"event": event_type, "risk_level": "LOW", "human_decision": result["human_decision"]})
            return result

        if event_type.lower() in self.HIGH_RISK_EVENTS or any(item.lower() in self.SENSITIVE_PHONE_DATA for item in requested_data):
            risk_level = "HIGH"
            recommendation = "Stop the proposed action, explain the risk, and ask for explicit human confirmation before any further phone processing."
            human_decision = "PENDING HUMAN APPROVAL"
            explanation = "This event asks for sensitive phone data or private input that could affect privacy, autonomy, or trust. PARMAR cannot perform it silently."
        else:
            risk_level = "LOW"
            recommendation = "Proceed only with local, non-sensitive awareness, and keep the event explainable and transparent."
            human_decision = "NO HUMAN APPROVAL REQUIRED FOR LOW-RISK SIMULATED EVENT"
            explanation = "The event is low-risk and limited to local, non-sensitive awareness information."

        if risk_level in {"HIGH", "CRITICAL"}:
            privacy = PrivacyCheck().evaluate(f"{event_type} {' '.join(requested_data)}")
            autonomy = AutonomyCheck().evaluate(f"{event_type} {' '.join(requested_data)}")
            emergency = EmergencyGate().evaluate_phone_event({
                "event_type": event_type,
                "source": event_record.get("source", "simulated"),
                "permission_granted": permission_granted,
                "requested_data": requested_data,
                "risk_level": risk_level,
            })
        else:
            privacy = {"allow_execution": True, "status": "PASS", "risk_type": "privacy", "reasons": ["No sensitive data requested."]}
            autonomy = {"allow_execution": True, "status": "PASS", "risk_type": "autonomy", "reasons": ["Low-risk phone awareness event does not override user autonomy."]}
            emergency = {"allow_execution": True, "status": "SAFE_TO_CONTINUE", "reason": "Low-risk event remains within local awareness boundaries."}

        risk_summary = RiskEngine().evaluate(f"{event_type} {' '.join(requested_data)}")
        conflict = ConflictDetector().detect(
            proposed_action=f"Process phone event: {event_type}",
            human_interests=["privacy", "autonomy", "phone safety"],
            rules=[
                "No access to private messages, contacts, photos, microphone, camera, or location without explicit permission",
                "No silent override of human authority",
            ],
        )
        intent = IntentEngine().analyze_request(f"{event_type} {' '.join(requested_data)}")
        decision = DecisionEngine().build_decision(
            goal="Evaluate a privacy-safe phone awareness event",
            action=f"Process event: {event_type}",
            expected_benefit="Transparency and local awareness with human oversight",
            required_data=["event_type", "source", "timestamp"],
            required_permissions=["phone_awareness"],
            possible_consequences=["privacy exposure", "autonomy conflict"],
            risk_level=risk_level,
            safety_checks=["privacy_check", "autonomy_check", "emergency_gate"],
        )
        decision["detected_intent"] = self._detected_intent(event_type, requested_data)
        decision["detected_conflicts"] = conflict["reasons"]
        decision["recommendation"] = recommendation
        decision["human_approval_status"] = human_decision
        decision["approval_message"] = (
            "HUMAN APPROVAL REQUIRED. PARMAR must not silently act on sensitive phone data or high-risk events."
            if risk_level in {"HIGH", "CRITICAL"}
            else "Low-risk phone awareness event remains explainable and does not override user authority."
        )

        result = self._build_event_record(event_record, permission_granted, risk_level, explanation, recommendation, human_decision)
        result.update({
            "detected_intent": decision["detected_intent"],
            "requested_data": requested_data,
            "risk_summary": risk_summary,
            "conflict": conflict,
            "privacy_check": privacy,
            "autonomy_check": autonomy,
            "emergency_gate": emergency,
            "decision": decision,
            "intent": intent,
            "human_approval_status": decision["human_approval_status"],
            "status": "SAFE_TO_CONTINUE" if risk_level in {"LOW", "MEDIUM"} else "REVIEW_REQUIRED",
        })

        self.logger.log_event("phone_event", {
            "event": event_type,
            "detected_intent": decision["detected_intent"],
            "risk_level": risk_level,
            "safety_checks": ["privacy_check", "autonomy_check", "emergency_gate"],
            "recommendation": recommendation,
            "human_decision": human_decision,
        })
        return result

    def demo_phone_event(self) -> dict[str, Any]:
        demo = {
            "event_type": "battery_low",
            "source": "simulated",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "permission_required": False,
            "permission_granted": True,
            "data_collected": ["battery_level"],
            "explanation": "Simulated battery status only. This event does not access private phone data.",
        }
        self.grant_permission("phone_awareness")
        return self.process_event(demo)
