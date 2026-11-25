// campaigns: lead upload checks (format, duplicates, Do Not Contact, Shotgun list), AI message drafting with
// Claude Haiku, and bulk Do Not Contact. Nothing here writes to lemlist; launching is a separate step.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-haiku-5-5";
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

type Me = { id: string; full_name: string; role: string; is_fin_link: boolean };
const isAdmin = (m: Me) => m.role === "admin" || m.is_fin_link;

async function caller(req: Request): Promise<Me> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Please sign in again.");
  const { data: p } = await db.from("profiles").select("id, full_name, role, is_fin_link, status").eq("id", data.user.id).single();
  if (!p || p.status !== "active") throw new HttpError(403, "Your account is not active.");
  return p as Me;
}

async function editableCampaign(me: Me, id: string) {
  const { data: c } = await db.from("campaigns").select("*").eq("id", id).maybeSingle();
  if (!c) throw new HttpError(404, "Campaign not found.");
  if (!(isAdmin(me) || c.agent_id === me.id)) throw new HttpError(403, "You can only change your own campaigns.");
  return c;
}

// South African mobiles must be +27 6x/7x/8x with 9 digits after the 27; other countries: plain E.164.
export function normalisePhone(raw: unknown): string | null {
  let d = String(raw ?? "").trim().replace(/[\s\-().]/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (/^0\d{9}$/.test(d)) d = "+27" + d.slice(1);
  else if (/^27\d{9}$/.test(d)) d = "+" + d;
  else if (/^[6-8]\d{8}$/.test(d)) d = "+27" + d;
  if (d.startsWith("+27")) return /^\+27[6-8]\d{8}$/.test(d) ? d : null;
  return /^\+[1-9]\d{7,14}$/.test(d) ? d : null;
}
const clean = (v: unknown, max = 80) => {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  return s ? s.slice(0, max) : null;
};
const chunk = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function audit(me: Me, type: string, summary: string, data?: unknown) {
  await db.from("audit_log").insert({ actor_id: me.id, actor_name: me.full_name, type, summary, data: data ?? null });
}

// ---------- lead upload ----------
type Row = { phone?: string; first_name?: string; last_name?: string; suburb?: string; row_no?: number };

async function processUpload(me: Me, body: any) {
  const campaign = await editableCampaign(me, String(body.campaign_id ?? ""));
  if (campaign.status !== "draft") throw new HttpError(409, "Leads can only be uploaded to a draft from here.");
  const rows: Row[] = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) throw new HttpError(400, "The file has no rows.");
  if (rows.length > 5000) throw new HttpError(400, "Upload up to 5,000 rows at a time.");

  const { data: settings } = await db.from("settings").select("shotgun_months").eq("id", 1).single();
  const months = settings?.shotgun_months ?? 3;

  if (body.replace) await db.from("leads").delete().eq("campaign_id", campaign.id).eq("state", "ready");

  const rejections: { row_no: number; phone_raw: string | null; name: string | null; reason: string; detail?: string }[] = [];
  const seen = new Set<string>();
  const good: { phone: string; first_name: string | null; last_name: string | null; suburb: string | null; row_no: number }[] = [];

  rows.forEach((r, i) => {
    const row_no = r.row_no ?? i + 2;
    const name = [clean(r.first_name), clean(r.last_name)].filter(Boolean).join(" ") || null;
    const phone = normalisePhone(r.phone);
    if (!phone) { rejections.push({ row_no, phone_raw: clean(r.phone, 40), name, reason: "invalid_number" }); return; }
    if (seen.has(phone)) { rejections.push({ row_no, phone_raw: clean(r.phone, 40), name, reason: "duplicate", detail: "Appears more than once in this file" }); return; }
    seen.add(phone);
    good.push({ phone, first_name: clean(r.first_name, 60), last_name: clean(r.last_name, 60), suburb: clean(r.suburb, 80), row_no });
  });

  const phones = good.map((g) => g.phone);
  // Do Not Contact
  const dnc = new Set<string>();
  for (const part of chunk(phones, 500)) {
    const { data } = await db.from("dnc").select("phone_e164").in("phone_e164", part);
    for (const d of data ?? []) dnc.add(d.phone_e164);
  }
  // existing contacts
  const contactByPhone = new Map<string, any>();
  for (const part of chunk(phones, 500)) {
    const { data } = await db.from("contacts").select("id, phone_e164, first_name, last_name, suburb").in("phone_e164", part);
    for (const c of data ?? []) contactByPhone.set(c.phone_e164, c);
  }
  const existingIds = [...contactByPhone.values()].map((c) => c.id);
  // already in this campaign
  const inCampaign = new Set<string>();
  // messaged by another agent within the cooldown (only campaigns that actually launched count)
  const held = new Map<string, { agent_id: string; campaign_id: string; at: string }>();
  const since = new Date(); since.setMonth(since.getMonth() - months);
  for (const part of chunk(existingIds, 300)) {
    const { data: mine } = await db.from("leads").select("contact_id").eq("campaign_id", campaign.id).in("contact_id", part);
    for (const l of mine ?? []) inCampaign.add(l.contact_id);
    const { data: others } = await db.from("leads")
      .select("contact_id, agent_id, campaign_id, created_at, last_event_at, campaigns!inner(launched_at)")
      .in("contact_id", part).neq("agent_id", campaign.agent_id)
      .not("campaigns.launched_at", "is", null)
      .gte("created_at", since.toISOString());
    for (const l of (others ?? []) as any[]) {
      const at = l.last_event_at ?? l.created_at;
      const prev = held.get(l.contact_id);
      if (!prev || at > prev.at) held.set(l.contact_id, { agent_id: l.agent_id, campaign_id: l.campaign_id, at });
    }
  }

  const toAdd: typeof good = [];
  const shotgunRows: any[] = [];
  for (const g of good) {
    const existing = contactByPhone.get(g.phone);
    const name = [g.first_name, g.last_name].filter(Boolean).join(" ") || null;
    if (dnc.has(g.phone)) { rejections.push({ row_no: g.row_no, phone_raw: g.phone, name, reason: "dnc", detail: "On the Do Not Contact list" }); continue; }
    if (existing && inCampaign.has(existing.id)) { rejections.push({ row_no: g.row_no, phone_raw: g.phone, name, reason: "already_in_campaign" }); continue; }
    const h = existing ? held.get(existing.id) : undefined;
    if (h) {
      const free = new Date(h.at); free.setMonth(free.getMonth() + months);
      rejections.push({ row_no: g.row_no, phone_raw: g.phone, name, reason: "shotgun", detail: `Messaged by another agent; free from ${free.toISOString().slice(0, 10)}` });
      shotgunRows.push({ contact_id: existing.id, holder_agent_id: h.agent_id, holder_campaign_id: h.campaign_id, last_contacted_at: h.at, tried_agent_id: campaign.agent_id, tried_campaign_id: campaign.id, free_from: free.toISOString().slice(0, 10) });
      continue;
    }
    toAdd.push(g);
  }

  // create new contacts, fill blanks on existing ones
  const newContacts = toAdd.filter((g) => !contactByPhone.has(g.phone)).map((g) => ({ phone_e164: g.phone, first_name: g.first_name, last_name: g.last_name, suburb: g.suburb }));
  for (const part of chunk(newContacts, 500)) {
    const { data, error } = await db.from("contacts").upsert(part, { onConflict: "phone_e164" }).select("id, phone_e164");
    if (error) throw new HttpError(500, error.message);
    for (const c of data ?? []) contactByPhone.set(c.phone_e164, c);
  }
  for (const g of toAdd) {
    const c = contactByPhone.get(g.phone);
    if (c && (!c.first_name && g.first_name || !c.suburb && g.suburb)) {
      await db.from("contacts").update({ first_name: c.first_name ?? g.first_name, last_name: c.last_name ?? g.last_name, suburb: c.suburb ?? g.suburb }).eq("id", c.id);
    }
  }

  const counts: Record<string, number> = {};
  for (const r of rejections) counts[r.reason] = (counts[r.reason] ?? 0) + 1;
  const { data: upload, error: ue } = await db.from("uploads").insert({
    campaign_id: campaign.id, filename: clean(body.filename, 160), total_rows: rows.length, added: toAdd.length, rejected: counts, created_by: me.id,
  }).select("id").single();
  if (ue) throw new HttpError(500, ue.message);

  for (const part of chunk(toAdd, 500)) {
    const { error } = await db.from("leads").insert(part.map((g) => ({ campaign_id: campaign.id, contact_id: contactByPhone.get(g.phone).id, upload_id: upload.id, agent_id: campaign.agent_id })));
    if (error) throw new HttpError(500, error.message);
  }
  for (const part of chunk(rejections, 500)) await db.from("upload_rejections").insert(part.map((r) => ({ ...r, upload_id: upload.id })));
  // plain insert: the open-entry unique index is partial, so an already-open entry just fails quietly (23505)
  for (const s of shotgunRows) {
    const { error } = await db.from("shotgun").insert(s);
    if (error && error.code !== "23505") console.error("shotgun insert", error.message);
  }

  const { count } = await db.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", campaign.id);
  await audit(me, "campaigns", `Uploaded ${body.filename ?? "a lead list"} to “${campaign.name}”: ${toAdd.length} added, ${rejections.length} left out`, { campaign_id: campaign.id, counts });
  return { upload_id: upload.id, total: rows.length, added: toAdd.length, rejected: counts, campaign_leads: count ?? toAdd.length };
}

