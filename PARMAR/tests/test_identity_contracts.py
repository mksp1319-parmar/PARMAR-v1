from dataclasses import FrozenInstanceError
from datetime import datetime, timedelta, timezone
from pathlib import Path
import xml.etree.ElementTree as ET
from uuid import UUID, uuid4

import pytest

from PARMAR.identity_contracts import (
    AETHER_ANDROID_FUTURE_AUTH,
    AETHER_DESKTOP,
    PARMAR_HOME,
    VOKKI,
    AccountIdentity,
    AuthenticationContext,
    AuthenticatedPrincipal,
    AuthorizationContext,
    AuthorizationReason,
    CoreSessionContext,
    ProductAudience,
    ProductSessionContext,
    ProfileIdentity,
    ProviderIdentity,
    ResourceAction,
    ResourceDescriptor,
    ResourceGrant,
    ResourcePermission,
    ResourceScope,
    VerifiedProviderIdentity,
    WorkspaceIdentity,
    authorize_resource_access,
    home_identity_context,
    permission_covers_action,
    product_session_context,
    resolve_authenticated_principal,
    resolve_home_identity_context,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def auth_context(now=None):
    current = now or datetime.now(timezone.utc)
    return AuthenticationContext(current, current + timedelta(minutes=5))


def principal(account_identity=None, authentication=None):
    return AuthenticatedPrincipal(
        account_identity or AccountIdentity.generate(),
        authentication or auth_context(),
    )


def personal_resource(owner, *, profile_id=None):
    return ResourceDescriptor(
        resource_id=uuid4(),
        owner_account_identity=owner,
        scope=ResourceScope.PERSONAL,
        profile_id=profile_id,
    )


def test_account_identity_is_immutable_canonical_random_uuid4():
    first = AccountIdentity.generate()
    second = AccountIdentity.generate()

    assert first.value.version == 4
    assert first != second
    assert AccountIdentity.parse(first.serialize()) == first
    with pytest.raises(FrozenInstanceError):
        first.value = uuid4()
    with pytest.raises(ValueError):
        AccountIdentity.parse("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")
    with pytest.raises(ValueError):
        AccountIdentity.parse("provider|subject")
    with pytest.raises(ValueError):
        AccountIdentity(UUID("00000000-0000-1000-8000-000000000001"))


def test_provider_identity_resolves_only_an_explicit_existing_account_binding():
    provider_identity = ProviderIdentity("https://issuer.example", str(uuid4()))
    account_identity = AccountIdentity.generate()

    class Adapter:
        def verify(self, assertion):
            assert assertion == "valid-provider-proof"
            return VerifiedProviderIdentity(provider_identity, auth_context())

    class BindingLookup:
        def __init__(self, result):
            self.result = result
            self.looked_up = []

        def find_existing_account(self, identity):
            self.looked_up.append(identity)
            return self.result

    lookup = BindingLookup(account_identity)
    resolved = resolve_authenticated_principal(Adapter(), lookup, "valid-provider-proof")
    assert resolved is not None
    assert resolved.account_identity == account_identity
    assert resolved.account_identity != AccountIdentity.parse(provider_identity.subject)
    assert lookup.looked_up == [provider_identity]
    provider_subject_account = AccountIdentity.parse(provider_identity.subject)
    assert not authorize_resource_access(
        AuthorizationContext(resolved),
        personal_resource(provider_subject_account),
        ResourceAction.VIEW,
    ).allowed

    unbound = BindingLookup(None)
    assert resolve_authenticated_principal(Adapter(), unbound, "valid-provider-proof") is None
    assert unbound.looked_up == [provider_identity]
    assert not hasattr(unbound, "create_account")
    assert not hasattr(unbound, "link_account")

    email_identity = ProviderIdentity("https://issuer.example", "same@example.test")

    class EmailAdapter:
        def verify(self, _assertion):
            return VerifiedProviderIdentity(email_identity, auth_context())

    email_lookup = BindingLookup(None)
    assert resolve_authenticated_principal(EmailAdapter(), email_lookup, "proof") is None
    assert email_lookup.looked_up == [email_identity]


def test_missing_malformed_and_expired_authentication_context_fails_closed():
    now = datetime.now(timezone.utc)
    account = AccountIdentity.generate()

    class MalformedAdapter:
        def verify(self, _assertion):
            return {"account_id": account.serialize()}

    class BindingLookup:
        def find_existing_account(self, _identity):
            pytest.fail("Malformed adapter output must not reach account lookup")

    assert resolve_authenticated_principal(MalformedAdapter(), BindingLookup(), None) is None
    expired = AuthenticationContext(now - timedelta(minutes=10), now - timedelta(minutes=1))
    assert not authorize_resource_access(
        AuthorizationContext(AuthenticatedPrincipal(account, expired)),
        personal_resource(account),
        ResourceAction.VIEW,
        now=now,
    ).allowed
    assert authorize_resource_access(
        AuthorizationContext(None),
        personal_resource(account),
        ResourceAction.VIEW,
        now=now,
    ).reason is AuthorizationReason.MISSING_CONTEXT
    assert authorize_resource_access(
        AuthorizationContext("client-principal"),
        personal_resource(account),
        ResourceAction.VIEW,
        now=now,
    ).reason is AuthorizationReason.MISSING_CONTEXT


def test_account_profile_and_workspace_identities_are_distinct_values():
    value = uuid4()
    account = AccountIdentity(value)
    profile = ProfileIdentity(value)
    workspace = WorkspaceIdentity(value)

    assert account != profile
    assert account != workspace
    assert profile != workspace


def test_workspace_membership_does_not_grant_personal_or_workspace_resource_access():
    owner = AccountIdentity.generate()
    member = principal()
    workspace = WorkspaceIdentity(uuid4())
    context = AuthorizationContext(
        member,
        workspace_memberships=(workspace,),
    )
    personal = personal_resource(owner)
    workspace_resource = ResourceDescriptor(
        resource_id=uuid4(),
        owner_account_identity=owner,
        scope=ResourceScope.WORKSPACE,
        workspace_id=workspace,
    )

    assert authorize_resource_access(context, personal, ResourceAction.VIEW).reason is (
        AuthorizationReason.NO_EXPLICIT_GRANT
    )
    assert authorize_resource_access(context, workspace_resource, ResourceAction.VIEW).reason is (
        AuthorizationReason.WORKSPACE_POLICY_UNDEFINED
    )


@pytest.mark.parametrize(
    ("permission", "action", "allowed"),
    [
        (ResourcePermission.VIEW, ResourceAction.VIEW, True),
        (ResourcePermission.VIEW, ResourceAction.EDIT, False),
        (ResourcePermission.VIEW, ResourceAction.MANAGE, False),
        (ResourcePermission.EDIT, ResourceAction.VIEW, True),
        (ResourcePermission.EDIT, ResourceAction.EDIT, True),
        (ResourcePermission.EDIT, ResourceAction.MANAGE, False),
        (ResourcePermission.MANAGE, ResourceAction.VIEW, True),
        (ResourcePermission.MANAGE, ResourceAction.EDIT, True),
        (ResourcePermission.MANAGE, ResourceAction.MANAGE, True),
    ],
)
def test_view_edit_manage_levels_are_distinct_but_unapproved_grants_never_authorize(
    permission,
    action,
    allowed,
):
    owner = AccountIdentity.generate()
    grantee = principal()
    resource = personal_resource(owner)
    grant = ResourceGrant(
        resource_id=resource.resource_id,
        owner_account_identity=owner,
        grantee_account_identity=grantee.account_identity,
        granted_by_account_identity=owner,
        permission=permission,
    )

    decision = authorize_resource_access(
        AuthorizationContext(grantee, resource_grants=(grant,)),
        resource,
        action,
    )

    assert permission_covers_action(permission, action) is allowed
    assert not decision.allowed
    assert decision.reason is AuthorizationReason.GRANT_POLICY_UNAVAILABLE


def test_unknown_action_permission_and_missing_ownership_fail_closed():
    owner = AccountIdentity.generate()
    grantee = principal()
    resource = personal_resource(owner)
    malformed_grant = ResourceGrant(
        resource_id=resource.resource_id,
        owner_account_identity=owner,
        grantee_account_identity=grantee.account_identity,
        granted_by_account_identity=owner,
        permission="ADMIN",
    )

    unknown_permission = authorize_resource_access(
        AuthorizationContext(grantee, resource_grants=(malformed_grant,)),
        resource,
        ResourceAction.VIEW,
    )
    assert not unknown_permission.allowed
    assert unknown_permission.reason is AuthorizationReason.UNKNOWN_PERMISSION
    assert not permission_covers_action("ADMIN", ResourceAction.MANAGE)
    unknown_action = authorize_resource_access(
        AuthorizationContext(grantee),
        resource,
        "EXPORT",
    )
    assert not unknown_action.allowed
    assert unknown_action.reason is AuthorizationReason.UNKNOWN_ACTION
    missing_owner = ResourceDescriptor(
        resource_id=uuid4(),
        owner_account_identity=None,
        scope=ResourceScope.PERSONAL,
    )
    assert authorize_resource_access(
        AuthorizationContext(grantee),
        missing_owner,
        ResourceAction.VIEW,
    ).reason is AuthorizationReason.MISSING_OWNERSHIP


def test_owner_access_requires_matching_active_profile_ownership():
    owner = principal()
    profile = ProfileIdentity(uuid4())
    resource = personal_resource(owner.account_identity, profile_id=profile)
    mismatch = AuthorizationContext(
        owner,
        active_profile_id=ProfileIdentity(uuid4()),
        active_profile_owner_account_identity=owner.account_identity,
    )
    missing_owner_evidence = AuthorizationContext(
        owner,
        active_profile_id=profile,
    )
    valid = AuthorizationContext(
        owner,
        active_profile_id=profile,
        active_profile_owner_account_identity=owner.account_identity,
    )

    assert authorize_resource_access(mismatch, resource, ResourceAction.VIEW).reason is (
        AuthorizationReason.PROFILE_CONTEXT_MISMATCH
    )
    assert authorize_resource_access(
        missing_owner_evidence,
        resource,
        ResourceAction.VIEW,
    ).reason is AuthorizationReason.PROFILE_CONTEXT_MISMATCH
    assert authorize_resource_access(valid, resource, ResourceAction.MANAGE).allowed


def test_shared_product_context_preserves_one_account_and_session_without_product_grants():
    account = principal()
    session = CoreSessionContext(
        uuid4(),
        account,
        ProfileIdentity(uuid4()),
        (WorkspaceIdentity(uuid4()),),
    )
    audiences = (
        PARMAR_HOME,
        VOKKI,
        AETHER_DESKTOP,
        AETHER_ANDROID_FUTURE_AUTH,
        ProductAudience("future-product"),
    )
    contexts = [product_session_context(session, audience) for audience in audiences]

    assert all(type(context) is ProductSessionContext for context in contexts)
    assert {context.session.principal.account_identity for context in contexts} == {
        account.account_identity,
    }
    assert {context.session.session_id for context in contexts} == {session.session_id}
    assert [context.audience for context in contexts] == list(audiences)
    assert all(not hasattr(context, "permissions") for context in contexts)
    assert all(not hasattr(context.session, "session_token") for context in contexts)
    other_owner = AccountIdentity.generate()
    decision = authorize_resource_access(
        AuthorizationContext(account),
        personal_resource(other_owner),
        ResourceAction.VIEW,
    )
    assert not decision.allowed


def test_home_resolves_server_side_shared_context_and_rejects_other_product_context():
    account = principal()
    profile = ProfileIdentity(uuid4())
    workspace = WorkspaceIdentity(uuid4())
    session = CoreSessionContext(uuid4(), account, profile, (workspace,))
    home_product_context = product_session_context(session, PARMAR_HOME)
    voki_product_context = product_session_context(session, VOKKI)
    request = {"account_id": AccountIdentity.generate().serialize()}

    class Resolver:
        def __init__(self):
            self.audiences = []

        def resolve(self, received_request, *, audience):
            assert received_request is request
            self.audiences.append(audience)
            return home_product_context

    resolver = Resolver()
    home = resolve_home_identity_context(resolver, request)

    assert resolver.audiences == [PARMAR_HOME]
    assert home is not None
    assert home.account_identity == account.account_identity
    assert home.active_profile_id == profile
    assert home.workspace_memberships == (workspace,)
    assert home.session_id == session.session_id
    assert home_identity_context(voki_product_context) is None

    class NoTrustedSession:
        def resolve(self, _request, *, audience):
            assert audience == PARMAR_HOME
            return None

    assert resolve_home_identity_context(NoTrustedSession(), request) is None


def test_contract_import_and_local_product_context_do_not_require_a_configured_provider():
    account = principal()
    session = CoreSessionContext(uuid4(), account)

    assert product_session_context(session, PARMAR_HOME) is not None
    assert not hasattr(AccountIdentity, "provider")


def test_android_manifest_and_sources_keep_the_offline_only_boundary():
    android_root = REPOSITORY_ROOT / "PARMAR" / "android"
    manifest_path = android_root / "app" / "src" / "main" / "AndroidManifest.xml"
    manifest = ET.parse(manifest_path).getroot()
    android_namespace = "{http://schemas.android.com/apk/res/android}"

    assert not any(
        permission.get(android_namespace + "name") == "android.permission.INTERNET"
        for permission in manifest.findall("uses-permission")
    )
    main_sources = android_root / "app" / "src" / "main"
    prohibited = (
        "android.webkit.WebView",
        "okhttp3.",
        "retrofit2.",
        "java.net.Socket",
        "java.net.HttpURLConnection",
    )
    for source in main_sources.rglob("*.kt"):
        contents = source.read_text(encoding="utf-8")
        assert not any(value in contents for value in prohibited), source
