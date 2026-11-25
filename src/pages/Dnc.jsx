import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { callFn, must, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { fmtDateTime, fmtPhone } from "../lib/format";
import { downloadCsv, guessField, parseCsv, readFile } from "../lib/csv";
import { Badge, Empty, ErrorNote, Field, Icon, ICONS, Modal, Spinner, useToast } from "../components/ui";
import ReasonPicker, { DNC_ADD_REASONS, DNC_BULK_REASONS, DNC_REMOVE_REASONS } from "../components/ReasonPicker";
import ContactPicker from "../components/ContactPicker";

const SOURCE = { manual: "Added by hand", bulk: "Bulk upload", inbox: "From the inbox", ai_opt_out: "AI spotted an opt-out", upload: "From an upload" };

export function normalisePhone(raw) {
  let d = String(raw ?? "").trim().replace(/[\s\-().]/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (/^0\d{9}$/.test(d)) d = "+27" + d.slice(1);
  else if (/^27\d{9}$/.test(d)) d = "+" + d;
  else if (/^[6-8]\d{8}$/.test(d)) d = "+27" + d;
  if (d.startsWith("+27")) return /^\+27[6-8]\d{8}$/.test(d) ? d : null;
  return /^\+[1-9]\d{7,14}$/.test(d) ? d : null;
}

export default function Dnc() {
  const { isAdmin, profile } = useAuth();
  const toast = useToast();
  const canBulk = isAdmin || profile.role === "owner";
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null); // 'add' | 'bulk' | {remove: row}
  const [onlyReview, setOnlyReview] = useState(false);
  const mayRemove = (r) => canBulk || r.source === "ai_opt_out" || r.added_by === profile.id; // the server makes the final check
  async function confirmAi(r) {
    const { error } = await supabase.rpc("confirm_dnc", { p_id: r.id });
    if (error) return toast(error.message, "bad");
    toast("Kept on Do Not Contact"); load();
  }

  const load = useCallback(() => {
    supabase.from("dnc").select("*").order("created_at", { ascending: false }).then(must).then(setRows).catch(setError);
  }, []);
  useEffect(() => { load(); }, [load]);

  // AI entries waiting for a check always sit on top. Once kept (or added by a person) they're just
  // part of the list, newest first (rows already arrive newest first, and the sort keeps that order).
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const digits = t.replace(/\D/g, "");
    const match = (r) => !t || (r.name ?? "").toLowerCase().includes(t) || (r.email ?? "").toLowerCase().includes(t) || (digits.length >= 3 && r.phone_e164.replace(/\D/g, "").includes(digits.replace(/^0/, "")));
    return (rows ?? []).filter((r) => (!onlyReview || r.needs_review) && match(r))
      .sort((a, b) => (b.needs_review ? 1 : 0) - (a.needs_review ? 1 : 0));
  }, [rows, q, onlyReview]);
  const firstChecked = shown.findIndex((r) => !r.needs_review);
  const review = (rows ?? []).filter((r) => r.needs_review).length;

  function exportCsv() {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    downloadCsv("do-not-contact.csv", ["Number,Name,Reason,Source,Added by,Added on", ...shown.map((r) => [r.phone_e164, r.name, r.reason, SOURCE[r.source] ?? r.source, r.added_by_name, fmtDateTime(r.created_at)].map(esc).join(","))].join("\r\n"));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Company-wide</p>
          <h1>Do Not Contact</h1>
          <p className="muted">Nobody on this list is ever messaged, by any agent. Uploads are checked against it by number and email, and anyone added is stopped in campaigns that haven’t sent to them yet. The AI adds people who reply “not interested” or “stop”; agents can undo the AI’s choice for their own contacts, and Branch Owners and admins can remove anyone. A reason is always logged.</p>
        </div>
        <div className="row">
          {isAdmin && rows?.length > 0 && <button className="btn" onClick={exportCsv}>Export</button>}
          {canBulk && <button className="btn" onClick={() => setModal("bulk")}>Bulk upload</button>}
          <button className="btn btn-primary" onClick={() => setModal("add")}><Icon d={ICONS.plus} />Add number</button>
        </div>
      </div>
      {review > 0 && (
        <div className="note note-warn row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span><strong>{review} added by the AI</strong> from replies like “not interested” or “stop”. Check {review > 1 ? "them" : "it"}: keep {review > 1 ? "them" : "it"}, or undo if the AI got it wrong.</span>
          <button className="btn btn-sm" onClick={() => setOnlyReview(!onlyReview)}>{onlyReview ? "Show everyone" : "Show only these"}</button>
        </div>
      )}
      <div className="filters">
        <input className="input" type="search" placeholder="Search by name or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search Do Not Contact" style={{ maxWidth: 320 }} />
        <span className="muted small">{rows ? `${shown.length.toLocaleString("en-ZA")} of ${rows.length.toLocaleString("en-ZA")}` : ""}</span>
      </div>
      <ErrorNote error={error} />
      {!rows && !error ? <Spinner /> : rows && shown.length === 0 ? (
        <div className="card"><Empty title={rows.length ? "No matches" : "The list is empty"}>{rows.length ? "Try a different name or number." : "Add anyone who has asked not to be contacted."}</Empty></div>
      ) : rows && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Person</th><th>Reason</th><th>Added</th><th></th></tr></thead>
            <tbody>
              {shown.slice(0, 500).map((r, i) => (
                <Fragment key={r.id}>
                {i === 0 && r.needs_review && <tr className="group-row"><td colSpan={4}>Needs a check: added by the AI from a reply. Keep, or undo if the AI got it wrong.</td></tr>}
                {i === firstChecked && firstChecked > 0 && <tr className="group-row"><td colSpan={4}>On the list, newest first</td></tr>}
                <tr className={r.needs_review ? "row-review" : ""}>
                  <td>{r.name ? <div className="cell-title">{r.name}</div> : null}<div className={r.name ? "cell-sub mono" : "cell-title mono"}>{fmtPhone(r.phone_e164)}</div>{r.email && <div className="cell-sub">{r.email}</div>}</td>
                  <td>{r.reason || <span className="muted">—</span>} {r.needs_review && <Badge tone="warn">Needs a check</Badge>}<div className="cell-sub">{SOURCE[r.source] ?? r.source}</div></td>
                  <td className="small">{fmtDateTime(r.created_at)}<div className="cell-sub">{r.added_by_name ?? "System"}</div></td>
                  <td className="num">
                    <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                      {r.needs_review && mayRemove(r) && <button className="btn btn-sm btn-primary" onClick={() => confirmAi(r)}>Keep</button>}
                      {mayRemove(r) && <button className="btn btn-sm" onClick={() => setModal({ remove: r })}>{r.source === "ai_opt_out" ? "Undo" : "Remove"}</button>}
                    </div>
                  </td>
                </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
          {shown.length > 500 && <p className="muted small" style={{ padding: 10 }}>Showing the first 500. Search to narrow it down.</p>}
        </div>
      )}
      {modal === "add" && <AddDnc onClose={() => setModal(null)} onDone={() => { setModal(null); load(); toast("Added to Do Not Contact"); }} />}
      {modal === "bulk" && <BulkDnc onClose={() => setModal(null)} onDone={(o) => { setModal(null); load(); toast(`${o.added} added · ${o.already} already listed · ${o.invalid} invalid`); }} />}
      {modal?.remove && <RemoveDnc row={modal.remove} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); toast("Removed from Do Not Contact"); }} />}
    </>
  );
}

