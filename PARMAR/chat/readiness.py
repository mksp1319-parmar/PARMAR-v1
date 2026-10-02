"""Safe provider configuration readiness and external authorization policy."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any, Mapping

from .context import sanitize_provider_text
from .providers import (
    PROVIDER_ENV,
    PROVIDER_REGISTRY,
    UnavailableProvider,
    provider_for_selection,
    provider_from_environment,
)

EXTERNAL_MULTI_MODEL_ENV = "PARMAR_VERIFIED_MULTI_MODEL_EXTERNAL_ENABLED"
SINGLE_PROVIDER_EXTERNAL = "SINGLE_PROVIDER_EXTERNAL"
VERIFIED_MULTI_MODEL_EXTERNAL = "VERIFIED_MULTI_MODEL_EXTERNAL"
LOCAL_FREE = "LOCAL_FREE"
FREE_API = "FREE_API"
PAID_ONLY = "PAID_ONLY"
UNKNOWN = "UNKNOWN"
FREE_QUOTA_AVAILABLE = "FREE_QUOTA_AVAILABLE"
FREE_QUOTA_UNAVAILABLE = "FREE_QUOTA_UNAVAILABLE"
FREE_STATUS_UNKNOWN = "FREE_STATUS_UNKNOWN"
NOT_APPLICABLE = "NOT_APPLICABLE"
_SAFE_MODEL_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,95}")
_CAPABILITY_METADATA = {
    "local-demo": ("text_generation",),
    "http-json": ("text_generation",),
    "openai": ("text_generation",),
    "gemini": ("text_generation",),
    "claude": ("text_generation",),
}
_PROVIDER_ENV_REQUIREMENTS = {
    "local-demo": {"model": None, "credential": None, "endpoint": None, "endpoint_optional": False},
    "http-json": {
        "model": "PARMAR_CHAT_MODEL",
        "credential": "PARMAR_CHAT_API_KEY",
        "endpoint": "PARMAR_CHAT_ENDPOINT",
        "endpoint_optional": False,
    },
    "openai": {
        "model": "PARMAR_OPENAI_MODEL",
        "credential": "PARMAR_OPENAI_API_KEY",
        "endpoint": "PARMAR_OPENAI_ENDPOINT",
        "endpoint_optional": True,
    },
    "gemini": {
        "model": "PARMAR_GEMINI_MODEL",
        "credential": "PARMAR_GEMINI_API_KEY",
        "endpoint": "PARMAR_GEMINI_ENDPOINT",
        "endpoint_optional": True,
    },
    "claude": {
        "model": "PARMAR_CLAUDE_MODEL",
        "credential": "PARMAR_CLAUDE_API_KEY",
        "endpoint": "PARMAR_CLAUDE_ENDPOINT",
        "endpoint_optional": True,
    },
}


@dataclass(frozen=True)
class ProviderVerificationRecord:
    """Non-authorizing pricing evidence; model scope is an exact allow-list."""

    provider: str
    access_type: str
    free_status: str
    model_scope: tuple[str, ...]
    quota_status: str
    payment_requirement: str
    authorization_requirement: str
    source_reference: tuple[str, ...]
    verification_date: str
    limitations: str

    def public_payload(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "access_type": self.access_type,
            "free_status": self.free_status,
            "model_scope": list(self.model_scope),
            "quota_status": self.quota_status,
            "payment_requirement": self.payment_requirement,
            "authorization_requirement": self.authorization_requirement,
            "source_reference": list(self.source_reference),
            "verification_date": self.verification_date,
            "limitations": self.limitations,
        }


_OFFICIAL_VERIFICATION_RECORDS = (
    ProviderVerificationRecord(
        provider="local-demo",
        access_type="local deterministic demo",
        free_status=LOCAL_FREE,
        model_scope=("local-demo",),
        quota_status=NOT_APPLICABLE,
        payment_requirement="none",
        authorization_requirement="not required for local demo",
        source_reference=("PARMAR/chat/providers.py",),
        verification_date="2026-10-01",
        limitations="Deterministic canned response; not local model inference.",
    ),
    ProviderVerificationRecord(
        provider="openai",
        access_type="official API",
        free_status=PAID_ONLY,
        model_scope=(),
        quota_status=NOT_APPLICABLE,
        payment_requirement="generative model API use is metered and priced",
        authorization_requirement="separate explicit PARMAR authorization required",
        source_reference=("https://developers.openai.com/api/docs/pricing",),
        verification_date="2026-10-01",
        limitations="The pricing page lists free services such as moderation, not free generative model inference. Consumer ChatGPT access is not API authorization.",
    ),
    ProviderVerificationRecord(
        provider="gemini",
        access_type="official Gemini Developer API",
        free_status=FREE_API,
        model_scope=(),
        quota_status=FREE_STATUS_UNKNOWN,
        payment_requirement="documented Free Tier; Paid Tier requires linked billing and prepaid credits",
        authorization_requirement="separate explicit PARMAR authorization required",
        source_reference=(
            "https://ai.google.dev/gemini-api/docs/pricing",
            "https://ai.google.dev/gemini-api/docs/billing",
            "https://ai.google.dev/gemini-api/docs/rate-limits",
            "https://ai.google.dev/gemini-api/terms",
        ),
        verification_date="2026-10-01",
        limitations="Official docs say only certain models have free-tier access. Configured model IDs are not mapped to an exact verified free-model allow-list here, and live per-project quota is unknown. Unpaid-tier content/data terms may differ by region.",
    ),
    ProviderVerificationRecord(
        provider="claude",
        access_type="official Anthropic API",
        free_status=PAID_ONLY,
        model_scope=(),
        quota_status=NOT_APPLICABLE,
        payment_requirement="model API usage is priced per token",
        authorization_requirement="separate explicit PARMAR authorization required",
        source_reference=(
            "https://docs.anthropic.com/en/docs/about-claude/pricing",
            "https://docs.anthropic.com/en/api/rate-limits",
        ),
        verification_date="2026-10-01",
        limitations="No generally available free inference quota was verified in the official API pricing documentation. Consumer Claude plans are not treated as API access.",
    ),
    ProviderVerificationRecord(
        provider="http-json",
        access_type="generic third-party HTTP API",
        free_status=UNKNOWN,
        model_scope=(),
        quota_status=FREE_STATUS_UNKNOWN,
        payment_requirement="unknown; depends on endpoint owner",
        authorization_requirement="separate explicit PARMAR authorization required",
        source_reference=(),
        verification_date="2026-10-01",
        limitations="A generic endpoint has no provider-independent pricing or quota terms; it remains blocked unless separately verified.",
    ),
    ProviderVerificationRecord(
        provider="ollama-local-candidate",
        access_type="self-hosted local runtime candidate",
        free_status=UNKNOWN,
        model_scope=(),
        quota_status=NOT_APPLICABLE,
        payment_requirement="no external API fee if fully local; hardware and electricity costs may apply",
        authorization_requirement="runtime/model must be explicitly configured and license reviewed",
        source_reference=("https://docs.ollama.com/faq",),
        verification_date="2026-10-01",
        limitations="No Ollama adapter/runtime/model is configured in this repository. Each model has its own license; local execution is not verified or enabled.",
    ),
)


@dataclass(frozen=True)
class FreePolicyDecision:
    provider: str
    model: str
    outcome: str
    eligible: bool
    free_status: str
    quota_status: str

    def public_payload(self) -> dict[str, str | bool]:
        return {
            "provider": self.provider,
            "model": self.model,
            "outcome": self.outcome,
            "eligible": self.eligible,
            "free_status": self.free_status,
            "quota_status": self.quota_status,
        }


class ProviderFreePolicy:
    """Deny-by-default free-use policy driven by reviewed server-side records."""

    def __init__(
        self,
        records: tuple[ProviderVerificationRecord, ...] | None = None,
        quota_statuses: Mapping[tuple[str, str], str] | None = None,
    ) -> None:
        self.records = tuple(records if records is not None else _OFFICIAL_VERIFICATION_RECORDS)
        self._by_provider = {record.provider.lower(): record for record in self.records}
        self.quota_statuses = dict(quota_statuses or {})

    def record_for(self, provider_id: str) -> ProviderVerificationRecord | None:
        return self._by_provider.get(provider_id.lower()) if isinstance(provider_id, str) else None

    def verification_records(self) -> tuple[ProviderVerificationRecord, ...]:
        return self.records

    def evaluate(self, provider_id: str, model_id: str) -> FreePolicyDecision:
        provider = provider_id.strip().lower() if isinstance(provider_id, str) else ""
        model = model_id.strip() if isinstance(model_id, str) else ""
        record = self.record_for(provider)
        if record is None:
            return FreePolicyDecision(provider or "unknown", model or "unknown", "UNKNOWN_PRICING_BLOCKED", False, UNKNOWN, FREE_STATUS_UNKNOWN)
        quota_status = self.quota_statuses.get((provider, model), record.quota_status)
        if record.free_status == PAID_ONLY:
            outcome = "PAID_PROVIDER_BLOCKED"
        elif record.free_status not in {LOCAL_FREE, FREE_API}:
            outcome = "UNKNOWN_PRICING_BLOCKED"
        elif record.free_status == LOCAL_FREE:
            outcome = "FREE_ALLOWED" if model in record.model_scope else "UNKNOWN_PRICING_BLOCKED"
        elif model not in record.model_scope:
            outcome = "UNKNOWN_PRICING_BLOCKED"
        elif quota_status != FREE_QUOTA_AVAILABLE:
            outcome = "FREE_QUOTA_UNAVAILABLE"
        else:
            outcome = "FREE_ALLOWED"
        return FreePolicyDecision(
            provider=provider,
            model=model,
            outcome=outcome,
            eligible=outcome == "FREE_ALLOWED",
            free_status=record.free_status,
            quota_status=quota_status,
        )


@dataclass(frozen=True)
class AuthorizationDecision:
    outcome: str
    authorized: bool

    def public_payload(self) -> dict[str, str | bool]:
        return {"outcome": self.outcome, "authorized": self.authorized}


@dataclass(frozen=True)
class ExternalAuthorization:
    """Injectable server-side allow-list; defaults to denying external use."""

    enabled: bool = False
    allowed_providers: frozenset[str] = frozenset()
    allowed_capabilities: frozenset[str] = frozenset()
    allow_single_provider: bool = False
    allow_verified_multi_model: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "allowed_providers", frozenset(
            item.strip().lower() for item in self.allowed_providers if isinstance(item, str)
        ))
        object.__setattr__(self, "allowed_capabilities", frozenset(
            item.strip().lower() for item in self.allowed_capabilities if isinstance(item, str)
        ))

    def evaluate(self, provider_id: str, capability: str, mode: str) -> AuthorizationDecision:
        provider = provider_id.strip().lower() if isinstance(provider_id, str) else ""
        requested_capability = capability.strip().lower() if isinstance(capability, str) else ""
        if not self.enabled:
            return AuthorizationDecision("EXTERNAL_AUTH_REQUIRED", False)
        if provider not in self.allowed_providers:
            return AuthorizationDecision("EXTERNAL_PROVIDER_NOT_ALLOWED", False)
        if requested_capability not in self.allowed_capabilities:
            return AuthorizationDecision("EXTERNAL_CAPABILITY_NOT_ALLOWED", False)
        if mode == SINGLE_PROVIDER_EXTERNAL and self.allow_single_provider:
            return AuthorizationDecision("EXTERNAL_AUTHORIZED", True)
        if mode == VERIFIED_MULTI_MODEL_EXTERNAL and self.allow_verified_multi_model:
            return AuthorizationDecision("EXTERNAL_AUTHORIZED", True)
        return AuthorizationDecision("EXTERNAL_MODE_NOT_ALLOWED", False)


@dataclass(frozen=True)
class ProviderConfiguration:
    provider_id: str
    kind: str
    model_id: str | None
    enabled: bool
    configuration_status: str
    status: str
    endpoint_configuration: str
    credential_configured: bool
    free_status: str
    free_quota_status: str
    free_policy_outcome: str
    authorized: bool
    authorization_status: str
    capabilities: tuple[str, ...]
    input_modalities: tuple[str, ...]
    output_modalities: tuple[str, ...]
    single_provider_eligible: bool
    verified_multi_model_eligible: bool
    readiness: str

    def public_payload(self) -> dict[str, Any]:
        return {
            "id": self.provider_id,
            "kind": self.kind,
            "model_id": self.model_id,
            "enabled": self.enabled,
            "configured": self.configuration_status in {"CONFIGURED", "LOCAL"},
            "configuration_status": self.configuration_status,
            "status": self.status,
            "endpoint_configuration": self.endpoint_configuration,
            "credential_configured": self.credential_configured,
            "free_status": self.free_status,
            "free_quota_status": self.free_quota_status,
            "free_policy_outcome": self.free_policy_outcome,
            "authorized": self.authorized,
            "authorization_status": self.authorization_status,
            "capabilities": list(self.capabilities),
            "input_modalities": list(self.input_modalities),
            "output_modalities": list(self.output_modalities),
            "single_provider_eligible": self.single_provider_eligible,
            "verified_multi_model_eligible": self.verified_multi_model_eligible,
            "readiness": self.readiness,
        }


class ProviderConfigurationRegistry:
    """Inspect allow-listed configuration and authorization without requests."""

    def __init__(
        self,
        environ: Mapping[str, str] | None = None,
        authorization: ExternalAuthorization | None = None,
        free_policy: ProviderFreePolicy | None = None,
    ) -> None:
        self.environ = os.environ if environ is None else environ
        self.authorization = authorization or ExternalAuthorization()
        self.free_policy = free_policy or ProviderFreePolicy()

    @classmethod
    def discover(
        cls,
        environ: Mapping[str, str] | None = None,
        authorization: ExternalAuthorization | None = None,
        free_policy: ProviderFreePolicy | None = None,
    ) -> ProviderConfigurationRegistry:
        return cls(environ=environ, authorization=authorization, free_policy=free_policy)

    @staticmethod
    def _safe_model_id(value: object) -> str | None:
        if not isinstance(value, str) or not _SAFE_MODEL_ID.fullmatch(value):
            return "configured" if value else None
        if sanitize_provider_text(value) != value:
            return "configured"
        lowered = value.lower()
        if any(marker in lowered for marker in ("secret", "token", "credential", "authorization", "api_key", "bearer")):
            return "configured"
        return value

    @staticmethod
    def _present(values: Mapping[str, str], variable: str | None) -> bool:
        return bool(variable and isinstance(values.get(variable), str) and values[variable].strip())

    def _entry(self, provider_id: str, selected_provider: str) -> ProviderConfiguration:
        kind = "local" if provider_id == "local-demo" else "external"
        requirements = _PROVIDER_ENV_REQUIREMENTS[provider_id]
        model_env = requirements["model"]
        credential_env = requirements["credential"]
        endpoint_env = requirements["endpoint"]
        model_present = self._present(self.environ, model_env)
        credential_present = self._present(self.environ, credential_env)
        endpoint_present = self._present(self.environ, endpoint_env)

        if kind == "local":
            adapter = provider_for_selection(provider_id, self.environ)
            configuration_status = "LOCAL"
            endpoint_status = "NOT_REQUIRED"
            credential_present = False
            model_id = provider_id
            configured = True
        else:
            endpoint_status = (
                "CONFIGURED" if endpoint_present else
                "DEFAULT" if requirements["endpoint_optional"] else "MISSING"
            )
            required_present = model_present and credential_present and (
                endpoint_present or requirements["endpoint_optional"]
            )
            adapter = provider_for_selection(provider_id, self.environ)
            if not required_present:
                configuration_status = "NOT_CONFIGURED"
            elif isinstance(adapter, UnavailableProvider):
                configuration_status = "INVALID_CONFIGURATION"
                if endpoint_present:
                    endpoint_status = "INVALID"
            else:
                configuration_status = "CONFIGURED"
            configured = configuration_status == "CONFIGURED"
            model_value = self.environ.get(model_env) if model_env else provider_id
            model_id = self._safe_model_id(model_value)

        enabled = configured and (provider_id == selected_provider)
        free_decision = self.free_policy.evaluate(provider_id, model_id or "")
        decision = self.authorization.evaluate(
            provider_id,
            "text_generation",
            SINGLE_PROVIDER_EXTERNAL,
        ) if kind == "external" else AuthorizationDecision("NOT_REQUIRED", True)
        single_eligible = configured and free_decision.eligible and (
            kind == "local" or decision.authorized
        )
        external_multi_enabled = self.environ.get(EXTERNAL_MULTI_MODEL_ENV, "").strip().lower() in {
            "1", "true", "yes", "on",
        }
        multi_decision = self.authorization.evaluate(
            provider_id,
            "text_generation",
            VERIFIED_MULTI_MODEL_EXTERNAL,
        ) if kind == "external" else AuthorizationDecision("NOT_REQUIRED", True)
        multi_eligible = configured and free_decision.eligible and external_multi_enabled and (
            kind == "local" or multi_decision.authorized
        )

        if kind == "local":
            status = "LOCAL"
            readiness = "LOCAL"
        elif configuration_status == "NOT_CONFIGURED":
            status = "NOT_CONFIGURED"
            readiness = "NOT_CONFIGURED"
        elif configuration_status == "INVALID_CONFIGURATION":
            status = "INVALID_CONFIGURATION"
            readiness = "INVALID_CONFIGURATION"
        elif not enabled:
            status = "DISABLED"
            readiness = "EXTERNAL_DISABLED"
        elif free_decision.outcome == "PAID_PROVIDER_BLOCKED":
            status = "PAID_BLOCKED"
            readiness = "PAID_BLOCKED"
        elif free_decision.outcome == "UNKNOWN_PRICING_BLOCKED":
            status = "UNKNOWN_PRICING_BLOCKED"
            readiness = "UNKNOWN_PRICING_BLOCKED"
        elif free_decision.outcome == "FREE_QUOTA_UNAVAILABLE":
            status = "FREE_QUOTA_UNAVAILABLE"
            readiness = "FREE_QUOTA_UNAVAILABLE"
        elif not decision.authorized:
            status = "NOT_AUTHORIZED"
            readiness = "NOT_AUTHORIZED"
        elif not external_multi_enabled:
            status = "FREE_API_READY"
            readiness = "READY_FOR_TESTING"
        elif decision.authorized:
            status = "CONFIGURED_AUTHORIZED"
            readiness = "READY_FOR_TESTING"
        else:
            status = "CONFIGURED_NOT_AUTHORIZED"
            readiness = "EXTERNAL_DISABLED"

        return ProviderConfiguration(
            provider_id=provider_id,
            kind=kind,
            model_id=model_id,
            enabled=enabled,
            configuration_status=configuration_status,
            status=status,
            endpoint_configuration=endpoint_status,
            credential_configured=credential_present,
            free_status=free_decision.free_status,
            free_quota_status=free_decision.quota_status,
            free_policy_outcome=free_decision.outcome,
            authorized=decision.authorized,
            authorization_status=decision.outcome,
            capabilities=_CAPABILITY_METADATA[provider_id],
            input_modalities=("text",),
            output_modalities=("text",),
            single_provider_eligible=single_eligible,
            verified_multi_model_eligible=multi_eligible,
            readiness=readiness,
        )

    def entries(self) -> tuple[ProviderConfiguration, ...]:
        selected_value = self.environ.get(PROVIDER_ENV, "")
        selected_provider = (
            selected_value.strip().lower()
            if isinstance(selected_value, str) and selected_value.strip()
            else getattr(provider_from_environment(self.environ), "name", "local-demo")
        )
        return tuple(self._entry(provider_id, selected_provider) for provider_id in PROVIDER_REGISTRY)

    def public_payload(self) -> dict[str, Any]:
        selected_value = self.environ.get(PROVIDER_ENV, "")
        selected_provider = (
            selected_value.strip().lower()
            if isinstance(selected_value, str) and selected_value.strip()
            else getattr(provider_from_environment(self.environ), "name", "local-demo")
        )
        if selected_provider not in PROVIDER_REGISTRY:
            selected_provider = "unavailable"
        external_multi_enabled = self.environ.get(EXTERNAL_MULTI_MODEL_ENV, "").strip().lower() in {
            "1", "true", "yes", "on",
        }
        return {
            "providers": [entry.public_payload() for entry in self.entries()],
            "default_provider": selected_provider,
            "external_multi_model_enabled": external_multi_enabled,
            "reachability": "NOT_CHECKED",
        }