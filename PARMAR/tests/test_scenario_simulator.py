from PARMAR.simulation.scenarios import get_scenarios
from PARMAR.simulation.simulator import evaluate_scenario, run_all_scenarios


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
