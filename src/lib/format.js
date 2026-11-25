export const ROLE_LABEL = { admin: "Main Admin", owner: "Branch Owner", agent: "Agent", superadmin: "Super Admin" };

export const NUMBER_STATUS = {
  ok: ["Sending normally", "ok"],
  disconnected: ["Disconnected", "bad"],
  linked_elsewhere: ["Linked elsewhere", "bad"],
  licence_missing: ["Licence missing", "warn"],
  issue: ["Needs attention", "warn"],
  removed: ["Removed in lemlist", "muted"],
  unknown: ["Not checked yet", "muted"],
};

export const PLAN_STATUS = {
  not_started: ["Not started", "muted"],
  in_progress: ["In progress", "brand"],
  built: ["Built · awaiting sign-off", "warn"],
  signed_off: ["Signed off", "ok"],
};

export const GROUP_LABEL = {
  foundation: "Foundations",
  agent: "Agent",
  admin: "Main Admin",
  owner: "Branch Owner",
  support: "Support",
};

const rand = new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 0 });
export const fmtR = (n) => "R" + rand.format(Math.round(Number(n || 0))).replace(/ /g, " ");

export function fmtPhone(e164) {
  if (!e164) return "";
  const m = /^\+27(\d{2})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+27 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

export function ago(iso) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

export const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "";

export const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

export const initials = (name = "") =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
