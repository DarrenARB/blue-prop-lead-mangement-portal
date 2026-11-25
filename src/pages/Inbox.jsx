import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { callFn, must, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { ago, fmtDateTime, fmtPhone } from "../lib/format";
import { Badge, CopyButton, Empty, ErrorNote, Field, Icon, ICONS, Modal, Spinner, useToast } from "../components/ui";
import { DATE_TYPES } from "./Dates";
import ReasonPicker, { DNC_ADD_REASONS } from "../components/ReasonPicker";
import AgentFilter, { useAgentFilter } from "../components/AgentFilter";

// The full back-and-forth with a lead. Long chats scroll inside the box (the page doesn't grow forever),
// open at the newest message, are split by day, and offer a "Newest" button when you've scrolled up.
const dayLabel = (iso) => {
  const d = new Date(iso), t = new Date(), y = new Date(); y.setDate(t.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, t)) return "Today";
  if (same(d, y)) return "Yesterday";
  return d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== t.getFullYear() ? { year: "numeric" } : {}) });
};
const timeOnly = (iso) => new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });

function ChatHistory({ msgs }) {
  const box = useRef(null);
  const [away, setAway] = useState(false); // scrolled up from the newest message
  useLayoutEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [msgs]);
  const onScroll = () => { const el = box.current; if (el) setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 80); };
  const toNewest = () => box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
  if (!msgs) return <Spinner />;
  const ins = msgs.filter((m) => m.direction === "in").length;
  let lastDay = null;
  return (
    <div className="chat">
      <div className="chat-count small muted">
        {msgs.length} message{msgs.length === 1 ? "" : "s"}{ins ? ` · ${ins} from the lead` : ""}{msgs.length > 6 ? " · scroll up for earlier messages" : ""}
      </div>
      <div className="wa-thread chat-scroll" ref={box} onScroll={onScroll} aria-label="Conversation" tabIndex={0}>
        {msgs.length === 0 ? <p className="muted small">No messages stored yet.</p> : msgs.map((m) => {
          const day = new Date(m.sent_at).toDateString();
          const sep = day !== lastDay; lastDay = day;
          return (
            <div key={m.id} className="chat-item">
              {sep && <div className="chat-day"><span>{dayLabel(m.sent_at)}</span></div>}
              <div className={`wa-msg ${m.direction}`}>
                <div className="wa-bubble">{m.body}</div>
                <div className="wa-meta">{m.direction === "out" ? (m.step ? `Message ${m.step} · ` : "") + (m.status ? `${m.status} · ` : "") : ""}{timeOnly(m.sent_at)}</div>
              </div>
            </div>
          );
        })}
      </div>
      {away && <button type="button" className="btn btn-sm chat-newest" onClick={toNewest}>↓ Newest</button>}
    </div>
  );
}

export const notReady = (toast, what) => toast(`${what} isn’t working yet. It’s switched on in a later stage.`, "warn");
export const scoreTone = (s, t = 70) => (s == null ? "muted" : s >= t ? "ok" : s >= 40 ? "warn" : "muted");
export const personName = (c) => [c?.first_name, c?.last_name].filter(Boolean).join(" ") || (c?.phone_e164 ? `Number ending ${c.phone_e164.slice(-4)}` : "Unknown contact");

