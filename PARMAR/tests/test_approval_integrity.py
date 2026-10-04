import io
import json
from copy import deepcopy
from dataclasses import replace
from hashlib import sha256
from types import SimpleNamespace
from uuid import uuid4

import pytest

from PARMAR.audit.decision_logs import DecisionLogManager
from PARMAR.chat.context import ChatContext
from PARMAR.chat.models import ChatResponse
from PARMAR.chat.router import ChatRouter
from PARMAR.chat.service import ChatService
from PARMAR.identity import LocalDemoPrincipalResolver
from PARMAR.interface import futuristic_app
from PARMAR.interface.approvals import PendingApprovalStore
from PARMAR.interface.dashboard import TerminalDashboard
from PARMAR.interface.ui_adapter import PARMARUIAdapter
from PARMAR.safety.enforcement_gate import CentralEnforcementGate
from PARMAR.sessions import (
    InMemorySessionRepository,
    SESSION_COOKIE_NAME,
    SessionManager,
    SessionPolicy,
)

_DEFAULT_SESSION = object()
_TEST_SESSION = None
_TEST_SESSION_MANAGER = None


@pytest.fixture(autouse=True)
def isolate_audit_log(monkeypatch, tmp_path):
    global _TEST_SESSION, _TEST_SESSION_MANAGER
    original_init = DecisionLogManager.__init__

    def isolated_init(self, log_path=None):
        original_init(self, log_path or str(tmp_path / "approval-audit.jsonl"))

    monkeypatch.setattr(DecisionLogManager, "__init__", isolated_init)
    monkeypatch.setattr(futuristic_app, "PENDING_APPROVALS", PendingApprovalStore())
    manager = SessionManager(
        InMemorySessionRepository(),
        SessionPolicy(idle_timeout_seconds=600, absolute_timeout_seconds=1800),
    )
    _TEST_SESSION = manager.create_authenticated_session(uuid4(), "approval-test")
    _TEST_SESSION_MANAGER = manager
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", manager)
    monkeypatch.setattr(futuristic_app, "PRINCIPAL_RESOLVER", LocalDemoPrincipalResolver())


def post(path, payload, *, session=_DEFAULT_SESSION):
    if session is _DEFAULT_SESSION:
        session = _TEST_SESSION
    body = json.dumps(payload).encode("utf-8")
    response = {}
    headers = {"Content-Length": str(len(body))}
    if session is not None:
        headers["Cookie"] = f"{SESSION_COOKIE_NAME}={session.session_token}"
        csrf_token = _TEST_SESSION_MANAGER.csrf_token(session.session.session_id)
        if csrf_token is not None:
            headers["X-CSRF-Token"] = csrf_token
    request = SimpleNamespace(
        path=path,
        headers=headers,
        rfile=io.BytesIO(body),
        _send_json=lambda status, result: response.update(status=status, result=result),
        _send_json_with_headers=lambda status, result, extra: response.update(
            status=status, result=result, headers=extra,
        ),
        send_error=lambda status, message: response.update(status=status, result={"message": message}),
    )
    futuristic_app.PARMARRequestHandler.do_POST(request)
    return response


def create_pending_review(request="Purchase a $500 software license"):
    response = post("/api/analyze", {"request": request})
    assert response["status"] == 200
    assert response["result"]["status"] == "APPROVAL_REQUIRED"
    assert response["result"]["approval_id"]
    return response["result"]


def test_approval_is_bound_to_original_request_and_consumed_once():
    pending = create_pending_review()

    altered = post("/api/approval", {
        "approval_id": pending["approval_id"],
        "request": "Purchase a $600 software license",
        "decision": "APPROVE",
    })
    assert altered["status"] == 409

    approved = post("/api/approval", {
        "approval_id": pending["approval_id"],
        "decision": "APPROVE",
    })
    assert approved["status"] == 200
    assert approved["result"]["status"] == "APPROVED"
    assert approved["result"]["enforcement"]["execution_allowed"] is True
    assert "approval_id" not in approved["result"]

    replay = post("/api/approval", {
        "approval_id": pending["approval_id"],
        "decision": "REJECT",
    })
    assert replay["status"] == 410
    assert replay["result"]["status"] == "APPROVAL_INVALID"


