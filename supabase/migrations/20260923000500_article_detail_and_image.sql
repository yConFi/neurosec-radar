-- NeuroSec Radar · Richer articles: full-page text for the AI, image, detailed analysis
--
-- Most news RSS feeds only carry a 150-400 char teaser, so the AI summarised a
-- headline. The collector now downloads each new RSS article page once and
-- keeps its extracted text in `body` only until the AI has processed it
-- (Supabase Free = 500 MB: full texts are never kept long-term).

--
-- Images: only URLs are stored; the browser loads them from the source site.
--   image_url        lead image (og:image or the feed's), shown in cards and detail
--   figures          in-article images that carry information (charts, tables,
--                    diagrams, evidence screenshots), chosen by the AI from the
--                    `image_candidates` the collector found in the article body:
--                    [{"url": "https://...", "caption": "..."}]

alter table public.articles
  -- transient: cleared by the collector once the AI result is saved
  add column body             text check (char_length(body) <= 20000),
  add column image_candidates text[] not null default '{}',
  add column image_url        text check (image_url ~ '^https://' and char_length(image_url) <= 2048),
  -- AI: longer analysis + figures, only for importance >= 6 (empty otherwise)
  add column detail_es        text,
  add column key_points       text[] not null default '{}',
  add column figures          jsonb not null default '[]' check (jsonb_typeof(figures) = 'array');

-- New columns appended at the end, so CREATE OR REPLACE is allowed.
create or replace view public.feed
with (security_invoker = true)
as
select
  a.id, a.url, a.title, a.lang, a.published_at, a.fetched_at,
  coalesce(a.published_at, a.fetched_at) as sort_at,
  a.source_id, s.name as source_name, s.kind as source_kind,
  a.category, a.subtopics, a.importance, a.highlight, a.is_curious,
  a.summary_es, a.cves, a.is_urgent, a.urgent_reason, a.external_id, a.extra,
  a.search,
  st.read_at, coalesce(st.favorite, false) as favorite, st.note,
  a.image_url, a.detail_es, a.key_points, a.figures
from public.articles a
join public.sources s on s.id = a.source_id
left join public.article_states st
  on st.article_id = a.id and st.user_id = (select auth.uid())
where a.status = 'done';
