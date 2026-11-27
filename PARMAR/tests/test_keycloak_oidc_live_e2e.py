from __future__ import annotations

import base64
import hashlib
import importlib
import json
import os
import secrets
import sqlite3
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field, replace
from email.message import Message
from html.parser import HTMLParser
from http.cookiejar import CookieJar
from http.cookies import SimpleCookie
from pathlib import Path
from types import SimpleNamespace

import pytest

from PARMAR.tests import keycloak_e2e_bootstrap as bootstrap


LIVE_E2E_ENABLED = os.environ.get("PARMAR_LIVE_KEYCLOAK_E2E") == "1"
MAX_HTTP_BODY_BYTES = 2 * 1024 * 1024
PARMAR_ORIGIN = "https://127.0.0.1:8080"
CALLBACK_PATH = "/api/auth/oidc/callback"


class LiveE2EFailure(RuntimeError):
    pass


def _check(condition: bool, message: str) -> None:
    if not condition:
        raise LiveE2EFailure(message)


@dataclass(frozen=True, repr=False)
class HttpResult:
    status: int
    headers: Message
    body: bytes


@dataclass(frozen=True, repr=False)
class LiveEnvironment:
    app: object
    run_context: bootstrap.RunContext
    runtime_secrets: dict[str, str] = field(repr=False)
    bootstrap_result: dict[str, str] = field(repr=False)
    ssl_context: ssl.SSLContext = field(repr=False)
    server: object = field(repr=False)
    server_thread: threading.Thread = field(repr=False)


@dataclass(frozen=True, repr=False)
class LoginFlow:
    opener: urllib.request.OpenerDirector = field(repr=False)
    cookie_jar: CookieJar = field(repr=False)
    transaction_token: str = field(repr=False)
    authorization_url: str = field(repr=False)
    state: str = field(repr=False)
    nonce: str = field(repr=False)
    code_verifier: str = field(repr=False)
    callback_url: str = field(repr=False)
    authorization_code: str = field(repr=False)


class _LoginFormParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.forms: list[tuple[str, list[tuple[str, str]]]] = []
        self._active_action: str | None = None
        self._active_inputs: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "form":
            self._active_action = values.get("action") or ""
            self._active_inputs = []
        elif tag == "input" and self._active_action is not None:
            name = values.get("name")
            if name:
                self._active_inputs.append((name, values.get("value") or ""))

    def handle_endtag(self, tag: str) -> None:
        if tag == "form" and self._active_action is not None:
            self.forms.append((self._active_action, self._active_inputs))
            self._active_action = None
            self._active_inputs = []


class _CallbackRedirect(Exception):
    def __init__(self, location: str) -> None:
        super().__init__("Authorization completed and callback redirect was captured.")
        self.location = location


class _LoopbackRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlsplit(newurl)
        if (
            parsed.scheme != "https"
            or parsed.username is not None
            or parsed.password is not None
            or parsed.hostname != "127.0.0.1"
            or parsed.port not in {8080, 8443}
        ):
            raise LiveE2EFailure("Browser navigation escaped the HTTPS loopback services.")
        if parsed.port == 8080 and parsed.path == CALLBACK_PATH:
            raise _CallbackRedirect(newurl)
        if parsed.port != 8443:
            raise LiveE2EFailure("Unexpected non-Keycloak browser redirect.")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _new_opener(
    ssl_context: ssl.SSLContext,
    cookie_jar: CookieJar | None = None,
) -> urllib.request.OpenerDirector:
    handlers: list[urllib.request.BaseHandler] = [
        urllib.request.ProxyHandler({}),
        urllib.request.HTTPSHandler(context=ssl_context),
        _LoopbackRedirectHandler(),
    ]
    if cookie_jar is not None:
        handlers.append(urllib.request.HTTPCookieProcessor(cookie_jar))
    return urllib.request.build_opener(*handlers)


def _request(
    opener: urllib.request.OpenerDirector,
    request: urllib.request.Request | str,
) -> HttpResult:
    try:
        with opener.open(request, timeout=10) as response:
            body = response.read(MAX_HTTP_BODY_BYTES + 1)
            result = HttpResult(
                response.status,
                response.headers,
                body,
            )
    except urllib.error.HTTPError as error:
        try:
            body = error.read(MAX_HTTP_BODY_BYTES + 1)
            result = HttpResult(error.code, error.headers, body)
        finally:
            error.close()
    except (urllib.error.URLError, TimeoutError, OSError):
        raise LiveE2EFailure("An HTTPS request to a run-local E2E service failed.") from None
    _check(len(result.body) <= MAX_HTTP_BODY_BYTES, "An E2E service response was oversized.")
    return result


