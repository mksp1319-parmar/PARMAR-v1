import io
import json
from types import SimpleNamespace
from dataclasses import replace
from hashlib import sha256
from uuid import uuid4

import pytest

from PARMAR.audit.decision_logs import DecisionLogManager
from PARMAR.interface import futuristic_app
from PARMAR.interface.approvals import PendingApprovalStore
from PARMAR.interface.dashboard import TerminalDashboard
from PARMAR.interface.ui_adapter import PARMARUIAdapter
from PARMAR.safety.enforcement_gate import CentralEnforcementGate
from PARMAR.identity import LocalDemoPrincipalResolver
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
