import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { callFn, must, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { NUMBER_STATUS, fmtDateTime } from "../lib/format";
import { downloadCsv, guessField, parseCsv, readFile } from "../lib/csv";
import { Badge, ErrorNote, Field, Spinner, useToast } from "../components/ui";
import { CAMPAIGN_STATUS, GOALS } from "./Campaigns";

const STEPS = ["Basics", "Leads", "Messages", "Schedule", "Review"];
const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]];
const TONES = [["friendly", "Friendly"], ["professional", "Professional"], ["casual", "Casual"]];
const LIMITS = { 1: 320, 2: 260, 3: 260 };
const PLACEHOLDERS = [["{{firstName}}", "First name"], ["{{suburb}}", "Suburb"]];
const REJECT_LABEL = {
  invalid_number: "Not a valid mobile number", duplicate: "Repeated in the file", dnc: "On Do Not Contact",
  shotgun: "Another agent messaged them recently (Shotgun list)", already_in_campaign: "Already in this campaign",
};
const FIELD_OPTIONS = [["", "Don’t use"], ["phone", "Mobile number"], ["first_name", "First name"], ["last_name", "Surname"], ["full_name", "Full name"], ["suburb", "Suburb"], ["email", "Email"]];

export default function CampaignWizard() {
  const { id } = useParams();
  const { profile, isAdmin } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [c, setC] = useState(null);
  const [msgs, setMsgs] = useState(null);
  const [ctx, setCtx] = useState(null); // agent, number, settings, leads count, sample, last upload
  const [error, setError] = useState(null);
  const [step, setStep] = useState(1);
  const started = useRef(false);

  const load = useCallback(async () => {
    try {
      const camp = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle().then(must);
      if (!camp) throw new Error("That campaign doesn’t exist or you can’t see it.");
      const [m, settings, agent, nums, leadCount, sample, upload] = await Promise.all([
        supabase.from("campaign_messages").select("*").eq("campaign_id", id).order("position").then(must),
        supabase.from("settings").select("window_days, window_start, window_end, timezone").eq("id", 1).single().then(must),
        supabase.from("profiles").select("id, full_name").eq("id", camp.agent_id).maybeSingle().then(must),
        supabase.rpc("list_whatsapp_numbers").then(must),
        supabase.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", id).then((r) => { if (r.error) throw r.error; return r.count ?? 0; }),
        supabase.from("leads").select("contact:contacts(first_name, suburb)").eq("campaign_id", id).limit(1).then(must),
        supabase.from("uploads").select("*").eq("campaign_id", id).order("created_at", { ascending: false }).limit(1).then(must),
      ]);
      const byPos = Object.fromEntries((m ?? []).map((x) => [x.position, x]));
      setMsgs([1, 2, 3].map((p) => ({ position: p, body: byPos[p]?.body ?? "", delay_days: byPos[p]?.delay_days ?? (p === 1 ? 0 : p === 2 ? 2 : 4) })));
      setCtx({
        settings, agent,
        number: (nums ?? []).find((n) => n.agent_id === camp.agent_id && n.status !== "removed") ?? null,
        leads: leadCount, sample: sample?.[0]?.contact ?? null, upload: upload?.[0] ?? null,
      });
      setC(camp);
      if (!started.current) { started.current = true; setStep(Math.min(5, Math.max(1, camp.wizard_step))); }
    } catch (e) { setError(e); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorNote error={error} />;
  if (!c || !msgs || !ctx) return <Spinner />;

  const editable = c.status === "draft" && (isAdmin || c.agent_id === profile.id);

  async function saveCampaign(fields, quiet) {
    if (!editable) return true;
    const { error } = await supabase.from("campaigns").update(fields).eq("id", c.id);
    if (error) { toast(error.message, "bad"); return false; }
    setC((x) => ({ ...x, ...fields }));
    if (!quiet) toast("Saved");
    return true;
  }
  async function saveMessages(list = msgs) {
    if (!editable) return true;
    const { error } = await supabase.from("campaign_messages").upsert(list.map((m) => ({ campaign_id: c.id, position: m.position, body: m.body, delay_days: Number(m.delay_days) || 0 })), { onConflict: "campaign_id,position" });
    if (error) { toast(error.message, "bad"); return false; }
    return true;
  }
  async function go(n) {
    if (step === 3 && !(await saveMessages())) return;
    setStep(n);
    if (editable && n > c.wizard_step) saveCampaign({ wizard_step: n }, true);
    window.scrollTo?.(0, 0);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow"><Link to="/campaigns">Campaigns</Link> / {ctx.agent?.full_name ?? "Agent"}</p>
          <h1>{c.name} <Badge tone={CAMPAIGN_STATUS[c.status]?.[1]}>{CAMPAIGN_STATUS[c.status]?.[0]}</Badge></h1>
          {!editable && <p className="muted">{c.status === "draft" ? "You can view this draft but only its agent or an admin can change it." : "This campaign has launched, so it can’t be edited here."}</p>}
        </div>
      </div>

      <ol className="wiz-steps" aria-label="Campaign steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button className={`wiz-step ${step === i + 1 ? "active" : ""} ${i + 1 < step || i + 1 <= c.wizard_step ? "done" : ""}`} onClick={() => go(i + 1)} aria-current={step === i + 1 ? "step" : undefined}>
              <span className="wiz-n">{i + 1}</span>{s}
            </button>
          </li>
        ))}
      </ol>

      {step === 1 && <StepBasics c={c} editable={editable} save={saveCampaign} next={() => go(2)} />}
      {step === 2 && <StepLeads c={c} ctx={ctx} editable={editable} reload={load} next={() => go(3)} back={() => go(1)} />}
      {step === 3 && <StepMessages c={c} ctx={ctx} msgs={msgs} setMsgs={setMsgs} editable={editable} saveMessages={saveMessages} next={() => go(4)} back={() => go(2)} />}
      {step === 4 && <StepSchedule c={c} ctx={ctx} msgs={msgs} editable={editable} save={saveCampaign} next={() => go(5)} back={() => go(3)} />}
      {step === 5 && <StepReview c={c} ctx={ctx} msgs={msgs} editable={editable} go={go}
        onDelete={async () => {
          if (!window.confirm(`Delete the draft “${c.name}” and its leads? This can’t be undone.`)) return;
          const { error } = await supabase.from("campaigns").delete().eq("id", c.id);
          if (error) return toast(error.message, "bad");
          toast("Draft deleted"); nav("/campaigns");
        }} />}
    </>
  );
}

