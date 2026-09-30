"""Privacy safety check."""

from __future__ import annotations

from PARMAR.core.language_support import contains_any_keyword, normalize_text


class PrivacyCheck:
    """Block proposals that expose private or sensitive data without explicit consent."""

    def evaluate(self, request_text: str) -> dict:
        text = normalize_text(request_text)
        privacy_keywords = [
            "medical records", "social security", "bank account", "personal data",
            "customer data", "private employee data", "sensitive information",
            "exfiltrate", "share with vendor", "third-party",
            "मेडिकल रिकॉर्ड", "स्वास्थ्य", "गोपनीय", "साझा", "तृतीय पक्ष", "डेटा", "कर्मचारी"
        ]
        serious = contains_any_keyword(text, privacy_keywords)
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
