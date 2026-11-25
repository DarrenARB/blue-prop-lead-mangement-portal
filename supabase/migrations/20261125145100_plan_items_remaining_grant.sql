-- plan_items uses column-level grants: the new "remaining" column must be granted too,
-- otherwise every save from the plan's Update window is refused.
grant insert (remaining), update (remaining) on public.plan_items to authenticated;

-- built / signed off: nothing left to do
create or replace function public.plan_item_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if new.status in ('built','signed_off') then new.progress := 100; new.remaining := null; end if;
  if new.status = 'not_started' then new.progress := 0; end if;
  if new.status in ('built','signed_off') and new.built_at is null then new.built_at := now(); end if;
  if new.status = 'signed_off' and new.signed_off_at is null then new.signed_off_at := now(); end if;
  if new.status not in ('built','signed_off') then new.built_at := null; end if;
  if new.status <> 'signed_off' then new.signed_off_at := null; end if;
  return new;
end $$;
