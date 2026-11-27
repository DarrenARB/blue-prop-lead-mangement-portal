-- Counts for the menu badges: only things the signed-in person can act on.
create or replace function public.shotgun_waiting_count() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.shotgun s where s.outcome is null and public.can_resolve_shotgun(s.id);
$$;
create or replace function public.dnc_review_count() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.dnc d where d.needs_review and public.can_remove_dnc(d.id);
$$;
revoke execute on function public.shotgun_waiting_count() from public, anon;
revoke execute on function public.dnc_review_count() from public, anon;
grant execute on function public.shotgun_waiting_count() to authenticated;
grant execute on function public.dnc_review_count() to authenticated;