def _json_payload(response: HttpResult, message: str) -> dict[str, object]:
    try:
        payload = json.loads(response.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise LiveE2EFailure(message) from None
    _check(isinstance(payload, dict), message)
    return payload


def _token_with_unpublished_kid(token: str) -> str:
    parts = token.split(".")
    _check(len(parts) == 3, "Keycloak returned a malformed ID token.")
    header_segment = parts[0]
    header = json.loads(
        base64.urlsafe_b64decode(
            header_segment + "=" * (-len(header_segment) % 4)
        ).decode("utf-8")
    )
    _check(isinstance(header, dict), "Keycloak returned an invalid ID-token header.")
    header["kid"] = "unpublished-test-" + secrets.token_urlsafe(12)
    encoded_header = base64.urlsafe_b64encode(
        json.dumps(header, separators=(",", ":")).encode("utf-8")
    ).rstrip(b"=").decode("ascii")
    return ".".join((encoded_header, parts[1], parts[2]))


def _cookie_from_jar(cookie_jar: CookieJar, name: str) -> str | None:
    for cookie in cookie_jar:
        if cookie.name == name and cookie.domain == "127.0.0.1":
            return cookie.value
    return None


def _callback_response(
    live: LiveEnvironment,
    flow: LoginFlow,
    callback_url: str,
) -> HttpResult:
    parsed = urllib.parse.urlsplit(callback_url)
    _check(
        parsed.scheme == "https"
        and parsed.hostname == "127.0.0.1"
        and parsed.port == 8080
        and parsed.path == CALLBACK_PATH,
        "The authorization callback is not the exact PARMAR loopback URI.",
    )
    return _request(flow.opener, callback_url)


def _start_login(live: LiveEnvironment) -> LoginFlow:
    cookie_jar = CookieJar()
    opener = _new_opener(live.ssl_context, cookie_jar)
    request = urllib.request.Request(
        PARMAR_ORIGIN + "/api/auth/oidc/start",
        data=b"{}",
        headers={
            "Content-Type": "application/json",
            "Origin": PARMAR_ORIGIN,
        },
        method="POST",
    )
    response = _request(opener, request)
    _check(response.status == 200, "PARMAR did not start an OIDC authorization transaction.")
    payload = _json_payload(response, "PARMAR returned an invalid OIDC start response.")
    authorization_url = payload.get("authorization_url")
    _check(isinstance(authorization_url, str), "PARMAR omitted the authorization URL.")

    parsed_authorization = urllib.parse.urlsplit(authorization_url)
    query = urllib.parse.parse_qs(parsed_authorization.query, keep_blank_values=True)
    _check(
        parsed_authorization.scheme == "https"
        and parsed_authorization.hostname == "127.0.0.1"
        and parsed_authorization.port == 8443
        and parsed_authorization.path.endswith("/protocol/openid-connect/auth"),
        "PARMAR generated an unexpected authorization endpoint.",
    )
    _check(
        query.get("response_type") == ["code"]
        and query.get("client_id") == [bootstrap.CLIENT_ID]
        and query.get("redirect_uri") == [bootstrap.REDIRECT_URI]
        and query.get("code_challenge_method") == ["S256"],
        "The authorization request did not use the approved code/PKCE parameters.",
    )
    state_values = query.get("state", [])
    nonce_values = query.get("nonce", [])
    challenge_values = query.get("code_challenge", [])
    _check(
        len(state_values) == len(nonce_values) == len(challenge_values) == 1
        and all(state_values + nonce_values + challenge_values),
        "The authorization request omitted state, nonce, or PKCE challenge.",
    )

    transaction_cookie_name = live.app.OIDC_TRANSACTION_COOKIE_NAME
    transaction_token = _cookie_from_jar(cookie_jar, transaction_cookie_name)
    _check(bool(transaction_token), "PARMAR did not set its OIDC transaction cookie.")
    cookie_headers = response.headers.get_all("Set-Cookie", [])
    parsed_cookies = SimpleCookie()
    for header in cookie_headers:
        parsed_cookies.load(header)
    transaction_morsel = parsed_cookies.get(transaction_cookie_name)
    _check(
        transaction_morsel is not None
        and bool(transaction_morsel["secure"])
        and bool(transaction_morsel["httponly"])
        and transaction_morsel["samesite"].casefold() == "lax"
        and transaction_morsel["path"] == "/",
        "The OIDC transaction cookie did not retain its secure browser attributes.",
    )

    state = state_values[0]
    state_hash = hashlib.sha256(state.encode("ascii")).hexdigest()
    state_path = bootstrap._expected_database_paths(live.run_context)[
        "PARMAR_OIDC_STATE_DB_PATH"
    ]
    try:
        with sqlite3.connect(state_path) as connection:
            row = connection.execute(
                """
                SELECT nonce, code_verifier, redirect_uri
                FROM oidc_authorization_states
                WHERE state_hash = ?
                """,
                (state_hash,),
            ).fetchone()
    except sqlite3.Error:
        raise LiveE2EFailure("The run-local OIDC transaction could not be inspected.") from None
    _check(row is not None, "PARMAR did not persist the OIDC transaction.")
    nonce, code_verifier, redirect_uri = row
    expected_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")
    _check(
        nonce == nonce_values[0]
        and redirect_uri == bootstrap.REDIRECT_URI
        and secrets.compare_digest(expected_challenge, challenge_values[0]),
        "The stored transaction did not match the advertised nonce/PKCE challenge.",
    )

    return LoginFlow(
        opener=opener,
        cookie_jar=cookie_jar,
        transaction_token=transaction_token,
        authorization_url=authorization_url,
        state=state,
        nonce=nonce,
        code_verifier=code_verifier,
        callback_url="",
        authorization_code="",
    )


def _capture_authorization_callback(
    live: LiveEnvironment,
    flow: LoginFlow,
    *,
    username: str = bootstrap.TEST_USERNAME,
    password: str | None = None,
) -> LoginFlow:
    try:
        with flow.opener.open(flow.authorization_url, timeout=10) as response:
            login_page = response.read(MAX_HTTP_BODY_BYTES + 1)
            login_page_url = response.geturl()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError):
        raise LiveE2EFailure("Keycloak authorization did not return its login page.") from None
    _check(
        len(login_page) <= MAX_HTTP_BODY_BYTES
        and urllib.parse.urlsplit(login_page_url).hostname == "127.0.0.1",
        "Keycloak returned an invalid login page.",
    )
    try:
        parser = _LoginFormParser()
        parser.feed(login_page.decode("utf-8"))
        parser.close()
    except (UnicodeDecodeError, ValueError):
        raise LiveE2EFailure("The Keycloak login form could not be parsed.") from None
    login_form = next(
        (
            (action, inputs)
            for action, inputs in parser.forms
            if any(name == "username" for name, _ in inputs)
            and any(name == "password" for name, _ in inputs)
        ),
        None,
    )
    _check(login_form is not None, "Keycloak did not render a supported username/password form.")
    action, inputs = login_form
    action_url = urllib.parse.urljoin(login_page_url, action)
    parsed_action = urllib.parse.urlsplit(action_url)
    _check(
        parsed_action.scheme == "https"
        and parsed_action.hostname == "127.0.0.1"
        and parsed_action.port == 8443,
        "Keycloak rendered a login action outside its isolated HTTPS endpoint.",
    )

    user_password = password or live.runtime_secrets["test_user_password"]
    form_values = [
        (name, value)
        for name, value in inputs
        if name not in {"username", "password"}
    ]
    form_values.extend(
        (
            ("username", username),
            ("password", user_password),
        )
    )
    login_request = urllib.request.Request(
        action_url,
        data=urllib.parse.urlencode(form_values).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with flow.opener.open(login_request, timeout=10) as response:
            response.read(MAX_HTTP_BODY_BYTES + 1)
    except _CallbackRedirect as callback:
        callback_url = callback.location
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError):
        raise LiveE2EFailure("Keycloak rejected the disposable test identity.") from None
    else:
        raise LiveE2EFailure("Keycloak login did not redirect to PARMAR's callback.")

    parsed_callback = urllib.parse.urlsplit(callback_url)
    callback_query = urllib.parse.parse_qs(parsed_callback.query, keep_blank_values=True)
    code_values = callback_query.get("code", [])
    _check(
        parsed_callback.scheme == "https"
        and parsed_callback.hostname == "127.0.0.1"
        and parsed_callback.port == 8080
        and parsed_callback.path == CALLBACK_PATH
        and callback_query.get("state") == [flow.state]
        and len(code_values) == 1
        and bool(code_values[0]),
        "Keycloak returned an invalid authorization callback.",
    )
    _check(
        _cookie_from_jar(flow.cookie_jar, live.app.OIDC_TRANSACTION_COOKIE_NAME)
        == flow.transaction_token,
        "The browser transaction cookie changed during Keycloak authorization.",
    )
    return LoginFlow(
        opener=flow.opener,
        cookie_jar=flow.cookie_jar,
        transaction_token=flow.transaction_token,
        authorization_url=flow.authorization_url,
        state=flow.state,
        nonce=flow.nonce,
        code_verifier=flow.code_verifier,
        callback_url=callback_url,
        authorization_code=code_values[0],
    )


