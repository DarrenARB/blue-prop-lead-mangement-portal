-- ===== Campaigns (portal side; lemlist IDs filled in at launch) =====
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles(id),
  branch_id uuid references public.branches(id),
  number_id text references public.whatsapp_numbers(id) on delete set null,
  name text not null,
  goal text,                                  -- valuation | rental | buyers | listings | other
  status text not null default 'draft' check (status in ('draft','launching','running','paused','stopped','ended','blocked')),
  wizard_step int not null default 1,
  brief jsonb not null default '{}',          -- audience, offer, tone
  schedule jsonb not null default '{}',       -- days, start, end, delays
  lemlist_campaign_id text unique,
  lemlist_sequence_id text,
  lemlist_schedule_id text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  launched_at timestamptz
);
create index campaigns_agent on public.campaigns(agent_id);
create index campaigns_branch on public.campaigns(branch_id);

create table public.campaign_messages (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  position int not null check (position between 1 and 3),
  body text not null default '',
  delay_days int not null default 0,
  lemlist_step_id text,
  primary key (campaign_id, position)
);

-- ===== Contacts & leads =====
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  first_name text,
  last_name text,
  suburb text,
  extra jsonb not null default '{}',
  lemlist_contact_id text,
  created_at timestamptz not null default now()
);

create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  filename text,
  total_rows int not null default 0,
  added int not null default 0,
  rejected jsonb not null default '{}',       -- counts by reason
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  upload_id uuid references public.uploads(id) on delete set null,
  agent_id uuid not null references public.profiles(id),
  state text not null default 'ready' check (state in ('ready','queued','sent','delivered','read','replied','failed','stopped','removed')),
  current_step int not null default 0,
  lemlist_lead_id text,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, contact_id)
);
create index leads_contact on public.leads(contact_id);
create index leads_agent on public.leads(agent_id);

create table public.upload_rejections (
  id bigserial primary key,
  upload_id uuid not null references public.uploads(id) on delete cascade,
  row_no int,
  phone_raw text,
  name text,
  reason text not null check (reason in ('invalid_number','duplicate','dnc','shotgun','already_in_campaign')),
  detail text
);

-- ===== Do Not Contact =====
create table public.dnc (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  name text,
  reason text,
  source text not null default 'manual' check (source in ('manual','bulk','inbox','ai_opt_out','upload')),
  needs_review boolean not null default false,
  added_by uuid default auth.uid(),
  added_by_name text,
  created_at timestamptz not null default now(),
  lemlist_synced_at timestamptz
);

-- ===== Shotgun list (contacts held because another agent messaged them within the cooldown) =====
create table public.shotgun (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  holder_agent_id uuid not null references public.profiles(id),
  holder_campaign_id uuid references public.campaigns(id) on delete set null,
  last_contacted_at timestamptz not null,
  tried_agent_id uuid not null references public.profiles(id),
  tried_campaign_id uuid references public.campaigns(id) on delete cascade,
  tried_at timestamptz not null default now(),
  free_from date not null,
  outcome text check (outcome in ('kept','released')),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz
);
create unique index shotgun_open_unique on public.shotgun (contact_id, tried_campaign_id) where outcome is null;

-- ===== RLS =====
alter table public.campaigns enable row level security;
alter table public.campaign_messages enable row level security;
alter table public.contacts enable row level security;
alter table public.uploads enable row level security;
alter table public.leads enable row level security;
alter table public.upload_rejections enable row level security;
alter table public.dnc enable row level security;
alter table public.shotgun enable row level security;

-- who can see a campaign: its agent, owners of its branch, admins
create or replace function public.can_see_campaign(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.campaigns x
     where x.id = c and public.is_active_user() and (
       public.is_admin() or x.agent_id = auth.uid()
       or (public.has_role('owner') and x.branch_id in (select public.my_branch_ids()))
     )
  )
$$;
create or replace function public.can_edit_campaign(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.campaigns x where x.id = c and public.is_active_user() and (public.is_admin() or x.agent_id = auth.uid()))
$$;
revoke execute on function public.can_see_campaign(uuid), public.can_edit_campaign(uuid) from public, anon;
grant execute on function public.can_see_campaign(uuid), public.can_edit_campaign(uuid) to authenticated;

create policy campaigns_read on public.campaigns for select to authenticated using (public.can_see_campaign(id));
create policy campaigns_insert on public.campaigns for insert to authenticated with check (
  public.is_active_user() and (public.is_admin() or agent_id = auth.uid()) and status = 'draft'
);
create policy campaigns_update on public.campaigns for update to authenticated using (public.can_edit_campaign(id)) with check (public.can_edit_campaign(id));
create policy campaigns_delete on public.campaigns for delete to authenticated using (public.can_edit_campaign(id) and status = 'draft');

