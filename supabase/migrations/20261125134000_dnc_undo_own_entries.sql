-- Agents can always undo entries they added themselves; AI entries only for people they're talking to.
create or replace function public.can_remove_dnc(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.dnc d
     where d.id = p_id and public.is_active_user() and (
       public.is_admin() or public.has_role('owner') or d.added_by = auth.uid()
       or (d.source = 'ai_opt_out' and exists (
            select 1 from public.contacts c
             where c.phone_e164 = d.phone_e164 and (
               exists (select 1 from public.conversations v where v.contact_id = c.id and v.agent_id = auth.uid())
               or exists (select 1 from public.leads l where l.contact_id = c.id and l.agent_id = auth.uid()))))
     )
  )
$$;
