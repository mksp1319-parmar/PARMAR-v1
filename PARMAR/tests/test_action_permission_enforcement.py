import hashlib
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock
from uuid import uuid4

import pytest

from PARMAR.identity_contracts import (
    AccountIdentity,
    ActionApprovalBinding,
    AuthenticationContext,
    AuthenticatedPrincipal,
    AuthorizationContext,
    AuthorizationReason,
    ResourceAction,
    ResourceDescriptor,
    ResourcePermission,
    ResourceScope,
    authorize_resource_action,
)
from PARMAR.interface.approvals import PendingApprovalStore, approval_binding_for_pending
from PARMAR.safety.enforcement_gate import ActionBoundary, EnforcementState


def _authorization(owner: AccountIdentity, *, actor: AccountIdentity | None = None):
    now = datetime.now(timezone.utc)
    principal = AuthenticatedPrincipal(
        actor or owner,
        AuthenticationContext(now - timedelta(seconds=1), now + timedelta(minutes=5)),
    )
    resource = ResourceDescriptor(
        resource_id=uuid4(),
        owner_account_identity=owner,
        scope=ResourceScope.PERSONAL,
    )
    return AuthorizationContext(principal), resource


def _enforcement(*, approval_required=True):
    return {
        "status": EnforcementState.READY_FOR_ACTION,
        "execution_allowed": True,
        "human_approval_required": approval_required,
        "decision_id": str(uuid4()),
    }


def _action_binding(context, resource, action, permission_scope):
    return ActionApprovalBinding(
        actor_id=context.principal.account_identity.value,
        action=action.value,
        resource_id=str(resource.resource_id),
        resource_scope=resource.scope.value,
        permission_scope=permission_scope.value,
        scope_fingerprint=hashlib.sha256(b"{}").hexdigest(),
    )


def test_resource_action_denies_scope_mismatch_and_unowned_resources():
    owner = AccountIdentity.generate()
    context, resource = _authorization(owner)
    mismatch = authorize_resource_action(
        context,
        resource,
        ResourceAction.EDIT,
        ResourcePermission.VIEW,
    )
    assert mismatch.allowed is False
    assert mismatch.reason is AuthorizationReason.PERMISSION_SCOPE_MISMATCH

    other_context, _ = _authorization(owner, actor=AccountIdentity.generate())
    denied = authorize_resource_action(
        other_context,
        resource,
        ResourceAction.EDIT,
        ResourcePermission.EDIT,
    )
    assert denied.allowed is False
    assert denied.reason is AuthorizationReason.NO_EXPLICIT_GRANT


@pytest.mark.parametrize(
    ("authorization_allowed", "approval_valid", "expected_reason"),
    [
        (False, True, "AUTHORIZATION_DENIED"),
        (True, False, "APPROVAL_INVALID"),
    ],
)
def test_denied_action_never_invokes_mocked_effect(
    authorization_allowed,
    approval_valid,
    expected_reason,
):
    owner = AccountIdentity.generate()
    context, resource = _authorization(owner)
    if not authorization_allowed:
        other_context, _ = _authorization(owner, actor=AccountIdentity.generate())
        context = other_context

    effect = Mock()
    binding = _action_binding(
        context,
        resource,
        ResourceAction.EDIT,
        ResourcePermission.EDIT,
    )
    result = ActionBoundary().evaluate_authorized_action(
        _enforcement(),
        context,
        resource,
        ResourceAction.EDIT,
        ResourcePermission.EDIT,
        approved_binding=binding if approval_valid else None,
        expected_binding=binding if approval_valid else None,
    )
    if result["execution_allowed"] is True:
        effect()

    assert result["execution_allowed"] is False
    assert result["reason_code"] == expected_reason
    effect.assert_not_called()


def test_permission_scope_denial_never_invokes_mocked_effect():
    context, resource = _authorization(AccountIdentity.generate())
    mismatched_scope = ResourcePermission.VIEW
    binding = _action_binding(
        context,
        resource,
        ResourceAction.EDIT,
        mismatched_scope,
    )
    effect = Mock()

    result = ActionBoundary().evaluate_authorized_action(
        _enforcement(),
        context,
        resource,
        ResourceAction.EDIT,
        mismatched_scope,
        approved_binding=binding,
        expected_binding=binding,
    )
    if result["execution_allowed"] is True:
        effect()

    assert result["execution_allowed"] is False
    assert result["reason_code"] == "AUTHORIZATION_DENIED"
    assert result["authorization_reason"] == AuthorizationReason.PERMISSION_SCOPE_MISMATCH.value
    effect.assert_not_called()


