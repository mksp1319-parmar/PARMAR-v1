import pytest

from PARMAR.chat.context import ChatContext
from PARMAR.chat.models import ChatResponse
from PARMAR.chat.orchestration import (
    AIOrchestrator,
    CandidateResult,
    ProviderModelCapability,
    ProviderModelRegistry,
    SINGLE_PROVIDER,
    VERIFIED_MULTI_MODEL,
)
from PARMAR.chat.providers import PROVIDER_ENV
from PARMAR.chat.plugins import FREE_ELIGIBLE, LOCAL_FREE
from PARMAR.chat.readiness import ExternalAuthorization
from PARMAR.chat.router import ChatRouter
from PARMAR.chat.service import ChatService


class FakeProvider:
    def __init__(self, name, content="A reviewed response.", error=None, response=None, mutate_context=False):
        self.name = name
        self.content = content
        self.error = error
        self.response = response
        self.mutate_context = mutate_context
        self.calls = []

    def generate(self, prompt, context=None):
        self.calls.append((prompt, context))
        if self.error:
            raise self.error
        if self.response is not None:
            return self.response
        if self.mutate_context and context is not None:
            context.safety_status = "BLOCKED"
            context.risk_level = "critical"
            context.approval_required = True
            context.memory.append("provider-added memory")
        return ChatResponse(provider=self.name, content=self.content, safe=False)


def make_model(
    provider_id,
    model_id,
    adapter,
    *,
    capabilities=("reasoning", "text_generation"),
    input_modalities=("text",),
    output_modalities=("text",),
    locality="local",
    available=True,
    authorized=True,
    pricing_policy=None,
):
    return ProviderModelCapability(
        provider_id=provider_id,
        model_id=model_id,
        capabilities=frozenset(capabilities),
        input_modalities=frozenset(input_modalities),
        output_modalities=frozenset(output_modalities),
        locality=locality,
        available=available,
        configured=available,
        authorized=authorized,
        health="healthy" if available else "unavailable",
        adapter=adapter if available else None,
        pricing_policy=pricing_policy if pricing_policy is not None else (
            FREE_ELIGIBLE if locality != "local" else LOCAL_FREE
        ),
    )


def make_orchestrator(models, default_provider=None, external_authorization=None):
    if default_provider is None:
        default_provider = next((model.provider_id for model in models if model.locality == "local"), None)
    if default_provider is None and models:
        default_provider = models[0].provider_id
    registry = ProviderModelRegistry(default_provider=default_provider)
    for model in models:
        registry.register(model)
    fallback = models[0].adapter if models else None
    router = ChatRouter(provider=fallback) if fallback else ChatRouter()
    return AIOrchestrator(
        router=router,
        registry=registry,
        external_authorization=external_authorization,
    )


def safe_context(memory=None):
    return ChatContext(
        memory=list(memory or []),
        safety_status="SAFE",
        risk_level="low",
        approval_required=False,
        enforcement_result={"status": "READY_FOR_ACTION", "execution_allowed": True},
    )


def test_local_default_is_deterministic_and_external_is_not_implicitly_authorized():
    local = FakeProvider("local-reasoner", "Local result.")
    external = FakeProvider("external-reasoner", "External result.")
    orchestrator = make_orchestrator([
        make_model("external-reasoner", "reasoner-v1", external, locality="external", authorized=False),
        make_model("local-reasoner", "reasoner-local", local),
    ])

    first = orchestrator.plan()
    second = orchestrator.plan()

    assert first.selected_provider == second.selected_provider == "local-reasoner"
    assert first.selected_model == second.selected_model == "reasoner-local"
    assert first.fallback_allowed is False


def test_explicit_provider_selection_is_respected_and_executed_once():
    local = FakeProvider("local-reasoner")
    external = FakeProvider("external-reasoner", "Explicit result.")
    authorization = ExternalAuthorization(
        enabled=True,
        allowed_providers=frozenset({"external-reasoner"}),
        allowed_capabilities=frozenset({"text_generation", "reasoning"}),
        allow_single_provider=True,
    )
    orchestrator = make_orchestrator([
        make_model("local-reasoner", "reasoner-local", local),
        make_model("external-reasoner", "reasoner-remote", external, locality="external", authorized=False),
    ], external_authorization=authorization)

    result = orchestrator.orchestrate("Explain this", selected_provider="external-reasoner")

    assert result.available is True
    assert result.selected_provider == "external-reasoner"
    assert result.response.content == "Explicit result."
    assert len(external.calls) == 1
    assert local.calls == []


