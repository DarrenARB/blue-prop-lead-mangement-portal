-- Per-user interface preferences (e.g. which menu sections are collapsed), kept with the account so they follow the user.
alter table public.profiles add column if not exists ui_prefs jsonb not null default '{}';

create or replace function public.set_ui_pref(p_key text, p_value jsonb) returns void
language sql security definer set search_path = public as $$
  update public.profiles
     set ui_prefs = jsonb_set(coalesce(ui_prefs, '{}'), array[p_key], coalesce(p_value, 'null'::jsonb), true)
   where id = auth.uid() and p_key ~ '^[a-z_]{1,40}$'
$$;
revoke execute on function public.set_ui_pref(text, jsonb) from public, anon;
grant execute on function public.set_ui_pref(text, jsonb) to authenticated;
