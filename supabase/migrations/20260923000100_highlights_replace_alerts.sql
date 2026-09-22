-- NeuroSec Radar · Replace push alerts with in-app highlights
-- Decision (2026-09-23): no Telegram at all. Important news must be easy to
-- spot in the web instead:
--   'major' (trascendental) = importance >= 9 -> pinned banner until read
--   'top'   (destacado)     = importance  = 8 -> highlights section
-- Only the AI importance counts (CVE rules don't feed highlights).
-- A generated column keeps the rule in one place and can never drift.

drop table public.alerts;

alter table public.articles
  add column highlight text generated always as (
    case
      when importance >= 9 then 'major'
      when importance >= 8 then 'top'
    end
  ) stored;

create index articles_highlight_idx
  on public.articles (highlight, published_at desc)
  where highlight is not null;
