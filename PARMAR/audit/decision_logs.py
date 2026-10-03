"""Audit log utilities for PARMAR decisions."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID


class DecisionLogManager:
    """Write sanitized decision records to disk without storing unnecessary personal data."""

    def __init__(self, log_path: str | None = None):
        base_dir = Path(__file__).resolve().parent
        self.log_path = Path(log_path) if log_path else base_dir / "decision_log.jsonl"
        self.log_path.parent.mkdir(parents=True, exist_ok=True)

    def _sanitize_record(self, record: dict) -> dict:
        safe = dict(record)
        for field in [
            "request_text",
            "customer_name",
            "email",
            "phone",
            "ssn",
            "medical_record",
            "messages",
            "photos",
            "contacts",
            "location",
            "password",
            "passphrase",
            "token",
            "secret",
            "api_key",
            "api-key",
            "authorization",
            "credentials",
            "private_key",
            "session_key",
            "access_token",
            "refresh_token",
        ]:
            safe.pop(field, None)
        return safe

    def log_event(self, event_type: str, payload: dict) -> dict:
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event_type": event_type,
            **self._sanitize_record(payload),
        }
        with self.log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, sort_keys=True) + "\n")
        return record

    def log_response_validation(
        self,
        *,
        decision_id: object,
        provider: object,
        result: object,
        output_char_count: object,
    ) -> dict:
        """Write only the fixed response-validation audit fields."""
        from PARMAR.chat.response_safety import (
            CHECK_CODES,
            NOT_CHECKED,
            REASON_CODES,
            RESPONSE_SAFETY_STATES,
            RESPONSE_SAFETY_VERSION,
            ResponseSafetyResult,
        )

        if type(result) is not ResponseSafetyResult:
            result = ResponseSafetyResult(NOT_CHECKED, ("VALIDATOR_FAILURE",), ())
        safe_decision_id = None
        if isinstance(decision_id, str):
            try:
                safe_decision_id = str(UUID(decision_id))
            except ValueError:
                pass
        known_providers = {"local-demo", "http-json", "openai", "gemini", "claude", "multi-model", "configured"}
        safe_provider = provider if isinstance(provider, str) and provider in known_providers else "configured"
        safe_status = result.status if result.status in RESPONSE_SAFETY_STATES else NOT_CHECKED
        safe_reasons = [code for code in result.reason_codes if code in REASON_CODES][:8]
        safe_checks = [code for code in result.checks_run if code in CHECK_CODES][:len(CHECK_CODES)]
        safe_count = (
            min(output_char_count, 1_000_000)
            if isinstance(output_char_count, int) and not isinstance(output_char_count, bool) and output_char_count >= 0
            else 0
        )
        return self.log_event("response_validation", {
            "decision_id": safe_decision_id,
            "provider": safe_provider,
            "validator_version": RESPONSE_SAFETY_VERSION,
            "validation_status": safe_status,
            "reason_codes": safe_reasons,
            "checks_run": safe_checks,
            "output_char_count": safe_count,
        })

    def log_phone_event(self, payload: dict) -> dict:
        return self.log_event("phone_event", payload)
