# Blue PROP WhatsApp Lead Communicator Portal: Build Spec

*Version 1.0 · 25 Nov 2026 · Fin-Link / Impulsivity*

This is the build brief for turning the Claude Design prototype into a live portal. It covers what lemlist can do (tested against the live account, not only the docs), the architecture, the data model, every user story, and the build order. A developer or Claude Code can work from this file alone.

> **Branding:** the prototype canvas is branded **eXp Realty** (eXp branches, "Thandi from eXp Realty" copy). The live build is for **Blue PROP (Blue Property Group)**. Replace every eXp reference, sample branch and message template with Blue PROP's.

---

## 1. What the portal does

Blue PROP agents run WhatsApp prospecting campaigns through lemlist. Today they share lemlist logins and lemlist is hard for agents to use. The portal puts a simple, role-based front end on top of lemlist:

- Agents launch a 3-message WhatsApp campaign from a 5-step wizard. They don't need to know lemlist.
- Each agent always sends from **their own** WhatsApp number.
- Replies appear in a read-only inbox. **Agents still reply from WhatsApp on their phone.**
- AI scores every reply from 0 to 100. Replies at or above the threshold (default 70) go to **Hot Leads**, which can be exported to Excel for the CRM.
- Admins and Branch Owners get dashboards, number health, Do Not Contact, the Shotgun list (cooldown on contacts another agent has already messaged), follow-up dates and an audit log.

**Roles:** Main Admin, Branch Owner, Agent, Support (Fin-Link).

---

## 2. Environment

| Item | Value |
|---|---|
| Supabase project | **Blue Prop Lead Communicator System** |
| Project ref | `lqaxjvhgstdborylstzu` (eu-west-1) |
| API URL | `https://lqaxjvhgstdborylstzu.supabase.co` |
| Edge Function secrets (set) | `LEMLIST_API_KEY`, `ANTHROPIC_API_KEY` |
| Extensions enabled | `pg_net` (plus defaults: `pgcrypto`, `uuid-ossp`, `supabase_vault`) |
| Extensions still to enable | `pg_cron` (scheduled jobs), `pgmq` (lemlist job queue) |
| Existing functions | `lemlist-probe` (read-only test, can be deleted before go-live) |
| lemlist plan | Multichannel Expert + WhatsApp add-on |
| AI model | Claude Haiku (`claude-haiku-5-5`) |

**Never** put the lemlist or Anthropic key in front-end code. All lemlist and Claude calls go through Edge Functions.

---

## 3. lemlist: what we verified

### 3.1 Live account (probed 25 Nov 2026)

The lemlist workspace is named **"Fin-Link"**. It has **4 users**, and the API key can read all of them (team-level visibility is confirmed).

| lemlist user | userId | WhatsApp accounts | Health |
|---|---|---|---|
| Gerrit Nel | `usr_a3ThpyZt4XhfgZHm8` | `uwa_ZcDjJj7ytGSAxmkic`, `uwa_ZXChZCrngcFNF5rtF` (both labelled "Blue Property Group") | Healthy |
| Brett Eastwood | `usr_AiqYkmDHSr3zFu5Cg` | `uwa_4QiDmPCMrQHvu667A` (label "You") | Healthy |
| Chantal Truter | `usr_aTspaymTHktDwpxty` | `uwa_ADpJHTLgDhFFoHAjE` (label "You") | Healthy |
| Darren Arbuckle | `usr_83rniA5eN6MJ99Psr` | none | `warning:license_missing`; LinkedIn `error:channel_linked_elsewhere` |

The workspace already holds Blue PROP's real campaigns (e.g. "Portobello Place Campaign", "Homestead", "Ellingham") **and other Fin-Link campaigns** (e.g. "LeadLife", "Monday Leads"). There are also **2 existing webhooks**.

### 3.2 Findings that change the design

