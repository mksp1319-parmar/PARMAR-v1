"""Risk assessment engine for PARMAR."""

from __future__ import annotations


class RiskEngine:
    """Analyze a proposal for risk exposure across multiple categories."""

    def evaluate(self, request_text: str) -> dict:
        text = (request_text or "").lower().strip()
        categories = {
            "privacy": [
                "personal data", "private data", "medical", "salary", "payroll", "employee data",
                "customer contacts", "contacts", "messages", "photos", "location", "health records",
                "profile data", "records", "ssn", "credit card", "export", "leak", "vendor",
                "third-party", "contractor", "external sharing", "shared data", "private messages"
            ],
            "safety": ["harm", "weapon", "injury", "danger", "unsafe", "exploit", "attack", "disable safety systems", "safety systems"],
            "autonomy": ["override", "disable user", "remove choice", "decision-making rights", "bypass approval", "without consent", "without explicit approval", "force decisions"],
            "financial": ["money", "budget", "purchase", "loan", "invest", "transfer funds", "amount of company money", "expense", "procurement", "vendor payment", "large payment"],
            "destructive": ["delete", "destroy", "wipe", "erase", "disable backups", "nuke", "shutdown", "delete the production database", "disable all safety systems"],
            "system": ["admin", "root", "reconfigure", "exfiltrate", "take control", "system override", "emergency root access", "vendor tool"],
        }

        reasons = []
        risk_flags = {}

        for category, keywords in categories.items():
            match = any(keyword in text for keyword in keywords)
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
