-- 1) The Support role becomes Super Admin: Fin-Link developers with full access.
alter type public.app_role rename value 'support' to 'superadmin';

-- Super Admin and the Fin-Link flag always go together
create or replace function public.sync_fin_link() returns trigger
language plpgsql as $$
begin
  new.is_fin_link := (new.role = 'superadmin');
  return new;
end $$;
create trigger sync_fin_link before insert or update of role, is_fin_link on public.profiles
  for each row execute function public.sync_fin_link();
revoke execute on function public.sync_fin_link() from public, anon, authenticated;

update public.profiles set role = 'superadmin' where email = 'darren@linked-up.co.za';

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active' and role in ('admin','superadmin'))
$$;
create or replace function public.is_fin_link() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active' and role = 'superadmin')
$$;

-- 2) Support contacts: who gets alerts, in priority order (replaces alert_recipients, which is left unused)
create table public.support_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  whatsapp text,
  priority int not null default 1,          -- 1 = primary (first line), 2 = secondary, …
  receives_alerts boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.support_contacts enable row level security;
create policy support_contacts_fin_link on public.support_contacts for all to authenticated using (public.is_fin_link()) with check (public.is_fin_link());
grant select, insert, update, delete on public.support_contacts to authenticated;
grant all on public.support_contacts to service_role;

insert into public.support_contacts (name, email, whatsapp, priority) values
  ('Darren Arbuckle', 'darren@linked-up.co.za', '+27783901844', 1),
  ('Ethan Glen-Young', 'ethan@fin-link.io', '+27636828613', 2);

-- 3) Optionally show the first-line contact to everyone in the portal (off until Fin-Link turns it on)
alter table public.settings add column show_support_contact boolean not null default false;

create or replace function public.first_line_support()
returns table (name text, email text, whatsapp text)
language sql stable security definer set search_path = public as $$
  select c.name, c.email, c.whatsapp
    from public.support_contacts c, public.settings s
   where s.id = 1 and public.is_active_user() and (s.show_support_contact or public.is_fin_link())
     and c.active
   order by c.priority, c.created_at
   limit 1
$$;
revoke execute on function public.first_line_support() from public, anon;
grant execute on function public.first_line_support() to authenticated;
