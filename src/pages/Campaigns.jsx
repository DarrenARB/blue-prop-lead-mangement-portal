import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { must, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { ago, contactAddress } from "../lib/format";
import { Badge, Empty, ErrorNote, Field, Icon, ICONS, Modal, Spinner, useToast } from "../components/ui";
import AgentFilter, { useAgentFilter } from "../components/AgentFilter";

export const CAMPAIGN_STATUS = {
  draft: ["Draft", "muted"], launching: ["Launching", "brand"], running: ["Running", "ok"], paused: ["Paused", "warn"],
  stopped: ["Stopped", "bad"], ended: ["Ended", "muted"], blocked: ["Blocked", "bad"],
};
export const GOALS = [
  ["valuation", "Free valuations", "Offer homeowners a free, no-obligation valuation"],
  ["listings", "New listings", "Win listings from owners thinking of selling"],
  ["buyers", "Buyers", "Find people looking to buy"],
  ["rental", "Rentals", "Help landlords and tenants"],
  ["other", "Something else", "Start a conversation about their property needs"],
];
// Drafts and live campaigns are kept in separate views so nobody mistakes one for the other.
const VIEWS = [["live", "Live"], ["draft", "Drafts"], ["finished", "Finished"]];
export const viewOf = (status) => (status === "draft" ? "draft" : ["stopped", "ended"].includes(status) ? "finished" : "live");
const VIEW_HELP = {
  live: "Campaigns that have been launched and are sending, paused or need attention.",
  draft: "Campaigns still being set up. Nothing is sent to anyone until a draft is launched.",
  finished: "Campaigns that have ended or were stopped.",
};
const EMPTY = {
  live: ["No live campaigns", "Launched campaigns show here. Finish a draft and launch it once launching is switched on."],
  draft: ["No drafts", "A campaign takes about five minutes: name it, upload your leads, let AI draft the three messages, pick when they send."],
  finished: ["Nothing finished yet", "Campaigns move here once they end or are stopped."],
};
const STEP_NAMES = ["Basics", "Leads", "Messages", "Schedule", "Review"];
export const goalLabel = (g) => GOALS.find((x) => x[0] === g)?.[1] ?? "—";

export default function Campaigns() {
  const { profile, isAdmin } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [dup, setDup] = useState(null);
  const [sel, setSel] = useState(() => new Set()); // ticked campaigns; actions only appear once something is ticked
  const [busy, setBusy] = useState("");
  const toast = useToast();
  const nav = useNavigate();
  const [agentF, setAgentF] = useAgentFilter();
  const canCreate = isAdmin || profile.role === "agent";

  useEffect(() => {
    (async () => {
      try {
        const [camps, leads, people] = await Promise.all([
          supabase.from("campaigns").select("id, name, goal, status, wizard_step, agent_id, branch_id, updated_at, launched_at, brief, schedule, is_demo").order("updated_at", { ascending: false }).then(must),
          supabase.from("leads").select("campaign_id").then(must),
          supabase.from("profiles").select("id, full_name").then(must),
        ]);
        const counts = {};
        for (const l of leads ?? []) counts[l.campaign_id] = (counts[l.campaign_id] ?? 0) + 1;
        const names = Object.fromEntries((people ?? []).map((p) => [p.id, p.full_name]));
        setRows((camps ?? []).map((c) => ({ ...c, leads: counts[c.id] ?? 0, agent: names[c.agent_id] ?? "—" })));
      } catch (e) { setError(e); }
    })();
  }, []);

  const mineRows = useMemo(() => (rows ?? []).filter((r) => !agentF || r.agent_id === agentF), [rows, agentF]);
  const groups = useMemo(() => {
    const g = { live: [], draft: [], finished: [] };
    for (const r of mineRows) g[viewOf(r.status)].push(r);
    return g;
  }, [mineRows]);
  // Default: Live if anything is live, otherwise Drafts. ?view= keeps the choice in the link.
  const view = VIEWS.some((v) => v[0] === params.get("view")) ? params.get("view") : rows && groups.live.length === 0 ? "draft" : "live";
  const shown = groups[view];
  const setView = (v) => { setSel(new Set()); setParams({ view: v }, { replace: true }); };
  const picked = shown.filter((c) => sel.has(c.id));
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = shown.length > 0 && shown.every((c) => sel.has(c.id));
  const toggleAll = () => setSel(allOn ? new Set() : new Set(shown.map((c) => c.id)));
  const canDupAll = picked.length > 0 && picked.every((c) => canDuplicate(c, profile, isAdmin));
  const canDeleteAll = picked.length > 0 && picked.every((c) => c.status === "draft" && canDuplicate(c, profile, isAdmin));

  async function reload() {
    const camps = await supabase.from("campaigns").select("id, name, goal, status, wizard_step, agent_id, branch_id, updated_at, launched_at, brief, schedule, is_demo").order("updated_at", { ascending: false }).then(must);
    setRows((prev) => (camps ?? []).map((c) => ({ ...c, leads: prev?.find((p) => p.id === c.id)?.leads ?? 0, agent: prev?.find((p) => p.agent_id === c.agent_id)?.agent ?? "—" })));
  }
  async function duplicateMany() {
    if (picked.length === 1) return setDup(picked[0]);
    if (!window.confirm(`Make a draft copy of each of the ${picked.length} campaigns? Leads aren’t copied.`)) return;
    setBusy("dup");
    try {
      for (const c of picked) await copyCampaign(c, { name: `Copy of ${c.name}`.slice(0, 120), agentId: c.agent_id });
      toast(`${picked.length} draft copies made. They’re in Drafts.`);
      setSel(new Set()); await reload(); setView("draft");
    } catch (e) { toast(e.message, "bad"); }
    finally { setBusy(""); }
  }
  async function deleteDrafts() {
    if (!window.confirm(`Delete ${picked.length === 1 ? "this draft" : `these ${picked.length} drafts`}? Their uploaded leads go with them. This can’t be undone.`)) return;
    setBusy("del");
    const { error } = await supabase.from("campaigns").delete().in("id", picked.map((c) => c.id));
    setBusy("");
    if (error) return toast(error.message, "bad");
    toast(picked.length === 1 ? "Draft deleted" : `${picked.length} drafts deleted`);
    setRows((r) => r.filter((c) => !sel.has(c.id))); setSel(new Set());
  }
  async function exportLeads() {
    setBusy("export");
    try {
      const n = await exportCampaignLeads(picked, rows);
      toast(n ? `Exported ${n.toLocaleString("en-ZA")} lead${n === 1 ? "" : "s"}.` : "Those campaigns have no leads yet.", n ? undefined : "warn");
    } catch (e) { toast(e.message, "bad"); }
    finally { setBusy(""); }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{isAdmin ? "All branches" : profile.role === "owner" ? "Your branches" : "Your campaigns"}</p>
          <h1>Campaigns</h1>
          <p className="muted">Three WhatsApp messages sent from the agent’s own number. Old lemlist campaigns aren’t shown; only campaigns created here.</p>
        </div>
        {canCreate && <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon d={ICONS.plus} />New campaign</button>}
      </div>

      <div className="list-tools"><span /><AgentFilter value={agentF} onChange={setAgentF} /></div>
      <div className="tabs camp-views" role="tablist" aria-label="Campaign views">
        {VIEWS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={view === k} className={`tab ${view === k ? "active" : ""}`} onClick={() => setView(k)}>{l} <span className="tab-n">{groups[k].length}</span></button>
        ))}
      </div>
      <p className="muted small view-help">{VIEW_HELP[view]}</p>
      {picked.length > 0 && (
        <div className="sel-bar" role="toolbar" aria-label="Actions for the ticked campaigns">
          <strong>{picked.length} selected</strong>
          <button className="btn btn-sm" onClick={exportLeads} disabled={busy === "export"}><Icon d={ICONS.archive} />{busy === "export" ? "Exporting…" : "Export leads to Excel"}</button>
          {canDupAll && <button className="btn btn-sm" onClick={duplicateMany} disabled={busy === "dup"}><Icon d={ICONS.copy} />{busy === "dup" ? "Copying…" : picked.length === 1 ? "Duplicate" : "Duplicate each"}</button>}
          {canDeleteAll && <button className="btn btn-sm btn-danger" onClick={deleteDrafts} disabled={busy === "del"}>{picked.length === 1 ? "Delete draft" : "Delete drafts"}</button>}
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-link" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}
      {view === "draft" && <div className="note note-info">Launching is switched on once the first lemlist test is approved. Until then campaigns can be built end to end (leads, AI messages, schedule) and wait here as drafts.</div>}

      <ErrorNote error={error} />
      {!rows && !error ? <Spinner /> : rows && shown.length === 0 ? (
        <div className="card"><Empty title={EMPTY[view][0]} action={canCreate && view === "draft" ? <button className="btn btn-primary" onClick={() => setCreating(true)}>Start a campaign</button> : null}>
          {EMPTY[view][1]}
        </Empty></div>
      ) : rows && view === "draft" ? (
        <div className="draft-list">
          <label className="row small muted" style={{ gap: 8, paddingLeft: 4 }}><input type="checkbox" className="pick" checked={allOn} onChange={toggleAll} /> Select all drafts</label>
          {shown.map((c) => {
            const step = Math.min(Math.max(c.wizard_step ?? 1, 1), 5);
            return (
              <div key={c.id} className={`draft-card ${sel.has(c.id) ? "is-picked" : ""}`}>
                <input type="checkbox" className="pick" checked={sel.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.name}`} />
                <div className="draft-main">
                  <Link to={`/campaigns/${c.id}`} className="cell-title">{c.name}</Link>
                  <div className="cell-sub">{goalLabel(c.goal)}{profile.role !== "agent" ? ` · ${c.agent}` : ""} · {c.leads.toLocaleString("en-ZA")} lead{c.leads === 1 ? "" : "s"}</div>
                  <div className="draft-progress" aria-label={`Step ${step} of 5: ${STEP_NAMES[step - 1]}`}>
                    {STEP_NAMES.map((nm, i) => <span key={nm} className={i < step ? "on" : ""} title={nm} />)}
                  </div>
                  <div className="small muted">Step {step} of 5 · {STEP_NAMES[step - 1]} · saved {ago(c.updated_at)}</div>
                </div>
                <Link to={`/campaigns/${c.id}`} className="btn btn-primary btn-sm">Continue editing</Link>
              </div>
            );
          })}
        </div>
      ) : rows && (
        <div className="table-wrap">
          <table>
            <thead><tr><th className="pick-col"><input type="checkbox" className="pick" checked={allOn} onChange={toggleAll} aria-label="Select all" /></th><th>Campaign</th>{profile.role !== "agent" && <th>Agent</th>}<th>Status</th><th className="num">Leads</th><th>{view === "live" ? "Launched" : "Last change"}</th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className={sel.has(c.id) ? "is-picked" : ""}>
                  <td className="pick-col"><input type="checkbox" className="pick" checked={sel.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.name}`} /></td>
                  <td><Link to={`/campaigns/${c.id}`} className="cell-title">{c.name}</Link><div className="cell-sub">{goalLabel(c.goal)}</div></td>
                  {profile.role !== "agent" && <td>{c.agent}</td>}
                  <td><Badge tone={CAMPAIGN_STATUS[c.status]?.[1]}>{CAMPAIGN_STATUS[c.status]?.[0] ?? c.status}</Badge></td>
                  <td className="num">{c.leads.toLocaleString("en-ZA")}</td>
                  <td className="small">{ago(view === "live" ? c.launched_at ?? c.updated_at : c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewCampaign onClose={() => setCreating(false)} />}
      {dup && <DuplicateCampaign campaign={dup} onClose={() => setDup(null)} />}
    </>
  );
}

function NewCampaign({ onClose }) {
  const { profile, isAdmin } = useAuth();
  const nav = useNavigate();
  const [agents, setAgents] = useState(isAdmin ? null : []);
  const [f, setF] = useState({ name: "", goal: "valuation", agent_id: isAdmin ? "" : profile.id });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isAdmin) return;
    Promise.all([
      supabase.from("profiles").select("id, full_name, branch_id").eq("role", "agent").eq("status", "active").order("full_name").then(must),
      supabase.rpc("list_whatsapp_numbers").then(must),
    ]).then(([a, nums]) => setAgents((a ?? []).map((x) => ({ ...x, hasNumber: (nums ?? []).some((n) => n.agent_id === x.id && n.status !== "removed") }))))
      .catch(setError);
  }, [isAdmin]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (!f.name.trim()) throw new Error("Give the campaign a name.");
      if (!f.agent_id) throw new Error("Pick the agent whose number it sends from.");
      const c = await supabase.from("campaigns").insert({ name: f.name.trim(), goal: f.goal, agent_id: f.agent_id, brief: { goal: f.goal, tone: "friendly" } }).select("id").single().then(must);
      await supabase.from("campaign_messages").insert([1, 2, 3].map((p) => ({ campaign_id: c.id, position: p, delay_days: p === 1 ? 0 : p === 2 ? 2 : 4 })));
      nav(`/campaigns/${c.id}`);
    } catch (err) { setError(err); setBusy(false); }
  }

  const chosen = agents?.find((a) => a.id === f.agent_id);
  return (
    <Modal title="New campaign" sub="You can change all of this later." onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="new-camp" disabled={busy}>{busy ? "Creating…" : "Create draft"}</button></>}>
      <form id="new-camp" className="stack" onSubmit={submit}>
        <ErrorNote error={error} />
        <Field label="Campaign name" id="nc-name" hint="Only you and your admins see this.">
          <input id="nc-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Durbanville valuations – March" autoFocus />
        </Field>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 500, marginBottom: 6 }}>What’s it for?</legend>
          <div className="goal-grid">
            {GOALS.map(([k, l, d]) => (
              <label key={k} className={`goal-opt ${f.goal === k ? "on" : ""}`}>
                <input type="radio" name="goal" value={k} checked={f.goal === k} onChange={() => setF({ ...f, goal: k })} />
                <span className="goal-text"><strong>{l}</strong><span className="cell-sub">{d}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        {isAdmin && (
          <Field label="Sends from" id="nc-agent" hint="The agent’s own WhatsApp number is used.">
            {!agents ? <Spinner /> : agents.length === 0 ? <p className="muted small">No active agents yet. Add one on People first.</p> : (
              <select id="nc-agent" className="select" value={f.agent_id} onChange={(e) => setF({ ...f, agent_id: e.target.value })}>
                <option value="">Choose an agent…</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name}{a.hasNumber ? "" : " (no number yet)"}</option>)}
              </select>
            )}
          </Field>
        )}
        {chosen && !chosen.hasNumber && <div className="note note-warn">{chosen.full_name} doesn’t have a WhatsApp number linked yet. You can build the draft now; link a number on lemlist &amp; numbers before it launches.</div>}
      </form>
    </Modal>
  );
}

