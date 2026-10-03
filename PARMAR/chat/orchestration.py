"""Capability-based orchestration above PARMAR's existing chat providers."""

from __future__ import annotations

import math
import os
import re
import time
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from typing import Any

from .context import ChatContext, sanitize_provider_text
from .models import ChatResponse
from .plugins import (
    DISABLED as PLUGIN_DISABLED,
    FREE_ELIGIBLE,
    LOCAL_FREE as PLUGIN_LOCAL_FREE,
    PAID_ONLY as PLUGIN_PAID_ONLY,
    UNKNOWN_PRICING,
    PluginMetadata,
    PluginRegistry,
    PluginRegistration,
    adapter_implements_provider_contract,
    default_plugin_registry,
    plugin_interface_supported,
)
from .providers import (
    PROVIDER_ENV,
    PROVIDER_REGISTRY,
    ChatProvider,
    UnavailableProvider,
    provider_catalog,
    provider_for_selection,
    provider_from_environment,
)
from .readiness import (
    EXTERNAL_MULTI_MODEL_ENV,
    ExternalAuthorization,
    ProviderFreePolicy,
    SINGLE_PROVIDER_EXTERNAL,
    VERIFIED_MULTI_MODEL_EXTERNAL,
)
from .router import ChatRouter, ProviderRoutingResult
from .task_routing import (
    CODING_AS_TEXT,
    REASONING,
    STRUCTURED_OUTPUT,
    SUMMARIZATION,
    TEXT,
    TRANSLATION,
    VERIFICATION,
    VISION,
    normalize_capability,
)

SINGLE_PROVIDER = "SINGLE_PROVIDER"
VERIFIED_MULTI_MODEL = "VERIFIED_MULTI_MODEL"
MAX_VERIFIED_CANDIDATES = 3
MAX_CANDIDATE_OUTPUT_CHARS = 20_000
VERIFIED_MULTI_MODEL_EXTERNAL_ENV = EXTERNAL_MULTI_MODEL_ENV
_SAFE_IDENTIFIER = re.compile(r"[A-Za-z][A-Za-z0-9._:-]{0,63}")
_HEALTH_STATES = {"healthy", "unhealthy", "unknown", "unavailable"}


def _public_identifier(value: str | None) -> str | None:
    if not isinstance(value, str) or not _SAFE_IDENTIFIER.fullmatch(value):
        return "configured" if value else None
    if sanitize_provider_text(value) != value:
        return "configured"
    lowered = value.lower()
    if any(marker in lowered for marker in ("token", "secret", "credential", "authorization", "api_key", "api-key", "bearer")):
        return "configured"
    return value


def _authorization_capability(capability: str) -> str:
    normalized = normalize_capability(capability)
    return {
        TEXT: "text_generation",
        CODING_AS_TEXT: "code_generation",
        VISION: "image_analysis",
    }.get(normalized, (normalized or capability).lower())


@dataclass(frozen=True)
class ProviderModelCapability:
    """Configured model metadata; unknown features remain unadvertised."""

    provider_id: str
    model_id: str
    capabilities: frozenset[str] = frozenset()
    input_modalities: frozenset[str] = frozenset()
    output_modalities: frozenset[str] = frozenset()
    locality: str = "unknown"
    available: bool = False
    configured: bool = False
    authorized: bool = False
    cost_per_1k_tokens: float | None = None
    latency_ms: float | None = None
    context_limit: int | None = None
    reliability: float | None = None
    health: str = "unknown"
    adapter: ChatProvider | None = field(default=None, repr=False, compare=False)
    pricing_policy: str | None = None
    activation_state: str | None = None
    supported_modes: frozenset[str] | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "capabilities", frozenset(self.capabilities))
        object.__setattr__(self, "input_modalities", frozenset(self.input_modalities))
        object.__setattr__(self, "output_modalities", frozenset(self.output_modalities))
        if self.pricing_policy not in {
            None, PLUGIN_LOCAL_FREE, FREE_ELIGIBLE, PLUGIN_PAID_ONLY, UNKNOWN_PRICING, PLUGIN_DISABLED
        }:
            object.__setattr__(self, "pricing_policy", UNKNOWN_PRICING)
        if self.activation_state not in {None, "ACTIVE", "INACTIVE"}:
            object.__setattr__(self, "activation_state", "INACTIVE")
        if self.supported_modes is not None:
            object.__setattr__(self, "supported_modes", frozenset(self.supported_modes))
        if self.locality not in {"local", "external", "unknown"}:
            object.__setattr__(self, "locality", "unknown")
        if not isinstance(self.health, str) or self.health.lower() not in _HEALTH_STATES:
            object.__setattr__(self, "health", "unknown")
        else:
            object.__setattr__(self, "health", self.health.lower())
        for field_name in ("cost_per_1k_tokens", "latency_ms", "reliability"):
            value = getattr(self, field_name)
            if value is not None and (
                not isinstance(value, (int, float))
                or isinstance(value, bool)
                or not math.isfinite(value)
                or value < 0
                or (field_name == "reliability" and value > 1)
            ):
                object.__setattr__(self, field_name, None)
        if self.context_limit is not None and (
            not isinstance(self.context_limit, int)
            or isinstance(self.context_limit, bool)
            or self.context_limit <= 0
        ):
            object.__setattr__(self, "context_limit", None)

    def supports(self, capability: str, input_modality: str, output_modality: str) -> bool:
        requested = normalize_capability(capability)
        return (
            requested is not None
            and any(normalize_capability(item) == requested for item in self.capabilities)
            and input_modality in self.input_modalities
            and output_modality in self.output_modalities
        )

    def public_payload(self) -> dict[str, Any]:
        return {
            "provider": _public_identifier(self.provider_id),
            "model": _public_identifier(self.model_id),
            "capabilities": sorted(_public_identifier(item) or "configured" for item in self.capabilities),
            "input_modalities": sorted(self.input_modalities),
            "output_modalities": sorted(self.output_modalities),
            "locality": self.locality if self.locality in {"local", "external", "unknown"} else "unknown",
            "available": self.available,
            "configured": self.configured,
            "authorized": self.authorized,
            "cost_per_1k_tokens": self.cost_per_1k_tokens,
            "latency_ms": self.latency_ms,
            "context_limit": self.context_limit,
            "reliability": self.reliability,
            "health": self.health if self.health in _HEALTH_STATES else "unknown",
        }