def test_chat_approval_creates_the_same_kind_of_owned_server_side_pending_review(monkeypatch):
    message = "Transfer $500 from the department budget to buy a laptop."
    calls = _install_counting_chat_provider(monkeypatch)
    response = post("/api/chat", {"message": message})

    assert response["status"] == 200
    result = response["result"]
    assert result["status"] == "APPROVAL_REQUIRED"
    assert result["approval_id"]
    assert result["provider_status"] == "NOT_STARTED"
    assert result["response_safety"]["status"] == "NOT_CHECKED"
    assert result["response_disposition"] == "NOT_APPLICABLE"
    assert result["voki_contract"]["approval"]["record_available"] == "AVAILABLE"
    assert calls == []

    pending = futuristic_app.PENDING_APPROVALS.inspect(
        result["approval_id"],
        user_id=_TEST_SESSION.session.user_id,
        session_id=_TEST_SESSION.session.session_id,
    )
    assert pending is not None
    assert pending.request_text == message
    assert pending.decision_id == pending.summary["enforcement"]["decision_id"]
    assert pending.response["analysis"]["request"] == message
    assert "approval_id" not in pending.response
    assert pending.response["voki_contract"]["approval"]["record_available"] == "AVAILABLE"

    decided = post("/api/approval", {
        "approval_id": result["approval_id"],
        "decision": "APPROVE",
    })
    assert decided["status"] == 200
    assert decided["result"]["voki_contract"]["approval"]["status"] == "APPROVED"
    assert decided["result"]["voki_contract"]["request_review"]["status"] == "APPROVAL_REQUIRED"
    assert decided["result"]["voki_contract"]["provider"]["status"] == "COMPLETED"


def _install_counting_chat_provider(monkeypatch, *, content="The reviewed proposal can proceed.", error=None):
    calls = []

    class Provider:
        name = "approval-continuation-test"
        locality = "local"

        def generate(self, prompt, context=None):
            calls.append((prompt, context))
            if error is not None:
                raise error
            return ChatResponse(provider=self.name, content=content, safe=False)

    provider = Provider()

    def create_service(external_authorization=None):
        return ChatService(
            router=ChatRouter(provider=provider),
            external_authorization=external_authorization,
        )

    monkeypatch.setattr(futuristic_app, "ChatService", create_service)
    return calls


def _start_chat_approval(message="Purchase a $500 software license"):
    response = post("/api/chat", {
        "message": message,
        "context": {"recent_messages": [
            {"role": "user", "content": "I am comparing options."},
        ]},
    })
    assert response["status"] == 200
    assert response["result"]["status"] == "APPROVAL_REQUIRED"
    return response["result"]


def test_approved_chat_uses_original_review_calls_provider_once_and_releases_pass(monkeypatch):
    calls = _install_counting_chat_provider(monkeypatch)
    pending_result = _start_chat_approval()

    assert calls == []
    approved = post("/api/approval", {
        "approval_id": pending_result["approval_id"],
        "decision": "APPROVE",
        "request": "A client-supplied replacement request",
    })

    assert approved["status"] == 409
    assert calls == []

    approved = post("/api/approval", {
        "approval_id": pending_result["approval_id"],
        "decision": "APPROVE",
    })

    assert approved["status"] == 200
    result = approved["result"]
    assert len(calls) == 1
    assert calls[0][0] == "Purchase a $500 software license"
    assert calls[0][1].language == "en"
    assert calls[0][1].approval_required is True
    assert calls[0][1].approval_state == "APPROVED"
    assert result["analysis"]["request"] == "Purchase a $500 software license"
    assert result["voki_contract"]["request_review"]["status"] == "APPROVAL_REQUIRED"
    assert result["voki_contract"]["approval"]["status"] == "APPROVED"
    assert result["voki_contract"]["enforcement"]["status"] == "READY_FOR_ACTION"
    assert result["voki_contract"]["provider"]["status"] == "COMPLETED"
    assert result["voki_contract"]["response_safety"]["status"] == "PASS"
    assert result["voki_contract"]["response_disposition"] == "RELEASED"
    assert result["voki_contract"]["lifecycle"]["state"] == "RELEASED"

    replay = post("/api/approval", {
        "approval_id": pending_result["approval_id"],
        "decision": "APPROVE",
    })
    assert replay["status"] == 410
    assert calls and len(calls) == 1