// ---------- AI (Claude Haiku) ----------
const SYSTEM = `You write WhatsApp prospecting messages for estate agents at Blue Property Group (Blue PROP), a South African real estate company.
Rules:
- English, warm and human, South African context. Never sound like a mass broadcast.
- Short: message 1 under 320 characters, messages 2 and 3 under 260.
- Each message asks at most ONE clear question.
- No links, no emojis in message 1, no prices, statistics or promises you can't know. No ALL CAPS.
- Use the placeholder {{firstName}} for the lead's first name. Use {{suburb}} only if it fits naturally.
- Message 1 introduces the agent by first name and Blue PROP and states the reason for reaching out.
- Message 2 is a friendly follow-up that adds one useful point.
- Message 3 is a polite last message that makes it easy to say not now (for example "reply STOP and I won't message again").
- Sign with the agent's first name only.
Return only JSON, no commentary.`;

async function claude(system: string, user: string, maxTokens = 900) {
  if (!ANTHROPIC_KEY) throw new HttpError(500, "The AI key isn’t set in Supabase secrets (ANTHROPIC_API_KEY).");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, `The AI service returned an error (${r.status})${out?.error?.message ? `: ${out.error.message}` : ""}.`);
  const text = (out.content ?? []).map((c: any) => c.text ?? "").join("");
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e < 0) throw new HttpError(502, "The AI reply couldn’t be read. Try again.");
  try { return JSON.parse(text.slice(s, e + 1)); } catch { throw new HttpError(502, "The AI reply couldn’t be read. Try again."); }
}

