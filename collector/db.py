"""Supabase (PostgREST) data access. Uses the *secret* key, so RLS is bypassed:
this module must only ever run on the backend (GitHub Actions / local)."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any, Iterable

from supabase import Client, create_client

from .config import Source, env
from .models import RawItem, Vulnerability

CHUNK = 500  # rows per request, keeps payloads well under PostgREST limits


def _chunks(rows: list, size: int = CHUNK) -> Iterable[list]:
    for i in range(0, len(rows), size):
        yield rows[i : i + size]


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


class DB:
    def __init__(self, client: Client | None = None) -> None:
        self.client = client or create_client(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"))

    def table(self, name: str):
        return self.client.table(name)

    # ------------------------------------------------------------- sources
    def sync_sources(self, sources: list[Source]) -> None:
        rows = [
            {
                "id": s.id, "name": s.name, "kind": s.kind, "url": s.url,
                "lang": s.lang, "category_hint": s.category_hint, "enabled": s.enabled,
            }
            for s in sources
        ]
        self.table("sources").upsert(rows, on_conflict="id", returning="minimal").execute()

    def source_states(self) -> dict[str, dict[str, Any]]:
        rows = self.table("sources").select("id,etag,last_modified,last_success_at,consecutive_failures").execute().data
        return {r["id"]: r for r in rows}

    def source_ok(self, source_id: str, etag: str | None, last_modified: str | None, now: datetime) -> None:
        self.table("sources").update(
            {"etag": etag, "last_modified": last_modified, "last_success_at": now.isoformat(),
             "last_error": None, "consecutive_failures": 0}
        ).eq("id", source_id).execute()

    def source_failed(self, source_id: str, error: str, failures: int, now: datetime) -> None:
        self.table("sources").update(
            {"last_error": error[:1000], "last_error_at": now.isoformat(), "consecutive_failures": failures}
        ).eq("id", source_id).execute()

    # ------------------------------------------------------------ articles
    def insert_articles(self, items: list[RawItem], title_norm) -> list[dict]:
        """INSERT ... ON CONFLICT (url) DO NOTHING. Returns only the rows actually inserted."""
        rows = [
            {
                "source_id": it.source_id, "url": it.url, "title": it.title[:1000],
                "title_norm": title_norm(it.title), "content": it.content, "author": it.author,
                "lang": it.lang, "published_at": _iso(it.published_at), "external_id": it.external_id,
                "image_url": it.image_url, "extra": it.extra,
            }
            for it in items
        ]
        inserted: list[dict] = []
        for chunk in _chunks(rows):
            res = self.table("articles").upsert(chunk, on_conflict="url", ignore_duplicates=True).execute()
            inserted.extend(res.data)
        return inserted

    def recent_titles(self, since: datetime, exclude_ids: set[int]) -> list[tuple[int, str]]:
        rows = (
            self.table("articles").select("id,title_norm")
            .gte("fetched_at", since.isoformat()).is_("duplicate_of", "null")
            .order("id").limit(10_000).execute().data
        )
        return [(r["id"], r["title_norm"]) for r in rows if r["id"] not in exclude_ids]

    def mark_duplicates(self, duplicates: dict[int, int]) -> None:
        for dup_id, original_id in duplicates.items():
            self.table("articles").update({"status": "duplicate", "duplicate_of": original_id}).eq("id", dup_id).execute()

    def save_pages(self, pages: dict[int, dict]) -> None:
        for article_id, update in pages.items():
            self.table("articles").update(update).eq("id", article_id).execute()

    def pending_articles(self, limit: int) -> list[dict]:
        return (
            self.table("articles")
            .select("id,source_id,title,content,body,lang,published_at,attempts,extra")
            .eq("status", "pending").order("id").limit(limit).execute().data
        )

    def articles_by_ids(self, ids: list[int]) -> list[dict]:
        out: list[dict] = []
        for chunk in _chunks(ids, 200):
            out.extend(self.table("articles").select("id,title,source_id,attempts").in_("id", chunk).execute().data)
        return out

    def ai_inputs(self, ids: list[int]) -> dict[int, dict]:
        """What the AI saw (still stored until its result is saved): text + image candidates."""
        out: dict[int, dict] = {}
        for chunk in _chunks(ids, 200):
            rows = self.table("articles").select("id,content,body,image_candidates").in_("id", chunk).execute().data
            out.update({r["id"]: r for r in rows})
        return out

    def mark_queued(self, ids: list[int], batch_id: str) -> None:
        for chunk in _chunks(ids, 200):
            self.table("articles").update({"status": "queued", "batch_id": batch_id}).in_("id", chunk).execute()

    # Page text and image candidates were only needed by the AI: drop them to save space.
    _TRANSIENT = {"body": None, "image_candidates": []}

    def save_ai_result(self, article_id: int, row: dict, model: str, now: datetime) -> None:
        self.table("articles").update(
            row | self._TRANSIENT | {"status": "done", "model": model, "processed_at": now.isoformat(), "last_error": None}
        ).eq("id", article_id).execute()

    def ai_failed(self, article_id: int, error: str, attempts: int, max_attempts: int) -> None:
        status = "failed" if attempts >= max_attempts else "pending"
        update = {"status": status, "attempts": attempts, "last_error": error[:1000], "batch_id": None}
        if status == "failed":  # no more retries
            update |= self._TRANSIENT
        self.table("articles").update(update).eq("id", article_id).execute()

    # ---------------------------------------------------------- AI batches
    def create_batch(self, batch_id: str, model: str, request_count: int) -> None:
        self.table("ai_batches").insert({"id": batch_id, "model": model, "request_count": request_count}).execute()

    def open_batches(self) -> list[dict]:
        return self.table("ai_batches").select("id,model").eq("status", "in_progress").order("created_at").execute().data

    def close_batch(self, batch_id: str, stats: dict[str, Any], now: datetime, status: str = "collected") -> None:
        self.table("ai_batches").update(stats | {"status": status, "collected_at": now.isoformat()}).eq("id", batch_id).execute()

    # ----------------------------------------------------- vulnerabilities
    def kev_seeded(self) -> bool:
        res = self.table("vulnerabilities").select("cve_id").eq("in_kev", True).limit(1).execute()
        return bool(res.data)

    def kev_cves(self, cves: list[str]) -> set[str]:
        """The subset of `cves` listed in CISA KEV."""
        out: set[str] = set()
        for chunk in _chunks(sorted(set(cves)), 200):
            rows = self.table("vulnerabilities").select("cve_id").in_("cve_id", chunk).eq("in_kev", True).execute().data
            out.update(r["cve_id"] for r in rows)
        return out

    def upsert_vulnerabilities(self, vulns: list[Vulnerability]) -> None:
        # PostgREST bulk upserts write the *union* of keys and fill the gaps with
        # NULL/DEFAULT, which would e.g. reset in_kev=true to false. So group rows
        # by their exact column set and upsert each group on its own.
        groups: dict[tuple[str, ...], list[dict]] = defaultdict(list)
        for v in vulns:
            row = v.to_row()
            groups[tuple(sorted(row))].append(row)
        for rows in groups.values():
            for chunk in _chunks(rows):
                self.table("vulnerabilities").upsert(chunk, on_conflict="cve_id", returning="minimal").execute()

    # ---------------------------------------------------------------- runs
    def start_run(self, now: datetime) -> int:
        return self.table("collector_runs").insert({"started_at": now.isoformat()}).execute().data[0]["id"]

    def finish_run(self, run_id: int, ok: bool, stats: dict, errors: list, now: datetime) -> None:
        self.table("collector_runs").update(
            {"finished_at": now.isoformat(), "ok": ok, "stats": stats, "errors": errors}
        ).eq("id", run_id).execute()

