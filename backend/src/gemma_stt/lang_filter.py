"""Language validation — reject non-Bangla/non-English characters."""

from __future__ import annotations

import re
import unicodedata

# Bangla (Bengali) Unicode block: U+0980 – U+09FF
BANGLA_RE = re.compile(r"[\u0980-\u09FF]")

# English (Latin) letters, digits, common punctuation, whitespace
ENGLISH_SAFE_RE = re.compile(r"[A-Za-z0-9\s.,!?;:'\"\-–—()\[\]{}@#$%&*+=/\\|<>~`\u00A0\u2000-\u200F\u2010-\u2015\u2018\u2019\u201C\u201D\u2026]")

# Explicitly forbidden scripts (common mis-outputs from multilingual models)
FORBIDDEN_SCRIPTS = {
    "Devanagari",      # Hindi
    "Arabic",
    "Hebrew",
    "Cyrillic",        # Russian
    "Greek",
    "Han",             # Chinese
    "Hiragana",        # Japanese
    "Katakana",        # Japanese
    "Thai",
    "Tamil",
    "Telugu",
    "Kannada",
    "Malayalam",
    "Gujarati",
    "Punjabi",         # Gurmukhi
    "Oriya",
    "Sinhala",
    "Myanmar",
    "Khmer",
    "Lao",
    "Georgian",
    "Armenian",
    "Ethiopic",
    "Cherokee",
    "Mongolian",
    "Tibetan",
}

# Characters that are never acceptable (emojis, dingbats, symbols)
_SYMBOL_CATEGORIES = {"So", "Sc", "Sk", "Sm", "Cn"}


def _char_script(ch: str) -> str | None:
    """Return the Unicode script name for a character, or None."""
    try:
        # unicodedata.name gives e.g. "DEVANAGARI LETTER KA"
        name = unicodedata.name(ch, "")
        for script in FORBIDDEN_SCRIPTS:
            if script.upper() in name:
                return script
    except Exception:
        pass
    return None


def is_bangla_or_english(text: str) -> tuple[bool, str | None]:
    """
    Validate that `text` contains only Bangla and English characters.

    Returns:
        (is_valid, reason)
        is_valid = True if text passes validation
        reason   = None if valid, else a short description of what was rejected
    """
    if not text or text.strip() == "":
        return True, None

    # Allow these exact markers
    if text.strip().lower() in {"(silent)", "( silent )", "(silent)", ""}:
        return True, None

    for ch in text:
        # Whitespace is always fine
        if ch.isspace():
            continue

        # Bangla block
        if "\u0980" <= ch <= "\u09FF":
            continue

        # Basic Latin / ASCII punctuation / digits
        if ch.isascii():
            continue

        # Common typographic punctuation (smart quotes, dashes, ellipsis)
        if "\u2010" <= ch <= "\u2015" or ch in "\u2018\u2019\u201C\u201D\u2026\u00A0":
            continue

        # Check for emoji / symbol
        cat = unicodedata.category(ch)
        if cat in _SYMBOL_CATEGORIES:
            return False, f"Symbol/emoji rejected: {ch!r} (U+{ord(ch):04X})"

        # Check forbidden script by name
        script = _char_script(ch)
        if script:
            return False, f"Forbidden script '{script}' rejected: {ch!r} (U+{ord(ch):04X})"

        # Reject anything else
        return False, f"Non-Bangla/English character rejected: {ch!r} (U+{ord(ch):04X})"

    return True, None


def filter_to_bangla_english(text: str) -> str:
    """
    Aggressively filter text to only Bangla + English + safe punctuation.
    Drops rejected characters silently.
    """
    if not text:
        return ""

    result: list[str] = []
    for ch in text:
        if ch.isspace():
            result.append(ch)
            continue
        if "\u0980" <= ch <= "\u09FF":
            result.append(ch)
            continue
        if ch.isascii():
            result.append(ch)
            continue
        if "\u2010" <= ch <= "\u2015" or ch in "\u2018\u2019\u201C\u201D\u2026\u00A0":
            result.append(ch)
            continue
        # Drop everything else
    return "".join(result).strip()
