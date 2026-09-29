"""Utilities for language-agnostic safety matching across English, Hindi, and Hinglish."""

from __future__ import annotations

import re


HINDI_KEYWORDS = {
    "share": ["share", "sambandh", "sambhal", "साझा", "साझेदारी", "भेजें", "भेजना", "send"],
    "send": ["send", "सेंड", "भेजें", "भेजना", "प्रसारित"],
    "data": ["data", "डेटा", "information", "जानकारी", "records", "रिकॉर्ड", "record"],
    "medical": ["medical", "medic", "health", "mhealth", "मेडिकल", "स्वास्थ्य", "डॉक्टर"],
    "privacy": ["privacy", "private", "secret", "confidential", "गोपनीय", "निजी", "private"],
    "delete": ["delete", "erase", "remove", "wipe", "डिलीट", "मिटाना", "हटाना", "remove"],
    "override": ["override", "bypass", "disable", "take control", "ओवरराइड", "बायपास", "अक्षम", "नियंत्रण"],
    "vendor": ["vendor", "contractor", "third-party", "third party", "ठेकेदार", "तृतीय पक्ष", "vendor"],
    "money": ["money", "funds", "payment", "finance", "transfer funds", "धन", "पेमेन्ट", "payment"],
    "location": ["location", "geo", "place", "लॉकेशन", "स्थान"],
    "camera": ["camera", "कैमरा", "video"],
    "microphone": ["microphone", "माइक्रोफोन", "audio"],
    "messages": ["messages", "msg", "sms", "message", "संदेश", "मैसेज"],
    "contacts": ["contacts", "address book", "directory", "संपर्क", "कॉन्टैक्ट"],
    "photos": ["photos", "images", "pictures", "फोटो", "चित्र"],
    "employee": ["employee", "staff", "worker", "कर्मचारी", "स्टाफ"],
    "permission": ["permission", "approval", "authorized", "allow", "अनुमति", "स्वीकृति"],
    "autonomy": ["autonomy", "choice", "decision-making", "decision making", "स्वतंत्रता", "विकल्प"],
}


def normalize_text(value: str) -> str:
    if value is None:
        return ""
    text = str(value).lower()
    text = text.replace("—", " ").replace("-", " ")
    text = re.sub(r"[^\w\s\u0900-\u097f]", " ", text)
    return " ".join(text.split())


def contains_any_keyword(text: str, keywords: list[str]) -> bool:
    normalized = normalize_text(text)
    for keyword in keywords:
        k = normalize_text(keyword)
        if not k:
            continue
        if k in normalized:
            return True
    return False


def keyword_group_match(text: str, groups: list[str] | tuple[str, ...] | set[str]) -> bool:
    normalized = normalize_text(text)
    for item in groups:
        if not item:
            continue
        item_normalized = normalize_text(item)
        if item_normalized and item_normalized in normalized:
            return True
    return False
