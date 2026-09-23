-- NeuroSec Radar · Phase 2 (web): single-owner access, per-user state, feed view
--
-- Access model
--   * One owner. Their auth.users id lives in private.app_owner, a schema the
--     Data API does NOT expose. The row is inserted out-of-band (never in this
--     public repo), so the owner's identity is not published.
--   * Every read policy checks private.is_owner(). Even if sign-ups were
--     accidentally re-enabled, a new account would see nothing.
--   * The collector keeps using the secret key (bypasses RLS).

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table private.app_owner (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
revoke all on private.app_owner from public, anon, authenticated;

-- SECURITY DEFINER so policies can consult app_owner without exposing it.
create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.app_owner where user_id = (select auth.uid()));
$$;
revoke all on function private.is_owner() from public, anon;
grant execute on function private.is_owner() to authenticated;

-- ---------------------------------------------------------------------------
-- Read access for the owner on the collector tables
-- ((select ...) wrapper = evaluated once per query, not per row)
-- ---------------------------------------------------------------------------
create policy "owner reads articles" on public.articles
  for select to authenticated using ((select private.is_owner()));
create policy "owner reads sources" on public.sources
  for select to authenticated using ((select private.is_owner()));
create policy "owner reads vulnerabilities" on public.vulnerabilities
  for select to authenticated using ((select private.is_owner()));
create policy "owner reads ai_batches" on public.ai_batches
  for select to authenticated using ((select private.is_owner()));
create policy "owner reads collector_runs" on public.collector_runs
  for select to authenticated using ((select private.is_owner()));

-- The web never writes collector data: keep only SELECT for authenticated.
revoke insert, update, delete, truncate on public.articles, public.sources, public.vulnerabilities,
  public.ai_batches, public.collector_runs from authenticated;

-- ---------------------------------------------------------------------------
-- article_states: read / favourite / note per user and article
-- ---------------------------------------------------------------------------
create table public.article_states (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  article_id bigint not null references public.articles (id) on delete cascade,
  read_at    timestamptz,
  favorite   boolean not null default false,
  note       text check (char_length(note) <= 10000),
  updated_at timestamptz not null default now(),
  primary key (user_id, article_id)
);

create index article_states_article_idx on public.article_states (article_id);
create index article_states_favorite_idx on public.article_states (user_id) where favorite;

create trigger article_states_set_updated_at
  before update on public.article_states
  for each row execute function public.set_updated_at();

alter table public.article_states enable row level security;
revoke all on public.article_states from anon;

create policy "owner manages own states" on public.article_states
  for all to authenticated
  using ((select private.is_owner()) and user_id = (select auth.uid()))
  with check ((select private.is_owner()) and user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- feed: processed articles + source name + the current user's state.
-- security_invoker => the caller's RLS applies to every underlying table.
-- ---------------------------------------------------------------------------
create view public.feed
with (security_invoker = true)
as
select
  a.id, a.url, a.title, a.lang, a.published_at, a.fetched_at,
  coalesce(a.published_at, a.fetched_at) as sort_at,
  a.source_id, s.name as source_name, s.kind as source_kind,
  a.category, a.subtopics, a.importance, a.highlight, a.is_curious,
  a.summary_es, a.cves, a.is_urgent, a.urgent_reason, a.external_id, a.extra,
  a.search,
  st.read_at, coalesce(st.favorite, false) as favorite, st.note
from public.articles a
join public.sources s on s.id = a.source_id
left join public.article_states st
  on st.article_id = a.id and st.user_id = (select auth.uid())
where a.status = 'done';

revoke all on public.feed from anon;
grant select on public.feed to authenticated;

create index articles_sort_at_idx on public.articles ((coalesce(published_at, fetched_at)) desc) where status = 'done';
