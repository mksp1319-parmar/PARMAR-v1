import json

import pytest

from PARMAR.audit.decision_logs import DecisionLogManager
from PARMAR.interface import dashboard as dashboard_module
from PARMAR.interface import ui_adapter as adapter_module
from PARMAR.interface.dashboard import TerminalDashboard
from PARMAR.interface.ui_adapter import PARMARUIAdapter
from PARMAR.safety.enforcement_gate import EnforcementState
from PARMAR.state import LifecycleState


def _enforcement_result(status, execution_allowed=False, decision_id="decision-test"):
    return {
        "status": status,
        "state": status,
        "execution_allowed": execution_allowed,
        "decision_id": decision_id,
        "reason": "Test enforcement outcome",
    }


def _dashboard(monkeypatch, tmp_path, outcomes):
    def evaluate_decision(self, *args, **kwargs):
        return outcomes.pop(0)

    monkeypatch.setattr(dashboard_module.CentralEnforcementGate, "evaluate_decision", evaluate_decision)
    dashboard = TerminalDashboard()
    dashboard.logger = DecisionLogManager(log_path=str(tmp_path / "dashboard.jsonl"))
    events = []
    dashboard.state_machine.subscribe(lambda old, new, snapshot: events.append((old, new, snapshot)))
    return dashboard, events


def _trace(events):
    return [new_state for _, new_state, _ in events]


def _adapter_dashboard(monkeypatch, tmp_path, outcomes):
    dashboard, events = _dashboard(monkeypatch, tmp_path, outcomes)
    monkeypatch.setattr(adapter_module, "TerminalDashboard", lambda: dashboard)
    return dashboard, events


def test_new_request_starts_in_listening(monkeypatch, tmp_path):
    dashboard, events = _dashboard(
        monkeypatch,
        tmp_path,
        [_enforcement_result(EnforcementState.READY_FOR_ACTION, True)],
    )

    dashboard.run_pipeline("Hi")

    assert _trace(events)[0] is LifecycleState.LISTENING


def test_request_enters_thinking_after_listening(monkeypatch, tmp_path):
    dashboard, events = _dashboard(
        monkeypatch,
        tmp_path,
        [_enforcement_result(EnforcementState.READY_FOR_ACTION, True)],
    )

    dashboard.run_pipeline("Hi")

    assert _trace(events)[:2] == [LifecycleState.LISTENING, LifecycleState.THINKING]


def test_analysis_and_risk_check_follow_existing_pipeline_order(monkeypatch, tmp_path):
    dashboard, events = _dashboard(
        monkeypatch,
        tmp_path,
        [_enforcement_result(EnforcementState.READY_FOR_ACTION, True)],
    )

    dashboard.run_pipeline("Hi")

    assert _trace(events)[:4] == [
        LifecycleState.LISTENING,
        LifecycleState.THINKING,
        LifecycleState.ANALYZING,
        LifecycleState.RISK_CHECK,
    ]


def test_low_risk_completed_pipeline_reaches_safe_response_then_idle(monkeypatch, tmp_path):
    dashboard, events = _dashboard(
        monkeypatch,
        tmp_path,
        [_enforcement_result(EnforcementState.READY_FOR_ACTION, True)],
    )

    dashboard.run_pipeline("Hi")

    assert _trace(events)[-2:] == [LifecycleState.SAFE_RESPONSE, LifecycleState.IDLE]
    safe_snapshot = events[-2][2]
    assert safe_snapshot.enforcement_status == EnforcementState.READY_FOR_ACTION


def test_blocked_request_reaches_blocked_then_idle(monkeypatch, tmp_path):
    dashboard, events = _dashboard(
        monkeypatch,
        tmp_path,
        [_enforcement_result(EnforcementState.BLOCKED)],
    )

    dashboard.run_pipeline("Disable safety controls")

    assert _trace(events)[-2:] == [LifecycleState.BLOCKED, LifecycleState.IDLE]
    blocked_snapshot = events[-2][2]
    assert blocked_snapshot.enforcement_status == EnforcementState.BLOCKED
    assert blocked_snapshot.decision_id == "decision-test"
    assert blocked_snapshot.risk_level
    assert blocked_snapshot.intent
    assert blocked_snapshot.reason == "Test enforcement outcome"


