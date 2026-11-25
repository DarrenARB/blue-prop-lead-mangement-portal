create extension if not exists pg_cron;

create or replace function private.run_lemlist_sync() returns bigint
language sql security definer set search_path = public, private as $$
  select net.http_post(
    url := 'https://lqaxjvhgstdborylstzu.supabase.co/functions/v1/lemlist',
    headers := jsonb_build_object('Content-Type','application/json','x-internal-key',(select value from private.app_config where key='internal_key')),
    body := '{"action":"sync"}'::jsonb,
    timeout_milliseconds := 30000);
$$;

select cron.schedule('lemlist-number-health', '*/5 * * * *', $$select private.run_lemlist_sync()$$);
-- keep pg_net's response log small (it can hold tokens from manual tests)
select cron.schedule('pg-net-cleanup', '17 * * * *', $$delete from net._http_response where created < now() - interval '1 hour'$$);
