import pytest

from PARMAR.chat.models import ChatResponse
from PARMAR.chat.orchestration import (
    AIOrchestrator,
    SINGLE_PROVIDER,
    VERIFIED_MULTI_MODEL,
)
from PARMAR.chat.plugins import (
    FREE_ELIGIBLE,
    LOCAL_FREE,
    PAID_ONLY,
    UNKNOWN_PRICING,
    PluginMetadata,
    PluginCompatibilityLayer,
    PluginManifest,
    PluginRegistration,
    PluginRegistry,
    default_plugin_registry,
)
from PARMAR.chat.readiness import ExternalAuthorization
from PARMAR.chat.task_routing import (
    CAPABILITIES,
    CODING_AS_TEXT,
    REASONING,
    STRUCTURED_OUTPUT,
    SUMMARIZATION,
    TEXT,
    TRANSLATION,
    VERIFICATION,
    VISION,
    infer_task_capability,
    task_to_capability,
)


class FakePlugin:
    def __init__(self, name):
        self.name = name
        self.calls = []

    def generate(self, prompt, context=None):
        self.calls.append((prompt, context))
        return ChatResponse(provider=self.name, content="Untrusted fake response", safe=False)


class FakeOpenAIPlugin(FakePlugin):
    pass


class FakeClaudePlugin(FakePlugin):
    pass


class FakeGeminiPlugin(FakePlugin):
    pass


class FakePerplexityPlugin(FakePlugin):
    pass


class FakeLocalAIPlugin(FakePlugin):
    pass


class FakeReasoningPlugin(FakePlugin):
    pass


class FakeVisionPlugin(FakePlugin):
    pass


class FakePaidPlugin(FakePlugin):
    pass


class FakeUnknownPricingPlugin(FakePlugin):
    pass


class FakeUnavailablePlugin(FakePlugin):
    pass


class DescriptorPlugin:
    @property
    def generate(self):
        raise AssertionError("Adapter descriptors must not run during registration.")


def make_registration(
    plugin_id,
    adapter,
    *,
    capabilities=(TEXT,),
    locality="local",
    pricing=LOCAL_FREE,
    availability="AVAILABLE",
    authorization="NOT_REQUIRED",
    activation="ACTIVE",
    modes=(SINGLE_PROVIDER, VERIFIED_MULTI_MODEL),
    ecosystem="test",
    plugin_type="AI_PROVIDER",
    interface_type="PARMAR_PLUGIN_API",
    interface_status="ARCHITECTURE_ONLY",
    manifest_version="1",
    compatibility_version="1",
):
    return PluginRegistration(
        PluginMetadata(
            plugin_id=plugin_id,
            provider_family=plugin_id,
            display_name=plugin_id,
            adapter_type="fake",
            capabilities=frozenset(capabilities),
            locality=locality,
            pricing_policy=pricing,
            availability=availability,
            authorization_state=authorization,
            activation_state=activation,
            supported_modes=frozenset(modes),
            ecosystem=ecosystem,
            plugin_type=plugin_type,
            interface_type=interface_type,
            interface_status=interface_status,
            manifest_version=manifest_version,
            compatibility_version=compatibility_version,
        ),
        adapter,
    )


@pytest.mark.parametrize(
    ("task", "expected"),
    [
        ("normal conversation", TEXT),
        ("complex reasoning", REASONING),
        ("code generation", CODING_AS_TEXT),
        ("summarize text", SUMMARIZATION),
        ("language conversion", TRANSLATION),
        ("json/schema output", STRUCTURED_OUTPUT),
        ("cross-check/verification", VERIFICATION),
        ("image understanding", VISION),
    ],
)
def test_task_labels_map_to_the_existing_capability_allow_list(task, expected):
    assert task_to_capability(task) == expected
    assert expected in CAPABILITIES


@pytest.mark.parametrize(
    ("prompt", "expected"),
    [
        ("Hello, can you help?", TEXT),
        ("Work through this complex reasoning problem", REASONING),
        ("Generate code for a parser", CODING_AS_TEXT),
        ("Summarize this report", SUMMARIZATION),
        ("Translate this into French", TRANSLATION),
        ("Return JSON matching this schema", STRUCTURED_OUTPUT),
        ("Cross-check this claim", VERIFICATION),
        ("Describe this image", VISION),
    ],
)
def test_prompt_classification_is_deterministic(prompt, expected):
    assert infer_task_capability(prompt) == expected


