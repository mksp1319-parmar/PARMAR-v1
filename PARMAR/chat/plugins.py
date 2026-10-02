"""Universal, metadata-only provider plugin contract and deterministic registry."""

from __future__ import annotations

import inspect
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Protocol

from .context import ChatContext
from .models import ChatResponse
from .task_routing import CAPABILITIES, normalize_capability

LOCAL_FREE = "LOCAL_FREE"
FREE_ELIGIBLE = "FREE_ELIGIBLE"
PAID_ONLY = "PAID_ONLY"
UNKNOWN_PRICING = "UNKNOWN_PRICING"
DISABLED = "DISABLED"

_PRICING_POLICIES = {LOCAL_FREE, FREE_ELIGIBLE, PAID_ONLY, UNKNOWN_PRICING, DISABLED}
_AVAILABILITY = {"AVAILABLE", "NOT_CONFIGURED", "UNAVAILABLE", "DISABLED"}
_AUTHORIZATION = {"AUTHORIZED", "NOT_AUTHORIZED", "NOT_REQUIRED"}
_ACTIVATION = {"ACTIVE", "INACTIVE"}
_MODES = {"SINGLE_PROVIDER", "VERIFIED_MULTI_MODEL"}
_PLUGIN_TYPES = {
    "AI_PROVIDER", "AI_MODEL", "AI_TOOL", "AI_PLUGIN", "SEARCH", "RESEARCH",
    "VISION", "CODING_AS_TEXT", "TRANSLATION", "SUMMARIZATION", "VERIFICATION",
    "STRUCTURED_OUTPUT", "LOCAL_AI", "MCP_TOOL", "CONNECTOR",
}
_INTERFACE_TYPES = {
    "PARMAR_PLUGIN_API", "OFFICIAL_API", "OFFICIAL_PLUGIN_API",
    "OFFICIAL_TOOL_INTERFACE", "MCP", "OPENAI_COMPATIBLE", "PROVIDER_SDK",
    "LOCAL_PROTOCOL", "GENERIC_HTTP_JSON", "UNSUPPORTED_INTERFACE",
}
_INTERFACE_STATUSES = {
    "OFFICIAL_SUPPORTED", "STANDARD_SUPPORTED", "ARCHITECTURE_ONLY",
    "UNSUPPORTED_INTERFACE", "UNVERIFIED",
}
SUPPORTED_MANIFEST_VERSION = "1"
SUPPORTED_COMPATIBILITY_VERSION = "1"
COMPATIBILITY_SUPPORTED = "SUPPORTED"
COMPATIBILITY_INCOMPATIBLE = "INCOMPATIBLE"
COMPATIBILITY_INVALID = "INVALID"
COMPATIBILITY_DISABLED = "DISABLED"
_ID_PATTERN = re.compile(r"[a-z][a-z0-9._:-]{0,63}\Z")
_SECRET_PATTERN = re.compile(r"(api.?key|authorization|bearer|credential|password|secret|token|cookie)", re.I)


def adapter_implements_provider_contract(adapter: object) -> bool:
    """Check for a generate method without invoking adapter descriptors."""
    return callable(inspect.getattr_static(adapter, "generate", None))


class PluginAdapter(Protocol):
    """Adapter contract: implement PARMAR's existing provider interface."""

    name: str

    def generate(self, prompt: str, context: ChatContext | None = None) -> ChatResponse:
        """Return provider output as untrusted data; PARMAR owns all policy decisions."""
        ...


