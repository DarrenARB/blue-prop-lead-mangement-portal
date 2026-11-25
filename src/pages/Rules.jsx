import { useEffect, useState } from "react";
import { must, supabase } from "../lib/supabase";
import { ErrorNote, Field, Spinner, useToast } from "../components/ui";
import { useAuth } from "../lib/auth";

const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]];

export default function Rules() {
  const toast = useToast();
  const { isSuperAdmin } = useAuth();
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("settings").select("hot_threshold, shotgun_months, window_days, window_start, window_end, timezone, email_enabled").eq("id", 1).single().then(must).then(setF).catch(setError);
  }, []);

  async function save(e) {
    e.preventDefault();
    if (f.window_start >= f.window_end) return toast("The sending window must end after it starts.", "bad");
    if (!f.window_days.length) return toast("Pick at least one sending day.", "bad");
    setBusy(true);
    const { error } = await supabase.from("settings").update({
      hot_threshold: Number(f.hot_threshold), shotgun_months: Number(f.shotgun_months),
      window_days: f.window_days, window_start: f.window_start, window_end: f.window_end,
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
          <Field label={`A reply is a hot lead from a score of ${f.hot_threshold}`} id="r-hot" hint="The AI scores every reply from 0 to 100. Lower this to see more hot leads, raise it to see fewer.">
            <input id="r-hot" type="range" min={40} max={95} step={5} value={f.hot_threshold} onChange={(e) => setF({ ...f, hot_threshold: e.target.value })} style={{ maxWidth: 360 }} />
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
        </section>
        <div><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save rules"}</button></div>
      </form>
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