def _capture_provider_error_callback(
    live: LiveEnvironment,
    flow: LoginFlow,
) -> LoginFlow:
    parsed_authorization = urllib.parse.urlsplit(flow.authorization_url)
    authorization_parameters = urllib.parse.parse_qsl(
        parsed_authorization.query,
        keep_blank_values=True,
    )
    authorization_parameters = [
        (name, value)
        for name, value in authorization_parameters
        if name != "prompt"
    ]
    authorization_parameters.append(("prompt", "none"))
    authorization_url = urllib.parse.urlunsplit(
        parsed_authorization._replace(
            query=urllib.parse.urlencode(authorization_parameters)
        )
    )
    try:
        with flow.opener.open(authorization_url, timeout=10) as response:
            response.read(MAX_HTTP_BODY_BYTES + 1)
    except _CallbackRedirect as callback:
        callback_url = callback.location
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError):
        raise LiveE2EFailure("Keycloak did not return an OIDC provider error callback.") from None
    else:
        raise LiveE2EFailure("Keycloak prompt=none unexpectedly completed authorization.")

    parsed_callback = urllib.parse.urlsplit(callback_url)
    callback_query = urllib.parse.parse_qs(parsed_callback.query, keep_blank_values=True)
    provider_errors = callback_query.get("error", [])
    _check(
        parsed_callback.scheme == "https"
        and parsed_callback.hostname == "127.0.0.1"
        and parsed_callback.port == 8080
        and parsed_callback.path == CALLBACK_PATH
        and callback_query.get("state") == [flow.state]
        and len(provider_errors) == 1
        and provider_errors[0] in {
            "access_denied",
            "interaction_required",
            "login_required",
        }
        and not callback_query.get("code"),
        "Keycloak returned an invalid provider-error callback.",
    )
    _check(
        _cookie_from_jar(flow.cookie_jar, live.app.OIDC_TRANSACTION_COOKIE_NAME)
        == flow.transaction_token,
        "The browser transaction cookie changed during the provider-error flow.",
    )
    return LoginFlow(
        opener=flow.opener,
        cookie_jar=flow.cookie_jar,
        transaction_token=flow.transaction_token,
        authorization_url=flow.authorization_url,
        state=flow.state,
        nonce=flow.nonce,
        code_verifier=flow.code_verifier,
        callback_url=callback_url,
        authorization_code="",
    )


def _mutate_transaction(
    live: LiveEnvironment,
    flow: LoginFlow,
    column: str,
    value: str | float,
) -> None:
    allowed_columns = {
        "nonce": "nonce",
        "code_verifier": "code_verifier",
        "expires_at": "expires_at",
    }
    _check(column in allowed_columns, "The requested transaction mutation is unsupported.")
    state_hash = hashlib.sha256(flow.state.encode("ascii")).hexdigest()
    state_path = bootstrap._expected_database_paths(live.run_context)[
        "PARMAR_OIDC_STATE_DB_PATH"
    ]
    try:
        with sqlite3.connect(state_path) as connection:
            updated = connection.execute(
                f"UPDATE oidc_authorization_states SET {allowed_columns[column]} = ? "
                "WHERE state_hash = ?",
                (value, state_hash),
            )
            _check(updated.rowcount == 1, "The live OIDC transaction could not be mutated.")
    except sqlite3.Error:
        raise LiveE2EFailure("The live OIDC transaction could not be mutated.") from None