@pytest.mark.parametrize("failure", ["invalid", "expired", "wrong_owner", "wrong_session"])
def test_invalid_approval_never_calls_chat_provider(monkeypatch, failure):
    calls = _install_counting_chat_provider(monkeypatch)
    pending_result = _start_chat_approval()
    payload = {"approval_id": pending_result["approval_id"], "decision": "APPROVE"}

    if failure == "invalid":
        payload["approval_id"] = "not-a-server-generated-token"
        response = post("/api/approval", payload)
    elif failure == "expired":
        token_hash = sha256(pending_result["approval_id"].encode("ascii")).hexdigest()
        pending = futuristic_app.PENDING_APPROVALS._pending[token_hash]
        futuristic_app.PENDING_APPROVALS._pending[token_hash] = replace(
            pending,
            expires_at=0,
        )
        response = post("/api/approval", payload)
    elif failure == "wrong_owner":
        other = _TEST_SESSION_MANAGER.create_authenticated_session(uuid4(), "approval-test")
        response = post("/api/approval", payload, session=other)
    else:
        other = _TEST_SESSION_MANAGER.create_authenticated_session(
            _TEST_SESSION.session.user_id,
            "approval-test",
        )
        response = post("/api/approval", payload, session=other)

    assert response["status"] in {410, 403}
    assert calls == []


def test_approval_rejects_a_pending_record_whose_review_decision_binding_changed(monkeypatch):
    calls = _install_counting_chat_provider(monkeypatch)
    pending_result = _start_chat_approval()
    token_hash = sha256(pending_result["approval_id"].encode("ascii")).hexdigest()
    pending = futuristic_app.PENDING_APPROVALS._pending[token_hash]
    changed_response = deepcopy(pending.response)
    changed_response["analysis"]["enforcement"]["decision_id"] = "different-review"
    futuristic_app.PENDING_APPROVALS._pending[token_hash] = replace(
        pending,
        response=changed_response,
    )

    result = post("/api/approval", {
        "approval_id": pending_result["approval_id"],
        "decision": "APPROVE",
    })

    assert result["status"] == 410
    assert calls == []


def test_rejected_enforcement_after_approval_never_calls_chat_provider(monkeypatch):
    calls = _install_counting_chat_provider(monkeypatch)
    pending_result = _start_chat_approval()
    original_evaluate = CentralEnforcementGate.evaluate_decision
    evaluations = 0

    def block_on_approval(self, *args, **kwargs):
        nonlocal evaluations
        evaluations += 1
        if evaluations == 1:
            return {
                "status": "BLOCKED",
                "execution_allowed": False,
                "decision_id": "blocked-after-review",
                "reason": "Gate denied after approval.",
            }
        return original_evaluate(self, *args, **kwargs)

    monkeypatch.setattr(CentralEnforcementGate, "evaluate_decision", block_on_approval)
    result = post("/api/approval", {
        "approval_id": pending_result["approval_id"],
        "decision": "APPROVE",
    })

    assert result["status"] == 200
    assert result["result"]["enforcement"]["status"] == "BLOCKED"
    assert result["result"]["action_boundary"]["execution_allowed"] is False
    assert calls == []


def test_approved_chat_provider_failure_has_distinct_failure_contract(monkeypatch):
    calls = _install_counting_chat_provider(monkeypatch, error=RuntimeError("provider offline"))
    pending_result = _start_chat_approval()

    result = post("/api/approval", {
        "approval_id": pending_result["approval_id"],
        "decision": "APPROVE",
    })

    contract = result["result"]["voki_contract"]
    assert result["status"] == 200
    assert len(calls) == 1
    assert contract["provider"]["status"] == "FAILED"
    assert contract["lifecycle"]["state"] == "PROVIDER_FAILED"
    assert contract["response_safety"]["status"] == "NOT_CHECKED"
    assert contract["response_disposition"] == "NOT_APPLICABLE"


