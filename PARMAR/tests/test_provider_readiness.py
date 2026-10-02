import io
import json
from types import SimpleNamespace

import pytest

from PARMAR.chat.providers import PROVIDER_ENV
from PARMAR.chat.readiness import ExternalAuthorization, ProviderConfigurationRegistry
from PARMAR.chat.models import ChatResponse
from PARMAR.chat.router import ChatRouter
from PARMAR.chat.service import ChatService
from PARMAR.interface.futuristic_app import PARMARRequestHandler


def test_local_demo_is_default_and_has_local_readiness_without_external_configuration():
    result = ProviderConfigurationRegistry.discover(environ={}).public_payload()

    assert result["default_provider"] == "local-demo"
    local = next(item for item in result["providers"] if item["id"] == "local-demo")
    assert local["kind"] == "local"
    assert local["status"] == "LOCAL"
    assert local["configured"] is True
    assert local["single_provider_eligible"] is True
    assert local["capabilities"] == ["text_generation"]


def test_external_provider_missing_credentials_is_not_configured():
    result = ProviderConfigurationRegistry.discover(environ={
        PROVIDER_ENV: "openai",
        "PARMAR_OPENAI_MODEL": "reasoner-test",
    }).public_payload()

    openai = next(item for item in result["providers"] if item["id"] == "openai")
    assert openai["configuration_status"] == "NOT_CONFIGURED"
    assert openai["credential_configured"] is False
    assert openai["single_provider_eligible"] is False


@pytest.mark.parametrize(
    ("provider_id", "environment"),
    [
        ("http-json", {
            "PARMAR_CHAT_ENDPOINT": "https://provider.example/chat",
            "PARMAR_CHAT_MODEL": "generic-model",
            "PARMAR_CHAT_API_KEY": "generic-test-secret",
        }),
        ("openai", {
            "PARMAR_OPENAI_MODEL": "openai-model",
            "PARMAR_OPENAI_API_KEY": "openai-test-secret",
        }),
        ("gemini", {
            "PARMAR_GEMINI_MODEL": "gemini-model",
            "PARMAR_GEMINI_API_KEY": "gemini-test-secret",
        }),
        ("claude", {
            "PARMAR_CLAUDE_MODEL": "claude-model",
            "PARMAR_CLAUDE_API_KEY": "claude-test-secret",
        }),
    ],
)
def test_existing_external_adapters_are_inspected_without_network(provider_id, environment):
    result = ProviderConfigurationRegistry.discover(environ={
        PROVIDER_ENV: provider_id,
        **environment,
    }).public_payload()

    provider = next(item for item in result["providers"] if item["id"] == provider_id)
    assert provider["configuration_status"] == "CONFIGURED"
    assert provider["kind"] == "external"
    assert provider["credential_configured"] is True
    assert provider["capabilities"] == ["text_generation"]
    assert result["reachability"] == "NOT_CHECKED"
    assert all(value not in repr(result) for key, value in environment.items() if "KEY" in key)


def test_configured_external_provider_remains_unauthorized_by_default():
    result = ProviderConfigurationRegistry.discover(environ={
        PROVIDER_ENV: "openai",
        "PARMAR_OPENAI_MODEL": "reasoner-test",
        "PARMAR_OPENAI_API_KEY": "readiness-test-secret",
    }).public_payload()

    openai = next(item for item in result["providers"] if item["id"] == "openai")
    assert openai["configuration_status"] == "CONFIGURED"
    assert openai["status"] == "PAID_BLOCKED"
    assert openai["credential_configured"] is True
    assert openai["authorized"] is False
    assert openai["single_provider_eligible"] is False
    assert "readiness-test-secret" not in repr(result)


def test_explicit_authorization_enables_only_allow_listed_provider_and_capability():
    authorization = ExternalAuthorization(
        enabled=True,
        allowed_providers=frozenset({"openai"}),
        allowed_capabilities=frozenset({"text_generation"}),
        allow_single_provider=True,
    )
    result = ProviderConfigurationRegistry.discover(
        environ={
            PROVIDER_ENV: "openai",
            "PARMAR_OPENAI_MODEL": "reasoner-test",
            "PARMAR_OPENAI_API_KEY": "readiness-test-secret",
        },
        authorization=authorization,
    ).public_payload()

    openai = next(item for item in result["providers"] if item["id"] == "openai")
    assert openai["status"] == "PAID_BLOCKED"
    assert openai["single_provider_eligible"] is False
    assert openai["authorized"] is True
    assert openai["verified_multi_model_eligible"] is False