def test_default_registry_represents_provider_families_without_claiming_readiness():
    registry = default_plugin_registry()
    ids = {item.plugin_id for item in registry.list_plugins()}

    assert ids == {
        "openai", "anthropic", "google_gemini", "perplexity", "mistral", "cohere",
        "groq", "xai_grok", "deepseek", "qwen", "meta_llama", "microsoft_azure",
        "hugging_face", "ollama_local", "openai_compatible", "http_json",
        "mcp_tools", "generic_ai_plugin", "generic_connector",
    }
    assert all(registry.get_plugin_status(plugin_id)["eligible"] is False for plugin_id in ids)


def test_manifest_parser_and_compatibility_fail_closed_on_invalid_or_new_versions():
    manifest_data = {
        "plugin_id": "future_text",
        "provider_family": "future_ecosystem",
        "display_name": "Future Text",
        "adapter_type": "fake",
        "ecosystem": "future_ecosystem",
        "capabilities": [TEXT],
        "manifest_version": "1",
        "compatibility_version": "1",
    }

    assert PluginCompatibilityLayer.evaluate(manifest_data).status == "SUPPORTED"
    manifest = PluginManifest.from_mapping(manifest_data)
    assert manifest.plugin_type == "AI_PROVIDER"
    assert PluginCompatibilityLayer.evaluate({**manifest_data, "manifest_version": "2"}).status == "INCOMPATIBLE"
    assert PluginCompatibilityLayer.evaluate({**manifest_data, "capabilities": ["PAYMENTS"]}).status == "INVALID"
    assert PluginCompatibilityLayer.evaluate({**manifest_data, "api_key": "must-not-be-accepted"}).status == "INVALID"

    registry = PluginRegistry()
    with pytest.raises(ValueError, match="incompatible"):
        registry.register(PluginRegistration(PluginManifest.from_mapping({
            **manifest_data, "manifest_version": "2",
        })))
    disabled = PluginManifest.from_mapping({**manifest_data, "availability": "DISABLED"})
    assert PluginCompatibilityLayer.evaluate(disabled).status == "DISABLED"


@pytest.mark.parametrize(
    ("interface_type", "interface_status", "expected"),
    [
        ("OFFICIAL_API", "OFFICIAL_SUPPORTED", True),
        ("MCP", "STANDARD_SUPPORTED", True),
        ("OFFICIAL_API", "UNVERIFIED", False),
        ("UNSUPPORTED_INTERFACE", "UNSUPPORTED_INTERFACE", False),
    ],
)
def test_external_plugin_routing_requires_supported_integration_interface(
    interface_type, interface_status, expected
):
    plugin_id = "external_fixture"
    adapter = FakePlugin(plugin_id)
    registry = PluginRegistry((make_registration(
        plugin_id,
        adapter,
        locality="external",
        pricing=FREE_ELIGIBLE,
        authorization="AUTHORIZED",
        ecosystem="test_ecosystem",
        interface_type=interface_type,
        interface_status=interface_status,
    ),))
    authorization = ExternalAuthorization(
        enabled=True,
        allowed_providers=frozenset({plugin_id}),
        allowed_capabilities=frozenset({"text_generation"}),
        allow_single_provider=True,
    )

    plan = AIOrchestrator(
        plugin_registry=registry,
        external_authorization=authorization,
    ).plan(capability=TEXT)

    assert plan.available is expected
    assert adapter.calls == []


def test_future_provider_uses_same_contract_and_discovery_is_sorted():
    registry = PluginRegistry()
    registry.register(make_registration("future_vendor", FakePlugin("future_vendor")))
    registry.register(make_registration("another_future", FakePlugin("another_future")))

    assert [item.plugin_id for item in registry.list_plugins()] == [
        "another_future", "future_vendor"
    ]
    assert registry.find_capable_plugins(TEXT)[0].plugin_id == "another_future"
    assert not hasattr(registry.get_plugin("future_vendor"), "adapter")


def test_registry_rejects_duplicate_ids_invalid_capabilities_and_secret_metadata():
    registry = PluginRegistry()
    registration = make_registration("fake_openai", FakeOpenAIPlugin("fake_openai"))
    registry.register(registration)

    with pytest.raises(ValueError, match="already registered"):
        registry.register(registration)
    with pytest.raises(ValueError, match="capability allow-list"):
        make_registration("bad_capability", FakePlugin("bad"), capabilities=("PAYMENTS",))
    with pytest.raises(ValueError, match="metadata field"):
        PluginMetadata("bad_secret", "vendor", "api_key value", "fake")
    assert registry.find_capable_plugins("UNDECLARED") == ()


def test_adapter_contract_inspection_does_not_execute_plugin_code():
    registry = PluginRegistry()

    with pytest.raises(TypeError, match="existing provider interface"):
        registry.register(make_registration("descriptor_plugin", DescriptorPlugin()))


