"""Conflict detection for PARMAR."""

from __future__ import annotations

from PARMAR.core.language_support import contains_any_keyword, normalize_text


class ConflictDetector:
    """Detect conflicts between an AI proposal and human safety, privacy, and autonomy expectations."""

    def detect(self, proposed_action: str, human_interests: list[str] | None = None, rules: list[str] | None = None) -> dict:
        action_text = normalize_text(proposed_action)
        interests = [normalize_text(item) for item in (human_interests or [])]
        rule_set = [normalize_text(item) for item in (rules or [])]

        reasons = []
        matched_rules = []

        if contains_any_keyword(action_text, ["share", "send", "transfer", "external", "vendor", "third-party", "साझा", "भेजें", "तृतीय पक्ष", "ठेकेदार"]):
            if "privacy" in interests or any("privacy" in rule for rule in rule_set) or any("personal data" in rule for rule in rule_set):
                reasons.append("The proposed action conflicts with privacy expectations because it exposes personal or sensitive information.")
                matched_rules.extend([rule for rule in rule_set if "privacy" in rule or "personal data" in rule])

        if contains_any_keyword(action_text, ["disable", "override", "remove", "bypass", "decision", "consent", "अक्षम", "नियंत्रण", "अनुमति"]):
            if "autonomy" in interests or any("autonomy" in rule for rule in rule_set):
                reasons.append("The proposal undermines human autonomy by bypassing consent or preventing meaningful choice.")
                matched_rules.extend([rule for rule in rule_set if "autonomy" in rule])

        if contains_any_keyword(action_text, ["delete", "destroy", "erase", "disable backups", "nuke", "डिलीट", "मिटाना", "हटाना"]):
            if any("safety" in rule for rule in rule_set) or "safety" in interests:
                reasons.append("The action threatens operational safety or system integrity.")
                matched_rules.extend([rule for rule in rule_set if "safety" in rule])

        if not reasons:
            reasons.append("No explicit conflict was detected from the provided human interests and rules, but the proposal still requires human review.")

        return {
            "conflict_detected": bool(reasons) and any("conflicts" in reason.lower() or "undermines" in reason.lower() or "threatens" in reason.lower() for reason in reasons),
            "reasons": reasons,
            "matched_rules": matched_rules,
            "severity": "high" if len(reasons) > 1 else "medium",
        }
