# Blue PROP WhatsApp Lead Management Portal

Multi-user portal in front of lemlist so Blue PROP (Blue Property Group, South African real estate) agents can run WhatsApp campaigns from their own numbers. Built by Fin-Link. The full product spec, lemlist findings and all 56 priced user stories are in `docs/BUILD_SPEC.md`.

## Stack
- Front end: React 18 + Vite (plain JS/JSX, no TypeScript), `react-router-dom` HashRouter, hand-written CSS in `src/styles.css`. **Blue Property Group branding**: navy `#2A3688` (`--brand`), dark navy `#161C4A` (`--navy`, sidebar), orange `#FC4F15` (`--orange`, accents only — active markers, highlights, logo; text on orange uses `--orange-d #C2380A`). Headings in Oswald, body Roboto. Logo at `public/brand/blue-property-group-logo.png`.
- Backend: Supabase project `lqaxjvhgstdborylstzu` (Postgres + RLS, Auth, Edge Functions in Deno, Vault, pg_cron, pg_net).
- lemlist API (`https://api.lemlist.com/api`, Basic auth with empty user) — **20 requests / 2 s per key**.
- AI (later stages): Claude Haiku (`claude-haiku-5-5`) via the `ANTHROPIC_API_KEY` Edge Function secret.

## Layout
- `src/pages/` — Setup (first run), Login, ChangePassword, Home, Branches (map of South Africa with icon pins, coverage circles, province strip; add/edit with address search + draggable pin), Team (people), Lemlist (connection & numbers; read-only view for Branch Owners), Plan (project plan + Fin-Link money panel), Audit, Campaigns (list) + CampaignWizard (`/campaigns/:id`, 5 steps: basics, CSV leads, AI messages with WhatsApp preview, schedule, review — Launch disabled until the lemlist test is approved), Inbox (read-only threads, AI score, hot/DNC/follow-up actions), HotLeads (Excel export via `write-excel-file`, `mark_exported`), Dates (follow-ups, birthdays, anniversaries, leases; AI suggested message), Dnc, Shotgun, Rules.
- Features that depend on something not set up yet (lemlist sync, replying, CRM push, email reminders) stay visible; clicking them shows "… isn’t working yet" via `notReady()` in `Inbox.jsx`.
- `src/components/BranchMap.jsx`, `LocationPicker.jsx`, `src/lib/branchStyle.js` — Leaflet maps. Tiles: CARTO Positron (attribution required). Address search/reverse: OpenStreetMap Nominatim, limited to South Africa (~1 request/second; switch to a paid geocoder if volume grows).
- `src/lib/` — `supabase.js` (client + `callFn` for Edge Functions), `auth.jsx` (session/profile context), `format.js`.
- `supabase/functions/admin-users` — bootstrap, invite (temp password), update, deactivate, reactivate, reset_password.
- `supabase/functions/campaigns` — process_upload (normalise phones, reject invalid/duplicate/DNC/already-in-campaign, Shotgun check), draft_messages / rewrite_message (Claude Haiku), bulk_dnc, score_conversation (Haiku score 0–100 + reason + opt-out; AI never overrides a manual hot-lead decision; opt-outs go to DNC with needs_review), suggest_message. No lemlist calls yet.
- `supabase/functions/lemlist` — test, available_users, connect, disconnect, sync (raises support alerts on status changes), assign, record_reconnection. Read-only towards lemlist so far.
- Inbox tables: `conversations` (one per contact+agent, latest score cached), `messages` (lemlist_activity_id unique), `ai_scores`, `hot_leads` (source ai/manual), `key_dates`, `lemlist_events` (raw webhook payloads, Fin-Link only). Visibility via `can_see_agent()` / `can_act_for_agent()`. Changes to hot leads go through `set_hot_lead()` (logged). Super Admins can `load_inbox_samples()` / `clear_inbox_samples()` (fake +27 00 numbers, `is_sample`). The lemlist webhook receiver isn't built yet.
- `supabase/migrations/` — schema history as applied. `supabase/seed.sql` — the 56 plan items. (`pg_net` was enabled outside migrations: `create extension pg_net;`.)

