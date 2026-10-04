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
        status_map = {
            "IDLE": "calm breathing / neutral monitoring",
            "LISTENING": "ready to receive a request",
            "THINKING": "considering the submitted request",
            "ANALYZING": "reviewing request context",
            "RISK_CHECK": "evaluating the authoritative safety outcome",
            "WAITING_FOR_HUMAN": "paused / awaiting human authority",
            "ENFORCEMENT_ALLOWED": "PARMAR granted permission; no action is asserted as executed",
            "PROVIDER": "provider response is being requested",
            "RESPONSE_SAFETY": "PARMAR is validating the provider response",
            "RELEASED": "provider response passed response-safety validation and was released",
            "WITHHELD": "provider response was withheld",
            "PROVIDER_FAILED": "provider response is unavailable",
            "BLOCKED": "locked / enforcement denied the proposal",
        }
        reported_state = str(system_state).upper() if isinstance(system_state, str) and system_state else "UNKNOWN"
        state = reported_state if reported_state in status_map else "UNKNOWN"
        return {
            "state": state,
            "voice": self.config.voice,
            "language": self.config.language,
            "personality": self.config.personality,
            "pronunciation": self.config.pronunciation,
            "avatar_mode": self.config.avatar_mode,
            "message": status_map.get(
                state,
                "PARMAR lifecycle state is unavailable; no authoritative state is asserted.",
            ),
        }