@dataclass(frozen=True)
class PluginMetadata:
    plugin_id: str
    provider_family: str
    display_name: str
    adapter_type: str
    capabilities: frozenset[str] = frozenset()
    locality: str = "unknown"
    pricing_policy: str = UNKNOWN_PRICING
    availability: str = "NOT_CONFIGURED"
    authorization_state: str = "NOT_AUTHORIZED"
    activation_state: str = "INACTIVE"
    supported_modes: frozenset[str] = frozenset({"SINGLE_PROVIDER", "VERIFIED_MULTI_MODEL"})
    version: str = "1"
    manifest_version: str = SUPPORTED_MANIFEST_VERSION
    compatibility_version: str = SUPPORTED_COMPATIBILITY_VERSION
    ecosystem: str = "future"
    plugin_type: str = "AI_PROVIDER"
    interface_type: str = "PARMAR_PLUGIN_API"
    interface_status: str = "ARCHITECTURE_ONLY"

    def __post_init__(self) -> None:
        for name in (
            "plugin_id", "provider_family", "display_name", "adapter_type", "version",
            "manifest_version", "compatibility_version", "ecosystem",
        ):
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip() or _SECRET_PATTERN.search(value):
                raise ValueError(f"Invalid plugin metadata field: {name}.")
        if not _ID_PATTERN.fullmatch(self.plugin_id):
            raise ValueError("Plugin IDs must be stable lowercase identifiers.")
        if not _ID_PATTERN.fullmatch(self.ecosystem):
            raise ValueError("Plugin ecosystems must be stable lowercase identifiers.")
        if self.plugin_type not in _PLUGIN_TYPES:
            raise ValueError("Plugin type is not supported.")
        if self.interface_type not in _INTERFACE_TYPES:
            raise ValueError("Plugin interface type is not supported.")
        if self.interface_status not in _INTERFACE_STATUSES:
            raise ValueError("Plugin interface status is not supported.")
        if not isinstance(self.capabilities, (set, frozenset, tuple, list)):
            raise ValueError("Capabilities must be a collection of allow-listed strings.")
        capabilities = frozenset(self.capabilities)
        if any(not isinstance(item, str) or item not in CAPABILITIES for item in capabilities):
            raise ValueError("Plugin capabilities must use PARMAR's capability allow-list.")
        if not isinstance(self.supported_modes, (set, frozenset, tuple, list)):
            raise ValueError("Supported modes must be a collection of known modes.")
        modes = frozenset(self.supported_modes)
        if not modes.issubset(_MODES):
            raise ValueError("Plugin supported modes contain an unknown mode.")
        if not modes:
            raise ValueError("Plugins must support at least one orchestration mode.")
        if self.locality not in {"local", "external", "unknown"}:
            raise ValueError("Plugin locality is invalid.")
        if self.pricing_policy not in _PRICING_POLICIES:
            raise ValueError("Plugin pricing policy is invalid.")
        if self.availability not in _AVAILABILITY:
            raise ValueError("Plugin availability is invalid.")
        if self.authorization_state not in _AUTHORIZATION:
            raise ValueError("Plugin authorization state is invalid.")
        if self.activation_state not in _ACTIVATION:
            raise ValueError("Plugin activation state is invalid.")
        object.__setattr__(self, "capabilities", capabilities)
        object.__setattr__(self, "supported_modes", modes)

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> PluginMetadata:
        """Parse a data-only manifest and reject undeclared or credential fields."""
        if not isinstance(value, Mapping):
            raise TypeError("Plugin manifest must be a mapping.")
        if not {"plugin_id", "provider_family", "display_name", "adapter_type"}.issubset(value):
            raise ValueError("Plugin manifest is missing required fields.")
        unknown_fields = set(value) - set(cls.__dataclass_fields__)
        if unknown_fields:
            raise ValueError("Plugin manifest contains unsupported fields.")
        return cls(**dict(value))

    def public_payload(self) -> dict[str, object]:
        return {
            "plugin_id": self.plugin_id,
            "provider_family": self.provider_family,
            "display_name": self.display_name,
            "adapter_type": self.adapter_type,
            "capabilities": sorted(self.capabilities),
            "locality": self.locality,
            "pricing_policy": self.pricing_policy,
            "availability": self.availability,
            "authorization_state": self.authorization_state,
            "activation_state": self.activation_state,
            "supported_modes": sorted(self.supported_modes),
            "version": self.version,
            "manifest_version": self.manifest_version,
            "compatibility_version": self.compatibility_version,
            "ecosystem": self.ecosystem,
            "plugin_type": self.plugin_type,
            "interface_type": self.interface_type,
            "interface_status": self.interface_status,
        }


PluginManifest = PluginMetadata


@dataclass(frozen=True)
class PluginCompatibilityResult:
    status: str
    reason: str


class PluginCompatibilityLayer:
    """Validate manifest shape and version without trusting plugin behavior."""

    @staticmethod
    def evaluate(candidate: object) -> PluginCompatibilityResult:
        try:
            manifest = candidate if type(candidate) is PluginMetadata else PluginMetadata.from_mapping(candidate)
        except (TypeError, ValueError):
            return PluginCompatibilityResult(COMPATIBILITY_INVALID, "INVALID_MANIFEST")
        if (
            manifest.manifest_version != SUPPORTED_MANIFEST_VERSION
            or manifest.compatibility_version != SUPPORTED_COMPATIBILITY_VERSION
        ):
            return PluginCompatibilityResult(COMPATIBILITY_INCOMPATIBLE, "UNSUPPORTED_VERSION")
        if manifest.availability == "DISABLED" or manifest.pricing_policy == DISABLED:
            return PluginCompatibilityResult(COMPATIBILITY_DISABLED, "PLUGIN_DISABLED")
        return PluginCompatibilityResult(COMPATIBILITY_SUPPORTED, "COMPATIBLE")


