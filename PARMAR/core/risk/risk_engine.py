"""Risk assessment engine for PARMAR."""

from __future__ import annotations

import re

from PARMAR.core.language_support import contains_any_keyword, normalize_text


def _contains_privacy_term(text: str, keywords: list[str]) -> bool:
    """Match normalized privacy terms as complete Unicode words or phrases."""
    return any(
        re.search(rf"(?<!\w){re.escape(normalize_text(keyword))}(?!\w)", text)
        for keyword in keywords
        if normalize_text(keyword)
    )


class RiskEngine:
    """Analyze a proposal for risk exposure across multiple categories."""

    def evaluate(self, request_text: str) -> dict:
        text = normalize_text(request_text)
        categories = {
            "privacy": [
                "personal data", "private data", "medical", "salary", "payroll", "employee data",
                "customer contacts", "contacts", "messages", "photos", "location", "health records",
                "profile data", "records", "ssn", "credit card", "export", "leak", "vendor",
                "third-party", "contractor", "external sharing", "shared data", "private messages",
                "मेडिकल", "स्वास्थ्य", "कर्मचारी", "डेटा", "संपर्क", "फोटो", "स्थान", "संदेश", "तृतीय पक्ष"
            ],
            "safety": ["harm", "weapon", "injury", "danger", "unsafe", "exploit", "attack", "disable safety systems", "safety systems", "सुरक्षा", "खतरा"],
            "autonomy": ["override", "disable user", "remove choice", "decision-making rights", "bypass approval", "without consent", "without explicit approval", "force decisions", "स्वतंत्रता", "स्वीकृति", "अनुमति"],
            "financial": ["money", "budget", "purchase", "loan", "invest", "transfer funds", "amount of company money", "expense", "procurement", "vendor payment", "large payment", "धन", "पेमेंट", "वित्त"],
            "destructive": ["delete", "destroy", "wipe", "erase", "disable backups", "nuke", "shutdown", "delete the production database", "disable all safety systems", "डिलीट", "मिटाना", "हटाना"],
            "system": ["admin", "root", "reconfigure", "exfiltrate", "take control", "system override", "emergency root access", "vendor tool", "सिस्टम", "नियंत्रण"],
        }

        reasons = []
        risk_flags = {}

        for category, keywords in categories.items():
            match = (
                _contains_privacy_term(text, keywords)
                if category == "privacy"
                else contains_any_keyword(text, keywords)
            )
            risk_flags[category] = match
            if match:
                reasons.append(f"{category} risk detected: proposal includes indicators such as {', '.join(keywords[:3])}.")

        if not reasons:
            reasons.append("No obvious high-risk indicators were detected, but the request still requires human review because consequential actions are never approved automatically.")

        if risk_flags.get("destructive") or risk_flags.get("system"):
            risk_level = "critical"
        elif risk_flags.get("privacy") or risk_flags.get("safety") or risk_flags.get("autonomy"):
            risk_level = "high"
        elif risk_flags.get("financial"):
            risk_level = "medium"
        else:
            risk_level = "low"

        return {
            "risk_level": risk_level,
            "reasons": reasons,
            "category_flags": risk_flags,
            "summary": f"Risk assessment for request: {risk_level} severity.",
        }