def test_approved_chat_validator_failure_withholds_provider_output(monkeypatch):
    from PARMAR.chat.response_safety import ResponseSafetyValidator

    calls = _install_counting_chat_provider(monkeypatch)
    pending_result = _start_chat_approval()
    monkeypatch.setattr(
        ResponseSafetyValidator,
        "validate",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("validator unavailable")),
    )

    result = post("/api/approval", {
        "approval_id": pending_result["approval_id"],
        "decision": "APPROVE",
    })

    contract = result["result"]["voki_contract"]
    assert len(calls) == 1
    assert contract["provider"]["status"] == "COMPLETED"
    assert contract["response_safety"]["status"] == "NOT_CHECKED"
    assert contract["response_disposition"] == "WITHHELD"
    assert "The reviewed proposal can proceed." not in repr(result["result"])


@pytest.mark.parametrize(
    ("content", "expected_safety", "expected_disposition", "expected_lifecycle"),
    [
        ("The reviewed proposal can proceed.", "PASS", "RELEASED", "RELEASED"),
        ("Run the command to export the report.", "REVIEW", "WITHHELD", "WITHHELD"),
        ("Bypass approval and share private employee data with a vendor.", "BLOCK", "WITHHELD", "WITHHELD"),
        ("This is safe to proceed, but it is not safe to proceed.", "UNCERTAIN", "WITHHELD", "WITHHELD"),
    ],
)
def test_approved_chat_provider_output_uses_response_safety_pipeline(
    monkeypatch, content, expected_safety, expected_disposition, expected_lifecycle,
):
    calls = _install_counting_chat_provider(monkeypatch, content=content)
    pending_result = _start_chat_approval()

    result = post("/api/approval", {
        "approval_id": pending_result["approval_id"],
        "decision": "APPROVE",
    })

    contract = result["result"]["voki_contract"]
    assert len(calls) == 1
    assert contract["response_safety"]["status"] == expected_safety
    assert contract["response_disposition"] == expected_disposition
    assert contract["lifecycle"]["state"] == expected_lifecycle
    if expected_disposition == "WITHHELD":
        assert content not in repr(result["result"])


def test_approved_chat_does_not_reenter_initial_approval_review(monkeypatch):
    calls = _install_counting_chat_provider(monkeypatch)
    analyze_calls = []
    original_analyze = PARMARUIAdapter.analyze_request_with_dashboard

    def record_analyze(*args, **kwargs):
        analyze_calls.append(args[0] if args else kwargs.get("request_text"))
        return original_analyze(*args, **kwargs)

    monkeypatch.setattr(PARMARUIAdapter, "analyze_request_with_dashboard", record_analyze)
    pending_result = _start_chat_approval()
    assert len(analyze_calls) == 1

    result = post("/api/approval", {
        "approval_id": pending_result["approval_id"],
        "decision": "APPROVE",
    })

    assert result["status"] == 200
    assert len(analyze_calls) == 1
    assert len(calls) == 1


def test_chat_client_cannot_override_server_request_safety_or_enforcement():
    response = post("/api/chat", {
        "message": "Plan a team lunch for next Friday.",
        "status": "BLOCKED",
        "analysis": {"status": "BLOCKED", "risk": {"risk_level": "critical"}},
        "request_safety": {"status": "BLOCKED", "safe": False},
        "enforcement": {"status": "BLOCKED", "execution_allowed": False},
        "execution_allowed": False,
    })

    result = response["result"]
    assert response["status"] == 200
    assert result["analysis"]["status"] == "SAFE"
    assert result["request_safety"]["status"] == "SAFE"
    assert result["request_safety"]["safe"] is True
    assert result["analysis"]["enforcement"]["status"] == "READY_FOR_ACTION"
    assert result["voki_contract"]["request_review"]["status"] == "SAFE"
    assert result["voki_contract"]["enforcement"]["status"] == "READY_FOR_ACTION"


