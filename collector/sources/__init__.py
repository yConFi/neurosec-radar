"""Dispatch a configured source to its fetcher."""

from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from ..config import Source
from ..models import FetchResult
from .kev import fetch_kev
from .nvd import fetch_nvd
from .rss import fetch_arxiv, fetch_rss


def fetch_source(
    client: httpx.Client,
    source: Source,
    state: dict[str, Any],
    cfg: dict,
    now: datetime,
    *,
    kev_full_sync: bool = False,
    nvd_api_key: str | None = None,
) -> FetchResult:
    match source.kind:
        case "rss":
            return fetch_rss(client, source, state, cfg, now)
        case "arxiv":
            return fetch_arxiv(client, source, state, cfg, now)
        case "cisa_kev":
            return fetch_kev(client, source, state, cfg, now, full_sync=kev_full_sync)
        case "nvd":
            return fetch_nvd(client, source, state, cfg, now, api_key=nvd_api_key)
    raise ValueError(f"Unknown source kind: {source.kind}")
