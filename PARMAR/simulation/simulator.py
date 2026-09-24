"""Synthetic safety simulation runner for PARMAR V1."""

from __future__ import annotations

from typing import Any

from PARMAR.interface.dashboard import TerminalDashboard
from PARMAR.simulation.scenarios import get_scenarios


class ScenarioMismatchError(ValueError):
    """Raised when a scenario result differs from the expected safety policy."""


def _normalized_behavior(result: dict, scenario: dict) -> str:
    if scenario.get("scenario_type") == "phone_event":
        status = str(result.get("status", "")).upper()
        if status == "PHONE AWARENESS DISABLED":
            return "PHONE_AWARENESS_REJECTED"
        if status == "SAFE_TO_CONTINUE":
            return "SAFE_TO_REVIEW"
        if status == "EMERGENCY_STOP":
            return "BLOCKED"
        return status or "SAFE_TO_REVIEW"

    decision = result.get("decision", {})
    if result.get("emergency_gate", {}).get("allow_execution") is False:
        return "BLOCKED"
    if decision.get("requires_human_approval") is True:
        return "HUMAN_REVIEW_REQUIRED"
    return "SAFE_TO_REVIEW"


def _normalized_human_decision(result: dict) -> str:
    return str(result.get("human_decision", "UNKNOWN")).upper()


def _evaluate_expected_behavior(scenario: dict, actual_result: dict) -> bool:
    expected_behavior = scenario["expected_parmar_behavior"]
    actual_behavior = _normalized_behavior(actual_result, scenario)
    actual_risk = str(actual_result.get("risk", {}).get("risk_level", actual_result.get("risk_level", "low"))).lower()
    actual_human_approval = bool(actual_result.get("decision", {}).get("requires_human_approval") or actual_result.get("requires_human_approval", False))
    actual_human_decision = _normalized_human_decision(actual_result)

    if expected_behavior == "SAFE_TO_REVIEW":
        return actual_behavior == "SAFE_TO_REVIEW" and actual_risk == scenario["expected_risk_level"] and not actual_human_approval

    if expected_behavior == "HUMAN_REVIEW_REQUIRED":
        return actual_behavior == "HUMAN_REVIEW_REQUIRED" and actual_human_approval is True

    if expected_behavior == "BLOCKED":
        return actual_behavior in {"BLOCKED", "EMERGENCY_STOP"} and actual_risk == scenario["expected_risk_level"]

    if expected_behavior == "PHONE_AWARENESS_REJECTED":
        return actual_behavior == "PHONE_AWARENESS_REJECTED" and actual_result.get("permission_granted") is False

    if expected_behavior == "APPROVED":
        return actual_human_decision == "APPROVED"

    if expected_behavior == "REJECTED":
        return actual_human_decision == "REJECTED"

    return actual_behavior == expected_behavior


def evaluate_scenario(scenario: dict) -> dict:
    """Run a single synthetic scenario against the actual PARMAR pipeline and compare it to the expected safety policy."""
    dashboard = TerminalDashboard()
    dashboard.set_phone_awareness_enabled(bool(scenario.get("phone_awareness_enabled", True)))

    if scenario.get("scenario_type") == "phone_event":
        if not dashboard.phone_awareness_enabled:
            actual_result = dashboard.reject_phone_event(scenario.get("phone_event_name", "battery_low"))
        else:
            actual_result = dashboard.run_phone_demo()
    else:
        actual_result = dashboard.run_pipeline(
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
            actual_result = dashboard.handle_human_decision(actual_result, human_decision, "Scenario simulator human decision")

    expected_behavior = scenario["expected_parmar_behavior"]
    passed = _evaluate_expected_behavior(scenario, actual_result)
    mismatch = "" if passed else (
        f"Expected {expected_behavior} for {scenario['scenario_id']} but actual behavior was "
        f"{_normalized_behavior(actual_result, scenario)} with risk {str(actual_result.get('risk', {}).get('risk_level', actual_result.get('risk_level', 'unknown'))).lower()}"
    )

    return {
        "scenario_id": scenario["scenario_id"],
        "description": scenario["description"],
        "expected_risk_level": scenario["expected_risk_level"],
        "expected_parmar_behavior": expected_behavior,
        "expected_human_approval_requirement": scenario["expected_human_approval_requirement"],
        "actual_risk_level": str(actual_result.get("risk", {}).get("risk_level", actual_result.get("risk_level", "unknown"))).lower(),
        "actual_behavior": _normalized_behavior(actual_result, scenario),
        "actual_human_approval_required": bool(actual_result.get("decision", {}).get("requires_human_approval") or actual_result.get("requires_human_approval", False)),
        "actual_human_decision": _normalized_human_decision(actual_result),
        "passed": passed,
        "mismatch": mismatch,
        "actual_result": actual_result,
    }


def run_all_scenarios() -> dict:
    """Run the full synthetic safety scenario suite and return a summary."""
    results = [evaluate_scenario(scenario) for scenario in get_scenarios()]
    passed = sum(1 for item in results if item["passed"])
    failed = len(results) - passed
    mismatches = [item for item in results if not item["passed"]]

    summary = {
        "total_scenarios": len(results),
        "passed": passed,
        "failed": failed,
        "mismatches": mismatches,
        "results": results,
    }
    return summary


def print_summary(summary: dict) -> None:
    print("\n=== PARMAR SCENARIO SIMULATOR SUMMARY ===")
    print(f"Total scenarios: {summary['total_scenarios']}")
    print(f"Passed: {summary['passed']}")
    print(f"Failed: {summary['failed']}")
    print(f"Mismatches: {len(summary['mismatches'])}")

    if summary["mismatches"]:
        print("\nMismatch details:")
        for mismatch in summary["mismatches"]:
            print(f"- {mismatch['scenario_id']}: {mismatch['mismatch']}")
    else:
        print("\nNo mismatches detected: all scenarios matched the expected PARMAR safety policy.")


def main() -> None:
    summary = run_all_scenarios()
    for item in summary["results"]:
        status = "PASS" if item["passed"] else "FAIL"
        print(f"[{status}] {item['scenario_id']} - {item['description']}")
        if item["passed"]:
            print(f"  Expected: {item['expected_parmar_behavior']} | Actual: {item['actual_behavior']}")
        else:
            print(f"  Expected: {item['expected_parmar_behavior']} | Actual: {item['actual_behavior']}")
            print(f"  Detail: {item['mismatch']}")
    print_summary(summary)


if __name__ == "__main__":
    main()
