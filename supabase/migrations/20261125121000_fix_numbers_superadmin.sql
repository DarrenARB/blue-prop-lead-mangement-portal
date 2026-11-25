-- list_whatsapp_numbers still referred to the old 'support' role (renamed to superadmin); is_admin() already covers Super Admins.
create or replace function public.list_whatsapp_numbers()
returns table (id text, lemlist_user_id text, lemlist_user_name text, profile_label text, phone_e164 text, phone_last4 text,
  has_phone boolean, agent_id uuid, status text, diagnostics jsonb, last_checked_at timestamptz, status_changed_at timestamptz, phone_set_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  with k as (select decrypted_secret as key from vault.decrypted_secrets where name = 'phone_encryption_key')
  select n.id, n.lemlist_user_id, u.name, n.profile_label,
         case when n.phone_enc is null then null else extensions.pgp_sym_decrypt(n.phone_enc, (select key from k)) end,
         n.phone_last4, n.phone_enc is not null, n.agent_id, n.status, n.diagnostics, n.last_checked_at, n.status_changed_at,
         n.phone_set_at
    from public.whatsapp_numbers n
    left join public.lemlist_users u on u.id = n.lemlist_user_id
   where public.is_active_user() and (
         public.is_admin() or n.agent_id = auth.uid()
      or (public.has_role('owner') and n.agent_id in (select p.id from public.profiles p where p.branch_id in (select public.my_branch_ids())))
   )
   order by n.id
$$;