class ProviderModelRegistry:
    """Registry of capability descriptors independent of provider brands."""

    def __init__(self, default_provider: str | None = None) -> None:
        self.default_provider = default_provider
        self._models: dict[tuple[str, str], ProviderModelCapability] = {}

    def register(self, model: ProviderModelCapability, *, replace_existing: bool = False) -> None:
        key = (model.provider_id, model.model_id)
        if key in self._models and not replace_existing:
            raise ValueError("A provider/model capability is already registered.")
        self._models[key] = model

    def register_plugin(self, registration: PluginRegistration) -> None:
        """Expose a validated plugin through the existing provider-model contract."""
        if type(registration) is not PluginRegistration:
            raise TypeError("Only validated plugin registrations are accepted.")
        metadata = registration.metadata
        if type(metadata) is not PluginMetadata:
            raise TypeError("Only validated plugin metadata is accepted.")
        adapter = registration.adapter
        input_modalities = frozenset({"text", "image"}) if VISION in metadata.capabilities else frozenset({"text"})
        self.register(ProviderModelCapability(
            provider_id=metadata.plugin_id,
            model_id=metadata.plugin_id,
            capabilities=metadata.capabilities,
            input_modalities=input_modalities,
            output_modalities=frozenset({"text"}),
            locality=metadata.locality,
            available=(
                metadata.availability == "AVAILABLE"
                and adapter is not None
                and plugin_interface_supported(metadata)
            ),
            configured=adapter is not None,
            authorized=metadata.authorization_state in {"AUTHORIZED", "NOT_REQUIRED"},
            health="unknown" if metadata.availability == "AVAILABLE" else "unavailable",
            adapter=adapter,
            pricing_policy=metadata.pricing_policy,
            activation_state=metadata.activation_state,
            supported_modes=metadata.supported_modes,
        ))

    def models(self) -> tuple[ProviderModelCapability, ...]:
        return tuple(self._models[key] for key in sorted(self._models))

    def for_provider(self, provider_id: str) -> tuple[ProviderModelCapability, ...]:
        return tuple(model for model in self.models() if model.provider_id == provider_id)

    @classmethod
    def discover_configured(
        cls,
        environ: dict[str, str] | None = None,
        injected_provider: ChatProvider | None = None,
    ) -> ProviderModelRegistry:
        """Inspect registered adapters and configuration without making requests."""
        values = os.environ if environ is None else environ
        configured_name = values.get(PROVIDER_ENV, "")
        default_provider = (
            configured_name.strip().lower()
            if isinstance(configured_name, str) and configured_name.strip()
            else getattr(provider_from_environment(values), "name", None)
        )
        registry = cls(default_provider=default_provider)
        catalog = {item["id"]: item for item in provider_catalog(values)}

        for provider_id in PROVIDER_REGISTRY:
            adapter = provider_for_selection(provider_id, values)
            details = catalog.get(provider_id, {})
            available = bool(details.get("available")) and not isinstance(adapter, UnavailableProvider)
            locality = str(details.get("category", "unknown"))
            model_id = getattr(adapter, "model", None) or provider_id
            registry.register(ProviderModelCapability(
                provider_id=provider_id,
                model_id=str(model_id),
                capabilities=frozenset({"text_generation"}),
                input_modalities=frozenset({"text"}),
                output_modalities=frozenset({"text"}),
                locality=locality,
                available=available,
                configured=available,
                authorized=available and (locality == "local" or provider_id == default_provider),
                health="unknown" if available else "unavailable",
                adapter=adapter if available else None,
            ))

        if injected_provider is not None:
            provider_id = getattr(injected_provider, "name", "configured")
            provider_id = provider_id if isinstance(provider_id, str) and provider_id else "configured"
            model_id = getattr(injected_provider, "model", provider_id)
            model_id = model_id if isinstance(model_id, str) and model_id else provider_id
            capabilities = getattr(injected_provider, "capabilities", {"text_generation"})
            input_modalities = getattr(injected_provider, "input_modalities", {"text"})
            output_modalities = getattr(injected_provider, "output_modalities", {"text"})
            locality = getattr(injected_provider, "locality", "unknown")
            if locality not in {"local", "external", "unknown"}:
                locality = "unknown"
            available = callable(getattr(injected_provider, "generate", None))
            registry.register(ProviderModelCapability(
                provider_id=provider_id,
                model_id=model_id,
                capabilities=frozenset(capabilities),
                input_modalities=frozenset(input_modalities),
                output_modalities=frozenset(output_modalities),
                locality=locality,
                available=available,
                configured=available,
                authorized=available,
                health="unknown" if available else "unavailable",
                adapter=injected_provider if available else None,
                pricing_policy=PLUGIN_LOCAL_FREE if locality == "local" else None,
            ), replace_existing=True)
            registry.default_provider = provider_id
        return registry


