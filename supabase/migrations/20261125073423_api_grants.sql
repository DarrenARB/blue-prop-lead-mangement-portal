grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

-- signed-in users: RLS decides which rows
grant select on public.branches, public.profiles, public.branch_owners, public.settings,
  public.lemlist_connection, public.lemlist_users, public.whatsapp_numbers, public.number_events,
  public.audit_log, public.plan_items, public.plan_payments, public.plan_drawdowns to authenticated;
grant insert, update on public.branches to authenticated;
grant update on public.settings to authenticated;
grant update (status, progress, notes, price) on public.plan_items to authenticated;
grant insert, delete on public.plan_payments, public.plan_drawdowns to authenticated;

grant execute on function public.my_profile(), public.is_admin(), public.is_fin_link(), public.has_role(public.app_role),
  public.my_branch_ids(), public.is_active_user(), public.mark_password_changed() to authenticated;
grant execute on function public.portal_is_set_up() to anon, authenticated;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
