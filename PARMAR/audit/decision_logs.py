"""Audit log utilities for PARMAR decisions."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


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

    def log_phone_event(self, payload: dict) -> dict:
        return self.log_event("phone_event", payload)
