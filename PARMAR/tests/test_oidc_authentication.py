import io
import json
import socket
import sqlite3
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest

from cryptography.hazmat.primitives.asymmetric import rsa
import jwt

from PARMAR.identity_contracts import (
    AccountIdentity,
    AuthenticationContext,
    ProviderIdentity,
    VerifiedProviderIdentity,
)
from PARMAR.identity_store import IdentityStorageUnavailable, SQLiteIdentityRepository
from PARMAR.interface import futuristic_app
from PARMAR.oidc import (
    KeycloakOIDCAdapter,
    OIDCAuthorizationError,
    OIDCCallbackEvidence,
    OIDCConfiguration,
    OIDCIdentityResolver,
    OIDCStateStore,
    SQLiteOIDCStateStore,
    OIDCUnavailable,
)
from PARMAR.sessions import (
    InMemorySessionRepository,
    SESSION_COOKIE_NAME,
    SessionManager,
    SessionPolicy,
    SessionStorageUnavailable,
)


ISSUER = "https://keycloak.example.test/realms/parmar"
REDIRECT_URI = "https://parmar.example.test/api/auth/oidc/callback"


def configuration():
    return OIDCConfiguration(
        issuer=ISSUER,
        client_id="parmar-web",
        client_secret="test-secret",
        audience="parmar-web",
        redirect_uri=REDIRECT_URI,
    )


def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


