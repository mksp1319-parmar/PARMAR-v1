"""Authoritative PARMAR-to-VOKKI state contract."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping, TypedDict

from PARMAR.interface.voki import PARMARVoki
from PARMAR.state import LifecycleState

UNKNOWN = "UNKNOWN"
CONTRACT_VERSION = "1.0"

_LIFECYCLE_STATES = {state.value for state in LifecycleState} | {UNKNOWN}
_REVIEW_STATES = {
    "SAFE",
    "APPROVAL_REQUIRED",
    "BLOCKED",
    "APPROVED",
    "REJECTED",
    "RISK_DETECTED",
    UNKNOWN,
}
_ENFORCEMENT_STATES = {
    "READY_FOR_ACTION",
    "APPROVED",
    "HUMAN_APPROVAL_REQUIRED",
    "BLOCKED",
    "REJECTED",
    UNKNOWN,
}
_PROVIDER_STATES = {"NOT_STARTED", "COMPLETED", "FAILED", UNKNOWN}
_RESPONSE_SAFETY_STATES = {"PASS", "REVIEW", "BLOCK", "UNCERTAIN", "NOT_CHECKED", UNKNOWN}
_RESPONSE_DISPOSITIONS = {"RELEASED", "WITHHELD", "NOT_APPLICABLE", UNKNOWN}


class LifecycleFacts(TypedDict):
    state: str
    previous_state: str


class RequestReviewFacts(TypedDict):
    status: str
    intent: Any
    risk: Any
    conflict: Any
    mediation: Any
    privacy: Any
    autonomy: Any
    emergency_gate: Any


class EnforcementFacts(TypedDict):
    status: str
    execution_allowed: bool | str


class ApprovalFacts(TypedDict):
    status: str
    required: bool | str
    record_available: str


class ProviderFacts(TypedDict):
    status: str
    id: str


class ResponseSafetyFacts(TypedDict):
    status: str
    reason_codes: list[str]
    checks_run: list[str]
    validator_version: str


def _mapping(value: object) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _known_string(value: object) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else UNKNOWN


def _choice(value: object, choices: set[str]) -> str:
    normalized = _known_string(value).upper()
    return normalized if normalized in choices else UNKNOWN


def _string_list(value: object, *, unknown: bool = False) -> list[str]:
    if isinstance(value, (list, tuple)) and all(isinstance(item, str) for item in value):
        return list(value)
    return [UNKNOWN] if unknown else []


@dataclass(frozen=True)
class VOKKIContract:
    """Separate authoritative PARMAR facts for VOKKI interpretation."""

    lifecycle: LifecycleFacts
    request_review: RequestReviewFacts
    enforcement: EnforcementFacts
    approval: ApprovalFacts
    provider: ProviderFacts
    response_safety: ResponseSafetyFacts
    response_disposition: str
    message: str
    request_id: str
    timestamp: str
    source: str
    contract_version: str = CONTRACT_VERSION

    @classmethod
    def from_response(
        cls,
        response: Mapping[str, Any],
        *,
        provider_status: str | None = None,
        response_disposition: str | None = None,
        approval_record_available: bool | None = None,
        source: str,
    ) -> VOKKIContract:
        analysis = _mapping(response.get("analysis"))
        lifecycle = _mapping(response.get("lifecycle"))
        if not lifecycle:
            lifecycle = _mapping(analysis.get("lifecycle"))
        review = _mapping(response.get("request_safety"))
        if not review:
            review = analysis or response
        enforcement = _mapping(response.get("enforcement"))
        if not enforcement:
            enforcement = _mapping(review.get("enforcement"))
        if not enforcement:
            enforcement = _mapping(analysis.get("enforcement"))
        decision = _mapping(response.get("decision"))
        if not decision:
            decision = _mapping(analysis.get("decision"))
        review_source = analysis or response
        provider = _known_string(response.get("provider"))
        resolved_provider_status = _choice(
            provider_status if provider_status is not None else response.get("provider_status"),
            _PROVIDER_STATES,
        )
        if resolved_provider_status == UNKNOWN and response.get("provider_error") is True:
            resolved_provider_status = "FAILED"
        response_safety = _mapping(response.get("response_safety"))
        safety_status = _choice(response_safety.get("status"), _RESPONSE_SAFETY_STATES)

        if approval_record_available is None:
            if "approval_id" in response:
                approval_record = "AVAILABLE"
            elif decision.get("requires_human_approval") is False:
                approval_record = "NOT_REQUIRED"
            elif decision.get("requires_human_approval") is True:
                approval_record = "UNAVAILABLE"
            else:
                approval_record = UNKNOWN
        else:
            approval_record = "AVAILABLE" if approval_record_available else "UNAVAILABLE"

        required = decision.get("requires_human_approval")
        human_status = _known_string(decision.get("human_approval_status")).upper()
        enforcement_status = _choice(enforcement.get("status"), _ENFORCEMENT_STATES)
        if required is False:
            approval_status = "NOT_REQUIRED"
        elif human_status in {"APPROVED", "REJECTED"}:
            approval_status = human_status
        elif required is True or enforcement_status == "HUMAN_APPROVAL_REQUIRED":
            approval_status = "PENDING"
        else:
            approval_status = UNKNOWN

        disposition = response_disposition
        if disposition is None:
            disposition = _known_string(response.get("response_disposition"))
        if resolved_provider_status in {"NOT_STARTED", "FAILED"}:
            disposition = "NOT_APPLICABLE"
        elif resolved_provider_status == "COMPLETED":
            if safety_status != "PASS":
                disposition = "WITHHELD"
            elif disposition == UNKNOWN:
                disposition = "RELEASED"
        elif disposition == "RELEASED":
            disposition = UNKNOWN
        if disposition not in _RESPONSE_DISPOSITIONS:
            disposition = UNKNOWN

        request_id = _known_string(lifecycle.get("request_id"))
        if request_id == UNKNOWN:
            request_id = _known_string(_mapping(analysis.get("lifecycle")).get("request_id"))

        execution_allowed = enforcement.get("execution_allowed")
        if not isinstance(execution_allowed, bool):
            execution_allowed = UNKNOWN

        lifecycle_state = _choice(
            lifecycle.get("current_state", lifecycle.get("state")),
            _LIFECYCLE_STATES,
        )
        if lifecycle_state == "RELEASED" and disposition != "RELEASED":
            lifecycle_state = (
                "WITHHELD"
                if resolved_provider_status == "COMPLETED"
                else "PROVIDER_FAILED"
                if resolved_provider_status == "FAILED"
                else UNKNOWN
            )

        return cls(
            lifecycle={
                "state": lifecycle_state,
                "previous_state": _choice(
                    lifecycle.get("previous_state"),
                    _LIFECYCLE_STATES,
                ),
            },
            request_review={
                "status": _choice(review.get("status", analysis.get("status")), _REVIEW_STATES),
                "intent": review_source.get("intent", UNKNOWN),
                "risk": review_source.get("risk", UNKNOWN),
                "conflict": review_source.get("conflict", UNKNOWN),
                "mediation": review_source.get("mediation", UNKNOWN),
                "privacy": review_source.get("privacy", UNKNOWN),
                "autonomy": review_source.get("autonomy", UNKNOWN),
                "emergency_gate": review_source.get("emergency_gate", UNKNOWN),
            },
            enforcement={
                "status": enforcement_status,
                "execution_allowed": execution_allowed,
            },
            approval={
                "status": approval_status,
                "required": required if isinstance(required, bool) else UNKNOWN,
                "record_available": approval_record,
            },
            provider={
                "status": resolved_provider_status,
                "id": provider,
            },
            response_safety={
                "status": safety_status,
                "reason_codes": _string_list(
                    response_safety.get("reason_codes"),
                    unknown=safety_status == UNKNOWN,
                ),
                "checks_run": _string_list(
                    response_safety.get("checks_run"),
                    unknown=safety_status == UNKNOWN,
                ),
                "validator_version": _known_string(response_safety.get("validator_version")),
            },
            response_disposition=disposition,
            message=_known_string(response.get("message")),
            request_id=request_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            source=source,
        )

    def public_payload(self) -> dict[str, Any]:
        return {
            "contract_version": self.contract_version,
            "request_id": self.request_id,
            "timestamp": self.timestamp,
            "source": self.source,
            "lifecycle": dict(self.lifecycle),
            "request_review": dict(self.request_review),
            "enforcement": dict(self.enforcement),
            "approval": dict(self.approval),
            "provider": dict(self.provider),
            "response_safety": dict(self.response_safety),
            "response_disposition": self.response_disposition,
            "message": self.message,
        }


def attach_voki_contract(
    response: dict[str, Any],
    *,
    provider_status: str | None = None,
    response_disposition: str | None = None,
    approval_record_available: bool | None = None,
    source: str,
) -> dict[str, Any]:
    contract = VOKKIContract.from_response(
        response,
        provider_status=provider_status,
        response_disposition=response_disposition,
        approval_record_available=approval_record_available,
        source=source,
    )
    response["response_disposition"] = contract.response_disposition
    response["voki_contract"] = contract.public_payload()
    response["voki"] = PARMARVoki().state_for(contract.lifecycle["state"])
    return response
