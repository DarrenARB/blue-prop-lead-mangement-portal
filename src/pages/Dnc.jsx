import { useCallback, useEffect, useMemo, useState } from "react";
import { callFn, must, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { fmtDateTime, fmtPhone } from "../lib/format";
import { downloadCsv, guessField, parseCsv, readFile } from "../lib/csv";
import { Badge, Empty, ErrorNote, Field, Icon, ICONS, Modal, Spinner, useToast } from "../components/ui";

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

  const load = useCallback(() => {
    supabase.from("dnc").select("*").order("created_at", { ascending: false }).then(must).then(setRows).catch(setError);
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows ?? [];
    const digits = t.replace(/\D/g, "");
    return (rows ?? []).filter((r) => (r.name ?? "").toLowerCase().includes(t) || (digits.length >= 3 && r.phone_e164.replace(/\D/g, "").includes(digits.replace(/^0/, ""))));
  }, [rows, q]);
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
          <p className="muted">Nobody on this list is ever messaged, by any agent. Uploads are checked against it automatically. Only Branch Owners and admins can take someone off, and a reason is always logged.</p>
        </div>
        <div className="row">
          {isAdmin && rows?.length > 0 && <button className="btn" onClick={exportCsv}>Export</button>}
          {canBulk && <button className="btn" onClick={() => setModal("bulk")}>Bulk upload</button>}
          <button className="btn btn-primary" onClick={() => setModal("add")}><Icon d={ICONS.plus} />Add number</button>
        </div>
      </div>
      {review > 0 && <div className="note note-warn">{review} number{review > 1 ? "s were" : " was"} added automatically and should be checked.</div>}
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
            <thead><tr><th>Number</th><th>Reason</th><th>Added</th>{canBulk && <th></th>}</tr></thead>
            <tbody>
              {shown.slice(0, 500).map((r) => (
                <tr key={r.id}>
                  <td><div className="cell-title mono">{fmtPhone(r.phone_e164)}</div>{r.name && <div className="cell-sub">{r.name}</div>}</td>
                  <td>{r.reason || <span className="muted">—</span>} {r.needs_review && <Badge tone="warn">Check</Badge>}<div className="cell-sub">{SOURCE[r.source] ?? r.source}</div></td>
                  <td className="small">{fmtDateTime(r.created_at)}<div className="cell-sub">{r.added_by_name ?? "System"}</div></td>
                  {canBulk && <td className="num"><button className="btn btn-sm" onClick={() => setModal({ remove: r })}>Remove</button></td>}
                </tr>
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
  const [f, setF] = useState({ phone: "", name: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const phone = normalisePhone(f.phone);
      if (!phone) throw new Error("That isn’t a valid mobile number. Use a format like 082 555 0141 or +27 82 555 0141.");
      const { error } = await supabase.from("dnc").insert({ phone_e164: phone, name: f.name.trim() || null, reason: f.reason.trim() || null, source: "manual" });
      if (error) throw new Error(error.code === "23505" ? "That number is already on the list." : error.message);
      onDone();
    } catch (err) { setError(err); setBusy(false); }
  }
  return (
    <Modal title="Add to Do Not Contact" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="dnc-add" disabled={busy}>{busy ? "Adding…" : "Add"}</button></>}>
      <form id="dnc-add" className="stack" onSubmit={submit}>
        <ErrorNote error={error} />
        <Field label="Mobile number" id="dnc-phone"><input id="dnc-phone" className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="082 555 0141" autoFocus /></Field>
        <Field label="Name (optional)" id="dnc-name"><input id="dnc-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Reason (optional)" id="dnc-reason"><input id="dnc-reason" className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Asked not to be contacted" /></Field>
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
        <Field label="Reason for all (optional)" id="dnc-breason"><input id="dnc-breason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Imported from the CRM opt-out list" /></Field>
        <p className="muted small">Numbers already on the list are skipped; invalid numbers are counted and left out.</p>
      </div>
    </Modal>
  );
}

function RemoveDnc({ row, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.rpc("remove_dnc", { p_id: row.id, p_reason: reason });
    if (error) { setError(error); setBusy(false); } else onDone();
  }
  return (
    <Modal title={`Remove ${row.name || fmtPhone(row.phone_e164)}?`} sub="They could then be messaged again. This is logged with your name and reason." onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-danger" form="dnc-rm" disabled={busy || !reason.trim()}>{busy ? "Removing…" : "Remove"}</button></>}>
      <form id="dnc-rm" className="stack" onSubmit={submit}>
        <ErrorNote error={error} />
        <Field label="Why are they being removed?" id="dnc-rm-reason"><input id="dnc-rm-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Asked to hear about new listings again" autoFocus /></Field>
      </form>
    </Modal>
  );
}
