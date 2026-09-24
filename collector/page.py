"""Article page enrichment: full text + images for *new* RSS articles.

Most news feeds only carry a 150-400 char teaser, which is all the AI saw.
Each new article page is downloaded once (never re-fetched), its main text is
extracted with trafilatura and kept in `articles.body` until the AI has used it.

Images inside the article body become `[FIG n: "alt"]` markers in that text,
right where they appeared, so the AI sees their alt text, caption ("Source:
Gambit") and surrounding paragraphs and can keep the ones that carry
information (charts, tables, diagrams) without paying for vision tokens.
Their URLs wait in `articles.image_candidates` until the AI picks.

Best effort by design: sites that block bots (403), time out or return
something that is not HTML simply keep the RSS teaser. No retries: a missing
page must never slow the 30-min run down.
"""

from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from urllib.parse import urlsplit

import httpx
import trafilatura

from .normalize import https_url, truncate
from .sources.http import make_client

log = logging.getLogger(__name__)

MAX_CANDIDATES = 8
_MD_IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)[^)]*\)")
# Never informative: logos, avatars/author photos, icons, ads, tracking pixels. Matched as whole
# URL tokens so that e.g. "silicon-chip.jpg" is not mistaken for an icon.
_JUNK_WORDS = {
    "logo", "logos", "avatar", "avatars", "gravatar", "icon", "icons", "favicon", "emoji", "badge",
    "sponsor", "sponsored", "banner", "banners", "pixel", "ad", "ads", "advert", "adserver",
    "feedburner", "doubleclick",
}
_AD_SIZE = re.compile(r"(?<!\d)(?:728|970|300|320|468)x\d{2,3}(?!\d)")  # standard banner sizes


@dataclass
class Page:
    text: str
    image: str | None  # og:image / twitter:image
    candidates: list[str] = field(default_factory=list)  # URL of [FIG n] = candidates[n - 1]


def is_junk_image(url: str) -> bool:
    parts = urlsplit(url.lower())
    tokens = set(re.split(r"[^a-z0-9]+", f"{parts.netloc} {parts.path}"))
    return bool(tokens & _JUNK_WORDS) or bool(_AD_SIZE.search(parts.path)) or parts.path.endswith(".svg")


def _same_image(a: str | None, b: str | None) -> bool:
    return bool(a and b) and urlsplit(a).path == urlsplit(b).path


def download(client: httpx.Client, url: str, max_bytes: int) -> bytes | None:
    """GET an HTML page, giving up on errors, non-HTML or oversized responses.

    Returns bytes on purpose: trafilatura detects the charset from the page
    itself (httpx guessing it produced mojibake on some Spanish sites).
    """
    with client.stream("GET", url) as resp:
        if resp.status_code != 200 or "html" not in resp.headers.get("content-type", ""):
            log.info("Page %s skipped: HTTP %s %s", url, resp.status_code, resp.headers.get("content-type"))
            return None
        chunks, size = [], 0
        for chunk in resp.iter_bytes():
            size += len(chunk)
            if size > max_bytes:
                log.info("Page %s skipped: larger than %d bytes", url, max_bytes)
                return None
            chunks.append(chunk)
        return b"".join(chunks)


def _captions_into_alt(tree) -> None:
    """Copy each <figcaption> into its image's alt text: trafilatura sometimes drops figcaptions,
    and a caption like "Stolen credit cards · Source: Gambit" is the best hint for the AI."""
    for figure in tree.iter("figure"):
        caption = " ".join(" ".join(" ".join(c.itertext()) for c in figure.iter("figcaption")).split())
        if not caption:
            continue
        for img in figure.iter("img"):
            alt = " ".join((img.get("alt") or "").split())
            text = caption if alt.lower() in caption.lower() else f"{alt} · {caption}"  # "" is in any caption
            img.set("alt", text.replace("]", ")")[:300])


def extract(html: bytes | str, url: str) -> Page | None:
    tree = trafilatura.load_html(html)  # also detects the page charset
    if tree is None:
        return None
    _captions_into_alt(tree)
    doc = trafilatura.bare_extraction(tree, url=url, with_metadata=True, include_images=True, include_comments=False)
    if doc is None:
        return None
    lead = https_url(doc.image)
    candidates: list[str] = []

    def marker(match: re.Match) -> str:
        alt, src = match.group(1).strip(), https_url(match.group(2))
        if not src or is_junk_image(src) or _same_image(src, lead) or len(candidates) >= MAX_CANDIDATES:
            return ""
        if src in candidates:
            return ""
        candidates.append(src)
        # The file name is a free hint when alt text is missing (e.g. "stage-1.jpg", "attack-chain.png").
        file = urlsplit(src).path.rsplit("/", 1)[-1][:60].replace("]", ")")
        return f'[FIG {len(candidates)}: "{alt}" · {file}]'

    text = _MD_IMAGE.sub(marker, doc.text or "")
    return Page(text=re.sub(r"\n{3,}", "\n\n", text).strip(), image=lead, candidates=candidates)


def pick_image(feed_image: str | None, page_image: str | None) -> str | None:
    """Lead image for cards and detail: the publisher's og:image, else the feed's; never junk."""
    for url in (page_image, feed_image):
        if url and not is_junk_image(url):
            return url
    return None


def enrich(articles: list[dict], cfg: dict) -> dict[int, dict]:
    """Return {article_id: {...}} with only the fields worth updating (body, image_candidates, image_url)."""
    c = cfg["collector"]

    def one(article: dict) -> tuple[int, dict]:
        try:
            html = download(client, article["url"], c["page_max_bytes"])
            page = extract(html, article["url"]) if html else None
        except Exception as exc:  # one broken page must not stop the others
            log.info("Page %s failed: %s: %s", article["url"], type(exc).__name__, exc)
            page = None
        update: dict = {}
        # Only worth keeping if the page gave us more than the feed teaser already had.
        if page and len(page.text) > len(article.get("content") or ""):
            body = truncate(page.text, c["max_body_chars"])
            update["body"] = body
            # a figure cut off by the truncation can't be chosen: keep only the markers that survived
            kept = [url for n, url in enumerate(page.candidates, 1) if f"[FIG {n}:" in body]
            if kept:
                update["image_candidates"] = kept
        image = pick_image(article.get("image_url"), page.image if page else None)
        if image != article.get("image_url"):
            update["image_url"] = image
        return article["id"], update

    if not articles:
        return {}
    with make_client(c["user_agent"], c["page_timeout_s"]) as client, ThreadPoolExecutor(max_workers=8) as pool:
        results = dict(pool.map(one, articles))
    return {aid: upd for aid, upd in results.items() if upd}