// ---------- Duplicate (AGT-11) ----------
// Agents duplicate their own campaigns; admins any. Branch Owners can't create campaigns, so they can't duplicate.
export const canDuplicate = (c, profile, isAdmin) => isAdmin || (profile.role === "agent" && c.agent_id === profile.id);

// Copies the name, goal, brief, the three messages with their delays, and the sending days and hours into a new
// draft. Leads aren't copied: upload a fresh list so every person goes through the Do Not Contact and Shotgun checks.
export async function copyCampaign(campaign, { name, agentId }) {
  const msgs = await supabase.from("campaign_messages").select("position, body, delay_days").eq("campaign_id", campaign.id).order("position").then(must);
  const { start_date, ...schedule } = campaign.schedule ?? {}; // a start date belongs to the old campaign
  const copy = await supabase.from("campaigns").insert({
    name, goal: campaign.goal, agent_id: agentId, brief: campaign.brief ?? {}, schedule,
    wizard_step: 2, is_demo: !!campaign.is_demo, // demo copies are cleared with the demo data
  }).select("id").single().then(must);
  const rows = [1, 2, 3].map((p) => {
    const m = (msgs ?? []).find((x) => x.position === p);
    return { campaign_id: copy.id, position: p, body: m?.body ?? "", delay_days: m?.delay_days ?? (p === 1 ? 0 : p === 2 ? 2 : 4) };
  });
  const { error } = await supabase.from("campaign_messages").insert(rows);
  if (error) throw error;
  return copy.id;
}