const GOALS: Record<string, string> = {
  valuation: "offer homeowners a free, no-obligation valuation of their home",
  listings: "win new listings from homeowners thinking of selling",
  buyers: "find out if they're looking to buy and help them find a home",
  rental: "help landlords or tenants with rentals",
  other: "start a conversation about their property needs",
};

async function draftMessages(me: Me, body: any) {
  const b = body.brief ?? {};
  const agentFirst = clean(body.agent_first_name, 40) ?? me.full_name.split(" ")[0];
  const user = `Write a 3-message WhatsApp sequence.
Agent first name: ${agentFirst}
Goal: ${GOALS[b.goal] ?? clean(b.goal, 200) ?? GOALS.other}
Who they're messaging: ${clean(b.audience, 300) ?? "homeowners in the area"}
What they're offering: ${clean(b.offer, 300) ?? "a free valuation and honest advice"}
Tone: ${clean(b.tone, 30) ?? "friendly"}
Return: {"messages":[{"body":"..."},{"body":"..."},{"body":"..."}]}`;
  const out = await claude(SYSTEM, user);
  const msgs = (out.messages ?? []).map((m: any) => String(m.body ?? m ?? "").trim()).filter(Boolean).slice(0, 3);
  if (msgs.length !== 3) throw new HttpError(502, "The AI didn’t return three messages. Try again.");
  return { messages: msgs, model: MODEL };
}

