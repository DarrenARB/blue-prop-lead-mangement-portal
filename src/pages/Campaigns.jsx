import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { must, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { ago } from "../lib/format";
import { Badge, Empty, ErrorNote, Field, Icon, ICONS, Modal, Spinner } from "../components/ui";
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
export const goalLabel = (g) => GOALS.find((x) => x[0] === g)?.[1] ?? "—";

export default function Campaigns() {
  const { profile, isAdmin } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const [agentF, setAgentF] = useAgentFilter();
  const canCreate = isAdmin || profile.role === "agent";

  useEffect(() => {
    (async () => {
      try {
        const [camps, leads, people] = await Promise.all([
          supabase.from("campaigns").select("id, name, goal, status, wizard_step, agent_id, branch_id, updated_at, launched_at").order("updated_at", { ascending: false }).then(must),
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
  const shown = useMemo(() => mineRows.filter((r) => filter === "all" || (filter === "live" ? ["running", "paused", "launching"].includes(r.status) : r.status === filter)), [mineRows, filter]);
  const n = (s) => mineRows.filter((r) => (s === "live" ? ["running", "paused", "launching"].includes(r.status) : r.status === s)).length;

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

      <div className="note note-info">Launching is switched on once the first lemlist test is approved. Until then you can build campaigns end to end (leads, AI messages, schedule) and they stay as drafts.</div>

      <div className="list-tools"><span /><AgentFilter value={agentF} onChange={setAgentF} /></div>
      <div className="tabs" role="tablist" aria-label="Filter campaigns">
        {[["all", "All", mineRows.length], ["draft", "Drafts", n("draft")], ["live", "Live", n("live")], ["ended", "Ended", n("ended")]].map(([k, l, c]) => (
          <button key={k} role="tab" aria-selected={filter === k} className={`tab ${filter === k ? "active" : ""}`} onClick={() => setFilter(k)}>{l} <span className="tab-n">{c}</span></button>
        ))}
      </div>

      <ErrorNote error={error} />
      {!rows && !error ? <Spinner /> : rows && shown.length === 0 ? (
        <div className="card"><Empty title={rows.length ? "Nothing here" : "No campaigns yet"} action={canCreate && !rows.length ? <button className="btn btn-primary" onClick={() => setCreating(true)}>Start your first campaign</button> : null}>
          {rows.length ? "Try another filter." : "A campaign takes about five minutes: name it, upload your leads, let AI draft the three messages, pick when they send."}
        </Empty></div>
      ) : rows && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Campaign</th>{profile.role !== "agent" && <th>Agent</th>}<th>Status</th><th className="num">Leads</th><th>Last change</th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/campaigns/${c.id}`} className="cell-title">{c.name}</Link><div className="cell-sub">{goalLabel(c.goal)}{c.status === "draft" ? ` · step ${c.wizard_step} of 5` : ""}</div></td>
                  {profile.role !== "agent" && <td>{c.agent}</td>}
                  <td><Badge tone={CAMPAIGN_STATUS[c.status]?.[1]}>{CAMPAIGN_STATUS[c.status]?.[0] ?? c.status}</Badge></td>
                  <td className="num">{c.leads.toLocaleString("en-ZA")}</td>
                  <td className="small">{ago(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewCampaign onClose={() => setCreating(false)} />}
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