def plugin_interface_supported(metadata: PluginMetadata) -> bool:
    """Only trusted interface declarations may reach the existing adapter router."""
    if metadata.interface_type == "UNSUPPORTED_INTERFACE" or metadata.interface_status in {
        "UNSUPPORTED_INTERFACE", "UNVERIFIED",
    }:
        return False
    if metadata.interface_status == "ARCHITECTURE_ONLY":
        return metadata.locality == "local" and metadata.interface_type == "PARMAR_PLUGIN_API"
    return True


@dataclass(frozen=True)
class PluginRegistration:
    metadata: PluginMetadata
    adapter: PluginAdapter | None = field(default=None, repr=False, compare=False)


class PluginRegistry:
    """Stores trusted plugin declarations without invoking provider adapters."""

    def __init__(self, registrations: tuple[PluginRegistration, ...] = ()) -> None:
        self._registrations: dict[str, PluginRegistration] = {}
        for registration in registrations:
            self.register(registration)

    def register(self, registration: PluginRegistration) -> None:
        if type(registration) is not PluginRegistration or type(registration.metadata) is not PluginMetadata:
            raise TypeError("Only validated plugin metadata registrations are accepted.")
        compatibility = PluginCompatibilityLayer.evaluate(registration.metadata)
        if compatibility.status in {COMPATIBILITY_INVALID, COMPATIBILITY_INCOMPATIBLE}:
            raise ValueError(f"Plugin manifest is {compatibility.status.lower()}.")
        plugin_id = registration.metadata.plugin_id
        if plugin_id in self._registrations:
            raise ValueError("A plugin with this ID is already registered.")
        adapter = registration.adapter
        if adapter is not None and not adapter_implements_provider_contract(adapter):
            raise TypeError("Plugin adapters must implement the existing provider interface.")
        self._registrations[plugin_id] = registration

    def list_plugins(self) -> tuple[PluginMetadata, ...]:
        return tuple(registration.metadata for registration in self._registration_entries())

    def _registration_entries(self) -> tuple[PluginRegistration, ...]:
        return tuple(self._registrations[key] for key in sorted(self._registrations))

    def get_plugin(self, plugin_id: str) -> PluginMetadata | None:
        registration = self._registrations.get(plugin_id) if isinstance(plugin_id, str) else None
        return registration.metadata if registration is not None else None

    def find_capable_plugins(self, capability: str) -> tuple[PluginMetadata, ...]:
        normalized = normalize_capability(capability)
        if normalized not in CAPABILITIES:
            return ()
        return tuple(
            metadata for metadata in self.list_plugins()
            if normalized in metadata.capabilities
        )

    def get_plugin_status(self, plugin_id: str) -> dict[str, object] | None:
        registration = self._registrations.get(plugin_id) if isinstance(plugin_id, str) else None
        if registration is None:
            return None
        metadata = registration.metadata
        executable_adapter = adapter_implements_provider_contract(registration.adapter)
        policy_eligible = metadata.pricing_policy in {LOCAL_FREE, FREE_ELIGIBLE}
        compatibility = PluginCompatibilityLayer.evaluate(metadata)
        authorization_eligible = metadata.authorization_state == "AUTHORIZED" or (
            metadata.locality == "local" and metadata.authorization_state == "NOT_REQUIRED"
        )
        capability_eligible = bool(metadata.capabilities)
        eligible = (
            executable_adapter
            and compatibility.status == COMPATIBILITY_SUPPORTED
            and plugin_interface_supported(metadata)
            and metadata.availability == "AVAILABLE"
            and authorization_eligible
            and metadata.activation_state == "ACTIVE"
            and policy_eligible
            and capability_eligible
        )
        status = metadata.public_payload()
        status["adapter_configured"] = executable_adapter
        status["compatibility_status"] = compatibility.status
        status["compatibility_reason"] = compatibility.reason
        status["eligible"] = eligible
        if compatibility.status != COMPATIBILITY_SUPPORTED:
            status["eligibility_reason"] = compatibility.reason
        elif not plugin_interface_supported(metadata):
            status["eligibility_reason"] = metadata.interface_status
        elif not policy_eligible:
            status["eligibility_reason"] = "FREE_POLICY_BLOCKED"
        elif not executable_adapter or metadata.availability != "AVAILABLE":
            status["eligibility_reason"] = "NOT_AVAILABLE"
        elif not authorization_eligible:
            status["eligibility_reason"] = "NOT_AUTHORIZED"
        elif metadata.activation_state != "ACTIVE":
            status["eligibility_reason"] = "INACTIVE"
        elif not capability_eligible:
            status["eligibility_reason"] = "NO_CAPABILITY_DECLARED"
        else:
            status["eligibility_reason"] = "ELIGIBLE"
        return status


