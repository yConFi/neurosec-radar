"""Load YAML configuration and environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"

# Local development reads .env; in GitHub Actions the variables come from Secrets.
load_dotenv(ROOT / ".env")


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    kind: str  # rss | arxiv | cisa_kev | nvd
    url: str
    lang: str  # en | es
    category_hint: str | None = None
    enabled: bool = True


@cache
def settings() -> dict[str, Any]:
    with open(CONFIG_DIR / "settings.yaml", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def load_sources() -> list[Source]:
    with open(CONFIG_DIR / "sources.yaml", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)["sources"]
    sources = [Source(**entry) for entry in raw]
    ids = [s.id for s in sources]
    duplicated = {i for i in ids if ids.count(i) > 1}
    if duplicated:
        raise ValueError(f"Duplicated source ids in sources.yaml: {sorted(duplicated)}")
    return sources


def env(name: str, *, required: bool = True) -> str | None:
    value = os.environ.get(name, "").strip()
    if required and not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value or None
