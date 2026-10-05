"""Explicitly configured research providers and their bounded HTTP transport."""

from __future__ import annotations

import ipaddress
import json
import math
import os
import socket
from collections.abc import Callable, Mapping
from http.client import HTTPConnection, HTTPException, HTTPSConnection
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import (
    HTTPHandler,
    HTTPSHandler,
    HTTPRedirectHandler,
    ProxyHandler,
    Request,
    build_opener,
)

from PARMAR.chat.context import sanitize_provider_text

SEARCH_PROVIDER_ENV = "PARMAR_SEARCH_PROVIDER"
SEARCH_ENDPOINT_ENV = "PARMAR_SEARCH_ENDPOINT"
SEARCH_API_KEY_ENV = "PARMAR_SEARCH_API_KEY"
SEARCH_TIMEOUT_ENV = "PARMAR_SEARCH_TIMEOUT_SECONDS"
SEARCH_PROVIDER_ID = "http-json-search"
DEFAULT_SEARCH_TIMEOUT_SECONDS = 15.0
MAX_SEARCH_TIMEOUT_SECONDS = 30.0
MAX_SEARCH_QUERY_CHARS = 2000
MAX_SEARCH_REQUEST_BYTES = 4096
MAX_SEARCH_RESPONSE_BYTES = 512_000
MAX_SEARCH_RESULTS = 20


class SearchProviderError(RuntimeError):
    """A configured search provider failed to complete a request."""


class SearchProviderResponseError(SearchProviderError):
    """A configured search provider returned malformed JSON or a result envelope."""


class SearchProvider(Protocol):
    """Vendor-independent contract for PARMAR search adapters."""

    provider_id: str

    def search(self, query: str) -> list[Mapping[str, Any]]:
        ...


class UnavailableSearchProvider:
    """Fail-closed adapter returned when search is unconfigured or invalid."""

    provider_id = SEARCH_PROVIDER_ID

    def search(self, query: str) -> list[Mapping[str, Any]]:
        raise SearchProviderError("No configured research provider is available.")


class _NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _connect_to_pinned_address(
    addresses: tuple[str, ...],
    port: int,
    timeout: float,
    source_address: tuple[str, int] | None,
) -> socket.socket:
    last_error: OSError | None = None
    for address in addresses:
        try:
            return socket.create_connection((address, port), timeout, source_address)
        except OSError as error:
            last_error = error
    if last_error is not None:
        raise last_error
    raise OSError("No safe provider address was resolved.")


def _pinned_opener(addresses: tuple[str, ...]):
    class PinnedHTTPConnection(HTTPConnection):
        def connect(self) -> None:
            self.sock = _connect_to_pinned_address(
                addresses, self.port, self.timeout, self.source_address
            )
            if self._tunnel_host:
                self._tunnel()

    class PinnedHTTPSConnection(HTTPSConnection):
        def connect(self) -> None:
            sock = _connect_to_pinned_address(
                addresses, self.port, self.timeout, self.source_address
            )
            if self._tunnel_host:
                self.sock = sock
                self._tunnel()
                sock = self.sock
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)

    class PinnedHTTPHandler(HTTPHandler):
        def http_open(self, request):
            return self.do_open(PinnedHTTPConnection, request)

    class PinnedHTTPSHandler(HTTPSHandler):
        def https_open(self, request):
            return self.do_open(PinnedHTTPSConnection, request)

    return build_opener(
        ProxyHandler({}),
        _NoRedirectHandler(),
        PinnedHTTPHandler(),
        PinnedHTTPSHandler(),
    )