def test_human_decision_reexecutes_central_enforcement_gate(monkeypatch):
    calls = []
    original_evaluate = CentralEnforcementGate.evaluate_decision

    def record_gate_call(self, *args, **kwargs):
        calls.append((args, kwargs))
        return original_evaluate(self, *args, **kwargs)

    monkeypatch.setattr(CentralEnforcementGate, "evaluate_decision", record_gate_call)
    pending = create_pending_review()
    assert len(calls) == 1

    approved = post("/api/approval", {
        "approval_id": pending["approval_id"],
        "decision": "APPROVE",
    })

    assert approved["status"] == 200
    assert len(calls) == 2
    assert approved["result"]["voki_contract"]["approval"]["status"] == "APPROVED"
    assert approved["result"]["voki_contract"]["enforcement"]["status"] == "READY_FOR_ACTION"
    assert approved["result"]["voki_contract"]["provider"]["status"] == "NOT_STARTED"


def test_approval_for_one_review_cannot_be_used_for_another_request():
    pending = create_pending_review("Purchase a $500 software license")

    response = post("/api/approval", {
        "approval_id": pending["approval_id"],
        "request": "Purchase a $5000 software license",
        "decision": "APPROVE",
    })

    assert response["status"] == 409
    assert response["result"]["status"] == "APPROVAL_REQUEST_MISMATCH"


def test_caller_supplied_altered_decision_cannot_replace_pending_review():
    pending = create_pending_review()

    response = post("/api/approval", {
        "approval_id": pending["approval_id"],
        "decision": "APPROVE",
        "request": pending["request"],
        "risk": {"risk_level": "low"},
        "decision_record": {"requires_human_approval": False},
        "privacy_result": {"allow_execution": True},
        "autonomy_result": {"allow_execution": True},
        "emergency_result": {"allow_execution": True},
    })

    assert response["status"] == 200
    assert response["result"]["risk"] == pending["risk"]
    assert response["result"]["decision"]["requires_human_approval"] is True
    assert response["result"]["decision"]["human_approval_status"] == "APPROVED"


def test_invalid_decision_does_not_consume_pending_approval():
    pending = create_pending_review()

    invalid = post("/api/approval", {
        "approval_id": pending["approval_id"],
        "decision": "APPROVE ANYWAY",
    })
    assert invalid["status"] == 400

    still_pending = post("/api/approval", {
        "approval_id": pending["approval_id"],
        "decision": "REJECT",
    })
    assert still_pending["status"] == 200
    assert still_pending["result"]["status"] == "BLOCKED"


def test_missing_and_expired_approval_ids_are_denied():
    missing = post("/api/approval", {"decision": "APPROVE"})
    assert missing["status"] == 410
    assert missing["result"]["status"] == "APPROVAL_INVALID"

    store = PendingApprovalStore(ttl_seconds=1)
    token = store.create(
        "request",
        {},
        None,
        {},
        user_id=_TEST_SESSION.session.user_id,
        session_id=_TEST_SESSION.session.session_id,
        decision_id="request-decision",
        now=0,
    )
    monkeypatch_store = futuristic_app.PENDING_APPROVALS
    expired_token = monkeypatch_store.create(
        "expired",
        {},
        None,
        {},
        user_id=_TEST_SESSION.session.user_id,
        session_id=_TEST_SESSION.session.session_id,
        decision_id="expired-decision",
        now=0,
    )
    assert store.consume(
        token,
        user_id=_TEST_SESSION.session.user_id,
        session_id=_TEST_SESSION.session.session_id,
        now=2,
    )[1] == "EXPIRED"

    expired = post("/api/approval", {
        "approval_id": expired_token,
        "decision": "APPROVE",
    })
    assert expired["status"] == 410
    assert expired["result"]["status"] == "APPROVAL_INVALID"


def test_adapter_text_alone_cannot_authorize_a_decision():
    response = PARMARUIAdapter.process_human_decision(
        "Purchase a $500 software license",
        "APPROVE",
    )

    assert response["status"] == "APPROVAL_REQUIRED"
    assert response["approval_error"] == "PENDING_REVIEW_REQUIRED"
    assert response["enforcement"]["execution_allowed"] is False


