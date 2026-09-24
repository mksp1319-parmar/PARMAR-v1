"""Intent analysis for PARMAR."""

from __future__ import annotations


class IntentEngine:
    """Classify the basic intent of a human or AI request."""

    def analyze_request(self, request_text: str) -> dict:
        text = (request_text or "").strip()
        if not text:
            return {
                "intent": "unknown",
                "requested_action": "",
                "confidence": 0.0,
                "summary": "No request provided.",
            }

        normalized = text.lower()

        if any(keyword in normalized for keyword in [
            "send", "share", "transfer", "vendor", "third-party", "customer data",
            "personal data", "medical records", "export data", "sensitive information"
        ]):
            intent = "data_sharing"
        elif any(keyword in normalized for keyword in [
            "delete", "destroy", "wipe", "erase", "disable backups", "remove database",
            "kill process", "delete system"
        ]):
            intent = "destructive_action"
        elif any(keyword in normalized for keyword in [
            "buy", "purchase", "loan", "transfer money", "invest", "financial", "expense",
            "budget", "pay out"
        ]):
            intent = "financial_action"
        elif any(keyword in normalized for keyword in [
            "disable", "override", "bypass", "remove consent", "take control", "decision-making rights"
        ]):
            intent = "autonomy_violation"
        elif any(keyword in normalized for keyword in [
            "leak", "exfiltrate", "collect", "spy", "infiltrate", "unapproved access"
        ]):
            intent = "privacy_violation"
        else:
            intent = "general_request"

        return {
            "intent": intent,
            "requested_action": text,
            "confidence": 0.82 if intent != "general_request" else 0.55,
            "summary": f"Intent categorized as '{intent}' for request: {text[:120]}",
        }
