from PARMAR.chat.readiness import (
    FREE_API,
    FREE_QUOTA_AVAILABLE,
    FREE_STATUS_UNKNOWN,
    LOCAL_FREE,
    PAID_ONLY,
    UNKNOWN,
    ProviderFreePolicy,
    ProviderVerificationRecord,
)


def test_default_verification_records_are_allow_listed_and_secret_free():
    policy = ProviderFreePolicy()
    records = [record.public_payload() for record in policy.records]

    assert {record["provider"] for record in records} == {
        "local-demo", "openai", "gemini", "claude", "http-json", "ollama-local-candidate"
    }
    assert all(set(record) == {
        "provider", "access_type", "free_status", "model_scope", "quota_status",
        "payment_requirement", "authorization_requirement", "source_reference",
        "verification_date", "limitations",
    } for record in records)
    assert "api_key" not in repr(records).lower()
    for record in records:
        non_sources = {key: value for key, value in record.items() if key != "source_reference"}
        assert "https://" not in repr(non_sources)
        assert all(source == "PARMAR/chat/providers.py" or source.startswith(("https://openai.com/", "https://developers.openai.com/", "https://ai.google.dev/", "https://docs.anthropic.com/", "https://docs.ollama.com/")) for source in record["source_reference"])


def test_local_demo_is_local_free_but_not_claimed_as_model_inference():
    decision = ProviderFreePolicy().evaluate("local-demo", "local-demo")

    assert decision.outcome == "FREE_ALLOWED"
    assert decision.eligible is True
    record = ProviderFreePolicy().record_for("local-demo").public_payload()
    assert record["free_status"] == LOCAL_FREE
    assert "deterministic" in record["limitations"].lower()


def test_officially_priced_openai_and_anthropic_models_are_paid_blocked():
    policy = ProviderFreePolicy()

    assert policy.evaluate("openai", "gpt-any-supported-model").outcome == "PAID_PROVIDER_BLOCKED"
    assert policy.evaluate("claude", "claude-any-model").outcome == "PAID_PROVIDER_BLOCKED"
    assert policy.record_for("openai").free_status == PAID_ONLY
    assert policy.record_for("claude").free_status == PAID_ONLY


def test_generic_http_and_unconfigured_local_runtime_are_unknown_and_blocked():
    policy = ProviderFreePolicy()

    assert policy.evaluate("http-json", "any-model").outcome == "UNKNOWN_PRICING_BLOCKED"
    assert policy.evaluate("ollama-local-candidate", "llama-model").outcome == "UNKNOWN_PRICING_BLOCKED"
    assert policy.evaluate("new-provider", "new-model").outcome == "UNKNOWN_PRICING_BLOCKED"
    assert policy.record_for("http-json").free_status == UNKNOWN


def test_gemini_free_tier_allows_only_the_officially_priced_model():
    policy = ProviderFreePolicy()

    assert policy.record_for("gemini").free_status == FREE_API
    assert policy.record_for("gemini").model_scope == ("gemini-3.7-flash",)
    assert policy.record_for("gemini").quota_status == FREE_QUOTA_AVAILABLE
    assert policy.evaluate("gemini", "gemini-3.7-flash").outcome == "FREE_ALLOWED"
    assert policy.evaluate("gemini", "gemini-3.7-flash").eligible is True
    assert policy.evaluate("gemini", "unmapped-gemini-model").outcome == "UNKNOWN_PRICING_BLOCKED"
    assert policy.evaluate("gemini", "gemini-2.5-flash").outcome == "UNKNOWN_PRICING_BLOCKED"


def test_verified_free_api_requires_exact_model_scope_and_available_quota():
    record = ProviderVerificationRecord(
        provider="fake-free-api",
        access_type="official_api",
        free_status=FREE_API,
        model_scope=("free-model-v1",),
        quota_status=FREE_QUOTA_AVAILABLE,
        payment_requirement="not_required_within_free_quota",
        authorization_requirement="explicit_server_authorization",
        source_reference=("https://provider.example/pricing",),
        verification_date="2026-10-01",
        limitations="Fake test record only; never use for a real provider.",
    )
    policy = ProviderFreePolicy(records=(record,))

    assert policy.evaluate("fake-free-api", "free-model-v1").outcome == "FREE_ALLOWED"
    assert policy.evaluate("fake-free-api", "paid-model-v1").outcome == "UNKNOWN_PRICING_BLOCKED"


def test_unknown_or_unavailable_quota_blocks_an_official_free_api():
    record = ProviderVerificationRecord(
        provider="fake-free-api",
        access_type="official_api",
        free_status=FREE_API,
        model_scope=("free-model-v1",),
        quota_status=FREE_STATUS_UNKNOWN,
        payment_requirement="unknown",
        authorization_requirement="explicit_server_authorization",
        source_reference=("https://provider.example/pricing",),
        verification_date="2026-10-01",
        limitations="Fake test record only.",
    )
    decision = ProviderFreePolicy(records=(record,)).evaluate("fake-free-api", "free-model-v1")

    assert decision.outcome == "FREE_QUOTA_UNAVAILABLE"
    assert decision.eligible is False


def test_provider_verification_does_not_authorize_execution():
    record = ProviderVerificationRecord(
        provider="fake-free-api",
        access_type="official_api",
        free_status=FREE_API,
        model_scope=("free-model-v1",),
        quota_status=FREE_QUOTA_AVAILABLE,
        payment_requirement="not_required_within_free_quota",
        authorization_requirement="explicit_server_authorization",
        source_reference=("https://provider.example/pricing",),
        verification_date="2026-10-01",
        limitations="Fake test record only.",
    )
    decision = ProviderFreePolicy(records=(record,)).evaluate("fake-free-api", "free-model-v1")

    assert decision.eligible is True
    assert decision.outcome == "FREE_ALLOWED"
    assert "authorization" in record.authorization_requirement