def _assert_error_is_safe(
    live: LiveEnvironment,
    flow: LoginFlow,
    response: HttpResult,
    expected_status: int,
    extra_sensitive: tuple[str, ...] = (),
    expected_session_count: int | None = None,
) -> None:
    _check(response.status == expected_status, "The callback returned an unexpected failure status.")
    payload = _json_payload(response, "The callback returned an invalid error response.")
    _check(
        payload.get("status") == "OIDC_AUTH_FAILED"
        and payload.get("safe") is False
        and isinstance(payload.get("message"), str)
        and bool(payload["message"])
        and response.headers.get("Cache-Control") == "no-store",
        "The callback did not return the application's safe authentication error contract.",
    )
    try:
        body = response.body.decode("utf-8")
    except UnicodeDecodeError:
        raise LiveE2EFailure("The callback returned a malformed error response.") from None
    sensitive_values = (
        *live.runtime_secrets.values(),
        flow.transaction_token,
        flow.state,
        flow.nonce,
        flow.code_verifier,
        flow.authorization_code,
        *extra_sensitive,
    )
    response_values = (
        body,
        *(value for _, value in response.headers.items()),
    )
    _check(
        all(
            not secret or all(secret not in value for value in response_values)
            for secret in sensitive_values
        ),
        "A secret or token appeared in an OIDC error response.",
    )
    _check(
        not any(
            token_field in body.casefold()
            for token_field in ('"access_token"', '"id_token"', '"refresh_token"')
        ),
        "An OIDC error response contained a token field.",
    )
    set_cookies = response.headers.get_all("Set-Cookie", [])
    _check(
        not any(live.app.SESSION_COOKIE_NAME in cookie for cookie in set_cookies),
        "A rejected callback unexpectedly issued a session cookie.",
    )
    _check(
        any(
            live.app.OIDC_TRANSACTION_COOKIE_NAME in cookie and "Max-Age=0" in cookie
            for cookie in set_cookies
        ),
        "A rejected callback did not clear its transaction cookie.",
    )
    if expected_session_count is not None:
        _check(
            _session_count(live) == expected_session_count,
            "A rejected callback changed the trusted server-side session count.",
        )


def _direct_callback(
    live: LiveEnvironment,
    flow: LoginFlow,
    state: str,
    code: str,
    *,
    transaction_token: str | None = None,
) -> HttpResult:
    callback_url = PARMAR_ORIGIN + CALLBACK_PATH + "?" + urllib.parse.urlencode(
        {"code": code, "state": state}
    )
    request = urllib.request.Request(
        callback_url,
        headers={
            "Cookie": (
                f"{live.app.OIDC_TRANSACTION_COOKIE_NAME}="
                f"{transaction_token or flow.transaction_token}"
            )
        },
    )
    opener = _new_opener(live.ssl_context)
    return _request(opener, request)


def _account_binding_path(live: LiveEnvironment) -> Path:
    return bootstrap._expected_database_paths(live.run_context)["PARMAR_IDENTITY_DB_PATH"]


def _session_count(live: LiveEnvironment) -> int:
    session_path = bootstrap._expected_database_paths(live.run_context)[
        "PARMAR_SESSION_DB_PATH"
    ]
    try:
        with sqlite3.connect(session_path) as connection:
            return connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    except sqlite3.Error:
        raise LiveE2EFailure("The run-local session store could not be inspected.") from None


def _session_store_snapshot(live: LiveEnvironment) -> list[tuple]:
    session_path = bootstrap._expected_database_paths(live.run_context)[
        "PARMAR_SESSION_DB_PATH"
    ]
    try:
        with sqlite3.connect(session_path) as connection:
            return connection.execute(
                "SELECT * FROM sessions ORDER BY session_id"
            ).fetchall()
    except sqlite3.Error:
        raise LiveE2EFailure("The run-local session store could not be inspected.") from None


def _state_transaction_count(live: LiveEnvironment, state: str) -> int:
    state_hash = hashlib.sha256(state.encode("ascii")).hexdigest()
    state_path = bootstrap._expected_database_paths(live.run_context)[
        "PARMAR_OIDC_STATE_DB_PATH"
    ]
    try:
        with sqlite3.connect(state_path) as connection:
            return connection.execute(
                "SELECT COUNT(*) FROM oidc_authorization_states WHERE state_hash = ?",
                (state_hash,),
            ).fetchone()[0]
    except sqlite3.Error:
        raise LiveE2EFailure("The run-local OIDC state store could not be inspected.") from None


def _identity_store_snapshot(live: LiveEnvironment) -> tuple[list[tuple], list[tuple]]:
    try:
        with sqlite3.connect(_account_binding_path(live)) as connection:
            accounts = connection.execute(
                "SELECT account_id, created_at, status FROM accounts ORDER BY account_id"
            ).fetchall()
            bindings = connection.execute(
                """
                SELECT issuer, subject, account_id, created_at
                FROM provider_account_bindings
                ORDER BY issuer, subject
                """
            ).fetchall()
    except sqlite3.Error:
        raise LiveE2EFailure("The run-local identity store could not be inspected.") from None
    return accounts, bindings


