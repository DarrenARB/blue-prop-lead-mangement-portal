-- Contacts can carry an email (lemlist leads often have one); Do Not Contact can match on it too.
alter table public.contacts add column if not exists email text;
create index if not exists contacts_email on public.contacts (lower(email));
alter table public.dnc add column if not exists email text;
alter table public.dnc add column if not exists contact_id uuid references public.contacts(id) on delete set null;
alter table public.dnc add column if not exists reviewed_at timestamptz;
alter table public.dnc add column if not exists reviewed_by uuid references public.profiles(id);
create index if not exists dnc_email on public.dnc (lower(email));

-- Searchable list of the people this user can see (their own leads and conversations; admins see everyone).
create or replace function public.search_contacts(p_q text, p_limit int default 20)
returns table (id uuid, first_name text, last_name text, phone_e164 text, email text, suburb text, on_dnc boolean, last_seen timestamptz)
language sql stable security definer set search_path = public as $$
  with q as (select trim(coalesce(p_q, '')) as t, regexp_replace(coalesce(p_q, ''), '\D', '', 'g') as d),
  visible as (
    select c.* from public.contacts c
     where public.is_active_user() and (
       public.is_admin()
       or exists (select 1 from public.leads l where l.contact_id = c.id and public.can_see_agent(l.agent_id))
       or exists (select 1 from public.conversations v where v.contact_id = c.id and public.can_see_agent(v.agent_id))
     )
  )
  select c.id, c.first_name, c.last_name, c.phone_e164, c.email, c.suburb,
         exists (select 1 from public.dnc d where d.phone_e164 = c.phone_e164 or (c.email is not null and lower(d.email) = lower(c.email))) as on_dnc,
         greatest((select max(v.last_message_at) from public.conversations v where v.contact_id = c.id), (select max(l.created_at) from public.leads l where l.contact_id = c.id)) as last_seen
    from visible c, q
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

-- Who may take someone off Do Not Contact: admins and Branch Owners always; an agent may undo an entry the AI added
-- or that they added themselves, for a person they're talking to. Always with a reason, always logged.
create or replace function public.can_remove_dnc(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.dnc d
     where d.id = p_id and public.is_active_user() and (
       public.is_admin() or public.has_role('owner')
       or ((d.source = 'ai_opt_out' or d.added_by = auth.uid()) and exists (
            select 1 from public.contacts c
             where c.phone_e164 = d.phone_e164 and (
               exists (select 1 from public.conversations v where v.contact_id = c.id and v.agent_id = auth.uid())
               or exists (select 1 from public.leads l where l.contact_id = c.id and l.agent_id = auth.uid()))))
     )
  )
$$;
revoke execute on function public.can_remove_dnc(uuid) from public, anon;
grant execute on function public.can_remove_dnc(uuid) to authenticated;

create or replace function public.remove_dnc(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.dnc; nm text;
begin
  if not public.can_remove_dnc(p_id) then raise exception 'You can only undo Do Not Contact entries the AI or you added for your own contacts. Ask your Branch Owner or admin.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  delete from public.dnc where id = p_id returning * into r;
  if r.id is null then raise exception 'Entry not found'; end if;
  select full_name into nm from public.profiles where id = auth.uid();
  -- the AI's opt-out flag on their conversation no longer applies
  update public.conversations v set opt_out = false from public.contacts c where c.id = v.contact_id and c.phone_e164 = r.phone_e164;
  insert into public.audit_log (actor_id, actor_name, type, summary, data)
  values (auth.uid(), nm, 'dnc', 'Removed ' || coalesce(r.name, 'a contact') || ' (number ending ' || right(r.phone_e164, 4) || ') from Do Not Contact'
    || case when r.source = 'ai_opt_out' then ' (added by AI)' else '' end || ': ' || trim(p_reason), to_jsonb(r));
end $$;

-- "The AI got it right": keeps the entry and clears the review flag.
create or replace function public.confirm_dnc(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.dnc; nm text;
begin
  if not public.can_remove_dnc(p_id) then raise exception 'Not allowed'; end if;
  update public.dnc set needs_review = false, reviewed_at = now(), reviewed_by = auth.uid() where id = p_id returning * into r;
  select full_name into nm from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_id, actor_name, type, summary, data) values (auth.uid(), nm, 'dnc', 'Confirmed the AI’s Do Not Contact for ' || coalesce(r.name, 'number ending ' || right(r.phone_e164, 4)), to_jsonb(r));
end $$;
revoke execute on function public.confirm_dnc(uuid) from public, anon;
grant execute on function public.confirm_dnc(uuid) to authenticated;

-- Fill in contact/email when the number belongs to a known contact, then stop them in any campaign that hasn't sent to them yet.
create or replace function public.dnc_link_contact() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.contacts;
begin
  new.email := nullif(lower(trim(coalesce(new.email, ''))), '');
  select * into c from public.contacts where phone_e164 = new.phone_e164;
  if c.id is not null then
    new.contact_id := coalesce(new.contact_id, c.id);
    new.email := coalesce(new.email, lower(c.email));
    new.name := coalesce(new.name, nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''));
  end if;
  return new;
end $$;
create trigger dnc_link_contact before insert on public.dnc for each row execute function public.dnc_link_contact();

create or replace function public.dnc_stop_leads() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.leads l set state = 'stopped', last_event_at = now()
    from public.contacts c
   where c.id = l.contact_id and l.state in ('ready', 'queued')
     and (c.phone_e164 = new.phone_e164 or (new.email is not null and lower(c.email) = new.email));
  return new;
end $$;
create trigger dnc_stop_leads after insert on public.dnc for each row execute function public.dnc_stop_leads();
revoke execute on function public.dnc_link_contact(), public.dnc_stop_leads() from public, anon, authenticated;