def default_plugin_registrations() -> tuple[PluginRegistration, ...]:
    """Describe initial provider families without claiming configuration or access."""
    families = (
        ("openai", "OpenAI / ChatGPT", "openai_compatible", "external", "openai", "OFFICIAL_API", "OFFICIAL_SUPPORTED"),
        ("anthropic", "Anthropic / Claude", "anthropic_api", "external", "anthropic", "OFFICIAL_API", "OFFICIAL_SUPPORTED"),
        ("google_gemini", "Google Gemini", "gemini_api", "external", "google", "OFFICIAL_API", "OFFICIAL_SUPPORTED"),
        ("perplexity", "Perplexity", "official_adapter", "external", "perplexity", "OFFICIAL_API", "OFFICIAL_SUPPORTED"),
        ("mistral", "Mistral", "official_adapter", "external", "mistral", "OFFICIAL_API", "OFFICIAL_SUPPORTED"),
        ("cohere", "Cohere", "official_adapter", "external", "cohere", "OFFICIAL_API", "OFFICIAL_SUPPORTED"),
        ("groq", "Groq", "openai_compatible", "external", "groq", "OPENAI_COMPATIBLE", "OFFICIAL_SUPPORTED"),
        ("xai_grok", "xAI / Grok", "openai_compatible", "external", "xai", "OPENAI_COMPATIBLE", "OFFICIAL_SUPPORTED"),
        ("deepseek", "DeepSeek", "openai_compatible", "external", "deepseek", "OPENAI_COMPATIBLE", "OFFICIAL_SUPPORTED"),
        ("qwen", "Qwen", "official_adapter", "external", "qwen", "PROVIDER_SDK", "OFFICIAL_SUPPORTED"),
        ("meta_llama", "Meta / Llama-compatible", "compatible_adapter", "unknown", "meta", "UNSUPPORTED_INTERFACE", "UNVERIFIED"),
        ("microsoft_azure", "Microsoft / Azure AI-compatible", "azure_adapter", "external", "microsoft", "OFFICIAL_API", "OFFICIAL_SUPPORTED"),
        ("hugging_face", "Hugging Face-compatible", "http_json", "unknown", "huggingface", "OFFICIAL_API", "OFFICIAL_SUPPORTED"),
        ("ollama_local", "Ollama / local models", "local_adapter", "local", "ollama", "LOCAL_PROTOCOL", "OFFICIAL_SUPPORTED"),
        ("openai_compatible", "Generic OpenAI-compatible API", "openai_compatible", "unknown", "generic", "OPENAI_COMPATIBLE", "STANDARD_SUPPORTED"),
        ("http_json", "Generic HTTP JSON AI provider", "http_json", "unknown", "generic", "GENERIC_HTTP_JSON", "STANDARD_SUPPORTED"),
        ("mcp_tools", "MCP-compatible tools", "mcp_adapter", "unknown", "mcp", "MCP", "STANDARD_SUPPORTED"),
        ("generic_ai_plugin", "Generic standards-based AI plugin", "generic_adapter", "unknown", "generic", "OFFICIAL_PLUGIN_API", "UNVERIFIED"),
        ("generic_connector", "Generic data connector", "generic_adapter", "unknown", "generic", "OFFICIAL_TOOL_INTERFACE", "UNVERIFIED"),
    )
    return tuple(
        PluginRegistration(PluginMetadata(
            plugin_id=plugin_id,
            provider_family=plugin_id,
            display_name=display_name,
            adapter_type=adapter_type,
            ecosystem=ecosystem,
            interface_type=interface_type,
            interface_status=interface_status,
            plugin_type="MCP_TOOL" if plugin_id == "mcp_tools" else (
                "CONNECTOR" if plugin_id == "generic_connector" else "AI_PROVIDER"
            ),
            locality=locality,
        ))
        for plugin_id, display_name, adapter_type, locality, ecosystem, interface_type, interface_status in families
    )


def default_plugin_registry() -> PluginRegistry:
    """Return a fresh registry containing known families in blocked default states."""
    return PluginRegistry(default_plugin_registrations())