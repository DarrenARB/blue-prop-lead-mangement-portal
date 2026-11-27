import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { fmtDate, fmtPhone } from "../lib/format";
import { Badge, CopyButton, ErrorNote, Icon, ICONS, Modal, Spinner, useToast } from "../components/ui";
import { DateModal, personName } from "./Inbox";
import AgentFilter, { useAgentFilter } from "../components/AgentFilter";
import { DATE_TYPES, DatesViewSwitch, SuggestModal, todayIso, typeLabel, useDateActions, useKeyDates } from "./Dates";

// Calendar of follow-ups and key dates, like Google Calendar: Month, Week and Day views.
// Click a day to see everything on it; click an item for its details and actions.
// All dates are whole-day items (they have no time), so weeks and days list them rather than placing them on hours.

const VIEWS = [["day", "Day"], ["week", "Week"], ["month", "Month"]];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Plain YYYY-MM-DD arithmetic, done in UTC so time zones and daylight saving can't shift a day.
const parse = (s) => new Date(`${s}T00:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const addMonths = (s, n) => { const d = parse(s); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); return fmt(d); };
const startOfWeek = (s) => { const d = parse(s); return addDays(s, -((d.getUTCDay() + 6) % 7)); }; // Monday
const label = (s, opts) => parse(s).toLocaleDateString("en-ZA", { timeZone: "UTC", ...opts });

// Every time each date falls inside [from, to]. Yearly ones (birthdays, anniversaries) repeat each year.
function occurrences(rows, from, to) {
  const out = [];
  for (const r of rows) {
    const base = r.snoozed_until && r.snoozed_until > r.due_on ? r.snoozed_until : r.due_on;
    if (r.yearly) {
      const md = base.slice(5);
      for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
        const day = `${y}-${md}`;
        if (day >= base && day >= from && day <= to) out.push({ ...r, when: day });
      }
    } else if (base >= from && base <= to) out.push({ ...r, when: base });
  }
  return out.sort((a, b) => a.when.localeCompare(b.when) || (a.done_at ? 1 : 0) - (b.done_at ? 1 : 0));
}
const stateOf = (d, today) => (d.done_at && !d.yearly ? "done" : d.when < today ? "late" : d.when === today ? "today" : "soon");

export default function Calendar({ onSwitch }) {
  const { profile, isAdmin } = useAuth();
  const toast = useToast();
  const { rows, error, load } = useKeyDates();
  const actions = useDateActions(load);
  const [agentF, setAgentF] = useAgentFilter();
  const today = todayIso();
  const [view, setView] = useState(() => { try { return localStorage.getItem("bp:cal-view") || "month"; } catch { return "month"; } });
  const [cursor, setCursor] = useState(today); // the day the view is built around
  const [picked, setPicked] = useState(today); // selected day in month view
  const [item, setItem] = useState(null);      // open item
  const [modal, setModal] = useState(null);    // add / edit
  const [suggest, setSuggest] = useState(null);
  const readOnly = profile.role === "owner";
  const mayAct = (d) => !readOnly && (isAdmin || d.agent_id === profile.id);
  useEffect(() => { try { localStorage.setItem("bp:cal-view", view); } catch { /* private mode */ } }, [view]);

  // visible range for the current view
  const range = useMemo(() => {
    if (view === "day") return [cursor, cursor];
    if (view === "week") { const s = startOfWeek(cursor); return [s, addDays(s, 6)]; }
    const first = `${cursor.slice(0, 7)}-01`;
    const s = startOfWeek(first);
    return [s, addDays(s, 41)]; // 6 weeks always, so the grid never jumps
  }, [view, cursor]);
  const items = useMemo(() => occurrences((rows ?? []).filter((r) => !agentF || r.agent_id === agentF), range[0], range[1]), [rows, agentF, range]);
  // South African public holidays in view (campaigns skip them unless switched off)
  const [hols, setHols] = useState({});
  useEffect(() => {
    supabase.rpc("sa_public_holidays", { p_from: range[0], p_to: range[1] })
      .then(({ data }) => setHols(Object.fromEntries((data ?? []).map((h) => [h.day, h.name]))));
  }, [range]);
  const byDay = useMemo(() => { const m = {}; for (const d of items) (m[d.when] ??= []).push(d); return m; }, [items]);

  const step = (n) => setCursor(view === "day" ? addDays(cursor, n) : view === "week" ? addDays(cursor, 7 * n) : addMonths(cursor, n));
  const title = view === "day" ? label(cursor, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : view === "week" ? `${label(range[0], { day: "numeric", month: "short" })} – ${label(range[1], { day: "numeric", month: "short", year: "numeric" })}`
    : label(cursor, { month: "long", year: "numeric" });
  const openDay = (day) => { setCursor(day); setPicked(day); setView("day"); };

  // keyboard: arrows move, t = today (not while typing)
  useEffect(() => {
    const onKey = (e) => {
      if (item || modal || suggest || /input|select|textarea/i.test(e.target.tagName)) return;
      if (e.key === "ArrowLeft") step(-1); else if (e.key === "ArrowRight") step(1); else if (e.key === "t") { setCursor(today); setPicked(today); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const Chip = ({ d }) => (
    <button type="button" className={`cal-chip tn-${DATE_TYPES[d.type]?.tone ?? "muted"} s-${stateOf(d, today)}`} onClick={(e) => { e.stopPropagation(); setItem(d); }}
      title={`${d.contact ? personName(d.contact) : d.title || ""} · ${typeLabel(d)}`}>
      <span className="cal-chip-name">{d.contact ? personName(d.contact) : d.title || "—"}</span>
      <span className="cal-chip-type">{typeLabel(d)}</span>
    </button>
  );

  const DayList = ({ day, big }) => {
    const list = byDay[day] ?? [];
    return (
      <div className={big ? "cal-daylist big" : "cal-daylist"}>
        {hols[day] && <p className="cal-hol-note small">Public holiday: {hols[day]}. Campaigns don’t send today unless they’re set to.</p>}
        {list.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Nothing on this day.</p> : list.map((d) => {
          const st = stateOf(d, today);
          return (
            <button key={`${d.id}-${d.when}`} type="button" className={`cal-row s-${st}`} onClick={() => setItem(d)}>
              <span className={`cal-dot tn-${DATE_TYPES[d.type]?.tone ?? "muted"}`} aria-hidden="true" />
              <span className="cal-row-main">
                <span className="cell-title">{d.contact ? personName(d.contact) : d.title || "—"}</span>{" "}
                <Badge tone={DATE_TYPES[d.type]?.tone}>{typeLabel(d)}</Badge>
                {st === "done" && <Badge tone="muted">Done</Badge>}
                {st === "late" && <Badge tone="bad">Overdue</Badge>}
                {(d.note || profile.role !== "agent") && <span className="cell-sub" style={{ display: "block" }}>{[d.note, profile.role !== "agent" ? d.agent : null].filter(Boolean).join(" · ")}</span>}
              </span>
              <span className="cal-row-go" aria-hidden="true">›</span>
            </button>
          );
        })}
        {!readOnly && <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setModal({ due_on: day })}><Icon d={ICONS.plus} />Add a date on {label(day, { day: "numeric", month: "short" })}</button>}
      </div>
    );
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{readOnly ? "Your agents" : isAdmin ? "All agents" : "Your contacts"}</p>
          <h1>Dates &amp; follow-ups</h1>
          <p className="muted">Follow-ups, birthdays, home anniversaries and leases ending, by day, week or month. Click a day to see everything on it.</p>
        </div>
        {!readOnly && <button className="btn btn-primary" onClick={() => setModal({ due_on: view === "month" ? picked : cursor })}><Icon d={ICONS.plus} />Add a date</button>}
      </div>
      <div className="list-tools"><DatesViewSwitch current="calendar" onChange={onSwitch} /><AgentFilter value={agentF} onChange={setAgentF} /></div>

      <div className="cal-bar">
        <button className="btn btn-sm" onClick={() => { setCursor(today); setPicked(today); }}>Today</button>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn btn-sm cal-nav" onClick={() => step(-1)} aria-label={`Previous ${view}`}>‹</button>
          <button className="btn btn-sm cal-nav" onClick={() => step(1)} aria-label={`Next ${view}`}>›</button>
        </div>
        <h2 className="cal-title" aria-live="polite">{title}</h2>
        <span style={{ flex: 1 }} />
        <div className="vseg" role="group" aria-label="Calendar view">
          {VIEWS.map(([k, l]) => <button key={k} type="button" className={`vseg-btn ${view === k ? "on" : ""}`} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}
        </div>
      </div>

      <ErrorNote error={error} />
      {!rows && !error ? <Spinner /> : view === "month" ? (
        <div className="cal-month-wrap">
          <div className="cal-month" role="grid" aria-label={title}>
            {WEEKDAYS.map((w) => <div key={w} className="cal-wd" role="columnheader">{w}</div>)}
            {Array.from({ length: 42 }, (_, i) => addDays(range[0], i)).map((day) => {
              const list = byDay[day] ?? [];
              const other = day.slice(0, 7) !== cursor.slice(0, 7);
              const late = list.some((d) => stateOf(d, today) === "late");
              return (
                <div key={day} role="gridcell" tabIndex={0} aria-selected={picked === day}
                  aria-label={`${label(day, { weekday: "long", day: "numeric", month: "long" })}: ${list.length ? `${list.length} item${list.length > 1 ? "s" : ""}` : "nothing"}`}
                  className={`cal-cell ${hols[day] ? "hol" : ""} ${other ? "other" : ""} ${day === today ? "today" : ""} ${picked === day ? "is-picked" : ""}`}
                  onClick={() => setPicked(day)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPicked(day); } }}>
                  <div className="cal-cell-top">
                    <button type="button" className="cal-num" onClick={(e) => { e.stopPropagation(); openDay(day); }} aria-label={`Open ${label(day, { day: "numeric", month: "long" })} in day view`}>{Number(day.slice(8))}</button>
                    {hols[day] && <span className="cal-hol" title={`Public holiday: ${hols[day]}`}>{hols[day]}</span>}
                  </div>
                  <div className="cal-chips">
                    {list.slice(0, 3).map((d) => <Chip key={`${d.id}-${d.when}`} d={d} />)}
                    {list.length > 3 && <span className="cal-more">+{list.length - 3} more</span>}
                  </div>
                  {list.length > 0 && <span className={`cal-dots ${late ? "late" : ""}`} aria-hidden="true">{list.length}</span>}
                </div>
              );
            })}
          </div>
          <aside className="card cal-side" aria-label="Selected day">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>{picked === today ? "Today" : label(picked, { weekday: "long" })}<span className="muted small" style={{ fontWeight: 400 }}> · {label(picked, { day: "numeric", month: "long", year: "numeric" })}</span></h3>
              <button className="btn btn-sm btn-link" onClick={() => openDay(picked)}>Day view</button>
            </div>
            <DayList day={picked} />
          </aside>
        </div>
      ) : view === "week" ? (
        <div className="cal-week">
          {Array.from({ length: 7 }, (_, i) => addDays(range[0], i)).map((day) => (
            <section key={day} className={`cal-wcol ${day === today ? "today" : ""}`}>
              <button type="button" className="cal-whead" onClick={() => openDay(day)} aria-label={`Open ${label(day, { weekday: "long", day: "numeric", month: "long" })}`}>
                <span className="small">{label(day, { weekday: "short" })}</span>
                <span className="cal-wnum">{Number(day.slice(8))}</span>
                {hols[day] && <span className="cal-hol">{hols[day]}</span>}
              </button>
              <div className="cal-wbody">
                {(byDay[day] ?? []).map((d) => <Chip key={`${d.id}-${d.when}`} d={d} />)}
                {!(byDay[day] ?? []).length && <span className="muted small cal-wempty">—</span>}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <section className="card"><DayList day={cursor} big /></section>
      )}

      {item && <ItemModal d={item} today={today} canAct={mayAct(item)} showAgent={profile.role !== "agent"}
        onClose={() => setItem(null)}
        onDone={async () => { await actions.done(item); setItem(null); }}
        onUndo={async () => { await actions.undo(item); setItem(null); }}
        onSnooze={async (n) => { await actions.snooze(item, n); setItem(null); }}
        onDelete={async () => { if (await actions.remove(item)) setItem(null); }}
        onEdit={() => { setModal(item); setItem(null); }}
        onSuggest={() => { setSuggest(item); setItem(null); }} />}
      {modal && <DateModal initial={modal} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); toast("Date saved"); }} />}
      {suggest && <SuggestModal d={suggest} onClose={() => setSuggest(null)} />}
    </>
  );
}

// Everything about one date, with what you can do about it.
function ItemModal({ d, today, canAct, showAgent, onClose, onDone, onUndo, onSnooze, onDelete, onEdit, onSuggest }) {
  const st = stateOf(d, today);
  const who = d.contact ? personName(d.contact) : d.title || "—";
  const late = st === "late" ? Math.round((parse(today) - parse(d.when)) / 864e5) : 0;
  return (
    <Modal title={who} sub={<><Badge tone={DATE_TYPES[d.type]?.tone}>{typeLabel(d)}</Badge>{" "}{st === "done" ? <Badge tone="muted">Done</Badge> : st === "late" ? <Badge tone="bad">{late === 1 ? "1 day overdue" : `${late} days overdue`}</Badge> : st === "today" ? <Badge tone="brand">Today</Badge> : null}</>} onClose={onClose}
      footer={canAct ? (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", width: "100%" }}>
          <button className="btn btn-sm btn-link" onClick={onDelete}>Delete</button>
          <button className="btn btn-sm btn-link" onClick={onEdit}>Edit</button>
          <span style={{ flex: 1 }} />
          {st !== "done" && <button className="btn btn-sm" onClick={onSuggest}>Suggest message</button>}
          {st !== "done" && (
            <select className="select btn-sm" aria-label="Snooze" value="" onChange={(e) => e.target.value && onSnooze(Number(e.target.value))} style={{ width: "auto" }}>
              <option value="">Snooze…</option><option value="1">1 day</option><option value="3">3 days</option><option value="7">1 week</option>
            </select>
          )}
          {st === "done" ? <button className="btn btn-sm" onClick={onUndo}>Not done</button> : <button className="btn btn-sm btn-primary" onClick={onDone}>Done</button>}
        </div>
      ) : <button className="btn" onClick={onClose}>Close</button>}>
      <dl className="cal-detail">
        <dt>Date</dt><dd>{fmtDate(d.when)}{d.yearly ? " · every year" : ""}{d.snoozed_until && d.snoozed_until > d.due_on ? ` (snoozed from ${fmtDate(d.due_on)})` : ""}</dd>
        {d.note && <><dt>Note</dt><dd>{d.note}</dd></>}
        {d.contact?.phone_e164 && <><dt>Phone</dt><dd className="row" style={{ gap: 8 }}><span className="mono">{fmtPhone(d.contact.phone_e164)}</span><CopyButton text={d.contact.phone_e164} label="Copy" /></dd></>}
        {d.contact?.suburb && <><dt>Suburb</dt><dd>{d.contact.suburb}</dd></>}
        {showAgent && <><dt>Agent</dt><dd>{d.agent}</dd></>}
        {d.done_at && !d.yearly && <><dt>Done</dt><dd>{fmtDate(d.done_at)}</dd></>}
      </dl>
      {d.conversation_id && <Link to={`/inbox?open=${d.conversation_id}`} className="btn btn-sm" onClick={onClose} style={{ marginTop: 12 }}><Icon d={ICONS.inbox} />Open the conversation</Link>}
    </Modal>
  );
}