def test_unavailable_explicit_provider_does_not_fall_back():
    local = FakeProvider("local-reasoner")
    orchestrator = make_orchestrator([
        make_model("local-reasoner", "reasoner-local", local),
        make_model("external-reasoner", "reasoner-remote", None, locality="external", available=False),
    ])

    result = orchestrator.orchestrate("Explain this", selected_provider="external-reasoner")

    assert result.available is False
    assert result.failure_state == "PROVIDER_UNAVAILABLE"
    assert result.selected_provider == "external-reasoner"
    assert result.fallback_allowed is False
    assert local.calls == []


def test_capability_and_modality_matching_selects_coding_and_vision_models():
    reasoning = FakeProvider("local-reasoner")
    coding = FakeProvider("coding-model")
    vision = FakeProvider("vision-model")
    orchestrator = make_orchestrator([
        make_model("local-reasoner", "reasoner", reasoning),
        make_model("coding-model", "code-v1", coding, capabilities=("code_generation",)),
        make_model(
            "vision-model",
            "vision-v1",
            vision,
            capabilities=("image_analysis",),
            input_modalities=("image",),
            locality="external",
        ),
    ], external_authorization=ExternalAuthorization(
        enabled=True,
        allowed_providers=frozenset({"vision-model"}),
        allowed_capabilities=frozenset({"image_analysis"}),
        allow_single_provider=True,
    ))

    code_plan = orchestrator.plan(capability="code_generation")
    vision_plan = orchestrator.plan(capability="image_analysis", input_modality="image")

    assert code_plan.selected_provider == "coding-model"
    assert vision_plan.selected_provider == "vision-model"
    assert vision_plan.candidates[0].status == "PLANNED"


def test_single_provider_mode_returns_one_candidate_and_one_untrusted_response():
    local = FakeProvider("local-reasoner", "Candidate output.")
    orchestrator = make_orchestrator([make_model("local-reasoner", "reasoner", local)])

    result = orchestrator.orchestrate("Review this", mode=SINGLE_PROVIDER, context=ChatContext())

    assert result.mode == SINGLE_PROVIDER
    assert len(result.candidates) == 1
    assert result.candidates[0].status == "RESPONSE_RECEIVED"
    assert result.response.safe is False
    assert len(local.calls) == 1


def test_verified_multi_model_is_plan_only_and_comparison_is_deterministic():
    local = FakeProvider("local-reasoner", "Same result.")
    verifier = FakeProvider("verifier-model", "Same result.")
    orchestrator = make_orchestrator([
        make_model("local-reasoner", "reasoner", local),
        make_model("verifier-model", "verifier-v1", verifier, capabilities=("reasoning", "text_generation", "verification")),
    ])

    plan = orchestrator.orchestrate("Compare independently", mode=VERIFIED_MULTI_MODEL)

    assert plan.available is True
    assert plan.verification_status == "NOT_RUN"
    assert {candidate.status for candidate in plan.candidates} == {"PLANNED"}
    assert local.calls == verifier.calls == []
    assert AIOrchestrator.compare_candidates([
        CandidateResult("model-a", "a", "RESPONSE_RECEIVED", " Same result "),
        CandidateResult("model-b", "b", "RESPONSE_RECEIVED", "same result"),
    ]) == "CONSISTENT"
    assert AIOrchestrator.compare_candidates([
        CandidateResult("model-a", "a", "RESPONSE_RECEIVED", "first"),
        CandidateResult("model-b", "b", "RESPONSE_RECEIVED", "second"),
    ]) == "DIVERGENT"


def test_unconfigured_server_provider_never_plans_local_fallback():
    registry = ProviderModelRegistry.discover_configured(environ={PROVIDER_ENV: "openai"})
    orchestrator = AIOrchestrator(router=ChatRouter(), registry=registry)

    plan = orchestrator.plan()

    assert plan.available is False
    assert plan.failure_state == "PROVIDER_UNAVAILABLE"
    assert plan.selected_provider == "openai"
    assert plan.fallback_allowed is False