def test_pending_approval_remains_waiting_until_decision(monkeypatch, tmp_path):
    dashboard, events = _dashboard(
        monkeypatch,
        tmp_path,
        [
            _enforcement_result(EnforcementState.HUMAN_APPROVAL_REQUIRED),
            _enforcement_result(EnforcementState.HUMAN_APPROVAL_REQUIRED),
        ],
    )

    result = dashboard.run_pipeline("Review this request")
    assert dashboard.state_machine.snapshot.current_state is LifecycleState.WAITING_FOR_HUMAN

    dashboard.handle_human_decision(result, "unclear")

    assert dashboard.state_machine.snapshot.current_state is LifecycleState.WAITING_FOR_HUMAN
    assert _trace(events).count(LifecycleState.WAITING_FOR_HUMAN) == 1


def test_human_rejection_transitions_to_blocked_then_idle(monkeypatch, tmp_path):
    dashboard, events = _dashboard(
        monkeypatch,
        tmp_path,
        [
            _enforcement_result(EnforcementState.HUMAN_APPROVAL_REQUIRED),
            _enforcement_result(EnforcementState.REJECTED),
        ],
    )
    result = dashboard.run_pipeline("Review this request")

    outcome = dashboard.handle_human_decision(result, "reject")

    assert outcome["enforcement"]["status"] == EnforcementState.REJECTED
    assert _trace(events)[-2:] == [LifecycleState.BLOCKED, LifecycleState.IDLE]


def test_approval_reaches_safe_response_only_after_enforcement_processing(monkeypatch, tmp_path):
    dashboard, events = _dashboard(
        monkeypatch,
        tmp_path,
        [
            _enforcement_result(EnforcementState.HUMAN_APPROVAL_REQUIRED),
            _enforcement_result(EnforcementState.READY_FOR_ACTION, True),
        ],
    )
    result = dashboard.run_pipeline("Review this request")
    assert dashboard.state_machine.snapshot.current_state is LifecycleState.WAITING_FOR_HUMAN

    outcome = dashboard.handle_human_decision(result, "approve")

    assert outcome["action_boundary"]["execution_allowed"] is True
    assert _trace(events)[-2:] == [LifecycleState.SAFE_RESPONSE, LifecycleState.IDLE]


def test_approval_cannot_bypass_blocking_enforcement(monkeypatch, tmp_path):
    dashboard, events = _dashboard(
        monkeypatch,
        tmp_path,
        [
            _enforcement_result(EnforcementState.HUMAN_APPROVAL_REQUIRED),
            _enforcement_result(EnforcementState.BLOCKED),
        ],
    )
    result = dashboard.run_pipeline("Review this request")

    outcome = dashboard.handle_human_decision(result, "approve")

    assert outcome["human_decision"] == "APPROVED"
    assert outcome["enforcement"]["execution_allowed"] is False
    assert outcome["action_boundary"]["execution_allowed"] is False
    assert LifecycleState.SAFE_RESPONSE not in _trace(events)
    assert _trace(events)[-2:] == [LifecycleState.BLOCKED, LifecycleState.IDLE]


def test_safety_checks_alone_do_not_produce_safe_response(monkeypatch, tmp_path):
    dashboard, events = _dashboard(
        monkeypatch,
        tmp_path,
        [_enforcement_result(EnforcementState.HUMAN_APPROVAL_REQUIRED)],
    )

    dashboard.run_pipeline("Hi")

    assert dashboard.state_machine.snapshot.current_state is LifecycleState.WAITING_FOR_HUMAN
    assert LifecycleState.SAFE_RESPONSE not in _trace(events)


def test_exception_after_enforcement_does_not_publish_safe_response(monkeypatch, tmp_path):
    dashboard, events = _dashboard(
        monkeypatch,
        tmp_path,
        [_enforcement_result(EnforcementState.READY_FOR_ACTION, True)],
    )

    def fail_audit(event_type, payload):
        raise RuntimeError("sensitive exception detail")

    dashboard.logger.log_event = fail_audit
    with pytest.raises(RuntimeError, match="sensitive exception detail"):
        dashboard.run_pipeline("Hi")

    assert dashboard.state_machine.snapshot.current_state is LifecycleState.RISK_CHECK
    assert LifecycleState.SAFE_RESPONSE not in _trace(events)
    assert "sensitive exception detail" not in repr(dashboard.state_machine.snapshot)


