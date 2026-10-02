"""Chat provider adapters routed through PARMAR safety."""

from .context import ChatContext
from .models import ChatMessage, ChatResponse
from .readiness import (
    AuthorizationDecision,
    ExternalAuthorization,
    ProviderConfiguration,
    ProviderConfigurationRegistry,
)
from .plugins import (
    DISABLED,
    FREE_ELIGIBLE,
    LOCAL_FREE,
    PAID_ONLY,
    UNKNOWN_PRICING,
    PluginAdapter,
    PluginMetadata,
    PluginRegistration,
    PluginRegistry,
    default_plugin_registrations,
    default_plugin_registry,
)
from .orchestration import (
    AIOrchestrator,
    CandidateResult,
    MAX_VERIFIED_CANDIDATES,
    OrchestrationResult,
    ProviderModelCapability,
    ProviderModelRegistry,
    SINGLE_PROVIDER,
    VERIFIED_MULTI_MODEL,
    VERIFIED_MULTI_MODEL_EXTERNAL_ENV,
)
from .providers import (
    ChatProvider,
    ClaudeChatProvider,
    GeminiChatProvider,
    HTTPChatProvider,
    LocalDemoProvider,
    OpenAIChatProvider,
    PROVIDER_REGISTRY,
)
from .router import ChatRouter
from .service import ChatService
from .task_routing import CAPABILITIES, infer_task_capability, normalize_capability, task_to_capability

__all__ = [
    "ChatContext",
    "ChatMessage",
    "ChatResponse",
    "AuthorizationDecision",
    "ExternalAuthorization",
    "ProviderConfiguration",
    "ProviderConfigurationRegistry",
    "DISABLED",
    "FREE_ELIGIBLE",
    "LOCAL_FREE",
    "PAID_ONLY",
    "UNKNOWN_PRICING",
    "PluginAdapter",
    "PluginMetadata",
    "PluginRegistration",
    "PluginRegistry",
    "default_plugin_registrations",
    "default_plugin_registry",
    "AIOrchestrator",
    "CandidateResult",
    "MAX_VERIFIED_CANDIDATES",
    "OrchestrationResult",
    "ProviderModelCapability",
    "ProviderModelRegistry",
    "SINGLE_PROVIDER",
    "VERIFIED_MULTI_MODEL",
    "VERIFIED_MULTI_MODEL_EXTERNAL_ENV",
    "ChatProvider",
    "ClaudeChatProvider",
    "GeminiChatProvider",
    "HTTPChatProvider",
    "LocalDemoProvider",
    "OpenAIChatProvider",
    "PROVIDER_REGISTRY",
    "ChatRouter",
    "ChatService",
    "CAPABILITIES",
    "infer_task_capability",
    "normalize_capability",
    "task_to_capability",
]
