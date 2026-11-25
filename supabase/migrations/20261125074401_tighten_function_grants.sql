alter function public.plan_item_stamp() set search_path = public;

-- trigger functions: nobody calls these directly
revoke execute on function public.audit_row(), public.block_open_signup(), public.plan_item_stamp() from public, anon, authenticated;

-- RLS helpers: signed-in users only (RLS needs them), never anonymous
revoke execute on function public.my_profile(), public.is_admin(), public.is_fin_link(), public.has_role(public.app_role),
  public.my_branch_ids(), public.is_active_user(), public.mark_password_changed() from public, anon;
grant execute on function public.my_profile(), public.is_admin(), public.is_fin_link(), public.has_role(public.app_role),
  public.my_branch_ids(), public.is_active_user(), public.mark_password_changed() to authenticated;

-- intentionally public: the first-run screen asks whether the portal is set up (returns true/false only)
grant execute on function public.portal_is_set_up() to anon, authenticated;

alter default privileges in schema public revoke execute on functions from public;
