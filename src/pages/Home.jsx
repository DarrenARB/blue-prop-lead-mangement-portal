import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { must, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { NUMBER_STATUS, ROLE_LABEL, ago, fmtPhone, fmtR } from "../lib/format";
import { Badge, Icon, ICONS, Spinner, useToast } from "../components/ui";
import { DATE_TYPES, bucketDates, typeLabel } from "./Dates";
import { personName } from "./Inbox";

const COMING = {
  agent: ["Campaigns sending through lemlist from your own number", "Replies arriving in your inbox automatically, each scored by AI", "Email reminders for your follow-ups"],
  owner: ["Dashboard for your branches", "Each agent’s numbers side by side", "Campaign results: sent, replied and hot leads"],
  admin: ["Company-wide dashboard", "Campaign results across all branches", "Invite emails instead of temporary passwords"],
  superadmin: ["Email and WhatsApp alerts when a number disconnects", "Company-wide dashboard", "Campaign results across all branches"],
};

export default function Home() {
  const { profile, isAdmin, canSeeNumbers, isFinLink } = useAuth();
  const [d, setD] = useState(null);

  useEffect(() => {
    (async () => {
      const out = {};
      const nums = (await supabase.rpc("list_whatsapp_numbers").then(must)) ?? [];
      out.myNumber = nums.find((x) => x.agent_id === profile.id) ?? null;
      if (canSeeNumbers) out.numbers = nums.filter((x) => x.status !== "removed");
      if (isAdmin) {
        out.people = await supabase.from("profiles").select("role, status").eq("status", "active").then(must);
        out.branches = await supabase.from("branches").select("id").is("archived_at", null).then(must);
        out.plan = await supabase.from("plan_items").select("price, status").eq("scope", "in_scope").then(must);
      }
      if (profile.role === "agent" && profile.branch_id) {
        out.branch = await supabase.from("branches").select("name").eq("id", profile.branch_id).maybeSingle().then(must);
      }
      setD(out);
    })().catch(() => setD({}));
  }, [profile, isAdmin, canSeeNumbers]);

  if (!d) return <Spinner />;
  const first = profile.full_name.split(" ")[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const n = d.myNumber;
  const bad = n && n.status !== "ok";

  const planTotal = d.plan?.reduce((s, i) => s + Number(i.price), 0) ?? 0;
  const planDone = d.plan?.filter((i) => i.status === "built" || i.status === "signed_off").reduce((s, i) => s + Number(i.price), 0) ?? 0;

  return (
    <>
      {profile.role === "agent" && bad && (
        <div className="banner" role="alert">
          <Icon d={ICONS.alert} />
          <div>
            <strong>Your WhatsApp number is {NUMBER_STATUS[n.status]?.[0].toLowerCase()}.</strong>
            <div className="small">Campaigns can’t send from it until it’s fixed. Fin-Link Support can see this too and will help you re-scan the QR code with your phone.</div>
          </div>
        </div>
      )}
      <div className="page-head">
        <div>
          <p className="eyebrow">{ROLE_LABEL[profile.role]}{d.branch ? ` · ${d.branch.name}` : ""}</p>
          <h1>{greet}, {first}</h1>
          <p className="muted">The portal is being built in stages. Here’s what’s live for you today.</p>
        </div>
      </div>

      {isFinLink && <DemoCard />}
      {profile.role !== "superadmin" && <DueNow />}

      <div className="grid g3">
        {profile.role === "agent" && (
          <div className="kpi">
            <div className="kpi-label">Your WhatsApp number</div>
            {n ? (
              <>
                <div className="kpi-value" style={{ fontSize: 22 }}>{n.has_phone ? fmtPhone(n.phone_e164) : n.profile_label}</div>
                <div style={{ marginTop: 6 }}><Badge tone={NUMBER_STATUS[n.status]?.[1]}>{NUMBER_STATUS[n.status]?.[0]}</Badge></div>
                <div className="kpi-sub" style={{ marginTop: 6 }}>Checked {ago(n.last_checked_at)}</div>
              </>
            ) : <div className="kpi-sub" style={{ marginTop: 6 }}>No number linked yet. Ask your Main Admin to link one.</div>}
          </div>
        )}
        {canSeeNumbers && d.numbers && (
          <Link to="/lemlist" className="kpi" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="kpi-label">WhatsApp numbers</div>
            <div className="kpi-value">{d.numbers.filter((x) => x.status === "ok").length}<span className="muted" style={{ fontSize: 16, fontWeight: 400 }}> of {d.numbers.length} sending</span></div>
            <div className="kpi-sub">{d.numbers.filter((x) => x.status !== "ok").length ? `${d.numbers.filter((x) => x.status !== "ok").length} need attention` : "All healthy"} · {d.numbers.filter((x) => !x.agent_id).length} not linked</div>
            {d.numbers.some((x) => !x.has_phone) && <div className="kpi-sub" style={{ color: "var(--bad)", fontWeight: 500, marginTop: 4 }}>{d.numbers.filter((x) => !x.has_phone).length} phone number{d.numbers.filter((x) => !x.has_phone).length > 1 ? "s" : ""} needed →</div>}
          </Link>
        )}
        {isAdmin && d.people && (
          <Link to="/team" className="kpi" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="kpi-label">People</div>
            <div className="kpi-value">{d.people.length}</div>
            <div className="kpi-sub">{d.people.filter((p) => p.role === "agent").length} agents · {d.branches.length} branch{d.branches.length === 1 ? "" : "es"}</div>
          </Link>
        )}
        {isAdmin && d.plan && (
          <Link to="/plan" className="kpi" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="kpi-label">Build progress</div>
            <div className="kpi-value">{planTotal ? Math.round((planDone / planTotal) * 100) : 0}%</div>
            <div className="bar" style={{ marginTop: 8 }}><span className="s-signed" style={{ width: `${planTotal ? (planDone / planTotal) * 100 : 0}%` }} /></div>
            <div className="kpi-sub" style={{ marginTop: 6 }}>{fmtR(planDone)} of {fmtR(planTotal)} delivered</div>
          </Link>
        )}
      </div>

      <section className="card" style={{ marginTop: 18 }}>
        <h2>Coming next for you</h2>
        <ul style={{ margin: "10px 0 0", paddingLeft: 20, color: "var(--muted)" }}>
          {(COMING[profile.role] ?? []).map((c) => <li key={c} style={{ padding: "3px 0" }}>{c}</li>)}
        </ul>
      </section>
    </>
  );
}

// Super Admins: load or remove the demo data every tester shares.
function DemoCard() {
  const [state, setState] = useState(null); // { loadedAt, agents }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const load = () => Promise.all([
    supabase.from("settings").select("demo_loaded_at").eq("id", 1).maybeSingle(),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "agent").eq("status", "active"),
  ]).then(([s, a]) => setState({ loadedAt: s.data?.demo_loaded_at ?? null, agents: a.count ?? 0 }));
  useEffect(() => { load(); }, []);
  async function run(fn) {
    if (fn === "clear_demo_data" && !window.confirm("Remove all demo data for everyone? Real data isn’t touched.")) return;
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc(fn);
    setBusy(false);
    if (error) return setMsg({ bad: true, text: error.message });
    window.location.reload();
    return data;
  }
  if (!state) return null;
  return (
    <section className="card stack" style={{ marginBottom: 18 }}>
      <div className="row spread" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px" }}>
          <h2>Demo data <span className="badge b-muted" style={{ marginLeft: 6 }}>Super Admin</span></h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            {state.loadedAt
              ? `Loaded ${new Date(state.loadedAt).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}. Each agent has their own set with different people: three campaigns (running, draft, ended), eight conversations with AI scores, hot leads, dates and Do Not Contact entries. Branch Owners see their agents’ sets; admins see all. Super Admins don’t get a set.`
              : `Gives each of the ${state.agents} active agent${state.agents === 1 ? "" : "s"} their own set of made-up people to play with: campaigns, inbox conversations with AI scores, hot leads, dates, Do Not Contact and a Shotgun clash. Everything is tagged, so one click removes it all.`}
          </p>
          {msg && <p className={`small ${msg.bad ? "t-bad" : ""}`}>{msg.text}</p>}
        </div>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !state.agents} onClick={() => run("load_demo_data")}>{busy ? "Working…" : state.loadedAt ? "Reload demo data" : "Load demo data"}</button>
          {state.loadedAt && <button className="btn" disabled={busy} onClick={() => run("clear_demo_data")}>Remove demo data</button>}
        </div>
      </div>
      {!state.agents && <p className="small muted">Add at least one agent on People first.</p>}
    </section>
  );
}

