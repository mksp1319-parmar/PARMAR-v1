"""Opt-in OpenID Connect authentication for a future Keycloak deployment.

This module is disabled unless explicitly configured. It resolves only existing
provider-to-PARMAR account bindings; it never creates accounts or writes bindings.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

try:
    import jwt
    from jwt import PyJWKClient
except ImportError:
    jwt = None
    PyJWKClient = None

from PARMAR.identity_contracts import (
    AuthenticationContext,
    ProviderAccountBindingLookup,
    ProviderIdentity,
    VerifiedProviderIdentity,
    resolve_authenticated_principal,
)


class OIDCUnavailable(RuntimeError):
    """Raised when OIDC configuration or a required provider operation is unavailable."""


class OIDCAuthorizationError(RuntimeError):
    """Raised for invalid or mismatched OIDC authorization evidence."""


OIDC_CALLBACK_PATH = "/api/auth/oidc/callback"


@dataclass(frozen=True)
class OIDCConfiguration:
    issuer: str
    client_id: str
    client_secret: str
    audience: str
    redirect_uri: str
    state_ttl_seconds: int = 300

    def __post_init__(self) -> None:
        for name, value in (
            ("issuer", self.issuer),
            ("client_id", self.client_id),
            ("client_secret", self.client_secret),
            ("audience", self.audience),
            ("redirect_uri", self.redirect_uri),
        ):
            if not isinstance(value, str) or not value or value != value.strip():
                raise OIDCUnavailable(f"OIDC {name} is unavailable.")
        if self.state_ttl_seconds <= 0 or self.state_ttl_seconds > 900:
            raise OIDCUnavailable("OIDC state TTL is unavailable.")

        object.__setattr__(self, "issuer", self.issuer.rstrip("/"))

        try:
            issuer = urlsplit(self.issuer)
            redirect = urlsplit(self.redirect_uri)
            issuer_port = issuer.port
            redirect_port = redirect.port
        except ValueError:
            raise OIDCUnavailable("OIDC HTTPS endpoints are invalid.") from None
        if (
            issuer.scheme != "https"
            or issuer.hostname is None
            or issuer.username is not None
            or issuer.password is not None
            or issuer.query
            or issuer.fragment
            or redirect.scheme != "https"
            or redirect.username is not None
            or redirect.password is not None
            or redirect.query
            or redirect.fragment
            or redirect.hostname is None
            or redirect.path != OIDC_CALLBACK_PATH
        ):
            raise OIDCUnavailable("OIDC HTTPS endpoints are required.")
        if (
            issuer_port is not None
            and not 1 <= issuer_port <= 65535
        ) or (
            redirect_port is not None
            and not 1 <= redirect_port <= 65535
        ):
            raise OIDCUnavailable("OIDC HTTPS endpoints are invalid.")


@dataclass(frozen=True)
class OIDCState:
    state: str
    nonce: str
    code_verifier: str
    redirect_uri: str
    expires_at: float
    transaction_hash: str


@dataclass(frozen=True)
class OIDCCallbackEvidence:
    id_token: str
    nonce: str


class OIDCStateStore:
    """Short-lived, process-local, one-time authorization state."""

    def __init__(self, ttl_seconds: int = 300) -> None:
        if ttl_seconds <= 0 or ttl_seconds > 900:
            raise ValueError("OIDC state TTL is invalid.")
        self._ttl_seconds = ttl_seconds
        self._lock = threading.Lock()
        self._states: dict[str, OIDCState] = {}

    def create(
        self,
        redirect_uri: str,
        *,
        transaction_token: str | None = None,
    ) -> tuple[OIDCState, str, str]:
        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        browser_transaction = transaction_token or secrets.token_urlsafe(32)
        transaction_hash = hashlib.sha256(
            browser_transaction.encode("ascii")
        ).hexdigest()
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest()
        ).rstrip(b"=").decode("ascii")
        record = OIDCState(
            state=state,
            nonce=nonce,
            code_verifier=verifier,
            redirect_uri=redirect_uri,
            expires_at=time.time() + self._ttl_seconds,
            transaction_hash=transaction_hash,
        )
        with self._lock:
            self._states[state] = record
        return record, challenge, browser_transaction

    def consume(
        self,
        state: object,
        *,
        transaction_token: object = None,
    ) -> OIDCState | None:
        if not isinstance(state, str) or not state:
            return None
        now = time.time()
        with self._lock:
            record = self._states.get(state)
            if record is None or record.expires_at <= now:
                if record is not None:
                    self._states.pop(state, None)
                return None
            if not isinstance(transaction_token, str):
                return None
            expected = hashlib.sha256(transaction_token.encode("utf-8")).hexdigest()
            if not secrets.compare_digest(expected, record.transaction_hash):
                return None
            self._states.pop(state, None)
            return record


class SQLiteOIDCStateStore:
    """Durable, one-time OIDC transaction state shared by PARMAR processes."""

    def __init__(self, database_path: str | Path, ttl_seconds: int = 300) -> None:
        if ttl_seconds <= 0 or ttl_seconds > 900:
            raise ValueError("OIDC state TTL is invalid.")
        path = Path(database_path).expanduser()
        self.database_path = path if path.is_absolute() else Path.cwd() / path
        self._ttl_seconds = ttl_seconds
        self._lock = threading.RLock()
        try:
            self._initialize()
        except OIDCUnavailable:
            raise
        except (OSError, sqlite3.Error) as error:
            raise OIDCUnavailable("OIDC state storage is unavailable.") from error

    def _initialize(self) -> None:
        with self._lock:
            self.database_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if self.database_path.is_symlink():
                raise OIDCUnavailable("OIDC state database must not be a symbolic link.")
            descriptor = None
            if not self.database_path.exists():
                descriptor = os.open(
                    self.database_path,
                    os.O_CREAT | os.O_EXCL | os.O_WRONLY,
                    0o600,
                )
                os.close(descriptor)
            os.chmod(self.database_path, 0o600)
            with sqlite3.connect(self.database_path, timeout=5) as connection:
                connection.execute("PRAGMA journal_mode = WAL")
                connection.execute("PRAGMA synchronous = FULL")
                self._enable_and_verify_foreign_keys(connection)
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS oidc_authorization_states (
                        state_hash TEXT NOT NULL PRIMARY KEY,
                        nonce TEXT NOT NULL,
                        code_verifier TEXT NOT NULL,
                        redirect_uri TEXT NOT NULL,
                        transaction_hash TEXT NOT NULL,
                        expires_at REAL NOT NULL
                            CHECK(expires_at > 0)
                    )
                    """
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS oidc_state_expiry "
                    "ON oidc_authorization_states(expires_at)"
                )

    @staticmethod
    def _enable_and_verify_foreign_keys(
        connection: sqlite3.Connection,
    ) -> None:
        connection.execute("PRAGMA foreign_keys = ON")
        row = connection.execute("PRAGMA foreign_keys").fetchone()
        if row is None or row[0] != 1:
            raise OIDCUnavailable("OIDC state storage is unavailable.")

    def create(
        self,
        redirect_uri: str,
        *,
        transaction_token: str | None = None,
    ) -> tuple[OIDCState, str, str]:
        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        browser_transaction = transaction_token or secrets.token_urlsafe(32)
        transaction_hash = hashlib.sha256(
            browser_transaction.encode("ascii")
        ).hexdigest()
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest()
        ).rstrip(b"=").decode("ascii")
        expires_at = time.time() + self._ttl_seconds
        state_hash = hashlib.sha256(state.encode("ascii")).hexdigest()
        record = OIDCState(
            state=state,
            nonce=nonce,
            code_verifier=verifier,
            redirect_uri=redirect_uri,
            expires_at=expires_at,
            transaction_hash=transaction_hash,
        )
        try:
            with self._lock:
                with sqlite3.connect(self.database_path, timeout=5) as connection:
                    self._enable_and_verify_foreign_keys(connection)
                    connection.execute(
                        """
                        INSERT INTO oidc_authorization_states(
                            state_hash, nonce, code_verifier, redirect_uri,
                            transaction_hash, expires_at
                        ) VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (
                            state_hash,
                            nonce,
                            verifier,
                            redirect_uri,
                            transaction_hash,
                            expires_at,
                        ),
                    )
                    connection.execute(
                        "DELETE FROM oidc_authorization_states WHERE expires_at <= ?",
                        (time.time(),),
                    )
        except (OSError, sqlite3.Error) as error:
            raise OIDCUnavailable("OIDC state storage is unavailable.") from error
        return record, challenge, browser_transaction

    def consume(
        self,
        state: object,
        *,
        transaction_token: object = None,
    ) -> OIDCState | None:
        if not isinstance(state, str) or not state:
            return None
        if not isinstance(transaction_token, str):
            return None
        state_hash = hashlib.sha256(state.encode("utf-8")).hexdigest()
        transaction_hash = hashlib.sha256(
            transaction_token.encode("utf-8")
        ).hexdigest()
        try:
            with self._lock:
                with sqlite3.connect(self.database_path, timeout=5) as connection:
                    self._enable_and_verify_foreign_keys(connection)
                    connection.execute("BEGIN IMMEDIATE")
                    row = connection.execute(
                        """
                        SELECT nonce, code_verifier, redirect_uri,
                               transaction_hash, expires_at
                        FROM oidc_authorization_states
                        WHERE state_hash = ?
                        """,
                        (state_hash,),
                    ).fetchone()
                    if row is None:
                        connection.execute("COMMIT")
                        return None
                    nonce, verifier, redirect_uri, stored_transaction, expires_at = row
                    if expires_at <= time.time():
                        connection.execute(
                            "DELETE FROM oidc_authorization_states WHERE state_hash = ?",
                            (state_hash,),
                        )
                        connection.execute("COMMIT")
                        return None
                    if not secrets.compare_digest(stored_transaction, transaction_hash):
                        connection.execute("COMMIT")
                        return None
                    deleted = connection.execute(
                        "DELETE FROM oidc_authorization_states "
                        "WHERE state_hash = ?",
                        (state_hash,),
                    )
                    if deleted.rowcount != 1:
                        connection.execute("ROLLBACK")
                        return None
                    connection.execute("COMMIT")
        except (OSError, sqlite3.Error) as error:
            raise OIDCUnavailable("OIDC state storage is unavailable.") from error
        return OIDCState(
            state=state,
            nonce=nonce,
            code_verifier=verifier,
            redirect_uri=redirect_uri,
            expires_at=expires_at,
            transaction_hash=stored_transaction,
        )


class _RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        del req, fp, code, msg, headers, newurl
        raise urllib.error.HTTPError(
            "redirect",
            302,
            "OIDC redirects are not followed",
            None,
            None,
        )


def _is_invalid_grant_response(
    status: int,
    form: dict[str, str] | None,
    raw: bytes,
) -> bool:
    if form is None or status != 400:
        return False
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return False
    return isinstance(payload, dict) and payload.get("error") == "invalid_grant"


class KeycloakOIDCAdapter:
    """Provider-neutral AuthenticationAdapter implementation for OIDC."""

    def __init__(
        self,
        configuration: OIDCConfiguration,
        *,
        transport: Callable[..., object] | None = None,
    ) -> None:
        self.configuration = configuration
        self._transport = transport
        self._discovery: dict[str, object] | None = None
        self._lock = threading.Lock()

    def _request_json(
        self,
        url: str,
        *,
        method: str = "GET",
        form: dict[str, str] | None = None,
        timeout: float = 10.0,
    ) -> dict[str, object]:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.username or parsed.password:
            raise OIDCUnavailable("OIDC provider requests require HTTPS.")

        data = None
        headers = {"Accept": "application/json"}
        if form is not None:
            data = urllib.parse.urlencode(form).encode("ascii")
            headers["Content-Type"] = "application/x-www-form-urlencoded"

        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            _RejectRedirects(),
        )
        try:
            if self._transport is not None:
                response = self._transport(request, timeout=timeout)
            else:
                response = opener.open(request, timeout=timeout)
            with response:
                status = getattr(response, "status", 200)
                raw = response.read(512 * 1024 + 1)
        except urllib.error.HTTPError as error:
            try:
                raw = error.read(512 * 1024 + 1) if error.fp is not None else b""
            except (OSError, TimeoutError) as read_error:
                raise OIDCUnavailable("OIDC provider is unavailable.") from read_error
            finally:
                error.close()
            if not isinstance(raw, bytes):
                raise OIDCUnavailable("OIDC provider returned malformed data.") from None
            if len(raw) > 512 * 1024:
                raise OIDCUnavailable("OIDC provider response is too large.") from None
            if _is_invalid_grant_response(error.code, form, raw):
                raise OIDCAuthorizationError(
                    "OIDC authorization code exchange was rejected."
                ) from None
            raise OIDCUnavailable("OIDC provider returned an invalid response.") from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise OIDCUnavailable("OIDC provider is unavailable.") from error

        if not isinstance(raw, bytes):
            raise OIDCUnavailable("OIDC provider returned malformed data.") from None
        if len(raw) > 512 * 1024:
            raise OIDCUnavailable("OIDC provider response is too large.")
        if not isinstance(status, int) or status < 200 or status >= 300:
            if _is_invalid_grant_response(status, form, raw):
                raise OIDCAuthorizationError(
                    "OIDC authorization code exchange was rejected."
                )
            raise OIDCUnavailable("OIDC provider returned an invalid response.")
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError, AttributeError) as error:
            raise OIDCUnavailable("OIDC provider returned malformed data.") from error
        if not isinstance(payload, dict):
            raise OIDCUnavailable("OIDC provider returned malformed data.")
        return payload

    def discovery(self) -> dict[str, object]:
        with self._lock:
            if self._discovery is not None:
                return self._discovery
            issuer = self.configuration.issuer.rstrip("/")
            payload = self._request_json(
                issuer + "/.well-known/openid-configuration",
                method="GET",
            )
            discovered_issuer = payload.get("issuer")
            authorization_endpoint = payload.get("authorization_endpoint")
            token_endpoint = payload.get("token_endpoint")
            jwks_uri = payload.get("jwks_uri")
            if (
                discovered_issuer != self.configuration.issuer
                or not isinstance(authorization_endpoint, str)
                or not isinstance(token_endpoint, str)
                or not isinstance(jwks_uri, str)
            ):
                raise OIDCUnavailable("OIDC discovery metadata is invalid.")
            issuer_origin = urlsplit(self.configuration.issuer)
            for endpoint in (authorization_endpoint, token_endpoint, jwks_uri):
                parsed = urlsplit(endpoint)
                try:
                    endpoint_port = parsed.port
                except ValueError:
                    raise OIDCUnavailable("OIDC discovery endpoints are invalid.") from None
                if (
                    parsed.scheme != "https"
                    or parsed.username
                    or parsed.password
                    or parsed.query
                    or parsed.fragment
                    or (parsed.hostname, parsed.port) != (
                        issuer_origin.hostname,
                        issuer_origin.port,
                    )
                ):
                    raise OIDCUnavailable("OIDC discovery endpoints are invalid.")
            self._discovery = payload
            return payload

    def authorization_url(
        self,
        state: OIDCState,
        code_challenge: str,
    ) -> str:
        discovery = self.discovery()
        endpoint = discovery["authorization_endpoint"]
        if not isinstance(endpoint, str):
            raise OIDCUnavailable("OIDC authorization endpoint is unavailable.")
        parameters = {
            "response_type": "code",
            "client_id": self.configuration.client_id,
            "redirect_uri": state.redirect_uri,
            "scope": "openid",
            "state": state.state,
            "nonce": state.nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        return endpoint + ("&" if "?" in endpoint else "?") + urllib.parse.urlencode(parameters)

    def exchange_authorization_code(
        self,
        code: str,
        state: OIDCState,
    ) -> str:
        if not isinstance(code, str) or not code or len(code) > 4096:
            raise OIDCAuthorizationError("OIDC authorization code is invalid.")
        discovery = self.discovery()
        token_endpoint = discovery["token_endpoint"]
        if not isinstance(token_endpoint, str):
            raise OIDCUnavailable("OIDC token endpoint is unavailable.")
        payload = self._request_json(
            token_endpoint,
            method="POST",
            form={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": state.redirect_uri,
                "client_id": self.configuration.client_id,
                "client_secret": self.configuration.client_secret,
                "code_verifier": state.code_verifier,
            },
        )
        id_token = payload.get("id_token")
        if not isinstance(id_token, str) or not id_token:
            raise OIDCAuthorizationError("OIDC ID token is unavailable.")
        return id_token

    def _create_jwks_client(self, jwks_uri: str) -> PyJWKClient:
        adapter = self

        class BoundedPyJWKClient(PyJWKClient):
            def fetch_data(client_self) -> dict[str, object]:
                jwk_set: dict[str, object] | None = None
                try:
                    jwk_set = adapter._request_json(client_self.uri, method="GET")
                    return jwk_set
                finally:
                    if client_self.jwk_set_cache is not None:
                        client_self.jwk_set_cache.put(jwk_set)

        return BoundedPyJWKClient(
            jwks_uri,
            timeout=10,
            cache_keys=True,
            max_cached_keys=16,
            lifespan=300,
        )

    def verify(self, assertion: object) -> VerifiedProviderIdentity | None:
        if not isinstance(assertion, OIDCCallbackEvidence):
            return None
        if jwt is None or PyJWKClient is None:
            raise OIDCUnavailable("OIDC signature verification dependency is unavailable.")
        try:
            header = jwt.get_unverified_header(assertion.id_token)
            algorithm = header.get("alg")
            kid = header.get("kid")
            if algorithm not in {
                "RS256",
                "RS384",
                "RS512",
                "PS256",
                "PS384",
                "PS512",
                "ES256",
                "ES384",
                "ES512",
            }:
                return None
            if not isinstance(kid, str) or not kid or not kid.isprintable():
                return None
            discovery = self.discovery()
            jwks_uri = discovery["jwks_uri"]
            if not isinstance(jwks_uri, str):
                return None
            jwks_client = self._create_jwks_client(jwks_uri)
            signing_key = jwks_client.get_signing_key_from_jwt(assertion.id_token)
            claims = jwt.decode(
                assertion.id_token,
                signing_key.key,
                algorithms=[algorithm],
                audience=self.configuration.audience,
                issuer=self.configuration.issuer,
                leeway=30,
                options={
                    "require": ["iss", "aud", "exp", "iat", "sub", "nonce"],
                    "verify_signature": True,
                    "verify_aud": True,
                    "verify_iss": True,
                    "verify_exp": True,
                    "verify_iat": True,
                    "verify_nbf": True,
                },
            )
        except OIDCUnavailable:
            raise
        except jwt.exceptions.PyJWKClientConnectionError as error:
            raise OIDCUnavailable("OIDC provider is unavailable.") from error
        except (
            jwt.exceptions.InvalidTokenError,
            jwt.exceptions.PyJWKClientError,
        ):
            return None
        if not isinstance(claims, dict):
            return None
        if claims.get("nonce") != assertion.nonce:
            return None
        subject = claims.get("sub")
        if (
            not isinstance(subject, str)
            or not subject
            or subject != subject.strip()
            or len(subject) > 1024
            or not subject.isprintable()
        ):
            return None
        audience_claim = claims.get("aud")
        if isinstance(audience_claim, str):
            audiences = [audience_claim]
        elif isinstance(audience_claim, list):
            audiences = audience_claim
        else:
            return None
        if (
            not audiences
            or any(not isinstance(item, str) or not item for item in audiences)
            or len(set(audiences)) != len(audiences)
            or self.configuration.audience not in audiences
        ):
            return None
        azp = claims.get("azp")
        if len(audiences) > 1:
            if azp != self.configuration.client_id:
                return None
        elif azp is not None and (
            not isinstance(azp, str) or azp != self.configuration.client_id
        ):
            return None
        now = datetime.now(timezone.utc)
        exp = claims.get("exp")
        iat = claims.get("iat")
        if (
            isinstance(exp, bool)
            or isinstance(iat, bool)
            or not isinstance(exp, (int, float))
            or not isinstance(iat, (int, float))
        ):
            return None
        try:
            authenticated = datetime.fromtimestamp(iat, timezone.utc)
            expires = datetime.fromtimestamp(exp, timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
        if (
            expires <= authenticated
            or expires <= now - timedelta(seconds=30)
            or authenticated > now + timedelta(seconds=30)
        ):
            return None
        return VerifiedProviderIdentity(
            ProviderIdentity(self.configuration.issuer, subject),
            AuthenticationContext(authenticated, expires),
        )


class OIDCIdentityResolver:
    """Resolve a verified OIDC result only through an existing account binding."""

    def __init__(
        self,
        adapter: KeycloakOIDCAdapter,
        bindings: ProviderAccountBindingLookup,
    ) -> None:
        self._adapter = adapter
        self._bindings = bindings

    def resolve(self, evidence: object, *, now: datetime | None = None):
        return resolve_authenticated_principal(
            self._adapter,
            self._bindings,
            evidence,
            now=now,
        )


def oidc_configuration_from_environment(
    environ: dict[str, str] | None = None,
) -> OIDCConfiguration | None:
    values = os.environ if environ is None else environ
    enabled = values.get("PARMAR_OIDC_ENABLED", "false").strip().lower()
    if enabled not in {"true", "false"}:
        raise OIDCUnavailable("PARMAR_OIDC_ENABLED must be true or false.")
    if enabled != "true":
        return None

    issuer = values.get("PARMAR_OIDC_ISSUER", "").strip()
    client_id = values.get("PARMAR_OIDC_CLIENT_ID", "").strip()
    client_secret = values.get("PARMAR_OIDC_CLIENT_SECRET", "")
    audience = values.get("PARMAR_OIDC_AUDIENCE", client_id).strip()
    redirect_uri = values.get("PARMAR_OIDC_REDIRECT_URI", "").strip()
    ttl_raw = values.get("PARMAR_OIDC_STATE_TTL_SECONDS", "300")
    try:
        ttl = int(ttl_raw)
    except (TypeError, ValueError) as error:
        raise OIDCUnavailable("OIDC state TTL is unavailable.") from error
    return OIDCConfiguration(
        issuer=issuer.rstrip("/") if issuer else issuer,
        client_id=client_id,
        client_secret=client_secret,
        audience=audience,
        redirect_uri=redirect_uri,
        state_ttl_seconds=ttl,
    )


def oidc_state_store_from_environment(
    configuration: OIDCConfiguration,
    environ: dict[str, str] | None = None,
) -> SQLiteOIDCStateStore:
    values = os.environ if environ is None else environ
    configured_path = values.get("PARMAR_OIDC_STATE_DB_PATH")
    if configured_path is not None and not configured_path.strip():
        raise OIDCUnavailable("OIDC state database path is invalid.")
    path = (
        configured_path
        if configured_path is not None
        else str(Path.home() / ".local" / "share" / "parmar" / "oidc-state.sqlite3")
    )
    return SQLiteOIDCStateStore(
        path,
        ttl_seconds=configuration.state_ttl_seconds,
    )
