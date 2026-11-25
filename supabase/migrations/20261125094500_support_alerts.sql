-- Who gets told when a WhatsApp number has a problem. Fin-Link developers only for now (not the client).
create table public.alert_recipients (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('email','whatsapp')),
  value text not null,
  label text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (channel, value)
);

-- Every number problem raises an alert; delivery (email / WhatsApp) is switched on in a later stage.
create table public.alerts (
  id bigserial primary key,
  number_id text references public.whatsapp_numbers(id) on delete set null,
  kind text not null,                 -- disconnected | linked_elsewhere | licence_missing | issue | removed | recovered
  summary text not null,
  recipients jsonb not null default '[]',
  delivery text not null default 'queued',   -- queued | sent | failed | not_needed
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

alter table public.alert_recipients enable row level security;
alter table public.alerts enable row level security;
create policy alert_recipients_fin_link on public.alert_recipients for all to authenticated using (public.is_fin_link()) with check (public.is_fin_link());
create policy alerts_read on public.alerts for select to authenticated using (public.is_fin_link() or public.has_role('support'));

grant select, insert, update, delete on public.alert_recipients to authenticated;
grant select on public.alerts to authenticated;
grant all on public.alert_recipients, public.alerts to service_role;
grant usage, select on sequence public.alerts_id_seq to service_role;

-- Recipients are configured in the portal (lemlist & numbers → Support alerts); not seeded here.