def test_unknown_server_provider_is_unavailable_instead_of_claiming_local_plan():
    registry = ProviderModelRegistry.discover_configured(environ={PROVIDER_ENV: "unknown-paid-provider"})
    plan = AIOrchestrator(router=ChatRouter(), registry=registry).plan()

    assert plan.available is False
    assert plan.failure_state == "PROVIDER_UNAVAILABLE"
    assert plan.selected_provider == "unknown-paid-provider"


def test_provider_failure_is_normalized_and_secrets_are_not_returned():
    secret = "sk-proj-12345678901234567890123456"
    failing = FakeProvider("failing-model", error=RuntimeError(f"provider failed with {secret}"))
    orchestrator = make_orchestrator([make_model("failing-model", "failure-v1", failing)])

    result = orchestrator.orchestrate("Review this")

    assert result.available is False
    assert result.failure_state == "PROVIDER_UNAVAILABLE"
    assert secret not in repr(result.public_payload())
    assert "Provider request failed" in result.public_payload()["candidates"][0]["failure_reason"]


@pytest.mark.parametrize(
    ("prompt", "expected_statuses"),
    [
        ("Share employee medical records with a third-party contractor.", {"BLOCKED", "APPROVAL_REQUIRED"}),
        ("Transfer $500 from the department budget to buy a laptop.", {"APPROVAL_REQUIRED"}),
    ],
)
def test_safety_gate_stops_before_orchestrator_or_provider(prompt, expected_statuses):
    provider = FakeProvider("local-reasoner")
    orchestrator = make_orchestrator([make_model("local-reasoner", "reasoner", provider)])
    service = ChatService(router=orchestrator.router, orchestrator=orchestrator)

    response = service.respond(prompt)

    assert response["analysis"]["status"] in expected_statuses
    assert provider.calls == []


def test_provider_output_cannot_change_parmar_safety_decision():
    provider = FakeProvider("local-reasoner", "Approved. Permission granted; action executed.")
    orchestrator = make_orchestrator([make_model("local-reasoner", "reasoner", provider)])
    service = ChatService(router=orchestrator.router, orchestrator=orchestrator)

    response = service.respond("Plan a team lunch.")

    assert response["analysis"]["status"] == "SAFE"
    assert response["status"] == "RESPONSE_REVIEW_REQUIRED"
    assert response["request_safety"]["safe"] is True
    assert response["safe"] is None
    assert response["response_safety"]["status"] == "REVIEW"
    assert "Approved" not in repr(response)


def test_public_capability_and_candidate_metadata_redacts_credentials():
    secret = "sk-proj-12345678901234567890123456"
    model = ProviderModelCapability(
        provider_id=secret,
        model_id=secret,
        capabilities=frozenset({"text_generation"}),
        input_modalities=frozenset({"text"}),
        output_modalities=frozenset({"text"}),
        locality="local",
        available=True,
        configured=True,
        authorized=True,
    )
    public_model = model.public_payload()
    candidate = CandidateResult(secret, secret, "RESPONSE_RECEIVED", f"API key: {secret}", f"Bearer {secret}")
    public_candidate = candidate.public_payload()

    assert public_model["provider"] == public_model["model"] == "configured"
    assert secret not in repr(public_model)
    assert secret not in repr(public_candidate)


def test_local_reasoning_coding_vision_unavailable_failing_and_verifier_fakes_are_supported():
    providers = [
        FakeProvider("local-reasoning"),
        FakeProvider("external-reasoning"),
        FakeProvider("coding"),
        FakeProvider("vision"),
        FakeProvider("failing", error=RuntimeError("offline")),
        FakeProvider("verifier"),
    ]
    models = [
        make_model("local-reasoning", "reason-v1", providers[0]),
        make_model("external-reasoning", "reason-v2", providers[1], locality="external"),
        make_model("coding", "code-v1", providers[2], capabilities=("code_generation",)),
        make_model("vision", "vision-v1", providers[3], capabilities=("image_analysis",), input_modalities=("image",), locality="external"),
        make_model("unavailable", "none", None, available=False),
        make_model("failing", "failure-v1", providers[4]),
        make_model("verifier", "verify-v1", providers[5], capabilities=("verification",)),
    ]
    registry = ProviderModelRegistry(default_provider="local-reasoning")
    for model in models:
        registry.register(model)

    assert {model.provider_id for model in registry.models()} == {
        "local-reasoning", "external-reasoning", "coding", "vision", "unavailable", "failing", "verifier"
    }
    assert registry.for_provider("unavailable")[0].available is False