| # | Finding | Impact |
|---|---|---|
| F1 | A WhatsApp channel's `label` is the **WhatsApp profile name** ("Blue Property Group", "You"), **not** the phone number (the docs say it's the number). | The portal stores each number's phone itself. The Admin enters it when linking an agent to a `uwa_` account. |
| F2 | `whatsappReplied` activities carry **`sendUserWhatsappAccountId`** (`uwa_…`), plus `leadId`, `campaignId`, `contactId`, `sendUserId`, `leadPhone`. | Each reply maps to the exact number and agent. This isn't in the docs. |
| F3 | On `whatsappReplied` activities, **`message` is empty**. | Reply text must be fetched from **`GET /inbox/{contactId}`**, which returns the message history with `message` populated. |
| F4 | Existing campaigns use `whatsappMessage` steps with `message` and `delay` (days), exactly as the prototype's 3-step sequence needs. | Confirms the wizard → lemlist mapping. |
| F5 | Schedules have `timezone`, `start` / `end` ("HH:MM"), `weekdays` (array of numbers) and `secondsToWait`. | Maps directly to wizard step 4. |
| F6 | Existing leads store `leadPhone` as 10 characters (local format, e.g. `08…`). | **Test** whether lemlist accepts E.164 (`+27…`) for WhatsApp sends via the API, then pick one format and normalise to it. |
| F7 | `GET /v2/campaigns/{id}/stats` returned **400** with our parameters. | Use Get Campaign Reports or Batch Campaign Stats, or compute stats from activities. Fix during build. |
| F8 | The workspace is shared with non-Blue-PROP campaigns, and webhooks already exist. | The portal must **only touch campaigns it created** (store their IDs; also add a lemlist label such as `portal`). **Never delete or modify the 2 existing webhooks.** |

### 3.3 Documented API facts we rely on

- Base URL `https://api.lemlist.com/api`. Auth is HTTP Basic: empty username, API key as password.
- **Rate limit: 20 requests per 2 seconds per API key**, on all routes. Responses include `Retry-After`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (a date string, not a number).
- **Create Campaign** (`POST /campaigns`) auto-creates a sequence and a schedule and returns their IDs.
- **Add step** (`POST /sequences/{sequenceId}/steps`) with `{ "type": "whatsappMessage", "message": "...", "delay": 0 }`.
- **Sender pool** (`POST|PUT /campaigns/{id}/senders`): `{ "senders": [{ "userId": "usr_…", "channels": [{ "type": "whatsapp", "id": "uwa_…" }] }] }`. Use **Replace** so a campaign has exactly one sender and one number. A campaign step must use WhatsApp before the channel can be enabled.
- **List Senders** (`GET /senders`): WhatsApp health codes `channel_disconnected`, `channel_linked_elsewhere`, `channel_issue`, `license_missing`, `no_required_channel_active`. Only `type: error` blocks sending.
- **Leads:** `POST /campaigns/{id}/leads` creates **one lead per call**; there's no bulk endpoint. The phone field is `phone`. `deduplicate=true` refuses contacts already in another campaign (409).
- **Start / pause:** `POST /campaigns/{id}/start`, `POST /campaigns/{id}/pause`. Duplicate Campaign also exists.
- **Unsubscribes:** single and bulk (up to 10,000) unsubscribe of variables including phone numbers; `GET` contact subscription status; re-subscribe.
- **Webhooks:** `POST /hooks` with `targetUrl` (unique per team), an optional single `type` (omit for all events), and an optional `secret` that is echoed back in every payload body. There's no HMAC. A 404 or 410 from our endpoint **disables** the hook. Maximum 200 hooks per team.
- **WhatsApp webhook events:** `whatsappMessageSent`, `whatsappMessageDelivered`, `whatsappMessageOpened`, `whatsappReplied`, `whatsappMessageFailed`.
- **Inbox:** `GET /inbox?userId=…&page=&limit=` (userId required) and `GET /inbox/{contactId}` (messages).
- `POST /inbox/whatsapp` can send a WhatsApp message. **Out of scope for v1**, because agents reply from their phones.

### 3.4 Still to test (write tests in a draft campaign that is never started)

