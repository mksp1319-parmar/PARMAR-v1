"""Versioned, validated contracts for PARMAR research results."""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass, field
from enum import Enum
from collections.abc import Mapping
from typing import Any
from urllib.parse import parse_qsl, urlsplit, urlunsplit

from PARMAR.chat.context import sanitize_provider_text

CONTRACT_VERSION = "1.0"
MAX_SOURCES = 20
MAX_TITLE_LENGTH = 500
MAX_URL_LENGTH = 2048
MAX_SNIPPET_LENGTH = 2000
_HOST_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
_BLOCKED_HOST_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home")
_METADATA_FIELDS = frozenset({"author", "attribution", "content_type", "published_at"})
_SOURCE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}")
_SENSITIVE_QUERY_KEYS = frozenset({
    "apikey",
    "accesstoken",
    "auth",
    "authtoken",
    "authorization",
    "clientsecret",
    "credential",
    "password",
    "privatekey",
    "secret",
    "signature",
    "token",
})


class ResearchStatus(str, Enum):
    NOT_REQUESTED = "NOT_REQUESTED"
    SEARCHING = "SEARCHING"
    RESULTS = "RESULTS"
    NO_RESULTS = "NO_RESULTS"
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
    PROVIDER_FAILED = "PROVIDER_FAILED"
    INVALID_RESULTS = "INVALID_RESULTS"
    BLOCKED = "BLOCKED"


@dataclass(frozen=True)
class ResearchSource:
    title: str
    url: str
    domain: str
    provider_id: str
    source_id: str
    snippet: str | None = None
    metadata: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if (
            not isinstance(self.title, str)
            or not self.title.strip()
            or len(self.title) > MAX_TITLE_LENGTH
            or not isinstance(self.source_id, str)
            or not _SOURCE_ID.fullmatch(self.source_id)
            or not isinstance(self.provider_id, str)
            or not re.fullmatch(r"[a-z][a-z0-9-]{0,47}", self.provider_id)
            or not isinstance(self.metadata, dict)
            or any(
                key not in _METADATA_FIELDS
                or not isinstance(value, str)
                or not value.strip()
                or len(value) > 300
                for key, value in self.metadata.items()
            )
        ):
            raise ValueError("Research source does not satisfy the source contract.")
        try:
            normalized_url, domain = _normalize_url(self.url)
        except SourceValidationError as error:
            raise ValueError("Research source does not satisfy the source contract.") from error
        if normalized_url != self.url or domain != self.domain:
            raise ValueError("Research source does not satisfy the source contract.")
        if self.snippet is not None and (
            not isinstance(self.snippet, str)
            or not self.snippet.strip()
            or len(self.snippet) > MAX_SNIPPET_LENGTH
        ):
            raise ValueError("Research source does not satisfy the source contract.")

    def public_payload(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "url": self.url,
            "domain": self.domain,
            "provider_id": self.provider_id,
            "source_id": self.source_id,
            "snippet": self.snippet,
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class ResearchResult:
    status: ResearchStatus
    sources: tuple[ResearchSource, ...] = ()
    reason_code: str | None = None
    contract_version: str = CONTRACT_VERSION

    def __post_init__(self) -> None:
        if (
            not isinstance(self.status, ResearchStatus)
            or self.contract_version != CONTRACT_VERSION
            or not isinstance(self.sources, tuple)
            or any(not isinstance(source, ResearchSource) for source in self.sources)
            or (
                self.reason_code is not None
                and (
                    not isinstance(self.reason_code, str)
                    or not re.fullmatch(r"[A-Z0-9_]{1,64}", self.reason_code)
                )
            )
        ):
            raise ValueError("Research result does not satisfy the contract.")
        if self.status is ResearchStatus.RESULTS and not self.sources:
            raise ValueError("RESULTS requires at least one source.")
        if self.status is not ResearchStatus.RESULTS and self.sources:
            raise ValueError("Only RESULTS may contain sources.")
        if self.status is ResearchStatus.NO_RESULTS and self.reason_code is not None:
            raise ValueError("NO_RESULTS cannot contain an error reason.")

    @classmethod
    def not_requested(cls) -> ResearchResult:
        return cls(ResearchStatus.NOT_REQUESTED)

    @classmethod
    def searching(cls) -> ResearchResult:
        return cls(ResearchStatus.SEARCHING)

    def public_payload(self) -> dict[str, Any]:
        return {
            "contract_version": self.contract_version,
            "status": self.status.value,
            "sources": [source.public_payload() for source in self.sources],
            "reason_code": self.reason_code,
        }


class SourceValidationError(ValueError):
    """A provider source does not satisfy PARMAR's source contract."""


def _normalize_url(value: object) -> tuple[str, str]:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > MAX_URL_LENGTH
        or value != value.strip()
        or any(ord(character) < 0x20 or character.isspace() for character in value)
        or "\\" in value
    ):
        raise SourceValidationError("Source URL is malformed.")
    try:
        parts = urlsplit(value)
        hostname = parts.hostname
        port = parts.port
    except ValueError:
        raise SourceValidationError("Source URL is malformed.") from None
    if (
        parts.scheme.lower() != "https"
        or not hostname
        or parts.username is not None
        or parts.password is not None
    ):
        raise SourceValidationError("Source URL must be an HTTPS URL without embedded credentials.")
    sensitive_parameters = parse_qsl(parts.query) + parse_qsl(parts.fragment.lstrip("?#"))
    if any(
        re.sub(r"[-_]", "", name).casefold() in _SENSITIVE_QUERY_KEYS
        for name, _ in sensitive_parameters
    ):
        raise SourceValidationError("Source URL contains a credential-like parameter.")
    try:
        host = hostname.encode("idna").decode("ascii").lower().rstrip(".")
    except UnicodeError:
        raise SourceValidationError("Source host is malformed.") from None
    if (
        not host
        or len(host) > 253
        or host == "localhost"
        or host.endswith(_BLOCKED_HOST_SUFFIXES)
        or any(not _HOST_LABEL.fullmatch(label) for label in host.split("."))
        or (port is not None and not 1 <= port <= 65535)
    ):
        raise SourceValidationError("Source host is invalid.")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        raise SourceValidationError("Source host is not publicly routable.")
    netloc = host if port in (None, 443) else f"{host}:{port}"
    normalized_url = urlunsplit(("https", netloc, parts.path or "/", parts.query, parts.fragment))
    return normalized_url, host


