-- ===== Types =====
create type public.app_role as enum ('admin','owner','agent','support');
create type public.user_status as enum ('active','deactivated');
create type public.plan_status as enum ('not_started','in_progress','built','signed_off');

-- ===== Core tables =====
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index branches_name_active on public.branches (lower(name)) where archived_at is null;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role public.app_role not null,
  branch_id uuid references public.branches(id),
  is_fin_link boolean not null default false,
  status public.user_status not null default 'active',
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.branch_owners (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  primary key (owner_id, branch_id)
);

create table public.settings (
  id int primary key default 1 check (id = 1),
  hot_threshold int not null default 70,
  shotgun_months int not null default 3,
  window_days int[] not null default '{1,2,3,4,5}',
  window_start text not null default '07:30',
  window_end text not null default '18:00',
  timezone text not null default 'Africa/Johannesburg'
);
insert into public.settings (id) values (1);

-- ===== lemlist =====
create table public.lemlist_connection (
  id int primary key default 1 check (id = 1),
  team_name text,
  status text not null default 'unknown',   -- unknown | ok | error
  last_error text,
  checked_at timestamptz,
  last_sync_at timestamptz
);
insert into public.lemlist_connection (id) values (1);

create table public.lemlist_users (
  id text primary key,                 -- usr_...
  name text,
  email text,
  connected boolean not null default true,
  diagnostics jsonb not null default '[]',
  synced_at timestamptz,
  connected_at timestamptz default now()
);

create table public.whatsapp_numbers (
  id text primary key,                 -- uwa_...
  lemlist_user_id text not null references public.lemlist_users(id) on delete cascade,
  profile_label text,
  phone_e164 text,                     -- replaced by encrypted columns in 20261125080457
  agent_id uuid unique references public.profiles(id) on delete set null,
  status text not null default 'unknown', -- ok | disconnected | linked_elsewhere | licence_missing | issue | removed | unknown
  diagnostics jsonb not null default '[]',
  last_checked_at timestamptz,
  status_changed_at timestamptz default now()
);

create table public.number_events (
  id bigserial primary key,
  number_id text not null references public.whatsapp_numbers(id) on delete cascade,
  kind text not null,                  -- status_change | reconnected | note
  from_status text,
  to_status text,
  note text,
  by_user uuid references public.profiles(id),
  at timestamptz not null default now()
);

-- ===== Audit =====
create table public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_name text,
  type text not null,
  summary text not null,
  data jsonb
);