1. **Phone-only lead.** Create a lead with `phone` and no email in a draft WhatsApp campaign. Does it work, and in which phone format (local or `+27`)?
2. **Full campaign creation via API.** Create a campaign, add 3 `whatsappMessage` steps, replace senders with one `uwa_` account, set the schedule, then read back `GET /senders?campaignId=` and check there are no `error` diagnostics. Don't start it.
3. **Webhook delivery.** Register the portal webhook with a `secret`, then trigger a reply on a test number and capture the real `whatsappReplied` payload.
4. **Stats endpoint.** Find the working call for per-campaign stats (F7).
5. **Pause / resume / add leads** to a running campaign, using a test campaign and a test phone.

---

## 4. Architecture

```
Browser (React SPA)
   │  Supabase Auth (email invite + password / magic link)
   │  Reads portal tables directly (RLS enforces role scope)
   │  Writes that touch lemlist → Edge Functions
   ▼
Supabase
 ├─ Postgres: portal data + cached lemlist data, RLS per role
 ├─ Edge Functions
 │   ├─ campaign-api       wizard launch, pause/resume/stop, add leads, duplicate
 │   ├─ lead-upload        CSV validate → DNC / Shotgun / dedupe checks → enqueue lemlist lead creates
 │   ├─ lemlist-worker     drains the lemlist job queue at ≤ 8 req/s, honours Retry-After
 │   ├─ lemlist-webhook    receives lemlist events (verifies secret), stores them, enqueues reply fetch + AI scoring
 │   ├─ number-health      every 5 min: GET /senders → update numbers, raise alerts
 │   ├─ stats-sync         every 15 min: refresh campaign stats cache
 │   ├─ ai                 draft sequence, rewrite message, score reply, suggest follow-up message (Haiku)
 │   ├─ export             build .xlsx for leads / hot leads, mark exported
 │   └─ admin-api          invite user, deactivate user (pause their campaigns), link number
 ├─ pg_cron   schedules worker, health, stats, daily reminders (07:30 SAST)
 └─ pgmq      lemlist job queue (and AI scoring queue)
        │
        ▼
lemlist API (single team key)  ←→  WhatsApp numbers (QR-linked on agents' phones)
```

**Key principles**

1. **The portal is the source of truth for portal concepts:** users, roles, branches, agent↔number mapping, DNC, Shotgun, scores, hot leads, dates and audit. **lemlist is the source of truth for sending:** campaigns, sequences, delivery and replies.
2. **Every lemlist write goes through the queue** (`pgmq` → `lemlist-worker`). Budget about 8 requests per second to leave headroom for health and stats polling on the same key.
3. **The UI never waits on lemlist** for reads. It reads the cache, and the cache is updated by webhooks and polling.
4. **Idempotency.** Each lemlist job carries an idempotency key. Store lemlist IDs on portal rows and never create twice.
5. **Scope guard.** The worker refuses any write to a campaign ID that isn't in `campaigns.lemlist_campaign_id`.

---

## 5. Data model (Postgres, schema `public`)

All tables have `id uuid pk default gen_random_uuid()`, `created_at`, and `updated_at` where useful. Phone numbers are stored **E.164** (`+27…`); the lemlist send format is decided by test 3.4-1.

