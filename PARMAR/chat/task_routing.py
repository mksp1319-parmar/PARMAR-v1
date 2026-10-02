"""Deterministic task classification for PARMAR's provider capability allow-list."""

from __future__ import annotations

import re

TEXT = "TEXT"
REASONING = "REASONING"
CODING_AS_TEXT = "CODING_AS_TEXT"
SUMMARIZATION = "SUMMARIZATION"
TRANSLATION = "TRANSLATION"
STRUCTURED_OUTPUT = "STRUCTURED_OUTPUT"
VERIFICATION = "VERIFICATION"
VISION = "VISION"

CAPABILITIES = frozenset({
    TEXT,
    REASONING,
    CODING_AS_TEXT,
    SUMMARIZATION,
    TRANSLATION,
    STRUCTURED_OUTPUT,
    VERIFICATION,
    VISION,
})

_ALIASES = {
    "text": TEXT,
    "text_generation": TEXT,
    "reasoning": REASONING,
    "code_generation": CODING_AS_TEXT,
    "coding_as_text": CODING_AS_TEXT,
    "summarization": SUMMARIZATION,
    "translation": TRANSLATION,
    "structured_output": STRUCTURED_OUTPUT,
    "verification": VERIFICATION,
    "image_analysis": VISION,
    "vision": VISION,
}

_TASK_NAMES = {
    "normal conversation": TEXT,
    "conversation": TEXT,
    "complex reasoning": REASONING,
    "code generation": CODING_AS_TEXT,
    "summarize text": SUMMARIZATION,
    "language conversion": TRANSLATION,
    "json/schema output": STRUCTURED_OUTPUT,
    "cross-check/verification": VERIFICATION,
    "image understanding": VISION,
}

_TASK_PATTERNS = (
    (VISION, re.compile(r"\b(image|photo|picture|visual|screenshot|diagram)\b", re.I)),
    (TRANSLATION, re.compile(r"\b(translate|translation|convert.{0,20}language)\b", re.I)),
    (SUMMARIZATION, re.compile(r"\b(summarize|summarise|summary|tl;?dr)\b", re.I)),
    (STRUCTURED_OUTPUT, re.compile(r"\b(json|schema|structured output)\b", re.I)),
    (VERIFICATION, re.compile(r"\b(verify|verification|cross.?check|fact.?check)\b", re.I)),
    (CODING_AS_TEXT, re.compile(r"\b(write|generate|create|implement|review)\s+(?:some\s+)?(?:code|program|script)\b", re.I)),
    (REASONING, re.compile(r"\b(complex reasoning|reason through|analy[sz]e|evaluate|derive|solve|compare)\b", re.I)),
)


def normalize_capability(capability: str) -> str | None:
    """Return a canonical capability, accepting legacy provider names."""
    if not isinstance(capability, str):
        return None
    normalized = capability.strip().replace("-", "_").lower()
    return _ALIASES.get(normalized) or (capability.strip().upper() if capability.strip().upper() in CAPABILITIES else None)


def task_to_capability(task: str) -> str | None:
    """Map a task label or an explicit capability to the allow-listed taxonomy."""
    if not isinstance(task, str):
        return None
    normalized = " ".join(task.strip().lower().split())
    return normalize_capability(normalized) or _TASK_NAMES.get(normalized)


def infer_task_capability(prompt: str) -> str:
    """Classify a prompt using fixed rules; no model or network inference is used."""
    if isinstance(prompt, str):
        for capability, pattern in _TASK_PATTERNS:
            if pattern.search(prompt):
                return capability
    return TEXT