class HTTPJSONSearchProvider:
    """Generic configured JSON search API adapter with no vendor assumptions."""

    provider_id = SEARCH_PROVIDER_ID

    def __init__(
        self,
        endpoint: str,
        api_key: str = "",
        timeout_seconds: float = DEFAULT_SEARCH_TIMEOUT_SECONDS,
        *,
        opener: Callable[..., Any] | Any | None = None,
        resolver: Callable[[str], object] | None = None,
    ) -> None:
        self.endpoint = self._validated_endpoint(endpoint)
        if not isinstance(api_key, str) or len(api_key) > 4096:
            raise ValueError("Search API credential is invalid.")
        try:
            timeout = float(timeout_seconds)
        except (TypeError, ValueError):
            raise ValueError("Search timeout must be a number from 0 to 30 seconds.") from None
        if not math.isfinite(timeout) or timeout <= 0 or timeout > MAX_SEARCH_TIMEOUT_SECONDS:
            raise ValueError("Search timeout must be greater than 0 and at most 30 seconds.")
        self._api_key = api_key.strip()
        self.timeout_seconds = timeout
        self._opener = opener
        self._resolver = resolver or (lambda host: socket.getaddrinfo(host, None))

    @staticmethod
    def _validated_endpoint(endpoint: object) -> str:
        if (
            not isinstance(endpoint, str)
            or not endpoint
            or len(endpoint) > 2048
            or endpoint != endpoint.strip()
        ):
            raise ValueError("Search endpoint must be an explicit HTTPS URL.")
        try:
            parts = urlsplit(endpoint)
            hostname = parts.hostname
            port = parts.port
        except ValueError:
            raise ValueError("Search endpoint must be an explicit HTTPS URL.") from None
        loopback_http = False
        if hostname:
            try:
                loopback_http = (
                    parts.scheme.lower() == "http"
                    and ipaddress.ip_address(hostname).is_loopback
                )
            except ValueError:
                loopback_http = parts.scheme.lower() == "http" and hostname.lower() == "localhost"
        if (
            not hostname
            or (parts.scheme.lower() != "https" and not loopback_http)
            or parts.username is not None
            or parts.password is not None
            or parts.query
            or parts.fragment
            or any(ord(character) < 0x20 or character.isspace() for character in endpoint)
            or "\\" in endpoint
            or (port is not None and not 1 <= port <= 65535)
        ):
            raise ValueError("Search endpoint must be HTTPS; HTTP is allowed only for loopback.")
        try:
            literal_address = ipaddress.ip_address(hostname)
        except ValueError:
            literal_address = None
        if parts.scheme.lower() == "https" and literal_address is not None and not literal_address.is_global:
            raise ValueError("Search endpoint must not use a private or reserved address.")
        return endpoint

    @classmethod
    def from_environment(
        cls,
        environ: Mapping[str, str] | None = None,
        *,
        opener: Callable[..., Any] | Any | None = None,
        resolver: Callable[[str], object] | None = None,
    ) -> HTTPJSONSearchProvider:
        values = os.environ if environ is None else environ
        endpoint = values.get(SEARCH_ENDPOINT_ENV)
        if not isinstance(endpoint, str) or not endpoint.strip():
            raise ValueError(f"Missing search provider configuration: {SEARCH_ENDPOINT_ENV}.")
        timeout_value = values.get(
            SEARCH_TIMEOUT_ENV, str(DEFAULT_SEARCH_TIMEOUT_SECONDS)
        )
        try:
            timeout = float(timeout_value)
        except (TypeError, ValueError):
            raise ValueError("Search timeout must be a number from 0 to 30 seconds.") from None
        return cls(
            endpoint,
            values.get(SEARCH_API_KEY_ENV, ""),
            timeout,
            opener=opener,
            resolver=resolver,
        )

    def _public_addresses(self) -> tuple[str, ...]:
        parts = urlsplit(self.endpoint)
        hostname = parts.hostname
        if hostname is None:
            raise SearchProviderError("The configured search provider address is invalid.")
        try:
            raw_addresses = self._resolver(hostname)
        except (OSError, socket.gaierror):
            raise SearchProviderError("The configured search provider could not be reached.") from None
        if not isinstance(raw_addresses, (list, tuple)) or not raw_addresses:
            raise SearchProviderError("The configured search provider could not be reached.")
        addresses: list[str] = []
        for record in raw_addresses:
            raw_address = record[4][0] if isinstance(record, tuple) and len(record) >= 5 else record
            try:
                address = ipaddress.ip_address(raw_address)
            except (TypeError, ValueError):
                raise SearchProviderError("The configured search provider address is invalid.") from None
            if parts.scheme == "http":
                if not address.is_loopback:
                    raise SearchProviderError("The configured search provider destination is not allowed.")
            elif not address.is_global:
                raise SearchProviderError("The configured search provider destination is not allowed.")
            addresses.append(str(address))
        return tuple(dict.fromkeys(addresses))

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def search(self, query: str) -> list[Mapping[str, Any]]:
        if not isinstance(query, str) or not query.strip() or len(query) > MAX_SEARCH_QUERY_CHARS:
            raise SearchProviderResponseError("The research query is invalid.")
        clean_query = sanitize_provider_text(query).strip()
        if not clean_query:
            raise SearchProviderResponseError("The research query is invalid.")
        payload = json.dumps(
            {"query": clean_query, "limit": MAX_SEARCH_RESULTS},
            ensure_ascii=True,
            separators=(",", ":"),
        ).encode("utf-8")
        if len(payload) > MAX_SEARCH_REQUEST_BYTES:
            raise SearchProviderResponseError("The research query exceeds the request limit.")
        addresses = self._public_addresses()
        request = Request(
            self.endpoint,
            data=payload,
            headers={
                "Content-Type": "application/json",
                **self._headers(),
            },
            method="POST",
        )
        try:
            if self._opener is None:
                response_context = _pinned_opener(addresses).open(
                    request, timeout=self.timeout_seconds
                )
            elif callable(self._opener):
                response_context = self._opener(request, timeout=self.timeout_seconds)
            else:
                response_context = self._opener.open(request, timeout=self.timeout_seconds)
            with response_context as response:
                response_body = response.read(MAX_SEARCH_RESPONSE_BYTES + 1)
        except HTTPError:
            raise SearchProviderError("The configured search provider returned an error response.") from None
        except (TimeoutError, socket.timeout):
            raise SearchProviderError("The configured search provider timed out.") from None
        except URLError as error:
            if isinstance(error.reason, (TimeoutError, socket.timeout)):
                raise SearchProviderError("The configured search provider timed out.") from None
            raise SearchProviderError("The configured search provider could not be reached.") from None
        except (OSError, HTTPException):
            raise SearchProviderError("The configured search provider could not be reached.") from None
        except Exception:
            raise SearchProviderError("The configured search provider request failed.") from None
        if not isinstance(response_body, bytes) or len(response_body) > MAX_SEARCH_RESPONSE_BYTES:
            raise SearchProviderResponseError("The search provider response was too large or invalid.")
        try:
            decoded = json.loads(response_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
            raise SearchProviderResponseError("The search provider returned malformed JSON.") from None
        if (
            not isinstance(decoded, dict)
            or not isinstance(decoded.get("results"), list)
            or len(decoded["results"]) > MAX_SEARCH_RESULTS
        ):
            raise SearchProviderResponseError("The search provider returned an invalid result envelope.")
        results = []
        for raw in decoded["results"]:
            if not isinstance(raw, dict):
                results.append(raw)
                continue
            safe_source = dict(raw)
            source_url = safe_source.get("url")
            if isinstance(source_url, str) and self._api_key and self._api_key in source_url:
                raise SearchProviderResponseError(
                    "The search provider returned a credential-bearing source URL."
                )
            for field in ("title", "source_id", "snippet", "domain"):
                value = safe_source.get(field)
                if isinstance(value, str) and self._api_key:
                    safe_source[field] = value.replace(self._api_key, "[REDACTED]")
            metadata = safe_source.get("metadata")
            if isinstance(metadata, dict) and self._api_key:
                safe_source["metadata"] = {
                    key: value.replace(self._api_key, "[REDACTED]")
                    if isinstance(value, str)
                    else value
                    for key, value in metadata.items()
                }
            results.append(safe_source)
        return results


def search_provider_from_environment(
    environ: Mapping[str, str] | None = None,
) -> SearchProvider:
    """Resolve only the explicitly selected search provider; never fall back."""
    values = os.environ if environ is None else environ
    selected = values.get(SEARCH_PROVIDER_ENV, "")
    if not isinstance(selected, str) or selected.strip().lower() != "http-json":
        return UnavailableSearchProvider()
    try:
        return HTTPJSONSearchProvider.from_environment(values)
    except ValueError:
        return UnavailableSearchProvider()
