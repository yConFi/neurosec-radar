-- NeuroSec Radar · Phase 1 core schema
-- Tables: sources, ai_batches, articles, vulnerabilities, alerts, collector_runs.
-- Security model: RLS enabled on every table with NO policies (deny-by-default).
-- The collector writes with the Supabase *secret* key (bypasses RLS, lives only in
-- GitHub Secrets). Read policies for the single web user arrive in phase 3.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- sources: mirrored from config/sources.yaml on every run + health tracking
-- ---------------------------------------------------------------------------
create table public.sources (
  id                   text primary key check (id ~ '^[a-z0-9][a-z0-9_-]*$'),
  name                 text not null,
  kind                 text not null check (kind in ('rss', 'arxiv', 'cisa_kev', 'nvd')),
  url                  text not null,
  lang                 text not null check (lang in ('en', 'es')),
  category_hint        text check (category_hint in ('ai', 'cyber', 'ai_x_cyber')),
  enabled              boolean not null default true,
  -- HTTP conditional GET cache (saves bandwidth on unchanged feeds)
  etag                 text,
  last_modified        text,
  -- health
  last_success_at      timestamptz,
  last_error           text,
  last_error_at        timestamptz,
  consecutive_failures integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger sources_set_updated_at
  before update on public.sources
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- ai_batches: one row per Anthropic Message Batch (cost + status tracking)
-- ---------------------------------------------------------------------------
create table public.ai_batches (
  id             text primary key,                 -- msgbatch_...
  model          text not null,
  status         text not null default 'in_progress'
                 check (status in ('in_progress', 'collected', 'failed')),
  request_count  integer not null,
  succeeded      integer,
  errored        integer,
  expired        integer,
  canceled       integer,
  input_tokens   bigint,
  output_tokens  bigint,
  created_at     timestamptz not null default now(),
  collected_at   timestamptz
);

-- ---------------------------------------------------------------------------
-- articles: every news item / paper / CVE entry, plus the AI enrichment
-- ---------------------------------------------------------------------------
create table public.articles (
  id            bigint generated always as identity primary key,
  source_id     text not null references public.sources (id) on update cascade,
  url           text not null unique,              -- canonical URL (dedupe #1)
  title         text not null,
  title_norm    text not null,                     -- normalised title (dedupe #2)
  content       text,                              -- plain-text snippet sent to the AI
  author        text,
  lang          text not null check (lang in ('en', 'es')),
  published_at  timestamptz,
  fetched_at    timestamptz not null default now(),
  external_id   text,                              -- CVE id, arXiv id...
  extra         jsonb not null default '{}'::jsonb,
  duplicate_of  bigint references public.articles (id) on delete set null,

  -- processing state machine: pending -> queued -> done | failed ; or duplicate
  status        text not null default 'pending'
                check (status in ('pending', 'queued', 'done', 'failed', 'duplicate')),
  batch_id      text references public.ai_batches (id) on delete set null,
  attempts      smallint not null default 0,
  last_error    text,
  processed_at  timestamptz,
  model         text,

  -- AI output (Claude Haiku 4.5, structured JSON)
  category      text check (category in ('ai', 'cyber', 'ai_x_cyber')),
  subtopics     text[] not null default '{}',
  importance    smallint check (importance between 1 and 10),
  is_curious    boolean,
  summary_es    text,
  cves          text[] not null default '{}',
  is_urgent     boolean,
  urgent_reason text,

  -- full-text search (phase 3). 'simple' config: mixed EN titles + ES summaries.
  search        tsvector generated always as (
                  setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
                  setweight(to_tsvector('simple', coalesce(summary_es, '')), 'B')
                ) stored
);

create index articles_published_at_idx on public.articles (published_at desc nulls last);
create index articles_fetched_at_idx   on public.articles (fetched_at desc);
create index articles_work_queue_idx   on public.articles (status, fetched_at) where status in ('pending', 'queued');
create index articles_category_idx     on public.articles (category, importance desc);
create index articles_source_idx       on public.articles (source_id);
create index articles_batch_idx        on public.articles (batch_id);
create index articles_duplicate_of_idx on public.articles (duplicate_of);
create index articles_cves_gin         on public.articles using gin (cves);
create index articles_subtopics_gin    on public.articles using gin (subtopics);
create index articles_search_gin       on public.articles using gin (search);

-- ---------------------------------------------------------------------------
-- vulnerabilities: facts about CVEs from CISA KEV + NVD (drive urgency rules)
-- ---------------------------------------------------------------------------
create table public.vulnerabilities (
  cve_id                text primary key check (cve_id ~ '^CVE-[0-9]{4}-[0-9]{4,}$'),
  description           text,
  vendor                text,
  product               text,
  cvss_score            numeric(3, 1) check (cvss_score between 0 and 10),
  cvss_version          text,
  cvss_severity         text,
  has_public_exploit    boolean not null default false,  -- NVD reference tagged "Exploit"
  in_kev                boolean not null default false,  -- actively exploited (CISA)
  kev_date_added        date,
  kev_due_date          date,
  kev_ransomware        boolean,
  nvd_published_at      timestamptz,
  nvd_last_modified_at  timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index vulnerabilities_kev_idx on public.vulnerabilities (kev_date_added desc) where in_kev;

create trigger vulnerabilities_set_updated_at
  before update on public.vulnerabilities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- alerts: urgent items waiting for Telegram (phase 2). dedupe_key is UNIQUE,
-- so the same CVE / article can never be alerted twice.
-- ---------------------------------------------------------------------------
create table public.alerts (
  id          bigint generated always as identity primary key,
  dedupe_key  text not null unique,                  -- e.g. 'cve:CVE-2026-1234', 'article:42'
  rule        text not null check (rule in ('kev_new', 'cve_critical_exploited', 'ai_importance')),
  article_id  bigint references public.articles (id) on delete cascade,
  cve_id      text references public.vulnerabilities (cve_id) on delete set null,
  reason      text not null,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  send_error  text
);

create index alerts_unsent_idx  on public.alerts (created_at) where sent_at is null;
create index alerts_article_idx on public.alerts (article_id);
create index alerts_cve_idx     on public.alerts (cve_id);

-- ---------------------------------------------------------------------------
-- collector_runs: one row per GitHub Actions run (observability)
-- ---------------------------------------------------------------------------
create table public.collector_runs (
  id           bigint generated always as identity primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  stats        jsonb not null default '{}'::jsonb,
  errors       jsonb not null default '[]'::jsonb
);

-- ---------------------------------------------------------------------------
-- Row Level Security: on everywhere, no policies yet => anon/authenticated see
-- nothing. The anonymous role also loses its table privileges entirely.
-- ---------------------------------------------------------------------------
alter table public.sources         enable row level security;
alter table public.ai_batches      enable row level security;
alter table public.articles        enable row level security;
alter table public.vulnerabilities enable row level security;
alter table public.alerts          enable row level security;
alter table public.collector_runs  enable row level security;

revoke all on public.sources, public.ai_batches, public.articles,
              public.vulnerabilities, public.alerts, public.collector_runs
  from anon;
