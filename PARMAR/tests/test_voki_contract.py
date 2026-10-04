from PARMAR.interface.voki import PARMARVoki
from PARMAR.interface.voki_contract import UNKNOWN, VOKKIContract, attach_voki_contract


def test_unknown_backend_facts_are_not_inferred_as_idle_or_safe():
    response = {"status": "SAFE"}
    payload = VOKKIContract.from_response(response, source="contract-test").public_payload()

    assert payload["lifecycle"]["state"] == UNKNOWN
    assert payload["request_review"]["status"] == "SAFE"
    assert payload["response_safety"]["status"] == UNKNOWN
    assert payload["response_disposition"] == UNKNOWN
    assert payload["provider"]["status"] == UNKNOWN
    assert payload["enforcement"]["execution_allowed"] == UNKNOWN
    assert PARMARVoki().state_for(None)["state"] == UNKNOWN


def test_enforcement_permission_does_not_imply_a_released_response():
    response = {
        "status": "SAFE",
        "lifecycle": {"current_state": "ENFORCEMENT_ALLOWED", "request_id": "request-1"},
        "enforcement": {"status": "READY_FOR_ACTION", "execution_allowed": True},
        "decision": {"requires_human_approval": False},
        "provider": "not_started",
        "response_safety": {"status": "NOT_CHECKED"},
        "provider_status": "NOT_STARTED",
        "response_disposition": "NOT_APPLICABLE",
    }

    payload = VOKKIContract.from_response(response, source="contract-test").public_payload()

    assert payload["lifecycle"]["state"] == "ENFORCEMENT_ALLOWED"
    assert payload["enforcement"]["execution_allowed"] is True
    assert payload["provider"]["status"] == "NOT_STARTED"
    assert payload["response_safety"]["status"] == "NOT_CHECKED"
    assert payload["response_disposition"] == "NOT_APPLICABLE"
    assert "execution_happened" not in payload


def test_release_requires_completed_provider_output_and_response_safety_pass():
    response = {
        "status": "RESPONSE_VALIDATED",
        "provider": "local-demo",
        "provider_status": "COMPLETED",
        "response_safety": {"status": "PASS"},
        "message": "Validated content",
    }

    result = attach_voki_contract(response, source="contract-test")
    payload = result["voki_contract"]

    assert payload["provider"]["status"] == "COMPLETED"
    assert payload["response_safety"]["status"] == "PASS"
    assert payload["response_disposition"] == "RELEASED"
    assert result["voki"]["state"] == payload["lifecycle"]["state"] == "UNKNOWN"


def test_response_safety_failure_cannot_be_released_and_provider_failure_is_distinct():
    unsafe = VOKKIContract.from_response(
        {
            "provider": "local-demo",
            "provider_status": "COMPLETED",
            "response_safety": {"status": "BLOCK"},
        },
        source="contract-test",
    ).public_payload()
    failed = VOKKIContract.from_response(
        {
            "provider": "unavailable",
            "provider_status": "FAILED",
            "provider_error": True,
            "response_safety": {"status": "NOT_CHECKED"},
        },
        source="contract-test",
    ).public_payload()

    assert unsafe["response_disposition"] == "WITHHELD"
    assert failed["provider"]["status"] == "FAILED"
    assert failed["response_safety"]["status"] == "NOT_CHECKED"
    assert failed["response_disposition"] == "NOT_APPLICABLE"


def test_explicit_release_claim_is_overridden_when_safety_did_not_pass():
    payload = VOKKIContract.from_response(
        {
            "lifecycle": {"current_state": "RELEASED"},
            "provider_status": "COMPLETED",
            "response_safety": {"status": "UNCERTAIN"},
            "response_disposition": "RELEASED",
        },
        source="contract-test",
    ).public_payload()

    assert payload["response_disposition"] == "WITHHELD"
    assert payload["lifecycle"]["state"] == "WITHHELD"


def test_legacy_safe_response_lifecycle_is_unknown():
    payload = VOKKIContract.from_response(
        {"lifecycle": {"current_state": "SAFE_RESPONSE"}},
        source="contract-test",
    ).public_payload()

    assert payload["lifecycle"]["state"] == UNKNOWN


def test_contract_keeps_authority_domains_as_independent_fields():
    response = {
        "message": "Review pending.",
        "analysis": {
            "status": "APPROVAL_REQUIRED",
            "lifecycle": {"current_state": "WAITING_FOR_HUMAN"},
            "decision": {
                "requires_human_approval": True,
                "human_approval_status": "PENDING HUMAN APPROVAL",
            },
            "enforcement": {
                "status": "HUMAN_APPROVAL_REQUIRED",
                "execution_allowed": False,
            },
        },
        "provider": "not_started",
        "provider_status": "NOT_STARTED",
        "response_safety": {"status": "NOT_CHECKED"},
        "response_disposition": "NOT_APPLICABLE",
    }

    payload = VOKKIContract.from_response(response, source="contract-test").public_payload()

    assert set(payload) == {
        "contract_version", "request_id", "timestamp", "source", "lifecycle",
        "request_review", "enforcement", "approval", "provider", "response_safety",
        "response_disposition", "message",
    }
    assert payload["approval"]["status"] == "PENDING"
    assert payload["enforcement"]["status"] == "HUMAN_APPROVAL_REQUIRED"
    assert payload["response_safety"]["status"] == "NOT_CHECKED"
    assert payload["response_disposition"] == "NOT_APPLICABLE"
    assert payload["request_id"] == UNKNOWN
    assert payload["source"] == "contract-test"
    assert payload["contract_version"] == "1.0"
    assert payload["timestamp"]
