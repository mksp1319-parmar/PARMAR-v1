"""Provider-neutral identity and authorization contracts for PARMAR Core.

No authentication adapter or account-binding store is configured. These
contracts do not issue credentials or connect legacy development user IDs to
PARMAR accounts.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Protocol
from uuid import RFC_4122, UUID, uuid4


_PRODUCT_ID_PATTERN = re.compile(r"[a-z][a-z0-9-]{0,62}\Z")


def _utc_datetime(value: object, label: str) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{label} must be a timezone-aware datetime.")
    return value.astimezone(timezone.utc)


def _now_utc(value: datetime | None) -> datetime:
    return _utc_datetime(value if value is not None else datetime.now(timezone.utc), "now")


@dataclass(frozen=True, slots=True)
class AccountIdentity:
    """Immutable random PARMAR account identifier, distinct from provider IDs."""

    value: UUID

    def __post_init__(self) -> None:
        if (
            type(self.value) is not UUID
            or self.value.version != 4
            or self.value.variant != RFC_4122
        ):
            raise ValueError("PARMAR account identity must be an RFC 4122 UUIDv4.")

    @classmethod
    def generate(cls) -> AccountIdentity:
        return cls(uuid4())

    @classmethod
    def parse(cls, serialized: object) -> AccountIdentity:
        """Parse canonical trusted storage data; parsing is not authentication proof."""
        if not isinstance(serialized, str):
            raise ValueError("Serialized account identity must be a canonical UUID string.")
        try:
            parsed = UUID(serialized)
        except ValueError as error:
            raise ValueError("Serialized account identity must be a canonical UUID string.") from error
        if str(parsed) != serialized:
            raise ValueError("Serialized account identity must use canonical lowercase UUID form.")
        return cls(parsed)

    def serialize(self) -> str:
        return str(self.value)


@dataclass(frozen=True, slots=True)
class ProfileIdentity:
    """Typed profile identifier; never interchangeable with an account ID."""

    value: UUID

    def __post_init__(self) -> None:
        if type(self.value) is not UUID:
            raise ValueError("Profile identity must contain a UUID.")


@dataclass(frozen=True, slots=True)
class WorkspaceIdentity:
    """Typed workspace identifier; never interchangeable with an account ID."""

    value: UUID

    def __post_init__(self) -> None:
        if type(self.value) is not UUID:
            raise ValueError("Workspace identity must contain a UUID.")


@dataclass(frozen=True, slots=True)
class ProviderIdentity:
    """External identity key; its issuer/subject pair is not an account ID."""

    issuer: str
    subject: str

    def __post_init__(self) -> None:
        for label, value, limit in (
            ("issuer", self.issuer, 2048),
            ("subject", self.subject, 1024),
        ):
            if (
                not isinstance(value, str)
                or not value
                or value != value.strip()
                or len(value) > limit
            ):
                raise ValueError(f"Provider identity {label} is invalid.")


@dataclass(frozen=True, slots=True)
class AuthenticationContext:
    """Time-bounded result of trusted authentication, without provider choice."""

    authenticated_at: datetime
    expires_at: datetime

    def __post_init__(self) -> None:
        authenticated_at = _utc_datetime(self.authenticated_at, "authenticated_at")
        expires_at = _utc_datetime(self.expires_at, "expires_at")
        if expires_at <= authenticated_at:
            raise ValueError("Authentication expiry must follow authentication time.")
        object.__setattr__(self, "authenticated_at", authenticated_at)
        object.__setattr__(self, "expires_at", expires_at)


@dataclass(frozen=True, slots=True)
class VerifiedProviderIdentity:
    """Provider proof accepted by a future adapter; contains no PARMAR account ID."""

    provider_identity: ProviderIdentity
    authentication: AuthenticationContext

    def __post_init__(self) -> None:
        if type(self.provider_identity) is not ProviderIdentity:
            raise ValueError("Verified provider identity is required.")
        if type(self.authentication) is not AuthenticationContext:
            raise ValueError("Verified authentication context is required.")


class AuthenticationAdapter(Protocol):
    """Future provider-neutral verification boundary; no adapter is configured."""

    def verify(self, assertion: object) -> VerifiedProviderIdentity | None:
        """Verify an assertion without creating or selecting a PARMAR account."""


class ProviderAccountBindingLookup(Protocol):
    """Read-only lookup of an explicitly established provider-to-account binding."""

    def find_existing_account(self, identity: ProviderIdentity) -> AccountIdentity | None:
        """Return an existing binding; implementations must not create or merge one."""


@dataclass(frozen=True, slots=True)
class AuthenticatedPrincipal:
    """Server-established PARMAR account and minimal authentication context."""

    account_identity: AccountIdentity
    authentication: AuthenticationContext

    def __post_init__(self) -> None:
        if type(self.account_identity) is not AccountIdentity:
            raise ValueError("Authenticated principals require a PARMAR account identity.")
        if type(self.authentication) is not AuthenticationContext:
            raise ValueError("Authenticated principals require a valid authentication context.")


def authentication_is_current(
    authentication: object,
    *,
    now: datetime | None = None,
) -> bool:
    if type(authentication) is not AuthenticationContext:
        return False
    current = _now_utc(now)
    return authentication.authenticated_at <= current < authentication.expires_at


def resolve_authenticated_principal(
    adapter: AuthenticationAdapter,
    bindings: ProviderAccountBindingLookup,
    assertion: object,
    *,
    now: datetime | None = None,
) -> AuthenticatedPrincipal | None:
    """Resolve only a previously bound account; unknown provider identities fail closed."""
    verified = adapter.verify(assertion)
    if (
        type(verified) is not VerifiedProviderIdentity
        or type(verified.provider_identity) is not ProviderIdentity
        or not authentication_is_current(verified.authentication, now=now)
    ):
        return None
    account_identity = bindings.find_existing_account(verified.provider_identity)
    if type(account_identity) is not AccountIdentity:
        return None
    return AuthenticatedPrincipal(account_identity, verified.authentication)


@dataclass(frozen=True, slots=True)
class ProductAudience:
    """Server-selected product boundary, not a credential or permission."""

    product_id: str

    def __post_init__(self) -> None:
        if not isinstance(self.product_id, str) or not _PRODUCT_ID_PATTERN.fullmatch(self.product_id):
            raise ValueError("Product audience must be a lowercase product identifier.")


PARMAR_HOME = ProductAudience("parmar-home")
VOKKI = ProductAudience("vokki")
AETHER_DESKTOP = ProductAudience("aether-desktop")
AETHER_ANDROID_FUTURE_AUTH = ProductAudience("aether-android-future-auth")


@dataclass(frozen=True, slots=True)
class CoreSessionContext:
    """Internal shared account/session context; it contains no session token."""

    session_id: UUID
    principal: AuthenticatedPrincipal
    active_profile_id: ProfileIdentity | None = None
    workspace_memberships: tuple[WorkspaceIdentity, ...] = ()

    def __post_init__(self) -> None:
        if type(self.session_id) is not UUID:
            raise ValueError("Core session identity must be a UUID.")
        if type(self.principal) is not AuthenticatedPrincipal:
            raise ValueError("Core session requires a server-authenticated principal.")
        if self.active_profile_id is not None and type(self.active_profile_id) is not ProfileIdentity:
            raise ValueError("Active profile identity must remain separate from account identity.")
        if (
            type(self.workspace_memberships) is not tuple
            or any(type(item) is not WorkspaceIdentity for item in self.workspace_memberships)
        ):
            raise ValueError("Workspace membership context is malformed.")
        if len(set(self.workspace_memberships)) != len(self.workspace_memberships):
            raise ValueError("Workspace membership context contains duplicates.")


@dataclass(frozen=True, slots=True)
class ProductSessionContext:
    """Product-scoped view of a Core session; carries no product permissions."""

    session: CoreSessionContext
    audience: ProductAudience

    def __post_init__(self) -> None:
        if type(self.session) is not CoreSessionContext:
            raise ValueError("A trusted Core session context is required.")
        if type(self.audience) is not ProductAudience:
            raise ValueError("A server-selected product audience is required.")


def product_session_context(
    session: object,
    audience: object,
    *,
    now: datetime | None = None,
) -> ProductSessionContext | None:
    if (
        type(session) is not CoreSessionContext
        or type(audience) is not ProductAudience
        or not authentication_is_current(session.principal.authentication, now=now)
    ):
        return None
    return ProductSessionContext(session, audience)


@dataclass(frozen=True, slots=True)
class HomeIdentityContext:
    """Server-side Home projection of the shared Core identity/session contract."""

    account_identity: AccountIdentity
    authentication: AuthenticationContext
    session_id: UUID
    active_profile_id: ProfileIdentity | None
    workspace_memberships: tuple[WorkspaceIdentity, ...]


class CoreIdentityContextResolver(Protocol):
    """Trusted server-side resolver; browser fields are not an identity source."""

    def resolve(
        self,
        request: object,
        *,
        audience: ProductAudience,
    ) -> ProductSessionContext | None:
        """Resolve context from trusted server credentials for the fixed audience."""


def home_identity_context(
    context: object,
    *,
    now: datetime | None = None,
) -> HomeIdentityContext | None:
    if (
        type(context) is not ProductSessionContext
        or context.audience != PARMAR_HOME
        or not authentication_is_current(context.session.principal.authentication, now=now)
    ):
        return None
    session = context.session
    return HomeIdentityContext(
        account_identity=session.principal.account_identity,
        authentication=session.principal.authentication,
        session_id=session.session_id,
        active_profile_id=session.active_profile_id,
        workspace_memberships=session.workspace_memberships,
    )


def resolve_home_identity_context(
    resolver: CoreIdentityContextResolver,
    server_request: object,
    *,
    now: datetime | None = None,
) -> HomeIdentityContext | None:
    context = resolver.resolve(server_request, audience=PARMAR_HOME)
    if context is None:
        return None
    if type(context) is not ProductSessionContext:
        raise TypeError("Core identity resolver returned a malformed product context.")
    return home_identity_context(context, now=now)


class ResourceScope(str, Enum):
    PERSONAL = "personal"
    WORKSPACE = "workspace"


class ResourcePermission(str, Enum):
    VIEW = "view"
    EDIT = "edit"
    MANAGE = "manage"


class ResourceAction(str, Enum):
    VIEW = "view"
    EDIT = "edit"
    MANAGE = "manage"


@dataclass(frozen=True, slots=True)
class ResourceDescriptor:
    resource_id: UUID
    owner_account_identity: AccountIdentity | None
    scope: ResourceScope
    profile_id: ProfileIdentity | None = None
    workspace_id: WorkspaceIdentity | None = None


@dataclass(frozen=True, slots=True)
class ResourceGrant:
    """Typed grant descriptor; not proof that a grant is current or authoritative."""

    resource_id: UUID
    owner_account_identity: AccountIdentity
    grantee_account_identity: AccountIdentity
    granted_by_account_identity: AccountIdentity
    permission: ResourcePermission


@dataclass(frozen=True, slots=True)
class AuthorizationContext:
    principal: AuthenticatedPrincipal | None
    active_profile_id: ProfileIdentity | None = None
    active_profile_owner_account_identity: AccountIdentity | None = None
    workspace_memberships: tuple[WorkspaceIdentity, ...] = ()
    resource_grants: tuple[ResourceGrant, ...] = ()


class AuthorizationReason(str, Enum):
    OWNER = "owner"
    MISSING_CONTEXT = "missing-context"
    EXPIRED_PRINCIPAL = "expired-principal"
    MISSING_OWNERSHIP = "missing-ownership"
    INVALID_RESOURCE_SCOPE = "invalid-resource-scope"
    PROFILE_CONTEXT_MISMATCH = "profile-context-mismatch"
    WORKSPACE_POLICY_UNDEFINED = "workspace-policy-undefined"
    GRANT_POLICY_UNAVAILABLE = "grant-policy-unavailable"
    NO_EXPLICIT_GRANT = "no-explicit-grant"
    UNKNOWN_ACTION = "unknown-action"
    UNKNOWN_PERMISSION = "unknown-permission"
    PERMISSION_SCOPE_MISMATCH = "permission-scope-mismatch"


@dataclass(frozen=True, slots=True)
class AuthorizationDecision:
    allowed: bool
    reason: AuthorizationReason


@dataclass(frozen=True, slots=True)
class ActionApprovalBinding:
    """Opaque one-use approval scope; actor IDs are not PARMAR account identities."""

    actor_id: UUID
    action: str
    resource_id: str
    resource_scope: str
    permission_scope: str
    scope_fingerprint: str

    def __post_init__(self) -> None:
        if type(self.actor_id) is not UUID:
            raise ValueError("Approval actor identity must be a UUID.")
        for value, limit in (
            (self.action, 128),
            (self.resource_id, 256),
            (self.resource_scope, 128),
            (self.permission_scope, 128),
        ):
            if (
                not isinstance(value, str)
                or not value
                or value != value.strip()
                or len(value) > limit
                or not value.isprintable()
            ):
                raise ValueError("Approval action binding is invalid.")
        if (
            not isinstance(self.scope_fingerprint, str)
            or len(self.scope_fingerprint) != 64
            or any(character not in "0123456789abcdef" for character in self.scope_fingerprint)
        ):
            raise ValueError("Approval scope fingerprint is invalid.")


def permission_covers_action(permission: object, action: object) -> bool:
    """Compare permission levels without asserting a grant's authority or validity."""
    if type(permission) is not ResourcePermission or type(action) is not ResourceAction:
        return False
    if permission is ResourcePermission.MANAGE:
        return True
    if permission is ResourcePermission.EDIT:
        return action in (ResourceAction.VIEW, ResourceAction.EDIT)
    return action is ResourceAction.VIEW