// Today's and overdue follow-ups and key dates, first thing after signing in.
// Agents see theirs; Branch Owners their agents' (read-only); Main Admins everyone's.
function DueNow() {
  const { profile, isAdmin } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const load = useCallback(async () => {
    try {
      const [dates, people] = await Promise.all([
        supabase.from("key_dates").select("*, contact:contacts(first_name, last_name, phone_e164, suburb)").order("due_on").limit(1000).then(must),
        profile.role === "agent" ? Promise.resolve([]) : supabase.from("profiles").select("id, full_name").then(must),
      ]);
      const names = Object.fromEntries((people ?? []).map((p) => [p.id, p.full_name]));
      const b = bucketDates((dates ?? []).map((x) => ({ ...x, agent: names[x.agent_id] ?? "" })));
      setRows([...b.overdue, ...b.today]);
    } catch { setRows([]); }
  }, [profile.role]);
  useEffect(() => { load(); }, [load]);

  async function done(d) {
    const fields = d.yearly ? { due_on: `${Number(d.when.slice(0, 4)) + 1}${d.when.slice(4)}`, snoozed_until: null } : { done_at: new Date().toISOString() };
    const { error } = await supabase.from("key_dates").update(fields).eq("id", d.id);
    if (error) return toast(error.message, "bad");
    toast(d.yearly ? "Done. See you next year." : "Marked as done");
    window.dispatchEvent(new Event("bp:counts-changed"));
    load();
  }

  if (!rows) return null;
  const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  const late = (d) => Math.round((Date.parse(today) - Date.parse(d.when)) / 864e5);
  const overdue = rows.filter((d) => d.when < today).length;
  const shown = rows.slice(0, 8);
  const mine = profile.role === "agent";
  if (!rows.length && !mine) return null; // managers only see this when something is due
  return (
    <section className={`card due-card ${overdue ? "has-overdue" : ""}`} aria-labelledby="due-h">
      <div className="due-head">
        <h2 id="due-h">{mine ? "Your follow-ups today" : profile.role === "owner" ? "Due today across your branches" : "Due today across Blue PROP"}</h2>
        <span className="small">
          {overdue > 0 && <Badge tone="bad">{overdue} overdue</Badge>} {rows.length - overdue > 0 && <Badge tone="brand">{rows.length - overdue} today</Badge>}
        </span>
        <span style={{ flex: 1 }} />
        <Link to="/dates" className="btn btn-sm">All dates</Link>
      </div>
      {rows.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Nothing due today and nothing overdue. Nice work.</p> : (
        <ul className="due-list">
          {shown.map((d) => {
            const n = late(d);
            const can = isAdmin || d.agent_id === profile.id;
            return (
              <li key={d.id} className={n > 0 ? "late" : ""}>
                <span className="due-when">{n > 0 ? (n === 1 ? "Yesterday" : `${n} days late`) : "Today"}</span>
                <span className="due-what">
                  <span className="cell-title">{d.contact ? personName(d.contact) : d.title || "—"}</span>{" "}
                  <Badge tone={DATE_TYPES[d.type]?.tone}>{typeLabel(d)}</Badge>
                  {(d.note || (!mine && d.agent)) && <span className="cell-sub" style={{ display: "block" }}>{[d.note, !mine ? d.agent : null].filter(Boolean).join(" · ")}</span>}
                </span>
                {can && <button className="btn btn-sm btn-primary" onClick={() => done(d)}>Done</button>}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > shown.length && <Link to="/dates" className="small" style={{ display: "inline-block", marginTop: 8 }}>+ {rows.length - shown.length} more on Dates</Link>}
    </section>
  );
}
