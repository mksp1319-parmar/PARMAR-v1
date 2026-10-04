from dataclasses import FrozenInstanceError

import pytest

from PARMAR.state import InvalidTransitionError, LifecycleState, LifecycleStateMachine


def test_initial_state_is_idle():
    machine = LifecycleStateMachine()

    assert machine.snapshot.current_state is LifecycleState.IDLE
    assert machine.snapshot.previous_state is None


@pytest.mark.parametrize(
    ("start", "end"),
    [
        (LifecycleState.IDLE, LifecycleState.LISTENING),
        (LifecycleState.LISTENING, LifecycleState.THINKING),
        (LifecycleState.THINKING, LifecycleState.ANALYZING),
        (LifecycleState.ANALYZING, LifecycleState.RISK_CHECK),
    ],
)
def test_normal_lifecycle_transitions(start, end):
    machine = LifecycleStateMachine()
    _advance_to(machine, start)

    assert machine.transition(end).current_state is end


def test_risk_check_maps_permission_without_claiming_a_response_was_released():
    machine = _machine_at_risk_check()

    snapshot = machine.apply_enforcement_result(
        {"status": "READY_FOR_ACTION", "execution_allowed": True},
    )

    assert snapshot.current_state is LifecycleState.ENFORCEMENT_ALLOWED
    assert snapshot.current_state is not LifecycleState.RELEASED


def test_risk_check_can_map_human_approval_requirement():
    machine = _machine_at_risk_check()

    snapshot = machine.apply_enforcement_result({"status": "HUMAN_APPROVAL_REQUIRED"})

    assert snapshot.current_state is LifecycleState.WAITING_FOR_HUMAN
    assert snapshot.human_approval_status == LifecycleState.WAITING_FOR_HUMAN.value


def test_enforcement_mapping_accepts_optional_risk_and_intent_summaries():
    machine = _machine_at_risk_check()

    snapshot = machine.apply_enforcement_result(
        {"status": "HUMAN_APPROVAL_REQUIRED"},
        risk_level="high",
        intent="review access request",
    )

    assert snapshot.risk_level == "high"
    assert snapshot.intent == "review access request"


def test_risk_check_can_map_blocked_outcome():
    machine = _machine_at_risk_check()

    snapshot = machine.apply_enforcement_result({"status": "BLOCKED"})

    assert snapshot.current_state is LifecycleState.BLOCKED


def test_waiting_for_human_maps_approval_to_permission_not_release():
    machine = _machine_at_risk_check()
    machine.apply_enforcement_result({"status": "HUMAN_APPROVAL_REQUIRED"})

    snapshot = machine.apply_enforcement_result(
        {"status": "READY_FOR_ACTION", "execution_allowed": True, "human_approval": "APPROVED"},
    )

    assert snapshot.current_state is LifecycleState.ENFORCEMENT_ALLOWED


def test_waiting_for_human_can_map_rejection():
    machine = _machine_at_risk_check()
    machine.apply_enforcement_result({"status": "HUMAN_APPROVAL_REQUIRED"})

    snapshot = machine.apply_enforcement_result({"status": "REJECTED"})

    assert snapshot.current_state is LifecycleState.BLOCKED


@pytest.mark.parametrize("terminal_state", [LifecycleState.ENFORCEMENT_ALLOWED, LifecycleState.BLOCKED])
def test_terminal_lifecycle_returns_to_idle(terminal_state):
    machine = _machine_at_risk_check()
    if terminal_state is LifecycleState.ENFORCEMENT_ALLOWED:
        machine.apply_enforcement_result({"status": "READY_FOR_ACTION", "execution_allowed": True})
    else:
        machine.apply_enforcement_result({"status": "BLOCKED"})

    assert machine.transition(LifecycleState.IDLE).current_state is LifecycleState.IDLE


def test_arbitrary_transition_is_rejected_without_mutating_state():
    machine = LifecycleStateMachine()
    before = machine.snapshot

    with pytest.raises(InvalidTransitionError):
        machine.transition(LifecycleState.ANALYZING)

    assert machine.snapshot is before


def test_permission_transition_requires_authoritative_enforcement_outcome():
    machine = _machine_at_risk_check()

    with pytest.raises(InvalidTransitionError):
        machine.transition(LifecycleState.ENFORCEMENT_ALLOWED)

    assert machine.snapshot.current_state is LifecycleState.RISK_CHECK


def test_enforcement_permission_must_be_followed_by_provider_and_response_safety():
    machine = _machine_at_risk_check()
    permission = machine.apply_enforcement_result({"status": "READY_FOR_ACTION", "execution_allowed": True})
    assert permission.current_state is LifecycleState.ENFORCEMENT_ALLOWED
    assert machine.transition(LifecycleState.PROVIDER).current_state is LifecycleState.PROVIDER
    assert machine.transition(LifecycleState.RESPONSE_SAFETY).current_state is LifecycleState.RESPONSE_SAFETY
    assert machine.transition(
        LifecycleState.RELEASED,
        response_safety_result={"status": "PASS"},
    ).current_state is LifecycleState.RELEASED


