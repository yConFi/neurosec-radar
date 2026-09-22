"""Shared HTTP helpers: conditional GET + small retry for transient errors."""

from __future__ import annotations

import logging
import time

import httpx

log = logging.getLogger(__name__)

RETRY_STATUS = {429, 500, 502, 503, 504}


def make_client(user_agent: str, timeout_s: float) -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": user_agent},
        timeout=timeout_s,
        follow_redirects=True,
        http2=False,
    )


def get(
    client: httpx.Client,
    url: str,
    *,
    params: dict | None = None,
    headers: dict | None = None,
    etag: str | None = None,
    last_modified: str | None = None,
    retries: int = 2,
    backoff_s: float = 6.0,
) -> httpx.Response:
    """GET with If-None-Match / If-Modified-Since. Returns 304 responses as-is."""
    req_headers = dict(headers or {})
    if etag:
        req_headers["If-None-Match"] = etag
    if last_modified:
        req_headers["If-Modified-Since"] = last_modified

    for attempt in range(retries + 1):
        try:
            resp = client.get(url, params=params, headers=req_headers)
        except httpx.TransportError as exc:
            if attempt == retries:
                raise
            log.warning("GET %s failed (%s), retrying", url, exc)
        else:
            if resp.status_code not in RETRY_STATUS or attempt == retries:
                if resp.status_code != 304:
                    resp.raise_for_status()
                return resp
            log.warning("GET %s -> %s, retrying", url, resp.status_code)
        time.sleep(backoff_s * (attempt + 1))
    raise AssertionError("unreachable")