// Excel of every lead in the chosen campaigns (ADM-09, AGT-20, BRO-08). Each person only gets what RLS lets them see.
const LEAD_STATE = { ready: "Waiting to send", queued: "Queued", sent: "Sent", delivered: "Delivered", read: "Read", replied: "Replied", failed: "Failed", stopped: "Stopped", removed: "Removed" };
export async function exportCampaignLeads(campaigns, allRows) {
  const ids = campaigns.map((c) => c.id);
  const leads = [];
  for (let from = 0; ; from += 1000) {
    const page = await supabase.from("leads")
      .select("campaign_id, agent_id, contact_id, state, created_at, contact:contacts(first_name, last_name, phone_e164, email, suburb, unit, complex, street_number, street)")
      .in("campaign_id", ids).order("created_at").range(from, from + 999).then(must);
    leads.push(...(page ?? []));
    if (!page || page.length < 1000) break;
  }
  if (!leads.length) return 0;
  const contactIds = [...new Set(leads.map((l) => l.contact_id))];
  const conv = new Map();
  for (let i = 0; i < contactIds.length; i += 300) {
    const part = await supabase.from("conversations").select("contact_id, agent_id, score, last_message_at, hot:hot_leads(active)").in("contact_id", contactIds.slice(i, i + 300)).then(must);
    for (const v of part ?? []) conv.set(`${v.contact_id}|${v.agent_id}`, v);
  }
  const byId = Object.fromEntries((allRows ?? []).map((c) => [c.id, c]));
  const { default: writeXlsxFile } = await import("write-excel-file");
  const v = (l) => conv.get(`${l.contact_id}|${l.agent_id}`);
  await writeXlsxFile(leads, {
    fileName: `blue-prop-campaign-leads-${new Date().toISOString().slice(0, 10)}.xlsx`,
    schema: [
      { column: "Campaign", type: String, width: 28, value: (l) => byId[l.campaign_id]?.name ?? "" },
      { column: "Agent", type: String, width: 20, value: (l) => byId[l.campaign_id]?.agent ?? "" },
      { column: "First name", type: String, width: 16, value: (l) => l.contact?.first_name ?? "" },
      { column: "Surname", type: String, width: 16, value: (l) => l.contact?.last_name ?? "" },
      { column: "Phone", type: String, width: 18, value: (l) => l.contact?.phone_e164 ?? "" },
      { column: "Email", type: String, width: 26, value: (l) => l.contact?.email ?? "" },
      { column: "Suburb", type: String, width: 16, value: (l) => l.contact?.suburb ?? "" },
      { column: "Address", type: String, width: 28, value: (l) => (l.contact ? contactAddress(l.contact) ?? "" : "") },
      { column: "Status", type: String, width: 16, value: (l) => LEAD_STATE[l.state] ?? l.state },
      { column: "AI score", type: Number, value: (l) => v(l)?.score ?? null },
      { column: "Hot lead", type: String, value: (l) => ((Array.isArray(v(l)?.hot) ? v(l).hot[0]?.active : v(l)?.hot?.active) ? "Yes" : "") },
      { column: "Last message", type: Date, format: "yyyy-mm-dd hh:mm", width: 18, value: (l) => (v(l)?.last_message_at ? new Date(v(l).last_message_at) : null) },
      { column: "Added", type: Date, format: "yyyy-mm-dd", width: 12, value: (l) => new Date(l.created_at) },
    ],
  });
  return leads.length;
}