def test_approval_is_bound_before_mocked_effect_and_cannot_be_replayed():
    store = PendingApprovalStore()
    owner = AccountIdentity.generate()
    actor_id, session_id = owner.value, uuid4()
    decision_id = str(uuid4())
    owner_context, resource = _authorization(owner)
    binding = _action_binding(
        owner_context,
        resource,
        ResourceAction.EDIT,
        ResourcePermission.EDIT,
    )
    token = store.create(
        "mock action",
        {
            "request": "mock action",
            "enforcement": {"decision_id": decision_id},
        },
        None,
        {"enforcement": {"decision_id": decision_id}},
        user_id=actor_id,
        session_id=session_id,
        decision_id=decision_id,
        approval_binding=binding,
    )
    mismatched_binding = replace(binding, permission_scope="parmar:other:scope")
    effect = Mock()

    pending, state = store.consume(
        token,
        user_id=actor_id,
        session_id=session_id,
        decision="APPROVE",
        approval_binding=mismatched_binding,
    )
    denied = ActionBoundary().evaluate_authorized_action(
        _enforcement(),
        owner_context,
        resource,
        ResourceAction.EDIT,
        ResourcePermission.EDIT,
        approved_binding=pending.approval_binding if pending is not None else None,
        expected_binding=binding,
    )
    if denied["execution_allowed"] is True:
        effect()
    assert pending is None
    assert state == "BINDING_MISMATCH"
    assert denied["execution_allowed"] is False
    effect.assert_not_called()

    pending, state = store.consume(
        token,
        user_id=actor_id,
        session_id=session_id,
        decision="APPROVE",
        approval_binding=binding,
    )
    assert pending is not None
    allowed = ActionBoundary().evaluate_authorized_action(
        _enforcement(),
        owner_context,
        resource,
        ResourceAction.EDIT,
        ResourcePermission.EDIT,
        approved_binding=pending.approval_binding,
        expected_binding=binding,
    )
    if allowed["execution_allowed"] is True:
        effect()
    assert state == "OK"
    assert allowed["execution_allowed"] is True
    effect.assert_called_once_with()

    replay, replay_state = store.consume(
        token,
        user_id=actor_id,
        session_id=session_id,
        decision="APPROVE",
        approval_binding=binding,
    )
    assert replay is None
    assert replay_state == "NOT_FOUND"


@pytest.mark.parametrize(
    "field",
    [
        "actor_id",
        "action",
        "resource_id",
        "resource_scope",
        "permission_scope",
        "scope_fingerprint",
    ],
)
def test_approval_binding_mismatches_are_rejected_without_consumption(field):
    store = PendingApprovalStore()
    actor_id, session_id = uuid4(), uuid4()
    decision_id = str(uuid4())
    binding = approval_binding_for_pending(actor_id, decision_id, None)
    token = store.create(
        "mock action",
        {
            "request": "mock action",
            "enforcement": {"decision_id": decision_id},
        },
        None,
        {"enforcement": {"decision_id": decision_id}},
        user_id=actor_id,
        session_id=session_id,
        decision_id=decision_id,
        approval_binding=binding,
    )
    changed_value = {
        "actor_id": uuid4(),
        "action": "different.action",
        "resource_id": str(uuid4()),
        "resource_scope": "different-resource",
        "permission_scope": "different:permission",
        "scope_fingerprint": "0" * 64,
    }[field]

    pending, state = store.consume(
        token,
        user_id=actor_id,
        session_id=session_id,
        decision="APPROVE",
        approval_binding=replace(binding, **{field: changed_value}),
    )

    assert pending is None
    assert state == "BINDING_MISMATCH"
    assert store.inspect(token, user_id=actor_id, session_id=session_id) is not None


def test_missing_expected_approval_binding_is_denied_without_consumption():
    store = PendingApprovalStore()
    actor_id, session_id = uuid4(), uuid4()
    decision_id = str(uuid4())
    token = store.create(
        "mock action",
        {
            "request": "mock action",
            "enforcement": {"decision_id": decision_id},
        },
        None,
        {"enforcement": {"decision_id": decision_id}},
        user_id=actor_id,
        session_id=session_id,
        decision_id=decision_id,
        approval_binding=approval_binding_for_pending(actor_id, decision_id, None),
    )

    pending, state = store.consume(
        token,
        user_id=actor_id,
        session_id=session_id,
        decision="APPROVE",
    )

    assert pending is None
    assert state == "BINDING_MISSING"
    assert store.inspect(token, user_id=actor_id, session_id=session_id) is not None


def test_action_boundary_requires_exact_booleans_and_approval_state():
    boundary = ActionBoundary()
    assert boundary.can_execute({"execution_allowed": "false"}) is False
    owner = AccountIdentity.generate()
    context, resource = _authorization(owner)
    binding = _action_binding(
        context,
        resource,
        ResourceAction.VIEW,
        ResourcePermission.VIEW,
    )
    assert boundary.evaluate_authorized_action(
        _enforcement(approval_required=False),
        object(),
        resource,
        ResourceAction.VIEW,
        ResourcePermission.VIEW,
        approved_binding=None,
        expected_binding=None,
    )["execution_allowed"] is False
    assert boundary.evaluate_authorized_action(
        _enforcement(approval_required=False),
        context,
        resource,
        ResourceAction.VIEW,
        ResourcePermission.VIEW,
        approved_binding=binding,
        expected_binding=binding,
    )["reason_code"] == "UNEXPECTED_APPROVAL"
