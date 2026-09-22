"""NVD CVE API 2.0 — critical CVEs only.

Verified against https://nvd.nist.gov/developers (2026-09-23):
- cvssV3Severity and cvssV4Severity cannot be combined -> two queries.
- Date ranges max 120 days. Public rate limit 5 req / rolling 30 s (50 with an
  API key, sent as the `apiKey` header); NIST asks clients to sleep between calls.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from ..config import Source
from ..models import FetchResult, RawItem, Vulnerability
from ..normalize import truncate
from . import http

SEVERITY_PARAMS = ("cvssV3Severity", "cvssV4Severity")
METRIC_KEYS = (("cvssMetricV40", "4.0"), ("cvssMetricV31", "3.1"), ("cvssMetricV30", "3.0"))
MAX_RANGE = timedelta(days=119)


def _nvd_ts(dt: datetime) -> str:
    # No offset -> NVD interprets it as GMT.
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000")


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    dt = datetime.fromisoformat(value)
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def best_cvss(metrics: dict) -> tuple[float | None, str | None, str | None]:
    """Highest base score among 'Primary' metrics (fallback: any source)."""
    candidates: list[tuple[bool, float, str, str]] = []
    for key, version in METRIC_KEYS:
        for metric in metrics.get(key, []):
            data = metric.get("cvssData", {})
            if "baseScore" in data:
                candidates.append(
                    (metric.get("type") == "Primary", float(data["baseScore"]), version, data.get("baseSeverity"))
                )
    if not candidates:
        return None, None, None
    primary = [c for c in candidates if c[0]] or candidates
    _, score, version, severity = max(primary, key=lambda c: c[1])
    return score, version, severity


def parse_cve(raw: dict) -> Vulnerability | None:
    cve = raw["cve"]
    if cve.get("vulnStatus") == "Rejected":
        return None
    description = next((d["value"] for d in cve.get("descriptions", []) if d.get("lang") == "en"), None)
    score, version, severity = best_cvss(cve.get("metrics", {}))
    kev_added = cve.get("cisaExploitAdd")
    return Vulnerability(
        cve_id=cve["id"],
        description=description,
        cvss_score=score,
        cvss_version=version,
        cvss_severity=severity,
        has_public_exploit=any("Exploit" in ref.get("tags", []) for ref in cve.get("references", [])),
        in_kev=True if kev_added else None,  # never flip KEV data back to False from NVD
        kev_date_added=datetime.fromisoformat(kev_added).date() if kev_added else None,
        nvd_published_at=_parse_ts(cve.get("published")),
        nvd_last_modified_at=_parse_ts(cve.get("lastModified")),
    )


def fetch_nvd(
    client: httpx.Client, source: Source, state: dict[str, Any], cfg: dict, now: datetime, *, api_key: str | None
) -> FetchResult:
    ncfg = cfg["nvd"]
    last_ok = state.get("last_success_at")
    if last_ok:
        start = _parse_ts(last_ok) - timedelta(minutes=ncfg["overlap_minutes"])
    else:
        start = now - timedelta(hours=ncfg["first_run_lookback_hours"])
    start = max(start, now - MAX_RANGE)
    headers = {"apiKey": api_key} if api_key else None

    found: dict[str, Vulnerability] = {}
    requests = 0
    for severity_param in SEVERITY_PARAMS:
        start_index = 0
        while True:
            if requests:
                time.sleep(ncfg["sleep_between_requests_s"])
            params = {
                severity_param: "CRITICAL",
                "lastModStartDate": _nvd_ts(start),
                "lastModEndDate": _nvd_ts(now),
                "startIndex": start_index,
            }
            data = http.get(client, source.url, params=params, headers=headers).json()
            requests += 1
            for raw in data.get("vulnerabilities", []):
                vuln = parse_cve(raw)
                if vuln:
                    found[vuln.cve_id] = vuln
            start_index += data.get("resultsPerPage", 0)
            if not data.get("resultsPerPage") or start_index >= data.get("totalResults", 0):
                break

    result = FetchResult(vulnerabilities=list(found.values()))
    max_age = now - timedelta(days=ncfg["article_max_age_days"])
    for vuln in result.vulnerabilities:
        # Only recently *published* CVEs become articles; old ones re-modified are just facts.
        if not vuln.nvd_published_at or vuln.nvd_published_at < max_age:
            continue
        short = truncate(vuln.description or "", 140)
        result.items.append(
            RawItem(
                source_id=source.id,
                url=f"https://nvd.nist.gov/vuln/detail/{vuln.cve_id}",
                title=f"{vuln.cve_id} · CVSS {vuln.cvss_score} · {short}",
                lang=source.lang,
                content=vuln.description,
                published_at=vuln.nvd_published_at,
                external_id=vuln.cve_id,
                extra={
                    "cvss_score": vuln.cvss_score,
                    "cvss_version": vuln.cvss_version,
                    "has_public_exploit": vuln.has_public_exploit,
                    "in_kev": bool(vuln.in_kev),
                },
            )
        )
    result.stats = {"requests": requests, "critical_modified": len(found), "new_articles": len(result.items)}
    return result
