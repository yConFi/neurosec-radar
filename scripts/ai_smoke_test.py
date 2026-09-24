"""Temporary smoke test: re-run the current prompt on known articles and print the urgency decision.

Read-only on Supabase (nothing is written). Uses the plain Messages API (not Batches) so the
result arrives in minutes. The page text was dropped after processing, so it is downloaded again
exactly like the collector does.
"""

from __future__ import annotations

import sys

import anthropic

from collector import ai, page
from collector.config import load_sources, settings
from collector.db import DB

IDS = [587, 507, 15, 2, 5, 1035, 6649, 20, 27, 506, 33, 1626, 511, 512, 189, 1001]


def main() -> int:
    cfg = settings()
    sources = {s.id: s for s in load_sources()}
    db = DB()
    rows = (
        db.table("articles")
        .select("id,source_id,url,title,content,lang,published_at,extra,image_url,is_urgent,urgent_reason")
        .in_("id", IDS).execute().data
    )
    articles = {r["id"]: r for r in rows}
    rss = [a for a in articles.values() if sources.get(a["source_id"]) and sources[a["source_id"]].kind == "rss"]
    for aid, update in page.enrich(rss, cfg).items():
        articles[aid] |= {"body": update.get("body"), "image_candidates": update.get("image_candidates", [])}

    client = anthropic.Anthropic()
    results: dict[int, ai.AIResult] = {}
    usage = [0, 0]
    for aid in IDS:
        a = articles.get(aid)
        if not a:
            print(f"#{aid}: not found")
            continue
        params = ai.build_request(a, sources.get(a["source_id"]), cfg)["params"]
        msg = client.messages.create(**params)
        usage[0] += msg.usage.input_tokens
        usage[1] += msg.usage.output_tokens
        if msg.stop_reason != "end_turn":
            print(f"#{aid}: stop_reason={msg.stop_reason}")
            continue
        results[aid] = ai.parse_message_text(next(b.text for b in msg.content if b.type == "text"))

    kev = db.kev_cves([c for r in results.values() for c in r.cves])
    for aid, r in results.items():
        a = articles[aid]
        facts = (r.exploitation, r.widely_deployed, r.action_es, r.is_roundup, r.affected_product)
        row = r.to_row(a.get("image_candidates") or [], allow_detail=ai.detail_allowed(a),
                       in_kev=bool(kev.intersection(r.cves)))
        print(f"\n#{aid} [{a['source_id']}] {a['title'][:100]}")
        print(f"  text: {len(ai.source_text(a))} chars · importance {r.importance} · cves {r.cves} · "
              f"KEV {sorted(kev.intersection(r.cves))}")
        print(f"  model: product={facts[4]!r} exploitation={facts[0]} widely_deployed={facts[1]} is_roundup={facts[3]}")
        print(f"  action_es: {facts[2]!r}")
        print(f"  urgent: before={a['is_urgent']} -> now={row['is_urgent']}")
    print(f"\nTokens: input {usage[0]}, output {usage[1]} (model {cfg['ai']['model']}, Messages API)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