| Table | Key columns | Notes |
|---|---|---|
| `branches` | name, archived_at | ADM-01 |
| `profiles` | user_id → auth.users, full_name, email, role (`admin`/`owner`/`agent`/`support`), branch_id (agents), status (`invited`/`active`/`deactivated`) | One role per person |
| `branch_owners` | owner_id, branch_id | Owners over 1+ branches (ADM-03) |
| `lemlist_users` | lemlist_user_id (`usr_…`), name, email, licence_ok | Synced from `/senders` |
| `whatsapp_numbers` | lemlist_account_id (`uwa_…`) unique, lemlist_user_id, phone_e164 (entered by Admin, F1), profile_label, agent_id unique nullable, status (`ok`/`disconnected`/`linked_elsewhere`/`licence_missing`/`issue`), last_checked_at, last_diagnostics jsonb | Max 5 per lemlist user (SUP-03) |
| `number_events` | number_id, kind (`alert`/`reconnected`), note, by_user, at | SUP-02, SUP-04 |
| `campaigns` | agent_id, branch_id, number_id, name, goal, status (`draft`/`launching`/`running`/`paused`/`stopped`/`ended`/`blocked`), lemlist_campaign_id, lemlist_sequence_id, lemlist_schedule_id, wizard_state jsonb, schedule jsonb, started_at | Draft saved per wizard step (AGT-01) |
| `campaign_messages` | campaign_id, position (1–3), body, delay_days, lemlist_step_id | |
| `contacts` | phone_e164 unique, first_name, last_name, suburb, extra jsonb, lemlist_contact_id | One row per real person |
| `leads` | campaign_id, contact_id, lemlist_lead_id, state (`queued`/`sent`/`delivered`/`read`/`replied`/`failed`/`stopped`), current_step, last_event_at | AGT-13 |
| `uploads` | campaign_id, filename, total_rows, added, rejected jsonb (counts by reason) | AGT-03 summary |
| `upload_rejections` | upload_id, row_no, raw jsonb, reason (`invalid_number`/`duplicate`/`dnc`/`shotgun`) | |
| `messages` | contact_id, campaign_id, direction (`out`/`in`), body, sent_at, lemlist_activity_id unique | Inbox cache |
| `conversations` | contact_id, agent_id, campaign_id, last_message_at, last_preview, unread | Inbox list |
| `ai_scores` | contact_id, campaign_id, score 0–100, reason, opt_out bool, model, scored_at, source_message_id | AGT-17 |
| `hot_leads` | contact_id, campaign_id, agent_id, source (`ai`/`manual`), active bool, exported_at, export_id | AGT-18/19/20 |
| `exports` | by_user, scope, filter jsonb, row_count, file_path | Excel exports (Storage) |
| `dnc` | phone_e164 unique, name, added_by, source (`upload`/`inbox`/`ai_opt_out`/`manual`/`bulk`), reason, needs_review bool, lemlist_synced_at | ADM-10, AGT-16 |
| `shotgun` | contact_id, holder_agent_id, holder_campaign_id, last_contacted_at, tried_by_agent_id, tried_at, free_from, outcome (`kept`/`released`/null) | ADM-11/12 |
| `key_dates` | contact_id, agent_id, type (`followup`/`birthday`/`lease`/`anniversary`/`other`), date, note, yearly bool, done_at, snoozed_until | AGT-21–24 |
| `settings` | singleton: hot_threshold (70), shotgun_months (3), default_window jsonb (weekdays 07:30–18:00 Africa/Johannesburg) | ADM-11, rules |
| `audit_log` | at, actor_id, type, entity, entity_id, summary, data jsonb | ADM-13; written by triggers + functions |
| `lemlist_events` | raw webhook payloads, type, received_at, processed_at, error | Replay/debug |

**RLS summary**

- **Agent:** rows where `agent_id = auth.uid()` (campaigns, leads, conversations, hot leads, dates), plus their own number.
- **Branch Owner:** rows whose `branch_id` is in their `branch_owners` set. Read-only, except DNC removal (BRO-07).
- **Main Admin:** everything.
- **Support:** `whatsapp_numbers`, `lemlist_users` and `number_events` only.
- `dnc`, `settings` and `audit_log`: read-only for non-admins where relevant, and writes only through functions.

---

## 6. Feature → lemlist mapping

### 6.1 Launch campaign (AGT-01…08)

