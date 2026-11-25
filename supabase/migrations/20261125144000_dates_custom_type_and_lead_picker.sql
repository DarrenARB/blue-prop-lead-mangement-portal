-- Dates: a custom label when the type is "Other", and pick the person from your leads (with whose lead they are).
alter table public.key_dates add column if not exists type_label text check (type_label is null or length(type_label) <= 60);

-- search_contacts now also says whose lead the person is (the agent they were most recently with),
-- so a date set by an admin lands with the right agent.
drop function if exists public.search_contacts(text, int);
create or replace function public.search_contacts(p_q text, p_limit int default 20)
returns table (id uuid, first_name text, last_name text, phone_e164 text, email text, suburb text, on_dnc boolean, last_seen timestamptz, agent_id uuid, agent_name text)
language sql stable security definer set search_path = public as $$
  with q as (select trim(coalesce(p_q, '')) as t, regexp_replace(coalesce(p_q, ''), '\D', '', 'g') as d),
  visible as (
    select c.* from public.contacts c
     where public.is_active_user() and (
       public.is_admin()
       or exists (select 1 from public.leads l where l.contact_id = c.id and public.can_see_agent(l.agent_id))
       or exists (select 1 from public.conversations v where v.contact_id = c.id and public.can_see_agent(v.agent_id))
     )
  ),
  holder as (
    select distinct on (x.contact_id) x.contact_id, x.agent_id from (
      select l.contact_id, l.agent_id, coalesce(l.last_event_at, l.created_at) as at from public.leads l where l.state not in ('stopped','removed') and l.contact_id in (select id from visible)
      union all
      select v.contact_id, v.agent_id, v.last_message_at from public.conversations v where v.contact_id in (select id from visible)
    ) x order by x.contact_id, x.at desc nulls last
  )
  select c.id, c.first_name, c.last_name, c.phone_e164, c.email, c.suburb,
         exists (select 1 from public.dnc d where d.phone_e164 = c.phone_e164 or (c.email is not null and lower(d.email) = lower(c.email))) as on_dnc,
         greatest((select max(v.last_message_at) from public.conversations v where v.contact_id = c.id), (select max(l.created_at) from public.leads l where l.contact_id = c.id)) as last_seen,
         h.agent_id, p.full_name
    from visible c cross join q
    left join holder h on h.contact_id = c.id
    left join public.profiles p on p.id = h.agent_id
   where length(q.t) >= 2 and (
         (coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) ilike '%' || q.t || '%'
      or coalesce(c.email, '') ilike '%' || q.t || '%'
      or coalesce(c.suburb, '') ilike '%' || q.t || '%'
      or (length(q.d) >= 3 and (regexp_replace(c.phone_e164, '\D', '', 'g') like '%' || q.d || '%'
                                or regexp_replace(c.phone_e164, '^\+27', '0') like '%' || q.d || '%'))
   )
   order by last_seen desc nulls last, c.first_name
   limit greatest(1, least(coalesce(p_limit, 20), 50))
$$;
revoke execute on function public.search_contacts(text, int) from public, anon;
grant execute on function public.search_contacts(text, int) to authenticated;
