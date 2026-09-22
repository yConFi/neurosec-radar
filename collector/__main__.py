"""CLI: python -m collector run [--dry-run] [--skip-ai]"""

from __future__ import annotations

import argparse
import logging
import sys

from .pipeline import run


def main() -> int:
    parser = argparse.ArgumentParser(prog="collector", description="NeuroSec Radar collector")
    sub = parser.add_subparsers(dest="command", required=True)
    run_cmd = sub.add_parser("run", help="collect sources and enrich them with AI")
    run_cmd.add_argument("--dry-run", action="store_true", help="only fetch and print; no DB, no AI")
    run_cmd.add_argument("--skip-ai", action="store_true", help="write to DB but don't call Claude")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    # httpx (and httpx2, used by the anthropic SDK) log every request at INFO.
    for name in ("httpx", "httpx2"):
        logging.getLogger(name).setLevel(logging.WARNING)

    return run(dry_run=args.dry_run, skip_ai=args.skip_ai)


if __name__ == "__main__":
    sys.exit(main())