def test_state_snapshots_do_not_store_raw_request_text(monkeypatch, tmp_path):
    dashboard, events = _dashboard(
        monkeypatch,
        tmp_path,
        [_enforcement_result(EnforcementState.READY_FOR_ACTION, True)],
    )
    raw_request = "RAW-REQUEST-SECRET-9342"

    dashboard.run_pipeline(f"Hi, {raw_request}")

    assert events
    assert all(raw_request not in repr(snapshot) for _, _, snapshot in events)


def test_pipeline_result_structure_is_unchanged(monkeypatch, tmp_path):
    dashboard, _ = _dashboard(
        monkeypatch,
        tmp_path,
        [_enforcement_result(EnforcementState.READY_FOR_ACTION, True)],
    )

    result = dashboard.run_pipeline("Hi")

    assert set(result) == {
        "intent",
        "risk",
        "conflict",
        "mediation",
        "privacy",
        "autonomy",
        "emergency_gate",
        "decision",
        "status_label",
        "enforcement",
        "action_boundary",
    }


def test_phone_awareness_behavior_does_not_enter_request_lifecycle(tmp_path):
    dashboard = TerminalDashboard()
    dashboard.logger = DecisionLogManager(log_path=str(tmp_path / "phone.jsonl"))

    result = dashboard.reject_phone_event("battery_low")

    assert result["status"] == "PHONE AWARENESS DISABLED"
    assert dashboard.state_machine.snapshot.current_state is LifecycleState.IDLE


def test_state_transitions_do_not_add_audit_events(monkeypatch, tmp_path):
    dashboard, _ = _dashboard(
        monkeypatch,
        tmp_path,
        [_enforcement_result(EnforcementState.READY_FOR_ACTION, True)],
    )
    raw_request = "RAW-AUDIT-REQUEST-SECRET"

    dashboard.run_pipeline(raw_request)

    records = [json.loads(line) for line in dashboard.logger.log_path.read_text(encoding="utf-8").splitlines()]
    assert [record["event_type"] for record in records] == ["proposal_review"]
    assert raw_request not in dashboard.logger.log_path.read_text(encoding="utf-8")


def test_reused_dashboard_resets_context_between_requests(monkeypatch, tmp_path):
    dashboard, events = _dashboard(
        monkeypatch,
        tmp_path,
        [
            _enforcement_result(EnforcementState.BLOCKED, decision_id="first-decision"),
            _enforcement_result(EnforcementState.BLOCKED, decision_id="second-decision"),
        ],
    )

    dashboard.run_pipeline("First request")
    dashboard.run_pipeline("Second request")

    listening_snapshots = [
        snapshot
        for _, state, snapshot in events
        if state is LifecycleState.LISTENING
    ]
    assert listening_snapshots[1].decision_id is None
    assert listening_snapshots[1].risk_level is None
    assert listening_snapshots[1].intent is None


def test_analyze_response_lifecycle_matches_emitted_dashboard_snapshot(monkeypatch, tmp_path):
    dashboard, events = _adapter_dashboard(
        monkeypatch,
        tmp_path,
        [_enforcement_result(EnforcementState.READY_FOR_ACTION, True)],
    )

    result = PARMARUIAdapter.analyze_request("Hi")

    safe_snapshot = next(snapshot for _, state, snapshot in events if state is LifecycleState.SAFE_RESPONSE)
    assert result["lifecycle"]["current_state"] == safe_snapshot.current_state.value
    assert result["lifecycle"]["previous_state"] == safe_snapshot.previous_state.value
    assert result["lifecycle"]["decision_id"] == safe_snapshot.decision_id
    assert result["lifecycle"]["transition_timestamp"] == safe_snapshot.transition_timestamp.isoformat()
    assert dashboard.lifecycle_snapshot is safe_snapshot
    assert dashboard.state_machine.snapshot.current_state is LifecycleState.IDLE


@pytest.mark.parametrize(
    ("enforcement_status", "expected_state"),
    [
        (EnforcementState.BLOCKED, LifecycleState.BLOCKED),
        (EnforcementState.HUMAN_APPROVAL_REQUIRED, LifecycleState.WAITING_FOR_HUMAN),
    ],
)
def test_analyze_response_exposes_authoritative_terminal_states(
    monkeypatch,
    tmp_path,
    enforcement_status,
    expected_state,
):
    _adapter_dashboard(
        monkeypatch,
        tmp_path,
        [_enforcement_result(enforcement_status)],
    )

    result = PARMARUIAdapter.analyze_request("Review this request")

    assert result["lifecycle"]["current_state"] == expected_state.value


