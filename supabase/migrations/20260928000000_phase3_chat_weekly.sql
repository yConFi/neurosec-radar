-- NeuroSec Radar · Phase 3: chat about each article + weekly digest
--
-- chat_messages   written by the web (the owner's session, so RLS applies);
--                 the route handler checks the article is readable first.
-- weekly_digests  written by the collector (secret key, bypasses RLS);
--                 the web only reads it.

-- ---------------------------------------------------------------------------
-- chat_messages: one row per turn of the conversation about an article
-- ---------------------------------------------------------------------------
create table public.chat_messages (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  article_id    bigint not null references public.articles (id) on delete cascade,
  role          text not null check (role in ('user', 'assistant')),
  content       text not null check (char_length(content) between 1 and 20000),
  -- assistant turns only: which model answered and what it cost
  model         text,
  input_tokens  integer,
  output_tokens integer,
  created_at    timestamptz not null default now()
);

create index chat_messages_thread_idx on public.chat_messages (user_id, article_id, id);
-- daily quota check in the route handler: count of the user's own turns since X
create index chat_messages_quota_idx on public.chat_messages (user_id, created_at) where role = 'user';

alter table public.chat_messages enable row level security;
revoke all on public.chat_messages from anon;
-- History is append-only: read, add, or delete a whole conversation. Never edit.
revoke update, truncate on public.chat_messages from authenticated;

create policy "owner reads own chat" on public.chat_messages
  for select to authenticated
  using ((select private.is_owner()) and user_id = (select auth.uid()));
create policy "owner adds own chat" on public.chat_messages
  for insert to authenticated
  with check ((select private.is_owner()) and user_id = (select auth.uid()));
create policy "owner deletes own chat" on public.chat_messages
  for delete to authenticated
  using ((select private.is_owner()) and user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- weekly_digests: one AI summary per week (Monday to Sunday, Europe/Madrid)
-- ---------------------------------------------------------------------------
create table public.weekly_digests (
  week_start    date primary key check (extract(isodow from week_start) = 1),
  status        text not null default 'queued' check (status in ('queued', 'done', 'failed')),
  batch_id      text,
  model         text,
  attempts      integer not null default 0,
  article_count integer not null default 0,
  -- validated by the collector: {headline, overview, top[], sections[], trends[]}
  content       jsonb check (content is null or jsonb_typeof(content) = 'object'),
  input_tokens  integer,
  output_tokens integer,
  last_error    text,
  generated_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger weekly_digests_set_updated_at
  before update on public.weekly_digests
  for each row execute function public.set_updated_at();

alter table public.weekly_digests enable row level security;
revoke all on public.weekly_digests from anon;
revoke insert, update, delete, truncate on public.weekly_digests from authenticated;

create policy "owner reads weekly digests" on public.weekly_digests
  for select to authenticated using ((select private.is_owner()));