class FakeResponse:
    status = 200

    def __init__(self, payload):
        self._payload = payload

    def read(self, size=-1):
        del size
        return json.dumps(self._payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        del exc_type, exc, traceback
        return False


def test_oidc_configuration_rejects_non_https_endpoints():
    with pytest.raises(OIDCUnavailable):
        OIDCConfiguration(
            issuer="http://keycloak.example.test",
            client_id="parmar-web",
            client_secret="secret",
            audience="parmar-web",
            redirect_uri=REDIRECT_URI,
        )


def test_oidc_configuration_requires_the_registered_callback_path():
    with pytest.raises(OIDCUnavailable):
        OIDCConfiguration(
            issuer=ISSUER,
            client_id="parmar-web",
            client_secret="secret",
            audience="parmar-web",
            redirect_uri="https://parmar.example.test/other/callback",
        )


def test_oidc_state_store_generates_pkce_and_consumes_once():
    store = OIDCStateStore(300)
    record, challenge, transaction_token = store.create(REDIRECT_URI)

    assert len(record.state) >= 43
    assert len(record.nonce) >= 43
    assert len(record.code_verifier) >= 43
    assert len(challenge) == 43
    assert store.consume(record.state, transaction_token=transaction_token) == record
    assert store.consume(record.state, transaction_token=transaction_token) is None


def test_oidc_state_store_rejects_transaction_mismatch(tmp_path):
    store = SQLiteOIDCStateStore(
        tmp_path / "oidc-state.sqlite3",
        ttl_seconds=300,
    )
    record, challenge, transaction_token = store.create(REDIRECT_URI)
    del challenge

    assert store.consume(record.state, transaction_token="wrong-transaction") is None
    assert store.consume(
        record.state,
        transaction_token=transaction_token,
    ) == record


def test_sqlite_oidc_state_expiry_survives_store_restart(tmp_path, monkeypatch):
    now = [1_700_000_000.0]
    monkeypatch.setattr("PARMAR.oidc.time.time", lambda: now[0])
    database_path = tmp_path / "oidc-state.sqlite3"
    store = SQLiteOIDCStateStore(database_path, ttl_seconds=300)
    record, _challenge, transaction_token = store.create(REDIRECT_URI)

    restarted_store = SQLiteOIDCStateStore(database_path, ttl_seconds=300)
    now[0] += 299
    assert restarted_store.consume(
        record.state,
        transaction_token=transaction_token,
    ) == record

    expired, _challenge, expired_transaction = restarted_store.create(REDIRECT_URI)
    now[0] += 301
    after_expiry_restart = SQLiteOIDCStateStore(database_path, ttl_seconds=300)
    assert after_expiry_restart.consume(
        expired.state,
        transaction_token=expired_transaction,
    ) is None


def test_oidc_authorization_url_contains_state_nonce_and_pkce(monkeypatch):
    adapter = KeycloakOIDCAdapter(configuration())
    monkeypatch.setattr(
        adapter,
        "discovery",
        lambda: {
            "issuer": ISSUER,
            "authorization_endpoint": ISSUER + "/protocol/openid-connect/auth",
            "token_endpoint": ISSUER + "/protocol/openid-connect/token",
            "jwks_uri": ISSUER + "/protocol/openid-connect/certs",
        },
    )
    state, challenge, _transaction_token = OIDCStateStore().create(REDIRECT_URI)
    url = adapter.authorization_url(state, challenge)
    query = parse_qs(urlparse(url).query)

    assert query["response_type"] == ["code"]
    assert query["client_id"] == ["parmar-web"]
    assert query["redirect_uri"] == [REDIRECT_URI]
    assert query["scope"] == ["openid"]
    assert query["state"] == [state.state]
    assert query["nonce"] == [state.nonce]
    assert query["code_challenge"] == [challenge]
    assert query["code_challenge_method"] == ["S256"]


def test_oidc_token_exchange_sends_pkce_and_never_logs_secret(monkeypatch):
    adapter = KeycloakOIDCAdapter(configuration())
    monkeypatch.setattr(
        adapter,
        "discovery",
        lambda: {
            "issuer": ISSUER,
            "authorization_endpoint": ISSUER + "/protocol/openid-connect/auth",
            "token_endpoint": ISSUER + "/protocol/openid-connect/token",
            "jwks_uri": ISSUER + "/protocol/openid-connect/certs",
        },
    )
    seen = {}

    def transport(request, timeout):
        del timeout
        seen["body"] = request.data.decode("ascii")
        return FakeResponse({"id_token": "header.payload.signature"})

    monkeypatch.setattr(adapter, "_transport", transport)
    state, _challenge, _transaction_token = OIDCStateStore().create(REDIRECT_URI)
    assert adapter.exchange_authorization_code("authorization-code", state) == (
        "header.payload.signature"
    )
    form = parse_qs(seen["body"])
    assert form["grant_type"] == ["authorization_code"]
    assert form["code"] == ["authorization-code"]
    assert form["redirect_uri"] == [REDIRECT_URI]
    assert form["code_verifier"] == [state.code_verifier]
    assert form["client_secret"] == ["test-secret"]


@pytest.mark.parametrize(
    ("status", "payload", "expected_error"),
    [
        (400, {"error": "invalid_grant"}, OIDCAuthorizationError),
        (400, {"error": "invalid_client"}, OIDCUnavailable),
        (401, {"error": "unauthorized"}, OIDCUnavailable),
    ],
)
def test_oidc_token_endpoint_errors_are_classified_by_protocol_error(
    monkeypatch,
    status,
    payload,
    expected_error,
):
    adapter = KeycloakOIDCAdapter(configuration())
    monkeypatch.setattr(
        adapter,
        "discovery",
        lambda: {
            "issuer": ISSUER,
            "authorization_endpoint": ISSUER + "/auth",
            "token_endpoint": ISSUER + "/token",
            "jwks_uri": ISSUER + "/certs",
        },
    )
    response = FakeResponse(payload)
    response.status = status
    monkeypatch.setattr(adapter, "_transport", lambda *_args, **_kwargs: response)
    state, _challenge, _transaction_token = OIDCStateStore().create(REDIRECT_URI)

    with pytest.raises(expected_error):
        adapter.exchange_authorization_code("authorization-code", state)


def token_endpoint_http_error(status, body):
    return urllib.error.HTTPError(
        ISSUER + "/protocol/openid-connect/token",
        status,
        "provider error",
        {},
        io.BytesIO(body),
    )


@pytest.mark.parametrize(
    ("status", "body", "expected_error"),
    [
        (
            400,
            b'{"error":"invalid_grant","error_description":"private-provider-detail"}',
            OIDCAuthorizationError,
        ),
        (
            400,
            b'{"error":"invalid_client","error_description":"private-provider-detail"}',
            OIDCUnavailable,
        ),
        (401, b'{"error":"unauthorized"}', OIDCUnavailable),
        (429, b'{"error":"slow_down"}', OIDCUnavailable),
        (500, b'{"error":"server_error"}', OIDCUnavailable),
        (503, b'not-json', OIDCUnavailable),
        (400, b'not-json', OIDCUnavailable),
    ],
)
def test_oidc_token_http_errors_are_classified_without_leaking_body(
    monkeypatch,
    status,
    body,
    expected_error,
):
    adapter = KeycloakOIDCAdapter(configuration())
    monkeypatch.setattr(
        adapter,
        "discovery",
        lambda: {
            "issuer": ISSUER,
            "authorization_endpoint": ISSUER + "/auth",
            "token_endpoint": ISSUER + "/token",
            "jwks_uri": ISSUER + "/certs",
        },
    )
    def raise_http_error(*_args, **_kwargs):
        raise token_endpoint_http_error(status, body)

    monkeypatch.setattr(adapter, "_transport", raise_http_error)
    state, _challenge, _transaction_token = OIDCStateStore().create(REDIRECT_URI)

    with pytest.raises(expected_error) as raised:
        adapter.exchange_authorization_code("authorization-code", state)
    assert "private-provider-detail" not in str(raised.value)
    assert "test-secret" not in str(raised.value)


@pytest.mark.parametrize(
    "failure",
    [
        urllib.error.URLError(socket.gaierror("private DNS detail")),
        urllib.error.URLError(ConnectionRefusedError("private connection detail")),
        TimeoutError("private timeout detail"),
    ],
    ids=("dns", "connection", "timeout"),
)
def test_oidc_token_transport_failures_are_unavailable_without_leaking(
    monkeypatch,
    failure,
):
    adapter = KeycloakOIDCAdapter(configuration())
    monkeypatch.setattr(
        adapter,
        "discovery",
        lambda: {
            "issuer": ISSUER,
            "authorization_endpoint": ISSUER + "/auth",
            "token_endpoint": ISSUER + "/token",
            "jwks_uri": ISSUER + "/certs",
        },
    )

    def fail_transport(*_args, **_kwargs):
        raise failure

    monkeypatch.setattr(adapter, "_transport", fail_transport)
    state, _challenge, _transaction_token = OIDCStateStore().create(REDIRECT_URI)

    with pytest.raises(OIDCUnavailable, match="provider is unavailable") as raised:
        adapter.exchange_authorization_code("authorization-code", state)
    assert "private" not in str(raised.value)


def test_oidc_token_http_error_response_size_is_bounded(monkeypatch):
    adapter = KeycloakOIDCAdapter(configuration())
    monkeypatch.setattr(
        adapter,
        "discovery",
        lambda: {
            "issuer": ISSUER,
            "authorization_endpoint": ISSUER + "/auth",
            "token_endpoint": ISSUER + "/token",
            "jwks_uri": ISSUER + "/certs",
        },
    )
    def oversized_error(*_args, **_kwargs):
        raise token_endpoint_http_error(400, b"x" * (512 * 1024 + 1))

    monkeypatch.setattr(adapter, "_transport", oversized_error)
    state, _challenge, _transaction_token = OIDCStateStore().create(REDIRECT_URI)

    with pytest.raises(OIDCUnavailable, match="response is too large"):
        adapter.exchange_authorization_code("authorization-code", state)


@pytest.mark.parametrize(
    ("status", "body", "expected_status"),
    [
        (400, b'{"error":"invalid_grant"}', 401),
        (429, b'{"error":"slow_down"}', 503),
        (500, b'{"error":"server_error"}', 503),
    ],
)
def test_oidc_callback_maps_token_http_errors_without_issuing_session(
    monkeypatch,
    status,
    body,
    expected_status,
):
    adapter = KeycloakOIDCAdapter(configuration())
    monkeypatch.setattr(
        adapter,
        "discovery",
        lambda: {
            "issuer": ISSUER,
            "authorization_endpoint": ISSUER + "/auth",
            "token_endpoint": ISSUER + "/token",
            "jwks_uri": ISSUER + "/certs",
        },
    )
    def raise_provider_error(*_args, **_kwargs):
        raise token_endpoint_http_error(status, body)

    monkeypatch.setattr(adapter, "_transport", raise_provider_error)
    manager = oidc_test_session_manager()
    response = {}

    _run_oidc_callback(
        monkeypatch,
        response,
        adapter=adapter,
        state_store=OIDCStateStore(300),
        session_manager=manager,
    )

    assert response["status"] == expected_status
    assert SESSION_COOKIE_NAME not in str(response.get("headers", {}).get("Set-Cookie", ""))
    assert len(manager.repository._sessions) == 0


@pytest.mark.parametrize(
    "body",
    [b"private malformed provider response", b"[]", b"x" * (512 * 1024 + 1)],
    ids=("malformed-json", "non-object-json", "oversized-response"),
)
def test_oidc_token_success_response_must_be_bounded_json_object(
    monkeypatch,
    body,
):
    class RawResponse:
        status = 200

        def read(self, size=-1):
            del size
            return body

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            del exc_type, exc, traceback
            return False

    adapter = KeycloakOIDCAdapter(configuration())
    monkeypatch.setattr(
        adapter,
        "discovery",
        lambda: {
            "issuer": ISSUER,
            "authorization_endpoint": ISSUER + "/auth",
            "token_endpoint": ISSUER + "/token",
            "jwks_uri": ISSUER + "/certs",
        },
    )
    monkeypatch.setattr(adapter, "_transport", lambda *_args, **_kwargs: RawResponse())
    state, _challenge, _transaction_token = OIDCStateStore().create(REDIRECT_URI)

    with pytest.raises(OIDCUnavailable) as raised:
        adapter.exchange_authorization_code("authorization-code", state)
    assert "private malformed provider response" not in str(raised.value)


def test_oidc_verify_rejects_wrong_nonce(monkeypatch):
    private_key = signing_key()
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {
            "iss": ISSUER,
            "aud": "parmar-web",
            "sub": "keycloak-user",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=5)).timestamp()),
            "nonce": "expected-nonce",
        },
        private_key,
        algorithm="RS256",
        headers={"kid": "test-key"},
    )

    class SigningKey:
        key = private_key.public_key()

    class JWKClient:
        def __init__(self, uri, timeout, **kwargs):
            del kwargs
            del uri, timeout

        def get_signing_key_from_jwt(self, token_value):
            del token_value
            return SigningKey()

    adapter = KeycloakOIDCAdapter(configuration())
    monkeypatch.setattr(
        adapter,
        "discovery",
        lambda: {"jwks_uri": ISSUER + "/protocol/openid-connect/certs"},
    )
    monkeypatch.setattr("PARMAR.oidc.PyJWKClient", JWKClient)
    assert adapter.verify(OIDCCallbackEvidence(token, "wrong-nonce")) is None


