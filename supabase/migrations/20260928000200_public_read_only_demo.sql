-- NeuroSec Radar · Public read-only demo
--
-- Decision 2026-09-28: anyone can browse the feed, highlights, article detail and
-- weekly digest without an account. Personal features (read / favourite / notes /
-- chat) stay owner-only, unchanged.
--
-- Access model for the anonymous role (least privilege, on top of RLS):
--   * COLUMN-level SELECT grants: only what the public pages show. Never
--     articles.content / body (source text), AI bookkeeping (batch_id, attempts,
--     last_error, model), source health, collector tables, or any personal table
--     (article_states, chat_messages): anon has no privilege on those at all.
--   * RLS policies `to anon` limited to published rows.
--   * public_feed: the feed without the per-user columns. `feed` is now built on
--     top of it, so the highlight rule (no highlights from KEV/NVD) lives in one place.

-- ---------------------------------------------------------------------------
-- public_feed: processed articles + source, no per-user state
-- ---------------------------------------------------------------------------
create view public.public_feed
with (security_invoker = true)
as
select
  a.id, a.url, a.title, a.lang, a.published_at, a.fetched_at,
  coalesce(a.published_at, a.fetched_at) as sort_at,
  a.source_id, s.name as source_name, s.kind as source_kind,
  a.category, a.subtopics, a.importance,
  -- KEV/NVD records provide CVE facts but never make highlights
  case when s.kind in ('cisa_kev', 'nvd') then null else a.highlight end as highlight,
  a.is_curious,
  a.summary_es, a.cves, a.is_urgent, a.urgent_reason, a.external_id, a.extra,
  a.search,
  a.image_url, a.detail_es, a.key_points, a.figures,
  a.duplicate_of
from public.articles a
join public.sources s on s.id = a.source_id
where a.status = 'done';

revoke all on public.public_feed from public;
grant select on public.public_feed to anon, authenticated;

-- Same columns, names, types and order as before: CREATE OR REPLACE is allowed.
create or replace view public.feed
with (security_invoker = true)
as
select
  p.id, p.url, p.title, p.lang, p.published_at, p.fetched_at, p.sort_at,
  p.source_id, p.source_name, p.source_kind,
  p.category, p.subtopics, p.importance, p.highlight, p.is_curious,
  p.summary_es, p.cves, p.is_urgent, p.urgent_reason, p.external_id, p.extra,
  p.search,
  st.read_at, coalesce(st.favorite, false) as favorite, st.note,
  p.image_url, p.detail_es, p.key_points, p.figures,
  p.duplicate_of
from public.public_feed p
left join public.article_states st
  on st.article_id = p.id and st.user_id = (select auth.uid());

-- ---------------------------------------------------------------------------
-- anon: column grants + published-rows policies
-- ---------------------------------------------------------------------------
grant select (
  id, url, title, lang, published_at, fetched_at, source_id, status, duplicate_of,
  category, subtopics, importance, highlight, is_curious, summary_es, cves,
  is_urgent, urgent_reason, external_id, extra, search,
  image_url, detail_es, key_points, figures
) on public.articles to anon;
-- 'duplicate' rows too: the detail page lists them under «También en» (title + link only)
create policy "public reads published articles" on public.articles
  for select to anon using (status in ('done', 'duplicate'));

grant select (id, name, kind, enabled) on public.sources to anon;
create policy "public reads sources" on public.sources
  for select to anon using (true);

-- CVE facts come from public sources (NVD, CISA KEV)
grant select on public.vulnerabilities to anon;
create policy "public reads vulnerabilities" on public.vulnerabilities
  for select to anon using (true);

grant select (week_start, status, article_count, content, generated_at, model) on public.weekly_digests to anon;
create policy "public reads weekly digests" on public.weekly_digests
  for select to anon using (true);
