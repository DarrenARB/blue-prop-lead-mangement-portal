# Blue PROP WhatsApp Lead Management Portal

Multi-user portal in front of lemlist so Blue PROP (Blue Property Group, South African real estate) agents can run WhatsApp campaigns from their own numbers. Built by Fin-Link. The full product spec, lemlist findings and all 56 priced user stories are in `docs/BUILD_SPEC.md`.

## Stack
- Front end: React 18 + Vite (plain JS/JSX, no TypeScript), `react-router-dom` HashRouter, hand-written CSS in `src/styles.css` (prototype palette: brand `#1B489B`, navy `#0C0F24`, Roboto).
- Backend: Supabase project `lqaxjvhgstdborylstzu` (Postgres + RLS, Auth, Edge Functions in Deno, Vault, pg_cron, pg_net).
- lemlist API (`https://api.lemlist.com/api`, Basic auth with empty user) — **20 requests / 2 s per key**.
- AI (later stages): Claude Haiku (`claude-haiku-5-5`) via the `ANTHROPIC_API_KEY` Edge Function secret.

## Layout
- `src/pages/` — Setup (first run), Login, ChangePassword, Home, Team (branches & people), Lemlist (connection & numbers), Plan (project plan + Fin-Link money panel), Audit.
- `src/lib/` — `supabase.js` (client + `callFn` for Edge Functions), `auth.jsx` (session/profile context), `format.js`.
- `supabase/functions/admin-users` — bootstrap, invite (temp password), update, deactivate, reactivate, reset_password.
- `supabase/functions/lemlist` — test, available_users, connect, disconnect, sync, assign, record_reconnection. Read-only towards lemlist so far.
- `supabase/migrations/` — schema history as applied. `supabase/seed.sql` — the 56 plan items. (`pg_net` was enabled outside migrations: `create extension pg_net;`.)

## Rules that matter
- Roles: `admin` (Main Admin), `owner` (Branch Owner), `agent`, `support`; `is_fin_link` marks Fin-Link staff (sees finances, can't be granted via the API). RLS enforces scope; helper functions `is_admin()`, `has_role()`, `my_branch_ids()`.
- Sign-ups are invite-only: a trigger on `auth.users` rejects any email not pre-approved through `allow_signup()` (only the `admin-users` function calls it).
- WhatsApp phone numbers are **encrypted** (`phone_enc`, pgp_sym with a Vault key `phone_encryption_key`; `phone_hash` HMAC for uniqueness). Write only via `set_number_phone()` (service role). Read only via `list_whatsapp_numbers()`. Never log full numbers — last 4 digits only.
- lemlist returns a WhatsApp account's **profile name**, not its phone number, so admins enter each number once.
- Only lemlist users connected in the portal are synced (currently Brett Eastwood, `usr_AiqYkmDHSr3zFu5Cg`). The lemlist workspace ("Fin-Link") also holds non-Blue-PROP campaigns and 2 existing webhooks: never modify those; only touch campaigns the portal created.
- Project plan: the project value (R250,000, `settings.project_value`) is split across all items; prices must always total it. When a story is delivered, set it to `built` (client then signs off → `signed_off`).
- Emails (invites, password resets, reminders) are deferred to a later stage; for now admins share temporary passwords.
- Never put service-role, lemlist or Anthropic keys in front-end code or the repo. `.env` holds only the public URL and publishable key.

## Commands
```bash
npm install
npm run dev     # local
npm run build   # dist/ for static hosting (Netlify Drop, Vercel, Cloudflare Pages)
```
