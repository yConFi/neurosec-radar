-- NeuroSec Radar · Items dated in the future
--
-- Some feeds date an item after the moment we fetched it (Dark Reading event
-- announcements carry the event day, months ahead; OpenAI and INCIBE-CERT were seen
-- hours ahead). Sorted by date, such an item sat on top of the feed until that day and
-- could fall in the wrong week of the weekly digest. The collector now caps the date at
-- fetch time; this applies the same rule to the rows already stored (4 on 2026-09-28).
update public.articles
set published_at = fetched_at
where published_at > fetched_at;