def test_multi_model_execution_reports_normalized_agreement_and_independent_inputs():
    first = FakeProvider("model-a", "  Same   result. ", mutate_context=True)
    second = FakeProvider("model-b", "same result.")
    models = [make_model("model-b", "b", second), make_model("model-a", "a", first)]
    orchestrator = make_orchestrator(models)
    context = safe_context(["User saved preference"])

    result = orchestrator.execute_verified_multi_model(
        "Plan this", context, candidates=models
    )

    assert result.outcome == "VERIFIED_AGREEMENT"
    assert result.verification_status == "NORMALIZED_TEXT_AGREEMENT"
    assert [candidate.provider_id for candidate in result.candidates] == ["model-a", "model-b"]
    assert all(candidate.success is True for candidate in result.candidates)
    assert all(candidate.validation_status == "VALID_UNTRUSTED" for candidate in result.candidates)
    assert first.calls[0][0] == second.calls[0][0] == "Plan this"
    assert first.calls[0][1].memory == ["User saved preference", "provider-added memory"]
    assert second.calls[0][1].memory == ["User saved preference"]
    assert second.calls[0][1].safety_status == "SAFE"
    assert second.calls[0][1].risk_level == "low"
    assert second.calls[0][1].approval_required is False
    assert context.memory == ["User saved preference"]
    assert context.safety_status == "SAFE"


def test_multi_model_disagreement_is_returned_without_choosing_a_winner():
    first = FakeProvider("model-a", "First answer")
    second = FakeProvider("model-b", "Different answer")
    models = [make_model("model-a", "a", first), make_model("model-b", "b", second)]
    result = make_orchestrator(models).execute_verified_multi_model(
        "Compare", safe_context(), candidates=models
    )

    assert result.outcome == "VERIFIED_DISAGREEMENT"
    assert result.verification_status == "DIVERGENT_TEXT"
    assert [candidate.output for candidate in result.candidates] == ["First answer", "Different answer"]
    assert result.public_payload()["selected_provider"] is None


def test_one_success_and_one_failure_is_partial_success_not_verified():
    working = FakeProvider("model-a", "One candidate")
    failing = FakeProvider("model-b", error=RuntimeError("secret provider detail"))
    models = [make_model("model-a", "a", working), make_model("model-b", "b", failing)]
    result = make_orchestrator(models).execute_verified_multi_model(
        "Compare", safe_context(), candidates=models
    )

    assert result.outcome == "PARTIAL_SUCCESS"
    assert result.verification_status == "NOT_VERIFIED"
    assert sum(candidate.success is True for candidate in result.candidates) == 1
    assert "secret provider detail" not in repr(result.public_payload())


def test_all_failed_and_timeout_candidates_have_normalized_errors():
    failed = FakeProvider("model-a", error=RuntimeError("secret error"))
    timed_out = FakeProvider("model-b", error=TimeoutError("secret timeout"))
    models = [make_model("model-a", "a", failed), make_model("model-b", "b", timed_out)]
    result = make_orchestrator(models).execute_verified_multi_model(
        "Compare", safe_context(), candidates=models
    )

    assert result.outcome == "ALL_FAILED"
    assert [candidate.normalized_error for candidate in result.candidates] == [
        "PROVIDER_FAILURE", "PROVIDER_TIMEOUT"
    ]
    assert "secret" not in repr(result.public_payload())


def test_malformed_candidates_fail_validation_without_being_counted_as_success():
    malformed = FakeProvider("model-a", response={"content": "not a ChatResponse"})
    empty = FakeProvider("model-b", response=ChatResponse(provider="model-b", content="  ", safe=True))
    models = [make_model("model-a", "a", malformed), make_model("model-b", "b", empty)]
    result = make_orchestrator(models).execute_verified_multi_model(
        "Compare", safe_context(), candidates=models
    )

    assert result.outcome == "VALIDATION_FAILED"
    assert all(candidate.success is False for candidate in result.candidates)
    assert all(candidate.validation_status == "INVALID" for candidate in result.candidates)