function Nav({ back, next, nextLabel = "Next", disabled, children }) {
  return (
    <div className="row wiz-nav">
      {back && <button className="btn" onClick={back}>Back</button>}
      <span style={{ flex: 1 }}>{children}</span>
      {next && <button className="btn btn-primary" onClick={next} disabled={disabled}>{nextLabel}</button>}
    </div>
  );
}

// ---------- 1. Basics ----------
function StepBasics({ c, editable, save, next }) {
  const [f, setF] = useState({ name: c.name, goal: c.goal ?? "valuation", audience: c.brief?.audience ?? "", offer: c.brief?.offer ?? "", tone: c.brief?.tone ?? "friendly" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function saveAndNext() {
    if (!f.name.trim()) return;
    const ok = await save({ name: f.name.trim(), goal: f.goal, brief: { ...c.brief, goal: f.goal, audience: f.audience.trim(), offer: f.offer.trim(), tone: f.tone } }, true);
    if (ok) next();
  }
  return (
    <section className="card stack">
      <h2>What is this campaign?</h2>
      <p className="muted small">The AI uses these answers to draft your messages in step 3. A sentence or two each is plenty.</p>
      <fieldset disabled={!editable} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <Field label="Campaign name" id="cb-name"><input id="cb-name" className="input" value={f.name} onChange={set("name")} /></Field>
        <Field label="Goal" id="cb-goal">
          <select id="cb-goal" className="select" value={f.goal} onChange={set("goal")}>
            {GOALS.map(([k, l, d]) => <option key={k} value={k}>{l} – {d}</option>)}
          </select>
        </Field>
        <Field label="Who are you messaging?" id="cb-aud" hint="e.g. Homeowners in Durbanville who bought 5+ years ago">
          <textarea id="cb-aud" className="textarea" rows={2} value={f.audience} onChange={set("audience")} />
        </Field>
        <Field label="What are you offering?" id="cb-offer" hint="e.g. A free valuation and a chat about what similar homes sold for this year">
          <textarea id="cb-offer" className="textarea" rows={2} value={f.offer} onChange={set("offer")} />
        </Field>
        <div className="field">
          <span id="cb-tone" style={{ fontWeight: 500 }}>Tone</span>
          <div className="seg" role="radiogroup" aria-labelledby="cb-tone">
            {TONES.map(([k, l]) => <button type="button" key={k} role="radio" aria-checked={f.tone === k} className={f.tone === k ? "active" : ""} onClick={() => setF({ ...f, tone: k })}>{l}</button>)}
          </div>
        </div>
      </fieldset>
      <Nav next={editable ? saveAndNext : next} nextLabel={editable ? "Save and continue" : "Next"} disabled={!f.name.trim()} />
    </section>
  );
}

// ---------- 2. Leads ----------
function StepLeads({ c, ctx, editable, reload, next, back }) {
  const toast = useToast();
  const [file, setFile] = useState(null); // {name, headers, rows}
  const [map, setMap] = useState([]);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  async function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(null); setResult(null);
    try {
      if (!/\.(csv|txt)$/i.test(f.name)) throw new Error("Save the spreadsheet as CSV first (in Excel: File → Save As → CSV UTF-8).");
      const parsed = parseCsv(await readFile(f));
      if (!parsed.rows.length) throw new Error("That file has a header row but no leads.");
      if (parsed.rows.length > 5000) throw new Error(`That file has ${parsed.rows.length.toLocaleString("en-ZA")} rows. Upload up to 5,000 at a time.`);
      const guessed = parsed.headers.map(guessField);
      // only one column per field
      const used = new Set();
      setMap(guessed.map((g) => (g && !used.has(g) ? (used.add(g), g) : "")));
      setFile({ name: f.name, ...parsed });
    } catch (err) { setError(err); setFile(null); }
  }

  const hasPhone = map.includes("phone");
  function buildRows() {
    return file.rows.map((r, i) => {
      const o = { row_no: i + 2 };
      map.forEach((field, col) => {
        const v = (r[col] ?? "").trim();
        if (!field || !v) return;
        if (field === "full_name") {
          const [first, ...rest] = v.split(/\s+/);
          o.first_name = o.first_name ?? first; o.last_name = o.last_name ?? (rest.join(" ") || undefined);
        } else o[field] = v;
      });
      return o;
    });
  }
  async function upload() {
    setBusy(true); setError(null);
    try {
      const out = await callFn("campaigns", { action: "process_upload", campaign_id: c.id, filename: file.name, rows: buildRows(), replace });
      setResult(out); setFile(null); setReplace(false);
      toast(`${out.added.toLocaleString("en-ZA")} lead${out.added === 1 ? "" : "s"} added`);
      reload();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  async function downloadRejections(uploadId) {
    const rows = await supabase.from("upload_rejections").select("row_no, phone_raw, name, reason, detail").eq("upload_id", uploadId).order("row_no").then(must);
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    downloadCsv("leads-left-out.csv", ["Row,Number,Name,Why it was left out,Detail", ...(rows ?? []).map((r) => [r.row_no, r.phone_raw, r.name, REJECT_LABEL[r.reason] ?? r.reason, r.detail].map(esc).join(","))].join("\r\n"));
  }
  const last = result ? { added: result.added, total: result.total, rejected: result.rejected, id: result.upload_id } : ctx.upload ? { added: ctx.upload.added, total: ctx.upload.total_rows, rejected: ctx.upload.rejected, id: ctx.upload.id, at: ctx.upload.created_at, name: ctx.upload.filename } : null;
  const leftOut = last ? Object.values(last.rejected ?? {}).reduce((a, b) => a + b, 0) : 0;

  return (
    <section className="card stack">
      <div className="card-head">
        <div>
          <h2>Who gets the messages?</h2>
          <p className="muted small">Upload a CSV with at least a mobile number per row; a first name makes the messages personal. An email column is optional but helps catch people on Do Not Contact who changed their number. Numbers like 082 555 0141, 27825550141 or +27 82 555 0141 all work.</p>
        </div>
        <button className="btn btn-sm" onClick={() => downloadCsv("blue-prop-leads-template.csv", "first_name,last_name,mobile,suburb,email\r\nThandi,Mokoena,082 555 0141,Durbanville,thandi@example.com\r\nPieter,van Wyk,+27 83 555 0199,Bellville,")}>Download template</button>
      </div>

      <div className="kpi" style={{ maxWidth: 260 }}>
        <div className="kpi-label">Leads in this campaign</div>
        <div className="kpi-value">{ctx.leads.toLocaleString("en-ZA")}</div>
      </div>

      <ErrorNote error={error} />

      {last && (
        <div className={`note ${leftOut ? "note-warn" : "note-ok"}`}>
          <strong>{last.name ? `Last upload: ${last.name}` : "Upload done"}{last.at ? ` · ${fmtDateTime(last.at)}` : ""}.</strong> {last.added.toLocaleString("en-ZA")} of {last.total.toLocaleString("en-ZA")} rows added.
          {leftOut > 0 && <>
            <ul style={{ margin: "6px 0 6px 18px" }}>
              {Object.entries(last.rejected).map(([k, n]) => <li key={k}>{n.toLocaleString("en-ZA")} · {REJECT_LABEL[k] ?? k}</li>)}
            </ul>
            <button className="btn btn-sm" onClick={() => downloadRejections(last.id)}>Download the rows left out</button>
            {last.rejected.shotgun ? <p className="small" style={{ marginTop: 6 }}>Shotgun contacts are held for the agent who messaged them first. An admin can release them from the Shotgun list.</p> : null}
          </>}
        </div>
      )}

      {editable && !file && (
        <div className="dropzone">
          <input ref={inputRef} type="file" accept=".csv,text/csv,.txt" onChange={pick} className="sr-only" id="lead-file" />
          <label htmlFor="lead-file" className="btn btn-primary">{ctx.leads ? "Upload more leads" : "Choose a CSV file"}</label>
          <p className="muted small">Up to 5,000 rows per file. We check every number against Do Not Contact and the Shotgun list before it’s added.</p>
        </div>
      )}

      {file && (
        <div className="stack">
          <h3>Match your columns <span className="muted small">· {file.name} · {file.rows.length.toLocaleString("en-ZA")} rows</span></h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Your column</th><th>Use it as</th><th>First rows</th></tr></thead>
              <tbody>
                {file.headers.map((h, i) => (
                  <tr key={i}>
                    <td className="cell-title">{h}</td>
                    <td>
                      <select className="select" aria-label={`Use ${h} as`} value={map[i]} onChange={(e) => {
                        const v = e.target.value;
                        setMap(map.map((m, j) => (j === i ? v : v && m === v ? "" : m)));
                      }}>
                        {FIELD_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </td>
                    <td className="small muted">{file.rows.slice(0, 3).map((r) => r[i]).filter(Boolean).join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!hasPhone && <div className="note note-warn">Pick which column holds the mobile number.</div>}
          {ctx.leads > 0 && (
            <label className="row small" style={{ gap: 8 }}>
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              Replace the {ctx.leads.toLocaleString("en-ZA")} leads already in this campaign (otherwise these are added to them)
            </label>
          )}
          <div className="row">
            <button className="btn" onClick={() => setFile(null)} disabled={busy}>Cancel</button>
            <button className="btn btn-primary" onClick={upload} disabled={!hasPhone || busy}>{busy ? "Checking numbers…" : `Check and add ${file.rows.length.toLocaleString("en-ZA")} rows`}</button>
          </div>
        </div>
      )}
      <Nav back={back} next={next} />
    </section>
  );
}

// ---------- 3. Messages ----------
export function fill(body, sample, agentFirst) {
  return (body || "")
    .replace(/\{\{\s*firstName\s*\}\}/g, sample?.first_name || "Thandi")
    .replace(/\{\{\s*suburb\s*\}\}/g, sample?.suburb || "Durbanville")
    .replace(/\{\{\s*agentName\s*\}\}/g, agentFirst || "");
}
const unknownTags = (body) => (body.match(/\{\{[^}]*\}\}/g) ?? []).filter((t) => !/^\{\{\s*(firstName|suburb)\s*\}\}$/.test(t));

function StepMessages({ c, ctx, msgs, setMsgs, editable, saveMessages, next, back }) {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);
  const refs = [useRef(null), useRef(null), useRef(null)];
  const agentFirst = ctx.agent?.full_name?.split(" ")[0] ?? "";

  const update = (i, fields) => setMsgs(msgs.map((m, j) => (j === i ? { ...m, ...fields } : m)));
  function insert(i, tag) {
    const el = refs[i].current;
    const body = msgs[i].body;
    const s = el?.selectionStart ?? body.length, e = el?.selectionEnd ?? body.length;
    update(i, { body: body.slice(0, s) + tag + body.slice(e) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(s + tag.length, s + tag.length); });
  }
  async function draft() {
    if (msgs.some((m) => m.body.trim()) && !window.confirm("Replace your current messages with a new AI draft?")) return;
    setBusy("draft"); setError(null);
    try {
      const out = await callFn("campaigns", { action: "draft_messages", brief: { ...c.brief, goal: c.goal }, agent_first_name: agentFirst });
      const list = msgs.map((m, i) => ({ ...m, body: out.messages[i] ?? m.body }));
      setMsgs(list);
      await saveMessages(list);
      toast("Drafted by AI. Read them through and make them yours.");
    } catch (e) { setError(e); }
    finally { setBusy(""); }
  }
  async function rewrite(i, instruction) {
    setBusy(`rw${i}`); setError(null);
    try {
      const out = await callFn("campaigns", { action: "rewrite_message", body: msgs[i].body, position: i + 1, instruction });
      update(i, { body: out.body });
    } catch (e) { setError(e); }
    finally { setBusy(""); }
  }
  const allFilled = msgs.every((m) => m.body.trim());

  return (
    <section className="card stack">
      <div className="card-head">
        <div>
          <h2>The three messages</h2>
          <p className="muted small">Message 1 goes first; 2 and 3 only go to people who haven’t replied. Anyone who replies stops getting messages.</p>
        </div>
        {editable && <button className="btn btn-primary" onClick={draft} disabled={!!busy}>{busy === "draft" ? "Writing…" : msgs.some((m) => m.body.trim()) ? "Redraft with AI" : "Draft with AI"}</button>}
      </div>
      <ErrorNote error={error} />
      <details className="note note-info">
        <summary><strong>Tips for messages that get replies</strong></summary>
        <ul style={{ margin: "6px 0 0 18px" }}>
          <li>Keep it short and sound like a person, not a broadcast.</li>
          <li>Use {"{{firstName}}"} so every message is personal.</li>
          <li>Ask one easy question, e.g. “Would a quick valuation be useful?”</li>
          <li>Make the last message easy to decline: “Reply STOP and I won’t message again.”</li>
        </ul>
      </details>

      <div className="wiz-msgs">
        <div className="stack">
          {msgs.map((m, i) => {
            const len = m.body.length, max = LIMITS[i + 1];
            const bad = unknownTags(m.body);
            return (
              <div key={m.position} className="msg-card">
                <div className="row spread">
                  <h3>Message {i + 1}</h3>
                  {i > 0 && (
                    <label className="small row" style={{ gap: 6 }}>
                      Send
                      <input className="input" type="number" min={1} max={30} style={{ width: 64 }} disabled={!editable} value={m.delay_days}
                        onChange={(e) => update(i, { delay_days: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} aria-label={`Days before message ${i + 1}`} />
                      days after message {i}
                    </label>
                  )}
                </div>
                <textarea ref={refs[i]} className="textarea" rows={5} value={m.body} disabled={!editable} aria-label={`Message ${i + 1}`}
                  onChange={(e) => update(i, { body: e.target.value })} onBlur={() => saveMessages()}
                  placeholder={i === 0 ? "Hi {{firstName}}, it’s … from Blue PROP …" : i === 1 ? "A friendly follow-up…" : "A polite last message…"} />
                <div className="row spread small">
                  <span className="row" style={{ gap: 6 }}>
                    {editable && PLACEHOLDERS.map(([t, l]) => <button key={t} type="button" className="chip" onClick={() => insert(i, t)}>+ {l}</button>)}
                  </span>
                  <span className={len > max ? "t-bad" : "muted"}>{len}/{max}</span>
                </div>
                {bad.length > 0 && <div className="note note-warn small">{bad.join(", ")} won’t be filled in. Use {"{{firstName}}"} or {"{{suburb}}"}.</div>}
                {editable && m.body.trim() && (
                  <div className="row small" style={{ gap: 6 }}>
                    <span className="muted">AI:</span>
                    {["Make it shorter", "Make it warmer", "More professional", "Add a clear question"].map((t) => (
                      <button key={t} type="button" className="chip" disabled={!!busy} onClick={() => rewrite(i, t.toLowerCase())}>{busy === `rw${i}` ? "…" : t}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <WhatsAppPreview msgs={msgs} sample={ctx.sample} agent={ctx.agent?.full_name} />
      </div>
      <Nav back={back} next={next} disabled={!allFilled}>{!allFilled && <span className="muted small">Fill in all three messages to continue.</span>}</Nav>
    </section>
  );
}

function WhatsAppPreview({ msgs, sample, agent }) {
  return (
    <div className="wa-phone" aria-label="Preview of how the messages look on WhatsApp">
      <div className="wa-head">{agent ?? "Agent"} · Blue PROP</div>
      <div className="wa-body">
        <p className="wa-note">Preview for {sample?.first_name ?? "Thandi"}{sample?.suburb ? ` in ${sample.suburb}` : ""}</p>
        {msgs.map((m, i) => m.body.trim() ? (
          <div key={i}>
            {i > 0 && <p className="wa-note">{m.delay_days} day{m.delay_days === 1 ? "" : "s"} later, if no reply</p>}
            <div className="wa-bubble">{fill(m.body, sample)}</div>
          </div>
        ) : null)}
        {!msgs.some((m) => m.body.trim()) && <p className="wa-note">Your messages appear here.</p>}
      </div>
    </div>
  );
}

// ---------- 4. Schedule ----------
function StepSchedule({ c, ctx, msgs, editable, save, next, back }) {
  const d = ctx.settings;
  const [s, setS] = useState({ days: c.schedule?.days ?? d.window_days ?? [1, 2, 3, 4, 5], start: c.schedule?.start ?? d.window_start ?? "07:30", end: c.schedule?.end ?? d.window_end ?? "18:00", start_date: c.schedule?.start_date ?? "" });
  const valid = s.days.length > 0 && s.start < s.end;
  const today = new Date().toISOString().slice(0, 10);
  async function saveAndNext() {
    if (!valid) return;
    if (await save({ schedule: { ...s, timezone: d.timezone } }, true)) next();
  }
  const total = msgs.reduce((a, m, i) => a + (i ? Number(m.delay_days) || 0 : 0), 0);
  return (
    <section className="card stack">
      <h2>When should messages send?</h2>
      <p className="muted small">Messages only go out inside this window ({d.timezone.replace("_", " ")} time). The defaults come from the company rules.</p>
      <fieldset disabled={!editable} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="field">
          <span id="sch-days" style={{ fontWeight: 500 }}>Days</span>
          <div className="row" role="group" aria-labelledby="sch-days" style={{ gap: 6 }}>
            {DAYS.map(([n, l]) => (
              <button type="button" key={n} className={`chip ${s.days.includes(n) ? "chip-on" : ""}`} aria-pressed={s.days.includes(n)}
                onClick={() => setS({ ...s, days: s.days.includes(n) ? s.days.filter((x) => x !== n) : [...s.days, n].sort() })}>{l}</button>
            ))}
          </div>
        </div>
        <div className="grid g3">
          <Field label="From" id="sch-start"><input id="sch-start" className="input" type="time" value={s.start} onChange={(e) => setS({ ...s, start: e.target.value })} /></Field>
          <Field label="Until" id="sch-end"><input id="sch-end" className="input" type="time" value={s.end} onChange={(e) => setS({ ...s, end: e.target.value })} /></Field>
          <Field label="Start on" id="sch-date" hint="Leave empty to start as soon as it launches."><input id="sch-date" className="input" type="date" min={today} value={s.start_date} onChange={(e) => setS({ ...s, start_date: e.target.value })} /></Field>
        </div>
      </fieldset>
      {!valid && <div className="note note-warn">{s.days.length ? "The end time must be after the start time." : "Pick at least one day."}</div>}
      <p className="small muted">Each lead gets message 1, then message 2 {msgs[1]?.delay_days} days later and message 3 {msgs[2]?.delay_days} days after that, if they haven’t replied: about {total} days from first to last message.</p>
      <Nav back={back} next={editable ? saveAndNext : next} nextLabel={editable ? "Save and continue" : "Next"} disabled={!valid} />
    </section>
  );
}

// ---------- 5. Review ----------
function StepReview({ c, ctx, msgs, editable, go, onDelete }) {
  const n = ctx.number;
  const checks = [
    { ok: !!c.name, label: "Campaign has a name", step: 1 },
    { ok: !!n, label: n ? `Sends from ${ctx.agent?.full_name}’s number${n.phone_last4 ? ` ending ${n.phone_last4}` : ""}` : `${ctx.agent?.full_name ?? "The agent"} has no WhatsApp number linked yet`, fix: n ? null : "An admin links it on lemlist & numbers." },
    { ok: !!n && n.status === "ok", label: n ? `Number status: ${NUMBER_STATUS[n.status]?.[0] ?? n.status}` : "Number status unknown", warn: n && n.status !== "ok" },
    { ok: ctx.leads > 0, label: `${ctx.leads.toLocaleString("en-ZA")} lead${ctx.leads === 1 ? "" : "s"} ready`, step: 2 },
    { ok: msgs.every((m) => m.body.trim()) && msgs.every((m) => !unknownTags(m.body).length), label: "All three messages written", step: 3 },
    { ok: !!c.schedule?.days?.length, label: c.schedule?.days?.length ? `Sends ${c.schedule.days.map((d) => DAYS.find((x) => x[0] === d)?.[1]).join(", ")}, ${c.schedule.start}–${c.schedule.end}` : "Sending window not set", step: 4 },
  ];
  const ready = checks.every((x) => x.ok);
  return (
    <section className="card stack">
      <h2>Review</h2>
      <ul className="checklist">
        {checks.map((x, i) => (
          <li key={i} className={x.ok ? "ok" : "bad"}>
            <span className="check-ic" aria-hidden="true">{x.ok ? "✓" : "!"}</span>
            <span>{x.label}{x.fix && <span className="muted small"> · {x.fix}</span>}</span>
            {!x.ok && x.step && editable && <button className="link-btn small" onClick={() => go(x.step)}>Fix</button>}
          </li>
        ))}
      </ul>
      <div className="note note-info">
        <strong>Launching isn’t switched on yet.</strong> The first launch will be tested with lemlist once Fin-Link and Blue PROP approve it. Until then this campaign stays a draft{ready ? " — it’s ready to go when launching opens" : ""}.
      </div>
      <div className="row wiz-nav">
        <button className="btn" onClick={() => go(4)}>Back</button>
        {editable && <button className="btn btn-danger" onClick={onDelete}>Delete draft</button>}
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" disabled title="Launching opens after the lemlist test is approved">Launch campaign</button>
      </div>
    </section>
  );
}
