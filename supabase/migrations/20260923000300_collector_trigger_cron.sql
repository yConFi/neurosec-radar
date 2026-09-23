-- NeuroSec Radar · Trigger the collector from Supabase (pg_cron + pg_net)
--
-- Why: GitHub's own `schedule` trigger fired ~3 times in 15 h instead of ~30
-- (GitHub documents delays/drops under load). Supabase Cron is punctual, so it
-- calls the workflow_dispatch API every 30 min. Side effects: the project stays
-- active on the Free plan, and GitHub's 60-day inactivity rule for scheduled
-- workflows no longer matters (it doesn't apply to workflow_dispatch).
--
-- Verified 2026-09-23:
--   Supabase: https://supabase.com/docs/guides/cron/install, .../extensions/pg_net
--   GitHub:   POST /repos/{owner}/{repo}/actions/workflows/{file}/dispatches,
--             fine-grained PAT permission "Actions: write", API version 2026-03-10
--
-- The GitHub token is NOT in this file: the owner stores it in Supabase Vault
-- under the name 'github_actions_dispatch_token'.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create extension if not exists pg_net;

create or replace function private.trigger_collector()
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  token text;
begin
  select decrypted_secret into token
  from vault.decrypted_secrets
  where name = 'github_actions_dispatch_token';

  if token is null then
    raise warning 'trigger_collector: Vault secret github_actions_dispatch_token is missing';
    return null;
  end if;

  -- Async: the response lands in net._http_response (kept 6 h).
  return net.http_post(
    url := 'https://api.github.com/repos/yConFi/neurosec-radar/actions/workflows/collect.yml/dispatches',
    body := jsonb_build_object('ref', 'main'),
    headers := jsonb_build_object(
      'Accept', 'application/vnd.github+json',
      'Authorization', 'Bearer ' || token,
      'X-GitHub-Api-Version', '2026-03-10',
      'User-Agent', 'neurosec-radar-supabase-cron',
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 10000
  );
end;
$$;

-- Only the cron job (runs as postgres) may call it; never the Data API roles.
revoke all on function private.trigger_collector() from public, anon, authenticated;

select cron.schedule(
  'trigger-collector',
  '7,37 * * * *',  -- UTC, off the top of the hour
  $$select private.trigger_collector()$$
);