async function rewriteMessage(_me: Me, body: any) {
  const text = clean(body.body, 1200);
  if (!text) throw new HttpError(400, "There’s no message to rewrite.");
  const how = clean(body.instruction, 200) ?? "make it shorter and more personal";
  const user = `Rewrite this WhatsApp message (message ${Number(body.position) || 1} of 3). Keep {{firstName}} / {{suburb}} placeholders if present.
Instruction: ${how}
Message: """${text}"""
Return: {"body":"..."}`;
  const out = await claude(SYSTEM, user, 500);
  const res = String(out.body ?? "").trim();
  if (!res) throw new HttpError(502, "The AI didn’t return a message. Try again.");
  return { body: res };
}

// ---------- bulk Do Not Contact ----------
async function bulkDnc(me: Me, body: any) {
  if (!(isAdmin(me) || me.role === "owner")) throw new HttpError(403, "Only admins and Branch Owners can bulk upload Do Not Contact.");
  const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) throw new HttpError(400, "The file has no rows.");
  if (rows.length > 10000) throw new HttpError(400, "Upload up to 10,000 rows at a time.");
  const reason = clean(body.reason, 200);
  const seen = new Set<string>();
  const good: any[] = [];
  let invalid = 0;
  for (const r of rows) {
    const p = normalisePhone(r.phone);
    if (!p) { invalid++; continue; }
    if (seen.has(p)) continue;
    seen.add(p);
    good.push({ phone_e164: p, name: clean(r.name, 80), reason: clean(r.reason, 200) ?? reason, source: "bulk", added_by: me.id, added_by_name: me.full_name });
  }
  let added = 0;
  for (const part of chunk(good, 500)) {
    const { data, error } = await db.from("dnc").upsert(part, { onConflict: "phone_e164", ignoreDuplicates: true }).select("id");
    if (error) throw new HttpError(500, error.message);
    added += data?.length ?? 0;
  }
  await audit(me, "dnc", `Bulk uploaded Do Not Contact: ${added} added, ${good.length - added} already on the list, ${invalid} invalid`, { filename: clean(body.filename, 160) });
  return { added, already: good.length - added, invalid };
}


// ---------- inbox AI: score a conversation, suggest a follow-up ----------
async function seeConversation(me: Me, id: string) {
  const { data: cv } = await db.from("conversations").select("*").eq("id", id).maybeSingle();
  if (!cv) throw new HttpError(404, "Conversation not found.");
  if (!(isAdmin(me) || cv.agent_id === me.id)) {
    if (me.role !== "owner") throw new HttpError(403, "You can’t see that conversation.");
    const [{ data: a }, { data: mine }] = await Promise.all([
      db.from("profiles").select("branch_id").eq("id", cv.agent_id).single(),
      db.from("branch_owners").select("branch_id").eq("owner_id", me.id),
    ]);
    if (!(mine ?? []).some((b: any) => b.branch_id === a?.branch_id)) throw new HttpError(403, "You can’t see that conversation.");
  }
  return cv;
}

const SCORE_SYSTEM = `You score WhatsApp conversations between an estate agent at Blue Property Group (South Africa) and a lead.
Score how interested the lead is in doing business now, 0-100:
90-100 asks for a valuation/viewing/call or gives times; 70-89 clearly interested, asks questions; 40-69 lukewarm or "maybe later";
10-39 not now but polite; 0-9 hostile or asks to stop.
opt_out is true if the lead asks not to be messaged again in any language (e.g. "stop", "remove me", "moenie my weer kontak nie", "ungangithumeleli").
Return only JSON: {"score": number, "reason": "max 20 words, plain English", "opt_out": boolean}`;