-- ===== Project plan (Fin-Link) =====
create table public.plan_items (
  code text primary key,
  grp text not null,                   -- foundation | agent | admin | owner | support
  screen text,
  title text not null,
  detail text,
  price numeric(12,2) not null default 0,
  status public.plan_status not null default 'not_started',
  progress int not null default 0 check (progress between 0 and 100),
  notes text,
  sort int not null default 0,
  built_at timestamptz,
  signed_off_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.plan_payments (
  id uuid primary key default gen_random_uuid(),
  received_on date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.plan_drawdowns (
  id uuid primary key default gen_random_uuid(),
  taken_on date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- ===== Private config (not exposed through the API) =====
create schema if not exists private;
create table private.app_config (key text primary key, value text not null);
insert into private.app_config values ('internal_key', encode(extensions.gen_random_bytes(32), 'hex'));
revoke all on schema private from anon, authenticated;

-- ===== Helper functions =====
create or replace function public.my_profile() returns public.profiles
language sql stable security definer set search_path = public as $$
  select * from public.profiles where id = auth.uid() and status = 'active'
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active' and (role = 'admin' or is_fin_link))
$$;

create or replace function public.is_fin_link() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active' and is_fin_link)
$$;

create or replace function public.has_role(r public.app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active' and role = r)
$$;

create or replace function public.my_branch_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select branch_id from public.branch_owners where owner_id = auth.uid()
  union select branch_id from public.profiles where id = auth.uid() and branch_id is not null
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active')
$$;

-- user clears their own first-login flag after changing password
create or replace function public.mark_password_changed() returns void
language sql security definer set search_path = public as $$
  update public.profiles set must_change_password = false, updated_at = now() where id = auth.uid()
$$;

-- is the portal set up yet (used by the first-run screen, callable without login)
create or replace function public.portal_is_set_up() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles)
$$;
grant execute on function public.portal_is_set_up() to anon, authenticated;

-- internal key check for scheduled jobs (service role only)
create or replace function public.check_internal_key(k text) returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from private.app_config where key = 'internal_key' and value = k)
$$;
revoke execute on function public.check_internal_key(text) from anon, authenticated, public;

-- ===== Block open sign-ups: only accounts created by the portal =====
-- (replaced by an allowlist version in 20261125073256)
create or replace function public.block_open_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_app_meta_data->>'portal', '') <> 'true' then
    raise exception 'Sign-ups are invite-only';
  end if;
  return new;
end $$;
create trigger block_open_signup before insert on auth.users
  for each row execute function public.block_open_signup();

-- ===== Audit triggers =====
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who uuid := auth.uid();
  nm text;
  summ text;
begin
  select full_name into nm from public.profiles where id = who;
  if tg_table_name = 'branches' then
    summ := case
      when tg_op = 'INSERT' then 'Added branch ' || new.name
      when tg_op = 'UPDATE' and old.archived_at is null and new.archived_at is not null then 'Archived branch ' || new.name
      when tg_op = 'UPDATE' and old.archived_at is not null and new.archived_at is null then 'Restored branch ' || new.name
      when tg_op = 'UPDATE' and old.name <> new.name then 'Renamed branch ' || old.name || ' to ' || new.name
      else null end;
  elsif tg_table_name = 'plan_items' then
    if tg_op = 'UPDATE' and old.status <> new.status then
      summ := new.code || ' moved from ' || replace(old.status::text,'_',' ') || ' to ' || replace(new.status::text,'_',' ');
    end if;
  elsif tg_table_name = 'plan_payments' then
    summ := case when tg_op = 'INSERT' then 'Recorded client payment of R' || to_char(new.amount,'FM999G999G990D00')
                 when tg_op = 'DELETE' then 'Removed client payment of R' || to_char(old.amount,'FM999G999G990D00') end;
  elsif tg_table_name = 'plan_drawdowns' then
    summ := case when tg_op = 'INSERT' then 'Recorded drawdown of R' || to_char(new.amount,'FM999G999G990D00')
                 when tg_op = 'DELETE' then 'Removed drawdown of R' || to_char(old.amount,'FM999G999G990D00') end;
  end if;
  if summ is not null then
    insert into public.audit_log (actor_id, actor_name, type, summary, data)
    values (who, coalesce(nm, 'System'), tg_table_name, summ,
            case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end);
  end if;
  return coalesce(new, old);
end $$;

create trigger audit_branches after insert or update on public.branches for each row execute function public.audit_row();
create trigger audit_plan_items after update on public.plan_items for each row execute function public.audit_row();
create trigger audit_plan_payments after insert or delete on public.plan_payments for each row execute function public.audit_row();
create trigger audit_plan_drawdowns after insert or delete on public.plan_drawdowns for each row execute function public.audit_row();

-- stamp built / signed-off dates on plan items
create or replace function public.plan_item_stamp() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if new.status in ('built','signed_off') then new.progress := 100; end if;
  if new.status = 'not_started' then new.progress := 0; end if;
  if new.status in ('built','signed_off') and new.built_at is null then new.built_at := now(); end if;
  if new.status = 'signed_off' and new.signed_off_at is null then new.signed_off_at := now(); end if;
  if new.status not in ('built','signed_off') then new.built_at := null; end if;
  if new.status <> 'signed_off' then new.signed_off_at := null; end if;
  return new;
end $$;
create trigger plan_item_stamp before update on public.plan_items for each row execute function public.plan_item_stamp();

-- ===== RLS =====
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.branch_owners enable row level security;
alter table public.settings enable row level security;
alter table public.lemlist_connection enable row level security;
alter table public.lemlist_users enable row level security;
alter table public.whatsapp_numbers enable row level security;
alter table public.number_events enable row level security;
alter table public.audit_log enable row level security;
alter table public.plan_items enable row level security;
alter table public.plan_payments enable row level security;
alter table public.plan_drawdowns enable row level security;

-- branches: every signed-in user can read; admins write
create policy branches_read on public.branches for select to authenticated using (public.is_active_user());
create policy branches_insert on public.branches for insert to authenticated with check (public.is_admin());
create policy branches_update on public.branches for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- profiles: self; admins & support all; owners their branches. Writes go through the admin-users function.
create policy profiles_read on public.profiles for select to authenticated using (
  id = auth.uid() or public.is_admin() or public.has_role('support')
  or (public.has_role('owner') and branch_id in (select public.my_branch_ids()))
);

create policy branch_owners_read on public.branch_owners for select to authenticated using (public.is_active_user());

create policy settings_read on public.settings for select to authenticated using (public.is_active_user());
create policy settings_update on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- lemlist: admins & support see everything; owners numbers in their branches; agents their own number
create policy lemlist_conn_read on public.lemlist_connection for select to authenticated using (public.is_admin() or public.has_role('support'));
create policy lemlist_users_read on public.lemlist_users for select to authenticated using (public.is_admin() or public.has_role('support'));
create policy numbers_read on public.whatsapp_numbers for select to authenticated using (
  public.is_admin() or public.has_role('support') or agent_id = auth.uid()
  or (public.has_role('owner') and agent_id in (select id from public.profiles where branch_id in (select public.my_branch_ids())))
);
create policy number_events_read on public.number_events for select to authenticated using (public.is_admin() or public.has_role('support'));

create policy audit_read on public.audit_log for select to authenticated using (public.is_admin());

-- project plan: admins (client) read progress; only Fin-Link edits; money is Fin-Link only
create policy plan_items_read on public.plan_items for select to authenticated using (public.is_admin());
create policy plan_items_update on public.plan_items for update to authenticated using (public.is_fin_link()) with check (public.is_fin_link());
create policy payments_all on public.plan_payments for all to authenticated using (public.is_fin_link()) with check (public.is_fin_link());
create policy drawdowns_all on public.plan_drawdowns for all to authenticated using (public.is_fin_link()) with check (public.is_fin_link());

-- Fin-Link must not be grantable by anyone through the API
revoke update (is_fin_link) on public.profiles from authenticated;
