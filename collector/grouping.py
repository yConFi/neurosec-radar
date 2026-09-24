"""Group the same vulnerability covered by several outlets (and KEV/NVD) into one story.

CVEs are only known after the AI, so this runs when a result is saved, next to the
title-based dedup (which runs before the AI). Members keep status 'done' and all their
data; they only get duplicate_of = primary, so the web hides them from the feed and
lists them under «También en» of the primary.
"""

from __future__ import annotations

from datetime import datetime

MAX_CVES = 3  # digests / Patch Tuesday roundups mention many CVEs: never group those
STRUCTURED_KINDS = {"cisa_kev", "nvd"}  # one item per CVE, no story of their own


def groupable(article: dict) -> bool:
    return 1 <= len(article.get("cves") or []) <= MAX_CVES


def _sort_at(article: dict) -> datetime:
    return datetime.fromisoformat(article.get("published_at") or article["fetched_at"])


def plan_group(articles: list[dict], kinds: dict[str, str]) -> tuple[int, list[int]] | None:
    """(primary_id, member_ids) for a new result and the done articles sharing one of its CVEs.

    Primary: the most important news article (tie: the oldest). KEV/NVD items are never the
    primary while there is a news article in the group.
    """
    group = [a for a in articles if groupable(a)]
    if len(group) < 2:
        return None
    news = [a for a in group if kinds.get(a["source_id"]) not in STRUCTURED_KINDS]
    primary = min(news or group, key=lambda a: (-(a.get("importance") or 0), _sort_at(a), a["id"]))
    return primary["id"], sorted(a["id"] for a in group if a["id"] != primary["id"])
