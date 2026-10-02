"""Route chat requests through a provider abstraction without bypassing PARMAR."""

from __future__ import annotations

from dataclasses import dataclass, field, replace

from .context import ChatContext
from .models import ChatResponse
from .providers import (
    PROVIDER_LABELS,
    ChatProvider,
    UnavailableProvider,
    provider_for_selection,
    provider_from_environment,
)


@dataclass(frozen=True)
class ProviderRoutingResult:
    adapter: ChatProvider = field(repr=False, compare=False)
    selected_provider: str
    selection_reason: str
    category: str
    available: bool
    fallback_allowed: bool = False
    failure_state: str | None = None

    def public_payload(self) -> dict[str, str | bool | None]:
        return {
            "selected_provider": self.selected_provider,
            "selection_reason": self.selection_reason,
            "category": self.category,
            "available": self.available,
            "fallback_allowed": self.fallback_allowed,
            "failure_state": self.failure_state,
        }

    def with_failure(self, state: str) -> ProviderRoutingResult:
        return replace(self, failure_state=state)


class ChatRouter:
    """Choose a safe, local provider by default."""

    def __init__(self, provider: ChatProvider | None = None):
        self._injected_provider = provider is not None
        self.provider = provider if provider is not None else provider_from_environment()

    def prepare(self, selected_provider: str | None = None) -> ProviderRoutingResult:
        if selected_provider is not None:
            adapter = provider_for_selection(selected_provider)
            requested = selected_provider.strip().lower() if isinstance(selected_provider, str) else ""
            public_name = requested if requested in PROVIDER_LABELS else "unavailable"
            selection_reason = "explicit_user_selection"
        else:
            adapter = self.provider
            requested = getattr(adapter, "requested_name", getattr(adapter, "name", "unavailable"))
            public_name = requested if requested in PROVIDER_LABELS else "custom"
            selection_reason = "injected_provider" if self._injected_provider else (
                "local_default" if public_name == "local-demo" else "server_configuration"
            )

        available = not isinstance(adapter, UnavailableProvider)
        if not available:
            public_name = public_name if public_name in PROVIDER_LABELS else "unavailable"
        category = "local" if public_name == "local-demo" else (
            "external" if public_name in PROVIDER_LABELS else "custom"
        )
        return ProviderRoutingResult(
            adapter=adapter,
            selected_provider=public_name,
            selection_reason=selection_reason,
            category=category,
            available=available,
            fallback_allowed=False,
            failure_state=None if available else "PROVIDER_UNAVAILABLE",
        )

    def route(
        self,
        prompt: str,
        context: ChatContext | None = None,
        *,
        selection: ProviderRoutingResult | None = None,
        selected_provider: str | None = None,
    ) -> ChatResponse:
        route = selection or self.prepare(selected_provider)
        if not route.available:
            raise RuntimeError("The selected provider is unavailable or misconfigured.")
        return route.adapter.generate(prompt, context=context)