@pytest.mark.parametrize(
    ("plugin_id", "adapter_type", "pricing", "availability", "authorization", "activation", "eligible"),
    [
        ("fake_paid", FakePaidPlugin, PAID_ONLY, "AVAILABLE", "NOT_REQUIRED", "ACTIVE", False),
        ("fake_unknown", FakeUnknownPricingPlugin, UNKNOWN_PRICING, "AVAILABLE", "NOT_REQUIRED", "ACTIVE", False),
        ("fake_unavailable", FakeUnavailablePlugin, LOCAL_FREE, "UNAVAILABLE", "NOT_REQUIRED", "ACTIVE", False),
        ("fake_unauthorized", FakePlugin, FREE_ELIGIBLE, "AVAILABLE", "NOT_AUTHORIZED", "ACTIVE", False),
        ("fake_inactive", FakePlugin, FREE_ELIGIBLE, "AVAILABLE", "AUTHORIZED", "INACTIVE", False),
        ("fake_eligible", FakePlugin, LOCAL_FREE, "AVAILABLE", "NOT_REQUIRED", "ACTIVE", True),
    ],
)
def test_plugin_status_keeps_pricing_readiness_authorization_and_activation_separate(
    plugin_id, adapter_type, pricing, availability, authorization, activation, eligible
):
    adapter = adapter_type(plugin_id)
    registry = PluginRegistry((make_registration(
        plugin_id,
        adapter,
        pricing=pricing,
        availability=availability,
        authorization=authorization,
        activation=activation,
    ),))

    status = registry.get_plugin_status(plugin_id)
    assert status["eligible"] is eligible
    assert status["activation_state"] == activation
    assert status["authorization_state"] == authorization
    assert adapter.calls == []


def test_planner_selects_one_capable_registered_plugin_without_calling_it():
    first = FakeLocalAIPlugin("fake_local")
    reasoning = FakeReasoningPlugin("fake_reasoning")
    registry = PluginRegistry((
        make_registration("fake_local", first, capabilities=(TEXT,)),
        make_registration("fake_reasoning", reasoning, capabilities=(REASONING,)),
    ))

    orchestrator = AIOrchestrator(plugin_registry=registry)
    text_plan = orchestrator.plan(mode=SINGLE_PROVIDER, capability=TEXT)
    reasoning_plan = orchestrator.plan(capability=REASONING)

    assert text_plan.selected_provider == "fake_local"
    assert len(text_plan.candidates) == 1
    assert reasoning_plan.selected_provider == "fake_reasoning"
    assert first.calls == reasoning.calls == []


def test_paid_unknown_unavailable_and_unauthorized_plugins_never_become_candidates():
    plugins = (
        make_registration("fake_paid", FakePaidPlugin("fake_paid"), pricing=PAID_ONLY),
        make_registration("fake_unknown", FakeUnknownPricingPlugin("fake_unknown"), pricing=UNKNOWN_PRICING),
        make_registration("fake_unavailable", FakeUnavailablePlugin("fake_unavailable"), availability="UNAVAILABLE"),
        make_registration("fake_unauthorized", FakePlugin("fake_unauthorized"), locality="external", pricing=FREE_ELIGIBLE, authorization="NOT_AUTHORIZED"),
    )
    registry = PluginRegistry(plugins)
    result = AIOrchestrator(plugin_registry=registry).plan(capability=TEXT)

    assert result.available is False
    assert result.failure_state == "NO_ELIGIBLE_AI_PLUGIN"
    assert result.candidates == ()
    assert all(plugin.adapter.calls == [] for plugin in plugins)


def test_explicit_provider_selection_cannot_bypass_capability_requirements():
    adapter = FakeVisionPlugin("fake_vision")
    registry = PluginRegistry((make_registration(
        "fake_vision", adapter, capabilities=(VISION,), locality="local"
    ),))

    result = AIOrchestrator(plugin_registry=registry).plan(
        capability=TEXT, selected_provider="fake_vision"
    )

    assert result.available is False
    assert result.failure_state == "CAPABILITY_UNAVAILABLE"
    assert adapter.calls == []


def test_verified_multi_model_plan_is_deterministic_and_limited_to_three():
    adapters = [FakePlugin(f"fake_{index}") for index in range(5)]
    registry = PluginRegistry(tuple(
        make_registration(f"fake_{index}", adapter)
        for index, adapter in enumerate(adapters)
    ))

    orchestrator = AIOrchestrator(plugin_registry=registry)
    first = orchestrator.plan(mode=VERIFIED_MULTI_MODEL, capability=TEXT)
    second = orchestrator.plan(mode=VERIFIED_MULTI_MODEL, capability=TEXT)

    assert first.available is True
    assert len(first.candidates) == 3
    assert [item.provider_id for item in first.candidates] == [
        item.provider_id for item in second.candidates
    ]
    assert all(adapter.calls == [] for adapter in adapters)