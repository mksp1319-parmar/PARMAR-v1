import io
import json
from types import SimpleNamespace
from uuid import uuid4

from PARMAR.audit.decision_logs import DecisionLogManager
from PARMAR.interface.dashboard import TerminalDashboard
from PARMAR.interface import futuristic_app
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


def test_http_permission_grant_and_revoke_persist_across_status_and_simulation(monkeypatch, tmp_path):
    module = PhoneAwarenessModule()
    module.logger = DecisionLogManager(log_path=str(tmp_path / "phone-http.jsonl"))
    monkeypatch.setattr(futuristic_app, "PHONE_AWARENESS", module)

    def post(payload):
        body = json.dumps(payload).encode("utf-8")
        response = {}
        request = SimpleNamespace(
            path="/api/phone",
            headers={"Content-Length": str(len(body))},
            rfile=io.BytesIO(body),
            _send_json=lambda status, result: response.update(status=status, result=result),
            send_error=lambda status, message: response.update(status=status, result={"message": message}),
        )
        futuristic_app.PARMARRequestHandler.do_POST(request)
        return response

    def get_status():
        response = {}
        request = SimpleNamespace(
            path="/api/phone",
            _send_json=lambda status, result: response.update(status=status, result=result),
            send_error=lambda status, message: response.update(status=status, result={"message": message}),
        )
        futuristic_app.PARMARRequestHandler.do_GET(request)
        return response["result"]

    granted = post({"action": "toggle_permission", "enabled": True})
    assert granted["result"]["enabled"] is True
    assert get_status()["enabled"] is True

    simulation = post({
        "action": "simulate_event",
        "event": {"event_type": "battery_low", "permission_required": True},
    })
    assert simulation["result"]["result"]["permission_granted"] is True
    assert simulation["result"]["result"]["status"] == "SAFE_TO_CONTINUE"

    revoked = post({"action": "toggle_permission", "enabled": False})
    assert revoked["result"]["enabled"] is False
    assert get_status()["enabled"] is False

    denied = post({
        "action": "simulate_event",
        "event": {"event_type": "battery_low", "permission_required": True, "permission_granted": True},
    })
    assert denied["result"]["result"]["permission_granted"] is False
    assert denied["result"]["result"]["status"] == "PHONE AWARENESS DISABLED"


def test_phone_http_simulator_is_demo_only_and_rejects_authenticated_access(monkeypatch):
    from PARMAR.identity import LocalDemoPrincipalResolver
    from PARMAR.phone import phone_awareness
    from PARMAR.sessions import (
        InMemorySessionRepository,
        SESSION_COOKIE_NAME,
        SessionManager,
        SessionPolicy,
    )

    module = PhoneAwarenessModule()
    monkeypatch.setattr(futuristic_app, "PHONE_AWARENESS", module)
    manager = SessionManager(
        InMemorySessionRepository(),
        SessionPolicy(idle_timeout_seconds=300, absolute_timeout_seconds=900),
    )
    credentials = manager.create_authenticated_session(uuid4(), "phone-demo-test")
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", manager)
    monkeypatch.setattr(futuristic_app, "PRINCIPAL_RESOLVER", LocalDemoPrincipalResolver())

    def request(method, payload=None):
        body = json.dumps(payload or {}).encode("utf-8")
        errors = []
        response = {}
        headers = {
            "Content-Length": str(len(body)),
            "Cookie": f"{SESSION_COOKIE_NAME}={credentials.session_token}",
            "X-CSRF-Token": manager.csrf_token(credentials.session.session_id),
        }
        value = SimpleNamespace(
            path="/api/phone",
            headers=headers,
            rfile=io.BytesIO(body),
            send_error=lambda status, message: errors.append((status, message)),
            _send_json=lambda status, result: response.update(status=status, result=result),
        )
        handler = (
            futuristic_app.PARMARRequestHandler.do_GET
            if method == "GET"
            else futuristic_app.PARMARRequestHandler.do_POST
        )
        handler(value)
        return response, errors

    before = module.get_status()
    get_response, get_errors = request("GET")
    post_response, post_errors = request(
        "POST",
        {"action": "toggle_permission", "enabled": False},
    )

    assert get_response == {}
    assert get_errors == [(403, "Phone awareness is available only in anonymous local-demo mode")]
    assert post_response == {}
    assert post_errors == [(403, "Phone awareness is available only in anonymous local-demo mode")]
    assert module.get_status() == before
    assert "does not access real device APIs" in phone_awareness.__doc__