def authorize_resource_access(
    context: object,
    resource: object,
    action: object,
    *,
    now: datetime | None = None,
) -> AuthorizationDecision:
    """Deny by default; membership alone never authorizes resource access."""
    if type(action) is not ResourceAction:
        return AuthorizationDecision(False, AuthorizationReason.UNKNOWN_ACTION)
    if (
        type(context) is not AuthorizationContext
        or type(resource) is not ResourceDescriptor
        or type(context.workspace_memberships) is not tuple
        or any(type(item) is not WorkspaceIdentity for item in context.workspace_memberships)
        or type(context.resource_grants) is not tuple
        or any(type(item) is not ResourceGrant for item in context.resource_grants)
    ):
        return AuthorizationDecision(False, AuthorizationReason.MISSING_CONTEXT)
    principal = context.principal
    if type(principal) is not AuthenticatedPrincipal:
        return AuthorizationDecision(False, AuthorizationReason.MISSING_CONTEXT)
    if not authentication_is_current(principal.authentication, now=now):
        return AuthorizationDecision(False, AuthorizationReason.EXPIRED_PRINCIPAL)
    if (
        type(resource.resource_id) is not UUID
        or type(resource.owner_account_identity) is not AccountIdentity
    ):
        return AuthorizationDecision(False, AuthorizationReason.MISSING_OWNERSHIP)
    if type(resource.scope) is not ResourceScope:
        return AuthorizationDecision(False, AuthorizationReason.INVALID_RESOURCE_SCOPE)
    if resource.scope is ResourceScope.PERSONAL:
        if resource.workspace_id is not None:
            return AuthorizationDecision(False, AuthorizationReason.INVALID_RESOURCE_SCOPE)
    elif (
        type(resource.workspace_id) is not WorkspaceIdentity
        or resource.profile_id is not None
    ):
        return AuthorizationDecision(False, AuthorizationReason.INVALID_RESOURCE_SCOPE)
    if resource.profile_id is not None:
        if (
            type(resource.profile_id) is not ProfileIdentity
            or context.active_profile_id != resource.profile_id
            or context.active_profile_owner_account_identity != principal.account_identity
        ):
            return AuthorizationDecision(False, AuthorizationReason.PROFILE_CONTEXT_MISMATCH)
    elif (
        context.active_profile_id is not None
        and type(context.active_profile_id) is not ProfileIdentity
    ):
        return AuthorizationDecision(False, AuthorizationReason.MISSING_CONTEXT)
    if principal.account_identity == resource.owner_account_identity:
        return AuthorizationDecision(True, AuthorizationReason.OWNER)
    if resource.scope is ResourceScope.WORKSPACE:
        return AuthorizationDecision(False, AuthorizationReason.WORKSPACE_POLICY_UNDEFINED)
    if resource.profile_id is not None:
        return AuthorizationDecision(False, AuthorizationReason.PROFILE_CONTEXT_MISMATCH)

    matching_grant = False
    for grant in context.resource_grants:
        if (
            grant.resource_id != resource.resource_id
            or grant.owner_account_identity != resource.owner_account_identity
            or grant.grantee_account_identity != principal.account_identity
            or grant.granted_by_account_identity != resource.owner_account_identity
        ):
            continue
        if type(grant.permission) is not ResourcePermission:
            return AuthorizationDecision(False, AuthorizationReason.UNKNOWN_PERMISSION)
        matching_grant = True
    if matching_grant:
        return AuthorizationDecision(False, AuthorizationReason.GRANT_POLICY_UNAVAILABLE)
    return AuthorizationDecision(False, AuthorizationReason.NO_EXPLICIT_GRANT)


def authorize_resource_action(
    context: object,
    resource: object,
    action: object,
    permission_scope: object,
    *,
    now: datetime | None = None,
) -> AuthorizationDecision:
    """Apply a server-resolved permission scope before resource authorization."""
    if type(action) is not ResourceAction:
        return AuthorizationDecision(False, AuthorizationReason.UNKNOWN_ACTION)
    if type(permission_scope) is not ResourcePermission:
        return AuthorizationDecision(False, AuthorizationReason.UNKNOWN_PERMISSION)
    if not permission_covers_action(permission_scope, action):
        return AuthorizationDecision(False, AuthorizationReason.PERMISSION_SCOPE_MISMATCH)
    return authorize_resource_access(context, resource, action, now=now)
