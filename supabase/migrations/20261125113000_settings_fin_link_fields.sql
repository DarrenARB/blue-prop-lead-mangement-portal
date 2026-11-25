-- Main Admins can change the campaign rules; only Super Admins (Fin-Link) can change the project value or the support-contact toggle.
create or replace function public.guard_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_fin_link() and
     (new.project_value is distinct from old.project_value or new.show_support_contact is distinct from old.show_support_contact) then
    raise exception 'Only a Super Admin can change that setting';
  end if;
  return new;
end $$;
create trigger guard_settings before update on public.settings for each row execute function public.guard_settings();
revoke execute on function public.guard_settings() from public, anon, authenticated;