@pytest.fixture(scope="module")
def live_environment():
    if not LIVE_E2E_ENABLED:
        pytest.skip("Set PARMAR_LIVE_KEYCLOAK_E2E=1 only in the manual live workflow.")

    try:
        run_context = bootstrap._load_context(os.environ)
        runtime_secrets = bootstrap._load_secrets(run_context)
        paths = bootstrap._expected_database_paths(run_context)
        result_path = run_context.temp_dir / bootstrap.RESULT_FILENAME
        bootstrap_result = json.loads(result_path.read_text(encoding="utf-8"))
        _check(
            isinstance(bootstrap_result, dict)
            and bootstrap_result.get("issuer") == bootstrap.ISSUER
            and bootstrap_result.get("client_id") == bootstrap.CLIENT_ID
            and bootstrap_result.get("account_id") == bootstrap.TEST_ACCOUNT_ID,
            "The run-local Keycloak bootstrap result is not valid for this test.",
        )
        unbound_subject = bootstrap_result.get("unbound_subject")
        _check(
            isinstance(unbound_subject, str)
            and bool(unbound_subject)
            and unbound_subject != bootstrap_result.get("subject"),
            "The run-local unbound Keycloak subject is invalid.",
        )
        for environment_name, path in paths.items():
            _check(
                Path(os.environ.get(environment_name, "")).resolve() == path,
                "The application did not receive its exact isolated database path.",
            )

        conversation_path = run_context.temp_dir / "conversations.sqlite3"
        memory_path = run_context.temp_dir / "memories.sqlite3"
        environment = {
            **{name: str(path) for name, path in paths.items()},
            "PARMAR_CONVERSATION_DB_PATH": str(conversation_path),
            "PARMAR_MEMORY_DB_PATH": str(memory_path),
            "PARMAR_OIDC_CLIENT_SECRET": runtime_secrets["client_secret"],
            "PARMAR_SESSION_STORE_KEY": runtime_secrets["session_store_key"],
            "PARMAR_APPROVAL_STORE_KEY": runtime_secrets["approval_store_key"],
            "PARMAR_OIDC_ENABLED": "true",
            "PARMAR_OIDC_ISSUER": bootstrap.ISSUER,
            "PARMAR_OIDC_CLIENT_ID": bootstrap.CLIENT_ID,
            "PARMAR_OIDC_AUDIENCE": bootstrap.CLIENT_ID,
            "PARMAR_OIDC_REDIRECT_URI": bootstrap.REDIRECT_URI,
            "PARMAR_OIDC_STATE_TTL_SECONDS": "300",
            "PARMAR_SESSION_IDLE_SECONDS": "600",
            "PARMAR_SESSION_ABSOLUTE_SECONDS": "1800",
            "PARMAR_DEVELOPMENT_AUTH_ENABLED": "false",
            "PARMAR_ENVIRONMENT": "test",
            "PARMAR_UI_HOST": "127.0.0.1",
            "PARMAR_UI_ORIGIN": PARMAR_ORIGIN,
            "PARMAR_UI_TLS_CERTFILE": str(run_context.temp_dir / "tls" / "parmar.crt"),
            "PARMAR_UI_TLS_KEYFILE": str(run_context.temp_dir / "tls" / "parmar.key"),
        }
        os.environ.update(environment)
        ssl_context = ssl.create_default_context(
            cafile=str(run_context.temp_dir / "tls" / "ca.crt")
        )
        app = importlib.import_module("PARMAR.interface.futuristic_app")
        _check(
            app.OIDC_CONFIGURATION is not None
            and app.OIDC_ADAPTER is not None
            and app.OIDC_STATE_STORE is not None
            and app.SESSION_MANAGER is not None,
            "PARMAR OIDC or session services did not initialize.",
        )
        database_paths = (
            app.OIDC_STATE_STORE.database_path,
            app.SESSION_MANAGER.repository.database_path,
            app.IDENTITY_REPOSITORY.database_path,
            app.PENDING_APPROVALS.database_path,
            app.CONVERSATION_REPOSITORY.database_path,
            app.MEMORY_REPOSITORY.database_path,
        )
        expected_paths = (*paths.values(), conversation_path, memory_path)
        _check(
            tuple(Path(path).resolve() for path in database_paths)
            == tuple(path.resolve() for path in expected_paths)
            and len({Path(path).resolve() for path in database_paths}) == 6,
            "PARMAR selected a database outside this run's isolated storage.",
        )
        _check(
            conversation_path.parent == run_context.temp_dir
            and memory_path.parent == run_context.temp_dir,
            "Auxiliary application databases are not isolated to this run.",
        )
        server, scheme, host, port = app._create_ui_server()
        _check(
            (scheme, host, port) == ("https", "127.0.0.1", 8080),
            "PARMAR did not bind to its approved HTTPS loopback address.",
        )
        server_thread = threading.Thread(
            target=server.serve_forever,
            kwargs={"poll_interval": 0.1},
            daemon=True,
        )
        server_thread.start()
    except (bootstrap.E2EBootstrapError, OSError, sqlite3.Error, ValueError, UnicodeError):
        raise LiveE2EFailure("The run-local PARMAR E2E environment could not be initialized.") from None

    try:
        deadline = time.monotonic() + 20
        ready = False
        opener = _new_opener(ssl_context)
        while time.monotonic() < deadline:
            try:
                response = _request(opener, PARMAR_ORIGIN + "/api/session")
                if response.status == 200:
                    payload = _json_payload(response, "PARMAR readiness returned invalid data.")
                    ready = payload.get("authenticated") is False
                    if ready:
                        break
            except LiveE2EFailure:
                time.sleep(0.25)
        _check(ready, "PARMAR HTTPS did not become ready for live OIDC tests.")
        yield LiveEnvironment(
            app=app,
            run_context=run_context,
            runtime_secrets=runtime_secrets,
            bootstrap_result=bootstrap_result,
            ssl_context=ssl_context,
            server=server,
            server_thread=server_thread,
        )
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=5)
        _check(not server_thread.is_alive(), "PARMAR HTTPS server did not stop cleanly.")


def test_login_form_parser_extracts_form_action_and_hidden_inputs():
    parser = _LoginFormParser()
    parser.feed(
        '<form id="kc-form-login" action="/login-actions/authenticate">'
        '<input type="hidden" name="session_code" value="opaque">'
        '<input id="username" name="username">'
        '<input id="password" name="password" type="password">'
        "</form>"
    )
    parser.close()
    _check(
        parser.forms
        == [
            (
                "/login-actions/authenticate",
                [
                    ("session_code", "opaque"),
                    ("username", ""),
                    ("password", ""),
                ],
            )
        ],
        "The Keycloak login form parser did not preserve required fields.",
    )


