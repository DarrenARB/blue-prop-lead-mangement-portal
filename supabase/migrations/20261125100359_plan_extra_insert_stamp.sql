create or replace function public.plan_item_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.scope = 'extra' and (new.code is null or new.code = '') then
    select 'EXT-' || lpad((coalesce(max(substring(code from 5)::int), 0) + 1)::text, 2, '0')
      into new.code from public.plan_items where code ~ '^EXT-[0-9]+$';
    new.sort := 1000 + substring(new.code from 5)::int;
  end if;
  if new.scope = 'extra' then new.grp := coalesce(nullif(new.grp, ''), 'extra'); end if;
  if new.added_by is null then
    select full_name into new.added_by from public.profiles where id = auth.uid();
  end if;
  -- same stamping as updates
  if new.status in ('built','signed_off') then new.progress := 100; new.built_at := coalesce(new.built_at, now()); end if;
  if new.status = 'signed_off' then new.signed_off_at := coalesce(new.signed_off_at, now()); end if;
  if new.status = 'not_started' then new.progress := 0; end if;
  return new;
end $$;
