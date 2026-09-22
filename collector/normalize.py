"""Text/URL normalisation helpers (pure functions, easy to unit-test)."""

from __future__ import annotations

import html
import re
import time
import unicodedata
from datetime import UTC, datetime
from html.parser import HTMLParser
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# Query parameters that only track the visitor and never change the content.
_TRACKING_PARAMS = re.compile(
    r"^(utm_\w+|fbclid|gclid|dclid|mc_cid|mc_eid|_hsenc|_hsmi|ref|ref_src|spm|igshid)$",
    re.IGNORECASE,
)
_WS = re.compile(r"\s+")
_NON_WORD = re.compile(r"[^\w\s]", re.UNICODE)


def canonical_url(url: str) -> str:
    """Lower-case scheme/host, drop fragment, tracking params and trailing slash.

    The result is stored and shown as the link, so it must stay a working URL
    (no www-stripping or scheme rewriting).
    """
    parts = urlsplit(url.strip())
    scheme = parts.scheme.lower()
    netloc = parts.netloc.lower()
    query = urlencode(
        [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not _TRACKING_PARAMS.match(k)]
    )
    path = parts.path or "/"
    if len(path) > 1:
        path = path.rstrip("/")
    return urlunsplit((scheme, netloc, path, query, ""))


class _TextExtractor(HTMLParser):
    _SKIP = {"script", "style", "noscript"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP:
            self._skip_depth += 1
        elif tag in ("p", "br", "li", "div", "h1", "h2", "h3", "h4"):
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in self._SKIP and self._skip_depth:
            self._skip_depth -= 1

    def handle_data(self, data):
        if not self._skip_depth:
            self.parts.append(data)


def html_to_text(value: str | None) -> str:
    if not value:
        return ""
    parser = _TextExtractor()
    parser.feed(value)
    parser.close()
    return _WS.sub(" ", html.unescape("".join(parser.parts))).strip()


def truncate(text: str, max_chars: int) -> str:
    """Cut at a word boundary. Intentional: bounds the AI input cost per item."""
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars].rsplit(" ", 1)[0]
    return cut + " …"


def normalize_title(title: str) -> str:
    """Lower-case, strip accents and punctuation: 'Día 0: ¡RCE!' -> 'dia 0 rce'."""
    decomposed = unicodedata.normalize("NFKD", title)
    no_accents = "".join(c for c in decomposed if not unicodedata.combining(c))
    return _WS.sub(" ", _NON_WORD.sub(" ", no_accents.lower())).strip()


def struct_time_to_dt(value: time.struct_time | None) -> datetime | None:
    """feedparser returns UTC struct_time values."""
    if not value:
        return None
    try:
        return datetime(*value[:6], tzinfo=UTC)
    except (TypeError, ValueError):
        return None