def _required_text(value: object, field_name: str, limit: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise SourceValidationError(f"Source {field_name} is missing or invalid.")
    if any(ord(character) < 0x20 and character not in "\t\n\r" for character in value):
        raise SourceValidationError(f"Source {field_name} is invalid.")
    return sanitize_provider_text(value.strip())


def _normalize_source(raw: object, provider_id: str) -> ResearchSource:
    if not isinstance(raw, Mapping):
        raise SourceValidationError("Provider source is not an object.")
    title = _required_text(raw.get("title"), "title", MAX_TITLE_LENGTH)
    raw_url = raw.get("url")
    if not isinstance(raw_url, str) or not raw_url.strip() or len(raw_url) > MAX_URL_LENGTH:
        raise SourceValidationError("Source URL is missing or invalid.")
    source_id = _required_text(raw.get("source_id"), "identifier", 200)
    if not _SOURCE_ID.fullmatch(source_id):
        raise SourceValidationError("Source identifier is invalid.")
    normalized_url, domain = _normalize_url(raw_url)
    supplied_domain = raw.get("domain")
    if supplied_domain is not None:
        if not isinstance(supplied_domain, str):
            raise SourceValidationError("Source domain is invalid.")
        try:
            normalized_domain = supplied_domain.encode("idna").decode("ascii").lower().rstrip(".")
        except UnicodeError:
            raise SourceValidationError("Source domain is invalid.") from None
        if normalized_domain != domain:
            raise SourceValidationError("Source domain does not match its URL.")
    snippet_value = raw.get("snippet")
    snippet = None
    if snippet_value is not None:
        snippet = _required_text(snippet_value, "snippet", MAX_SNIPPET_LENGTH)
    raw_metadata = raw.get("metadata", {})
    if not isinstance(raw_metadata, Mapping):
        raise SourceValidationError("Source metadata is invalid.")
    metadata: dict[str, str] = {}
    for key in _METADATA_FIELDS:
        value = raw_metadata.get(key)
        if value is None:
            continue
        if not isinstance(value, str) or not value.strip() or len(value) > 300:
            raise SourceValidationError("Source attribution metadata is invalid.")
        metadata[key] = sanitize_provider_text(value.strip())
    return ResearchSource(
        title=title,
        url=normalized_url,
        domain=domain,
        provider_id=provider_id,
        source_id=source_id,
        snippet=snippet,
        metadata=metadata,
    )


def normalize_sources(raw_sources: object, provider_id: str) -> tuple[ResearchSource, ...]:
    """Validate provider output, retain approved fields, and deduplicate by destination URL."""
    if (
        not isinstance(provider_id, str)
        or not re.fullmatch(r"[a-z][a-z0-9-]{0,47}", provider_id)
        or not isinstance(raw_sources, list)
        or len(raw_sources) > MAX_SOURCES
    ):
        raise SourceValidationError("Provider results do not satisfy the research contract.")
    normalized: list[ResearchSource] = []
    seen_urls: set[str] = set()
    for raw in raw_sources:
        source = _normalize_source(raw, provider_id)
        if source.url not in seen_urls:
            normalized.append(source)
            seen_urls.add(source.url)
    return tuple(normalized)


def research_result_from_payload(payload: object) -> ResearchResult:
    """Validate a serialized public research contract without accepting unknown fields."""
    if (
        not isinstance(payload, Mapping)
        or set(payload) != {"contract_version", "status", "sources", "reason_code"}
        or payload.get("contract_version") != CONTRACT_VERSION
        or not isinstance(payload.get("status"), str)
        or not isinstance(payload.get("sources"), list)
    ):
        raise SourceValidationError("Research result does not satisfy the contract.")
    try:
        status = ResearchStatus(payload["status"])
    except ValueError:
        raise SourceValidationError("Research result does not satisfy the contract.") from None

    sources: list[ResearchSource] = []
    expected_source_fields = {
        "title", "url", "domain", "provider_id", "source_id", "snippet", "metadata",
    }
    for item in payload["sources"]:
        if len(sources) >= MAX_SOURCES:
            raise SourceValidationError("Research result exceeds the source limit.")
        if not isinstance(item, Mapping) or set(item) != expected_source_fields:
            raise SourceValidationError("Research source does not satisfy the source contract.")
        try:
            sources.append(ResearchSource(**item))
        except (TypeError, ValueError) as error:
            raise SourceValidationError(
                "Research source does not satisfy the source contract."
            ) from error
    if len({source.url for source in sources}) != len(sources):
        raise SourceValidationError("Research sources contain duplicate destinations.")
    try:
        return ResearchResult(
            status=status,
            sources=tuple(sources),
            reason_code=payload["reason_code"],
            contract_version=payload["contract_version"],
        )
    except (TypeError, ValueError) as error:
        raise SourceValidationError("Research result does not satisfy the contract.") from error
