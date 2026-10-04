"""Lifecycle state tracking independent of PARMAR safety decisions."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Mapping


class LifecycleState(str, Enum):
    """Stable machine-readable states for a PARMAR request lifecycle."""

    IDLE = "IDLE"
    LISTENING = "LISTENING"
    THINKING = "THINKING"
    ANALYZING = "ANALYZING"
    RISK_CHECK = "RISK_CHECK"
    WAITING_FOR_HUMAN = "WAITING_FOR_HUMAN"
    ENFORCEMENT_ALLOWED = "ENFORCEMENT_ALLOWED"
    PROVIDER = "PROVIDER"
    RESPONSE_SAFETY = "RESPONSE_SAFETY"
    RELEASED = "RELEASED"
    WITHHELD = "WITHHELD"
    PROVIDER_FAILED = "PROVIDER_FAILED"
    BLOCKED = "BLOCKED"


class InvalidTransitionError(ValueError):
    """Raised when a lifecycle transition is invalid or lacks its gate outcome."""


@dataclass(frozen=True)
class StateSnapshot:
    """Immutable, non-sensitive view of the current request lifecycle state."""

    current_state: LifecycleState
    previous_state: LifecycleState | None
    transition_timestamp: datetime
    request_id: str | None = None
    decision_id: str | None = None
    enforcement_status: str | None = None
    risk_level: str | None = None
    intent: str | None = None
    human_approval_status: str | None = None
    reason: str | None = None


Observer = Callable[[LifecycleState, LifecycleState, StateSnapshot], None]


class LifecycleStateMachine:
    """Track allowed UI lifecycle changes without making safety decisions."""

    _VALID_TRANSITIONS = {
        LifecycleState.IDLE: {LifecycleState.LISTENING},
        LifecycleState.LISTENING: {LifecycleState.THINKING},
        LifecycleState.THINKING: {LifecycleState.ANALYZING},
        LifecycleState.ANALYZING: {LifecycleState.RISK_CHECK},
        LifecycleState.RISK_CHECK: {
            LifecycleState.ENFORCEMENT_ALLOWED,
            LifecycleState.WAITING_FOR_HUMAN,
            LifecycleState.BLOCKED,
        },
        LifecycleState.WAITING_FOR_HUMAN: {
            LifecycleState.ENFORCEMENT_ALLOWED,
            LifecycleState.BLOCKED,
        },
        LifecycleState.ENFORCEMENT_ALLOWED: {LifecycleState.PROVIDER, LifecycleState.IDLE},
        LifecycleState.PROVIDER: {LifecycleState.RESPONSE_SAFETY, LifecycleState.PROVIDER_FAILED},
        LifecycleState.RESPONSE_SAFETY: {LifecycleState.RELEASED, LifecycleState.WITHHELD},
        LifecycleState.RELEASED: {LifecycleState.IDLE},
        LifecycleState.WITHHELD: {LifecycleState.IDLE},
        LifecycleState.PROVIDER_FAILED: {LifecycleState.IDLE},
        LifecycleState.BLOCKED: {LifecycleState.IDLE},
    }

    def __init__(self) -> None:
        self._snapshot = StateSnapshot(
            current_state=LifecycleState.IDLE,
            previous_state=None,
            transition_timestamp=datetime.now(timezone.utc),
        )
        self._observers: list[Observer] = []

    @property
    def snapshot(self) -> StateSnapshot:
        """Return the current immutable state snapshot."""
        return self._snapshot

    def subscribe(self, observer: Observer) -> Callable[[], None]:
        """Subscribe to transitions and return a function that removes the observer."""
        self._observers.append(observer)

        def unsubscribe() -> None:
            if observer in self._observers:
                self._observers.remove(observer)

        return unsubscribe

    def transition(
        self,
        new_state: LifecycleState,
        *,
        request_id: str | None = None,
        decision_id: str | None = None,
        risk_level: str | None = None,
        intent: str | None = None,
        human_approval_status: str | None = None,
        reason: str | None = None,
        reset_context: bool = False,
        enforcement_result: Mapping[str, Any] | None = None,
        response_safety_result: Mapping[str, Any] | None = None,
    ) -> StateSnapshot:
        """Apply one allowed lifecycle change; permission states require enforcement."""
        old_state = self._snapshot.current_state
        if new_state not in self._VALID_TRANSITIONS[old_state]:
            raise InvalidTransitionError(f"Invalid lifecycle transition: {old_state.value} -> {new_state.value}")
        if reset_context and (old_state is not LifecycleState.IDLE or new_state is not LifecycleState.LISTENING):
            raise InvalidTransitionError("Request context can only reset when starting from IDLE")

        if new_state in {
            LifecycleState.WAITING_FOR_HUMAN,
            LifecycleState.BLOCKED,
            LifecycleState.ENFORCEMENT_ALLOWED,
        }:
            self._validate_enforcement_outcome(new_state, enforcement_result)
        if new_state in {LifecycleState.RELEASED, LifecycleState.WITHHELD}:
            self._validate_response_disposition(new_state, response_safety_result)

        if enforcement_result is not None:
            decision_id = decision_id or _string_value(enforcement_result.get("decision_id"))
            enforcement_status = _normalized_status(enforcement_result) or None
            risk_level = risk_level or _string_value(enforcement_result.get("risk_level"))
            human_approval_status = (
                human_approval_status
                or _string_value(enforcement_result.get("human_approval"))
                or (
                    LifecycleState.WAITING_FOR_HUMAN.value
                    if _normalized_status(enforcement_result) == "HUMAN_APPROVAL_REQUIRED"
                    else None
                )
            )
            reason = reason or _string_value(enforcement_result.get("reason"))

        old_snapshot = self._snapshot
        if reset_context:
            old_snapshot = StateSnapshot(
                current_state=old_state,
                previous_state=old_snapshot.previous_state,
                transition_timestamp=old_snapshot.transition_timestamp,
            )
        new_snapshot = StateSnapshot(
            current_state=new_state,
            previous_state=old_state,
            transition_timestamp=datetime.now(timezone.utc),
            request_id=request_id if request_id is not None else old_snapshot.request_id,
            decision_id=decision_id if decision_id is not None else old_snapshot.decision_id,
            enforcement_status=(
                enforcement_status
                if enforcement_result is not None
                else old_snapshot.enforcement_status
            ),
            risk_level=risk_level if risk_level is not None else old_snapshot.risk_level,
            intent=intent if intent is not None else old_snapshot.intent,
            human_approval_status=(
                human_approval_status
                if human_approval_status is not None
                else old_snapshot.human_approval_status
            ),
            reason=reason,
        )
        self._snapshot = new_snapshot

        for observer in tuple(self._observers):
            observer(old_state, new_state, new_snapshot)

        return new_snapshot

    def apply_enforcement_result(
        self,
        enforcement_result: Mapping[str, Any],
        *,
        request_id: str | None = None,
        risk_level: str | None = None,
        intent: str | None = None,
        human_approval_status: str | None = None,
    ) -> StateSnapshot:
        """Map an authoritative enforcement outcome to its lifecycle presentation."""
        status = _normalized_status(enforcement_result)
        if status in {"BLOCKED", "REJECTED"}:
            target = LifecycleState.BLOCKED
        elif status == "HUMAN_APPROVAL_REQUIRED":
            target = LifecycleState.WAITING_FOR_HUMAN
        elif status in {"READY_FOR_ACTION", "APPROVED"}:
            if enforcement_result.get("execution_allowed") is not True:
                raise ValueError("An allowed enforcement outcome must explicitly allow execution")
            target = LifecycleState.ENFORCEMENT_ALLOWED
        else:
            raise ValueError(f"Unsupported enforcement outcome: {status or 'missing status'}")

        return self.transition(
            target,
            enforcement_result=enforcement_result,
            request_id=request_id,
            risk_level=risk_level,
            intent=intent,
            human_approval_status=human_approval_status,
        )

    @staticmethod
    def _validate_enforcement_outcome(
        target: LifecycleState,
        enforcement_result: Mapping[str, Any] | None,
    ) -> None:
        if enforcement_result is None:
            raise InvalidTransitionError(f"{target.value} requires an authoritative enforcement result")

        status = _normalized_status(enforcement_result)
        valid_statuses = {
            LifecycleState.WAITING_FOR_HUMAN: {"HUMAN_APPROVAL_REQUIRED"},
            LifecycleState.BLOCKED: {"BLOCKED", "REJECTED"},
            LifecycleState.ENFORCEMENT_ALLOWED: {"READY_FOR_ACTION", "APPROVED"},
        }
        if status not in valid_statuses[target]:
            raise InvalidTransitionError(f"Enforcement outcome {status or 'missing status'} cannot enter {target.value}")

        if target is LifecycleState.ENFORCEMENT_ALLOWED:
            if enforcement_result.get("execution_allowed") is not True:
                raise InvalidTransitionError("ENFORCEMENT_ALLOWED requires execution_allowed=True from enforcement")

    @staticmethod
    def _validate_response_disposition(
        target: LifecycleState,
        response_safety_result: Mapping[str, Any] | None,
    ) -> None:
        if response_safety_result is None:
            raise InvalidTransitionError(f"{target.value} requires an authoritative response-safety result")
        status = str(response_safety_result.get("status") or "").strip().upper()
        expected = (
            {"PASS"}
            if target is LifecycleState.RELEASED
            else {"REVIEW", "BLOCK", "UNCERTAIN", "NOT_CHECKED"}
        )
        if status not in expected:
            raise InvalidTransitionError(
                f"Response-safety outcome {status or 'missing status'} cannot enter {target.value}"
            )


def _normalized_status(enforcement_result: Mapping[str, Any]) -> str:
    return str(enforcement_result.get("status") or enforcement_result.get("state") or "").strip().upper()


def _string_value(value: Any) -> str | None:
    return str(value) if value is not None else None