async function scoreConversation(me: Me, body: any) {
  const cv = await seeConversation(me, String(body.conversation_id ?? ""));
  const { data: msgs } = await db.from("messages").select("id, direction, body, sent_at").eq("conversation_id", cv.id).order("sent_at", { ascending: false }).limit(10);
  const list = (msgs ?? []).reverse();
  const lastIn = [...list].reverse().find((m: any) => m.direction === "in");
  if (!lastIn) throw new HttpError(400, "There’s no reply from the lead to score yet.");
  const transcript = list.map((m: any) => `${m.direction === "in" ? "LEAD" : "AGENT"}: ${String(m.body).slice(0, 600)}`).join("\n");
  const out = await claude(SCORE_SYSTEM, `Conversation:\n${transcript}`, 200);
  const score = Math.max(0, Math.min(100, Math.round(Number(out.score))));
  if (!Number.isFinite(score)) throw new HttpError(502, "The AI reply couldn’t be read. Try again.");
  const reason = clean(out.reason, 200);
  const optOut = out.opt_out === true;
  const now = new Date().toISOString();
  await db.from("ai_scores").insert({ conversation_id: cv.id, agent_id: cv.agent_id, score, reason, opt_out: optOut, model: MODEL, source_message_id: lastIn.id });
  await db.from("conversations").update({ score, score_reason: reason, opt_out: optOut, scored_at: now }).eq("id", cv.id);

  const { data: settings } = await db.from("settings").select("hot_threshold").eq("id", 1).single();
  const threshold = settings?.hot_threshold ?? 70;
  const { data: hot } = await db.from("hot_leads").select("id, source").eq("conversation_id", cv.id).maybeSingle();
  if (!hot || hot.source === "ai") { // a person's decision always wins over the AI
    const active = score >= threshold && !optOut;
    if (hot) await db.from("hot_leads").update({ active, updated_at: now }).eq("id", hot.id);
    else if (active) await db.from("hot_leads").insert({ conversation_id: cv.id, contact_id: cv.contact_id, agent_id: cv.agent_id, campaign_id: cv.campaign_id, source: "ai", active: true });
  }
  if (optOut && !cv.is_sample) {
    const { data: c } = await db.from("contacts").select("phone_e164, first_name, last_name").eq("id", cv.contact_id).single();
    if (c) await db.from("dnc").upsert({ phone_e164: c.phone_e164, name: [c.first_name, c.last_name].filter(Boolean).join(" ") || null, reason: reason ?? "Asked not to be contacted", source: "ai_opt_out", needs_review: true, added_by_name: "AI (opt-out spotted)" }, { onConflict: "phone_e164", ignoreDuplicates: true });
  }
  return { score, reason, opt_out: optOut, hot: score >= threshold && !optOut, threshold };
}

const SUGGEST_SYSTEM = `You write one short, warm WhatsApp message an estate agent at Blue Property Group (South Africa) can send from their own phone.
Under 300 characters, one clear purpose, at most one question, no links, sign with the agent's first name. Return only JSON: {"body": "..."}`;
const DATE_PURPOSE: Record<string, string> = {
  followup: "a follow-up call-back the agent promised", birthday: "wishing them a happy birthday (no sales pitch)",
  anniversary: "the anniversary of buying their home; light touch, offer an updated valuation only if natural",
  lease: "their lease ending soon; offer help finding their next place or with renewing", other: "checking in",
};
async function suggestMessage(me: Me, body: any) {
  const type = String(body.type ?? "followup");
  const agentFirst = me.full_name.split(" ")[0];
  let context = "";
  if (body.conversation_id) {
    const cv = await seeConversation(me, String(body.conversation_id));
    const { data: msgs } = await db.from("messages").select("direction, body").eq("conversation_id", cv.id).order("sent_at", { ascending: false }).limit(6);
    context = (msgs ?? []).reverse().map((m: any) => `${m.direction === "in" ? "LEAD" : "AGENT"}: ${String(m.body).slice(0, 400)}`).join("\n");
  }
  const user = `Agent first name: ${agentFirst}
Lead first name: ${clean(body.first_name, 40) ?? "there"}
Purpose: ${DATE_PURPOSE[type] ?? DATE_PURPOSE.other}
Agent's note: ${clean(body.note, 300) ?? "none"}
${context ? `Recent conversation:\n${context}` : ""}`;
  const out = await claude(SUGGEST_SYSTEM, user, 300);
  const res = String(out.body ?? "").trim();
  if (!res) throw new HttpError(502, "The AI didn’t return a message. Try again.");
  return { body: res };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const me = await caller(req);
    switch (body.action) {
      case "process_upload": return json({ ok: true, ...(await processUpload(me, body)) });
      case "draft_messages": return json({ ok: true, ...(await draftMessages(me, body)) });
      case "rewrite_message": return json({ ok: true, ...(await rewriteMessage(me, body)) });
      case "bulk_dnc": return json({ ok: true, ...(await bulkDnc(me, body)) });
      case "score_conversation": return json({ ok: true, ...(await scoreConversation(me, body)) });
      case "suggest_message": return json({ ok: true, ...(await suggestMessage(me, body)) });
      default: throw new HttpError(400, "Unknown action.");
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
