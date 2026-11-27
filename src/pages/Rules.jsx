import { useCallback, useEffect, useState } from "react";
import { must, supabase } from "../lib/supabase";
import { Badge, ErrorNote, Field, Icon, ICONS, Modal, Spinner, useToast } from "../components/ui";
import { fmtDate } from "../lib/format";
import { useAuth } from "../lib/auth";

const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]];

export default function Rules() {
  const toast = useToast();
  const { isSuperAdmin } = useAuth();
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("settings").select("hot_threshold, shotgun_months, window_days, window_start, window_end, timezone, email_enabled, skip_public_holidays").eq("id", 1).single().then(must).then(setF).catch(setError);
  }, []);

  async function save(e) {
    e.preventDefault();
    if (f.window_start >= f.window_end) return toast("The sending window must end after it starts.", "bad");
    if (!f.window_days.length) return toast("Pick at least one sending day.", "bad");
    const hot = Number(f.hot_threshold);
    if (!Number.isInteger(hot) || hot < 1 || hot > 100) return toast("The hot lead score must be a whole number from 1 to 100.", "bad");
    setBusy(true);
    const { error } = await supabase.from("settings").update({
      hot_threshold: Number(f.hot_threshold), shotgun_months: Number(f.shotgun_months),
      window_days: f.window_days, window_start: f.window_start, window_end: f.window_end,
      skip_public_holidays: !!f.skip_public_holidays,
    }).eq("id", 1);
    setBusy(false);
    if (error) return toast(error.message, "bad");
    toast("Rules saved");
  }

  if (error) return <ErrorNote error={error} />;
  if (!f) return <Spinner />;
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Main Admin</p>
          <h1>Rules</h1>
          <p className="muted">Company-wide settings every campaign follows.</p>
        </div>
      </div>
      <form className="stack" onSubmit={save}>
        <section className="card stack">
          <h2>Shotgun list</h2>
          <Field label="Hold a contact for the first agent for" id="r-shot" hint="If another agent uploads someone within this time, they’re held for the first agent and go on the Shotgun list.">
            <select id="r-shot" className="select" style={{ maxWidth: 200 }} value={f.shotgun_months} onChange={(e) => setF({ ...f, shotgun_months: e.target.value })}>
              {[1, 2, 3, 4, 6, 9, 12].map((m) => <option key={m} value={m}>{m} month{m > 1 ? "s" : ""}</option>)}
            </select>
          </Field>
        </section>
        <section className="card stack">
          <h2>Hot leads</h2>
          <Field label="A reply is a hot lead from a score of" id="r-hot" hint="The AI scores every reply from 0 to 100. Lower this to see more hot leads, raise it to see fewer. 70 is a good starting point.">
            <div className="row" style={{ gap: 8 }}>
              <input id="r-hot" className="input" type="number" inputMode="numeric" min={1} max={100} step={1} value={f.hot_threshold}
                onChange={(e) => setF({ ...f, hot_threshold: e.target.value })} style={{ width: 110 }} />
              <span className="muted">out of 100</span>
            </div>
          </Field>
        </section>
        <section className="card stack">
          <h2>Default sending window</h2>
          <p className="muted small">New campaigns start with these; agents can narrow them per campaign. Times are {f.timezone.replace("_", " ")}.</p>
          <div className="row" role="group" aria-label="Sending days" style={{ gap: 6 }}>
            {DAYS.map(([n, l]) => (
              <button type="button" key={n} className={`chip ${f.window_days.includes(n) ? "chip-on" : ""}`} aria-pressed={f.window_days.includes(n)}
                onClick={() => setF({ ...f, window_days: f.window_days.includes(n) ? f.window_days.filter((x) => x !== n) : [...f.window_days, n].sort() })}>{l}</button>
            ))}
          </div>
          <div className="grid g3">
            <Field label="From" id="r-start"><input id="r-start" className="input" type="time" value={f.window_start} onChange={(e) => setF({ ...f, window_start: e.target.value })} /></Field>
            <Field label="Until" id="r-end"><input id="r-end" className="input" type="time" value={f.window_end} onChange={(e) => setF({ ...f, window_end: e.target.value })} /></Field>
          </div>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={!!f.skip_public_holidays} onChange={(e) => setF({ ...f, skip_public_holidays: e.target.checked })} />
            Don’t send on South African public holidays
          </label>
          <p className="muted small" style={{ margin: 0 }}>New campaigns start with this; an agent can switch it off for a campaign. The holiday list is below.</p>
        </section>
        <div><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save rules"}</button></div>
      </form>
      <Holidays />
      {isSuperAdmin && <EmailSwitch on={f.email_enabled} onChange={(v) => setF({ ...f, email_enabled: v })} />}
    </>
  );
}

