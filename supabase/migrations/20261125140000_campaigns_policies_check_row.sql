-- Creating a campaign failed: the read rule looked the campaign up by id, which can't see the row being inserted.
-- The rules now check the row's own agent/branch, so "create and return the new draft" works.
drop policy if exists campaigns_read on public.campaigns;
drop policy if exists campaigns_update on public.campaigns;
drop policy if exists campaigns_delete on public.campaigns;
create policy campaigns_read on public.campaigns for select to authenticated using (
  public.is_active_user() and (
    public.is_admin() or agent_id = auth.uid()
    or (public.has_role('owner') and branch_id in (select public.my_branch_ids()))
  ));
create policy campaigns_update on public.campaigns for update to authenticated
  using (public.is_active_user() and (public.is_admin() or agent_id = auth.uid()))
  with check (public.is_active_user() and (public.is_admin() or agent_id = auth.uid()));
create policy campaigns_delete on public.campaigns for delete to authenticated
  using (public.is_active_user() and (public.is_admin() or agent_id = auth.uid()) and status = 'draft');