def test_pending_approval_applies_to_stored_review_not_new_text():
    original_text = "Purchase a $500 software license"
    initial, dashboard, summary = PARMARUIAdapter.analyze_request_with_dashboard(original_text)
    pending = futuristic_app.PENDING_APPROVALS.create(
        original_text,
        initial,
        dashboard,
        summary,
        user_id=_TEST_SESSION.session.user_id,
        session_id=_TEST_SESSION.session.session_id,
        decision_id=summary["enforcement"]["decision_id"],
    )
    record = futuristic_app.PENDING_APPROVALS.inspect(
        pending,
        user_id=_TEST_SESSION.session.user_id,
        session_id=_TEST_SESSION.session.session_id,
    )
    assert record is not None

    result = PARMARUIAdapter.apply_pending_human_decision(
        record.response.copy(),
        record.dashboard,
        record.summary,
        "REJECT",
    )

    assert result["request"] == original_text
    assert result["status"] == "BLOCKED"
    assert result["enforcement"]["execution_allowed"] is False


def test_approval_token_alone_and_unauthenticated_caller_cannot_redeem():
    pending = create_pending_review()
    payload = {"approval_id": pending["approval_id"], "decision": "APPROVE"}

    response = post("/api/approval", payload, session=None)

    assert response["status"] == 403
    still_pending = futuristic_app.PENDING_APPROVALS.inspect(
        pending["approval_id"],
        user_id=_TEST_SESSION.session.user_id,
        session_id=_TEST_SESSION.session.session_id,
    )
    assert still_pending is not None


def test_approval_rejects_wrong_user_and_wrong_session():
    pending = create_pending_review()
    other_user_session = _TEST_SESSION_MANAGER.create_authenticated_session(
        uuid4(), "approval-test",
    )
    same_user_other_session = _TEST_SESSION_MANAGER.create_authenticated_session(
        _TEST_SESSION.session.user_id, "approval-test",
    )
    payload = {"approval_id": pending["approval_id"], "decision": "APPROVE"}

    wrong_user = post("/api/approval", payload, session=other_user_session)
    wrong_session = post("/api/approval", payload, session=same_user_other_session)

    assert wrong_user["status"] == 410
    assert wrong_session["status"] == 410


def test_revoked_session_cannot_redeem_its_pending_approval():
    pending = create_pending_review()
    _TEST_SESSION_MANAGER.revoke(_TEST_SESSION.session.session_id)

    response = post("/api/approval", {
        "approval_id": pending["approval_id"],
        "decision": "APPROVE",
    })

    assert response["status"] == 403


def test_unbound_legacy_approval_is_not_inspectable_or_consumable():
    pending = create_pending_review()
    token = pending["approval_id"]
    token_hash = sha256(token.encode("ascii")).hexdigest()
    stored = futuristic_app.PENDING_APPROVALS._pending[token_hash]
    futuristic_app.PENDING_APPROVALS._pending[token_hash] = replace(
        stored,
        user_id=None,
        session_id=None,
    )

    assert futuristic_app.PENDING_APPROVALS.inspect(
        token,
        user_id=_TEST_SESSION.session.user_id,
        session_id=_TEST_SESSION.session.session_id,
    ) is None
    consumed, state = futuristic_app.PENDING_APPROVALS.consume(
        token,
        user_id=_TEST_SESSION.session.user_id,
        session_id=_TEST_SESSION.session.session_id,
    )
    assert consumed is None
    assert state == "OWNER_MISMATCH"


def test_concurrent_approval_consumption_succeeds_only_once():
    from concurrent.futures import ThreadPoolExecutor

    pending = create_pending_review()
    token = pending["approval_id"]

    def consume():
        return futuristic_app.PENDING_APPROVALS.consume(
            token,
            user_id=_TEST_SESSION.session.user_id,
            session_id=_TEST_SESSION.session.session_id,
        )

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(lambda _index: consume(), range(8)))

    assert sum(record is not None for record, _state in results) == 1


def test_missing_safety_signal_never_authorizes_approval():
    valid = {"allow_execution": True}
    for missing_name in ("privacy_result", "autonomy_result", "emergency_result"):
        values = {
            "privacy_result": valid,
            "autonomy_result": valid,
            "emergency_result": valid,
        }
        values[missing_name] = None
        outcome = CentralEnforcementGate().evaluate_decision(
            {"risk": {"risk_level": "high"}, "requires_human_approval": True},
            human_approval="APPROVED",
            **values,
        )
        assert outcome["execution_allowed"] is False
        assert outcome["status"] == "BLOCKED"
