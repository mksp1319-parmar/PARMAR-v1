"""PARMAR's separately bounded and policy-gated web research capability."""

from .models import (
    CONTRACT_VERSION,
    ResearchResult,
    ResearchSource,
    ResearchStatus,
    SourceValidationError,
    normalize_sources,
)
from .providers import (
    HTTPJSONSearchProvider,
    SearchProvider,
    SearchProviderError,
    SearchProviderResponseError,
    UnavailableSearchProvider,
    search_provider_from_environment,
)
from .service import SearchService

__all__ = [
    "CONTRACT_VERSION",
    "ResearchResult",
    "ResearchSource",
    "ResearchStatus",
    "SourceValidationError",
    "normalize_sources",
    "HTTPJSONSearchProvider",
    "SearchProvider",
    "SearchProviderError",
    "SearchProviderResponseError",
    "UnavailableSearchProvider",
    "search_provider_from_environment",
    "SearchService",
]