export function DuplicateCampaign({ campaign, onClose }) {
  const { profile, isAdmin } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState(`Copy of ${campaign.name}`.slice(0, 120));
  const [agentId, setAgentId] = useState(isAdmin ? campaign.agent_id : profile.id);
  const [agents, setAgents] = useState(isAdmin ? null : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isAdmin) return;
    supabase.from("profiles").select("id, full_name").eq("role", "agent").eq("status", "active").order("full_name").then(must)
      .then((a) => { setAgents(a ?? []); if (!(a ?? []).some((x) => x.id === campaign.agent_id)) setAgentId(""); })
      .catch(setError);
  }, [isAdmin, campaign.agent_id]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (!name.trim()) throw new Error("Give the copy a name.");
      if (!agentId) throw new Error("Pick the agent whose number it sends from.");
      const id = await copyCampaign(campaign, { name: name.trim(), agentId });
      nav(`/campaigns/${id}`);
    } catch (err) { setError(err); setBusy(false); }
  }

  return (
    <Modal title="Duplicate campaign" sub="Copies the goal, the three messages and the sending days and hours into a new draft. Leads aren’t copied: upload a fresh list so everyone is checked against Do Not Contact and the Shotgun list." onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="dup-camp" disabled={busy}>{busy ? "Copying…" : "Create copy"}</button></>}>
      <form id="dup-camp" className="stack" onSubmit={submit}>
        <ErrorNote error={error} />
        <Field label="Name of the copy" id="dup-name">
          <input id="dup-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
        </Field>
        {isAdmin && (
          <Field label="Sends from" id="dup-agent" hint="The agent’s own WhatsApp number is used.">
            {!agents ? <Spinner /> : (
              <select id="dup-agent" className="select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">Choose an agent…</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </select>
            )}
          </Field>
        )}
      </form>
    </Modal>
  );
}
