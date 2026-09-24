"""One collector run (executed every 30 min by GitHub Actions).

Order matters:
  1. collect finished AI batches (results reach the DB as early as possible)
  2. fetch every source concurrently
  3. insert articles (UNIQUE url) + mark near-duplicate titles
     + download the page of each new RSS article (full text for the AI, image)
  4. upsert CVE facts (KEV + NVD)
  5. submit a new AI batch with the pending articles
  6. save source health + HTTP cache headers (only now: if anything above
     failed, the next run re-downloads instead of getting a 304 and losing items)
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any

import anthropic

from . import ai, page
from .config import Source, env, load_sources, settings
from .db import DB
from .dedup import find_duplicates
from .models import FetchResult
from .normalize import normalize_title
from .sources import fetch_source
from .sources.http import make_client

log = logging.getLogger(__name__)

NO_TITLE_DEDUP_KINDS = {"cisa_kev", "nvd"}  # structured titles, one per CVE


def fetch_all(
    sources: list[Source], states: dict[str, dict], cfg: dict, now: datetime, *, kev_full_sync: bool
) -> dict[str, FetchResult | Exception]:
    c = cfg["collector"]
    nvd_api_key = env("NVD_API_KEY", required=False)

    def one(source: Source) -> FetchResult | Exception:
        state = dict(states.get(source.id, {}))
        if source.kind == "cisa_kev" and kev_full_sync:
            state.pop("etag", None), state.pop("last_modified", None)  # force a full download
        try:
            with make_client(c["user_agent"], c["http_timeout_s"]) as client:
                return fetch_source(
                    client, source, state, cfg, now, kev_full_sync=kev_full_sync, nvd_api_key=nvd_api_key
                )
        except Exception as exc:  # one broken feed must not stop the others
            log.warning("Source %s failed: %s", source.id, exc)
            return exc

    with ThreadPoolExecutor(max_workers=8) as pool:
        return dict(zip((s.id for s in sources), pool.map(one, sources)))


def collect_finished_batches(db: DB, client: anthropic.Anthropic, cfg: dict, now: datetime) -> dict:
    stats = {"batches": 0, "done": 0, "failed": 0}
    for batch in db.open_batches():
        outcome = ai.collect_batch(client, batch["id"])
        if not outcome.ended:
            continue
        stats["batches"] += 1
        inputs = db.ai_inputs(list(outcome.results))
        in_kev = db.kev_cves([c for r in outcome.results.values() for c in r.cves])
        for article_id, result in outcome.results.items():
            seen = inputs.get(article_id, {})
            row = result.to_row(
                seen.get("image_candidates") or [],
                allow_detail=ai.detail_allowed(seen),
                in_kev=bool(in_kev.intersection(result.cves)),  # CISA KEV beats the model's reading
            )
            # articles.highlight ('major' / 'top') is derived by Postgres from importance
            db.save_ai_result(article_id, row, batch["model"], now)
            stats["done"] += 1
        if outcome.failures:
            attempts = {a["id"]: a["attempts"] for a in db.articles_by_ids(list(outcome.failures))}
            for article_id, error in outcome.failures.items():
                db.ai_failed(article_id, error, attempts.get(article_id, 0) + 1, cfg["ai"]["max_attempts"])
                stats["failed"] += 1
        db.close_batch(batch["id"], outcome.stats, now)
    return stats


def run(*, dry_run: bool = False, skip_ai: bool = False) -> int:
    cfg = settings()
    now = datetime.now(UTC)
    all_sources = load_sources()
    sources = [s for s in all_sources if s.enabled]
    sources_by_id = {s.id: s for s in all_sources}
    stats: dict[str, Any] = {}
    errors: list[dict] = []

    if dry_run:
        results = fetch_all(sources, {}, cfg, now, kev_full_sync=False)
        _print_dry_run(results)
        return 0

    db = DB()
    run_id = db.start_run(now)
    ok = False
    try:
        db.sync_sources(all_sources)
        states = db.source_states()
        claude = None if skip_ai else anthropic.Anthropic()  # reads ANTHROPIC_API_KEY

        # 1. AI results from previous runs
        if claude:
            stats["ai_collect"] = collect_finished_batches(db, claude, cfg, now)

        # 2. fetch
        results = fetch_all(sources, states, cfg, now, kev_full_sync=not db.kev_seeded())
        fetched = {sid: r for sid, r in results.items() if isinstance(r, FetchResult)}
        items = [it for r in fetched.values() for it in r.items]
        vulns = [v for r in fetched.values() for v in r.vulnerabilities]
        stats["sources"] = {sid: r.stats | {"not_modified": r.not_modified} for sid, r in fetched.items()}

        # 3. articles + near-duplicate titles
        inserted = db.insert_articles(items, normalize_title)
        kind_of = {s.id: s.kind for s in all_sources}
        dedupable = [(r["id"], r["title_norm"]) for r in inserted if kind_of[r["source_id"]] not in NO_TITLE_DEDUP_KINDS]
        d = cfg["dedup"]
        existing = db.recent_titles(now - timedelta(days=d["window_days"]), exclude_ids={i for i, _ in dedupable})
        duplicates = find_duplicates(dedupable, existing, threshold=d["title_similarity"], min_len=d["min_title_len"])
        db.mark_duplicates(duplicates)
        stats["articles"] = {"fetched": len(items), "inserted": len(inserted), "duplicates": len(duplicates)}

        # 3b. full page text + image for the new RSS articles (feeds mostly carry a teaser)
        to_enrich = [r for r in inserted if kind_of[r["source_id"]] == "rss" and r["id"] not in duplicates]
        pages = page.enrich(to_enrich, cfg)
        db.save_pages(pages)
        stats["pages"] = {
            "tried": len(to_enrich),
            "body": sum("body" in u for u in pages.values()),
            "image": sum(bool(u.get("image_url")) for u in pages.values()),
        }

        # 4. CVE facts (shown next to articles and used by the CVE filter)
        db.upsert_vulnerabilities(vulns)
        stats["vulnerabilities"] = {"upserted": len(vulns)}

        # 5. new AI batch
        if claude:
            pending = db.pending_articles(cfg["ai"]["max_per_batch"])
            if pending:
                batch_id = ai.submit_batch(claude, pending, sources_by_id, cfg)
                db.create_batch(batch_id, cfg["ai"]["model"], len(pending))
                db.mark_queued([a["id"] for a in pending], batch_id)
            stats["ai_submitted"] = len(pending)

        # 6. source health (after everything above succeeded)
        for sid, res in results.items():
            if isinstance(res, Exception):
                failures = (states.get(sid) or {}).get("consecutive_failures", 0) + 1
                db.source_failed(sid, f"{type(res).__name__}: {res}", failures, now)
                errors.append({"step": "fetch", "source": sid, "error": f"{type(res).__name__}: {res}"[:500]})
            else:
                db.source_ok(sid, res.etag, res.last_modified, now)
        ok = True
    except Exception as exc:
        log.exception("Run failed")
        errors.append({"step": "run", "error": repr(exc)[:1000]})
    finally:
        db.finish_run(run_id, ok, stats, errors, datetime.now(UTC))

    log.info("Run %s finished ok=%s stats=%s errors=%d", run_id, ok, stats, len(errors))
    return 0 if ok else 1


def _print_dry_run(results: dict[str, FetchResult | Exception]) -> None:
    total_items = total_vulns = 0
    for sid, res in results.items():
        if isinstance(res, Exception):
            print(f"  ✗ {sid:22} {type(res).__name__}: {res}")
            continue
        total_items += len(res.items)
        total_vulns += len(res.vulnerabilities)
        print(f"  ✓ {sid:22} items={len(res.items):3}  vulns={len(res.vulnerabilities):5}  {res.stats}")
    print(f"\nTotal: {total_items} items, {total_vulns} vulnerabilities (dry run: nothing written, no AI calls)")
