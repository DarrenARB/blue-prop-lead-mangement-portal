// admin-users: first-run setup, invite, edit, deactivate/reactivate, reset password.
// verify_jwt is off so the first-run setup works before anyone exists; every other action checks the caller itself.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

const ROLES = ["admin", "owner", "agent", "superadmin"] as const;
type Role = typeof ROLES[number];
const ROLE_LABEL: Record<Role, string> = { admin: "Main Admin", owner: "Branch Owner", agent: "Agent", superadmin: "Super Admin" };

function tempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const s = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `Bp-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).trim().replace(/[\s\-()]/g, "");
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (/^0\d{9}$/.test(d)) d = "+27" + d.slice(1);
  else if (/^27\d{9}$/.test(d)) d = "+" + d;
  if (!/^\+\d{8,15}$/.test(d)) throw new HttpError(400, `“${raw}” isn’t a valid mobile number. Use a format like 082 555 0141 or +27 82 555 0141.`);
  return d;
}

async function audit(actor: { id: string; full_name: string } | null, type: string, summary: string, data?: unknown) {
  await db.from("audit_log").insert({ actor_id: actor?.id || null, actor_name: actor?.full_name ?? "System", type, summary, data: data ?? null });
}

async function caller(req: Request) {
  const internal = req.headers.get("x-internal-key");
  if (internal) {
    const { data } = await db.rpc("check_internal_key", { k: internal });
    if (data === true) return { id: null as unknown as string, full_name: "Fin-Link setup", role: "superadmin" as Role, is_fin_link: true, email: "" };
    throw new HttpError(401, "Bad internal key.");
  }
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Please sign in again.");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Please sign in again.");
  const { data: p } = await db.from("profiles").select("*").eq("id", data.user.id).single();
  if (!p || p.status !== "active") throw new HttpError(403, "Your account is not active.");
  return p as { id: string; full_name: string; role: Role; is_fin_link: boolean; email: string };
}

function requireAdmin(p: { role: Role; is_fin_link: boolean }) {
  if (!(p.role === "admin" || p.is_fin_link)) throw new HttpError(403, "Only a Main Admin can manage people.");
}

async function setOwnerBranches(ownerId: string, branchIds: string[]) {
  await db.from("branch_owners").delete().eq("owner_id", ownerId);
  if (branchIds.length) {
    const { error } = await db.from("branch_owners").insert(branchIds.map((b) => ({ owner_id: ownerId, branch_id: b })));
    if (error) throw new HttpError(400, error.message);
  }
}

const mask = (last4: string | null | undefined) => (last4 ? `+27 •• ••• ${last4}` : "number");

// Links a number to an agent. The phone itself is encrypted in the database by set_number_phone.
async function assignNumber(agentId: string, numberId: string | null, phone: string | null, byId: string) {
  // free whatever this agent held
  await db.from("whatsapp_numbers").update({ agent_id: null }).eq("agent_id", agentId);
  if (!numberId) return null;
  const { data: n } = await db.from("whatsapp_numbers").select("id, agent_id, phone_hash, phone_last4").eq("id", numberId).single();
  if (!n) throw new HttpError(400, "That WhatsApp number isn’t in the portal. Sync lemlist first.");
  if (n.agent_id && n.agent_id !== agentId) throw new HttpError(409, "That number is already linked to someone else.");
  let last4 = n.phone_last4 as string | null;
  if (phone && String(phone).trim()) {
    const e164 = normalisePhone(phone)!;
    const { data, error } = await db.rpc("set_number_phone", { p_id: numberId, p_phone: e164, p_by: byId });
    if (error) throw new HttpError(error.code === "23505" ? 409 : 400, error.code === "23505" ? "That phone number is already saved on another WhatsApp account." : error.message);
    last4 = data as string;
  } else if (!n.phone_hash) {
    throw new HttpError(400, "Enter the phone number for this WhatsApp account (lemlist doesn’t share it).");
  }
  const { error } = await db.from("whatsapp_numbers").update({ agent_id: agentId }).eq("id", numberId);
  if (error) throw new HttpError(400, error.message);
  return mask(last4);
}

function cleanName(s: unknown) {
  const v = String(s ?? "").trim();
  if (v.length < 2) throw new HttpError(400, "Enter the person’s full name.");
  return v.slice(0, 120);
}
function cleanEmail(s: unknown) {
  const v = String(s ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new HttpError(400, "Enter a valid email address.");
  return v;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    // ---------- First-run setup: creates the first Super Admin (Fin-Link). Only works while no one exists. ----------
    if (action === "bootstrap") {
      const { count } = await db.from("profiles").select("id", { count: "exact", head: true });
      if ((count ?? 0) > 0) throw new HttpError(409, "The portal is already set up. Please sign in.");
      const full_name = cleanName(body.full_name);
      const email = cleanEmail(body.email);
      const password = String(body.password ?? "");
      if (password.length < 10) throw new HttpError(400, "Use a password of at least 10 characters.");
      await db.rpc("allow_signup", { e: email });
      const { data, error } = await db.auth.admin.createUser({
        email, password, email_confirm: true,
        app_metadata: { portal: "true" }, user_metadata: { full_name },
      });
      if (error || !data.user) throw new HttpError(400, error?.message ?? "Could not create the account.");
      const { error: pe } = await db.from("profiles").insert({ id: data.user.id, email, full_name, role: "superadmin" });
      if (pe) { await db.auth.admin.deleteUser(data.user.id); throw new HttpError(400, pe.message); }
      await audit({ id: data.user.id, full_name }, "people", `${full_name} set up the portal as Super Admin (Fin-Link)`);
      return json({ ok: true });
    }

    const me = await caller(req);
    requireAdmin(me);

    // ---------- Invite (create account with a temporary password) ----------
    if (action === "invite") {
      const full_name = cleanName(body.full_name);
      const email = cleanEmail(body.email);
      const role = body.role as Role;
      if (!ROLES.includes(role)) throw new HttpError(400, "Pick a role.");
      if (role === "superadmin" && !me.is_fin_link) throw new HttpError(403, "Only a Super Admin can add another Super Admin.");
      const branch_id = role === "agent" ? (body.branch_id || null) : null;
      if (role === "agent" && !branch_id) throw new HttpError(400, "Agents must belong to a branch.");
      const ownerBranches: string[] = role === "owner" ? (body.owner_branch_ids ?? []) : [];
      if (role === "owner" && !ownerBranches.length) throw new HttpError(400, "Pick at least one branch for this Branch Owner.");

      const { data: exists } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
      if (exists) throw new HttpError(409, "Someone with that email already has an account.");

      const password = tempPassword();
      await db.rpc("allow_signup", { e: email });
      const { data, error } = await db.auth.admin.createUser({
        email, password, email_confirm: true,
        app_metadata: { portal: "true" }, user_metadata: { full_name },
      });
      if (error || !data.user) throw new HttpError(400, error?.message ?? "Could not create the account.");
      const uid = data.user.id;
      const { error: pe } = await db.from("profiles").insert({ id: uid, email, full_name, role, branch_id, must_change_password: true });
      if (pe) { await db.auth.admin.deleteUser(uid); throw new HttpError(400, pe.message); }
      try {
        if (role === "owner") await setOwnerBranches(uid, ownerBranches);
        let phone: string | null = null;
        if (role === "agent" && body.number_id) phone = await assignNumber(uid, body.number_id, body.phone ?? null, me.id);
        await audit(me, "people", `Invited ${full_name} as ${ROLE_LABEL[role]}${phone ? `, sending from ${phone}` : ""}`, { user_id: uid, email, role, branch_id, ownerBranches, number_id: body.number_id ?? null });
      } catch (e) {
        await db.auth.admin.deleteUser(uid);
        throw e;
      }
      return json({ ok: true, user_id: uid, temp_password: password });
    }

    const targetId = String(body.id ?? "");
    const { data: target } = await db.from("profiles").select("*").eq("id", targetId).maybeSingle();
    if (!target) throw new HttpError(404, "That person wasn’t found.");
    if (target.is_fin_link && !me.is_fin_link) throw new HttpError(403, "Fin-Link accounts can only be changed by Fin-Link.");

    // ---------- Edit ----------
    if (action === "update") {
      const full_name = cleanName(body.full_name ?? target.full_name);
      const role = (body.role ?? target.role) as Role;
      if (!ROLES.includes(role)) throw new HttpError(400, "Pick a role.");
      if (target.id === me.id && role !== target.role) throw new HttpError(400, "You can’t change your own role.");
      if ((role === "superadmin" || target.role === "superadmin") && role !== target.role && !me.is_fin_link) throw new HttpError(403, "Only a Super Admin can give or remove the Super Admin role.");
      const branch_id = role === "agent" ? (body.branch_id ?? target.branch_id) : null;
      if (role === "agent" && !branch_id) throw new HttpError(400, "Agents must belong to a branch.");
      const ownerBranches: string[] = role === "owner" ? (body.owner_branch_ids ?? []) : [];
      if (role === "owner" && !ownerBranches.length) throw new HttpError(400, "Pick at least one branch for this Branch Owner.");

      const { error } = await db.from("profiles").update({ full_name, role, branch_id, updated_at: new Date().toISOString() }).eq("id", target.id);
      if (error) throw new HttpError(400, error.message);
      await setOwnerBranches(target.id, ownerBranches);
      let phone: string | null = null;
      if (role === "agent") {
        if ("number_id" in body) phone = await assignNumber(target.id, body.number_id || null, body.phone ?? null, me.id);
      } else {
        await db.from("whatsapp_numbers").update({ agent_id: null }).eq("agent_id", target.id);
      }
      const changes: string[] = [];
      if (full_name !== target.full_name) changes.push(`name to ${full_name}`);
      if (role !== target.role) changes.push(`role to ${ROLE_LABEL[role]}`);
      if (branch_id !== target.branch_id) changes.push("branch");
      if (role === "owner") changes.push("owned branches");
      if ("number_id" in body && role === "agent") changes.push(body.number_id ? `WhatsApp number to ${phone}` : "removed WhatsApp number");
      await audit(me, "people", `Updated ${full_name}${changes.length ? ": " + changes.join(", ") : ""}`, { user_id: target.id });
      return json({ ok: true });
    }

    // ---------- Deactivate ----------
    if (action === "deactivate") {
      if (target.id === me.id) throw new HttpError(400, "You can’t deactivate yourself.");
      const { data: held } = await db.from("whatsapp_numbers").select("id, phone_last4").eq("agent_id", target.id);
      const { error } = await db.auth.admin.updateUserById(target.id, { ban_duration: "876000h" });
      if (error) throw new HttpError(400, error.message);
      await db.from("profiles").update({ status: "deactivated", updated_at: new Date().toISOString() }).eq("id", target.id);
      await db.from("whatsapp_numbers").update({ agent_id: null }).eq("agent_id", target.id);
      const freed = (held ?? []).map((n) => mask(n.phone_last4)).join(", ");
      await audit(me, "people", `Deactivated ${target.full_name}${freed ? `; freed number ${freed}` : ""}`, { user_id: target.id, freed_numbers: held });
      return json({ ok: true });
    }

    // ---------- Reactivate ----------
    if (action === "reactivate") {
      const { error } = await db.auth.admin.updateUserById(target.id, { ban_duration: "none" });
      if (error) throw new HttpError(400, error.message);
      await db.from("profiles").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", target.id);
      await audit(me, "people", `Reactivated ${target.full_name}`, { user_id: target.id });
      return json({ ok: true });
    }

    // ---------- Reset password ----------
    if (action === "reset_password") {
      // Resetting a password ends that account's sessions, so resetting your own would lock you out mid-session.
      if (me.id && target.id === me.id) throw new HttpError(400, "You can’t reset your own password here. Use Change password instead.");
      const password = tempPassword();
      const { error } = await db.auth.admin.updateUserById(target.id, { password });
      if (error) throw new HttpError(400, error.message);
      await db.from("profiles").update({ must_change_password: true, updated_at: new Date().toISOString() }).eq("id", target.id);
      // any "forgot password" requests from this person are now handled
      await db.from("password_help_requests").update({ resolved_at: new Date().toISOString(), resolved_by: me.id || null }).eq("profile_id", target.id).is("resolved_at", null);
      await audit(me, "people", `Reset the password for ${target.full_name}`, { user_id: target.id });
      return json({ ok: true, temp_password: password });
    }

    throw new HttpError(400, "Unknown action.");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
