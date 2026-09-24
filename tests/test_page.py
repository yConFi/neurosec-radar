import httpx
import pytest

from collector.page import download, extract, is_junk_image, pick_image

PARAGRAPH = "Researchers found a critical flaw in the widely used ExampleVPN appliance. " * 12
ARTICLE_HTML = f"""<html><head><meta charset="utf-8"><title>Flaw</title>
<meta property="og:image" content="https://cdn.ex.com/lead.jpg"></head>
<body><nav>Home | News | About</nav><article><h1>Flaw</h1>
<p><img src="https://cdn.ex.com/lead.jpg?w=800" alt="Lead"></p>
<p>{PARAGRAPH}</p>
<figure><img src="https://cdn.ex.com/waves.png" alt="Attack waves by hour"><figcaption>Source: Gambit</figcaption></figure>
<p>{PARAGRAPH}</p>
<p><img src="https://cdn.ex.com/uploads/Record_Ads_970x250_1.png" alt="Sponsor"></p>
<p><img src="http://cdn.ex.com/plain-http.png" alt="insecure"></p>
<figure><img src="https://cdn.ex.com/cards.png" alt="Stolen credit cards"><figcaption>Source: Gambit</figcaption></figure>
<p>{PARAGRAPH} más datos.</p>
</article><footer>Copyright</footer></body></html>"""


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_extract_main_text_og_image_and_figure_markers():
    page = extract(ARTICLE_HTML.encode("utf-8"), "https://ex.com/story")
    assert page is not None
    assert "critical flaw" in page.text and "Home | News" not in page.text
    assert "más datos" in page.text  # charset taken from the page, no mojibake
    assert page.image == "https://cdn.ex.com/lead.jpg"
    # lead image (same path as og:image), ad banner and http image are not candidates
    assert page.candidates == ["https://cdn.ex.com/waves.png", "https://cdn.ex.com/cards.png"]
    # figcaptions travel inside the marker, even when trafilatura drops them from the text
    assert '[FIG 1: "Attack waves by hour · Source: Gambit" · waves.png]' in page.text
    assert '[FIG 2: "Stolen credit cards · Source: Gambit" · cards.png]' in page.text
    assert "![" not in page.text


@pytest.mark.parametrize(
    ("url", "junk"),
    [
        ("https://cdn.ex.com/2026/silicon-chip.jpg", False),
        ("https://cdn.ex.com/images/news/cairn.jpg", False),
        ("https://cdn.ex.com/site-logo.png", True),
        ("https://secure.gravatar.com/avatar/abc", True),
        ("https://cdn.ex.com/uploads/Record_Ads_970x250_1.png", True),
        ("https://cdn.ex.com/banner-300x250.jpg", True),
        ("https://feeds.feedburner.com/~r/x/~4/abc", True),
        ("https://cdn.ex.com/diagram.svg", True),
    ],
)
def test_is_junk_image(url, junk):
    assert is_junk_image(url) is junk


def test_pick_image_prefers_og_image_and_skips_junk():
    assert pick_image("https://ex.com/feed.jpg", "https://ex.com/og.jpg") == "https://ex.com/og.jpg"
    assert pick_image("https://ex.com/feed.jpg", "https://ex.com/logo.png") == "https://ex.com/feed.jpg"
    assert pick_image("https://ex.com/avatar.png", None) is None


def test_download_accepts_html_only():
    html = _client(lambda r: httpx.Response(200, text=ARTICLE_HTML, headers={"content-type": "text/html; charset=utf-8"}))
    assert b"ExampleVPN" in download(html, "https://ex.com/a", max_bytes=1_000_000)
    pdf = _client(lambda r: httpx.Response(200, content=b"%PDF", headers={"content-type": "application/pdf"}))
    assert download(pdf, "https://ex.com/a", max_bytes=1_000_000) is None
    blocked = _client(lambda r: httpx.Response(403, text="nope", headers={"content-type": "text/html"}))
    assert download(blocked, "https://ex.com/a", max_bytes=1_000_000) is None


def test_download_gives_up_on_oversized_pages():
    big = _client(lambda r: httpx.Response(200, text="x" * 5000, headers={"content-type": "text/html"}))
    assert download(big, "https://ex.com/a", max_bytes=1000) is None
