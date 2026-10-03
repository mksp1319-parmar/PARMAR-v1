"""Bounded deterministic checks for untrusted provider response text."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Callable

from .context import sanitize_provider_text

PASS = "PASS"
REVIEW = "REVIEW"
BLOCK = "BLOCK"
UNCERTAIN = "UNCERTAIN"
NOT_CHECKED = "NOT_CHECKED"
RESPONSE_SAFETY_STATES = frozenset({PASS, REVIEW, BLOCK, UNCERTAIN, NOT_CHECKED})
RESPONSE_SAFETY_VERSION = "response-safety-v1"
MAX_RESPONSE_SAFETY_CHARS = 20_000

REASON_CODES = frozenset({
    "INVALID_OUTPUT_TYPE",
    "EMPTY_OUTPUT",
    "OUTPUT_TOO_LARGE",
    "INVALID_VALIDATION_CONTEXT",
    "UNSUPPORTED_LANGUAGE",
    "CREDENTIAL_INDICATOR",
    "SENSITIVE_DATA_INDICATOR",
    "SENSITIVE_DATA_ECHO",
    "PRIVACY_POLICY_VIOLATION",
    "AUTONOMY_BYPASS",
    "DANGEROUS_INSTRUCTION",
    "CONTROL_DIRECTIVE",
    "ACTION_DIRECTIVE",
    "PROMPT_INJECTION_SIGNAL",
    "CONFLICTING_SAFETY_CLAIMS",
    "AMBIGUOUS_OUTPUT",
    "VALIDATION_BUDGET_EXCEEDED",
    "VALIDATOR_FAILURE",
    "NO_OUTPUT",
    "PROVIDER_RESPONSE_INVALID",
    "AUDIT_FAILURE",
})

CHECK_CODES = frozenset({
    "output_contract",
    "output_size",
    "language_coverage",
    "credential_patterns",
    "sensitive_data_patterns",
    "sensitive_data_echo",
    "privacy_policy_patterns",
    "autonomy_policy_patterns",
    "dangerous_instruction_patterns",
    "control_directive_patterns",
    "prompt_injection_patterns",
    "conflict_patterns",
    "ambiguity_patterns",
})

_CREDENTIAL_PATTERNS = (
    re.compile(r"\b(?:password|passwd|pwd|passcode|secret|credential|api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token)\b\s*(?:is|[:=])\s*\S+", re.IGNORECASE),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{12,}", re.IGNORECASE),
    re.compile(r"\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{30,})\b"),
)
_EMAIL_PATTERN = re.compile(r"\b[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,63}\b", re.IGNORECASE)
_SSN_PATTERN = re.compile(r"\b(?:ssn|social security number)\s*(?:is|:)?\s*\d{3}-\d{2}-\d{4}\b", re.IGNORECASE)
_PRIVACY_POLICY_PATTERNS = (
    re.compile(r"\b(?:share|send|export|publish|exfiltrate)\b.{0,80}\b(?:medical records|social security|ssn|private employee data)\b", re.IGNORECASE),
)
_AUTONOMY_BYPASS_PATTERNS = (
    re.compile(r"\b(?:bypass|skip|ignore|override)\b.{0,80}\b(?:approval|consent|permission|safety checks|safety policy)\b", re.IGNORECASE),
)
_DANGEROUS_INSTRUCTION_PATTERNS = (
    re.compile(r"\b(?:delete|wipe|destroy|disable)\b.{0,80}\b(?:production database|backups?|safety systems?|audit logs?)\b", re.IGNORECASE),
)
_CONTROL_DIRECTIVE_PATTERNS = (
    re.compile(r"<\s*(?:tool|function)_call\b", re.IGNORECASE),
    re.compile(r"\b(?:tool_calls?|function_call|invoke_tool)[\"']?\s*[:=]", re.IGNORECASE),
    re.compile(r"[\"']?(?:action|command|function)[\"']?\s*:\s*[\"']?(?:execute|run|delete(?:_database)?|transfer(?:_funds)?|send(?:_data)?|share(?:_records)?)\b", re.IGNORECASE),
)
_ACTION_DIRECTIVE_PATTERNS = (
    re.compile(r"\b(?:execute|run|invoke)\s+(?:the\s+)?(?:tool|function|command)\b", re.IGNORECASE),
    re.compile(r"\b(?:parmar|i)\s+(?:have\s+)?(?:approved|executed|transferred|deleted|shared)\b", re.IGNORECASE),
    re.compile(r"\b(?:permission|approval)\s+(?:has been\s+)?(?:granted|approved)\b", re.IGNORECASE),
    re.compile(r"\baction\s+(?:has been\s+)?(?:executed|completed)\b", re.IGNORECASE),
)
_PROMPT_INJECTION_PATTERNS = (
    re.compile(r"\b(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+instructions\b", re.IGNORECASE),
    re.compile(r"\b(?:reveal|print|expose)\s+(?:the\s+)?(?:system prompt|hidden prompt|credentials|secrets)\b", re.IGNORECASE),
)
_SAFE_CLAIM_PATTERN = re.compile(r"\b(?:safe to proceed|approved for execution|allowed to proceed)\b", re.IGNORECASE)
_UNSAFE_CLAIM_PATTERN = re.compile(r"\b(?:not safe to proceed|not approved for execution|not allowed to proceed|do not proceed)\b", re.IGNORECASE)
_AMBIGUOUS_PHRASE_PATTERN = re.compile(r"\b(?:yes or no|cannot determine whether to proceed|cannot tell whether it is safe)\b", re.IGNORECASE)


@dataclass(frozen=True)
class ResponseSafetyResult:
    """Content-free response-validation outcome suitable for API and audit use."""

    status: str
    reason_codes: tuple[str, ...]
    checks_run: tuple[str, ...]
    validator_version: str = RESPONSE_SAFETY_VERSION

    def __post_init__(self) -> None:
        if self.status not in RESPONSE_SAFETY_STATES:
            raise ValueError("Unsupported response-safety status.")
        if len(self.reason_codes) > 8 or any(code not in REASON_CODES for code in self.reason_codes):
            raise ValueError("Response-safety reason codes must be bounded and allow-listed.")
        if len(self.checks_run) > len(CHECK_CODES) or any(check not in CHECK_CODES for check in self.checks_run):
            raise ValueError("Response-safety check codes must be bounded and allow-listed.")
        if self.validator_version != RESPONSE_SAFETY_VERSION:
            raise ValueError("Unsupported response-safety validator version.")

    def public_payload(self) -> dict[str, object]:
        return {
            "status": self.status,
            "reason_codes": list(self.reason_codes),
            "checks_run": list(self.checks_run),
            "validator_version": self.validator_version,
        }


class _ValidationBudgetExceeded(Exception):
    pass


class ResponseSafetyValidator:
    """Inspect bounded response text without consulting provider safety claims."""

    def __init__(
        self,
        *,
        max_output_chars: int = MAX_RESPONSE_SAFETY_CHARS,
        budget_seconds: float = 0.1,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not isinstance(max_output_chars, int) or isinstance(max_output_chars, bool) or not 1 <= max_output_chars <= MAX_RESPONSE_SAFETY_CHARS:
            raise ValueError("Response-safety size limit is invalid.")
        if not isinstance(budget_seconds, (int, float)) or isinstance(budget_seconds, bool) or budget_seconds < 0:
            raise ValueError("Response-safety budget is invalid.")
        self.max_output_chars = max_output_chars
        self.budget_seconds = float(budget_seconds)
        self._clock = clock

    @staticmethod
    def not_checked(reason_code: str, checks_run: tuple[str, ...] = ()) -> ResponseSafetyResult:
        return ResponseSafetyResult(NOT_CHECKED, (reason_code,), checks_run)

    @staticmethod
    def _contains_any(patterns: tuple[re.Pattern[str], ...], value: str) -> bool:
        return any(pattern.search(value) is not None for pattern in patterns)

    def validate(
        self,
        content: object,
        *,
        request_text: object,
        language: object,
    ) -> ResponseSafetyResult:
        checks_run = ["output_contract"]
        if not isinstance(content, str):
            return ResponseSafetyResult(BLOCK, ("INVALID_OUTPUT_TYPE",), tuple(checks_run))
        if not content.strip():
            return ResponseSafetyResult(BLOCK, ("EMPTY_OUTPUT",), tuple(checks_run))
        checks_run.append("output_size")
        if len(content) > self.max_output_chars:
            return ResponseSafetyResult(BLOCK, ("OUTPUT_TOO_LARGE",), tuple(checks_run))
        if not isinstance(request_text, str) or not isinstance(language, str):
            return self.not_checked("INVALID_VALIDATION_CONTEXT", tuple(checks_run))
        if language.strip().lower() not in {"en", "english"}:
            checks_run.append("language_coverage")
            return ResponseSafetyResult(UNCERTAIN, ("UNSUPPORTED_LANGUAGE",), tuple(checks_run))

        deadline = self._clock() + self.budget_seconds
        findings: list[tuple[str, str]] = []

        def run_check(check_code: str, check: Callable[[], list[tuple[str, str]]]) -> None:
            if self._clock() >= deadline:
                raise _ValidationBudgetExceeded
            findings.extend(check())
            checks_run.append(check_code)
            if self._clock() >= deadline:
                raise _ValidationBudgetExceeded

        try:
            run_check("credential_patterns", lambda: self._credential_findings(content))
            run_check("sensitive_data_patterns", lambda: self._sensitive_data_findings(content))
            run_check("sensitive_data_echo", lambda: self._sensitive_echo_findings(content, request_text))
            run_check("privacy_policy_patterns", lambda: self._privacy_findings(content))
            run_check("autonomy_policy_patterns", lambda: self._autonomy_findings(content))
            run_check("dangerous_instruction_patterns", lambda: self._dangerous_findings(content))
            run_check("control_directive_patterns", lambda: self._control_findings(content))
            run_check("prompt_injection_patterns", lambda: self._injection_findings(content))
            run_check("conflict_patterns", lambda: self._conflict_findings(content))
            run_check("ambiguity_patterns", lambda: self._ambiguity_findings(content))
        except _ValidationBudgetExceeded:
            return self.not_checked("VALIDATION_BUDGET_EXCEEDED", tuple(checks_run))
        except Exception:
            return self.not_checked("VALIDATOR_FAILURE", tuple(checks_run))

        reason_codes = tuple(dict.fromkeys(code for _severity, code in findings))[:8]
        if any(severity == BLOCK for severity, _code in findings):
            status = BLOCK
        elif any(severity == UNCERTAIN for severity, _code in findings):
            status = UNCERTAIN
        elif findings:
            status = REVIEW
        else:
            status = PASS
        return ResponseSafetyResult(status, reason_codes, tuple(checks_run))

    @staticmethod
    def _credential_findings(content: str) -> list[tuple[str, str]]:
        if "[REDACTED]" in content or sanitize_provider_text(content) != content:
            return [(BLOCK, "CREDENTIAL_INDICATOR")]
        if ResponseSafetyValidator._contains_any(_CREDENTIAL_PATTERNS, content):
            return [(BLOCK, "CREDENTIAL_INDICATOR")]
        return []

    @staticmethod
    def _sensitive_data_findings(content: str) -> list[tuple[str, str]]:
        if _SSN_PATTERN.search(content):
            return [(BLOCK, "SENSITIVE_DATA_INDICATOR")]
        if _EMAIL_PATTERN.search(content):
            return [(REVIEW, "SENSITIVE_DATA_INDICATOR")]
        return []

    @staticmethod
    def _sensitive_echo_findings(content: str, request_text: str) -> list[tuple[str, str]]:
        request_emails = {match.group(0).casefold() for match in _EMAIL_PATTERN.finditer(request_text[:MAX_RESPONSE_SAFETY_CHARS])}
        output_emails = {match.group(0).casefold() for match in _EMAIL_PATTERN.finditer(content)}
        if request_emails.intersection(output_emails):
            return [(REVIEW, "SENSITIVE_DATA_ECHO")]
        return []

    @staticmethod
    def _privacy_findings(content: str) -> list[tuple[str, str]]:
        if ResponseSafetyValidator._contains_any(_PRIVACY_POLICY_PATTERNS, content):
            return [(BLOCK, "PRIVACY_POLICY_VIOLATION")]
        return []

    @staticmethod
    def _autonomy_findings(content: str) -> list[tuple[str, str]]:
        if ResponseSafetyValidator._contains_any(_AUTONOMY_BYPASS_PATTERNS, content):
            return [(BLOCK, "AUTONOMY_BYPASS")]
        return []

    @staticmethod
    def _dangerous_findings(content: str) -> list[tuple[str, str]]:
        if ResponseSafetyValidator._contains_any(_DANGEROUS_INSTRUCTION_PATTERNS, content):
            return [(BLOCK, "DANGEROUS_INSTRUCTION")]
        return []

    @staticmethod
    def _control_findings(content: str) -> list[tuple[str, str]]:
        if ResponseSafetyValidator._contains_any(_CONTROL_DIRECTIVE_PATTERNS, content):
            return [(BLOCK, "CONTROL_DIRECTIVE")]
        if ResponseSafetyValidator._contains_any(_ACTION_DIRECTIVE_PATTERNS, content):
            return [(REVIEW, "ACTION_DIRECTIVE")]
        return []

    @staticmethod
    def _injection_findings(content: str) -> list[tuple[str, str]]:
        if ResponseSafetyValidator._contains_any(_PROMPT_INJECTION_PATTERNS, content):
            return [(REVIEW, "PROMPT_INJECTION_SIGNAL")]
        return []

    @staticmethod
    def _conflict_findings(content: str) -> list[tuple[str, str]]:
        if _SAFE_CLAIM_PATTERN.search(content) and _UNSAFE_CLAIM_PATTERN.search(content):
            return [(UNCERTAIN, "CONFLICTING_SAFETY_CLAIMS")]
        return []

    @staticmethod
    def _ambiguity_findings(content: str) -> list[tuple[str, str]]:
        if _AMBIGUOUS_PHRASE_PATTERN.search(content):
            return [(UNCERTAIN, "AMBIGUOUS_OUTPUT")]
        return []