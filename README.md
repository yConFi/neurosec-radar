# NeuroSec Radar

**A personal news radar for AI, cybersecurity and the intersection of both — collected every 30 minutes, triaged by Claude, summarised in Spanish.**

🔗 **Live demo (read-only, no account needed): [neurosec-radar.vercel.app](https://neurosec-radar.vercel.app)**

NeuroSec Radar pulls news from 30 sources (security and AI outlets in English and Spanish, arXiv, CISA KEV and NVD), removes duplicates, and has **Claude Haiku 4.5** classify every item, score its importance from 1 to 10, write a summary in Spanish, and decide whether it calls for action. The web app surfaces what matters: a pinned banner for must-know stories, a highlights section, a filterable feed, an AI chat about any article and an automatic weekly digest.

![Home: pinned banner of must-know stories with «Acción requerida»](docs/screenshots/home.png)

| Article detail | CVE facts and key points |
|---|---|
| ![Article detail with the action to take](docs/screenshots/article.png) | ![Detailed analysis, key points and CVE data from NVD and CISA KEV](docs/screenshots/article-cve.png) |
| **Chat with Claude about the article** (owner only) | **Weekly digest** |
| ![Streaming chat about an article](docs/screenshots/chat.png) | ![Weekly digest with overview and top stories](docs/screenshots/weekly.png) |

*The interface is in Spanish, the language of the summaries.*

## Features

- **Triage by AI.** Each item gets a category (`ai`, `cyber`, `ai_x_cyber`), subtopics, an importance score calibrated for a practitioner (CVSS alone is not importance), a Spanish summary and, for important stories, a longer analysis with key points and the source's informative figures.
- **What matters first.** Importance ≥ 9 goes to a pinned banner, 8 to a highlights section. Only the AI's score counts.
- **«Acción requerida».** Shown only when there is something concrete to do: a specific, widely deployed product, evidence of exploitation (or a CISA KEV listing), and a real fix or mitigation. The model reports those facts; the decision is made in code.
- **One story, many sources.** Near-duplicate titles are merged, and articles about the same CVE are grouped under one entry («También en»).
- **Chat about any article** (owner only), streamed from Claude with the article as context.
- **Weekly digest**: headline, overview, top stories, per-topic sections and trends, generated every Monday.
- **Search and filters** by text, topic, date, importance, source and CVE.
- **Public read-only demo**; read state, favourites, notes and chat are private to the owner.

## Architecture

```mermaid
flowchart LR
  subgraph Sources
    RSS["30 sources: RSS (EN/ES), arXiv,<br/>CISA KEV, NVD API"]
  end

  CRON["Supabase Cron<br/>every 30 min"] -- workflow_dispatch --> GHA
  subgraph GHA["GitHub Actions · Python collector"]
    direction TB
    F["fetch + normalise"] --> D["dedup: URL + fuzzy title"]
    D --> P["full article text<br/>(trafilatura)"]
    P --> B["submit to Message Batches API"]
    C["collect finished batches<br/>validate JSON · group by CVE"]
    W["weekly digest (Mondays)"]
  end

  RSS --> F
  B -- "Claude Haiku 4.5" --> ANTH[("Anthropic API")]
  ANTH --> C
  W <--> ANTH
  C --> DB[("Supabase Postgres<br/>RLS on every table")]
  W --> DB

  DB --> WEB["Next.js on Vercel"]
  WEB -- "chat (streaming)" --> ANTH
  WEB --> U["Visitor: read-only<br/>Owner: + read / favourites / notes / chat"]
```

**Why this shape**

- **Collection runs on GitHub Actions, triggered by Supabase Cron.** Vercel Hobby only allows a daily cron, and GitHub's own `schedule` trigger proved unreliable (about 3 runs in 15 hours instead of 30). `pg_cron` + `pg_net` call the `workflow_dispatch` API every 30 minutes; as a side effect, the Supabase Free project never pauses for inactivity.
- **Message Batches API instead of live calls.** Enrichment isn't urgent, and batches cost 50 % less. One run submits the pending items and a later run (usually within 30–60 minutes) collects the results. The weekly digest uses the same mechanism.
- **Postgres does the derived logic.** Highlights are a generated column (`articles.highlight`), and full-text search is a generated `tsvector`. The web only reads two views: `feed` for the owner and `public_feed` for visitors.
- **Full article text, kept briefly.** Most feeds only carry a teaser, so the collector downloads each new article once, gives the extracted text to the AI and deletes it after processing (500 MB database limit).

## Security decisions

This is a public repository and a public site built on untrusted content (it collects news *about* prompt injection), so security is part of the design:

**Data access (Supabase)**
- Row Level Security is enabled on every table. The owner check (`private.is_owner()`) is a `SECURITY DEFINER` function in a schema the Data API doesn't expose, and the owner's user id is set outside this repo.
- The public demo uses **least privilege on top of RLS**. The `anon` role gets **column-level** `SELECT` only on what the pages show, and RLS limits it to published rows. It has no access to source text, AI bookkeeping, source health, collector tables or any personal table (read state, notes, chat). Both allowed and denied queries were tested as the `anon` role.
- The web uses only the publishable key. The secret key (which bypasses RLS) exists only in GitHub Actions secrets for the collector, and new sign-ups are disabled.

**Untrusted content and the LLM**
- Article text goes to the model HTML-escaped inside tags, with instructions to treat it as data. The model has no tools, and its output is constrained by a JSON schema, then re-validated and clamped (Pydantic).
- Decisions with consequences don't depend on free text from the model. «Acción requerida» is computed from reported facts, remediation verbs are checked, and CISA KEV overrides the model's reading of exploitation. Every article id the weekly digest cites is checked against its input.
- Chat answers render as plain text, never HTML. External URLs from feeds are limited to `http(s)`, images to `https`, and they load with `no-referrer`.

**Web**
- The chat API requires a session, accepts same-origin JSON only and has cost guard-rails: 2,000-character questions, 30 per article and 100 per 24 h. `ANTHROPIC_API_KEY` is a server-only env var.
- Server Actions validate every input. Security headers are set (HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`), and the site is marked `noindex`.

**Supply chain and secrets**
- GitHub Actions are pinned to commit SHAs and Python dependencies to exact versions.
- No secret is in the code: they live in GitHub Actions secrets, Vercel env vars, and Supabase Vault (the fine-grained GitHub token that dispatches the collector, with only the "Actions: write" permission).

## Cost

Measured in the first week (22–28 Sep 2026): **~1.5 USD** of Claude Haiku 4.5 for 861 articles through the Batch API. A weekly digest costs about 0.03 USD, and a chat question about 0.003 USD. Supabase, Vercel and GitHub Actions run on their free tiers.

## Tech stack

| Layer | Tech |
|---|---|
| Collector | Python 3.14, httpx, feedparser, trafilatura, RapidFuzz, Pydantic, `anthropic` SDK |
| AI | Claude Haiku 4.5 — Message Batches API + structured outputs; streaming for chat |
| Database | Supabase (Postgres 17): RLS, views, generated columns, full-text search, pg_cron, pg_net, Vault |
| Web | Next.js 16 (App Router, Server Components, Server Actions), Tailwind CSS 4, `@supabase/ssr`, `@anthropic-ai/sdk` |
| Infra | GitHub Actions (collector + CI), Vercel (web) |

## Repository layout

```
collector/            Python collector: sources, dedup, page extraction, AI enrichment, weekly digest
config/               sources.yaml (every feed verified before adding) + settings.yaml (tunables)
supabase/migrations/  schema, RLS policies, views, cron trigger — applied in order
web/                  Next.js app
tests/                pytest suite (collector logic, AI output validation, weekly digest)
.github/workflows/    collect.yml (every 30 min) + ci.yml (tests, lint, build)
```

## Running it yourself

<details>
<summary>Setup outline</summary>

1. Create a Supabase project and apply `supabase/migrations/*.sql` in order. Then insert your auth user id into `private.app_owner`, and store a GitHub token (Actions: write) in Vault as `github_actions_dispatch_token`.
2. Add the GitHub Actions secrets `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `ANTHROPIC_API_KEY` (optionally `NVD_API_KEY`).
3. Collector locally: `pip install -r requirements.txt`, copy `.env.example` to `.env`, then `python -m collector run --dry-run` (fetch only) or `python -m collector run`.
4. Web: see [`web/README.md`](web/README.md). On Vercel the root directory is `web/`.
5. Tests: `python -m pytest -q` · `cd web && npm run lint && npm run build`.

</details>

---

Built by Ricardo ([@yConFi](https://github.com/yConFi)).
