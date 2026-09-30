from PARMAR.core.conflict.conflict_detector import ConflictDetector
from PARMAR.core.decision.decision_engine import DecisionEngine
from PARMAR.core.intent.intent_engine import IntentEngine
from PARMAR.core.mediation.mediation_engine import MediationEngine
from PARMAR.core.risk.risk_engine import RiskEngine
from PARMAR.interface.dashboard import TerminalDashboard
from PARMAR.safety.autonomy_check import AutonomyCheck
from PARMAR.safety.emergency_gate import EmergencyGate
from PARMAR.safety.privacy_check import PrivacyCheck


def test_intent_engine_extracts_basic_intent():
    result = IntentEngine().analyze_request("I want to send customer data to a third-party vendor")
    assert result["intent"] == "data_sharing"
    assert result["requested_action"]


def test_risk_engine_assesses_risk_and_reasons():
    result = RiskEngine().evaluate("Delete the production database and exfiltrate customer records")
    assert result["risk_level"] in {"medium", "high", "critical"}
    assert result["reasons"]


def test_conflict_detector_flags_human_rule_conflict():
    detector = ConflictDetector()
    result = detector.detect(
        proposed_action="Send private employee data to an external contractor",
        human_interests=["privacy", "employee autonomy"],
        rules=["No external sharing of personal data"],
    )
    assert result["conflict_detected"] is True
    assert result["reasons"]


def test_mediation_engine_generates_safer_alternatives():
    result = MediationEngine().generate_alternatives(
        conflict_reasons=["This action exposes private data without consent"],
        risk_level="high",
        intent="data_sharing",
    )
    assert result["alternatives"]
    assert any("consent" in alt["message"].lower() for alt in result["alternatives"])


def test_emergency_gate_blocks_high_risk():
    gate = EmergencyGate()
    decision = gate.evaluate("Delete a production database and disable backups", risk_level="critical")
    assert decision["allow_execution"] is False
    assert "escalate" in decision["status"].lower()


def test_decision_engine_requires_human_approval():
    decision = DecisionEngine().build_decision(
        goal="Reduce fraud risk",
        action="Share limited contact details with a vetted compliance tool",
        expected_benefit="Faster fraud detection",
        required_data=["customer_id", "risk_score"],
        required_permissions=["Compliance approval"],
        possible_consequences=["Minor privacy exposure"],
        risk_level="medium",
        safety_checks=["privacy_check", "autonomy_check"],
    )
    assert decision["human_approval_status"] == "PENDING HUMAN APPROVAL"
    assert "HUMAN APPROVAL REQUIRED" in decision["approval_message"]


def test_safety_checks_flag_issues():
    privacy = PrivacyCheck().evaluate("Send personal medical records to an unapproved vendor")
    autonomy = AutonomyCheck().evaluate("Automatically disable a user's decision-making rights")
    assert privacy["allow_execution"] is False
    assert autonomy["allow_execution"] is False


def test_dashboard_approval_flow_approve(tmp_path):
    dashboard = TerminalDashboard()
    dashboard.logger = __import__("PARMAR.audit.decision_logs", fromlist=["DecisionLogManager"]).DecisionLogManager(log_path=str(tmp_path / "approval.jsonl"))
    result = dashboard.run_pipeline("Share private employee data with a third-party contractor")
    outcome = dashboard.handle_human_decision(result, "approve", "human approved")
    assert outcome["human_decision"] == "APPROVED"
    assert "APPROVED" in outcome["decision"]["approval_message"]


def test_dashboard_approval_flow_reject(tmp_path):
    dashboard = TerminalDashboard()
    dashboard.logger = __import__("PARMAR.audit.decision_logs", fromlist=["DecisionLogManager"]).DecisionLogManager(log_path=str(tmp_path / "reject.jsonl"))
    result = dashboard.run_pipeline("Delete production database and disable backups")
    outcome = dashboard.handle_human_decision(result, "reject", "human rejected")
    assert outcome["human_decision"] == "REJECTED"
    assert "REJECTED" in outcome["decision"]["approval_message"]


def test_fail_closed_when_safety_input_missing():
    from PARMAR.safety.enforcement_gate import CentralEnforcementGate

    result = CentralEnforcementGate().evaluate_decision(
        {"risk": {"risk_level": "high"}, "decision": {"requires_human_approval": True}, "requires_human_approval": True},
        privacy_result=None,
        autonomy_result=None,
        emergency_result=None,
        human_approval=None,
    )
    assert result["execution_allowed"] is False
    assert result["status"] in {"BLOCKED", "HUMAN_APPROVAL_REQUIRED"}


def test_fail_closed_when_safety_result_malformed():
    from PARMAR.safety.enforcement_gate import CentralEnforcementGate

    malformed = {"allow_execution": "yes"}
    result = CentralEnforcementGate().evaluate_decision(
        {"risk": {"risk_level": "critical"}, "decision": {"requires_human_approval": True}, "requires_human_approval": True},
        privacy_result=malformed,
        autonomy_result={"allow_execution": True},
        emergency_result={"allow_execution": True},
        human_approval="APPROVED",
    )
    assert result["execution_allowed"] is False
    assert result["status"] in {"BLOCKED", "HUMAN_APPROVAL_REQUIRED"}


def test_language_choice_does_not_change_safety_decision():
    from PARMAR.interface.ui_adapter import PARMARUIAdapter

    english = PARMARUIAdapter.analyze_request("Share employee medical records with a third-party contractor")
    hindi = PARMARUIAdapter.analyze_request("कर्मचारी की मेडिकल रिकॉर्ड तीसरे पक्ष के ठेकेदार को साझा करें")
    assert english["status"] == hindi["status"]
    assert english["human_approval_required"] is True
    assert hindi["human_approval_required"] is True
