"""CISA Known Exploited Vulnerabilities catalog (JSON)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any
from urllib.parse import quote

import httpx

from ..config import Source
from ..models import FetchResult, RawItem, Vulnerability
from . import http

KEV_CATALOG_URL = "https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext={cve}"
# After the first full sync, only re-upsert entries added in this window.
INCREMENTAL_DAYS = 30


def _date(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None


def parse_kev(data: dict, *, today: date, new_max_age_days: int, full_sync: bool):
    """Return (vulnerabilities to upsert, entries that count as 'new' for articles)."""
    vulns: list[Vulnerability] = []
    new_entries: list[dict] = []
    upsert_from = today - timedelta(days=INCREMENTAL_DAYS)
    new_from = today - timedelta(days=new_max_age_days)

    for entry in data.get("vulnerabilities", []):
        added = _date(entry.get("dateAdded"))
        if not full_sync and (added is None or added < upsert_from):
            continue
        vulns.append(
            Vulnerability(
                cve_id=entry["cveID"],
                description=entry.get("shortDescription"),
                vendor=entry.get("vendorProject"),
                product=entry.get("product"),
                in_kev=True,
                kev_date_added=added,
                kev_due_date=_date(entry.get("dueDate")),
                kev_ransomware=(entry.get("knownRansomwareCampaignUse") or "").lower() == "known",
            )
        )
        if added and added >= new_from:
            new_entries.append(entry)
    return vulns, new_entries


def fetch_kev(
    client: httpx.Client, source: Source, state: dict[str, Any], cfg: dict, now: datetime, *, full_sync: bool
) -> FetchResult:
    resp = http.get(client, source.url, etag=state.get("etag"), last_modified=state.get("last_modified"))
    result = FetchResult(etag=resp.headers.get("etag"), last_modified=resp.headers.get("last-modified"))
    if resp.status_code == 304:
        result.not_modified = True
        return result

    data = resp.json()
    result.vulnerabilities, new_entries = parse_kev(
        data,
        today=now.astimezone(UTC).date(),
        new_max_age_days=cfg["kev"]["new_max_age_days"],
        full_sync=full_sync,
    )
    for entry in new_entries:
        cve = entry["cveID"]
        body = " ".join(
            filter(None, [entry.get("shortDescription"), f"Required action: {entry.get('requiredAction', '')}".strip()])
        )
        result.items.append(
            RawItem(
                source_id=source.id,
                url=KEV_CATALOG_URL.format(cve=quote(cve)),
                title=f"CISA KEV: {cve} · {entry.get('vulnerabilityName', '').strip()}",
                lang=source.lang,
                content=body,
                published_at=datetime.combine(_date(entry["dateAdded"]), datetime.min.time(), UTC),
                external_id=cve,
                extra={
                    "vendor": entry.get("vendorProject"),
                    "product": entry.get("product"),
                    "ransomware": entry.get("knownRansomwareCampaignUse"),
                    "due_date": entry.get("dueDate"),
                    "cwes": entry.get("cwes", []),
                },
            )
        )
    result.stats = {
        "catalog_size": len(data.get("vulnerabilities", [])),
        "upserted": len(result.vulnerabilities),
        "new": len(new_entries),
        "full_sync": int(full_sync),
    }
    return result
