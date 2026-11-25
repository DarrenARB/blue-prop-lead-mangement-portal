// lemlist: connection test, list lemlist users, connect/disconnect a lemlist user, sync WhatsApp numbers + health,
// and link a number to an agent. Only GET requests are ever sent to lemlist from this function.
// Phone numbers are encrypted in Postgres (set_number_phone); this function never stores or logs them in plain text.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LEMLIST_KEY = Deno.env.get("LEMLIST_API_KEY") ?? "";
const BASE = "https://api.lemlist.com/api";
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

type Diag = { scope?: string; type?: string; code?: string; message?: string; channelType?: string };
type Channel = { type: string; id: string; label?: string; diagnostics?: Diag[] };
type Sender = { userId: string; name?: string; email?: string; channels?: Channel[]; diagnostics?: Diag[] };

async function lemlistGet(path: string) {
  if (!LEMLIST_KEY) throw new HttpError(500, "The lemlist API key isn’t set in Supabase secrets (LEMLIST_API_KEY).");
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(BASE + path, { headers: { Authorization: "Basic " + btoa(":" + LEMLIST_KEY) } });
    if (r.status === 429) {
      const wait = Number(r.headers.get("retry-after") ?? "2");
      await new Promise((res) => setTimeout(res, Math.min(10, Math.max(1, wait)) * 1000));
      continue;
    }
    const text = await r.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep text */ }
    if (r.status === 401) throw new HttpError(502, "lemlist rejected the API key. Check LEMLIST_API_KEY.");
    if (!r.ok) throw new HttpError(502, `lemlist returned ${r.status} for ${path.split("?")[0]}.`);
    return body;
  }
  throw new HttpError(503, "lemlist is rate-limiting us. Try again in a few seconds.");
}

async function getSenders(): Promise<Sender[]> {
  const b: any = await lemlistGet("/senders");
  return (b?.data?.senders ?? b?.senders ?? []) as Sender[];
}

function statusOf(ch: Channel, userDiags: Diag[] = []) {
  const errs = [
    ...(ch.diagnostics ?? []).filter((d) => d.type === "error"),
    ...userDiags.filter((d) => d.type === "error" && (!d.channelType || d.channelType === "whatsapp")),
  ].map((d) => d.code);
  if (errs.includes("channel_disconnected")) return "disconnected";
  if (errs.includes("channel_linked_elsewhere")) return "linked_elsewhere";
  if (errs.includes("license_missing")) return "licence_missing";
  if (errs.length) return "issue";
  return "ok";
}

function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).trim().replace(/[\s\-()]/g, "");
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (/^0\d{9}$/.test(d)) d = "+27" + d.slice(1);
  else if (/^27\d{9}$/.test(d)) d = "+" + d;
  if (!/^\+\d{8,15}$/.test(d)) throw new HttpError(400, `“${raw}” isn’t a valid mobile number. Use a format like 082 555 0141 or +27 82 555 0141.`);
  return d;
}

type Actor = { id: string | null; full_name: string; role: string; is_fin_link: boolean };
async function audit(actor: Actor, type: string, summary: string, data?: unknown) {
  await db.from("audit_log").insert({ actor_id: actor.id, actor_name: actor.full_name, type, summary, data: data ?? null });
}

async function whoIsCalling(req: Request): Promise<Actor> {
  const internal = req.headers.get("x-internal-key");
  if (internal) {
    const { data } = await db.rpc("check_internal_key", { k: internal });
    if (data === true) return { id: null, full_name: "Scheduled sync", role: "system", is_fin_link: false };
    throw new HttpError(401, "Bad internal key.");
  }
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Please sign in again.");
  const { data: p } = await db.from("profiles").select("id, full_name, role, is_fin_link, status").eq("id", data.user.id).single();
  if (!p || p.status !== "active") throw new HttpError(403, "Your account is not active.");
  return p as Actor;
}
const label = (last4: string | null | undefined, id: string) => (last4 ? `number ending ${last4}` : id);
const isAdmin = (a: Actor) => a.role === "admin" || a.is_fin_link || a.role === "system";
const canSeeNumbers = (a: Actor) => isAdmin(a) || a.role === "support";

const STATUS_TEXT: Record<string, string> = {
  ok: "is sending normally again", disconnected: "has disconnected", linked_elsewhere: "is linked on another device or account",
  licence_missing: "has no lemlist WhatsApp licence", issue: "needs attention", removed: "was removed from lemlist",
};