create policy cm_read on public.campaign_messages for select to authenticated using (public.can_see_campaign(campaign_id));
create policy cm_write on public.campaign_messages for all to authenticated using (public.can_edit_campaign(campaign_id)) with check (public.can_edit_campaign(campaign_id));

create policy uploads_read on public.uploads for select to authenticated using (public.can_see_campaign(campaign_id));
create policy rejections_read on public.upload_rejections for select to authenticated using (
  exists (select 1 from public.uploads u where u.id = upload_id and public.can_see_campaign(u.campaign_id)));
create policy leads_read on public.leads for select to authenticated using (public.can_see_campaign(campaign_id));
create policy contacts_read on public.contacts for select to authenticated using (
  public.is_admin() or exists (select 1 from public.leads l where l.contact_id = contacts.id and public.can_see_campaign(l.campaign_id)));

-- DNC: everyone signed in can read (needed to explain upload results); admins add; admins + owners remove (with a reason, via function)
create policy dnc_read on public.dnc for select to authenticated using (public.is_active_user());
create policy dnc_insert on public.dnc for insert to authenticated with check (public.is_admin() or public.has_role('owner') or public.has_role('agent'));

create policy shotgun_read on public.shotgun for select to authenticated using (
  public.is_admin() or holder_agent_id = auth.uid() or tried_agent_id = auth.uid()
  or (public.has_role('owner') and exists (select 1 from public.profiles p where p.id in (holder_agent_id, tried_agent_id) and p.branch_id in (select public.my_branch_ids()))));

grant select, insert, update, delete on public.campaigns, public.campaign_messages to authenticated;
grant select on public.contacts, public.uploads, public.leads, public.upload_rejections, public.shotgun to authenticated;
grant select, insert on public.dnc to authenticated;
grant all on public.campaigns, public.campaign_messages, public.contacts, public.uploads, public.leads, public.upload_rejections, public.dnc, public.shotgun to service_role;
grant usage, select on sequence public.upload_rejections_id_seq to service_role;

-- campaigns: keep updated_at fresh and branch in step with the agent
create or replace function public.campaign_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' or new.agent_id is distinct from old.agent_id then
    select branch_id into new.branch_id from public.profiles where id = new.agent_id;
    select id into new.number_id from public.whatsapp_numbers where agent_id = new.agent_id;
  end if;
  return new;
end $$;
create trigger campaign_touch before insert or update on public.campaigns for each row execute function public.campaign_touch();
revoke execute on function public.campaign_touch() from public, anon, authenticated;

-- DNC removal: admins and Branch Owners, reason required, always logged
create or replace function public.remove_dnc(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.dnc; nm text;
begin
  if not (public.is_admin() or public.has_role('owner')) then raise exception 'Only Branch Owners and admins can remove someone from Do Not Contact'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  delete from public.dnc where id = p_id returning * into r;
  if r.id is null then raise exception 'Entry not found'; end if;
  select full_name into nm from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_id, actor_name, type, summary, data)
  values (auth.uid(), nm, 'dnc', 'Removed ' || coalesce(r.name, 'a contact') || ' (number ending ' || right(r.phone_e164, 4) || ') from Do Not Contact: ' || trim(p_reason), to_jsonb(r));
end $$;
revoke execute on function public.remove_dnc(uuid, text) from public, anon;
grant execute on function public.remove_dnc(uuid, text) to authenticated;

-- DNC additions are logged
create or replace function public.audit_dnc_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  select full_name into nm from public.profiles where id = auth.uid();
  new.added_by_name := coalesce(new.added_by_name, nm);
  return new;
end $$;
create trigger dnc_name before insert on public.dnc for each row execute function public.audit_dnc_insert();
create or replace function public.audit_dnc_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor_id, actor_name, type, summary, data)
  values (auth.uid(), coalesce(new.added_by_name, 'System'), 'dnc', 'Added ' || coalesce(new.name, 'a contact') || ' (number ending ' || right(new.phone_e164, 4) || ') to Do Not Contact' || coalesce(': ' || new.reason, ''), jsonb_build_object('source', new.source));
  return new;
end $$;
create trigger dnc_audit after insert on public.dnc for each row execute function public.audit_dnc_after();
revoke execute on function public.audit_dnc_insert(), public.audit_dnc_after() from public, anon, authenticated;
