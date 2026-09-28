-- Covering index for chat_messages.article_id (FK, ON DELETE CASCADE from articles),
-- as flagged by the Supabase performance advisor.
create index chat_messages_article_idx on public.chat_messages (article_id);
