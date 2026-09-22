from datetime import UTC, date, datetime

import httpx

from collector.config import Source, settings
from collector.sources.kev import parse_kev
from collector.sources.nvd import best_cvss, parse_cve
from collector.sources.rss import arxiv_keywords, fetch_arxiv, fetch_rss, parse_arxiv_description

NOW = datetime(2026, 9, 23, 12, tzinfo=UTC)
CFG = settings()

RSS = """<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
<item><title>Old story</title><link>https://ex.com/old</link><pubDate>Mon, 01 Jun 2026 10:00:00 GMT</pubDate></item>
<item><title>Fresh &amp; hot</title><link>https://ex.com/new?utm_source=rss</link>
<pubDate>Tue, 22 Sep 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Body&lt;/p&gt;</description></item>
</channel></rss>"""

ARXIV = """<?xml version="1.0"?><rss version="2.0"><channel><title>cs.CR</title>
<item><title>Prompt Injection Attacks on LLM Agents</title><link>https://arxiv.org/abs/2609.00001</link>
<description>arXiv:2609.00001v1 Announce Type: new
Abstract: We study prompt injection.</description><pubDate>Tue, 22 Sep 2026 00:00:00 -0400</pubDate></item>
<item><title>Lattice crypto speedups</title><link>https://arxiv.org/abs/2609.00002</link>
<description>arXiv:2609.00002v1 Announce Type: new
Abstract: Faster NTT.</description><pubDate>Tue, 22 Sep 2026 00:00:00 -0400</pubDate></item>
<item><title>LLM jailbreak survey v2</title><link>https://arxiv.org/abs/2601.00003</link>
<description>arXiv:2601.00003v2 Announce Type: replace
Abstract: Updated.</description><pubDate>Tue, 22 Sep 2026 00:00:00 -0400</pubDate></item>
</channel></rss>"""


def _client(body: str, status: int = 200) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(status, text=body)))


def _source(kind="rss", url="https://ex.com/feed") -> Source:
    return Source(id="ex", name="Example", kind=kind, url=url, lang="en")


def test_fetch_rss_skips_old_items_and_canonicalises():
    result = fetch_rss(_client(RSS), _source(), {}, CFG, NOW)
    assert [i.title for i in result.items] == ["Fresh & hot"]
    assert result.items[0].url == "https://ex.com/new"
    assert result.items[0].content == "Body"
    assert result.stats["too_old"] == 1


def test_fetch_rss_not_modified():
    result = fetch_rss(_client("", status=304), _source(), {"etag": '"abc"'}, CFG, NOW)
    assert result.not_modified and result.items == []


def test_parse_arxiv_description():
    arxiv_id, kind, abstract = parse_arxiv_description("arXiv:2609.00001v1 Announce Type: new \nAbstract: Hello")
    assert (arxiv_id, kind, abstract) == ("2609.00001", "new", "Hello")


def test_fetch_arxiv_keeps_only_new_with_keywords():
    source = _source(kind="arxiv", url="https://rss.arxiv.org/rss/cs.CR")
    assert arxiv_keywords(CFG, source.url) is not None
    result = fetch_arxiv(_client(ARXIV), source, {}, CFG, NOW)
    assert [i.external_id for i in result.items] == ["2609.00001"]
    assert result.stats == {"entries": 3, "not_new": 1, "no_keyword": 1, "kept": 1}


def test_parse_kev_incremental_and_new_window():
    data = {
        "vulnerabilities": [
            {"cveID": "CVE-2026-1111", "dateAdded": "2026-09-22", "knownRansomwareCampaignUse": "Known",
             "vendorProject": "Acme", "product": "Gate"},
            {"cveID": "CVE-2026-2222", "dateAdded": "2026-09-01"},
            {"cveID": "CVE-2021-3333", "dateAdded": "2021-11-03"},
        ]
    }
    vulns, new = parse_kev(data, today=date(2026, 9, 23), new_max_age_days=2, full_sync=False)
    assert [v.cve_id for v in vulns] == ["CVE-2026-1111", "CVE-2026-2222"]  # 2021 skipped (not full sync)
    assert [e["cveID"] for e in new] == ["CVE-2026-1111"]
    assert vulns[0].kev_ransomware is True and vulns[0].in_kev is True

    vulns, _ = parse_kev(data, today=date(2026, 9, 23), new_max_age_days=2, full_sync=True)
    assert len(vulns) == 3


def _nvd(cve_id="CVE-2026-5555", status="Analyzed", tags=(), kev=None, metrics=None):
    cve = {
        "id": cve_id, "vulnStatus": status, "published": "2026-09-20T10:00:00.000",
        "lastModified": "2026-09-22T10:00:00.000",
        "descriptions": [{"lang": "es", "value": "x"}, {"lang": "en", "value": "RCE in Foo"}],
        "metrics": metrics or {},
        "references": [{"url": "https://x", "tags": list(tags)}],
    }
    if kev:
        cve["cisaExploitAdd"] = kev
    return {"cve": cve}


def test_best_cvss_prefers_primary_max():
    metrics = {
        "cvssMetricV31": [
            {"type": "Secondary", "cvssData": {"baseScore": 10.0, "baseSeverity": "CRITICAL"}},
            {"type": "Primary", "cvssData": {"baseScore": 9.1, "baseSeverity": "CRITICAL"}},
        ],
        "cvssMetricV40": [{"type": "Primary", "cvssData": {"baseScore": 9.3, "baseSeverity": "CRITICAL"}}],
    }
    assert best_cvss(metrics) == (9.3, "4.0", "CRITICAL")
    assert best_cvss({}) == (None, None, None)


def test_parse_cve_fields():
    v = parse_cve(_nvd(tags=["Exploit", "Third Party Advisory"], kev="2026-09-21"))
    assert v.description == "RCE in Foo"
    assert v.has_public_exploit is True
    assert v.in_kev is True and v.kev_date_added == date(2026, 9, 21)
    assert v.nvd_published_at.tzinfo is not None
    assert parse_cve(_nvd(status="Rejected")) is None
    # Without cisaExploitAdd, NVD must not write in_kev at all (None -> column untouched)
    assert parse_cve(_nvd()).to_row().get("in_kev") is None