## Rules that matter
- Roles: `admin` (Main Admin), `owner` (Branch Owner), `agent`, `superadmin` (Super Admin = Fin-Link developers; replaced the old `support` role). A trigger keeps `is_fin_link = (role = 'superadmin')`. Super Admins see everything incl. finances; only a Super Admin can grant/remove Super Admin, change `settings.project_value` or `settings.show_support_contact`. RLS helpers: `is_admin()` (admin + superadmin), `is_fin_link()` (superadmin), `has_role()`, `my_branch_ids()`. Super Admins: Darren Arbuckle and Ethan Glen-Young.
- Sign-ups are invite-only: a trigger on `auth.users` rejects any email not pre-approved through `allow_signup()` (only the `admin-users` function calls it).
- WhatsApp phone numbers are **encrypted** (`phone_enc`, pgp_sym with a Vault key `phone_encryption_key`; `phone_hash` HMAC for uniqueness). Write only via `set_number_phone()` (service role). Read only via `list_whatsapp_numbers()`. Never log full numbers — last 4 digits only.
- lemlist returns a WhatsApp account's **profile name**, not its phone number, so admins enter each number once.
- Only lemlist users connected in the portal are synced. **Production:** Blue PROP's 5 WhatsApp numbers sit under Gerrit Nel's lemlist user (`usr_a3ThpyZt4XhfgZHm8`) and are used by his sales team. **Development/testing:** only Brett Eastwood's lemlist user (`usr_AiqYkmDHSr3zFu5Cg`, one of those numbers) is connected.
- Leads: lemlist accepts phone-only leads (no email needed) and phones in international format, so contacts are stored as E.164 (`+27…`). SA mobiles are normalised from 082…/27…/0027… forms.
- Sales people (existing and new) are added per branch; each gets an Agent login and their own WhatsApp number in lemlist.
- Blue PROP's older lemlist campaigns (e.g. Portobello Place, Homestead) are deliberately **not** imported — the portal only shows campaigns created through it.
- Support alerts (number disconnected, linked elsewhere, licence missing, removed) go to Fin-Link developers, not the client: recipients live in `support_contacts` (Super-Admin-only RLS; `priority` 1 = primary/first line = Darren, 2 = secondary = Ethan; all with `receives_alerts` get every alert), alerts in `alerts` (`alert_recipients` is the old table, unused). `first_line_support()` returns the primary contact to users only when `settings.show_support_contact` is on; delivery by email/WhatsApp is a later stage. The lemlist workspace ("Fin-Link") also holds non-Blue-PROP campaigns and 2 existing webhooks: never modify those; only touch campaigns the portal created.
- Project plan: the project value (R250,000, `settings.project_value`) is split across the in-scope items (`plan_items.scope = 'in_scope'`); their prices must always total it. When a story is delivered, set it to `built` (client then signs off → `signed_off`).
- **Out-of-scope extras — track every one, automatically.** Whenever you build anything that isn't one of the 56 agreed stories (a new screen, a usability improvement, a security hardening, an internal tool, a client-requested change), add it to `plan_items` with `scope = 'extra'` in the same piece of work — don't wait to be asked. Leave `code` empty (a trigger assigns the next `EXT-NN`). Fill: `title` (short name), `detail` (what it does, plain English), `benefit` (why it was added / the value to Blue PROP), `related_code` (the story it builds on, if any), `billing` (`not_charged` by default; `chargeable` only if Darren says so, with `price`; `internal` for Fin-Link-only tools), `status`/`progress` like stories, `added_by = 'Fin-Link'`. Keep its status current as work moves. Extras never count towards the project value. Mention new extras to Darren when you report the work.
- Emails (invites, password resets, reminders) are deferred to a later stage; for now admins share temporary passwords.
- Forgot password: sign-in page → `password_reset_mode()` ('admin' until `settings.email_enabled`, Super-Admin-only switch in Rules). Admin mode logs `request_password_help()` → `password_help_requests` (shown on People + menu badge; resolved by admin-users reset_password). Email mode uses `resetPasswordForEmail` with PKCE (`flowType: 'pkce'`, link returns as `?code=`; opens in the same browser) → `PASSWORD_RECOVERY` → ChangePassword recovery screen. Before switching on: Supabase custom SMTP + add the Hostinger URL to Auth → URL Configuration (Site URL / Redirect URLs).
- Do Not Contact: AI `score_conversation` adds clear opt-outs ("not interested", "stop", wrong number; not "maybe later") as `source='ai_opt_out'`, `needs_review`; it never re-adds a number a person has overruled. `can_remove_dnc()` = admins/owners any; agents their own entries and AI entries for their contacts (`remove_dnc`, `confirm_dnc` keep). Manual add uses `search_contacts()` picker (`ContactPicker.jsx`). Triggers fill contact/email and stop `ready`/`queued` leads. Uploads match DNC by phone and email.
- **Demo data**: `load_demo_data()` / `clear_demo_data()` (Super Admin; Home card + banner for all). Tagged `is_demo` on campaigns/contacts/dnc/key_dates and demo phones `+2700…` (`is_demo_phone()`); clear also removes audit entries about demo items. Each active agent gets the same set; Shotgun clash needs 2+ agents.
- Never reset your own password from People (it ends your own session); `forceSignOut()` clears a dead session locally.
- Never put service-role, lemlist or Anthropic keys in front-end code or the repo. `.env` holds only the public URL and publishable key.

## Hosting
Hostinger static hosting (upload `dist/` contents to `public_html`). HashRouter, so no rewrites needed.

## Commands
```bash
npm install
npm run dev     # local
npm run build   # dist/ → upload its contents to the site's public_html on Hostinger
```
