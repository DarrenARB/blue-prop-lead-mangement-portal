-- ===== Inbox cache, AI scores, Hot Leads, key dates, raw lemlist events =====
create or replace function public.can_see_agent(a uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and (
    public.is_admin() or a = auth.uid()
    or (public.has_role('owner') and exists (select 1 from public.profiles p where p.id = a and p.branch_id in (select public.my_branch_ids())))
  )
$$;
create or replace function public.can_act_for_agent(a uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and (public.is_admin() or a = auth.uid())
$$;
revoke execute on function public.can_see_agent(uuid), public.can_act_for_agent(uuid) from public, anon;
grant execute on function public.can_see_agent(uuid), public.can_act_for_agent(uuid) to authenticated;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  agent_id uuid not null references public.profiles(id),
  campaign_id uuid references public.campaigns(id) on delete set null,
  number_id text references public.whatsapp_numbers(id) on delete set null,
  last_message_at timestamptz,
  last_preview text,
  last_direction text check (last_direction in ('in','out')),
  unread boolean not null default false,
  archived boolean not null default false,
  score int check (score between 0 and 100),
  score_reason text,
  opt_out boolean not null default false,
  scored_at timestamptz,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  unique (contact_id, agent_id)
);
create index conversations_agent on public.conversations(agent_id, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  agent_id uuid not null references public.profiles(id),
  campaign_id uuid references public.campaigns(id) on delete set null,
  direction text not null check (direction in ('in','out')),
  body text not null default '',
  step int,
  status text,                       -- sent / delivered / read / failed for outgoing
  sent_at timestamptz not null default now(),
  lemlist_activity_id text unique,
  created_at timestamptz not null default now()
);
create index messages_conv on public.messages(conversation_id, sent_at);

create table public.ai_scores (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  agent_id uuid not null references public.profiles(id),
  score int not null check (score between 0 and 100),
  reason text,
  opt_out boolean not null default false,
  model text,
  source_message_id uuid references public.messages(id) on delete set null,
  scored_at timestamptz not null default now()
);

create table public.hot_leads (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references public.conversations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  agent_id uuid not null references public.profiles(id),
  campaign_id uuid references public.campaigns(id) on delete set null,
  source text not null default 'ai' check (source in ('ai','manual')),
  active boolean not null default true,
  note text,
  exported_at timestamptz,
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.key_dates (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles(id) default auth.uid(),
  contact_id uuid references public.contacts(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  title text,                         -- who/what, when there's no contact
  type text not null default 'followup' check (type in ('followup','birthday','lease','anniversary','other')),
  due_on date not null,
  note text,
  yearly boolean not null default false,
  done_at timestamptz,
  snoozed_until date,
  created_at timestamptz not null default now()
);
create index key_dates_agent on public.key_dates(agent_id, due_on);

create table public.lemlist_events (
  id bigserial primary key,
  type text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.ai_scores enable row level security;
alter table public.hot_leads enable row level security;
alter table public.key_dates enable row level security;
alter table public.lemlist_events enable row level security;

create policy conv_read on public.conversations for select to authenticated using (public.can_see_agent(agent_id));
create policy conv_update on public.conversations for update to authenticated using (public.can_act_for_agent(agent_id)) with check (public.can_act_for_agent(agent_id));
create policy msg_read on public.messages for select to authenticated using (public.can_see_agent(agent_id));
create policy score_read on public.ai_scores for select to authenticated using (public.can_see_agent(agent_id));
create policy hot_read on public.hot_leads for select to authenticated using (public.can_see_agent(agent_id));
create policy dates_read on public.key_dates for select to authenticated using (public.can_see_agent(agent_id));
create policy dates_write on public.key_dates for all to authenticated using (public.can_act_for_agent(agent_id)) with check (public.can_act_for_agent(agent_id));
create policy events_fin_link on public.lemlist_events for select to authenticated using (public.is_fin_link());

-- contacts in someone's conversations are visible to whoever can see that conversation
create policy contacts_read_conv on public.contacts for select to authenticated using (
  exists (select 1 from public.conversations c where c.contact_id = contacts.id and public.can_see_agent(c.agent_id)));

grant select on public.conversations, public.messages, public.ai_scores, public.hot_leads, public.lemlist_events to authenticated;
grant update (unread, archived) on public.conversations to authenticated;
grant select, insert, update, delete on public.key_dates to authenticated;
grant all on public.conversations, public.messages, public.ai_scores, public.hot_leads, public.key_dates, public.lemlist_events to service_role;
grant usage, select on sequence public.lemlist_events_id_seq to service_role;

-- Move a lead in or out of Hot Leads by hand (always logged)
create or replace function public.set_hot_lead(p_conversation uuid, p_active boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare cv public.conversations; nm text; cname text;
begin
  select * into cv from public.conversations where id = p_conversation;
  if cv.id is null or not public.can_act_for_agent(cv.agent_id) then raise exception 'You can only change your own leads'; end if;
  insert into public.hot_leads (conversation_id, contact_id, agent_id, campaign_id, source, active, note, changed_by)
  values (cv.id, cv.contact_id, cv.agent_id, cv.campaign_id, 'manual', p_active, nullif(trim(coalesce(p_note,'')), ''), auth.uid())
  on conflict (conversation_id) do update set source = 'manual', active = excluded.active, note = coalesce(excluded.note, hot_leads.note), changed_by = auth.uid(), updated_at = now();
  select full_name into nm from public.profiles where id = auth.uid();
  select coalesce(nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), ''), 'contact ending ' || right(phone_e164, 4)) into cname from public.contacts where id = cv.contact_id;
  insert into public.audit_log (actor_id, actor_name, type, summary, data)
  values (auth.uid(), nm, 'hot_leads', case when p_active then 'Moved ' || cname || ' into Hot Leads' else 'Took ' || cname || ' out of Hot Leads' end
    || coalesce(' (AI score ' || cv.score || ')', '') || coalesce(': ' || nullif(trim(p_note), ''), ''), jsonb_build_object('conversation_id', cv.id));
end $$;
revoke execute on function public.set_hot_lead(uuid, boolean, text) from public, anon;
grant execute on function public.set_hot_lead(uuid, boolean, text) to authenticated;

-- Record that hot leads were exported for the CRM
create or replace function public.mark_exported(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int; nm text;
begin
  update public.hot_leads set exported_at = now() where id = any(p_ids) and public.can_see_agent(agent_id);
  get diagnostics n = row_count;
  select full_name into nm from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_id, actor_name, type, summary) values (auth.uid(), nm, 'export', 'Exported ' || n || ' hot lead' || case when n = 1 then '' else 's' end || ' to Excel');
  return n;
end $$;
revoke execute on function public.mark_exported(uuid[]) from public, anon;
grant execute on function public.mark_exported(uuid[]) to authenticated;

-- Settings changes are logged server-side
create or replace function public.audit_settings() returns trigger
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  select full_name into nm from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_id, actor_name, type, summary, data)
  values (auth.uid(), coalesce(nm, 'System'), 'settings',
    'Rules updated: hot lead from ' || new.hot_threshold || ', Shotgun ' || new.shotgun_months || ' months, sending ' || new.window_start || '–' || new.window_end,
    jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new)));
  return new;
end $$;
create trigger audit_settings after update on public.settings for each row
  when ((old.hot_threshold, old.shotgun_months, old.window_days, old.window_start, old.window_end) is distinct from (new.hot_threshold, new.shotgun_months, new.window_days, new.window_start, new.window_end))
  execute function public.audit_settings();
revoke execute on function public.audit_settings() from public, anon, authenticated;
