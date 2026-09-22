from datetime import UTC, datetime
import time

from collector.normalize import canonical_url, html_to_text, normalize_title, struct_time_to_dt, truncate


def test_canonical_url_drops_tracking_and_fragment_but_keeps_host():
    url = "HTTPS://WWW.Example.com/news/story/?utm_source=rss&id=7&fbclid=x#comments"
    assert canonical_url(url) == "https://www.example.com/news/story?id=7"


def test_canonical_url_keeps_root_slash():
    assert canonical_url("https://example.com/") == "https://example.com/"


def test_html_to_text_strips_tags_scripts_and_entities():
    raw = "<p>Patch <b>now</b>&nbsp;&amp; reboot</p><script>alert(1)</script><p>Done</p>"
    assert html_to_text(raw) == "Patch now & reboot Done"


def test_normalize_title_removes_accents_and_punctuation():
    assert normalize_title("  Día 0: ¡RCE en Exchange!  ") == "dia 0 rce en exchange"


def test_truncate_cuts_on_word_boundary():
    assert truncate("alpha beta gamma", 12) == "alpha beta …"
    assert truncate("short", 12) == "short"


def test_struct_time_to_dt_is_utc():
    assert struct_time_to_dt(time.struct_time((2026, 9, 22, 10, 0, 0, 0, 265, 0))) == datetime(
        2026, 9, 22, 10, tzinfo=UTC
    )
    assert struct_time_to_dt(None) is None