def test_error_safety_rejects_secrets_in_response_headers_and_token_fields():
    live = SimpleNamespace(
        runtime_secrets={"client_secret": "opaque-secret"},
        app=SimpleNamespace(
            SESSION_COOKIE_NAME="parmar_session",
            OIDC_TRANSACTION_COOKIE_NAME="parmar_oidc_transaction",
        ),
    )
    flow = SimpleNamespace(
        transaction_token="opaque-transaction",
        state="opaque-state",
        nonce="opaque-nonce",
        code_verifier="opaque-verifier",
        authorization_code="opaque-code",
    )
    headers = Message()
    headers["X-Diagnostic"] = "opaque-secret"
    headers["Set-Cookie"] = "parmar_oidc_transaction=; Max-Age=0"
    headers["Cache-Control"] = "no-store"
    with pytest.raises(LiveE2EFailure, match="secret or token"):
        _assert_error_is_safe(
            live,
            flow,
            HttpResult(
                401,
                headers,
                b'{"status":"OIDC_AUTH_FAILED","safe":false,"message":"rejected"}',
            ),
            401,
        )

    del headers["X-Diagnostic"]
    with pytest.raises(LiveE2EFailure, match="token field"):
        _assert_error_is_safe(
            live,
            flow,
            HttpResult(
                401,
                headers,
                b'{"status":"OIDC_AUTH_FAILED","safe":false,"message":"rejected",'
                b'"access_token":"opaque"}',
            ),
            401,
        )


@pytest.mark.skipif(not LIVE_E2E_ENABLED, reason="Manual live Keycloak workflow only.")
def test_invalid_state_and_callback_cookie_mismatch_are_rejected(live_environment):
    flow = _start_login(live_environment)
    identity_before = _identity_store_snapshot(live_environment)
    sessions_before = _session_store_snapshot(live_environment)
    session_count_before = len(sessions_before)
    invalid_state = secrets.token_urlsafe(32)
    response = _direct_callback(
        live_environment,
        flow,
        invalid_state,
        "invalid-state-test-code",
    )
    _assert_error_is_safe(
        live_environment,
        flow,
        response,
        401,
        extra_sensitive=(invalid_state, "invalid-state-test-code"),
        expected_session_count=session_count_before,
    )

    flow = _start_login(live_environment)
    sessions_before = _session_count(live_environment)
    mismatched_cookie = secrets.token_urlsafe(32)
    response = _direct_callback(
        live_environment,
        flow,
        flow.state,
        "cookie-mismatch-test-code",
        transaction_token=mismatched_cookie,
    )
    _assert_error_is_safe(
        live_environment,
        flow,
        response,
        401,
        extra_sensitive=(mismatched_cookie, "cookie-mismatch-test-code"),
        expected_session_count=sessions_before,
    )


@pytest.mark.skipif(not LIVE_E2E_ENABLED, reason="Manual live Keycloak workflow only.")
def test_expired_authorization_transaction_is_rejected(live_environment):
    flow = _start_login(live_environment)
    sessions_before = _session_count(live_environment)
    _mutate_transaction(live_environment, flow, "expires_at", time.time() - 1)
    response = _direct_callback(
        live_environment,
        flow,
        flow.state,
        "expired-transaction-test-code",
    )
    _assert_error_is_safe(
        live_environment,
        flow,
        response,
        401,
        extra_sensitive=("expired-transaction-test-code",),
        expected_session_count=sessions_before,
    )


@pytest.mark.skipif(not LIVE_E2E_ENABLED, reason="Manual live Keycloak workflow only.")
def test_unknown_callback_parameters_remain_bad_requests(live_environment):
    flow = _start_login(live_environment)
    sessions_before = _session_count(live_environment)
    callback_url = PARMAR_ORIGIN + CALLBACK_PATH + "?" + urllib.parse.urlencode(
        {
            "code": "unknown-query-test-code",
            "state": flow.state,
            "unexpected": "unknown-query-value",
        }
    )
    request = urllib.request.Request(
        callback_url,
        headers={
            "Cookie": (
                f"{live_environment.app.OIDC_TRANSACTION_COOKIE_NAME}="
                f"{flow.transaction_token}"
            )
        },
    )
    response = _request(_new_opener(live_environment.ssl_context), request)
    _assert_error_is_safe(
        live_environment,
        flow,
        response,
        400,
        extra_sensitive=("unknown-query-test-code", "unknown-query-value"),
        expected_session_count=sessions_before,
    )


@pytest.mark.skipif(not LIVE_E2E_ENABLED, reason="Manual live Keycloak workflow only.")
def test_real_keycloak_provider_error_consumes_state_without_session(
    live_environment,
    monkeypatch,
):
    flow = _capture_provider_error_callback(live_environment, _start_login(live_environment))
    provider_error = urllib.parse.parse_qs(
        urllib.parse.urlsplit(flow.callback_url).query,
        keep_blank_values=True,
    )["error"][0]
    sessions_before = _session_count(live_environment)
    _check(
        _state_transaction_count(live_environment, flow.state) == 1,
        "The provider-error transaction was not persisted before callback processing.",
    )
    exchange_calls = []
    original_exchange = live_environment.app.OIDC_ADAPTER.exchange_authorization_code

    def record_exchange(*args, **kwargs):
        exchange_calls.append((args, kwargs))
        return original_exchange(*args, **kwargs)

    monkeypatch.setattr(
        live_environment.app.OIDC_ADAPTER,
        "exchange_authorization_code",
        record_exchange,
    )
    identity_before = _identity_store_snapshot(live_environment)
    sessions_before = _session_store_snapshot(live_environment)
    session_count_before = len(sessions_before)
    response = _callback_response(live_environment, flow, flow.callback_url)
    _assert_error_is_safe(
        live_environment,
        flow,
        response,
        401,
        extra_sensitive=(provider_error,),
        expected_session_count=session_count_before,
    )
    payload = _json_payload(response, "PARMAR returned an invalid provider-error response.")
    _check(
        payload.get("message") == "OIDC authentication was rejected."
        and not exchange_calls
        and _state_transaction_count(live_environment, flow.state) == 0
        and _cookie_from_jar(
            flow.cookie_jar,
            live_environment.app.SESSION_COOKIE_NAME,
        ) is None,
        "The provider error was not safely consumed without token exchange or session issuance.",
    )
    _check(
        _identity_store_snapshot(live_environment) == identity_before
        and _session_store_snapshot(live_environment) == sessions_before,
        "The provider error changed identity or trusted session records.",
    )

    replay_request = urllib.request.Request(
        flow.callback_url,
        headers={
            "Cookie": (
                f"{live_environment.app.OIDC_TRANSACTION_COOKIE_NAME}="
                f"{flow.transaction_token}"
            )
        },
    )
    replay_response = _request(_new_opener(live_environment.ssl_context), replay_request)
    _assert_error_is_safe(
        live_environment,
        flow,
        replay_response,
        401,
        extra_sensitive=(provider_error,),
        expected_session_count=session_count_before,
    )
    _check(
        not exchange_calls
        and _state_transaction_count(live_environment, flow.state) == 0
        and _identity_store_snapshot(live_environment) == identity_before
        and _session_store_snapshot(live_environment) == sessions_before,
        "Replaying the provider error exchanged a code or changed identity/session records.",
    )


