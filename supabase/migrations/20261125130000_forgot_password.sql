-- Forgot password. Until email sending is switched on, a request is logged for admins, who reset the password and
-- share a temporary one (admin-users reset_password marks the request done). Once settings.email_enabled is on,
-- the sign-in page sends Supabase's reset email instead.
alter table public.settings add column if not exists email_enabled boolean not null default false;

create table public.password_help_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);
create index password_help_open on public.password_help_requests(profile_id) where resolved_at is null;
alter table public.password_help_requests enable row level security;
create policy pw_help_admin_read on public.password_help_requests for select to authenticated using (public.is_admin());
grant select on public.password_help_requests to authenticated;
grant all on public.password_help_requests to service_role;

-- Anyone on the sign-in page can ask. The answer never reveals whether the email has an account,
-- and repeat requests within an hour are ignored.
create or replace function public.request_password_help(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid; nm text;
begin
  select id, full_name into pid, nm from public.profiles where lower(email) = lower(trim(p_email)) and status = 'active';
  if pid is null then return; end if;
  if exists (select 1 from public.password_help_requests where profile_id = pid and resolved_at is null and requested_at > now() - interval '1 hour') then return; end if;
  insert into public.password_help_requests (profile_id) values (pid);
  insert into public.audit_log (actor_id, actor_name, type, summary) values (pid, nm, 'people', nm || ' asked for help with their password');
end $$;
revoke execute on function public.request_password_help(text) from public;
grant execute on function public.request_password_help(text) to anon, authenticated;

-- Tells the sign-in page which way forgot-password works right now (no other settings are exposed).
create or replace function public.password_reset_mode() returns text
language sql stable security definer set search_path = public as $$
  select case when email_enabled then 'email' else 'admin' end from public.settings where id = 1
$$;
revoke execute on function public.password_reset_mode() from public;
grant execute on function public.password_reset_mode() to anon, authenticated;

-- Only Super Admins switch email sending on (it depends on the email setup).
create or replace function public.guard_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_fin_link() and
     (new.project_value is distinct from old.project_value or new.show_support_contact is distinct from old.show_support_contact
      or new.email_enabled is distinct from old.email_enabled) then
    raise exception 'Only a Super Admin can change that setting';
  end if;
  return new;
end $$;
