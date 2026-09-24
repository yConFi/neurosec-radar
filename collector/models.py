"""Plain data containers shared across the pipeline."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from typing import Any


@dataclass
class RawItem:
    """A news item / paper / CVE entry as fetched, before it reaches the DB."""

    source_id: str
    url: str
    title: str
    lang: str
    content: str | None = None
    author: str | None = None
    published_at: datetime | None = None
    external_id: str | None = None
    image_url: str | None = None  # lead image offered by the feed itself
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class Vulnerability:
    """CVE facts. Fields left as None are not written, so KEV and NVD don't overwrite each other."""

    cve_id: str
    description: str | None = None
    vendor: str | None = None
    product: str | None = None
    cvss_score: float | None = None
    cvss_version: str | None = None
    cvss_severity: str | None = None
    has_public_exploit: bool | None = None
    in_kev: bool | None = None
    kev_date_added: date | None = None
    kev_due_date: date | None = None
    kev_ransomware: bool | None = None
    nvd_published_at: datetime | None = None
    nvd_last_modified_at: datetime | None = None

    def to_row(self) -> dict[str, Any]:
        row = {}
        for key, value in asdict(self).items():
            if value is None:
                continue
            row[key] = value.isoformat() if isinstance(value, (date, datetime)) else value
        return row


@dataclass
class FetchResult:
    """What a source fetcher returns."""

    items: list[RawItem] = field(default_factory=list)
    vulnerabilities: list[Vulnerability] = field(default_factory=list)
    etag: str | None = None
    last_modified: str | None = None
    not_modified: bool = False
    stats: dict[str, int] = field(default_factory=dict)