export default function Inbox() {
  const { profile, isAdmin, isFinLink } = useAuth();
  const toast = useToast();
  const [convs, setConvs] = useState(null);
  const [threshold, setThreshold] = useState(70);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState("");
  const [agentF, setAgentF] = useAgentFilter();

  const load = useCallback(async () => {
    try {
      const [c, hot, people, settings] = await Promise.all([
        supabase.from("conversations").select("*, contact:contacts(first_name, last_name, phone_e164, suburb, email), campaign:campaigns(name)").eq("archived", false).order("last_message_at", { ascending: false, nullsFirst: false }).limit(500).then(must),
        supabase.from("hot_leads").select("conversation_id, active, source").then(must),
        supabase.from("profiles").select("id, full_name").then(must),
        supabase.from("settings").select("hot_threshold").eq("id", 1).single().then(must),
      ]);
      const hotBy = Object.fromEntries((hot ?? []).map((h) => [h.conversation_id, h]));
      const names = Object.fromEntries((people ?? []).map((p) => [p.id, p.full_name]));
      setConvs((c ?? []).map((x) => ({ ...x, hot: hotBy[x.id] ?? null, agent: names[x.agent_id] ?? "—" })));
      setThreshold(settings?.hot_threshold ?? 70);
    } catch (e) { setError(e); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (convs ?? []).filter((c) => {
      if (agentF && c.agent_id !== agentF) return false;
      if (filter === "unread" && !c.unread) return false;
      if (filter === "hot" && !c.hot?.active) return false;
      if (filter === "unscored" && c.score != null) return false;
      if (!t) return true;
      return personName(c.contact).toLowerCase().includes(t) || (c.last_preview ?? "").toLowerCase().includes(t) || (c.contact?.suburb ?? "").toLowerCase().includes(t);
    });
  }, [convs, filter, q, agentF]);
  const open = convs?.find((c) => c.id === openId) ?? null;
  const count = (f) => (convs ?? []).filter((c) => !agentF || c.agent_id === agentF).filter((c) => (f === "unread" ? c.unread : f === "hot" ? c.hot?.active : c.score == null)).length;
  const hasSamples = (convs ?? []).some((c) => c.is_sample);

  async function samples(load_) {
    setBusy("samples");
    const { error } = await supabase.rpc(load_ ? "load_demo_data" : "clear_demo_data");
    setBusy("");
    if (error) {
      if (/could not find the function|does not exist/i.test(error.message)) return notReady(toast, "Sample data");
      return toast(error.message, "bad");
    }
    toast(load_ ? "Demo data loaded" : "Demo data removed");
    window.dispatchEvent(new Event("bp:counts-changed"));
    setOpenId(null); load();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{isAdmin ? "All agents" : profile.role === "owner" ? "Your branches" : "Your WhatsApp"}</p>
          <h1>Inbox</h1>
          <p className="muted">Every reply to a portal campaign, scored by AI. This is read-only: reply from WhatsApp on your phone.</p>
        </div>
        <div className="row">
          {isFinLink && !hasSamples && <button className="btn" disabled={busy === "samples"} onClick={() => samples(true)}>Load demo data</button>}
          <button className="btn" onClick={() => notReady(toast, "Syncing replies from lemlist")}>Check for new replies</button>
        </div>
      </div>


      <div className="list-tools"><span /><AgentFilter value={agentF} onChange={(v) => { setAgentF(v); setOpenId(null); }} /></div>
      <div className="tabs" role="tablist" aria-label="Filter conversations">
        {[["all", "All", (convs ?? []).filter((c) => !agentF || c.agent_id === agentF).length], ["unread", "Unread", count("unread")], ["hot", "Hot", count("hot")], ["unscored", "Not scored", count("unscored")]].map(([k, l, n]) => (
          <button key={k} role="tab" aria-selected={filter === k} className={`tab ${filter === k ? "active" : ""}`} onClick={() => setFilter(k)}>{l} <span className="tab-n">{n}</span></button>
        ))}
      </div>
      <ErrorNote error={error} />

      {!convs && !error ? <Spinner /> : convs && convs.length === 0 ? (
        <div className="card"><Empty title="No replies yet">Replies to your campaigns appear here within a minute of arriving, each with an AI score. Campaigns can’t launch yet, so this stays empty for now.{isFinLink ? " Load the demo data to try it out." : ""}</Empty></div>
      ) : convs && (
        <div className={`inbox ${open ? "has-open" : ""}`}>
          <div className="inbox-list card">
            <input className="input" type="search" placeholder="Search name, suburb or message" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search conversations" />
            {shown.length === 0 ? <p className="muted small" style={{ padding: 12 }}>No conversations match.</p> : (
              <ul className="conv-list">
                {shown.map((c) => (
                  <li key={c.id}>
                    <button className={`conv ${openId === c.id ? "active" : ""} ${c.unread ? "unread" : ""}`} onClick={() => setOpenId(c.id)}>
                      <span className="conv-top">
                        <span className="conv-name">{personName(c.contact)}</span>
                        <span className="conv-time">{ago(c.last_message_at)}</span>
                      </span>
                      <span className="conv-preview">{c.last_direction === "out" ? "You: " : ""}{c.last_preview || "—"}</span>
                      <span className="conv-tags">
                        {c.score != null ? <Badge tone={scoreTone(c.score, threshold)}>{c.score}</Badge> : <Badge>Not scored</Badge>}
                        {c.hot?.active && <Badge tone="hot">Hot</Badge>}
                        {c.opt_out && <Badge tone="bad">Opt-out</Badge>}
                        {profile.role !== "agent" && <span className="cell-sub">{c.agent}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {open ? <Thread key={open.id} conv={open} threshold={threshold} onBack={() => setOpenId(null)} onChanged={load} />
            : <div className="card inbox-empty"><p className="muted">Pick a conversation to read it.</p></div>}
        </div>
      )}
    </>
  );
}

function Thread({ conv, threshold, onBack, onChanged }) {
  const { profile, isAdmin } = useAuth();
  const toast = useToast();
  const [msgs, setMsgs] = useState(null);
  const [scores, setScores] = useState([]);
  const [busy, setBusy] = useState("");
  const [modal, setModal] = useState(null); // 'dnc' | 'date' | 'hot'
  const canAct = isAdmin || conv.agent_id === profile.id;

  useEffect(() => {
    supabase.from("messages").select("*").eq("conversation_id", conv.id).order("sent_at").then(must).then(setMsgs).catch((e) => toast(e.message, "bad"));
    supabase.from("ai_scores").select("score, reason, scored_at, model").eq("conversation_id", conv.id).order("scored_at", { ascending: false }).limit(5).then(must).then(setScores).catch(() => {});
    if (conv.unread && canAct) supabase.from("conversations").update({ unread: false }).eq("id", conv.id).then(() => { onChanged(); window.dispatchEvent(new Event("bp:counts-changed")); });
  }, [conv.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function rescore() {
    setBusy("score");
    try {
      const o = await callFn("campaigns", { action: "score_conversation", conversation_id: conv.id });
      toast(`Scored ${o.score}${o.hot ? " · now a Hot Lead" : ""}${o.opt_out ? " · opt-out spotted, sent to Do Not Contact for review" : ""}`);
      onChanged();
    } catch (e) { toast(e.message, "bad"); }
    finally { setBusy(""); }
  }
  async function archive() {
    const { error } = await supabase.from("conversations").update({ archived: true }).eq("id", conv.id);
    if (error) return toast(error.message, "bad");
    toast("Archived"); onBack(); onChanged();
  }
  const c = conv.contact;

  const panel = useRef(null);
  useEffect(() => { panel.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }); }, [conv.id]);
  return (
    <div className="card thread" ref={panel}>
      <div className="thread-head">
        <button className="btn btn-sm inbox-back" onClick={onBack}>← Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>{personName(c)} {conv.is_sample && <Badge>Demo</Badge>}</h2>
          <div className="cell-sub">{c?.phone_e164 ? fmtPhone(c.phone_e164) : ""}{c?.suburb ? ` · ${c.suburb}` : ""}{conv.campaign?.name ? ` · ${conv.campaign.name}` : ""}</div>
        </div>
        {c?.phone_e164 && <CopyButton text={c.phone_e164} label="Copy number" />}
      </div>

      <div className={`score-card tone-${scoreTone(conv.score, threshold)}`}>
        <div className="score-num" aria-label={conv.score != null ? `AI score ${conv.score} out of 100` : "Not scored yet"}>{conv.score ?? "–"}</div>
        <div style={{ flex: 1 }}>
          <strong>{conv.score == null ? "Not scored yet" : conv.score >= threshold ? "Hot lead" : conv.score >= 40 ? "Warm" : "Cold"}</strong>
          <div className="small">{conv.score_reason ?? "The AI scores each reply from 0 to 100 with a one-line reason."}</div>
          {conv.hot && <div className="cell-sub">{conv.hot.active ? "In Hot Leads" : "Kept out of Hot Leads"} · {conv.hot.source === "manual" ? "set by a person" : "set by AI"}</div>}
        </div>
        {canAct && <button className="btn btn-sm" disabled={busy === "score"} onClick={rescore}>{busy === "score" ? "Scoring…" : conv.score == null ? "Score now" : "Re-score"}</button>}
      </div>
      {conv.opt_out && <OptOutNote conv={conv} canAct={canAct} onChanged={onChanged} />}
      {scores.length > 1 && (
        <details className="small score-hist"><summary className="muted">Score history</summary>
          <ul style={{ margin: "6px 0 0 18px" }}>{scores.map((s, i) => <li key={i}>{s.score} · {s.reason} <span className="muted">({fmtDateTime(s.scored_at)})</span></li>)}</ul>
        </details>
      )}


      <ChatHistory msgs={msgs} />


      {canAct && (
        <div className="thread-actions" role="group" aria-label="What to do with this lead">
          <span className="act-title">Next step</span>
          <div className="act-row">
            {conv.hot?.active
              ? <button className="act act-hot-on" onClick={() => setModal({ hot: false })}><Icon d={ICONS.flame} /><span className="act-long">Take out of Hot Leads</span><span className="act-short">Not hot</span></button>
              : <button className="act act-hot" onClick={() => setModal({ hot: true })}><Icon d={ICONS.flame} /><span className="act-long">Move to Hot Leads</span><span className="act-short">Hot lead</span></button>}
            <button className="act act-date" onClick={() => setModal("date")}><Icon d={ICONS.calendar} /><span className="act-long">Set follow-up</span><span className="act-short">Follow-up</span></button>
            <button className="act act-dnc" onClick={() => setModal("dnc")}><Icon d={ICONS.block} /><span className="act-long">Do Not Contact</span><span className="act-short">Don’t contact</span></button>
            <button className="act act-crm" onClick={() => notReady(toast, "Sending to the CRM")}><Icon d={ICONS.send} /><span className="act-long">Send to CRM</span><span className="act-short">To CRM</span></button>
            <button className="act act-archive" onClick={archive}><Icon d={ICONS.archive} /><span className="act-long">Archive</span><span className="act-short">Archive</span></button>
          </div>
        </div>
      )}

      {modal?.hot !== undefined && <HotModal conv={conv} active={modal.hot} onClose={() => setModal(null)} onDone={() => { setModal(null); onChanged(); toast(modal.hot ? "Moved to Hot Leads" : "Taken out of Hot Leads"); }} />}
      {modal === "dnc" && <DncFromConv conv={conv} onClose={() => setModal(null)} onDone={() => { setModal(null); toast("Added to Do Not Contact"); onChanged(); }} />}
      {modal === "date" && <DateModal conv={conv} onClose={() => setModal(null)} onDone={() => { setModal(null); toast("Follow-up saved"); }} />}
    </div>
  );
}

function HotModal({ conv, active, onClose, onDone }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc("set_hot_lead", { p_conversation: conv.id, p_active: active, p_note: note });
    if (error) { setError(error); setBusy(false); } else onDone();
  }
  return (
    <Modal title={active ? "Move to Hot Leads" : "Take out of Hot Leads"} sub="Your decision overrides the AI from now on, and it’s logged." onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="hot-f" disabled={busy}>{busy ? "Saving…" : "Confirm"}</button></>}>
      <form id="hot-f" className="stack" onSubmit={submit}>
        <ErrorNote error={error} />
        <Field label="Why? (optional)" id="hot-note"><input id="hot-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={active ? "e.g. Called me directly, wants to list" : "e.g. Already working with another agent"} /></Field>
      </form>
    </Modal>
  );
}

function DncFromConv({ conv, onClose, onDone }) {
  const [reason, setReason] = useState(conv.opt_out ? DNC_ADD_REASONS[0] : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    if (!reason.trim()) return setError(new Error("Pick a reason, or choose Other and write one."));
    setBusy(true);
    const { error } = await supabase.from("dnc").insert({ phone_e164: conv.contact.phone_e164, name: personName(conv.contact), email: conv.contact.email ?? null, contact_id: conv.contact_id, reason: reason.trim(), source: "inbox", is_demo: !!conv.is_sample });
    if (error) { setError(error.code === "23505" ? new Error("They’re already on Do Not Contact.") : error); setBusy(false); } else onDone();
  }
  return (
    <Modal title={`Add ${personName(conv.contact)} to Do Not Contact?`} sub="Nobody at Blue PROP will message them again, and they’re stopped in any campaign that hasn’t sent to them yet." onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-danger" form="dnc-c" disabled={busy}>{busy ? "Adding…" : "Add to Do Not Contact"}</button></>}>
      <form id="dnc-c" className="stack" onSubmit={submit}>
        <ErrorNote error={error} />
        <ReasonPicker id="dncc-reason" label="Why shouldn’t they be contacted?" reasons={DNC_ADD_REASONS} value={reason} onChange={setReason} required />
      </form>
    </Modal>
  );
}

export function DateModal({ conv, initial, onClose, onDone }) {
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const [f, setF] = useState({ type: initial?.type ?? "followup", due_on: initial?.due_on ?? tomorrow, note: initial?.note ?? "", title: initial?.title ?? "", yearly: initial?.yearly ?? false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (!conv && !initial?.contact_id && !f.title.trim()) throw new Error("Say who this is for.");
      const row = { type: f.type, due_on: f.due_on, note: f.note.trim() || null, yearly: ["birthday", "anniversary"].includes(f.type) ? true : f.yearly, title: f.title.trim() || null };
      const q = initial?.id
        ? supabase.from("key_dates").update(row).eq("id", initial.id)
        : supabase.from("key_dates").insert({ ...row, ...(conv ? { agent_id: conv.agent_id, contact_id: conv.contact_id, conversation_id: conv.id } : {}) });
      const { error } = await q;
      if (error) throw error;
      onDone();
    } catch (err) { setError(err); setBusy(false); }
  }
  return (
    <Modal title={initial?.id ? "Edit date" : conv ? `Date for ${personName(conv.contact)}` : "Add a date"} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="date-f" disabled={busy}>{busy ? "Saving…" : "Save"}</button></>}>
      <form id="date-f" className="stack" onSubmit={submit}>
        <ErrorNote error={error} />
        {!conv && !initial?.contact_id && <Field label="Who is it for?" id="d-title"><input id="d-title" className="input" value={f.title} onChange={set("title")} placeholder="e.g. Sipho Ndlovu, 7 Oak Lane" /></Field>}
        <Field label="Type" id="d-type">
          <select id="d-type" className="select" value={f.type} onChange={set("type")}>
            {Object.entries(DATE_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        <Field label="Date" id="d-date"><input id="d-date" className="input" type="date" value={f.due_on} onChange={set("due_on")} required /></Field>
        <Field label="Note" id="d-note"><input id="d-note" className="input" value={f.note} onChange={set("note")} placeholder="e.g. Call back about the Saturday valuation" /></Field>
        {["birthday", "anniversary"].includes(f.type)
          ? <p className="muted small">Repeats every year.</p>
          : <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={f.yearly} onChange={set("yearly")} /> Repeat every year</label>}
        <p className="muted small">It shows on Dates and Home when it’s due. Email reminders are switched on in a later stage.</p>
      </form>
    </Modal>
  );
}

// The AI flagged this reply as "don't contact me". Agents can keep it or undo it if the AI got it wrong.
function OptOutNote({ conv, canAct, onChanged }) {
  const toast = useToast();
  const [entry, setEntry] = useState(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.from("dnc").select("id, source, needs_review, reason").eq("phone_e164", conv.contact.phone_e164).maybeSingle().then(({ data }) => setEntry(data ?? null));
  }, [conv.contact.phone_e164]);
  async function undo() {
    setBusy(true);
    const { error } = entry
      ? await supabase.rpc("remove_dnc", { p_id: entry.id, p_reason: "The AI got it wrong: they didn’t ask to stop" })
      : await supabase.from("conversations").update({ opt_out: false }).eq("id", conv.id); // not on the list: just clear the flag
    setBusy(false);
    if (error) return toast(error.message, "bad");
    toast(`${personName(conv.contact)} can be contacted again`); onChanged();
  }
  async function keep() {
    setBusy(true);
    const { error } = await supabase.rpc("confirm_dnc", { p_id: entry.id });
    setBusy(false);
    if (error) return toast(error.message, "bad");
    toast("Kept on Do Not Contact"); setEntry({ ...entry, needs_review: false });
  }
  return (
    <div className="note note-bad small optout-note">
      <span>
        <strong>{entry ? "On Do Not Contact" : "The AI thinks they asked not to be contacted"}</strong>
        {entry?.source === "ai_opt_out" ? " · added by the AI from this reply" : ""}{conv.score_reason ? `: ${conv.score_reason}` : ""}
        {entry?.needs_review ? " Please check it." : ""}
      </span>
      {canAct && entry?.needs_review && <button className="btn btn-sm" disabled={busy} onClick={keep}>Keep</button>}
      {canAct && (entry === null || entry?.source === "ai_opt_out") && <button className="btn btn-sm" disabled={busy} onClick={undo}>Undo: they can be contacted</button>}
    </div>
  );
}