// Raises a support alert to the active recipients. Delivery (email / WhatsApp) is switched on in a later stage,
// so alerts are queued and shown in the portal for now.
async function raiseAlert(numberId: string, last4: string | null | undefined, profile: string | null | undefined, from: string | null, to: string) {
  if (from === to) return;
  if (to === "ok" && (!from || from === "unknown")) return; // a healthy new number isn't news
  const { data: recips } = await db.from("alert_recipients").select("channel, value, label").eq("active", true);
  const who = last4 ? `WhatsApp number ending ${last4}` : `WhatsApp account “${profile ?? numberId}”`;
  await db.from("alerts").insert({
    number_id: numberId,
    kind: to === "ok" ? "recovered" : to,
    summary: `${who} ${STATUS_TEXT[to] ?? `changed to ${to}`}.`,
    recipients: recips ?? [],
    delivery: (recips ?? []).length ? "queued" : "not_needed",
  });
}

async function sync(actor: Actor) {
  const now = new Date().toISOString();
  let senders: Sender[];
  try {
    senders = await getSenders();
  } catch (e) {
    await db.from("lemlist_connection").update({ status: "error", last_error: (e as Error).message, checked_at: now }).eq("id", 1);
    throw e;
  }
  const { data: connected } = await db.from("lemlist_users").select("id").eq("connected", true);
  const ids = new Set((connected ?? []).map((u) => u.id));
  const changes: string[] = [];
  let numbers = 0;

  for (const s of senders) {
    if (!ids.has(s.userId)) continue; // only lemlist users connected to the portal are brought in
    await db.from("lemlist_users").update({ name: s.name ?? null, email: s.email ?? null, diagnostics: s.diagnostics ?? [], synced_at: now }).eq("id", s.userId);
    const wa = (s.channels ?? []).filter((c) => c.type === "whatsapp");
    const { data: existing } = await db.from("whatsapp_numbers").select("id, status, phone_last4, profile_label").eq("lemlist_user_id", s.userId);
    const prev = new Map((existing ?? []).map((n) => [n.id, n]));
    for (const ch of wa) {
      numbers++;
      const st = statusOf(ch, s.diagnostics);
      const before = prev.get(ch.id);
      const row: Record<string, unknown> = {
        id: ch.id, lemlist_user_id: s.userId, profile_label: ch.label ?? null, status: st,
        diagnostics: ch.diagnostics ?? [], last_checked_at: now,
      };
      if (!before || before.status !== st) row.status_changed_at = now;
      await db.from("whatsapp_numbers").upsert(row, { onConflict: "id" });
      if (before && before.status !== st) {
        await db.from("number_events").insert({ number_id: ch.id, kind: "status_change", from_status: before.status, to_status: st });
        changes.push(`${label(before.phone_last4, ch.id)}: ${before.status} → ${st}`);
        await raiseAlert(ch.id, before.phone_last4, ch.label, before.status, st);
      } else if (!before) {
        changes.push(`new number ${ch.label ?? ch.id} on ${s.name}`);
        if (st !== "ok") await raiseAlert(ch.id, null, ch.label, null, st);
      }
      prev.delete(ch.id);
    }
    // numbers no longer on this lemlist user
    for (const gone of prev.values()) {
      if (gone.status !== "removed") {
        await db.from("whatsapp_numbers").update({ status: "removed", status_changed_at: now, last_checked_at: now }).eq("id", gone.id);
        await db.from("number_events").insert({ number_id: gone.id, kind: "status_change", from_status: gone.status, to_status: "removed" });
        changes.push(`${label(gone.phone_last4, gone.id)}: removed from lemlist`);
        await raiseAlert(gone.id, gone.phone_last4, gone.profile_label, gone.status, "removed");
      }
    }
  }
  await db.from("lemlist_connection").update({ status: "ok", last_error: null, checked_at: now, last_sync_at: now }).eq("id", 1);
  if (changes.length) await audit(actor, "numbers", `lemlist sync: ${changes.join("; ")}`);
  return { numbers, changes };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;
    const actor = await whoIsCalling(req);

    if (action === "sync") {
      if (!canSeeNumbers(actor)) throw new HttpError(403, "Not allowed.");
      return json({ ok: true, ...(await sync(actor)) });
    }

    if (action === "record_reconnection") {
      const numberId = String(body.number_id ?? "");
      const note = String(body.note ?? "").trim();
      if (!canSeeNumbers(actor) || actor.role === "system") throw new HttpError(403, "Not allowed.");
      if (!note) throw new HttpError(400, "Say what you did.");
      await db.from("number_events").insert({ number_id: numberId, kind: "reconnected", note, by_user: actor.id });
      await audit(actor, "numbers", `Recorded reconnection on ${numberId}: ${note}`);
      return json({ ok: true });
    }

    if (!isAdmin(actor) || actor.role === "system") throw new HttpError(403, "Only a Main Admin can manage the lemlist connection.");

    if (action === "test") {
      const now = new Date().toISOString();
      try {
        const t: any = await lemlistGet("/team");
        await db.from("lemlist_connection").update({ team_name: t?.name ?? null, status: "ok", last_error: null, checked_at: now }).eq("id", 1);
        return json({ ok: true, team_name: t?.name ?? null, users: Array.isArray(t?.userIds) ? t.userIds.length : null });
      } catch (e) {
        await db.from("lemlist_connection").update({ status: "error", last_error: (e as Error).message, checked_at: now }).eq("id", 1);
        throw e;
      }
    }

    if (action === "available_users") {
      const senders = await getSenders();
      const { data: connected } = await db.from("lemlist_users").select("id").eq("connected", true);
      const ids = new Set((connected ?? []).map((u) => u.id));
      return json({
        ok: true,
        users: senders.map((s) => ({
          id: s.userId, name: s.name ?? s.userId,
          whatsapp: (s.channels ?? []).filter((c) => c.type === "whatsapp").length,
          connected: ids.has(s.userId),
        })),
      });
    }

    if (action === "connect") {
      const userId = String(body.user_id ?? "");
      const s = (await getSenders()).find((x) => x.userId === userId);
      if (!s) throw new HttpError(404, "That lemlist user wasn’t found in the lemlist team.");
      await db.from("lemlist_users").upsert({ id: s.userId, name: s.name ?? null, email: s.email ?? null, connected: true, diagnostics: s.diagnostics ?? [], connected_at: new Date().toISOString() }, { onConflict: "id" });
      await audit(actor, "lemlist", `Connected lemlist user ${s.name ?? s.userId} to the portal`);
      const result = await sync(actor);
      return json({ ok: true, ...result });
    }

    if (action === "disconnect") {
      const userId = String(body.user_id ?? "");
      const { data: held } = await db.from("whatsapp_numbers").select("id").eq("lemlist_user_id", userId).not("agent_id", "is", null);
      if (held?.length) throw new HttpError(409, "Unlink the agents from this lemlist user’s numbers first.");
      const { data: u } = await db.from("lemlist_users").select("name").eq("id", userId).maybeSingle();
      await db.from("lemlist_users").delete().eq("id", userId);
      await audit(actor, "lemlist", `Disconnected lemlist user ${u?.name ?? userId} from the portal`);
      return json({ ok: true });
    }

    if (action === "assign") {
      const numberId = String(body.number_id ?? "");
      const agentId = body.agent_id ? String(body.agent_id) : null;
      const { data: n } = await db.from("whatsapp_numbers").select("id, agent_id, phone_hash, phone_last4").eq("id", numberId).maybeSingle();
      if (!n) throw new HttpError(404, "Number not found.");
      let last4 = n.phone_last4 as string | null;
      let hasPhone = !!n.phone_hash;
      const changed: string[] = [];
      if (typeof body.phone === "string" && body.phone.trim()) {
        const e164 = normalisePhone(body.phone)!;
        const { data, error } = await db.rpc("set_number_phone", { p_id: numberId, p_phone: e164, p_by: actor.id });
        if (error) throw new HttpError(error.code === "23505" ? 409 : 400, error.code === "23505" ? "That phone number is already saved on another WhatsApp account." : error.message);
        last4 = data as string; hasPhone = true;
        changed.push(`saved phone ending ${last4}`);
      }
      let agentName: string | null = null;
      if (agentId) {
        const { data: a } = await db.from("profiles").select("id, full_name, role, status").eq("id", agentId).maybeSingle();
        if (!a || a.role !== "agent" || a.status !== "active") throw new HttpError(400, "Pick an active agent.");
        if (!hasPhone) throw new HttpError(400, "Enter the phone number first (lemlist doesn’t share it).");
        agentName = a.full_name;
        await db.from("whatsapp_numbers").update({ agent_id: null }).eq("agent_id", agentId).neq("id", numberId);
      }
      if (agentId !== n.agent_id) {
        const { error } = await db.from("whatsapp_numbers").update({ agent_id: agentId }).eq("id", numberId);
        if (error) throw new HttpError(400, error.code === "23505" ? "That agent already has a number." : error.message);
        changed.push(agentId ? `linked to ${agentName}` : "unlinked its agent");
      }
      if (changed.length) await audit(actor, "numbers", `WhatsApp ${label(last4, numberId)}: ${changed.join(", ")}`, { number_id: numberId, agent_id: agentId });
      return json({ ok: true });
    }

    throw new HttpError(400, "Unknown action.");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