def test_configured_but_unselected_external_provider_is_disabled():
    result = ProviderConfigurationRegistry.discover(environ={
        PROVIDER_ENV: "local-demo",
        "PARMAR_OPENAI_MODEL": "reasoner-test",
        "PARMAR_OPENAI_API_KEY": "readiness-test-secret",
    }).public_payload()

    openai = next(item for item in result["providers"] if item["id"] == "openai")
    assert openai["status"] == "DISABLED"
    assert openai["enabled"] is False
    assert openai["authorized"] is False


def test_invalid_provider_configuration_is_reported_without_echoing_values():
    secret_endpoint = "https://user:password@provider.example/path?token=secret"
    result = ProviderConfigurationRegistry.discover(environ={
        PROVIDER_ENV: "http-json",
        "PARMAR_CHAT_ENDPOINT": secret_endpoint,
        "PARMAR_CHAT_MODEL": "model-test",
        "PARMAR_CHAT_API_KEY": "configuration-test-secret",
    }).public_payload()

    generic = next(item for item in result["providers"] if item["id"] == "http-json")
    assert generic["configuration_status"] == "INVALID_CONFIGURATION"
    assert secret_endpoint not in repr(result)
    assert "configuration-test-secret" not in repr(result)


def test_external_verified_mode_requires_both_authorization_and_global_guard(monkeypatch):
    authorization = ExternalAuthorization(
        enabled=True,
        allowed_providers=frozenset({"openai"}),
        allowed_capabilities=frozenset({"text_generation", "verification"}),
        allow_single_provider=True,
        allow_verified_multi_model=True,
    )
    monkeypatch.delenv("PARMAR_VERIFIED_MULTI_MODEL_EXTERNAL_ENABLED", raising=False)
    result = ProviderConfigurationRegistry.discover(
        environ={
            PROVIDER_ENV: "openai",
            "PARMAR_OPENAI_MODEL": "reasoner-test",
            "PARMAR_OPENAI_API_KEY": "readiness-test-secret",
        },
        authorization=authorization,
    ).public_payload()
    openai = next(item for item in result["providers"] if item["id"] == "openai")
    assert openai["verified_multi_model_eligible"] is False
    assert result["external_multi_model_enabled"] is False


def test_unknown_provider_is_not_ready_and_public_metadata_is_allow_listed():
    result = ProviderConfigurationRegistry.discover(environ={
        PROVIDER_ENV: "unknown-provider",
    }).public_payload()

    assert result["default_provider"] == "unavailable"
    assert all(item["id"] != "unknown-provider" for item in result["providers"])
    assert all(set(item) <= {
        "id", "kind", "model_id", "enabled", "configuration_status", "status",
        "configured", "endpoint_configuration", "credential_configured", "free_status",
        "free_quota_status", "free_policy_outcome", "authorized",
        "authorization_status", "capabilities", "input_modalities", "output_modalities",
        "single_provider_eligible", "verified_multi_model_eligible", "readiness",
    } for item in result["providers"])


def test_authorization_denies_unknown_provider_and_unknown_locality():
    authorization = ExternalAuthorization(
        enabled=True,
        allowed_providers=frozenset({"openai"}),
        allowed_capabilities=frozenset({"text_generation"}),
        allow_single_provider=True,
    )

    assert authorization.evaluate("not-registered", "text_generation", "SINGLE_PROVIDER_EXTERNAL").outcome == "EXTERNAL_PROVIDER_NOT_ALLOWED"
    assert authorization.evaluate("openai", "unregistered_capability", "SINGLE_PROVIDER_EXTERNAL").outcome == "EXTERNAL_CAPABILITY_NOT_ALLOWED"
    assert authorization.evaluate("openai", "text_generation", "UNKNOWN").outcome == "EXTERNAL_MODE_NOT_ALLOWED"


