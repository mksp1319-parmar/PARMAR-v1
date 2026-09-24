"""Emergency gate that blocks or escalates unsafe proposals."""

from __future__ import annotations


class EmergencyGate:
    """A mandatory safety gate that prevents dangerous actions from being executed automatically."""

    def evaluate(self, request_text: str, risk_level: str) -> dict:
        text = (request_text or "").lower()
        critical_indicators = [
            "delete a production database", "destroy backups", "wipe all systems",
            "disable safety systems", "take control of critical infrastructure"
        ]
        is_high_risk = risk_level in {"high", "critical"} or any(keyword in text for keyword in critical_indicators)

        if is_high_risk:
            return {
                "allow_execution": False,
                "status": "ESCALATE_TO_HUMAN_SUPERVISION",
                "risk_level": risk_level,
                "reason": "This proposal is high risk or potentially destructive. The system cannot execute it automatically.",
            }

        return {
            "allow_execution": True,
            "status": "SAFE_TO_REVIEW",
            "risk_level": risk_level,
            "reason": "The request is not automatically disallowed, but human approval remains required before any consequential action.",
        }

    def evaluate_phone_event(self, event: dict) -> dict:
        """Stop high-risk phone awareness workflows before any real-world action occurs."""
        event_type = str(event.get("event_type", "unknown_phone_event")).lower()
        risk_level = str(event.get("risk_level", "LOW")).upper()
        permission_granted = bool(event.get("permission_granted", False))
        sensitive_data = event.get("requested_data") or []
        sensitive_keywords = {"microphone", "camera", "messages", "contacts", "location", "photos", "call_log", "passwords"}

        if risk_level in {"HIGH", "CRITICAL"} or event_type in {
            "record_microphone", "record_camera", "read_private_messages", "read_contacts",
            "track_location", "access_photos"
        } or any(item.lower() in sensitive_keywords for item in sensitive_data):
            if not permission_granted:
                return {
                    "allow_execution": False,
                    "status": "EMERGENCY_STOP",
                    "risk_level": risk_level,
                    "reason": "Sensitive phone activity was requested without explicit permission. PARMAR blocks it.",
                }
            return {
                "allow_execution": False,
                "status": "EMERGENCY_STOP",
                "risk_level": risk_level,
                "reason": "High-risk phone activity requires human confirmation before any action continues.",
            }

        return {
            "allow_execution": True,
            "status": "SAFE_TO_CONTINUE",
            "risk_level": risk_level,
            "reason": "This phone event is low-risk and limited to local, non-sensitive awareness.",
        }
