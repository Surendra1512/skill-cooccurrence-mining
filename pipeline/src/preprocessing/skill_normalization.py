"""Skill-name normalisation with full traceability.

Pipeline for a single raw skill string::

    raw → text cleaning → generic-suffix stripping → synonym mapping → validation

Every distinct raw string is resolved once and cached, and a trace table
records ``raw → cleaned → canonical`` along with how many times each raw
string occurred, so any normalised result can be traced back to the source.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Mapping

import pandas as pd

from config.settings import DISPLAY_NAMES_PATH, SYNONYMS_PATH, PreprocessingConfig

_ALLOWED_CHARS = re.compile(r"[^a-z0-9 +#./&\-]")
_WHITESPACE = re.compile(r"\s+")
_EDGE_PUNCT = " .,-/&"
_HAS_LETTER = re.compile(r"[a-z]")

DEFAULT_STOP_TOKENS: frozenset[str] = frozenset(
    {"n/a", "na", "none", "null", "nan", "other", "others", "etc", "misc", "skills", "tbd"}
)
DEFAULT_GENERIC_SUFFIXES: tuple[str, ...] = (" programming", " language", " skills", " skill")

STATUS_KEPT = "kept"
STATUS_MAPPED = "mapped_synonym"
STATUS_INVALID = "removed_invalid"


def clean_skill_text(raw: str) -> str:
    """Lower-case, strip disallowed characters and collapse whitespace.

    Characters meaningful in technology names (``+ # . / & -``) are kept so
    that e.g. ``C++``, ``C#``, ``Node.js`` and ``ASP.NET`` stay distinct.
    """
    text = str(raw).lower().replace(" ", " ")
    text = _ALLOWED_CHARS.sub(" ", text)
    text = _WHITESPACE.sub(" ", text).strip()
    # Trim edge punctuation but never strip the '+'/'#' that define C++/C#/F#.
    return text.strip(_EDGE_PUNCT)


def load_synonyms(path: Path = SYNONYMS_PATH) -> dict[str, str]:
    """Load the extendable synonym dictionary (raw variant → canonical)."""
    with path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    mappings = payload.get("mappings", {})
    return {clean_skill_text(k): clean_skill_text(v) for k, v in mappings.items()}


def load_display_names(path: Path = DISPLAY_NAMES_PATH) -> dict[str, str]:
    """Load human-readable labels for canonical tokens."""
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        return dict(json.load(handle).get("labels", {}))


@dataclass
class SkillNormalizer:
    """Resolve raw skill strings to canonical tokens and keep a trace."""

    synonyms: Mapping[str, str] = field(default_factory=dict)
    config: PreprocessingConfig = field(default_factory=PreprocessingConfig)
    stop_tokens: frozenset[str] = DEFAULT_STOP_TOKENS
    generic_suffixes: tuple[str, ...] = DEFAULT_GENERIC_SUFFIXES
    _cache: dict[str, tuple[str, str | None, str]] = field(default_factory=dict, init=False, repr=False)
    _occurrences: Counter[str] = field(default_factory=Counter, init=False, repr=False)

    @classmethod
    def from_files(cls, config: PreprocessingConfig | None = None) -> "SkillNormalizer":
        return cls(synonyms=load_synonyms(), config=config or PreprocessingConfig())

    # ------------------------------------------------------------------ #
    def _resolve(self, raw: str) -> tuple[str, str | None, str]:
        cleaned = clean_skill_text(raw)
        candidate = cleaned
        for suffix in self.generic_suffixes:
            if candidate.endswith(suffix) and len(candidate) > len(suffix):
                candidate = candidate[: -len(suffix)].strip()
                break

        if not self._is_valid(candidate):
            return cleaned, None, STATUS_INVALID

        canonical = self.synonyms.get(candidate, candidate)
        status = STATUS_MAPPED if canonical != cleaned else STATUS_KEPT
        return cleaned, canonical, status

    def _is_valid(self, token: str) -> bool:
        return (
            self.config.min_skill_length <= len(token) <= self.config.max_skill_length
            and _HAS_LETTER.search(token) is not None
            and token not in self.stop_tokens
        )

    # ------------------------------------------------------------------ #
    def normalize(self, raw: str) -> str | None:
        """Return the canonical token for ``raw`` or ``None`` if invalid."""
        key = str(raw)
        resolved = self._cache.get(key)
        if resolved is None:
            resolved = self._resolve(key)
            self._cache[key] = resolved
        self._occurrences[key] += 1
        return resolved[1]

    def normalize_list(self, raw_skills: Iterable[str]) -> list[str]:
        """Normalise a posting's skills into a sorted list of unique tokens."""
        tokens = {self.normalize(raw) for raw in raw_skills}
        tokens.discard(None)
        return sorted(tokens)  # type: ignore[arg-type]

    def trace(self) -> pd.DataFrame:
        """Traceability table for every raw string seen so far."""
        rows = [
            {
                "raw_skill": raw,
                "cleaned": cleaned,
                "canonical": canonical,
                "status": status,
                "occurrences": self._occurrences[raw],
            }
            for raw, (cleaned, canonical, status) in self._cache.items()
        ]
        columns = ["raw_skill", "cleaned", "canonical", "status", "occurrences"]
        return pd.DataFrame(rows, columns=columns).sort_values(
            ["status", "occurrences"], ascending=[True, False], ignore_index=True
        )


def display_name(token: str, labels: Mapping[str, str] | None = None) -> str:
    """Human-readable label for a canonical skill token."""
    if labels and token in labels:
        return labels[token]
    return " ".join(part[:1].upper() + part[1:] for part in token.split(" "))