1. The wizard saves to `campaigns.wizard_state` on every step (draft).
2. **Upload** (`lead-upload`): parse the CSV and map columns, normalise numbers to `+27`, then reject invalid numbers, duplicates in the file, anyone on DNC, and anyone held by **another agent within the Shotgun cooldown** (insert a `shotgun` row). Return the summary (e.g. "219 ready, 29 left out: reasons").
3. **Messages:** AI draft (`ai.draftSequence`) or written by the agent. Variables `{{firstName}}` and `{{suburb}}` map to lemlist lead variables.
4. **Schedule:** sending days, start and end hours, delays between messages, timezone `Africa/Johannesburg`.
5. **Launch** (blocked if the agent's number status ≠ `ok`):
   1. `POST /campaigns` → store campaign, sequence and schedule IDs; add label `portal`
   2. `POST /sequences/{seq}/steps` × 3 (`whatsappMessage`, delays 0 / d2 / d3). Remove or replace any auto-created default step.
   3. `PUT /campaigns/{id}/senders` → the agent's `usr_` + `uwa_` only
   4. Update the schedule (timezone, start, end, weekdays)
   5. Enqueue lead creates (one per lead, `phone`, `firstName`, `lastName`, `suburb`)
   6. When the queue has drained: `GET /senders?campaignId=` → if there are no errors, `POST /campaigns/{id}/start`
   7. Write `audit_log` "campaign started"
6. "Anyone who replies stops getting the next messages" is lemlist's default behaviour on reply. Confirm it in test 3.4-2.

### 6.2 Running campaign (AGT-09…13)

- Pause / resume / stop → `pause` / `start` (stop = pause + mark `stopped` in the portal).
- Add leads → the same upload pipeline, then enqueue creates into the existing campaign.
- Duplicate → copy messages and schedule into a new portal draft. **Leads are not copied.**
- Lead progress comes from webhook events (`Sent` → `Delivered` → `Opened` = read → `Replied` / `Failed`).

### 6.3 Replies, inbox and AI (AGT-14, 16–19)

1. `lemlist-webhook` receives `whatsappReplied`, checks `secret`, stores the event, and ignores campaigns that aren't the portal's.
2. Look up the number by `sendUserWhatsappAccountId`, then the agent and campaign.
3. Enqueue `GET /inbox/{contactId}` → upsert into `messages` (dedupe on activity ID) → update `conversations`.
4. Enqueue AI scoring on the conversation (last ~10 messages) → `ai_scores`.
   - `score ≥ threshold` → upsert `hot_leads` (source `ai`)
   - `opt_out = true` → insert `dnc` (source `ai_opt_out`, `needs_review = true`), unsubscribe the phone in lemlist, and remove the lead from all running portal campaigns
5. Agent overrides (move in or out of Hot Leads) → `hot_leads.source = manual` + audit.
6. The inbox is **read-only** in v1. A safety net poll of `GET /inbox?userId=` every 10 minutes catches missed webhooks.

### 6.4 Number health (ADM-08, BRO-05, AGT-15, SUP-01…04)

- `number-health` runs every 5 minutes: `GET /senders`, maps diagnostics to `status`, and upserts `lemlist_users` and `whatsapp_numbers`.
- When a status changes from `ok` to anything else: insert a `number_events` alert, email and WhatsApp Support (Resend or similar for email; WhatsApp alert via `POST /inbox/whatsapp` from a Fin-Link number, optional), mark the agent's running campaigns `blocked`, and show the banner.
- Support records reconnections (note + timestamp).
- Free slots = 5 − the number of `uwa_` accounts on that lemlist user.

### 6.5 Do Not Contact & Shotgun (ADM-10…12, BRO-07, AGT-16)

- DNC is checked on every upload and mirrored to lemlist as a second safety net (bulk unsubscribe on bulk upload).
- Removal is allowed only for an Admin or Branch Owner, with a reason, and is always logged. Re-subscribe in lemlist.
- Shotgun: when the holder is a different agent and `last_contacted_at` is less than `shotgun_months` ago, hold the contact. Admin resolves it with "keep" or "release now".

### 6.6 Reports & export (ADM-07, BRO-01/02, AGT-12/20, ADM-09, BRO-08)

- Metrics: unique leads contacted (distinct phones messaged in the period), replied, reply rate (replied ÷ contacted), hot leads (currently ≥ threshold), delivered, and exported to CRM.
- Computed in SQL views over `leads` / `messages` / `hot_leads`, scoped by RLS. `stats-sync` reconciles counts with lemlist.
- Excel export (`.xlsx`): name, phone, campaign, agent, score, reason, last reply, reply date. Mark rows `exported_at` so nothing is loaded into the CRM twice.

### 6.7 Dates & reminders (AGT-21…24, BRO-09)

- Portal-only (no lemlist). A daily cron at 07:30 SAST emails each agent what's due. Yearly types roll forward.
- AI-suggested message (`ai.suggestMessage`): the agent copies it and sends it from their phone.

---

## 7. AI (Claude Haiku)

All calls go through the `ai` Edge Function using `ANTHROPIC_API_KEY` and model `claude-haiku-5-5`, with structured JSON output, English-only prompts, and a system prompt cached per task.

| Task | Input | Output |
|---|---|---|
| `draftSequence` | goal, audience, offer, tone, agent first name, available variables | `{ messages: [m1, m2, m3] }`. Rules: short and personal, one question, no links in message 1, uses `{{firstName}}` |
| `rewriteMessage` | message, instruction | `{ message }` |
| `scoreReply` | the conversation (last ~10 messages, roles marked) | `{ score: 0-100, reason: "≤ 20 words", opt_out: bool }`. Opt-out covers "stop", "remove me", "not interested, don't message", including in Afrikaans/isiZulu |
| `suggestMessage` | date type, contact first name, note, agent name | `{ message }` |

Guardrails: never invent prices or listings, flag rather than act on ambiguous opt-outs, and log the model, latency and token use per call.

---

## 8. Build order

| Phase | Scope | Exit check |
|---|---|---|
| **0. lemlist tests** | Section 3.4 tests 1–5 in draft or test campaigns | All five answered; phone format decided |
| **1. Foundations** | Schema + RLS, Auth with invites, roles, branches, profiles, settings, audit triggers, lemlist client + queue + worker | Admin can invite; a queued lemlist call respects the rate limit |
| **2. Numbers** | `/senders` sync, link agent ↔ `uwa_` (Admin enters phone), health cron, alerts, Support screens | Every Blue PROP number shows with live status |
| **3. Campaign wizard** | Upload pipeline (DNC/Shotgun/dedupe), AI drafting, schedule, launch flow, campaign list/detail, pause/resume/add leads/duplicate | Agent launches a real 3-message campaign to a test phone |
| **4. Replies & AI** | Webhook, inbox sync, scoring, Hot Leads, overrides, opt-out → DNC, Excel export | A reply on the test phone appears scored within ~1 minute |
| **5. Oversight** | Dashboards (agent/owner/admin), agent comparison, DNC admin, Shotgun resolve, dates & reminders, audit log screen | All 50 stories pass in UAT |
| **6. Go-live** | Real-number end-to-end test, training, delete `lemlist-probe`, monitoring | Sign-off |

---

## 9. Decisions (25 Nov 2026)

- **Numbers:** Blue PROP's 5 WhatsApp numbers live under **Gerrit Nel's** lemlist user and are used by his team. Development and testing use **Brett Eastwood's** lemlist user (one of those numbers).
- **People:** sales people per branch (existing and new) each get an Agent login and their own WhatsApp number in lemlist. There are no others yet.
- **Support alerts** go to the Fin-Link developers, not the client: Darren Arbuckle (email and WhatsApp, set in the portal).
- **Existing lemlist campaigns are not imported**; the portal only shows campaigns created through it.
- **lemlist plan:** Multichannel Expert + WhatsApp add-on.
- **Hosting:** Hostinger (static site).
- **Emails** (invites, resets, reminders) are added in a later stage; temporary passwords until then.

## 9b. Still open

1. **Phone format** for lemlist leads (after test 3.4-1).
2. **Which of the 4 numbers** belong to which agent. Gerrit's lemlist user holds 2 numbers; Brett and Chantal hold 1 each.
3. **Existing Blue PROP campaigns** created directly in lemlist: import them into the portal (read-only history) or leave them out?
4. **Alert channels for Support:** email address(es) and whether WhatsApp alerts are wanted in v1.
5. **Front-end hosting:** Vercel / Netlify / Supabase-hosted static site, and the domain (e.g. `portal.blueprop.com`).
6. **Email sender** for invites and reminders (Supabase Auth SMTP + Resend?).

---

## 10. User stories (from the prototype)

All 50 stories from the prototype's story guide. Story IDs match the prototype and the pricing table.

**Agent**

| ID | Story | Screen | Notes |
|---|---|---|---|
| AGT-01 | Start a new campaign from a step-by-step wizard, so that I can launch without knowing lemlist | wizard | Progress is saved as a draft at every step. |
| AGT-02 | Upload a CSV of leads and match its columns, so that my list loads correctly | wizard | Template CSV to download. Numbers changed to +27 format. |
| AGT-03 | See an upload summary before leads are added, so that I know what was accepted and why others weren’t | wizard | Added, invalid number, duplicate, on Do Not Contact, owned by another agent. |
| AGT-04 | Describe what I’m after and get an AI-drafted 3-message sequence, so that I start from good copy, not a blank page | wizard | Inputs: goal, audience, offer, tone. |
| AGT-05 | See best-practice tips beside each message, so that my messages get replies and my number stays safe | wizard | Short, personal, one question, no links in message 1. |
| AGT-06 | Edit, rewrite or write any message myself, using lead fields, so that the copy sounds like me | wizard | Live WhatsApp-style preview with a sample lead. |
| AGT-07 | Set the delays and the sending days and hours, so that messages arrive at sensible times | wizard | Starts on the company default: weekdays 07:30–18:00, South Africa time. |
| AGT-08 | Review everything and launch, so that nothing goes out by mistake | wizard | Launch is blocked if my number is disconnected. Try the Simulate switch. |
| AGT-09 | Pause, resume or stop a running campaign, so that I can react if something is wrong | campaign |  |
| AGT-10 | Add more leads to a running campaign, so that I can top up a campaign that’s working | campaign | Same checks as a new upload. |
| AGT-11 | Duplicate a past campaign, so that I can reuse a sequence that worked | campaign | Leads are not copied. |
| AGT-12 | See my campaigns with status and headline numbers, so that I know where things stand at a glance | campaigns | Contacted, delivered, replied, reply rate, hot leads. |
| AGT-13 | Open a campaign and see each lead’s progress, so that I know who is at which message | campaign | Queued, sent, delivered, read, replied, failed. |
| AGT-14 | See all my WhatsApp conversations in one inbox, so that I can review replies in one place | inbox | Read-only. I reply from my phone. |
| AGT-15 | See my number’s health and connection status, so that I know when to call support | home | A banner appears when it disconnects. Try the Simulate switch. |
| AGT-16 | Add a contact to Do Not Contact from a conversation, so that someone who says stop is never messaged again | inbox | Reason captured. Removed from all running campaigns. |
| AGT-17 | Have every reply scored by AI with a short reason, so that I can focus on the most interested people | inbox | Score 0–100 plus a one-line reason. |
| AGT-18 | Have high scorers moved to Hot Leads automatically, so that my best leads are in one place | hot | Threshold 70 by default, set by the Admin. |
| AGT-19 | Override the AI and move a lead in or out of Hot Leads, so that I stay in control of the judgement | hot | Every override is logged. |
| AGT-20 | Export my hot leads, or all my leads, to Excel, so that I can load them into the CRM | hot | Tracks which leads were already exported. |
| AGT-21 | Set a follow-up date and note on a contact, so that I call back at exactly the right time | dates | From a conversation, a lead row or this page. Reminder in the portal and by email on the day. |
| AGT-22 | Save a contact’s birthday and other key dates, like a lease ending or a home anniversary, so that I can get in touch at moments that matter to them | dates | Birthdays and anniversaries repeat every year. |
| AGT-23 | See everything that’s due: overdue, today and coming up, so that nothing slips through the cracks | dates | Mark as done or snooze. Due items also show on Home. |
| AGT-24 | Get an AI-suggested message for a birthday, anniversary or follow-up, so that reaching out takes seconds | dates | I copy it and send it from WhatsApp on my phone. |

**Main Admin**

| ID | Story | Screen | Notes |
|---|---|---|---|
| ADM-01 | Create, rename and archive branches, so that the structure matches Blue PROP’s offices | team | Archiving a branch keeps its campaigns and history. |
| ADM-02 | Invite people by email and give them a role, so that everyone has their own login, not a shared one | team | Invite link expires. One role per person. |
| ADM-03 | Put each agent in one branch, and Branch Owners over one or more, so that what people see follows the org chart | team | An agent can only ever hold one branch. |
| ADM-04 | Link an agent to a lemlist user and a WhatsApp number, so that their campaigns always send from their own number | team | Only unassigned numbers are offered. Max 5 numbers per lemlist user. |
| ADM-05 | Deactivate an agent and reassign or close their running campaigns, so that a leaver’s number stops sending | team | Deactivating pauses their running campaigns. |
| ADM-06 | See every campaign across all branches, with filters, so that I can oversee the whole operation | campaigns | Filter by branch, agent, status and date. |
| ADM-07 | See a company-wide dashboard of results, so that I know if WhatsApp outreach is working | reports | Unique leads contacted, replies, reply rate and hot leads. |
| ADM-08 | See the health and connection status of every number, so that disconnected numbers get fixed fast | numbers | Alert when a number disconnects. |
| ADM-09 | Export leads from any campaign to Excel, so that results go into the CRM | campaign | Same export format as agents. |
| ADM-10 | Add, bulk upload, search and remove Do Not Contact entries, so that we meet our opt-out obligations | dnc | Every change is logged with who and when. |
| ADM-11 | Set the Shotgun list cooldown, so that a contact is approached again only after the agreed time | rules | Default 3 months. |
| ADM-12 | See and resolve Shotgun list entries, so that contested contacts are handled fairly | shotgun | Shows both agents and dates. |
| ADM-13 | See an audit log of key actions, so that disputes and compliance questions can be answered | audit | Campaign starts, exports, Do Not Contact and people changes. |

**Branch Owner**

| ID | Story | Screen | Notes |
|---|---|---|---|
| BRO-01 | See a dashboard for my branches over a date range, so that I know how my branches are doing | reports | Default last 30 days. Switch branches or see them combined. |
| BRO-02 | See each agent’s numbers side by side, so that I can spot who needs help | reports | Same measures per agent, sortable. |
| BRO-03 | See all campaigns in my branches with status and results, so that I know what’s running | campaigns | Read-only. Filter by branch, agent and status. |
| BRO-04 | Open any campaign and see its messages, leads and conversations, so that I can coach agents on copy and follow-up | campaign | Read-only. |
| BRO-05 | See the health of every number in my branches, so that problems are flagged before campaigns stall | numbers | Alert when a number drops or a campaign is blocked. |
| BRO-06 | See my branches’ hot leads, so that I know which opportunities are live | hot | Read-only. |
| BRO-07 | Remove a contact from Do Not Contact, with a reason, so that mistaken entries can be corrected | dnc | Reason required. Logged. |
| BRO-08 | Export leads or hot leads from my branches to Excel, so that results go into the CRM | hot | Same export format as agents. |
| BRO-09 | See my agents’ upcoming and overdue follow-ups, so that I can make sure promised call-backs happen | dates | Read-only. Overdue items come first. |

**Support**

| ID | Story | Screen | Notes |
|---|---|---|---|
| SUP-01 | See every number with its lemlist user, agent and status, so that I know where to act | numbers | Refreshed from lemlist every few minutes. |
| SUP-02 | Be alerted when a number disconnects, is linked elsewhere or misses a licence, so that I can reconnect it before campaigns stall | numbers | Email or WhatsApp alert to Support. |
| SUP-03 | See how many free WhatsApp slots each lemlist user has, so that I know when to buy another licence | numbers | Max 5 numbers per lemlist user. |
| SUP-04 | Record a reconnection in the portal, so that Admins can see the issue was handled | numbers | Note plus timestamp on the number. |