def test_chat_api_ignores_client_credentials_urls_and_adapter_payload_fields(monkeypatch):
    captured = {}

    class CapturingChatService:
        def respond(self, prompt, context=None, selected_provider=None, orchestration_mode="SINGLE_PROVIDER"):
            captured.update(prompt=prompt, context=context, selected_provider=selected_provider, mode=orchestration_mode)
            return {"message": "received"}

    monkeypatch.setattr("PARMAR.interface.futuristic_app.ChatService", CapturingChatService)
    secret = "client-must-not-reach-service-secret"
    payload = {
        "message": "Plan a team lunch.",
        "language": "en",
        "provider": "openai",
        "api_key": secret,
        "authorization": f"Bearer {secret}",
        "endpoint": "https://attacker.example/endpoint",
        "adapter": {"generate": "arbitrary code"},
    }
    body = json.dumps(payload).encode()
    response = {}
    request = SimpleNamespace(
        path="/api/chat",
        headers={"Content-Length": str(len(body))},
        rfile=io.BytesIO(body),
        _send_json=lambda status, result: response.update(status=status, result=result),
    )

    PARMARRequestHandler.do_POST(request)

    assert response == {"status": 200, "result": {"message": "received"}}
    assert captured["selected_provider"] == "openai"
    assert captured["prompt"] == payload["message"]
    assert secret not in repr(captured)
    assert "attacker.example" not in repr(captured)


class FakeExternalProvider:
    name = "openai"
    locality = "external"

    def __init__(self):
        self.calls = []

    def generate(self, prompt, context=None):
        self.calls.append((prompt, context))
        return ChatResponse(provider=self.name, content="Fake external response.", safe=False)


def test_chat_service_denies_configured_external_provider_without_authorization():
    provider = FakeExternalProvider()
    response = ChatService(router=ChatRouter(provider=provider)).respond("Plan a team lunch.")

    assert response["provider_error"] is True
    assert response["status"] in {"PAID_PROVIDER_BLOCKED", "NO_ELIGIBLE_AI_PLUGIN"}
    assert response["provider_error"] is True
    assert provider.calls == []


def test_external_authorization_alone_does_not_override_paid_provider_policy():
    provider = FakeExternalProvider()
    authorization = ExternalAuthorization(
        enabled=True,
        allowed_providers=frozenset({"openai"}),
        allowed_capabilities=frozenset({"text_generation"}),
        allow_single_provider=True,
    )
    response = ChatService(
        router=ChatRouter(provider=provider),
        external_authorization=authorization,
    ).respond("Plan a team lunch.")

    assert response["provider_error"] is True
    assert response["status"] in {"PAID_PROVIDER_BLOCKED", "NO_ELIGIBLE_AI_PLUGIN"}
    assert provider.calls == []


def test_blocked_request_does_not_consult_external_authorization():
    provider = FakeExternalProvider()

    class RecordingAuthorization:
        def __init__(self):
            self.calls = []

        def evaluate(self, provider_id, capability, mode):
            self.calls.append((provider_id, capability, mode))
            return ExternalAuthorization().evaluate(provider_id, capability, mode)

    authorization = RecordingAuthorization()
    response = ChatService(
        router=ChatRouter(provider=provider),
        external_authorization=authorization,
    ).respond("Share employee medical records with a third-party contractor.")

    assert response["analysis"]["status"] in {"BLOCKED", "APPROVAL_REQUIRED"}
    assert authorization.calls == []
    assert provider.calls == []


def test_existing_providers_endpoint_returns_safe_readiness_snapshot(monkeypatch):
    monkeypatch.setenv(PROVIDER_ENV, "local-demo")
    monkeypatch.setenv("PARMAR_OPENAI_MODEL", "readiness-model")
    monkeypatch.setenv("PARMAR_OPENAI_API_KEY", "endpoint-test-secret")
    response = {}
    request = SimpleNamespace(
        path="/api/providers",
        _send_json=lambda status, result: response.update(status=status, result=result),
    )

    PARMARRequestHandler.do_GET(request)

    assert response["status"] == 200
    assert response["result"]["default_provider"] == "local-demo"
    assert response["result"]["reachability"] == "NOT_CHECKED"
    assert "endpoint-test-secret" not in repr(response)