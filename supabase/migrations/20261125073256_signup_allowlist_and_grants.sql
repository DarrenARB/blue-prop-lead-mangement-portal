create table private.allowed_signups (email text primary key, created_at timestamptz not null default now());

create or replace function public.block_open_signup() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if exists (select 1 from private.allowed_signups where email = lower(new.email) and created_at > now() - interval '10 minutes') then
    delete from private.allowed_signups where email = lower(new.email);
    return new;
  end if;
  raise exception 'Sign-ups are invite-only';
end $$;

-- called by the admin-users function (service role) just before it creates an account
create or replace function public.allow_signup(e text) returns void
language sql security definer set search_path = public, private as $$
  insert into private.allowed_signups (email) values (lower(e))
  on conflict (email) do update set created_at = now();
$$;
revoke execute on function public.allow_signup(text) from public, anon, authenticated;
grant execute on function public.allow_signup(text) to service_role;
grant execute on function public.check_internal_key(text) to service_role;