def test_oidc_verify_accepts_exact_issuer_audience_subject_and_nonce(monkeypatch):
    private_key = signing_key()
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {
            "iss": ISSUER,
            "aud": "parmar-web",
            "azp": "parmar-web",
            "sub": "keycloak-user",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=5)).timestamp()),
            "nonce": "same-nonce",
        },
        private_key,
        algorithm="RS256",
        headers={"kid": "test-key"},
    )

    class SigningKey:
        key = private_key.public_key()

    class JWKClient:
        def __init__(self, uri, timeout, **kwargs):
            del kwargs
            del uri, timeout

        def get_signing_key_from_jwt(self, token_value):
            del token_value
            return SigningKey()

    adapter = KeycloakOIDCAdapter(configuration())
    monkeypatch.setattr(
        adapter,
        "discovery",
        lambda: {"jwks_uri": ISSUER + "/protocol/openid-connect/certs"},
    )
    monkeypatch.setattr("PARMAR.oidc.PyJWKClient", JWKClient)
    verified = adapter.verify(OIDCCallbackEvidence(token, "same-nonce"))

    assert verified is not None
    assert str(verified.provider_identity.issuer) == ISSUER
    assert verified.provider_identity.subject == "keycloak-user"
    assert verified.authentication.expires_at > now


@pytest.mark.parametrize(
    ("azp", "expected"),
    [
        (None, False),
        ("other-client", False),
        ("parmar-web", True),
    ],
)
def test_oidc_verify_requires_matching_azp_for_multiple_audiences(
    monkeypatch,
    azp,
    expected,
):
    private_key = signing_key()
    now = datetime.now(timezone.utc)
    claims = {
        "iss": ISSUER,
        "aud": ["parmar-web", "another-client"],
        "sub": "keycloak-user",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=5)).timestamp()),
        "nonce": "same-nonce",
    }
    if azp is not None:
        claims["azp"] = azp
    token = jwt.encode(
        claims,
        private_key,
        algorithm="RS256",
        headers={"kid": "test-key"},
    )

    class SigningKey:
        key = private_key.public_key()

    class JWKClient:
        def __init__(self, uri, timeout, **kwargs):
            del kwargs
            del uri, timeout

        def get_signing_key_from_jwt(self, token_value):
            del token_value
            return SigningKey()

    adapter = KeycloakOIDCAdapter(configuration())
    monkeypatch.setattr(
        adapter,
        "discovery",
        lambda: {"jwks_uri": ISSUER + "/protocol/openid-connect/certs"},
    )
    monkeypatch.setattr("PARMAR.oidc.PyJWKClient", JWKClient)
    verified = adapter.verify(OIDCCallbackEvidence(token, "same-nonce"))

    assert (verified is not None) is expected


def test_oidc_jwks_fetch_uses_hardened_transport(monkeypatch):
    private_key = signing_key()
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {
            "iss": ISSUER,
            "aud": "parmar-web",
            "sub": "keycloak-user",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=5)).timestamp()),
            "nonce": "same-nonce",
        },
        private_key,
        algorithm="RS256",
        headers={"kid": "safe-jwks-key"},
    )
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key()))
    jwk.update(kid="safe-jwks-key", use="sig", alg="RS256")
    response = FakeResponse({"keys": [jwk]})
    captured = {}

    class FakeOpener:
        def open(self, request, timeout):
            captured["url"] = request.full_url
            captured["timeout"] = timeout
            return response

    def build_opener(*handlers):
        captured["handlers"] = handlers
        return FakeOpener()

    monkeypatch.setattr("PARMAR.oidc.urllib.request.build_opener", build_opener)
    adapter = KeycloakOIDCAdapter(configuration())
    monkeypatch.setattr(
        adapter,
        "discovery",
        lambda: {"jwks_uri": ISSUER + "/protocol/openid-connect/certs"},
    )

    verified = adapter.verify(OIDCCallbackEvidence(token, "same-nonce"))

    assert verified is not None
    assert captured["url"] == ISSUER + "/protocol/openid-connect/certs"
    assert captured["timeout"] == 10
    assert any(
        isinstance(handler, urllib.request.ProxyHandler) and handler.proxies == {}
        for handler in captured["handlers"]
    )
    redirect_handlers = [
        handler
        for handler in captured["handlers"]
        if isinstance(handler, urllib.request.HTTPRedirectHandler)
    ]
    assert len(redirect_handlers) == 1
    with pytest.raises(urllib.error.HTTPError):
        redirect_handlers[0].redirect_request(None, None, 302, "", None, "https://evil.test")