@pytest.mark.parametrize("status", ["REVIEW", "BLOCK", "UNCERTAIN", "NOT_CHECKED"])
def test_nonpass_response_safety_can_only_enter_withheld(status):
    machine = _machine_at_risk_check()
    machine.apply_enforcement_result({"status": "READY_FOR_ACTION", "execution_allowed": True})
    machine.transition(LifecycleState.PROVIDER)
    machine.transition(LifecycleState.RESPONSE_SAFETY)

    with pytest.raises(InvalidTransitionError):
        machine.transition(
            LifecycleState.RELEASED,
            response_safety_result={"status": status},
        )

    assert machine.transition(
        LifecycleState.WITHHELD,
        response_safety_result={"status": status},
    ).current_state is LifecycleState.WITHHELD


def test_enforcement_allowed_requires_explicit_execution_permission():
    machine = _machine_at_risk_check()

    with pytest.raises(ValueError):
        machine.apply_enforcement_result(
            {"status": "READY_FOR_ACTION", "execution_allowed": False},
        )

    permission = machine.transition(
        LifecycleState.ENFORCEMENT_ALLOWED,
        enforcement_result={"status": "READY_FOR_ACTION", "execution_allowed": True},
    )
    assert permission.current_state is LifecycleState.ENFORCEMENT_ALLOWED


def test_snapshot_tracks_context_and_is_immutable():
    machine = LifecycleStateMachine()
    machine.transition(
        LifecycleState.LISTENING,
        request_id="request-1",
        intent="weather lookup",
        reason="Request received",
    )
    snapshot = machine.transition(LifecycleState.THINKING, risk_level="low")

    assert snapshot.current_state is LifecycleState.THINKING
    assert snapshot.previous_state is LifecycleState.LISTENING
    assert snapshot.request_id == "request-1"
    assert snapshot.intent == "weather lookup"
    assert snapshot.risk_level == "low"
    assert snapshot.reason is None
    assert snapshot.transition_timestamp.tzinfo is not None
    with pytest.raises(FrozenInstanceError):
        snapshot.current_state = LifecycleState.BLOCKED


def test_enforcement_fields_are_copied_into_snapshot():
    machine = _machine_at_risk_check()
    snapshot = machine.apply_enforcement_result({
        "status": "BLOCKED",
        "decision_id": "decision-2",
        "risk_level": "high",
        "human_approval": "REJECTED",
        "reason": "Rejected by enforcement",
    })

    assert snapshot.decision_id == "decision-2"
    assert snapshot.risk_level == "high"
    assert snapshot.human_approval_status == "REJECTED"
    assert snapshot.reason == "Rejected by enforcement"


def test_observer_receives_transition_and_snapshot():
    machine = LifecycleStateMachine()
    events = []
    machine.subscribe(lambda old, new, snapshot: events.append((old, new, snapshot)))

    snapshot = machine.transition(LifecycleState.LISTENING)

    assert events == [(LifecycleState.IDLE, LifecycleState.LISTENING, snapshot)]


def test_unsubscribe_stops_observer_notifications():
    machine = LifecycleStateMachine()
    events = []
    unsubscribe = machine.subscribe(lambda old, new, snapshot: events.append(new))
    unsubscribe()

    machine.transition(LifecycleState.LISTENING)

    assert events == []


def test_raw_request_text_is_not_part_of_snapshot_or_transition_api():
    machine = LifecycleStateMachine()
    snapshot = machine.transition(LifecycleState.LISTENING, request_id="request-3")

    assert "raw_request_text" not in snapshot.__dataclass_fields__
    with pytest.raises(TypeError):
        machine.transition(LifecycleState.THINKING, raw_request_text="sensitive text")


def test_enforcement_outcome_cannot_skip_lifecycle_stages():
    machine = LifecycleStateMachine()

    with pytest.raises(InvalidTransitionError):
        machine.apply_enforcement_result({"status": "BLOCKED"})

    assert machine.snapshot.current_state is LifecycleState.IDLE


def _machine_at_risk_check():
    machine = LifecycleStateMachine()
    _advance_to(machine, LifecycleState.RISK_CHECK)
    return machine


def _advance_to(machine, target):
    lifecycle = [
        LifecycleState.IDLE,
        LifecycleState.LISTENING,
        LifecycleState.THINKING,
        LifecycleState.ANALYZING,
        LifecycleState.RISK_CHECK,
    ]
    for state in lifecycle[1 : lifecycle.index(target) + 1]:
        machine.transition(state)