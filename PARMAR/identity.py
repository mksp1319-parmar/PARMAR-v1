"""Server-established identity contracts for PARMAR HTTP requests.

Principals are created by trusted server-side resolvers, never deserialized from
client input. Identity does not carry permissions or PARMAR safety decisions.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

LOCAL_DEMO_SOURCE = "local-demo"


@dataclass(frozen=True)
class Principal:
    """Identity only; authorization and safety remain separate authorities."""

    authenticated: bool
    user_id: UUID | None
    authentication_source: str

    def __post_init__(self) -> None:
        if not isinstance(self.authenticated, bool):
            raise ValueError("Principal authentication state must be boolean.")
        if not isinstance(self.authentication_source, str) or not self.authentication_source.strip():
            raise ValueError("Principal authentication source is required.")
        if self.authenticated:
            if not isinstance(self.user_id, UUID):
                raise ValueError("Authenticated principals require a server-established UUID.")
            if self.authentication_source.casefold() == LOCAL_DEMO_SOURCE:
                raise ValueError("Local-demo cannot identify an authenticated principal.")
        elif self.user_id is not None or self.authentication_source != LOCAL_DEMO_SOURCE:
            raise ValueError("Anonymous principals must use the local-demo source and no user ID.")

    @classmethod
    def anonymous_local_demo(cls) -> Principal:
        """Represent local demo use without inventing an account identity."""
        return cls(
            authenticated=False,
            user_id=None,
            authentication_source=LOCAL_DEMO_SOURCE,
        )

    @classmethod
    def authenticated_user(cls, user_id: UUID, authentication_source: str) -> Principal:
        """Build a future authenticated principal from trusted server identity data."""
        return cls(
            authenticated=True,
            user_id=user_id,
            authentication_source=authentication_source,
        )


@dataclass(frozen=True)
class HTTPRequestContext:
    """Server-created request context; intentionally not part of ChatContext."""

    principal: Principal
    session_id: UUID | None = None

    def __post_init__(self) -> None:
        if self.principal.authenticated != isinstance(self.session_id, UUID):
            raise ValueError("Authenticated request contexts require an active server session.")


class PrincipalResolver(Protocol):
    """Resolve a principal from trusted request credentials on the server."""

    def resolve(self, request: object) -> Principal:
        """Return a principal established by trusted server-side code."""


class LocalDemoPrincipalResolver:
    """Non-production resolver that always returns anonymous local-demo identity."""

    def resolve(self, request: object) -> Principal:
        del request
        return Principal.anonymous_local_demo()