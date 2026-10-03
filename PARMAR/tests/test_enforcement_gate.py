import pytest

from PARMAR.safety.enforcement_gate import CentralEnforcementGate


def make_decision(risk_level="high", requires_human_approval=True, approval_state="PENDING HUMAN APPROVAL"):
    return {
        "risk": {"risk_level": risk_level},
        "decision": {
            "requires_human_approval": requires_human_approval,
            "human_approval_status": approval_state,
        },
        "privacy": {"allow_execution": True},
        "autonomy": {"allow_execution": True},
        "emergency_gate": {"allow_execution": True},
    }


def test_high_risk_without_approval_is_blocked():
    gate = CentralEnforcementGate()
    decision = make_decision(risk_level="high", requires_human_approval=True, approval_state="PENDING HUMAN APPROVAL")
    result = gate.evaluate_decision(decision, privacy_result=decision["privacy"], autonomy_result=decision["autonomy"], emergency_result=decision["emergency_gate"], human_approval="PENDING HUMAN APPROVAL")
    assert result["execution_allowed"] is False
    assert result["status"] == "HUMAN_APPROVAL_REQUIRED"


def test_high_risk_rejection_is_not_ready():
    gate = CentralEnforcementGate()
    decision = make_decision(risk_level="high", requires_human_approval=True, approval_state="REJECTED")
    result = gate.evaluate_decision(decision, privacy_result=decision["privacy"], autonomy_result=decision["autonomy"], emergency_result=decision["emergency_gate"], human_approval="REJECTED")
    assert result["execution_allowed"] is False
    assert result["status"] == "REJECTED"


def test_high_risk_with_approval_is_ready_for_action():
    gate = CentralEnforcementGate()
    decision = make_decision(risk_level="high", requires_human_approval=True, approval_state="APPROVED")
    result = gate.evaluate_decision(decision, privacy_result=decision["privacy"], autonomy_result=decision["autonomy"], emergency_result=decision["emergency_gate"], human_approval="APPROVED")
    assert result["execution_allowed"] is True
    assert result["status"] == "READY_FOR_ACTION"


def test_emergency_blocked_action_with_approval_is_blocked():
    gate = CentralEnforcementGate()
    decision = make_decision(risk_level="critical", requires_human_approval=True, approval_state="APPROVED")
    result = gate.evaluate_decision(decision, privacy_result=decision["privacy"], autonomy_result=decision["autonomy"], emergency_result={"allow_execution": False}, human_approval="APPROVED")
    assert result["execution_allowed"] is False
    assert result["status"] == "BLOCKED"


def test_privacy_blocked_action_with_approval_is_blocked():
    gate = CentralEnforcementGate()
    decision = make_decision(risk_level="high", requires_human_approval=True, approval_state="APPROVED")
    result = gate.evaluate_decision(decision, privacy_result={"allow_execution": False}, autonomy_result=decision["autonomy"], emergency_result=decision["emergency_gate"], human_approval="APPROVED")
    assert result["execution_allowed"] is False
    assert result["status"] == "BLOCKED"


def test_low_risk_action_can_be_ready_without_approval():
    gate = CentralEnforcementGate()
    decision = make_decision(risk_level="low", requires_human_approval=False, approval_state="NO HUMAN APPROVAL REQUIRED")
    result = gate.evaluate_decision(decision, privacy_result=decision["privacy"], autonomy_result=decision["autonomy"], emergency_result=decision["emergency_gate"], human_approval="NO HUMAN APPROVAL REQUIRED")
    assert result["execution_allowed"] is True
    assert result["status"] == "READY_FOR_ACTION"


def test_invalid_approval_state_is_blocked():
    gate = CentralEnforcementGate()
    decision = make_decision(risk_level="high", requires_human_approval=True, approval_state="UNKNOWN")
    result = gate.evaluate_decision(decision, privacy_result=decision["privacy"], autonomy_result=decision["autonomy"], emergency_result=decision["emergency_gate"], human_approval="UNKNOWN")
    assert result["execution_allowed"] is False
    assert result["status"] == "HUMAN_APPROVAL_REQUIRED"


def test_direct_caller_can_not_skip_ui_protection():
    gate = CentralEnforcementGate()
    decision = make_decision(risk_level="high", requires_human_approval=True, approval_state="PENDING HUMAN APPROVAL")
    result = gate.evaluate_decision(decision, privacy_result=decision["privacy"], autonomy_result=decision["autonomy"], emergency_result=decision["emergency_gate"], human_approval=None)
    assert result["execution_allowed"] is False
    assert result["status"] == "HUMAN_APPROVAL_REQUIRED"


@pytest.mark.parametrize(
    "decision",
    [
        {"decision": {"requires_human_approval": False}},
        {"risk": {"risk_level": "low"}},
        {"risk": {"risk_level": "low"}, "decision": {}, "requires_human_approval": False},
        {
            "risk": {"risk_level": "low"},
            "decision": {"requires_human_approval": False},
            "requires_human_approval": True,
        },
        {"risk": "low", "decision": {"requires_human_approval": False}},
        {"risk": {"risk_level": "unknown"}, "decision": {"requires_human_approval": False}},
    ],
)
def test_missing_or_malformed_decision_data_cannot_be_execution_approved(decision):
    result = CentralEnforcementGate().evaluate_decision(
        decision,
        privacy_result={"allow_execution": True},
        autonomy_result={"allow_execution": True},
        emergency_result={"allow_execution": True},
    )

    assert result["execution_allowed"] is False
    assert result["status"] in {"BLOCKED", "HUMAN_APPROVAL_REQUIRED"}