@pytest.mark.parametrize(
    "claim_updates",
    [
        {"iss": "https://other-issuer.example/realm"},
        {"aud": "other-audience"},
        {"exp": 1},
    ],
)
def test_oidc_verify_rejects_invalid_issuer_audience_or_expiry(monkeypatch, claim_updates):
    private_key = signing_key()
    now = datetime.now(timezone.utc)
    claims = {
        "iss": ISSUER,
        "aud": "parmar-web",
        "sub": "keycloak-user",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=5)).timestamp()),
        "nonce": "same-nonce",
    }
    claims.update(claim_updates)
    token = jwt.encode(
        claims,
        private_key,
        algorithm="RS256",
        headers={"kid": "test-key"},
    )

    class SigningKey:
        key = private_key.public_key()

    class JWKClient:
        def __init__(self, uri, timeout, **kwargs):
            del kwargs
            del uri, timeout

        def get_signing_key_from_jwt(self, token_value):
            del token_value
            return SigningKey()

    adapter = KeycloakOIDCAdapter(configuration())
    monkeypatch.setattr(
        adapter,
        "discovery",
        lambda: {"jwks_uri": ISSUER + "/protocol/openid-connect/certs"},
    )
    monkeypatch.setattr("PARMAR.oidc.PyJWKClient", JWKClient)
    assert adapter.verify(OIDCCallbackEvidence(token, "same-nonce")) is None


def test_oidc_verify_rejects_invalid_signature(monkeypatch):
    signing_key_value = signing_key()
    wrong_public_key = signing_key().public_key()
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {
            "iss": ISSUER,
            "aud": "parmar-web",
            "sub": "keycloak-user",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=5)).timestamp()),
            "nonce": "same-nonce",
        },
        signing_key_value,
        algorithm="RS256",
        headers={"kid": "test-key"},
    )

    class SigningKey:
        key = wrong_public_key

    class JWKClient:
        def __init__(self, uri, timeout, **kwargs):
            del kwargs
            del uri, timeout

        def get_signing_key_from_jwt(self, token_value):
            del token_value
            return SigningKey()

    adapter = KeycloakOIDCAdapter(configuration())
    monkeypatch.setattr(
        adapter,
        "discovery",
        lambda: {"jwks_uri": ISSUER + "/protocol/openid-connect/certs"},
    )
    monkeypatch.setattr("PARMAR.oidc.PyJWKClient", JWKClient)
    assert adapter.verify(OIDCCallbackEvidence(token, "same-nonce")) is None


def test_oidc_verify_preserves_jwks_provider_unavailability(monkeypatch):
    private_key = signing_key()
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {
            "iss": ISSUER,
            "aud": "parmar-web",
            "sub": "keycloak-user",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=5)).timestamp()),
            "nonce": "same-nonce",
        },
        private_key,
        algorithm="RS256",
        headers={"kid": "test-key"},
    )
    adapter = KeycloakOIDCAdapter(configuration())
    monkeypatch.setattr(
        adapter,
        "discovery",
        lambda: {"jwks_uri": ISSUER + "/protocol/openid-connect/certs"},
    )

    class UnavailableJWKClient:
        def __init__(self, *_args, **_kwargs):
            pass

        def get_signing_key_from_jwt(self, _token):
            raise jwt.exceptions.PyJWKClientConnectionError("provider secret details")

    monkeypatch.setattr("PARMAR.oidc.PyJWKClient", UnavailableJWKClient)
    with pytest.raises(OIDCUnavailable, match="provider is unavailable"):
        adapter.verify(OIDCCallbackEvidence(token, "same-nonce"))


def test_oidc_verify_rejects_unsigned_and_disallowed_algorithms(monkeypatch):
    now = datetime.now(timezone.utc)
    for algorithm, headers in (
        ("none", {"alg": "none"}),
        ("HS256", {"alg": "HS256", "kid": "test-key"}),
    ):
        del algorithm
        claims = {
            "iss": ISSUER,
            "aud": "parmar-web",
            "sub": "keycloak-user",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=5)).timestamp()),
            "nonce": "same-nonce",
        }
        token = jwt.encode(claims, "", algorithm="none", headers=headers) if headers["alg"] == "none" else jwt.encode(
            claims,
            "shared-secret",
            algorithm="HS256",
            headers=headers,
        )
        adapter = KeycloakOIDCAdapter(configuration())
        assert adapter.verify(OIDCCallbackEvidence(token, "same-nonce")) is None


@pytest.mark.parametrize(
    "subject",
    [
        "",
        "  keycloak-user  ",
        "keycloak\tuser",
        "x" * 1025,
    ],
)
def test_oidc_verify_rejects_malformed_subject(monkeypatch, subject):
    private_key = signing_key()
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {
            "iss": ISSUER,
            "aud": "parmar-web",
            "sub": subject,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=5)).timestamp()),
            "nonce": "same-nonce",
        },
        private_key,
        algorithm="RS256",
        headers={"kid": "test-key"},
    )

    class SigningKey:
        key = private_key.public_key()

    class JWKClient:
        def __init__(self, uri, timeout, **kwargs):
            del uri, timeout, kwargs

        def get_signing_key_from_jwt(self, token_value):
            del token_value
            return SigningKey()

    adapter = KeycloakOIDCAdapter(configuration())
    monkeypatch.setattr(
        adapter,
        "discovery",
        lambda: {"jwks_uri": ISSUER + "/protocol/openid-connect/certs"},
    )
    monkeypatch.setattr("PARMAR.oidc.PyJWKClient", JWKClient)
    assert adapter.verify(OIDCCallbackEvidence(token, "same-nonce")) is None


def test_oidc_verify_rejects_missing_key_id_and_accepts_rotation_cache(monkeypatch):
    private_key = signing_key()
    now = datetime.now(timezone.utc)
    base_claims = {
        "iss": ISSUER,
        "aud": "parmar-web",
        "sub": "keycloak-user",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=5)).timestamp()),
        "nonce": "same-nonce",
    }
    missing_kid = jwt.encode(
        base_claims,
        private_key,
        algorithm="RS256",
        headers={},
    )
    adapter = KeycloakOIDCAdapter(configuration())
    assert adapter.verify(OIDCCallbackEvidence(missing_kid, "same-nonce")) is None

    captured = {}

    class SigningKey:
        key = private_key.public_key()

    class JWKClient:
        def __init__(self, uri, timeout, **kwargs):
            captured.update(uri=uri, timeout=timeout, kwargs=kwargs)

        def get_signing_key_from_jwt(self, token_value):
            del token_value
            return SigningKey()

    token = jwt.encode(
        base_claims,
        private_key,
        algorithm="RS256",
        headers={"kid": "rotating-key"},
    )
    monkeypatch.setattr(
        adapter,
        "discovery",
        lambda: {"jwks_uri": ISSUER + "/protocol/openid-connect/certs"},
    )
    monkeypatch.setattr("PARMAR.oidc.PyJWKClient", JWKClient)

    assert adapter.verify(OIDCCallbackEvidence(token, "same-nonce")) is not None
    assert captured["timeout"] == 10
    assert captured["kwargs"]["cache_keys"] is True
    assert captured["kwargs"]["lifespan"] == 300


