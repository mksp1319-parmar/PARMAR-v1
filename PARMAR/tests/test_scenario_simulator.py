import io
import json
from types import SimpleNamespace

from PARMAR.simulation.scenarios import get_scenarios
from PARMAR.simulation.simulator import evaluate_scenario, run_all_scenarios
from PARMAR.interface import futuristic_app


def test_scenario_dataset_contains_required_number_of_entries():
    scenarios = get_scenarios()
    assert len(scenarios) >= 15
    assert {scenario["scenario_id"] for scenario in scenarios} == {f"SCN-{idx:02d}" for idx in range(1, 16)}


def test_scenario_simulator_executes_all_scenarios():
    summary = run_all_scenarios()
    assert summary["total_scenarios"] >= 15
    assert summary["passed"] + summary["failed"] == summary["total_scenarios"]
    assert len(summary["mismatches"]) == summary["failed"]


def test_specific_scenarios_match_expected_policy():
    safe_case = evaluate_scenario(get_scenarios()[0])
    unsafe_case = evaluate_scenario(get_scenarios()[4])
    disabled_phone_case = evaluate_scenario(get_scenarios()[10])

    assert safe_case["passed"] is True
    assert unsafe_case["passed"] is True
    assert disabled_phone_case["passed"] is True


def test_scenario_http_evaluation_uses_simulator_and_returns_expected_vs_actual(monkeypatch):
    calls = []
    simulator = evaluate_scenario

    def record_simulation(scenario):
        calls.append(scenario["scenario_id"])
        return simulator(scenario)

    monkeypatch.setattr(futuristic_app, "evaluate_scenario", record_simulation)
    body = json.dumps({"scenario_id": "SCN-01"}).encode("utf-8")
    response = {}
    request = SimpleNamespace(
        path="/api/scenarios/evaluate",
        headers={"Content-Length": str(len(body))},
        rfile=io.BytesIO(body),
        _send_json=lambda status, result: response.update(status=status, result=result),
        send_error=lambda status, message: response.update(status=status, result={"message": message}),
    )

    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert calls == ["SCN-01"]
    assert response["status"] == 200
    evaluation = response["result"]["evaluation"]
    assert evaluation["expected_parmar_behavior"] == "SAFE_TO_REVIEW"
    assert evaluation["actual_behavior"] == "SAFE_TO_REVIEW"
    assert evaluation["passed"] is True


def test_scenario_http_evaluation_preserves_phone_simulator_outcomes():
    for scenario_id, expected_behavior in (
        ("SCN-11", "PHONE_AWARENESS_REJECTED"),
        ("SCN-12", "SAFE_TO_REVIEW"),
    ):
        body = json.dumps({"scenario_id": scenario_id}).encode("utf-8")
        response = {}
        request = SimpleNamespace(
            path="/api/scenarios/evaluate",
            headers={"Content-Length": str(len(body))},
            rfile=io.BytesIO(body),
            _send_json=lambda status, result: response.update(status=status, result=result),
            send_error=lambda status, message: response.update(status=status, result={"message": message}),
        )

        futuristic_app.PARMARRequestHandler.do_POST(request)

        assert response["status"] == 200
        evaluation = response["result"]["evaluation"]
        assert evaluation["scenario_id"] == scenario_id
        assert evaluation["expected_parmar_behavior"] == expected_behavior
        assert evaluation["actual_behavior"] == expected_behavior
        assert evaluation["passed"] is True
