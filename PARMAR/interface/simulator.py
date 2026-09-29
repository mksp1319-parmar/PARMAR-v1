"""Scenario simulator UI support for PARMAR V1."""

from __future__ import annotations

from PARMAR.interface.dashboard import TerminalDashboard
from PARMAR.simulation.scenarios import get_scenarios


class ScenarioSimulator:
    """Run scenario definitions through the existing safety pipeline without acting on the real world."""

    def __init__(self):
        self.dashboard = TerminalDashboard()

    def run_scenario(self, scenario: dict) -> dict:
        self.dashboard.set_phone_awareness_enabled(bool(scenario.get("phone_awareness_enabled", True)))
        if scenario.get("scenario_type") == "phone_event":
            if not self.dashboard.phone_awareness_enabled:
                result = self.dashboard.reject_phone_event(scenario.get("phone_event_name", "battery_low"))
            else:
                result = self.dashboard.run_phone_demo()
            return {
                "scenario_id": scenario.get("scenario_id"),
                "title": scenario.get("description"),
                "status": result.get("status", "SAFE_TO_CONTINUE"),
                "result": result,
            }

        result = self.dashboard.run_pipeline(
            scenario["proposed_ai_action"],
            human_interests=["privacy", "autonomy", "safety"],
            rules=[
                "No external sharing of personal data without approval",
                "No destructive action without explicit human sign-off",
                "Human agency must remain intact",
            ],
        )

        human_decision = scenario.get("human_decision")
        if human_decision in {"approve", "reject"}:
            result = self.dashboard.handle_human_decision(result, human_decision, "Scenario simulator decision")

        return {
            "scenario_id": scenario.get("scenario_id"),
            "title": scenario.get("description"),
            "status": result.get("enforcement", {}).get("status", result.get("status_label", "SAFE")),
            "result": result,
        }

    def run_all(self) -> list[dict]:
        return [self.run_scenario(scenario) for scenario in get_scenarios()]