@pytest.mark.skipif(not LIVE_E2E_ENABLED, reason="Manual live Keycloak workflow only.")
def test_invalid_nonce_is_rejected_after_real_code_exchange(live_environment):
    flow = _capture_authorization_callback(live_environment, _start_login(live_environment))
    sessions_before = _session_count(live_environment)
    invalid_nonce = secrets.token_urlsafe(32)
    _mutate_transaction(
        live_environment,
        flow,
        "nonce",
        invalid_nonce,
    )
    response = _callback_response(live_environment, flow, flow.callback_url)
    _assert_error_is_safe(
        live_environment,
        flow,
        response,
        401,
        extra_sensitive=(invalid_nonce,),
        expected_session_count=sessions_before,
    )


@pytest.mark.skipif(not LIVE_E2E_ENABLED, reason="Manual live Keycloak workflow only.")
def test_invalid_pkce_verifier_is_rejected_by_keycloak_token_endpoint(live_environment):
    flow = _capture_authorization_callback(live_environment, _start_login(live_environment))
    sessions_before = _session_count(live_environment)
    invalid_verifier = secrets.token_urlsafe(64)
    _mutate_transaction(
        live_environment,
        flow,
        "code_verifier",
        invalid_verifier,
    )
    response = _callback_response(live_environment, flow, flow.callback_url)
    _assert_error_is_safe(
        live_environment,
        flow,
        response,
        401,
        extra_sensitive=(invalid_verifier,),
        expected_session_count=sessions_before,
    )


@pytest.mark.parametrize("claim", ["issuer", "audience"])
@pytest.mark.skipif(not LIVE_E2E_ENABLED, reason="Manual live Keycloak workflow only.")
def test_real_keycloak_id_token_rejects_mismatched_issuer_or_audience(
    live_environment,
    monkeypatch,
    claim,
):
    flow = _capture_authorization_callback(live_environment, _start_login(live_environment))
    adapter = live_environment.app.OIDC_ADAPTER
    configuration = adapter.configuration
    mismatch = (
        configuration.issuer + "/unexpected"
        if claim == "issuer"
        else configuration.audience + "-unexpected"
    )
    monkeypatch.setattr(
        adapter,
        "configuration",
        replace(configuration, **{claim: mismatch}),
    )
    identity_before = _identity_store_snapshot(live_environment)
    sessions_before = _session_store_snapshot(live_environment)

    response = _callback_response(live_environment, flow, flow.callback_url)
    _assert_error_is_safe(
        live_environment,
        flow,
        response,
        401,
        expected_session_count=len(sessions_before),
    )
    _check(
        _identity_store_snapshot(live_environment) == identity_before
        and _session_store_snapshot(live_environment) == sessions_before
        and _state_transaction_count(live_environment, flow.state) == 0,
        f"A real Keycloak token with mismatched {claim} changed trusted state.",
    )


@pytest.mark.skipif(not LIVE_E2E_ENABLED, reason="Manual live Keycloak workflow only.")
def test_real_keycloak_id_token_with_unpublished_jwks_kid_is_rejected(
    live_environment,
    monkeypatch,
):
    flow = _capture_authorization_callback(live_environment, _start_login(live_environment))
    adapter = live_environment.app.OIDC_ADAPTER
    original_exchange = adapter.exchange_authorization_code

    def exchange_with_unpublished_kid(*args, **kwargs):
        return _token_with_unpublished_kid(original_exchange(*args, **kwargs))

    monkeypatch.setattr(
        adapter,
        "exchange_authorization_code",
        exchange_with_unpublished_kid,
    )
    identity_before = _identity_store_snapshot(live_environment)
    sessions_before = _session_store_snapshot(live_environment)

    response = _callback_response(live_environment, flow, flow.callback_url)
    _assert_error_is_safe(
        live_environment,
        flow,
        response,
        401,
        expected_session_count=len(sessions_before),
    )
    _check(
        _identity_store_snapshot(live_environment) == identity_before
        and _session_store_snapshot(live_environment) == sessions_before
        and _state_transaction_count(live_environment, flow.state) == 0,
        "An ID token with an unpublished JWKS kid changed trusted state.",
    )