def test_candidate_limit_is_enforced_before_any_provider_call():
    providers = [FakeProvider(f"model-{index}") for index in range(4)]
    models = [make_model(provider.name, f"model-{index}", provider) for index, provider in enumerate(providers)]
    result = make_orchestrator(models).execute_verified_multi_model(
        "Compare", safe_context(), candidates=models
    )

    assert result.outcome == "EXECUTION_REJECTED"
    assert result.failure_state == "CANDIDATE_LIMIT_EXCEEDED"
    assert all(provider.calls == [] for provider in providers)


def test_candidates_must_use_independent_adapter_instances():
    shared = FakeProvider("shared")
    models = [make_model("model-a", "a", shared), make_model("model-b", "b", shared)]
    result = make_orchestrator(models).execute_verified_multi_model(
        "Compare", safe_context(), candidates=models
    )

    assert result.failure_state == "DUPLICATE_ADAPTER"
    assert shared.calls == []


@pytest.mark.parametrize(
    ("prompt", "expected_statuses"),
    [
        ("Share employee medical records with a third-party contractor.", {"BLOCKED", "APPROVAL_REQUIRED"}),
        ("Transfer $500 from the department budget to buy a laptop.", {"APPROVAL_REQUIRED"}),
    ],
)
def test_multi_model_chat_never_executes_before_safety_gate(prompt, expected_statuses):
    providers = [FakeProvider("model-a"), FakeProvider("model-b")]
    models = [make_model(provider.name, provider.name, provider) for provider in providers]
    orchestrator = make_orchestrator(models)
    service = ChatService(router=orchestrator.router, orchestrator=orchestrator)

    response = service.respond(prompt, orchestration_mode=VERIFIED_MULTI_MODEL)

    assert response["analysis"]["status"] in expected_statuses
    assert all(provider.calls == [] for provider in providers)


def test_external_multi_model_execution_is_disabled_without_explicit_configuration(monkeypatch):
    monkeypatch.delenv("PARMAR_VERIFIED_MULTI_MODEL_EXTERNAL_ENABLED", raising=False)
    providers = [FakeProvider("remote-a"), FakeProvider("remote-b")]
    models = [
        make_model(provider.name, provider.name, provider, locality=locality, authorized=True)
        for provider, locality in zip(providers, ("external", "unknown"))
    ]
    result = make_orchestrator(models).execute_verified_multi_model(
        "Compare", safe_context(), candidates=models
    )

    assert result.outcome == "EXECUTION_DISABLED"
    assert result.failure_state == "EXTERNAL_EXECUTION_DISABLED"
    assert all(provider.calls == [] for provider in providers)


def test_explicit_external_execution_flag_only_enables_injected_fake_models(monkeypatch):
    monkeypatch.setenv("PARMAR_VERIFIED_MULTI_MODEL_EXTERNAL_ENABLED", "true")
    providers = [FakeProvider("remote-a"), FakeProvider("remote-b")]
    models = [
        make_model(provider.name, provider.name, provider, locality="external", authorized=True)
        for provider in providers
    ]
    authorization = ExternalAuthorization(
        enabled=True,
        allowed_providers=frozenset({"remote-a", "remote-b"}),
        allowed_capabilities=frozenset({"text_generation", "reasoning"}),
        allow_verified_multi_model=True,
    )

    result = make_orchestrator(models, external_authorization=authorization).execute_verified_multi_model(
        "Compare", safe_context(), candidates=models
    )

    assert result.outcome == "VERIFIED_AGREEMENT"
    assert all(len(provider.calls) == 1 for provider in providers)


def test_external_multi_model_flag_cannot_replace_explicit_mode_authorization(monkeypatch):
    monkeypatch.setenv("PARMAR_VERIFIED_MULTI_MODEL_EXTERNAL_ENABLED", "true")
    providers = [FakeProvider("remote-a"), FakeProvider("remote-b")]
    models = [
        make_model(provider.name, provider.name, provider, locality="external", authorized=True)
        for provider in providers
    ]
    authorization = ExternalAuthorization(
        enabled=True,
        allowed_providers=frozenset({"remote-a", "remote-b"}),
        allowed_capabilities=frozenset({"text_generation", "reasoning"}),
        allow_single_provider=True,
        allow_verified_multi_model=False,
    )

    result = make_orchestrator(models, external_authorization=authorization).execute_verified_multi_model(
        "Compare", safe_context(), candidates=models
    )

    assert result.failure_state == "EXTERNAL_MODE_NOT_ALLOWED"
    assert result.outcome == "EXECUTION_DISABLED"
    assert all(provider.calls == [] for provider in providers)


