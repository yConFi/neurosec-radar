-- NeuroSec Radar · Group the same vulnerability covered by several sources
--
-- The collector now also sets articles.duplicate_of on *processed* articles
-- (status stays 'done') when they share a CVE with a more important story:
-- see collector/grouping.py. The web hides those members from the banner,
-- highlights and feed, and lists them under «También en» of the primary.
-- The view exposes duplicate_of instead of filtering it, so a member's own
-- detail page still opens from that list.

-- New column appended at the end, so CREATE OR REPLACE is allowed.
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
  a.image_url, a.detail_es, a.key_points, a.figures,
  a.duplicate_of
from public.articles a
join public.sources s on s.id = a.source_id
left join public.article_states st
  on st.article_id = a.id and st.user_id = (select auth.uid())
where a.status = 'done';