def test_unknown_oidc_binding_fails_closed(tmp_path):
    repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    account = repository._provision_account(AccountIdentity.generate())
    del account

    now = datetime.now(timezone.utc)

    class FakeAdapter:
        def verify(self, evidence):
            del evidence
            return VerifiedProviderIdentity(
                ProviderIdentity(ISSUER, "unknown-subject"),
                AuthenticationContext(now, now + timedelta(minutes=5)),
            )

    adapter = FakeAdapter()
    resolver = OIDCIdentityResolver(adapter, repository)
    evidence = OIDCCallbackEvidence("valid", "nonce")

    assert resolver.resolve(evidence) is None


def test_oidc_http_start_is_opt_in_and_returns_no_secret(monkeypatch):
    config = configuration()
    adapter = SimpleNamespace(
        authorization_url=lambda state, challenge: (
            ISSUER + "/auth?state=" + state.state + "&challenge=" + challenge
        ),
    )
    store = OIDCStateStore(300)
    monkeypatch.setattr(futuristic_app, "OIDC_ADAPTER", adapter)
    monkeypatch.setattr(futuristic_app, "OIDC_STATE_STORE", store)
    monkeypatch.setattr(futuristic_app, "OIDC_CONFIGURATION", config)
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", object())
    monkeypatch.setattr(futuristic_app, "_reject_client_identity", lambda *_args: False)
    monkeypatch.setattr(
        futuristic_app,
        "_resolve_request_context",
        lambda request: setattr(
            request,
            "request_context",
            futuristic_app.HTTPRequestContext(
                futuristic_app.Principal.anonymous_local_demo(),
            ),
        ) or True,
    )
    monkeypatch.setattr(futuristic_app, "_require_csrf", lambda *_args: True)
    monkeypatch.setattr(futuristic_app, "_unsafe_request_origin_is_valid", lambda *_args: True)

    body = b"{}"
    response = {}
    request = SimpleNamespace(
        path="/api/auth/oidc/start",
        headers={
            "Content-Length": "2",
            "Content-Type": "application/json",
        },
        rfile=io.BytesIO(body),
        _send_json=lambda status, payload: response.update(status=status, payload=payload),
        _send_json_with_headers=lambda status, payload, headers: response.update(
            status=status,
            payload=payload,
            headers=headers,
        ),
        send_error=lambda status, message: response.update(status=status, message=message),
    )
    futuristic_app.PARMARRequestHandler.do_POST(request)

    assert response["status"] == 200
    assert "authorization_url" in response["payload"]
    assert "test-secret" not in json.dumps(response)
    set_cookie = response["headers"]["Set-Cookie"]
    assert futuristic_app.OIDC_TRANSACTION_COOKIE_NAME in set_cookie
    assert "HttpOnly" in set_cookie
    assert "Secure" in set_cookie
    assert "SameSite=Lax" in set_cookie
    assert "Path=/" in set_cookie
    assert "Path=/api/auth/oidc" not in set_cookie


def test_oidc_callback_state_mismatch_never_exchanges_code(monkeypatch):
    exchanged = []
    adapter = SimpleNamespace(
        exchange_authorization_code=lambda *args: exchanged.append(args),
    )
    monkeypatch.setattr(futuristic_app, "OIDC_ADAPTER", adapter)
    monkeypatch.setattr(futuristic_app, "OIDC_STATE_STORE", OIDCStateStore(300))
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", object())
    monkeypatch.setattr(futuristic_app, "_request_is_tls", lambda _request: True)

    response = {}
    request = SimpleNamespace(
        path="/api/auth/oidc/callback?code=valid-code&state=wrong-state",
        _send_json=lambda status, payload: response.update(status=status, payload=payload),
        _send_json_with_headers=lambda status, payload, headers: response.update(
            status=status,
            payload=payload,
            headers=headers,
        ),
        send_error=lambda status, message: response.update(status=status, message=message),
    )
    futuristic_app.PARMARRequestHandler.do_GET(request)

    assert response["status"] == 401
    assert exchanged == []


def make_oidc_callback_request(response, *, headers=None):
    return SimpleNamespace(
        path="/api/auth/oidc/callback",
        headers=headers or {},
        _send_json=lambda status, payload: response.update(status=status, payload=payload),
        _send_json_with_headers=lambda status, payload, headers: response.update(
            status=status,
            payload=payload,
            headers=headers,
        ),
        send_error=lambda status, message: response.update(status=status, message=message),
    )


def assert_oidc_transaction_cookie_cleared(response, expected_status):
    assert response["status"] == expected_status
    assert response["headers"]["Set-Cookie"] == (
        futuristic_app.clear_oidc_transaction_cookie_header()
    )
    assert "Path=/;" in response["headers"]["Set-Cookie"]


def test_oidc_callback_unavailable_clears_transaction_cookie(monkeypatch):
    monkeypatch.setattr(futuristic_app, "OIDC_ADAPTER", None)
    monkeypatch.setattr(futuristic_app, "OIDC_STATE_STORE", None)
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", None)
    response = {}

    futuristic_app.PARMARRequestHandler.do_GET(make_oidc_callback_request(response))

    assert_oidc_transaction_cookie_cleared(response, 503)


def test_oidc_callback_non_tls_rejection_clears_transaction_cookie(monkeypatch):
    monkeypatch.setattr(futuristic_app, "OIDC_ADAPTER", object())
    monkeypatch.setattr(futuristic_app, "OIDC_STATE_STORE", object())
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", object())
    monkeypatch.setattr(futuristic_app, "_request_is_tls", lambda _request: False)
    response = {}

    futuristic_app.PARMARRequestHandler.do_GET(make_oidc_callback_request(response))

    assert_oidc_transaction_cookie_cleared(response, 403)


def test_oidc_callback_session_resolution_failure_clears_transaction_cookie(monkeypatch):
    class FailingSessionManager:
        def resolve(self, token):
            del token
            raise SessionStorageUnavailable("session storage unavailable")

    monkeypatch.setattr(futuristic_app, "OIDC_ADAPTER", object())
    monkeypatch.setattr(futuristic_app, "OIDC_STATE_STORE", object())
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", FailingSessionManager())
    monkeypatch.setattr(futuristic_app, "_request_is_tls", lambda _request: True)
    response = {}
    request = make_oidc_callback_request(
        response,
        headers={"Cookie": "__Host-parmar_session=opaque-session-token"},
    )

    futuristic_app.PARMARRequestHandler.do_GET(request)

    assert_oidc_transaction_cookie_cleared(response, 503)


