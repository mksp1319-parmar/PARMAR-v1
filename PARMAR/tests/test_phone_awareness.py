from PARMAR.audit.decision_logs import DecisionLogManager
from PARMAR.interface.dashboard import TerminalDashboard
from PARMAR.phone.phone_awareness import PhoneAwarenessModule
from PARMAR.safety.emergency_gate import EmergencyGate


def test_permission_denied():
    module = PhoneAwarenessModule()
    event = {
        "event_type": "notification",
        "source": "simulated",
        "timestamp": "2026-01-01T00:00:00Z",
        "permission_required": True,
        "permission_granted": False,
    }
    result = module.process_event(event)
    assert result["permission_required"] is True
    assert result["permission_granted"] is False
    assert result["data_collected"] == []


def test_permission_granted():
    module = PhoneAwarenessModule()
    module.grant_permission("phone_awareness")
    event = {
        "event_type": "battery_low",
        "source": "simulated",
        "timestamp": "2026-01-01T00:00:00Z",
        "permission_required": True,
        "permission_granted": True,
    }
    result = module.process_event(event)
    assert result["permission_granted"] is True
    assert result["risk_level"] == "LOW"


def test_sensitive_data_request_is_blocked():
    module = PhoneAwarenessModule()
    module.grant_permission("phone_awareness")
    event = {
        "event_type": "read_private_messages",
        "source": "simulated",
        "timestamp": "2026-01-01T00:00:00Z",
        "permission_required": True,
        "permission_granted": True,
        "requested_data": ["messages", "photos", "contacts"],
    }
    result = module.process_event(event)
    assert result["risk_level"] in {"HIGH", "CRITICAL"}
    assert result["human_decision"] == "PENDING HUMAN APPROVAL"


def test_low_risk_event():
    module = PhoneAwarenessModule()
    module.grant_permission("phone_awareness")
    event = {
        "event_type": "battery_low",
        "source": "simulated",
        "timestamp": "2026-01-01T00:00:00Z",
        "permission_required": False,
        "permission_granted": True,
    }
    result = module.process_event(event)
    assert result["risk_level"] == "LOW"
    assert result["recommendation"]


def test_high_risk_event_requires_human_approval():
    module = PhoneAwarenessModule()
    module.grant_permission("phone_awareness")
    event = {
        "event_type": "record_microphone",
        "source": "simulated",
        "timestamp": "2026-01-01T00:00:00Z",
        "permission_required": True,
        "permission_granted": True,
        "requested_data": ["microphone"],
    }
    result = module.process_event(event)
    assert result["human_decision"] == "PENDING HUMAN APPROVAL"
    assert result["risk_level"] in {"HIGH", "CRITICAL"}


def test_emergency_gate():
    gate = EmergencyGate()
    decision = gate.evaluate_phone_event({
        "event_type": "record_camera",
        "source": "simulated",
        "permission_granted": True,
        "risk_level": "CRITICAL",
    })
    assert decision["allow_execution"] is False
    assert decision["status"] == "EMERGENCY_STOP"


def test_audit_logging():
    logger = DecisionLogManager(log_path="/tmp/parmar_phone_audit_test.jsonl")
    record = logger.log_event("phone_event", {"event": "battery_low", "risk_level": "LOW", "human_decision": "AUTO-ALLOW"})
    assert record["event_type"] == "phone_event"
    assert "risk_level" in record


def test_permission_toggle_blocks_phone_event_when_disabled():
    dashboard = TerminalDashboard()
    dashboard.set_phone_awareness_enabled(False)
    result = dashboard.reject_phone_event("battery_low")
    assert result["status"] == "PHONE AWARENESS DISABLED"
    assert result["permission_granted"] is False


def test_permission_toggle_allows_phone_event_when_enabled():
    dashboard = TerminalDashboard()
    dashboard.set_phone_awareness_enabled(True)
    result = dashboard.run_phone_demo()
    assert result["status"] == "SAFE_TO_CONTINUE" or result["risk_level"] == "LOW"


def test_dashboard_records_permission_toggle_in_audit_log(tmp_path):
    dashboard = TerminalDashboard()
    dashboard.logger = DecisionLogManager(log_path=str(tmp_path / "permission_toggle.jsonl"))
    dashboard.set_phone_awareness_enabled(False)
    dashboard.set_phone_awareness_enabled(True)
    entries = dashboard.logger.log_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(entries) >= 2
