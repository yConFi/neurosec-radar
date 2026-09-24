-- NeuroSec Radar · KEV/NVD items never make highlights
--
-- Design decision: CISA KEV and NVD provide CVE facts (vulnerabilities table)
-- but do not generate highlights; only news stories do. articles.highlight is
-- a generated column and cannot look at sources.kind, so the feed view (the only
-- thing the web reads) blanks it for those kinds. The items still appear in the
-- feed with their importance, and inside a story's «También en» when grouped.

-- Same columns, names and types as before: CREATE OR REPLACE is allowed.
create or replace view public.feed
with (security_invoker = true)
as
select
  a.id, a.url, a.title, a.lang, a.published_at, a.fetched_at,
  coalesce(a.published_at, a.fetched_at) as sort_at,
  a.source_id, s.name as source_name, s.kind as source_kind,
  a.category, a.subtopics, a.importance,
  case when s.kind in ('cisa_kev', 'nvd') then null else a.highlight end as highlight,
  a.is_curious,
  a.summary_es, a.cves, a.is_urgent, a.urgent_reason, a.external_id, a.extra,
  a.search,
  st.read_at, coalesce(st.favorite, false) as favorite, st.note,
  a.image_url, a.detail_es, a.key_points, a.figures,
  a.duplicate_of
from public.articles a
join public.sources s on s.id = a.source_id
left join public.article_states st
  on st.article_id = a.id and st.user_id = (select auth.uid())
where a.status = 'done';