function AddDnc({ onClose, onDone }) {
  const [person, setPerson] = useState(null);
  const [manual, setManual] = useState(false);
  const [f, setF] = useState({ phone: "", name: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      let row;
      if (person) {
        row = { phone_e164: person.phone_e164, name: [person.first_name, person.last_name].filter(Boolean).join(" ") || null, email: person.email ?? null, contact_id: person.id };
      } else {
        if (!manual) throw new Error("Pick the person, or choose “enter a number by hand”.");
        const phone = normalisePhone(f.phone);
        if (!phone) throw new Error("That isn’t a valid mobile number. Use a format like 082 555 0141 or +27 82 555 0141.");
        row = { phone_e164: phone, name: f.name.trim() || null };
      }
      if (!f.reason.trim()) throw new Error("Pick a reason, or choose Other and write one.");
      const { error } = await supabase.from("dnc").insert({ ...row, reason: f.reason.trim(), source: "manual" });
      if (error) throw new Error(error.code === "23505" ? "They’re already on the list." : error.message);
      onDone();
    } catch (err) { setError(err); setBusy(false); }
  }
  return (
    <Modal title="Add to Do Not Contact" sub="They won’t be messaged again by anyone, and they’re stopped in any campaign that hasn’t sent to them yet." onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="dnc-add" disabled={busy}>{busy ? "Adding…" : "Add"}</button></>}>
      <form id="dnc-add" className="stack" onSubmit={submit}>
        <ErrorNote error={error} />
        {!manual ? (
          <>
            <Field label="Who?" id="dnc-pick" hint="Search the people you’re talking to by name, number, email or suburb.">
              <ContactPicker id="dnc-pick" value={person} onChange={setPerson} autoFocus />
            </Field>
            {!person && <button type="button" className="btn-link small" style={{ alignSelf: "flex-start" }} onClick={() => setManual(true)}>Not in the list? Enter a number by hand</button>}
          </>
        ) : (
          <>
            <Field label="Mobile number" id="dnc-phone"><input id="dnc-phone" className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="082 555 0141" autoFocus /></Field>
            <Field label="Name (optional)" id="dnc-name"><input id="dnc-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <button type="button" className="btn-link small" style={{ alignSelf: "flex-start" }} onClick={() => setManual(false)}>Search my contacts instead</button>
          </>
        )}
        <ReasonPicker id="dnc-reason" label="Why shouldn’t they be contacted?" reasons={DNC_ADD_REASONS} value={f.reason} onChange={(v) => setF({ ...f, reason: v })} required />
      </form>
    </Modal>
  );
}

