-- Admin resolves a contested contact: keep it with the agent who messaged first, or release it to the agent who tried to add it.
create or replace function public.resolve_shotgun(p_id uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.shotgun; nm text; cname text;
begin
  if not public.is_admin() then raise exception 'Only admins can resolve the Shotgun list'; end if;
  if p_action not in ('keep','release') then raise exception 'Choose keep or release'; end if;
  select * into s from public.shotgun where id = p_id and outcome is null for update;
  if s.id is null then raise exception 'Entry not found or already resolved'; end if;
  if p_action = 'release' and s.tried_campaign_id is not null then
    insert into public.leads (campaign_id, contact_id, agent_id) values (s.tried_campaign_id, s.contact_id, s.tried_agent_id)
    on conflict (campaign_id, contact_id) do nothing;
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