@pytest.mark.skipif(not LIVE_E2E_ENABLED, reason="Manual live Keycloak workflow only.")
def test_genuinely_unbound_issuer_subject_cannot_authenticate_or_access_protected_routes(
    live_environment,
):
    identity_before = _identity_store_snapshot(live_environment)
    unbound_subject = live_environment.bootstrap_result["unbound_subject"]
    _check(
        all(
            issuer != bootstrap.ISSUER or subject != unbound_subject
            for issuer, subject, _, _ in identity_before[1]
        ),
        "The unbound Keycloak subject already has an account binding.",
    )
    with sqlite3.connect(
        bootstrap._expected_database_paths(live_environment.run_context)[
            "PARMAR_SESSION_DB_PATH"
        ]
    ) as connection:
        sessions_before = connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]

    flow = _capture_authorization_callback(
        live_environment,
        _start_login(live_environment),
        username=bootstrap.UNBOUND_TEST_USERNAME,
        password=live_environment.runtime_secrets["unbound_test_user_password"],
    )
    response = _callback_response(live_environment, flow, flow.callback_url)
    _assert_error_is_safe(
        live_environment,
        flow,
        response,
        401,
        expected_session_count=sessions_before,
    )
    _check(
        _cookie_from_jar(flow.cookie_jar, live_environment.app.SESSION_COOKIE_NAME) is None,
        "The unbound identity received an authenticated session cookie.",
    )

    session_response = _request(flow.opener, PARMAR_ORIGIN + "/api/session")
    session_payload = _json_payload(
        session_response,
        "PARMAR returned an invalid unauthenticated session response.",
    )
    _check(
        session_response.status == 200 and session_payload == {"authenticated": False},
        "The unbound identity resolved to a trusted principal or authenticated session.",
    )
    protected_response = _request(
        flow.opener,
        PARMAR_ORIGIN + "/api/identity/profiles",
    )
    _check(
        protected_response.status == 401,
        "The unbound identity accessed a protected PARMAR route.",
    )
    _check(
        _identity_store_snapshot(live_environment) == identity_before,
        "The unbound identity changed isolated account or binding state.",
    )
    with sqlite3.connect(
        bootstrap._expected_database_paths(live_environment.run_context)[
            "PARMAR_SESSION_DB_PATH"
        ]
    ) as connection:
        sessions_after = connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    _check(
        sessions_after == sessions_before,
        "The unbound identity created an authenticated server-side session.",
    )


@pytest.mark.skipif(not LIVE_E2E_ENABLED, reason="Manual live Keycloak workflow only.")
def test_real_authorization_code_pkce_login_creates_trusted_session_and_replay_fails(
    live_environment,
):
    flow = _capture_authorization_callback(live_environment, _start_login(live_environment))
    callback_response = _callback_response(
        live_environment,
        flow,
        flow.callback_url,
    )
    _check(callback_response.status == 200, "PARMAR rejected the valid Keycloak callback.")
    callback_payload = _json_payload(
        callback_response,
        "PARMAR returned an invalid successful callback response.",
    )
    _check(
        callback_payload.get("authenticated") is True
        and "id_token" not in callback_payload
        and flow.authorization_code.encode("ascii") not in callback_response.body,
        "The valid callback did not create a token-minimal trusted response.",
    )
    session_token = _cookie_from_jar(
        flow.cookie_jar,
        live_environment.app.SESSION_COOKIE_NAME,
    )
    _check(bool(session_token), "The successful callback did not issue a session cookie.")
    session = live_environment.app.SESSION_MANAGER.resolve(session_token)
    _check(
        session is not None
        and session.account_identity.serialize()
        == live_environment.bootstrap_result["account_id"],
        "The session did not resolve to the pre-bound PARMAR account.",
    )

    session_response = _request(
        flow.opener,
        PARMAR_ORIGIN + "/api/session",
    )
    session_payload = _json_payload(
        session_response,
        "PARMAR returned an invalid authenticated session response.",
    )
    _check(
        session_response.status == 200 and session_payload.get("authenticated") is True,
        "The newly issued session did not authenticate against PARMAR.",
    )
    profiles_response = _request(
        flow.opener,
        PARMAR_ORIGIN + "/api/identity/profiles",
    )
    profiles_payload = _json_payload(
        profiles_response,
        "PARMAR returned an invalid protected-resource response.",
    )
    _check(
        profiles_response.status == 200
        and isinstance(profiles_payload.get("profiles"), list),
        "The trusted session could not access an authenticated PARMAR route.",
    )

    sessions_before_replay = _session_count(live_environment)
    replay_response = _direct_callback(
        live_environment,
        flow,
        flow.state,
        flow.authorization_code,
    )
    _assert_error_is_safe(
        live_environment,
        flow,
        replay_response,
        401,
        expected_session_count=sessions_before_replay,
    )


@pytest.mark.skipif(not LIVE_E2E_ENABLED, reason="Manual live Keycloak workflow only.")
def test_disabling_bound_account_revokes_live_session_and_blocks_reauthentication(
    live_environment,
):
    flow = _capture_authorization_callback(live_environment, _start_login(live_environment))
    callback_response = _callback_response(
        live_environment,
        flow,
        flow.callback_url,
    )
    _check(callback_response.status == 200, "Initial bound-account login failed.")
    session_token = _cookie_from_jar(
        flow.cookie_jar,
        live_environment.app.SESSION_COOKIE_NAME,
    )
    _check(bool(session_token), "Initial login did not issue a session cookie.")
    session = live_environment.app.SESSION_MANAGER.resolve(session_token)
    _check(session is not None, "Initial session did not resolve.")
    evidence_id = session.identity_evidence_id
    session_count = _session_count(live_environment)
    account_id = live_environment.bootstrap_result["account_id"]

    with live_environment.app.IDENTITY_REPOSITORY._connection() as connection:
        updated = connection.execute(
            "UPDATE accounts SET status='DISABLED' WHERE account_id=? AND status='ACTIVE'",
            (account_id,),
        )
        _check(updated.rowcount == 1, "Synthetic account disablement did not apply once.")

    _check(
        live_environment.app.SESSION_MANAGER.resolve(session_token) is None,
        "A session for the disabled account remained active.",
    )
    persisted = live_environment.app.SESSION_MANAGER.repository.get_by_session_id(
        session.session_id
    )
    _check(
        persisted is not None
        and persisted.status == "REVOKED"
        and persisted.active_profile_id is None,
        "Account disablement did not revoke its persistent session.",
    )
    _check(
        evidence_id is not None
        and live_environment.app.SESSION_MANAGER.identity_evidence_state(evidence_id).value
        == "REVOKED",
        "Account disablement did not revoke authentication evidence.",
    )

    retry = _capture_authorization_callback(
        live_environment,
        _start_login(live_environment),
    )
    retry_response = _callback_response(
        live_environment,
        retry,
        retry.callback_url,
    )
    _assert_error_is_safe(
        live_environment,
        retry,
        retry_response,
        401,
        expected_session_count=session_count,
    )