function BulkDnc({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(null);
    try {
      const { headers, rows } = parseCsv(await readFile(f));
      const g = headers.map(guessField);
      let phoneCol = g.indexOf("phone");
      if (phoneCol < 0 && headers.length === 1) phoneCol = 0;
      if (phoneCol < 0) throw new Error("Couldn’t find a column with mobile numbers. Name it “mobile” or “phone”.");
      const nameCol = g.indexOf("full_name") >= 0 ? g.indexOf("full_name") : g.indexOf("first_name");
      const reasonCol = headers.findIndex((h) => /reason|note/i.test(h));
      setFile({ name: f.name, rows: rows.map((r) => ({ phone: r[phoneCol], name: nameCol >= 0 ? r[nameCol] : undefined, reason: reasonCol >= 0 ? r[reasonCol] : undefined })) });
    } catch (err) { setError(err); }
  }
  async function submit() {
    setBusy(true); setError(null);
    try { onDone(await callFn("campaigns", { action: "bulk_dnc", rows: file.rows, reason: reason.trim() || null, filename: file.name })); }
    catch (err) { setError(err); setBusy(false); }
  }
  return (
    <Modal title="Bulk upload Do Not Contact" sub="A CSV with a mobile number column. Name and reason columns are used if present." onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit} disabled={!file || busy}>{busy ? "Adding…" : file ? `Add ${file.rows.length.toLocaleString("en-ZA")} numbers` : "Add"}</button></>}>
      <div className="stack">
        <ErrorNote error={error} />
        <input type="file" accept=".csv,text/csv,.txt" onChange={pick} className="sr-only" id="dnc-file" />
        <label htmlFor="dnc-file" className="btn" style={{ alignSelf: "flex-start" }}>{file ? `Change file (${file.name})` : "Choose a CSV file"}</label>
        <ReasonPicker id="dnc-breason" label="Reason for everyone in the file" hint="A reason column in the file wins over this." reasons={DNC_BULK_REASONS} value={reason} onChange={setReason} />
        <p className="muted small">Numbers already on the list are skipped; invalid numbers are counted and left out.</p>
      </div>
    </Modal>
  );
}

function RemoveDnc({ row, onClose, onDone }) {
  const [reason, setReason] = useState(row.source === "ai_opt_out" ? "The AI got it wrong: they didn’t ask to stop" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.rpc("remove_dnc", { p_id: row.id, p_reason: reason });
    if (error) { setError(error); setBusy(false); } else onDone();
  }
  return (
    <Modal title={row.source === "ai_opt_out" ? `Undo the AI for ${row.name || fmtPhone(row.phone_e164)}?` : `Remove ${row.name || fmtPhone(row.phone_e164)}?`} sub="They could then be messaged again. This is logged with your name and reason." onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-danger" form="dnc-rm" disabled={busy || !reason.trim()}>{busy ? "Removing…" : "Remove"}</button></>}>
      <form id="dnc-rm" className="stack" onSubmit={submit}>
        <ErrorNote error={error} />
        <ReasonPicker id="dnc-rm-reason" label="Why are they being removed?" reasons={DNC_REMOVE_REASONS.filter((r) => row.source === "ai_opt_out" || !r.startsWith("The AI"))} value={reason} onChange={setReason} required />
      </form>
    </Modal>
  );
}