def test_oidc_callback_active_session_rejection_clears_transaction_cookie(monkeypatch):
    monkeypatch.setattr(futuristic_app, "OIDC_ADAPTER", object())
    monkeypatch.setattr(futuristic_app, "OIDC_STATE_STORE", object())
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", object())
    monkeypatch.setattr(futuristic_app, "_request_is_tls", lambda _request: True)
    monkeypatch.setattr(
        futuristic_app,
        "_resolve_request_context",
        lambda request, **_kwargs: setattr(
            request,
            "request_context",
            SimpleNamespace(principal=SimpleNamespace(authenticated=True)),
        ) or True,
    )
    response = {}

    futuristic_app.PARMARRequestHandler.do_GET(make_oidc_callback_request(response))

    assert_oidc_transaction_cookie_cleared(response, 409)


def test_oidc_callback_existing_binding_issues_trusted_session(monkeypatch, tmp_path):
    repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    account = repository._provision_account(AccountIdentity.generate())
    provider = ProviderIdentity(ISSUER, "bound-keycloak-subject")
    created_at = datetime.now(timezone.utc).isoformat()
    with repository._connection() as connection:
        connection.execute(
            """
            INSERT INTO provider_account_bindings(issuer, subject, account_id, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (provider.issuer, provider.subject, account.account_identity.serialize(), created_at),
        )

    now = datetime.now(timezone.utc)

    class FakeAdapter:
        def verify(self, evidence):
            del evidence
            return VerifiedProviderIdentity(
                provider,
                AuthenticationContext(now, now + timedelta(minutes=5)),
            )

        def exchange_authorization_code(self, code, state):
            del code, state
            return "mock-id-token"

    adapter = FakeAdapter()
    store = OIDCStateStore(300)
    state, _challenge, transaction_token = store.create(REDIRECT_URI)
    manager = SessionManager(
        InMemorySessionRepository(),
        SessionPolicy(idle_timeout_seconds=600, absolute_timeout_seconds=1800),
        account_status_lookup=repository.is_account_active,
    )
    monkeypatch.setattr(futuristic_app, "OIDC_ADAPTER", adapter)
    monkeypatch.setattr(futuristic_app, "OIDC_STATE_STORE", store)
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", manager)
    monkeypatch.setattr(futuristic_app, "IDENTITY_REPOSITORY", repository)
    monkeypatch.setattr(futuristic_app, "_request_is_tls", lambda _request: True)

    response = {}
    request = SimpleNamespace(
        path=(
            "/api/auth/oidc/callback?"
            "code=valid-code&state=" + state.state
        ),
        headers={
            "Cookie": (
                futuristic_app.OIDC_TRANSACTION_COOKIE_NAME
                + "="
                + transaction_token
            ),
        },
        _send_json=lambda status, payload: response.update(status=status, payload=payload),
        _send_json_with_headers=lambda status, payload, headers: response.update(
            status=status,
            payload=payload,
            headers=headers,
        ),
        send_error=lambda status, message: response.update(status=status, message=message),
    )
    futuristic_app.PARMARRequestHandler.do_GET(request)

    assert response["status"] == 200
    assert response["payload"]["authenticated"] is True
    set_cookies = response["headers"]["Set-Cookie"]
    assert isinstance(set_cookies, list)
    session_cookie = set_cookies[0]
    token = session_cookie.split(";", 1)[0].split("=", 1)[1]
    assert futuristic_app.OIDC_TRANSACTION_COOKIE_NAME in set_cookies[1]
    session = manager.resolve(token)
    assert session is not None
    assert session.account_identity == account.account_identity


def _run_oidc_callback(
    monkeypatch,
    response,
    *,
    adapter,
    state_store,
    session_manager,
    query=None,
    transaction_cookie=True,
    transaction_cookie_value=None,
    invoke_callback=True,
):
    create_state = getattr(state_store, "create", None)
    state, _challenge, transaction_token = (
        create_state(REDIRECT_URI)
        if callable(create_state)
        else OIDCStateStore(300).create(REDIRECT_URI)
    )
    monkeypatch.setattr(futuristic_app, "OIDC_ADAPTER", adapter)
    monkeypatch.setattr(futuristic_app, "OIDC_STATE_STORE", state_store)
    monkeypatch.setattr(futuristic_app, "SESSION_MANAGER", session_manager)
    monkeypatch.setattr(futuristic_app, "_request_is_tls", lambda _request: True)
    monkeypatch.setattr(
        futuristic_app,
        "_resolve_request_context",
        lambda request, **_kwargs: setattr(
            request,
            "request_context",
            futuristic_app.HTTPRequestContext(
                futuristic_app.Principal.anonymous_local_demo(),
            ),
        ) or True,
    )
    headers = {}
    if transaction_cookie:
        cookie_value = transaction_cookie_value or transaction_token
        headers["Cookie"] = (
            futuristic_app.OIDC_TRANSACTION_COOKIE_NAME + "=" + cookie_value
        )
    request = make_oidc_callback_request(response, headers=headers)
    callback_query = (
        query.format(state=state.state)
        if query is not None
        else "code=valid-code&state=" + state.state
    )
    request.path = "/api/auth/oidc/callback?" + callback_query
    if invoke_callback:
        futuristic_app.PARMARRequestHandler.do_GET(request)
    return state, transaction_token, request


def oidc_test_session_manager():
    return SessionManager(
        InMemorySessionRepository(),
        SessionPolicy(idle_timeout_seconds=600, absolute_timeout_seconds=1800),
    )


@pytest.mark.parametrize(
    ("query", "transaction_cookie", "transaction_cookie_value"),
    [
        (None, False, None),
        ("code=valid-code&state=unknown-state", True, None),
        (None, True, "different-browser-transaction"),
        ("code=valid-code", True, None),
        ("code=valid-code&state={state}&state={state}", True, None),
        ("error=access_denied&state={state}", True, None),
    ],
    ids=(
        "missing-cookie",
        "invalid-state",
        "state-cookie-mismatch",
        "missing-state",
        "duplicate-state",
        "provider-rejection",
    ),
)
def test_oidc_callback_invalid_authentication_returns_401_without_session(
    monkeypatch,
    query,
    transaction_cookie,
    transaction_cookie_value,
):
    class UnexpectedExchange:
        def exchange_authorization_code(self, *_args):
            pytest.fail("Invalid callback authentication must not exchange a code.")

    manager = oidc_test_session_manager()
    response = {}
    _run_oidc_callback(
        monkeypatch,
        response,
        adapter=UnexpectedExchange(),
        state_store=OIDCStateStore(300),
        session_manager=manager,
        query=query,
        transaction_cookie=transaction_cookie,
        transaction_cookie_value=transaction_cookie_value,
    )

    assert response["status"] == 401
    assert SESSION_COOKIE_NAME not in str(response.get("headers", {}).get("Set-Cookie", ""))
    assert len(manager.repository._sessions) == 0


def test_oidc_provider_error_consumes_state_and_replay_is_rejected(monkeypatch):
    class UnexpectedExchange:
        def exchange_authorization_code(self, *_args):
            pytest.fail("A provider-error callback must not exchange a code.")

    state_store = OIDCStateStore(300)
    manager = oidc_test_session_manager()
    response = {}
    state, transaction_token, request = _run_oidc_callback(
        monkeypatch,
        response,
        adapter=UnexpectedExchange(),
        state_store=state_store,
        session_manager=manager,
        query="error=access_denied&state={state}",
    )

    assert response["status"] == 401
    assert response["payload"]["message"] == "OIDC authentication was rejected."
    assert state_store.consume(
        state.state,
        transaction_token=transaction_token,
    ) is None
    assert len(manager.repository._sessions) == 0

    response.clear()
    futuristic_app.PARMARRequestHandler.do_GET(request)

    assert response["status"] == 401
    assert len(manager.repository._sessions) == 0


@pytest.mark.parametrize(
    ("query", "transaction_cookie", "transaction_cookie_value"),
    [
        ("error=access_denied&state={state}", False, None),
        ("error=access_denied&state=unknown-state", True, None),
        ("error=access_denied&state={state}", True, "different-browser-transaction"),
    ],
    ids=("missing-cookie", "invalid-state", "cookie-state-mismatch"),
)
def test_oidc_provider_error_invalid_transaction_fails_without_session(
    monkeypatch,
    query,
    transaction_cookie,
    transaction_cookie_value,
):
    class UnexpectedExchange:
        def exchange_authorization_code(self, *_args):
            pytest.fail("An invalid provider-error transaction must not exchange a code.")

    manager = oidc_test_session_manager()
    response = {}
    _run_oidc_callback(
        monkeypatch,
        response,
        adapter=UnexpectedExchange(),
        state_store=OIDCStateStore(300),
        session_manager=manager,
        query=query,
        transaction_cookie=transaction_cookie,
        transaction_cookie_value=transaction_cookie_value,
    )

    assert response["status"] == 401
    assert SESSION_COOKIE_NAME not in str(response.get("headers", {}).get("Set-Cookie", ""))
    assert len(manager.repository._sessions) == 0


def test_oidc_callback_expired_state_returns_401_without_session(monkeypatch):
    now = [1_700_000_000.0]
    monkeypatch.setattr("PARMAR.oidc.time.time", lambda: now[0])
    state_store = OIDCStateStore(300)
    manager = oidc_test_session_manager()
    response = {}

    class UnexpectedExchange:
        def exchange_authorization_code(self, *_args):
            pytest.fail("Expired state must not exchange a code.")

    state, transaction_token, _request = _run_oidc_callback(
        monkeypatch,
        response,
        adapter=UnexpectedExchange(),
        state_store=state_store,
        session_manager=manager,
        invoke_callback=False,
    )
    now[0] += 301
    request = make_oidc_callback_request(response)
    request.headers = {
        "Cookie": (
            futuristic_app.OIDC_TRANSACTION_COOKIE_NAME + "=" + transaction_token
        )
    }
    request.path = "/api/auth/oidc/callback?code=valid-code&state=" + state.state
    futuristic_app.PARMARRequestHandler.do_GET(request)

    assert response["status"] == 401
    assert SESSION_COOKIE_NAME not in str(response.get("headers", {}).get("Set-Cookie", ""))
    assert len(manager.repository._sessions) == 0


def test_oidc_provider_error_expired_transaction_is_rejected(monkeypatch):
    now = [1_700_000_000.0]
    monkeypatch.setattr("PARMAR.oidc.time.time", lambda: now[0])

    class UnexpectedExchange:
        def exchange_authorization_code(self, *_args):
            pytest.fail("An expired provider-error transaction must not exchange a code.")

    manager = oidc_test_session_manager()
    response = {}
    _state, _transaction_token, request = _run_oidc_callback(
        monkeypatch,
        response,
        adapter=UnexpectedExchange(),
        state_store=OIDCStateStore(300),
        session_manager=manager,
        query="error=access_denied&state={state}",
        invoke_callback=False,
    )
    now[0] += 301
    futuristic_app.PARMARRequestHandler.do_GET(request)

    assert response["status"] == 401
    assert SESSION_COOKIE_NAME not in str(response.get("headers", {}).get("Set-Cookie", ""))
    assert len(manager.repository._sessions) == 0


def test_oidc_provider_error_state_store_outage_returns_503_without_session(monkeypatch):
    class UnavailableStateStore(OIDCStateStore):
        def consume(self, *_args, **_kwargs):
            raise OIDCUnavailable("private state-store details")

    class UnexpectedExchange:
        def exchange_authorization_code(self, *_args):
            pytest.fail("A state-store outage must not exchange a code.")

    manager = oidc_test_session_manager()
    response = {}
    _run_oidc_callback(
        monkeypatch,
        response,
        adapter=UnexpectedExchange(),
        state_store=UnavailableStateStore(300),
        session_manager=manager,
        query="error=access_denied&state={state}",
    )

    assert response["status"] == 503
    assert "private state-store details" not in json.dumps(response)
    assert SESSION_COOKIE_NAME not in str(response.get("headers", {}).get("Set-Cookie", ""))
    assert len(manager.repository._sessions) == 0


def test_oidc_callback_replay_after_rejection_does_not_issue_session(monkeypatch):
    calls = []

    class RejectedCodeAdapter:
        def exchange_authorization_code(self, *_args):
            calls.append("exchange")
            raise OIDCAuthorizationError("invalid authorization code")

    manager = oidc_test_session_manager()
    response = {}
    _state, _transaction_token, request = _run_oidc_callback(
        monkeypatch,
        response,
        adapter=RejectedCodeAdapter(),
        state_store=OIDCStateStore(300),
        session_manager=manager,
    )
    assert response["status"] == 401
    assert len(manager.repository._sessions) == 0

    response.clear()
    futuristic_app.PARMARRequestHandler.do_GET(request)

    assert response["status"] == 401
    assert calls == ["exchange"]
    assert len(manager.repository._sessions) == 0


def test_oidc_callback_unknown_query_parameter_remains_bad_request(monkeypatch):
    class UnexpectedExchange:
        def exchange_authorization_code(self, *_args):
            pytest.fail("Malformed non-authentication request must not exchange a code.")

    response = {}
    _run_oidc_callback(
        monkeypatch,
        response,
        adapter=UnexpectedExchange(),
        state_store=OIDCStateStore(300),
        session_manager=oidc_test_session_manager(),
        query="code=valid-code&state={state}&unexpected=value",
    )
    assert response["status"] == 400


def test_oidc_callback_invalid_authorization_returns_401(monkeypatch):
    class InvalidCodeAdapter:
        def exchange_authorization_code(self, _code, _state):
            raise OIDCAuthorizationError("invalid code")

    response = {}
    _run_oidc_callback(
        monkeypatch,
        response,
        adapter=InvalidCodeAdapter(),
        state_store=OIDCStateStore(300),
        session_manager=object(),
    )

    assert response["status"] == 401
    assert "invalid code" not in json.dumps(response)


def test_oidc_callback_provider_outage_returns_503(monkeypatch):
    class UnavailableAdapter:
        def exchange_authorization_code(self, _code, _state):
            return "id-token"

        def verify(self, _evidence):
            raise OIDCUnavailable("provider details must remain private")

    manager = SessionManager(
        InMemorySessionRepository(),
        SessionPolicy(idle_timeout_seconds=600, absolute_timeout_seconds=1800),
    )
    response = {}
    _run_oidc_callback(
        monkeypatch,
        response,
        adapter=UnavailableAdapter(),
        state_store=OIDCStateStore(300),
        session_manager=manager,
    )

    assert response["status"] == 503
    assert "provider details" not in json.dumps(response)
    assert "Set-Cookie" not in response["headers"] or SESSION_COOKIE_NAME not in (
        response["headers"]["Set-Cookie"]
    )


def test_oidc_callback_state_store_outage_returns_503_without_exchange(monkeypatch):
    class UnavailableStateStore:
        def consume(self, *_args, **_kwargs):
            raise OIDCUnavailable("state database details")

    class UnexpectedExchange:
        def exchange_authorization_code(self, *_args):
            pytest.fail("A failed state lookup must not exchange a code.")

    response = {}
    _run_oidc_callback(
        monkeypatch,
        response,
        adapter=UnexpectedExchange(),
        state_store=UnavailableStateStore(),
        session_manager=object(),
    )

    assert response["status"] == 503
    assert "state database details" not in json.dumps(response)
    assert SESSION_COOKIE_NAME not in str(response.get("headers", {}).get("Set-Cookie", ""))


def test_sqlite_oidc_state_store_enables_and_verifies_foreign_keys():
    connection = sqlite3.connect(":memory:")
    try:
        connection.execute("PRAGMA foreign_keys = OFF")
        SQLiteOIDCStateStore._enable_and_verify_foreign_keys(connection)
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    finally:
        connection.close()


def test_sqlite_oidc_state_store_rejects_unverifiable_foreign_keys():
    class FakeConnection:
        def execute(self, sql):
            if sql.strip().upper() == "PRAGMA FOREIGN_KEYS = ON":
                return None
            if sql.strip().upper() == "PRAGMA FOREIGN_KEYS":
                return SimpleNamespace(fetchone=lambda: (0,))
            raise AssertionError(sql)

    with pytest.raises(OIDCUnavailable, match="state storage is unavailable"):
        SQLiteOIDCStateStore._enable_and_verify_foreign_keys(FakeConnection())


def test_sqlite_oidc_state_store_wraps_runtime_storage_outage(tmp_path):
    store = SQLiteOIDCStateStore(tmp_path / "oidc-state.sqlite3", ttl_seconds=300)
    record, _challenge, transaction_token = store.create(REDIRECT_URI)
    store.database_path.unlink()

    with pytest.raises(OIDCUnavailable, match="state storage is unavailable"):
        store.consume(record.state, transaction_token=transaction_token)


def test_oidc_callback_session_store_outage_returns_503_without_session_cookie(monkeypatch):
    class UnavailableSessionManager:
        def create_identity_session(self, *_args):
            raise SessionStorageUnavailable("session database details")

    class ValidAdapter:
        def exchange_authorization_code(self, _code, _state):
            return "id-token"

    response = {}
    _run_oidc_callback(
        monkeypatch,
        response,
        adapter=ValidAdapter(),
        state_store=OIDCStateStore(300),
        session_manager=UnavailableSessionManager(),
    )

    assert response["status"] == 503
    assert "session database details" not in json.dumps(response)
    assert SESSION_COOKIE_NAME not in str(response.get("headers", {}).get("Set-Cookie", ""))


def test_oidc_callback_identity_store_outage_returns_503(monkeypatch):
    now = datetime.now(timezone.utc)

    class ValidAdapter:
        def exchange_authorization_code(self, _code, _state):
            return "id-token"

        def verify(self, _evidence):
            return VerifiedProviderIdentity(
                ProviderIdentity(ISSUER, "bound-subject"),
                AuthenticationContext(now, now + timedelta(minutes=5)),
            )

    class UnavailableIdentityRepository:
        def find_existing_account(self, _provider_identity):
            raise IdentityStorageUnavailable("identity database details")

    manager = SessionManager(
        InMemorySessionRepository(),
        SessionPolicy(idle_timeout_seconds=600, absolute_timeout_seconds=1800),
    )
    monkeypatch.setattr(
        futuristic_app,
        "IDENTITY_REPOSITORY",
        UnavailableIdentityRepository(),
    )
    response = {}
    _run_oidc_callback(
        monkeypatch,
        response,
        adapter=ValidAdapter(),
        state_store=OIDCStateStore(300),
        session_manager=manager,
    )

    assert response["status"] == 503
    assert "identity database details" not in json.dumps(response)
    assert SESSION_COOKIE_NAME not in str(response.get("headers", {}).get("Set-Cookie", ""))


def test_oidc_callback_unexpected_exception_returns_safe_500(monkeypatch):
    class BrokenAdapter:
        def exchange_authorization_code(self, _code, _state):
            raise RuntimeError("private-secret token and internal stack")

    response = {}
    _run_oidc_callback(
        monkeypatch,
        response,
        adapter=BrokenAdapter(),
        state_store=OIDCStateStore(300),
        session_manager=object(),
    )

    assert response["status"] == 500
    serialized = json.dumps(response)
    assert "private-secret" not in serialized
    assert "internal stack" not in serialized
    assert "Traceback" not in serialized
    assert SESSION_COOKIE_NAME not in str(response.get("headers", {}).get("Set-Cookie", ""))
