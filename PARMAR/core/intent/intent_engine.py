"""Intent analysis for PARMAR."""

from __future__ import annotations

from PARMAR.core.language_support import contains_any_keyword, normalize_text


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

        normalized = normalize_text(text)

        if contains_any_keyword(normalized, [
            "send", "share", "transfer", "vendor", "third-party", "customer data",
            "personal data", "medical records", "export data", "sensitive information",
            "साझा", "भेजना", "मेडिकल रिकॉर्ड", "तृतीय पक्ष", "जानकारी"
        ]):
            intent = "data_sharing"
        elif contains_any_keyword(normalized, [
            "delete", "destroy", "wipe", "erase", "disable backups", "remove database",
            "kill process", "delete system", "डिलीट", "मिटाना", "हटाना"
        ]):
            intent = "destructive_action"
        elif contains_any_keyword(normalized, [
            "buy", "purchase", "loan", "transfer money", "invest", "financial", "expense",
            "budget", "pay out", "धन", "पेमेंट"
        ]):
            intent = "financial_action"
        elif contains_any_keyword(normalized, [
            "disable", "override", "bypass", "remove consent", "take control", "decision-making rights",
            "अक्षम", "नियंत्रण", "स्वीकृति" 
        ]):
            intent = "autonomy_violation"
        elif contains_any_keyword(normalized, [
            "leak", "exfiltrate", "collect", "spy", "infiltrate", "unapproved access",
            "लीक", "गोपनीय", "अनुमति" 
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
