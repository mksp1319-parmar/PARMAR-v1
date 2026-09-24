"""Privacy safety check."""

from __future__ import annotations


class PrivacyCheck:
    """Block proposals that expose private or sensitive data without explicit consent."""

    def evaluate(self, request_text: str) -> dict:
        text = (request_text or "").lower()
        privacy_keywords = [
            "medical records", "social security", "bank account", "personal data",
            "customer data", "private employee data", "sensitive information",
            "exfiltrate", "share with vendor", "third-party"
        ]
        serious = any(keyword in text for keyword in privacy_keywords)
        if serious:
            return {
                "allow_execution": False,
                "status": "BLOCKED",
                "risk_type": "privacy",
                "reasons": ["The proposed action would expose sensitive personal information without explicit consent or approved safeguards."],
            }
        return {
            "allow_execution": True,
            "status": "PASS",
            "risk_type": "privacy",
            "reasons": ["No clear privacy violation identified in the request."],
        }