@dataclass(frozen=True)
class CandidateResult:
    provider_id: str
    model_id: str
    status: str
    output: str | None = field(default=None, repr=False)
    failure_reason: str | None = None
    capability: str = "text_generation"
    success: bool | None = None
    latency_ms: float | None = None
    normalized_error: str | None = None
    validation_status: str = "NOT_VALIDATED"

    def public_payload(self) -> dict[str, Any]:
        content = sanitize_provider_text(self.output) if self.output is not None else None
        return {
            "provider": _public_identifier(self.provider_id),
            "model": _public_identifier(self.model_id),
            "capability": _public_identifier(self.capability),
            "status": self.status,
            "success": self.success,
            "content": content,
            "output": content,
            "latency_ms": self.latency_ms,
            "normalized_error": self.normalized_error,
            "validation_status": self.validation_status,
            "failure_reason": sanitize_provider_text(self.failure_reason) if self.failure_reason else None,
        }


@dataclass(frozen=True)
class OrchestrationResult:
    mode: str
    selected_provider: str | None
    selected_model: str | None
    capability: str
    candidates: tuple[CandidateResult, ...]
    verification_status: str
    available: bool
    failure_reason: str | None = None
    fallback_allowed: bool = False
    failure_state: str | None = None
    outcome: str = "PLANNED"
    routing: ProviderRoutingResult | None = field(default=None, repr=False, compare=False)
    response: ChatResponse | None = field(default=None, repr=False, compare=False)
    adapter: ChatProvider | None = field(default=None, repr=False, compare=False)

    def public_payload(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "selected_provider": _public_identifier(self.selected_provider),
            "selected_model": _public_identifier(self.selected_model),
            "capability": _public_identifier(self.capability),
            "candidates": [candidate.public_payload() for candidate in self.candidates],
            "verification_status": self.verification_status,
            "available": self.available,
            "failure_reason": sanitize_provider_text(self.failure_reason) if self.failure_reason else None,
            "failure_state": self.failure_state,
            "outcome": self.outcome,
            "fallback_allowed": self.fallback_allowed,
        }