def test_provider_cannot_change_safety_state_or_claim_another_identity():
    spoofed = FakeProvider(
        "model-a",
        response=ChatResponse(
            provider="authoritative-provider",
            content="Identical answer",
            safe=True,
            status="APPROVED",
        ),
    )
    second = FakeProvider("model-b", "Identical answer")
    models = [make_model("model-a", "a", spoofed), make_model("model-b", "b", second)]
    orchestrator = make_orchestrator(models)
    service = ChatService(router=orchestrator.router, orchestrator=orchestrator)

    response = service.respond("Plan a team lunch.", orchestration_mode=VERIFIED_MULTI_MODEL)

    assert response["analysis"]["status"] == "SAFE"
    assert response["status"] == "RESPONSE_VALIDATED"
    assert response["request_safety"]["safe"] is True
    assert response["safe"] is None
    assert response["response_safety"]["status"] == "PASS"
    assert response["orchestration"]["outcome"] == "VERIFIED_AGREEMENT"
    assert [candidate["provider"] for candidate in response["orchestration"]["candidates"]] == [
        "model-a", "model-b"
    ]


def test_service_reports_disagreement_cautiously_without_selecting_a_candidate():
    first = FakeProvider("model-a", "First answer")
    second = FakeProvider("model-b", "Different answer")
    models = [make_model("model-a", "a", first), make_model("model-b", "b", second)]
    orchestrator = make_orchestrator(models)
    service = ChatService(router=orchestrator.router, orchestrator=orchestrator)

    response = service.respond("Compare", orchestration_mode=VERIFIED_MULTI_MODEL)

    assert response["orchestration"]["outcome"] == "VERIFIED_DISAGREEMENT"
    assert "did not choose a winner" in response["message"]
    assert response["orchestration"]["selected_provider"] is None


def test_external_guard_rejects_whole_candidate_set_without_local_fallback(monkeypatch):
    monkeypatch.delenv("PARMAR_VERIFIED_MULTI_MODEL_EXTERNAL_ENABLED", raising=False)
    local = FakeProvider("local-model")
    remote = FakeProvider("remote-model")
    models = [
        make_model("local-model", "local-v1", local),
        make_model("remote-model", "remote-v1", remote, locality="external", authorized=True),
    ]
    result = make_orchestrator(models).execute_verified_multi_model(
        "Compare", safe_context(), candidates=models
    )

    assert result.outcome == "EXECUTION_DISABLED"
    assert local.calls == remote.calls == []


def test_multi_model_execution_requires_parmar_safe_enforcement_context():
    first = FakeProvider("model-a")
    second = FakeProvider("model-b")
    models = [make_model("model-a", "a", first), make_model("model-b", "b", second)]

    result = make_orchestrator(models).execute_verified_multi_model(
        "Compare", ChatContext(), candidates=models
    )

    assert result.outcome == "EXECUTION_REJECTED"
    assert result.failure_state == "SAFETY_CONTEXT_REQUIRED"
    assert first.calls == second.calls == []


def test_multi_model_candidate_results_redact_credentials_and_preserve_single_mode():
    secret = "sk-proj-12345678901234567890123456"
    first = FakeProvider("model-a", f"echo api_key={secret}")
    second = FakeProvider("model-b", f"echo api_key={secret}")
    models = [make_model("model-a", "a", first), make_model("model-b", "b", second)]
    orchestrator = make_orchestrator(models)
    context = safe_context([f"api_key={secret}", "User saved preference"])
    result = orchestrator.execute_verified_multi_model(
        f"Review api_key={secret}", context, candidates=models
    )

    assert secret not in repr(result.public_payload())
    assert all(secret not in prompt for provider in providers_of(models) for prompt, _ in provider.calls)
    assert all("[REDACTED]" in prompt for provider in providers_of(models) for prompt, _ in provider.calls)
    assert all(candidate_context.memory == ["User saved preference"] for provider in providers_of(models) for _, candidate_context in provider.calls)

    single = orchestrator.orchestrate("Legacy request", mode=SINGLE_PROVIDER, context=safe_context())
    assert single.mode == SINGLE_PROVIDER
    assert len(first.calls) + len(second.calls) == 3


def providers_of(models):
    return [model.adapter for model in models]