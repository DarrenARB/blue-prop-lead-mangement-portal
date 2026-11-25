import { useCallback, useEffect, useMemo, useState } from "react";
import { callFn, must, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { Badge, CopyButton, Empty, ErrorNote, Icon, ICONS, Modal, Spinner, useToast } from "../components/ui";
import { DateModal, personName } from "./Inbox";
import AgentFilter, { useAgentFilter } from "../components/AgentFilter";

export const DATE_TYPES = {
  followup: { label: "Follow-up", tone: "brand" },
  birthday: { label: "Birthday", tone: "hot" },
  anniversary: { label: "Home anniversary", tone: "ok" },
  lease: { label: "Lease ending", tone: "warn" },
  other: { label: "Other", tone: "muted" },
};
const iso = (d) => d.toISOString().slice(0, 10);
const todayIso = () => iso(new Date(Date.now() + 2 * 3600e3)); // South African date

// For yearly dates (birthdays etc.) the next time it falls on or after today. Marking one done moves its date on a year.
export function effectiveDate(d) {
  const base = d.snoozed_until && d.snoozed_until > d.due_on ? d.snoozed_until : d.due_on;
  const t = todayIso();
  if (!d.yearly || base >= t) return base;
  const md = base.slice(5);
  const y = Number(t.slice(0, 4));
  return `${y}-${md}` >= t ? `${y}-${md}` : `${y + 1}-${md}`;
}

export function bucketDates(rows) {
  const t = todayIso();
  const week = iso(new Date(Date.now() + 9 * 864e5));
  const open = rows.filter((d) => d.yearly || !d.done_at).map((d) => ({ ...d, when: effectiveDate(d) })).sort((a, b) => a.when.localeCompare(b.when));
  return {
    overdue: open.filter((d) => d.when < t),
    today: open.filter((d) => d.when === t),
    soon: open.filter((d) => d.when > t && d.when <= week),
    later: open.filter((d) => d.when > week),
    done: rows.filter((d) => d.done_at && !d.yearly).sort((a, b) => b.done_at.localeCompare(a.done_at)).slice(0, 200),
  };
}

const TABS = [["overdue", "Overdue"], ["today", "Today"], ["soon", "Next 7 days"], ["later", "Later"], ["done", "Done"]];
const EMPTY = { overdue: "Nothing overdue. Well done.", today: "Nothing due today.", soon: "Nothing in the next 7 days.", later: "Nothing scheduled further ahead." };

export default function Dates() {
  const { profile, isAdmin } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [suggest, setSuggest] = useState(null);
  const [agentF, setAgentF] = useAgentFilter();
  const readOnly = profile.role === "owner";

  const load = useCallback(async () => {
    try {
      const [d, people] = await Promise.all([
        supabase.from("key_dates").select("*, contact:contacts(first_name, last_name, phone_e164, suburb)").order("due_on").limit(1000).then(must),
        supabase.from("profiles").select("id, full_name").then(must),
      ]);
      const names = Object.fromEntries((people ?? []).map((p) => [p.id, p.full_name]));
      setRows((d ?? []).map((x) => ({ ...x, agent: names[x.agent_id] ?? "—" })));
    } catch (e) { setError(e); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const b = useMemo(() => bucketDates((rows ?? []).filter((r) => !agentF || r.agent_id === agentF)), [rows, agentF]);
  // One status per tab so a long list never has to be scrolled through. Opens on the most urgent tab with items.
  const [tab, setTab] = useState(null);
  const view = tab ?? (TABS.find(([k]) => k !== "done" && b[k].length)?.[0] ?? "today");

  async function done(d) {
    // yearly dates: mark this year's one done by moving the base date on a year
    const fields = d.yearly ? { due_on: `${Number(d.when.slice(0, 4)) + 1}${d.when.slice(4)}`, snoozed_until: null } : { done_at: new Date().toISOString() };
    const { error } = await supabase.from("key_dates").update(fields).eq("id", d.id);
    if (error) return toast(error.message, "bad");
    toast(d.yearly ? "Done. See you next year." : "Marked as done"); load();
    window.dispatchEvent(new Event("bp:counts-changed"));
  }
  async function snooze(d, days) {
    const until = iso(new Date(new Date(d.when).getTime() + days * 864e5));
    const { error } = await supabase.from("key_dates").update({ snoozed_until: until }).eq("id", d.id);
    if (error) return toast(error.message, "bad");
    toast(`Snoozed to ${fmtDate(until)}`); load();
  }
  async function undo(d) {
    const { error } = await supabase.from("key_dates").update({ done_at: null }).eq("id", d.id);
    if (error) return toast(error.message, "bad");
    load();
  }
  async function remove(d) {
    if (!window.confirm("Delete this date?")) return;
    const { error } = await supabase.from("key_dates").delete().eq("id", d.id);
    if (error) return toast(error.message, "bad");
    load();
  }

  const Section = ({ list, empty }) => (
    <section className="card stack">
      {list.length === 0 ? <p className="muted small">{empty}</p> : (
        <ul className="date-list">
          {list.map((d) => (
            <li key={d.id} className="date-item">
              <div className="date-when"><strong>{fmtDate(d.when)}</strong>{d.yearly && <span className="cell-sub">Every year</span>}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cell-title">{d.contact ? personName(d.contact) : d.title || "—"} <Badge tone={DATE_TYPES[d.type]?.tone}>{DATE_TYPES[d.type]?.label}</Badge></div>
                {d.note && <div className="cell-sub">{d.note}</div>}
                {profile.role !== "agent" && <div className="cell-sub">{d.agent}</div>}
              </div>
              {!readOnly && (isAdmin || d.agent_id === profile.id) && (
                <div className="row date-actions">
                  <button className="btn btn-sm" onClick={() => setSuggest(d)}>Suggest message</button>
                  <button className="btn btn-sm btn-primary" onClick={() => done(d)}>Done</button>
                  <select className="select btn-sm" aria-label="Snooze" value="" onChange={(e) => e.target.value && snooze(d, Number(e.target.value))} style={{ width: "auto" }}>
                    <option value="">Snooze…</option><option value="1">1 day</option><option value="3">3 days</option><option value="7">1 week</option>
                  </select>
                  <button className="btn btn-sm btn-link" onClick={() => setModal(d)}>Edit</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{readOnly ? "Your agents" : isAdmin ? "All agents" : "Your contacts"}</p>
          <h1>Dates &amp; follow-ups</h1>
          <p className="muted">Call-backs you promised, birthdays, home anniversaries and leases ending. {readOnly ? "Overdue items first, so promised call-backs don’t slip." : "Due items also show on Home."}</p>
        </div>
        {!readOnly && <button className="btn btn-primary" onClick={() => setModal({})}><Icon d={ICONS.plus} />Add a date</button>}
      </div>
      <div className="list-tools"><span /><AgentFilter value={agentF} onChange={setAgentF} /></div>
      <ErrorNote error={error} />
      {!rows && !error ? <Spinner /> : rows && rows.length === 0 ? (
        <div className="card"><Empty title="Nothing scheduled">Set a follow-up from any conversation in the Inbox, or add a date here.</Empty></div>
      ) : rows && (
        <>
          <div className="tabs" role="tablist" aria-label="Dates by status">
            {TABS.map(([k, l]) => (
              <button key={k} role="tab" aria-selected={view === k} className={`tab ${view === k ? "active" : ""} ${k === "overdue" && b.overdue.length ? "tab-alert" : ""}`} onClick={() => setTab(k)}>
                {l} <span className="tab-n">{b[k].length}</span>
              </button>
            ))}
          </div>
          {view === "done" ? (
            <section className="card stack">
              {b.done.length === 0 ? <p className="muted small">Nothing marked done yet.</p> : (
                <ul className="date-list">
                  {b.done.map((d) => (
                    <li key={d.id} className="date-item dim">
                      <div className="date-when">{fmtDate(d.due_on)}<span className="cell-sub">done {fmtDate(d.done_at)}</span></div>
                      <div style={{ flex: 1 }}>{d.contact ? personName(d.contact) : d.title} · {DATE_TYPES[d.type]?.label}{profile.role !== "agent" && <div className="cell-sub">{d.agent}</div>}</div>
                      {!readOnly && <div className="row"><button className="btn btn-sm btn-link" onClick={() => undo(d)}>Undo</button><button className="btn btn-sm btn-link" onClick={() => remove(d)}>Delete</button></div>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : <Section list={b[view]} empty={EMPTY[view]} />}
        </>
      )}
      {modal && <DateModal initial={modal.id ? modal : null} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); toast("Date saved"); }} />}
      {suggest && <SuggestModal d={suggest} onClose={() => setSuggest(null)} />}
    </>
  );
}

function SuggestModal({ d, onClose }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(null);
  const run = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const o = await callFn("campaigns", { action: "suggest_message", type: d.type, note: d.note, first_name: d.contact?.first_name ?? d.title?.split(" ")[0], conversation_id: d.conversation_id });
      setText(o.body);
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }, [d]);
  useEffect(() => { run(); }, [run]);
  return (
    <Modal title="Suggested message" sub="Copy it, tweak it if you like, and send it from WhatsApp on your phone." onClose={onClose}
      footer={<><button type="button" className="btn" onClick={run} disabled={busy}>Try another</button>{text && <CopyButton text={text} label="Copy message" className="btn btn-primary" />}</>}>
      <ErrorNote error={error} />
      {busy ? <Spinner label="Writing" /> : <textarea className="textarea" rows={6} value={text} onChange={(e) => setText(e.target.value)} aria-label="Suggested message" />}
    </Modal>
  );
}
