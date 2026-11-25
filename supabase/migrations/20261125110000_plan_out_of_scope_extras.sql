-- Out-of-scope extras: work added beyond the 56 agreed stories. Same status tracking, kept out of the project-value totals.
create type public.plan_scope as enum ('in_scope', 'extra');

alter table public.plan_items
  add column scope public.plan_scope not null default 'in_scope',
  add column benefit text,                 -- why it was added / what it improves
  add column related_code text,            -- the in-scope story it builds on, if any
  add column billing text not null default 'not_charged' check (billing in ('not_charged', 'chargeable', 'internal')),
  add column added_at timestamptz not null default now(),
  add column added_by text;

-- EXT-01, EXT-02 … assigned automatically (BEFORE trigger runs before the primary key's not-null check)
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
  if new.status in ('built','signed_off') then new.progress := 100; new.built_at := coalesce(new.built_at, now()); end if;
  if new.status = 'signed_off' then new.signed_off_at := coalesce(new.signed_off_at, now()); end if;
  if new.status = 'not_started' then new.progress := 0; end if;
  return new;
end $$;
create trigger plan_item_code before insert on public.plan_items for each row execute function public.plan_item_code();
revoke execute on function public.plan_item_code() from public, anon, authenticated;

create or replace function public.audit_plan_extra() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.scope = 'extra' then
    insert into public.audit_log (actor_id, actor_name, type, summary, data)
    values (auth.uid(), coalesce(new.added_by, 'Fin-Link'), 'plan_items', 'Added out-of-scope extra ' || new.code || ': ' || new.title, to_jsonb(new));
  end if;
  return new;
end $$;
create trigger audit_plan_extra after insert on public.plan_items for each row execute function public.audit_plan_extra();
revoke execute on function public.audit_plan_extra() from public, anon, authenticated;

-- Fin-Link can add, edit and remove extras (never in-scope stories)
create policy plan_items_insert_extra on public.plan_items for insert to authenticated
  with check (public.is_fin_link() and scope = 'extra');
create policy plan_items_delete_extra on public.plan_items for delete to authenticated
  using (public.is_fin_link() and scope = 'extra');
grant insert (code, grp, screen, title, detail, benefit, related_code, billing, price, status, progress, notes, scope) on public.plan_items to authenticated;
grant update (title, detail, benefit, related_code, billing) on public.plan_items to authenticated;
grant delete on public.plan_items to authenticated;
