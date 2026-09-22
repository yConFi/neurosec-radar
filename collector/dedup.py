"""Near-duplicate detection by normalised title (layer 2; layer 1 is UNIQUE(url))."""

from __future__ import annotations

from rapidfuzz import fuzz, process


def find_duplicates(
    new: list[tuple[int, str]],
    existing: list[tuple[int, str]],
    *,
    threshold: float,
    min_len: int,
) -> dict[int, int]:
    """Map new_article_id -> original_article_id for near-duplicate titles.

    `new` must be in insertion order: a new article can also be a duplicate of
    one inserted earlier in the same run. token_sort_ratio (not token_set_ratio)
    so a short title that is a *subset* of a longer one doesn't score 100.
    """
    pool: dict[int, str] = {i: t for i, t in existing if len(t) >= min_len}
    duplicates: dict[int, int] = {}
    for article_id, title in new:
        if len(title) < min_len:
            continue
        match = process.extractOne(title, pool, scorer=fuzz.token_sort_ratio, score_cutoff=threshold)
        if match:
            duplicates[article_id] = match[2]  # (choice, score, key)
        else:
            pool[article_id] = title
    return duplicates