// Super Admins only: switches "Forgot password" from "tell the admin" to "email me a reset link".
function EmailSwitch({ on, onChange }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function flip() {
    if (!on && !window.confirm("Only switch this on once email sending is set up in Supabase (custom SMTP and the portal’s web address added to the allowed redirect URLs). Switch on reset emails now?")) return;
    setBusy(true);
    const { error } = await supabase.from("settings").update({ email_enabled: !on }).eq("id", 1);
    setBusy(false);
    if (error) return toast(error.message, "bad");
    onChange(!on);
    toast(!on ? "Reset emails switched on" : "Reset emails switched off: requests go to admins");
  }
  return (
    <section className="card stack" style={{ marginTop: 16 }}>
      <div className="row spread">
        <h2>Password reset emails <span className="badge b-muted" style={{ marginLeft: 6 }}>Super Admin</span></h2>
      </div>
      <p className="muted small">
        {on
          ? "On: “Forgot your password?” emails the person a link to choose a new password."
          : "Off: “Forgot your password?” tells the admins, who reset it on People and share a temporary password. Switch on once email sending is set up."}
      </p>
      <label className="row small" style={{ gap: 8 }}>
        <input type="checkbox" checked={!!on} onChange={flip} disabled={busy} />
        Send password reset emails
      </label>
    </section>
  );
}

// South African public holidays for the next 12 months. Regular ones are worked out automatically
// (fixed dates, Easter, and the Sunday rule); admins add one-off days the government declares, or switch one off.
function Holidays() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [skipped, setSkipped] = useState([]);
  const [adding, setAdding] = useState(false);
  const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  const until = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  const load = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([
        supabase.rpc("sa_public_holidays", { p_from: today, p_to: until }).then(must),
        supabase.from("holiday_overrides").select("day, name").eq("kind", "skip").gte("day", today).order("day").then(must),
      ]);
      setRows(h ?? []); setSkipped(s ?? []);
    } catch (e) { toast(e.message, "bad"); setRows([]); }
  }, [today, until, toast]);
  useEffect(() => { load(); }, [load]);

  async function switchOff(h) {
    const { error } = h.kind === "extra"
      ? await supabase.from("holiday_overrides").delete().eq("day", h.day)
      : await supabase.from("holiday_overrides").insert({ day: h.day, name: h.name, kind: "skip" });
    if (error) return toast(error.message, "bad");
    toast(h.kind === "extra" ? "Removed" : `${h.name} won’t be skipped`); load();
  }
  async function switchOn(s) {
    const { error } = await supabase.from("holiday_overrides").delete().eq("day", s.day);
    if (error) return toast(error.message, "bad");
    load();
  }
  const dow = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-ZA", { weekday: "short", timeZone: "UTC" });
  return (
    <section className="card stack" style={{ marginTop: 16 }}>
      <div className="row spread">
        <h2>Public holidays</h2>
        <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}><Icon d={ICONS.plus} />Add a one-off holiday</button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>The next 12 months. Regular holidays are worked out automatically, including Easter and the Sunday rule (a holiday on a Sunday makes the Monday a day off). If the government declares an extra day, such as an election day, add it here.</p>
      {!rows ? <Spinner /> : (
        <ul className="hol-list">
          {rows.map((h) => (
            <li key={h.day}>
              <span className="hol-date">{dow(h.day)} {fmtDate(h.day)}</span>
              <span className="hol-name">{h.name} {h.kind === "extra" && <Badge tone="brand">Added</Badge>}</span>
              <button type="button" className="btn btn-sm btn-link" onClick={() => switchOff(h)}>{h.kind === "extra" ? "Remove" : "Don’t skip"}</button>
            </li>
          ))}
          {skipped.map((s) => (
            <li key={s.day} className="dim">
              <span className="hol-date">{dow(s.day)} {fmtDate(s.day)}</span>
              <span className="hol-name">{s.name} <Badge tone="muted">Sending as normal</Badge></span>
              <button type="button" className="btn btn-sm btn-link" onClick={() => switchOn(s)}>Skip again</button>
            </li>
          ))}
        </ul>
      )}
      {adding && <AddHoliday onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); toast("Holiday added"); }} />}
    </section>
  );
}

function AddHoliday({ onClose, onDone }) {
  const [f, setF] = useState({ day: "", name: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.from("holiday_overrides").upsert({ day: f.day, name: f.name.trim(), kind: "extra" });
    if (error) { setError(error); setBusy(false); } else onDone();
  }
  return (
    <Modal title="Add a one-off holiday" sub="For days the government declares, like an election day. Campaigns that skip public holidays won’t send that day." onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="hol-f" disabled={busy || !f.day || !f.name.trim()}>{busy ? "Saving…" : "Add"}</button></>}>
      <form id="hol-f" className="stack" onSubmit={submit}>
        <ErrorNote error={error} />
        <Field label="Date" id="hol-day"><input id="hol-day" className="input" type="date" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} required autoFocus /></Field>
        <Field label="Name" id="hol-name"><input id="hol-name" className="input" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Election day" required /></Field>
      </form>
    </Modal>
  );
}
