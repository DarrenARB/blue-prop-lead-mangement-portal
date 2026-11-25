import { useCallback, useEffect, useState } from "react";
import { callFn, must, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { NUMBER_STATUS, ago, fmtDateTime, fmtPhone } from "../lib/format";
import { Badge, Empty, ErrorNote, Field, Icon, ICONS, Modal, Spinner, useToast } from "../components/ui";

const SLOTS_PER_USER = 5;

export default function Lemlist() {
  const { isAdmin, isFinLink, canManageNumbers, profile } = useAuth();
  const isOwnerView = !canManageNumbers;
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState("");
  const [manage, setManage] = useState(false);
  const [editNumber, setEditNumber] = useState(null);
  const [reconnect, setReconnect] = useState(null);

  const load = useCallback(async () => {
    try {
      const [conn, users, numbers, agents, branches, events] = await Promise.all([
        supabase.from("lemlist_connection").select("*").maybeSingle().then(must),
        supabase.from("lemlist_users").select("*").order("name").then(must),
        supabase.rpc("list_whatsapp_numbers").then(must),
        supabase.from("profiles").select("id, full_name, role, status, branch_id").eq("role", "agent").eq("status", "active").order("full_name").then(must),
        supabase.from("branches").select("id, name").then(must),
        supabase.from("number_events").select("*").order("at", { ascending: false }).limit(12).then(must),
      ]);
      setData({ conn, users, numbers, agents, branches, events });
    } catch (e) { setError(e); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  async function run(action, label) {
    setBusy(action);
    try {
      const out = await callFn("lemlist", { action });
      if (action === "test") toast(`Connected to lemlist team “${out.team_name}”`);
      if (action === "sync") toast(out.changes?.length ? `Synced: ${out.changes.length} change(s)` : `Synced ${out.numbers} number(s), no changes`);
      load();
    } catch (e) { toast(e.message, "bad"); }
    finally { setBusy(""); }
  }

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;

  const { conn, users, numbers, agents, branches, events } = data;
  const agentName = (id) => agents.find((a) => a.id === id)?.full_name;
  const agentBranch = (id) => branches.find((b) => b.id === agents.find((a) => a.id === id)?.branch_id)?.name;
  const userName = (id) => users.find((u) => u.id === id)?.name ?? id;
  const live = numbers.filter((n) => n.status !== "removed");
  const okCount = live.filter((n) => n.status === "ok").length;
  const bad = live.filter((n) => n.status !== "ok");
  const needPhone = live.filter((n) => !n.has_phone);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{isAdmin ? "Main Admin" : isOwnerView ? "Branch Owner" : "Support"}</p>
          <h1>{isAdmin ? "lemlist & WhatsApp numbers" : isOwnerView ? "Your branches’ WhatsApp numbers" : "WhatsApp numbers"}</h1>
          <p className="muted">{isOwnerView
            ? "The numbers your agents send from, checked with lemlist every 5 minutes. If one drops, Fin-Link Support is alerted automatically and the agent’s campaigns can’t send until it’s fixed."
            : "Numbers are checked with lemlist every 5 minutes. Only the lemlist users connected here are brought into the portal. The portal only reads from lemlist at this stage."}</p>
        </div>
        {!isOwnerView && <button className="btn" onClick={() => run("sync")} disabled={!!busy}><Icon d={ICONS.refresh} />{busy === "sync" ? "Syncing…" : "Sync now"}</button>}
      </div>

      {!isOwnerView && needPhone.length > 0 && (
        <div className="banner" role="alert" style={{ alignItems: "center" }}>
          <Icon d={ICONS.alert} />
          <div style={{ flex: 1 }}>
            <strong>{needPhone.length === 1 ? "1 WhatsApp number needs its phone number" : `${needPhone.length} WhatsApp numbers need their phone numbers`}.</strong>
            <div className="small">lemlist only shares the profile name, so enter each number once. It can’t be linked to an agent until you do. Numbers are stored encrypted.</div>
          </div>
          {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => setEditNumber(needPhone[0])}>Add phone number</button>}
        </div>
      )}

      {bad.length > 0 && (
        <div className="banner" role="alert">
          <Icon d={ICONS.alert} />
          <div>
            <strong>{bad.length} number{bad.length > 1 ? "s need" : " needs"} attention.</strong>
            <div className="small">{bad.map((n) => `${n.has_phone ? fmtPhone(n.phone_e164) : n.profile_label || n.id}: ${NUMBER_STATUS[n.status]?.[0]}`).join(" · ")}</div>
          </div>
        </div>
      )}

      <div className={`grid ${isOwnerView ? "g3" : "g4"}`} style={{ marginBottom: 18 }}>
        {!isOwnerView && <div className="kpi">
          <div className="kpi-label">lemlist connection</div>
          <div className="kpi-value" style={{ fontSize: 20 }}>
            <Badge tone={conn?.status === "ok" ? "ok" : conn?.status === "error" ? "bad" : "muted"}>{conn?.status === "ok" ? "Connected" : conn?.status === "error" ? "Error" : "Not checked"}</Badge>
          </div>
          <div className="kpi-sub">{conn?.team_name ? `Team “${conn.team_name}”` : "Run a connection test"}</div>
        </div>}
        <div className="kpi"><div className="kpi-label">Sending normally</div><div className="kpi-value">{okCount}<span className="muted" style={{ fontSize: 16, fontWeight: 400 }}> of {live.length}</span></div><div className="kpi-sub">Last check {ago(live.map((n) => n.last_checked_at).sort().pop())}</div></div>
        <div className="kpi"><div className="kpi-label">Need attention</div><div className="kpi-value" style={{ color: bad.length ? "var(--bad)" : undefined }}>{bad.length}</div><div className="kpi-sub">Disconnected, linked elsewhere or unlicensed</div></div>
        <div className="kpi"><div className="kpi-label">Linked to agents</div><div className="kpi-value">{live.filter((n) => n.agent_id).length}</div><div className="kpi-sub">{live.filter((n) => !n.agent_id).length} free</div></div>
      </div>

      {conn?.status === "error" && conn.last_error && <div className="note note-bad" style={{ marginBottom: 18 }}>{conn.last_error}</div>}

      {/* ---------- lemlist users ---------- */}
      {!isOwnerView && <section className="card">
        <div className="card-head">
          <div>
            <h2>lemlist users in the portal</h2>
            <p className="muted small">Each lemlist user can hold up to {SLOTS_PER_USER} WhatsApp numbers.</p>
          </div>
          {isAdmin && (
            <div className="row">
              <button className="btn btn-sm" onClick={() => run("test")} disabled={!!busy}>{busy === "test" ? "Testing…" : "Test connection"}</button>
              <button className="btn btn-sm" onClick={() => setManage(true)}>Connect lemlist users</button>
            </div>
          )}
        </div>
        {users.length === 0 ? (
          <Empty title="No lemlist users connected">Connect the lemlist user that holds Blue PROP’s WhatsApp numbers.</Empty>
        ) : (
          <div className="grid g3">
            {users.map((u) => {
              const used = live.filter((n) => n.lemlist_user_id === u.id).length;
              const warnings = (u.diagnostics ?? []).filter((d) => d.type === "error" || d.type === "warning");
              return (
                <div key={u.id} className="kpi">
                  <div className="row spread"><strong>{u.name}</strong><span className="mono muted">{u.id}</span></div>
                  <div className="kpi-value" style={{ fontSize: 22 }}>{used} of {SLOTS_PER_USER}<span className="muted" style={{ fontSize: 14, fontWeight: 400 }}> slots used</span></div>
                  <div className="bar" style={{ marginTop: 8 }}><span className="s-prog" style={{ width: `${(used / SLOTS_PER_USER) * 100}%`, opacity: 1 }} /></div>
                  <div className="kpi-sub" style={{ marginTop: 8 }}>
                    {SLOTS_PER_USER - used > 0 ? `${SLOTS_PER_USER - used} free slot${SLOTS_PER_USER - used > 1 ? "s" : ""}` : "Full: buy another licence for more numbers"}
                    {warnings.length > 0 && <> · <span style={{ color: "var(--warn)" }}>{warnings.map((d) => d.code.replace(/_/g, " ")).join(", ")}</span></>}
                  </div>
                  <div className="kpi-sub">Synced {ago(u.synced_at)}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>}

      {/* ---------- numbers ---------- */}
      <section className="card">
        <div className="card-head">
          <div><h2>WhatsApp numbers</h2><p className="muted small">{isOwnerView ? "One number per agent. Numbers are stored encrypted." : "lemlist shows the WhatsApp profile name, not the number, so enter each phone number once. Numbers are encrypted in the database and only shown to admins, Support, the agent who sends from it and their Branch Owner."}</p></div>
        </div>
        {numbers.length === 0 ? (
          <Empty title="No numbers yet">{isOwnerView ? "None of your agents has a WhatsApp number linked yet." : "Connect a lemlist user, then sync."}</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Number</th>{!isOwnerView && <th>lemlist user</th>}<th>Agent</th><th>Status</th><th>Checked</th>{!isOwnerView && <th></th>}</tr></thead>
              <tbody>
                {numbers.map((n) => (
                  <tr key={n.id} className={n.status === "removed" ? "dim" : ""}>
                    <td>
                      <div className="cell-title">{n.has_phone ? fmtPhone(n.phone_e164) : <Badge tone="bad">Phone number needed</Badge>}</div>
                      <div className="cell-sub">Profile “{n.profile_label || "—"}” · <span className="mono">{n.id}</span></div>
                    </td>
                    {!isOwnerView && <td>{userName(n.lemlist_user_id)}</td>}
                    <td>{agentName(n.agent_id) ? <><div>{agentName(n.agent_id)}</div>{agentBranch(n.agent_id) && <div className="cell-sub">{agentBranch(n.agent_id)}</div>}</> : <span className="muted">Not linked</span>}</td>
                    <td><Badge tone={NUMBER_STATUS[n.status]?.[1]}>{NUMBER_STATUS[n.status]?.[0] ?? n.status}</Badge><div className="cell-sub">since {ago(n.status_changed_at)}</div></td>
                    <td className="small muted">{ago(n.last_checked_at)}</td>
                    {!isOwnerView && <td className="num">
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        {isAdmin && (n.has_phone
                          ? <button className="btn btn-sm" onClick={() => setEditNumber(n)}>Edit</button>
                          : <button className="btn btn-sm btn-primary" onClick={() => setEditNumber(n)}>Add phone number</button>)}
                        <button className="btn btn-sm" onClick={() => setReconnect(n)}>Record reconnection</button>
                      </div>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------- recent events ---------- */}
      {!isOwnerView && <section className="card">
        <h2 style={{ marginBottom: 10 }}>Recent number activity</h2>
        {events.length === 0 ? <p className="muted">No status changes or reconnections yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Number</th><th>What happened</th></tr></thead>
              <tbody>
                {events.map((e) => {
                  const n = numbers.find((x) => x.id === e.number_id);
                  return (
                    <tr key={e.id}>
                      <td className="small" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(e.at)}</td>
                      <td>{n?.has_phone ? fmtPhone(n.phone_e164) : n?.profile_label || e.number_id}</td>
                      <td>{e.kind === "reconnected" ? <>Reconnection recorded: {e.note}</> : <>{NUMBER_STATUS[e.from_status]?.[0] ?? e.from_status} → <strong>{NUMBER_STATUS[e.to_status]?.[0] ?? e.to_status}</strong></>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>}

      {isFinLink && <SupportAlerts />}

      {manage && <ManageUsers onClose={() => setManage(false)} onChanged={load} />}
      {editNumber && <EditNumber number={editNumber} agents={agents} numbers={numbers} onClose={() => setEditNumber(null)} onSaved={() => { setEditNumber(null); load(); toast("Number saved"); }} />}
      {reconnect && <Reconnect number={reconnect} onClose={() => setReconnect(null)} onSaved={() => { setReconnect(null); load(); toast("Reconnection recorded"); }} />}
    </>
  );
}

const ALERT_KIND = {
  disconnected: ["Disconnected", "bad"], linked_elsewhere: ["Linked elsewhere", "bad"], licence_missing: ["Licence missing", "warn"],
  issue: ["Needs attention", "warn"], removed: ["Removed", "muted"], recovered: ["Back to normal", "ok"],
};

// Fin-Link only: who is told about number problems, and the alerts raised so far.
function SupportAlerts() {
  const toast = useToast();
  const [recips, setRecips] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [add, setAdd] = useState({ channel: "email", value: "", label: "" });
  const load = useCallback(async () => {
    try {
      setRecips(await supabase.from("alert_recipients").select("*").order("created_at").then(must));
      setAlerts(await supabase.from("alerts").select("*").order("created_at", { ascending: false }).limit(10).then(must));
    } catch (e) { toast(e.message, "bad"); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  async function addRecipient(e) {
    e.preventDefault();
    const value = add.value.trim();
    if (!value) return;
    const { error } = await supabase.from("alert_recipients").insert({ channel: add.channel, value, label: add.label.trim() || null });
    if (error) return toast(error.code === "23505" ? "That recipient is already on the list." : error.message, "bad");
    setAdd({ channel: "email", value: "", label: "" }); load();
  }
  async function toggle(r) {
    const { error } = await supabase.from("alert_recipients").update({ active: !r.active }).eq("id", r.id);
    if (error) return toast(error.message, "bad");
    load();
  }
  async function remove(r) {
    const { error } = await supabase.from("alert_recipients").delete().eq("id", r.id);
    if (error) return toast(error.message, "bad");
    load();
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Support alerts</h2>
          <p className="muted small">When a number disconnects, is linked elsewhere, loses its licence or is removed, an alert is raised for these people. Fin-Link only; the client doesn’t see this. Sending by email and WhatsApp is switched on in a later stage, so for now alerts are listed here.</p>
        </div>
      </div>
      <div className="grid g2">
        <div className="stack">
          <h3>Who gets alerted</h3>
          {!recips ? <Spinner /> : recips.length === 0 ? <p className="muted small">Nobody yet.</p> : (
            <div className="table-wrap">
              <table>
                <tbody>
                  {recips.map((r) => (
                    <tr key={r.id} className={r.active ? "" : "dim"}>
                      <td><div className="cell-title">{r.label || r.value}</div><div className="cell-sub">{r.channel === "email" ? "Email" : "WhatsApp"} · {r.value}</div></td>
                      <td className="num">
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                          <button className="btn btn-sm" onClick={() => toggle(r)}>{r.active ? "Pause" : "Resume"}</button>
                          <button className="btn btn-sm btn-danger" onClick={() => remove(r)}>Remove</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <form className="row" onSubmit={addRecipient} aria-label="Add alert recipient">
            <select className="select" style={{ width: "auto" }} value={add.channel} onChange={(e) => setAdd({ ...add, channel: e.target.value })} aria-label="Channel">
              <option value="email">Email</option><option value="whatsapp">WhatsApp</option>
            </select>
            <input className="input" style={{ flex: "1 1 180px" }} placeholder={add.channel === "email" ? "name@company.com" : "+27 82 555 0141"} value={add.value} onChange={(e) => setAdd({ ...add, value: e.target.value })} aria-label="Email or number" />
            <input className="input" style={{ flex: "1 1 140px" }} placeholder="Name (optional)" value={add.label} onChange={(e) => setAdd({ ...add, label: e.target.value })} aria-label="Name" />
            <button className="btn">Add</button>
          </form>
        </div>
        <div className="stack">
          <h3>Recent alerts</h3>
          {alerts.length === 0 ? <p className="muted small">No alerts yet. Every number has been healthy since alerts were switched on.</p> : alerts.map((a) => (
            <div key={a.id} className="money-row small">
              <span><Badge tone={ALERT_KIND[a.kind]?.[1] ?? "muted"}>{ALERT_KIND[a.kind]?.[0] ?? a.kind}</Badge> {a.summary}<div className="cell-sub">{fmtDateTime(a.created_at)} · {a.delivery === "queued" ? "Queued: sending switched on later" : a.delivery}</div></span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ManageUsers({ onClose, onChanged }) {
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    callFn("lemlist", { action: "available_users" }).then((o) => setUsers(o.users)).catch(setError);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggle(u) {
    setBusy(u.id);
    try {
      await callFn("lemlist", { action: u.connected ? "disconnect" : "connect", user_id: u.id });
      toast(u.connected ? `${u.name} disconnected` : `${u.name} connected and synced`);
      load(); onChanged();
    } catch (e) { toast(e.message, "bad"); }
    finally { setBusy(""); }
  }

  return (
    <Modal title="Connect lemlist users" sub="Live list from your lemlist team. Only connected users’ WhatsApp numbers come into the portal." onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <ErrorNote error={error} />
      {!users && !error && <Spinner />}
      {users && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>lemlist user</th><th className="num">WhatsApp numbers</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><div className="cell-title">{u.name}</div><div className="cell-sub mono">{u.id}</div></td>
                  <td className="num">{u.whatsapp}</td>
                  <td className="num">
                    <button className={`btn btn-sm ${u.connected ? "" : "btn-primary"}`} onClick={() => toggle(u)} disabled={!!busy}>
                      {busy === u.id ? "Working…" : u.connected ? "Disconnect" : "Connect"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function EditNumber({ number, agents, numbers, onClose, onSaved }) {
  const saved = number.has_phone ? fmtPhone(number.phone_e164) : "";
  const [phone, setPhone] = useState(saved);
  const [agentId, setAgentId] = useState(number.agent_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const taken = new Set(numbers.filter((n) => n.agent_id && n.id !== number.id).map((n) => n.agent_id));
  const needsPhone = !number.has_phone;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (needsPhone && !phone.trim()) return setError("Enter the phone number.");
    setBusy(true);
    try {
      const changedPhone = phone.trim() && phone.trim() !== saved ? phone : undefined;
      await callFn("lemlist", { action: "assign", number_id: number.id, agent_id: agentId || null, phone: changedPhone });
      onSaved();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={needsPhone ? "Add phone number" : "Edit WhatsApp number"} sub={`lemlist profile “${number.profile_label || "—"}” on ${number.lemlist_user_name ?? number.lemlist_user_id}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="num-form" disabled={busy}>{busy ? "Saving…" : "Save"}</button></>}>
      <form id="num-form" className="stack" onSubmit={submit}>
        {needsPhone && <div className="note note-warn">lemlist doesn’t share the number itself. Enter the number on the phone that scanned this account’s QR code in lemlist. You only do this once.</div>}
        <Field label={needsPhone ? "Phone number (required)" : "Phone number"} id="n-phone" hint="For example 082 555 0141 or +27 82 555 0141. Stored encrypted; the same number can’t be saved on two accounts.">
          <input id="n-phone" className="input" inputMode="tel" autoComplete="off" placeholder="082 555 0141" value={phone} onChange={(e) => setPhone(e.target.value)} required={needsPhone} />
        </Field>
        <Field label="Agent" id="n-agent" hint="Agents who already have a number aren’t listed.">
          <select id="n-agent" className="select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">Not linked</option>
            {agents.filter((a) => !taken.has(a.id)).map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </select>
        </Field>
        {agents.length === 0 && <p className="note note-info">No agents yet. Invite one on Branches & people.</p>}
        {number.phone_set_at && <p className="hint">Phone last saved {ago(number.phone_set_at)}.</p>}
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

function Reconnect({ number, onClose, onSaved }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await callFn("lemlist", { action: "record_reconnection", number_id: number.id, note }); onSaved(); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  return (
    <Modal title="Record reconnection" sub={number.has_phone ? fmtPhone(number.phone_e164) : number.profile_label || number.id} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="rc-form" disabled={busy}>Save</button></>}>
      <form id="rc-form" className="stack" onSubmit={submit}>
        <Field label="What did you do?" id="rc-note" hint="Saved with today’s date and time, so Admins can see it was handled.">
          <textarea id="rc-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Called the agent, re-scanned the QR code in lemlist." required />
        </Field>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
