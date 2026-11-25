# Blue PROP WhatsApp Lead Portal (stage 1)

React + Vite front end on top of the Supabase project **Blue Prop Lead Communicator System** (`lqaxjvhgstdborylstzu`).

## What's live

- First-run setup → creates the Fin-Link Main Admin (only works while the portal has no accounts)
- Sign in, forced password change on first sign-in, change password
- Branches: add, rename, archive or restore
- People: invite (temporary password), edit role/branch/owned branches, link an agent to a WhatsApp number, reset password, deactivate/reactivate
- lemlist: connection test, connect/disconnect lemlist users (only **Brett Eastwood** is connected), WhatsApp numbers with live health (checked every 5 minutes), enter a number's phone, link it to an agent, record reconnections
- Project plan: the R250,000 project value split across all 56 items, with statuses, an allocation check (warns if items don't add up to the project value), a client-update generator, and a Fin-Link-only money panel (payments, drawdowns, available to draw)
- Audit log

The portal only **reads** from lemlist at this stage (`GET /team`, `GET /senders`).

## Host it on Hostinger

The portal is a static site, so Hostinger's standard web hosting is enough. It needs no Node server and no rewrite rules, because the app uses `#/` routes.

1. Build it: `cp .env.example .env && npm install && npm run build`. Or use the prebuilt site zip from the chat.
2. In hPanel, create the site or subdomain, for example `portal.blueprop.com`. Point DNS at Hostinger if the domain lives elsewhere.
3. Open hPanel → **File Manager**, go into that site's `public_html` folder, upload the **contents** of `dist/` (`index.html` and `assets/`), and extract them if you uploaded a zip.
4. Turn on the free SSL certificate in hPanel → Security → SSL.

To update the site, rebuild and replace the files in `public_html`.

## Run or rebuild locally

```bash
cp .env.example .env
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs dist/
```

`.env` holds only public values (Supabase URL and publishable key). **Never** put the service-role, lemlist or Anthropic keys in the front end. If you build on a CI service, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in its environment settings.



## Backend (already deployed in Supabase)

| Piece | What it does |
|---|---|
| `admin-users` Edge Function | bootstrap, invite, update, deactivate, reactivate, reset_password |
| `lemlist` Edge Function | test, available_users, connect, disconnect, sync, assign, record_reconnection |
| `lemlist-probe` Edge Function | the read-only test from the first session; safe to delete |
| `pg_cron` job `lemlist-number-health` | runs `sync` every 5 minutes |
| Secrets | `LEMLIST_API_KEY`, `ANTHROPIC_API_KEY` (Edge Function secrets) |

The function source is in `supabase/functions/`; the schema history is in `supabase/migrations/` and the plan items in `supabase/seed.sql`. The full spec is `docs/BUILD_SPEC.md`. Sign-ups are invite-only: a database trigger refuses any account the portal didn't create.

## Phone numbers (encrypted)

lemlist doesn't return a WhatsApp account's phone number, only its profile name, so the Admin enters each number once. The portal flags any number still missing one.

- Numbers are only ever written through the Edge Functions (admin only, over HTTPS) by the `set_number_phone` SQL function, which only the service role can call.
- They're stored as `pgp_sym_encrypt` ciphertext (`phone_enc`), using a key kept in **Supabase Vault** (`phone_encryption_key`). An HMAC (`phone_hash`) blocks the same number being saved twice without decrypting anything.
- Signed-in users can't read the encrypted columns. They call `list_whatsapp_numbers()`, which decrypts only the rows that person is allowed to see (admins, Support, the agent on that number, and Branch Owners for their branches).
- The audit log only ever records the last four digits.

## Notes

- First version: invites and password resets use a temporary password the admin sends on. Invite, reset and reminder emails come in a later stage (needs custom SMTP in Supabase → Authentication → Emails, or an email provider such as Resend).
