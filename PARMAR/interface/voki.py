"""VOKI visual/state architecture for the PARMAR human-controlled safety interface."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class VOKIConfig:
    voice: str = "local-demo"
    language: str = "en"
    personality: str = "measured"
    pronunciation: str = "neutral"
    avatar_mode: str = "core"
    enabled: bool = True


class PARMARVoki:
    """Separate VOKI presentation from safety authorization."""

    def __init__(self, config: VOKIConfig | None = None):
        self.config = config or VOKIConfig()

    def state_for(self, system_state: str) -> dict:
        state = str(system_state or "IDLE").upper()
        status_map = {
            "IDLE": "calm breathing / neutral monitoring",
            "LISTENING": "ready to receive a request",
            "THINKING": "considering the submitted request",
            "ANALYZING": "reviewing request context",
            "RISK_CHECK": "evaluating the authoritative safety outcome",
            "WAITING_FOR_HUMAN": "paused / awaiting human authority",
            "SAFE_RESPONSE": "completed response after enforcement approval",
            "BLOCKED": "locked / enforcement denied the proposal",
            "RISK_DETECTED": "warning pulse / escalation watch",
            "APPROVAL_REQUIRED": "paused core / awaiting human authority",
            "APPROVED": "confirmation pulse / authorized proceed",
            "SAFE": "stable operational reassurance",
        }
        return {
            "state": state,
            "voice": self.config.voice,
            "language": self.config.language,
            "personality": self.config.personality,
            "pronunciation": self.config.pronunciation,
            "avatar_mode": self.config.avatar_mode,
            "message": status_map.get(state, "stable monitoring"),
        }
