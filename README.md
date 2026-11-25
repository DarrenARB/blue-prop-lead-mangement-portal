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

## Host it (no build needed)

Build it first (`npm run build`), or use the prebuilt site zip from the chat; either way, `dist/` has the project URL and publishable key baked in.

**Netlify Drop (fastest):** go to https://app.netlify.com/drop and drag the `dist` folder onto the page. You get a live URL straight away. Sign in to Netlify to keep the site and add a custom domain such as `portal.blueprop.com`.

Any static host works (Vercel, Cloudflare Pages, cPanel). The app uses `#/` routes, so it needs no rewrite rules.

## Run or rebuild locally

```bash
cp .env.example .env
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs dist/
```

`.env` holds only public values (Supabase URL and publishable key). **Never** put the service-role, lemlist or Anthropic keys in the front end. When building on a host (Netlify, Vercel), set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in its environment settings.

**Netlify from this repo:** New site → Import from GitHub → build command `npm run build`, publish directory `dist`, add the two env vars above.

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
