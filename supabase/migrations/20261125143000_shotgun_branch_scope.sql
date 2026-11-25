-- Shotgun list by branch.
-- * Main Admins (and Super Admins) see and resolve every entry, company-wide.
-- * Branch Owners see only entries that involve an agent in their branch, and can resolve an entry only when
--   BOTH agents are in their branch (so one branch can't take or hand away another branch's lead).
-- * Releasing a contact also stops the first agent's unsent/ongoing messages to that person, so two agents
--   never message the same person.

create or replace function public.can_resolve_shotgun(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (
    public.has_role('owner') and exists (
      select 1 from public.shotgun s
      join public.profiles h on h.id = s.holder_agent_id
      join public.profiles t on t.id = s.tried_agent_id
      where s.id = p_id
        and h.branch_id in (select public.my_branch_ids())
        and t.branch_id in (select public.my_branch_ids())));
$$;
revoke execute on function public.can_resolve_shotgun(uuid) from public, anon;
grant execute on function public.can_resolve_shotgun(uuid) to authenticated;

create or replace function public.resolve_shotgun(p_id uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.shotgun; nm text; cname text;
begin
  if p_action not in ('keep','release') then raise exception 'Choose keep or release'; end if;
  if not public.can_resolve_shotgun(p_id) then
    raise exception 'Only a Main Admin can decide this one: the two agents are in different branches.';
  end if;
  select * into s from public.shotgun where id = p_id and outcome is null for update;
  if s.id is null then raise exception 'Entry not found or already resolved'; end if;
  if p_action = 'release' then
    if s.tried_campaign_id is not null then
      insert into public.leads (campaign_id, contact_id, agent_id) values (s.tried_campaign_id, s.contact_id, s.tried_agent_id)
      on conflict (campaign_id, contact_id) do nothing;
    end if;
    -- the first agent stops messaging this person (anything not yet answered or finished)
    update public.leads set state = 'stopped'
    where contact_id = s.contact_id and agent_id = s.holder_agent_id and state in ('ready','queued','sent','delivered','read');
  end if;
  update public.shotgun set outcome = case when p_action = 'keep' then 'kept' else 'released' end, resolved_by = auth.uid(), resolved_at = now() where id = p_id;
  select full_name into nm from public.profiles where id = auth.uid();
  select coalesce(nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), ''), 'contact ending ' || right(phone_e164, 4)) into cname from public.contacts where id = s.contact_id;
  insert into public.audit_log (actor_id, actor_name, type, summary, data)
  values (auth.uid(), nm, 'shotgun',
    case when p_action = 'keep' then 'Kept ' || cname || ' with ' || (select full_name from public.profiles where id = s.holder_agent_id)
         else 'Released ' || cname || ' to ' || (select full_name from public.profiles where id = s.tried_agent_id) end,
    to_jsonb(s));
end $$;
revoke execute on function public.resolve_shotgun(uuid, text) from public, anon;
grant execute on function public.resolve_shotgun(uuid, text) to authenticated;

-- Owners: only entries involving an agent in their branch (unchanged rule, restated for clarity).
drop policy if exists shotgun_read on public.shotgun;
create policy shotgun_read on public.shotgun for select to authenticated using (
  public.is_admin() or holder_agent_id = auth.uid() or tried_agent_id = auth.uid()
  or (public.has_role('owner') and exists (
      select 1 from public.profiles p where p.id in (holder_agent_id, tried_agent_id) and p.branch_id in (select public.my_branch_ids()))));

-- One call for the Shotgun page: the entries this person may see, with names and branches filled in,
-- the other branch's campaign name hidden, and whether they may decide it.
create or replace function public.list_shotgun() returns table (
  id uuid, contact_id uuid, contact_name text, contact_phone text, contact_suburb text,
  holder_agent_id uuid, holder_name text, holder_branch text, holder_campaign text, last_contacted_at timestamptz,
  tried_agent_id uuid, tried_name text, tried_branch text, tried_campaign text, tried_at timestamptz,
  free_from date, outcome text, resolved_by_name text, resolved_at timestamptz, can_resolve boolean, same_branch boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.contact_id,
    nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), ''), c.phone_e164, c.suburb,
    s.holder_agent_id, h.full_name, hb.name, case when public.can_see_campaign(s.holder_campaign_id) then hc.name end, s.last_contacted_at,
    s.tried_agent_id, t.full_name, tb.name, case when public.can_see_campaign(s.tried_campaign_id) then tc.name end, s.tried_at,
    s.free_from, s.outcome, r.full_name, s.resolved_at,
    s.outcome is null and public.can_resolve_shotgun(s.id),
    h.branch_id is not distinct from t.branch_id
  from public.shotgun s
  join public.contacts c on c.id = s.contact_id
  join public.profiles h on h.id = s.holder_agent_id
  join public.profiles t on t.id = s.tried_agent_id
  left join public.branches hb on hb.id = h.branch_id
  left join public.branches tb on tb.id = t.branch_id
  left join public.campaigns hc on hc.id = s.holder_campaign_id
  left join public.campaigns tc on tc.id = s.tried_campaign_id
  left join public.profiles r on r.id = s.resolved_by
  where public.is_admin()
     or (public.has_role('owner') and (h.branch_id in (select public.my_branch_ids()) or t.branch_id in (select public.my_branch_ids())))
  order by s.tried_at desc
  limit 1000;
$$;
revoke execute on function public.list_shotgun() from public, anon;
grant execute on function public.list_shotgun() to authenticated;