class AIOrchestrator:
    """Plan deterministic provider use after PARMAR's safety enforcement."""

    def __init__(
        self,
        router: ChatRouter | None = None,
        registry: ProviderModelRegistry | None = None,
        external_authorization: ExternalAuthorization | None = None,
        free_policy: ProviderFreePolicy | None = None,
        plugin_registry: PluginRegistry | None = None,
    ) -> None:
        self.router = router or ChatRouter()
        self.external_authorization = external_authorization or ExternalAuthorization()
        self.free_policy = free_policy or ProviderFreePolicy()
        self.plugin_registry = plugin_registry or default_plugin_registry()
        self.registry = registry or (
            ProviderModelRegistry(default_provider=None)
            if plugin_registry is not None
            else ProviderModelRegistry.discover_configured(
                injected_provider=self.router.provider if self.router._injected_provider else None
            )
        )
        for registration in self.plugin_registry._registration_entries():
            if registration.adapter is None:
                continue
            plugin_models = ProviderModelRegistry()
            plugin_models.register_plugin(registration)
            for model in plugin_models.models():
                self.registry.register(model, replace_existing=True)

    def _provider_locality(self, provider_id: str | None, model_id: str | None = None) -> str:
        matches = self.registry.for_provider(provider_id or "")
        for model in matches:
            if model.model_id == model_id:
                return model.locality
        if matches:
            return matches[0].locality
        return "unknown"

    def _free_policy_allows(self, model: ProviderModelCapability) -> bool:
        if model.pricing_policy is not None:
            return model.pricing_policy in {PLUGIN_LOCAL_FREE, FREE_ELIGIBLE}
        return self.free_policy.evaluate(
            model.provider_id, model.model_id
        ).eligible

    def _eligible(
        self,
        model: ProviderModelCapability,
        capability: str,
        input_modality: str,
        output_modality: str,
        *,
        explicitly_selected: bool,
        mode: str,
        require_external_gates: bool = True,
    ) -> bool:
        if not (
            model.available
            and model.configured
            and model.health != "unhealthy"
            and adapter_implements_provider_contract(model.adapter)
            and model.supports(capability, input_modality, output_modality)
            and (model.activation_state in {None, "ACTIVE"})
            and (model.supported_modes is None or mode in model.supported_modes)
        ):
            return False

        if model.pricing_policy is not None:
            if model.pricing_policy not in {PLUGIN_LOCAL_FREE, FREE_ELIGIBLE}:
                return False
        else:
            free_decision = self.free_policy.evaluate(model.provider_id, model.model_id)
            if not free_decision.eligible:
                return False

        if model.locality == "local":
            return True
        if not require_external_gates:
            return True
        if not model.authorized and not explicitly_selected:
            return False

        external_mode = (
            SINGLE_PROVIDER_EXTERNAL if mode == SINGLE_PROVIDER else VERIFIED_MULTI_MODEL_EXTERNAL
        )
        if not self.external_authorization.evaluate(
            model.provider_id, _authorization_capability(capability), external_mode
        ).authorized:
            return False
        if mode == VERIFIED_MULTI_MODEL and os.environ.get(EXTERNAL_MULTI_MODEL_ENV, "").strip().lower() not in {
            "1", "true", "yes", "on",
        }:
            return False
        return True

    def plan(
        self,
        *,
        mode: str = SINGLE_PROVIDER,
        capability: str = TEXT,
        input_modality: str = "text",
        output_modality: str = "text",
        selected_provider: str | None = None,
    ) -> OrchestrationResult:
        if mode not in {SINGLE_PROVIDER, VERIFIED_MULTI_MODEL}:
            raise ValueError("Unsupported orchestration mode.")

        explicitly_selected = selected_provider is not None
        all_models = self.registry.models()
        if explicitly_selected:
            requested_provider = selected_provider.strip().lower() if isinstance(selected_provider, str) else ""
            matching = tuple(model for model in all_models if model.provider_id.lower() == requested_provider)
            if not any(model.available and model.configured for model in matching):
                selected_route = self.router.prepare(selected_provider)
                adapter = selected_route.adapter
                if selected_route.available:
                    provider_id = selected_route.selected_provider
                    model_id = getattr(adapter, "model", provider_id)
                    matching = (ProviderModelCapability(
                        provider_id=provider_id,
                        model_id=model_id if isinstance(model_id, str) and model_id else provider_id,
                        capabilities=frozenset(getattr(adapter, "capabilities", {"text_generation"})),
                        input_modalities=frozenset(getattr(adapter, "input_modalities", {"text"})),
                        output_modalities=frozenset(getattr(adapter, "output_modalities", {"text"})),
                        locality=getattr(adapter, "locality", selected_route.category),
                        available=True,
                        configured=True,
                        authorized=True,
                        adapter=adapter,
                    ),)
                else:
                    if not matching:
                        return self._failure(mode, selected_provider, None, capability, "The selected provider is unavailable or unregistered.", "PROVIDER_UNAVAILABLE")
            eligible = tuple(model for model in matching if self._eligible(
                model, capability, input_modality, output_modality,
                explicitly_selected=True, mode=mode,
            ))
            if not eligible:
                available = any(model.available and model.configured for model in matching)
                supports_requested = any(
                    model.supports(capability, input_modality, output_modality)
                    for model in matching
                )
                state = (
                    "NO_ELIGIBLE_AI_PLUGIN" if available and supports_requested
                    else "CAPABILITY_UNAVAILABLE" if available
                    else "PROVIDER_UNAVAILABLE"
                )
                reason = (
                    "No registered provider passed every eligibility gate."
                    if state == "NO_ELIGIBLE_AI_PLUGIN"
                    else "The selected provider does not offer the requested capability."
                    if available
                    else "The selected provider is unavailable or misconfigured."
                )
                return self._failure(mode, selected_provider, None, capability, reason, state)
        else:
            if self.registry.default_provider and not self.registry.for_provider(self.registry.default_provider):
                return self._failure(
                    mode,
                    self.registry.default_provider,
                    None,
                    capability,
                    "The configured provider is unknown or unavailable.",
                    "PROVIDER_UNAVAILABLE",
                )
            eligible = tuple(model for model in all_models if self._eligible(
                model, capability, input_modality, output_modality,
                explicitly_selected=False, mode=mode,
            ))
            default_models = tuple(model for model in eligible if model.provider_id == self.registry.default_provider)
            default_all = self.registry.for_provider(self.registry.default_provider) if self.registry.default_provider else ()
            default_available = any(
                model.available
                and model.configured
                and model.health != "unhealthy"
                and adapter_implements_provider_contract(model.adapter)
                for model in default_all
            )
            if default_all and not default_available:
                return self._failure(
                    mode,
                    self.registry.default_provider,
                    None,
                    capability,
                    "The configured provider is unavailable or misconfigured.",
                    "PROVIDER_UNAVAILABLE",
                )
            if default_models:
                eligible = default_models + tuple(model for model in eligible if model not in default_models)
            elif self.registry.default_provider:
                default_capabilities = tuple(
                    model.available
                    and model.configured
                    and model.supports(capability, input_modality, output_modality)
                    for model in default_all
                )
                if any(default_capabilities):
                    return self._failure(
                        mode,
                        self.registry.default_provider,
                        None,
                        capability,
                        "No registered provider passed every eligibility gate.",
                        "NO_ELIGIBLE_AI_PLUGIN",
                    )
                if not eligible:
                    supports_requested = any(
                        model.available
                        and model.configured
                        and model.supports(capability, input_modality, output_modality)
                        for model in all_models
                    )
                    if supports_requested:
                        return self._failure(
                            mode,
                            self.registry.default_provider,
                            None,
                            capability,
                            "No registered provider passed every eligibility gate.",
                            "NO_ELIGIBLE_AI_PLUGIN",
                        )
                    return self._failure(
                        mode,
                        self.registry.default_provider,
                        None,
                        capability,
                        "The configured provider does not offer the requested capability.",
                        "CAPABILITY_UNAVAILABLE",
                    )
            elif not eligible:
                supports_requested = any(
                    model.available
                    and model.configured
                    and model.supports(capability, input_modality, output_modality)
                    for model in all_models
                )
                if supports_requested:
                    return self._failure(
                        mode,
                        None,
                        None,
                        capability,
                        "Registered providers support the requested capability but failed eligibility gates.",
                        "NO_ELIGIBLE_AI_PLUGIN",
                    )
                return self._failure(mode, None, None, capability, "No configured provider offers the requested capability.", "CAPABILITY_UNAVAILABLE")

        eligible = tuple(sorted(
            eligible,
            key=lambda model: (
                0 if model.provider_id == self.registry.default_provider else 1,
                0 if model.locality == "local" else 1,
                model.provider_id,
                model.model_id,
            ),
        ))
        if mode == SINGLE_PROVIDER:
            chosen = eligible[0]
            return OrchestrationResult(
                mode=mode,
                selected_provider=chosen.provider_id,
                selected_model=chosen.model_id,
                capability=capability,
                candidates=(CandidateResult(chosen.provider_id, chosen.model_id, "PLANNED"),),
                verification_status="NOT_REQUESTED",
                available=True,
                adapter=chosen.adapter,
            )

        if explicitly_selected:
            eligible = tuple(sorted(eligible, key=lambda model: (
                0 if model.provider_id == selected_provider else 1,
                model.provider_id,
                model.model_id,
            )))
        eligible = eligible[:MAX_VERIFIED_CANDIDATES]
        candidates = tuple(CandidateResult(model.provider_id, model.model_id, "PLANNED") for model in eligible)
        enough_models = len(candidates) >= 2
        return OrchestrationResult(
            mode=mode,
            selected_provider=candidates[0].provider_id if candidates else None,
            selected_model=candidates[0].model_id if candidates else None,
            capability=capability,
            candidates=candidates,
            verification_status="NOT_RUN",
            available=enough_models,
            failure_reason=None if enough_models else "At least two eligible models are required; no provider calls were made.",
            failure_state=None if enough_models else "INSUFFICIENT_MODELS",
        )

    def orchestrate(
        self,
        prompt: str,
        context: ChatContext | None = None,
        *,
        selected_provider: str | None = None,
        mode: str = SINGLE_PROVIDER,
        capability: str = TEXT,
        input_modality: str = "text",
        output_modality: str = "text",
    ) -> OrchestrationResult:
        plan = self.plan(
            mode=mode,
            capability=capability,
            input_modality=input_modality,
            output_modality=output_modality,
            selected_provider=selected_provider,
        )
        if mode == VERIFIED_MULTI_MODEL or not plan.available:
            return plan

        selected_model = next((model for model in self.registry.for_provider(plan.selected_provider or "")
                               if model.model_id == plan.selected_model), None)
        if selected_model is None or not self._free_policy_allows(selected_model):
            free_decision = self.free_policy.evaluate(
                plan.selected_provider or "",
                plan.selected_model or "",
            )
            return replace(
                plan,
                available=False,
                failure_reason="The selected provider is not eligible under PARMAR's FREE-ONLY policy.",
                failure_state=free_decision.outcome,
                outcome=free_decision.outcome,
                candidates=(CandidateResult(
                    plan.selected_provider or "configured",
                    plan.selected_model or "configured",
                    "NOT_EXECUTED",
                    normalized_error=free_decision.outcome,
                ),),
            )
        if not adapter_implements_provider_contract(plan.adapter):
            return replace(
                plan,
                available=False,
                failure_reason="The selected provider has no available adapter.",
                failure_state="PROVIDER_UNAVAILABLE",
                candidates=(CandidateResult(plan.selected_provider or "unavailable", plan.selected_model or "unknown", "UNAVAILABLE"),),
            )
        selection_reason = "explicit_user_selection" if selected_provider is not None else (
            "local_default" if plan.selected_provider == self.registry.default_provider == "local-demo"
            else "server_configuration" if plan.selected_provider == self.registry.default_provider
            else "capability_match"
        )
        routing = ProviderRoutingResult(
            adapter=plan.adapter,
            selected_provider=_public_identifier(plan.selected_provider) or "configured",
            selection_reason=selection_reason,
            category=next((model.locality for model in self.registry.for_provider(plan.selected_provider or "")
                           if model.model_id == plan.selected_model and model.locality in {"local", "external"}), "custom"),
            available=True,
            fallback_allowed=False,
        )
        try:
            response = self.router.route(prompt, context=context, selection=routing)
        except TimeoutError:
            return replace(
                plan,
                available=False,
                failure_reason="The selected provider timed out.",
                failure_state="PROVIDER_TIMEOUT",
                candidates=(CandidateResult(plan.selected_provider or "configured", plan.selected_model or "unknown", "FAILED", failure_reason="Provider timed out."),),
                routing=routing,
            )
        except Exception:
            return replace(
                plan,
                available=False,
                failure_reason="The selected provider failed.",
                failure_state="PROVIDER_UNAVAILABLE",
                candidates=(CandidateResult(plan.selected_provider or "configured", plan.selected_model or "unknown", "FAILED", failure_reason="Provider request failed."),),
                routing=routing,
            )

        if response is None:
            return replace(
                plan,
                available=False,
                failure_reason="The configured provider returned an invalid or empty response. PARMAR took no action.",
                failure_state="PROVIDER_INVALID_RESPONSE",
                candidates=(CandidateResult(plan.selected_provider or "configured", plan.selected_model or "unknown", "INVALID_RESPONSE"),),
                routing=routing,
            )

        candidate = CandidateResult(
            plan.selected_provider or "configured",
            plan.selected_model or "unknown",
            "RESPONSE_RECEIVED",
            output=sanitize_provider_text(response.content) if isinstance(response, ChatResponse) else None,
            capability=capability,
            success=True,
            validation_status="UNTRUSTED",
        )
        return replace(plan, candidates=(candidate,), routing=routing, response=response)

    @staticmethod
    def _copy_context(context: ChatContext) -> ChatContext:
        return ChatContext(
            language=context.language,
            persona=context.persona,
            memory=list(context.memory),
            policy_rules=list(context.policy_rules),
            safety_status=context.safety_status,
            risk_level=context.risk_level,
            approval_required=context.approval_required,
            approval_state=context.approval_state,
            required_permissions=list(context.required_permissions),
            enforcement_result=dict(context.enforcement_result),
        )

    @staticmethod
    def _execution_failure(
        capability: str,
        state: str,
        reason: str,
        *,
        outcome: str = "EXECUTION_REJECTED",
        candidates: tuple[CandidateResult, ...] = (),
    ) -> OrchestrationResult:
        return OrchestrationResult(
            mode=VERIFIED_MULTI_MODEL,
            selected_provider=None,
            selected_model=None,
            capability=capability,
            candidates=candidates,
            verification_status="NOT_RUN",
            available=False,
            failure_reason=reason,
            failure_state=state,
            outcome=outcome,
        )

    def execute_verified_multi_model(
        self,
        prompt: str,
        context: ChatContext,
        *,
        candidates: Sequence[ProviderModelCapability] | None = None,
        capability: str = TEXT,
        input_modality: str = "text",
        output_modality: str = "text",
    ) -> OrchestrationResult:
        """Run a bounded candidate set after PARMAR supplies a safe context.

        Calls are sequential and independent. Agreement is a deterministic text
        comparison, not evidence that any candidate is correct.
        """
        if (
            not isinstance(context, ChatContext)
            or context.safety_status != "SAFE"
            or context.approval_required is not False
            or not isinstance(context.enforcement_result, dict)
            or context.enforcement_result.get("execution_allowed") is not True
            or context.enforcement_result.get("status") != "READY_FOR_ACTION"
        ):
            return self._execution_failure(
                capability,
                "SAFETY_CONTEXT_REQUIRED",
                "PARMAR safety approval is required before multi-model execution.",
            )
        if not isinstance(prompt, str) or not prompt.strip():
            return self._execution_failure(
                capability,
                "INVALID_TASK",
                "A non-empty task is required.",
            )

        if candidates is None:
            plan = self.plan(
                mode=VERIFIED_MULTI_MODEL,
                capability=capability,
                input_modality=input_modality,
                output_modality=output_modality,
            )
            if not plan.available:
                return replace(plan, outcome="EXECUTION_REJECTED")
            candidate_models = [
                registered
                for planned in plan.candidates
                for registered in self.registry.for_provider(planned.provider_id)
                if registered.model_id == planned.model_id
            ]
        else:
            if not isinstance(candidates, Sequence) or isinstance(candidates, (str, bytes)):
                return self._execution_failure(
                    capability,
                    "INVALID_CANDIDATE_LIST",
                    "Candidates must be supplied as a bounded sequence.",
                )
            candidate_models = list(candidates)

        if len(candidate_models) > MAX_VERIFIED_CANDIDATES:
            return self._execution_failure(
                capability,
                "CANDIDATE_LIMIT_EXCEEDED",
                f"At most {MAX_VERIFIED_CANDIDATES} candidates may be executed.",
            )
        if len(candidate_models) < 2:
            return self._execution_failure(
                capability,
                "INSUFFICIENT_CANDIDATES",
                "At least two eligible candidates are required.",
            )
        if any(not isinstance(model, ProviderModelCapability) for model in candidate_models):
            return self._execution_failure(
                capability,
                "INVALID_CANDIDATE_LIST",
                "Every candidate must be a registered provider/model capability.",
            )

        registered_models = {(model.provider_id, model.model_id): model for model in self.registry.models()}
        candidate_keys = [(model.provider_id, model.model_id) for model in candidate_models]
        if len(set(candidate_keys)) != len(candidate_keys):
            return self._execution_failure(
                capability,
                "DUPLICATE_CANDIDATE",
                "Duplicate provider/model candidates are not allowed.",
            )
        if len({id(model.adapter) for model in candidate_models}) != len(candidate_models):
            return self._execution_failure(
                capability,
                "DUPLICATE_ADAPTER",
                "Each candidate must use an independent provider adapter instance.",
            )
        if any(registered_models.get(key) is not model for key, model in zip(candidate_keys, candidate_models)):
            return self._execution_failure(
                capability,
                "UNREGISTERED_CANDIDATE",
                "Candidates must be registered with this orchestrator.",
            )

        ordered_models = sorted(candidate_models, key=lambda model: (model.provider_id, model.model_id))
        ineligible = [
            model for model in ordered_models
            if not self._eligible(
                model,
                capability,
                input_modality,
                output_modality,
                explicitly_selected=False,
                mode=VERIFIED_MULTI_MODEL,
                require_external_gates=False,
            )
        ]
        if ineligible:
            return self._execution_failure(
                capability,
                "CANDIDATE_NOT_ELIGIBLE",
                "Every candidate must be available, authorized, healthy, and capability-compatible.",
            )

        for model in ordered_models:
            free_decision = self.free_policy.evaluate(model.provider_id, model.model_id)
            if not self._free_policy_allows(model):
                not_executed = tuple(CandidateResult(
                    candidate.provider_id,
                    candidate.model_id,
                    "NOT_EXECUTED",
                    capability=capability,
                    normalized_error=(
                        free_decision.outcome
                        if candidate.provider_id == model.provider_id and candidate.model_id == model.model_id
                        else "CANDIDATE_SET_REJECTED"
                    ),
                    validation_status="NOT_RUN",
                ) for candidate in ordered_models)
                return self._execution_failure(
                    capability,
                    free_decision.outcome,
                    "The candidate set is not entirely eligible under PARMAR's FREE-ONLY policy.",
                    candidates=not_executed,
                )

        external_models = [model for model in ordered_models if model.locality != "local"]
        external_enabled = os.environ.get(EXTERNAL_MULTI_MODEL_ENV, "").strip().lower() in {
            "1", "true", "yes", "on",
        }
        if external_models and not external_enabled:
            not_executed = tuple(CandidateResult(
                model.provider_id,
                model.model_id,
                "NOT_EXECUTED",
                capability=capability,
                success=None,
                normalized_error="EXTERNAL_EXECUTION_DISABLED",
                validation_status="NOT_RUN",
            ) for model in ordered_models)
            return self._execution_failure(
                capability,
                "EXTERNAL_EXECUTION_DISABLED",
                "External multi-model execution is disabled by configuration.",
                outcome="EXECUTION_DISABLED",
                candidates=not_executed,
            )
        for model in external_models:
            authorization = self.external_authorization.evaluate(
                model.provider_id,
                _authorization_capability(capability),
                VERIFIED_MULTI_MODEL_EXTERNAL,
            )
            if not authorization.authorized:
                not_executed = tuple(CandidateResult(
                    candidate.provider_id,
                    candidate.model_id,
                    "NOT_EXECUTED",
                    capability=capability,
                    normalized_error=authorization.outcome,
                    validation_status="NOT_RUN",
                ) for candidate in ordered_models)
                return self._execution_failure(
                    capability,
                    authorization.outcome,
                    "External multi-model authorization is required.",
                    outcome="EXECUTION_DISABLED",
                    candidates=not_executed,
                )

        safe_prompt = sanitize_provider_text(prompt)
        candidate_results: list[CandidateResult] = []
        for model in ordered_models:
            selection = ProviderRoutingResult(
                adapter=model.adapter,
                selected_provider=_public_identifier(model.provider_id) or "configured",
                selection_reason="verified_multi_model_candidate",
                category=model.locality if model.locality in {"local", "external"} else "custom",
                available=True,
                fallback_allowed=False,
            )
            started = time.perf_counter()
            try:
                response = self.router.route(
                    safe_prompt,
                    context=self._copy_context(context),
                    selection=selection,
                )
            except TimeoutError:
                latency = round((time.perf_counter() - started) * 1000, 3)
                candidate_results.append(CandidateResult(
                    model.provider_id,
                    model.model_id,
                    "FAILED",
                    failure_reason="Provider timed out.",
                    capability=capability,
                    success=False,
                    latency_ms=latency,
                    normalized_error="PROVIDER_TIMEOUT",
                    validation_status="NOT_RUN",
                ))
                continue
            except Exception:
                latency = round((time.perf_counter() - started) * 1000, 3)
                candidate_results.append(CandidateResult(
                    model.provider_id,
                    model.model_id,
                    "FAILED",
                    failure_reason="Provider request failed.",
                    capability=capability,
                    success=False,
                    latency_ms=latency,
                    normalized_error="PROVIDER_FAILURE",
                    validation_status="NOT_RUN",
                ))
                continue

            latency = round((time.perf_counter() - started) * 1000, 3)
            if (
                not isinstance(response, ChatResponse)
                or not isinstance(response.provider, str)
                or not response.provider.strip()
                or not isinstance(response.content, str)
                or not response.content.strip()
                or len(response.content) > MAX_CANDIDATE_OUTPUT_CHARS
                or not isinstance(response.safe, bool)
                or not isinstance(response.status, str)
                or not isinstance(response.metadata, dict)
            ):
                candidate_results.append(CandidateResult(
                    model.provider_id,
                    model.model_id,
                    "INVALID_RESPONSE",
                    failure_reason="Provider response failed PARMAR validation.",
                    capability=capability,
                    success=False,
                    latency_ms=latency,
                    normalized_error="INVALID_RESPONSE",
                    validation_status="INVALID",
                ))
                continue

            candidate_results.append(CandidateResult(
                model.provider_id,
                model.model_id,
                "RESPONSE_RECEIVED",
                output=sanitize_provider_text(response.content).strip(),
                capability=capability,
                success=True,
                latency_ms=latency,
                validation_status="VALID_UNTRUSTED",
            ))

        successes = [candidate for candidate in candidate_results if candidate.success is True]
        if not successes:
            validation_failed = any(candidate.validation_status == "INVALID" for candidate in candidate_results)
            outcome = "VALIDATION_FAILED" if validation_failed else "ALL_FAILED"
            return OrchestrationResult(
                mode=VERIFIED_MULTI_MODEL,
                selected_provider=None,
                selected_model=None,
                capability=capability,
                candidates=tuple(candidate_results),
                verification_status=outcome,
                available=False,
                failure_reason="No candidate returned a valid response.",
                failure_state=outcome,
                outcome=outcome,
            )
        if len(successes) != len(candidate_results):
            return OrchestrationResult(
                mode=VERIFIED_MULTI_MODEL,
                selected_provider=None,
                selected_model=None,
                capability=capability,
                candidates=tuple(candidate_results),
                verification_status="NOT_VERIFIED",
                available=True,
                failure_reason="Only a subset of candidates returned valid responses.",
                outcome="PARTIAL_SUCCESS",
            )

        raw_outputs = [candidate.output or "" for candidate in successes]
        normalized_outputs = [" ".join(output.split()).casefold() for output in raw_outputs]
        if len(set(normalized_outputs)) == 1:
            verification_status = "EXACT_TEXT_AGREEMENT" if len(set(raw_outputs)) == 1 else "NORMALIZED_TEXT_AGREEMENT"
            return OrchestrationResult(
                mode=VERIFIED_MULTI_MODEL,
                selected_provider=None,
                selected_model=None,
                capability=capability,
                candidates=tuple(candidate_results),
                verification_status=verification_status,
                available=True,
                failure_reason="Agreement is not proof of correctness.",
                outcome="VERIFIED_AGREEMENT",
            )
        return OrchestrationResult(
            mode=VERIFIED_MULTI_MODEL,
            selected_provider=None,
            selected_model=None,
            capability=capability,
            candidates=tuple(candidate_results),
            verification_status="DIVERGENT_TEXT",
            available=True,
            failure_reason="Candidate outputs differed; PARMAR did not select a winner.",
            outcome="VERIFIED_DISAGREEMENT",
        )

    @staticmethod
    def compare_candidates(candidates: tuple[CandidateResult, ...] | list[CandidateResult]) -> str:
        """Compare text deterministically; agreement is not a correctness proof."""
        outputs = [
            sanitize_provider_text(candidate.output or "").strip().casefold()
            for candidate in candidates
            if candidate.output and candidate.status == "RESPONSE_RECEIVED"
        ]
        if len(outputs) < 2:
            return "INSUFFICIENT_CANDIDATES"
        return "CONSISTENT" if len(set(outputs)) == 1 else "DIVERGENT"

    @staticmethod
    def _failure(
        mode: str,
        provider: str | None,
        model: str | None,
        capability: str,
        reason: str,
        state: str,
    ) -> OrchestrationResult:
        return OrchestrationResult(
            mode=mode,
            selected_provider=provider,
            selected_model=model,
            capability=capability,
            candidates=(),
            verification_status="NOT_RUN" if mode == VERIFIED_MULTI_MODEL else "NOT_REQUESTED",
            available=False,
            failure_reason=reason,
            failure_state=state,
        )