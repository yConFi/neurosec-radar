"""Generic RSS/Atom sources (news sites, blogs) and arXiv listings."""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any

import feedparser
import httpx

from ..config import Source
from ..models import FetchResult, RawItem
from ..normalize import canonical_url, html_to_text, https_url, struct_time_to_dt, truncate
from . import http

_IMG_SRC = re.compile(r"""<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']""", re.I)


def fetch_feed(client: httpx.Client, source: Source, state: dict[str, Any]):
    """Return (parsed_feed | None, FetchResult with cache headers)."""
    resp = http.get(client, source.url, etag=state.get("etag"), last_modified=state.get("last_modified"))
    result = FetchResult(etag=resp.headers.get("etag"), last_modified=resp.headers.get("last-modified"))
    if resp.status_code == 304:
        result.not_modified = True
        return None, result
    feed = feedparser.parse(resp.content)
    if feed.bozo and not feed.entries:
        raise ValueError(f"Unparseable feed: {feed.get('bozo_exception')!r}")
    return feed, result


def _entry_date(entry) -> datetime | None:
    return struct_time_to_dt(entry.get("published_parsed") or entry.get("updated_parsed"))


def _entry_text(entry) -> str:
    # Atom <content> usually holds the full post; RSS <description> a teaser.
    if entry.get("content"):
        return html_to_text(entry["content"][0].get("value"))
    return html_to_text(entry.get("summary"))


def _is_image(media: dict) -> bool:
    kind = media.get("medium") or media.get("type") or "image"  # untyped media is usually an image
    return kind == "image" or kind.startswith("image/")


def entry_image(entry) -> str | None:
    """Lead image the feed itself offers: Media RSS, image enclosure or first <img> in the HTML."""
    candidates = [m.get("url") for m in entry.get("media_content", []) if _is_image(m)]
    candidates += [m.get("url") for m in entry.get("media_thumbnail", [])]
    candidates += [e.get("href") for e in entry.get("enclosures", []) if e.get("type", "").startswith("image/")]
    for html in [c.get("value", "") for c in entry.get("content", [])] + [entry.get("summary", "")]:
        candidates += _IMG_SRC.findall(html or "")
    return next((url for url in map(https_url, candidates) if url), None)


def fetch_rss(client: httpx.Client, source: Source, state: dict[str, Any], cfg: dict, now: datetime) -> FetchResult:
    feed, result = fetch_feed(client, source, state)
    if feed is None:
        return result

    c = cfg["collector"]
    cutoff = now - timedelta(days=c["max_age_days"])
    # Some feeds (e.g. OpenAI) list their whole archive: newest first, then cap.
    entries = sorted(feed.entries, key=lambda e: _entry_date(e) or now, reverse=True)
    too_old = 0
    for entry in entries[: c["max_items_per_source"]]:
        link, title = entry.get("link"), html_to_text(entry.get("title"))
        if not link or not title:
            continue
        published = _entry_date(entry)
        if published and published < cutoff:
            too_old += 1
            continue
        result.items.append(
            RawItem(
                source_id=source.id,
                url=canonical_url(link),
                title=title,
                lang=source.lang,
                content=truncate(_entry_text(entry), c["max_content_chars"]) or None,
                author=entry.get("author"),
                published_at=published,
                image_url=entry_image(entry),
            )
        )
    result.stats = {"entries": len(feed.entries), "kept": len(result.items), "too_old": too_old}
    return result


# arXiv RSS descriptions look like: "arXiv:2509.12345v1 Announce Type: new \nAbstract: ..."
_ARXIV_HEADER = re.compile(r"^arXiv:(?P<id>[\w.\-/]+?)(v\d+)?\s+Announce Type:\s*(?P<type>[\w-]+)\s*", re.I)


def parse_arxiv_description(description: str) -> tuple[str | None, str | None, str]:
    """Return (arxiv_id, announce_type, abstract)."""
    text = html_to_text(description)
    match = _ARXIV_HEADER.match(text)
    if not match:
        return None, None, text
    abstract = text[match.end():].removeprefix("Abstract:").strip()
    return match.group("id"), match.group("type").lower(), abstract


def arxiv_keywords(cfg: dict, source_url: str) -> re.Pattern | None:
    category = source_url.rstrip("/").rsplit("/", 1)[-1]  # ".../rss/cs.CR" -> "cs.CR"
    terms = cfg.get("arxiv", {}).get(category)
    return re.compile("|".join(f"(?:{t})" for t in terms), re.I) if terms else None


def fetch_arxiv(client: httpx.Client, source: Source, state: dict[str, Any], cfg: dict, now: datetime) -> FetchResult:
    feed, result = fetch_feed(client, source, state)
    if feed is None:
        return result

    keywords = arxiv_keywords(cfg, source.url)
    counts = {"entries": len(feed.entries), "not_new": 0, "no_keyword": 0}
    for entry in feed.entries:
        arxiv_id, announce_type, abstract = parse_arxiv_description(entry.get("summary", ""))
        if announce_type != "new":  # skip cross-lists and replacements
            counts["not_new"] += 1
            continue
        title = html_to_text(entry.get("title"))
        if keywords and not keywords.search(f"{title} {abstract}"):
            counts["no_keyword"] += 1
            continue
        result.items.append(
            RawItem(
                source_id=source.id,
                url=canonical_url(entry.get("link") or f"https://arxiv.org/abs/{arxiv_id}"),
                title=title,
                lang=source.lang,
                content=truncate(abstract, cfg["collector"]["max_content_chars"]),
                author=entry.get("author"),
                published_at=_entry_date(entry),
                external_id=arxiv_id,
            )
        )
    result.stats = counts | {"kept": len(result.items)}
    return result
