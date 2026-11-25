-- Encryption key lives in Supabase Vault (encrypted at rest, never exposed through the API)
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'phone_encryption_key', 'Encrypts WhatsApp sending numbers in whatsapp_numbers');

alter table public.whatsapp_numbers
  add column phone_enc bytea,          -- pgp_sym_encrypt(e164, key)
  add column phone_hash text,          -- HMAC-SHA256(e164, key): blocks duplicates without decrypting
  add column phone_last4 text,         -- for masked display in logs
  add column phone_set_at timestamptz,
  add column phone_set_by uuid references public.profiles(id) on delete set null;
create unique index whatsapp_numbers_phone_hash on public.whatsapp_numbers (phone_hash) where phone_hash is not null;

-- move any existing plain values across, then drop the plain column
do $$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'phone_encryption_key';
  update public.whatsapp_numbers
     set phone_enc = extensions.pgp_sym_encrypt(phone_e164, k),
         phone_hash = encode(extensions.hmac(phone_e164, k, 'sha256'), 'hex'),
         phone_last4 = right(phone_e164, 4),
         phone_set_at = now()
   where phone_e164 is not null;
end $$;
alter table public.whatsapp_numbers drop column phone_e164;

-- Signed-in users can't read the encrypted columns directly at all
revoke select on public.whatsapp_numbers from authenticated;
grant select (id, lemlist_user_id, profile_label, agent_id, status, diagnostics, last_checked_at, status_changed_at, phone_last4, phone_set_at)
  on public.whatsapp_numbers to authenticated;

-- Write path: only the Edge Functions (service role) can set a phone number
create or replace function public.set_number_phone(p_id text, p_phone text, p_by uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  k text;
  h text;
begin
  if p_phone is null or p_phone = '' then
    update public.whatsapp_numbers set phone_enc = null, phone_hash = null, phone_last4 = null, phone_set_at = now(), phone_set_by = p_by where id = p_id;
    return null;
  end if;
  if p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Invalid phone number format' using errcode = '22023';
  end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'phone_encryption_key';
  h := encode(extensions.hmac(p_phone, k, 'sha256'), 'hex');
  if exists (select 1 from public.whatsapp_numbers where phone_hash = h and id <> p_id) then
    raise exception 'That phone number is already saved on another WhatsApp account' using errcode = '23505';
  end if;
  update public.whatsapp_numbers
     set phone_enc = extensions.pgp_sym_encrypt(p_phone, k), phone_hash = h, phone_last4 = right(p_phone, 4),
         phone_set_at = now(), phone_set_by = p_by
   where id = p_id;
  if not found then raise exception 'Number not found' using errcode = 'P0002'; end if;
  return right(p_phone, 4);
end $$;
revoke execute on function public.set_number_phone(text, text, uuid) from public, anon, authenticated;
grant execute on function public.set_number_phone(text, text, uuid) to service_role;

-- Read path: decrypts only for rows the caller is allowed to see (same rules as the table's RLS)
create or replace function public.list_whatsapp_numbers()
returns table (
  id text, lemlist_user_id text, lemlist_user_name text, profile_label text, phone_e164 text, phone_last4 text,
  has_phone boolean, agent_id uuid, status text, diagnostics jsonb, last_checked_at timestamptz, status_changed_at timestamptz,
  phone_set_at timestamptz
) language sql stable security definer set search_path = public, extensions as $$
  with k as (select decrypted_secret as key from vault.decrypted_secrets where name = 'phone_encryption_key')
  select n.id, n.lemlist_user_id, u.name, n.profile_label,
         case when n.phone_enc is null then null else extensions.pgp_sym_decrypt(n.phone_enc, (select key from k)) end,
         n.phone_last4, n.phone_enc is not null, n.agent_id, n.status, n.diagnostics, n.last_checked_at, n.status_changed_at,
         n.phone_set_at
    from public.whatsapp_numbers n
    left join public.lemlist_users u on u.id = n.lemlist_user_id
   where public.is_active_user() and (
         public.is_admin() or public.has_role('support') or n.agent_id = auth.uid()
      or (public.has_role('owner') and n.agent_id in (select p.id from public.profiles p where p.branch_id in (select public.my_branch_ids())))
   )
   order by n.id
$$;
revoke execute on function public.list_whatsapp_numbers() from public, anon;
grant execute on function public.list_whatsapp_numbers() to authenticated;

-- project value: the fixed budget the line items are subdivided from
alter table public.settings add column project_value numeric(12,2) not null default 250000;