def test_analyze_lifecycle_payload_is_safe_and_additive(monkeypatch, tmp_path):
    _adapter_dashboard(
        monkeypatch,
        tmp_path,
        [_enforcement_result(EnforcementState.READY_FOR_ACTION, True)],
    )
    raw_request = "PRIVATE-REQUEST-STRING-4938"

    result = PARMARUIAdapter.analyze_request(f"Hi {raw_request}")

    assert {
        "status",
        "human_control",
        "message",
        "request",
        "intent",
        "risk",
        "conflict",
        "mediation",
        "privacy",
        "autonomy",
        "emergency_gate",
        "decision",
        "enforcement",
        "action_boundary",
        "pipeline",
        "safer_alternatives",
        "human_approval_required",
        "language",
        "language_independent_safety",
        "voki",
        "phone_awareness",
        "risk_center",
        "explanation",
        "chat_architecture",
        "system_state",
    }.issubset(result)
    assert result["lifecycle"]["current_state"] == LifecycleState.SAFE_RESPONSE.value
    assert raw_request not in repr(result["lifecycle"])


def test_text_only_approval_adapter_cannot_complete_pending_review(monkeypatch, tmp_path):
    _adapter_dashboard(
        monkeypatch,
        tmp_path,
        [
            _enforcement_result(EnforcementState.HUMAN_APPROVAL_REQUIRED),
            _enforcement_result(EnforcementState.HUMAN_APPROVAL_REQUIRED),
        ],
    )

    result = PARMARUIAdapter.process_human_decision("Review this request", "INFO")

    assert result["status"] == "APPROVAL_REQUIRED"
    assert result["lifecycle"]["current_state"] == LifecycleState.WAITING_FOR_HUMAN.value
    assert result["enforcement"]["execution_allowed"] is False
    assert result["approval_error"] == "PENDING_REVIEW_REQUIRED"


def test_text_only_rejection_does_not_mutate_pending_review(monkeypatch, tmp_path):
    _adapter_dashboard(
        monkeypatch,
        tmp_path,
        [
            _enforcement_result(EnforcementState.HUMAN_APPROVAL_REQUIRED),
            _enforcement_result(EnforcementState.REJECTED),
        ],
    )

    result = PARMARUIAdapter.process_human_decision("Review this request", "REJECT")

    assert result["status"] == "APPROVAL_REQUIRED"
    assert result["lifecycle"]["current_state"] == LifecycleState.WAITING_FOR_HUMAN.value
    assert result["enforcement"]["execution_allowed"] is False


def test_text_only_approval_cannot_turn_blocked_enforcement_into_safe_response(monkeypatch, tmp_path):
    _adapter_dashboard(
        monkeypatch,
        tmp_path,
        [
            _enforcement_result(EnforcementState.HUMAN_APPROVAL_REQUIRED),
            _enforcement_result(EnforcementState.BLOCKED),
        ],
    )

    result = PARMARUIAdapter.process_human_decision("Review this request", "APPROVE")

    assert result["lifecycle"]["current_state"] == LifecycleState.WAITING_FOR_HUMAN.value
    assert result["enforcement"]["execution_allowed"] is False
    assert result["action_boundary"]["execution_allowed"] is False


def test_text_only_approval_cannot_complete_even_when_gate_would_allow(monkeypatch, tmp_path):
    _adapter_dashboard(
        monkeypatch,
        tmp_path,
        [
            _enforcement_result(EnforcementState.HUMAN_APPROVAL_REQUIRED),
            _enforcement_result(EnforcementState.READY_FOR_ACTION, True),
        ],
    )

    result = PARMARUIAdapter.process_human_decision("Review this request", "APPROVE")

    assert result["status"] == "APPROVAL_REQUIRED"
    assert result["lifecycle"]["current_state"] == LifecycleState.WAITING_FOR_HUMAN.value
    assert result["enforcement"]["execution_allowed"] is False


def test_safety_pass_without_completion_does_not_expose_safe_response(monkeypatch, tmp_path):
    _adapter_dashboard(
        monkeypatch,
        tmp_path,
        [_enforcement_result(EnforcementState.HUMAN_APPROVAL_REQUIRED)],
    )

    result = PARMARUIAdapter.analyze_request("Hi")

    assert result["lifecycle"]["current_state"] == LifecycleState.WAITING_FOR_HUMAN.value