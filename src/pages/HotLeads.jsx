import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { must, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { fmtDateTime, fmtPhone } from "../lib/format";
import { Badge, Empty, ErrorNote, Spinner, useToast } from "../components/ui";
import { notReady, personName, scoreTone } from "./Inbox";

export default function HotLeads() {
  const { profile, isAdmin } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("new");
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [threshold, setThreshold] = useState(70);

  const load = useCallback(async () => {
    try {
      const [h, people, settings] = await Promise.all([
        supabase.from("hot_leads").select("*, contact:contacts(first_name, last_name, phone_e164, suburb), campaign:campaigns(name), conversation:conversations(score, score_reason, last_preview, last_message_at, is_sample)").eq("active", true).order("updated_at", { ascending: false }).limit(1000).then(must),
        supabase.from("profiles").select("id, full_name").then(must),
        supabase.from("settings").select("hot_threshold").eq("id", 1).single().then(must),
      ]);
      const names = Object.fromEntries((people ?? []).map((p) => [p.id, p.full_name]));
      setRows((h ?? []).map((x) => ({ ...x, agent: names[x.agent_id] ?? "—" })));
      setThreshold(settings?.hot_threshold ?? 70);
      setSelected(new Set());
    } catch (e) { setError(e); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => (rows ?? []).filter((r) => (tab === "new" ? !r.exported_at : tab === "exported" ? r.exported_at : true)), [rows, tab]);
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = shown.length > 0 && shown.every((r) => selected.has(r.id));

  async function exportXlsx() {
    const list = shown.filter((r) => selected.size === 0 || selected.has(r.id));
    if (!list.length) return;
    setBusy(true);
    try {
      const { default: writeXlsxFile } = await import("write-excel-file");
      await writeXlsxFile(list, {
        fileName: `blue-prop-hot-leads-${new Date().toISOString().slice(0, 10)}.xlsx`,
        schema: [
          { column: "Name", type: String, width: 24, value: (r) => personName(r.contact) },
          { column: "Phone", type: String, width: 18, value: (r) => r.contact?.phone_e164 ?? "" },
          { column: "Suburb", type: String, width: 16, value: (r) => r.contact?.suburb ?? "" },
          { column: "Campaign", type: String, width: 28, value: (r) => r.campaign?.name ?? "" },
          { column: "Agent", type: String, width: 20, value: (r) => r.agent },
          { column: "AI score", type: Number, value: (r) => r.conversation?.score ?? null },
          { column: "Reason", type: String, width: 40, value: (r) => r.conversation?.score_reason ?? "" },
          { column: "Last reply", type: String, width: 50, value: (r) => r.conversation?.last_preview ?? "" },
          { column: "Reply date", type: Date, format: "yyyy-mm-dd hh:mm", width: 18, value: (r) => (r.conversation?.last_message_at ? new Date(r.conversation.last_message_at) : null) },
          { column: "Added by", type: String, value: (r) => (r.source === "manual" ? "Person" : "AI") },
        ],
      });
      const { data: n, error } = await supabase.rpc("mark_exported", { p_ids: list.map((r) => r.id) });
      if (error) throw error;
      toast(`Exported ${n} lead${n === 1 ? "" : "s"}. They’re marked so they aren’t loaded into the CRM twice.`);
      load();
    } catch (e) { toast(e.message, "bad"); }
    finally { setBusy(false); }
  }
  const newCount = (rows ?? []).filter((r) => !r.exported_at).length;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{isAdmin ? "All agents" : profile.role === "owner" ? "Your branches" : "Your best leads"}</p>
          <h1>Hot Leads</h1>
          <p className="muted">Replies the AI scored {threshold} or higher, plus any you moved in yourself. Export them to Excel to load into the CRM.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => notReady(toast, "Sending straight to the CRM")}>Send to CRM</button>
          <button className="btn btn-primary" disabled={busy || !shown.length} onClick={exportXlsx}>{busy ? "Exporting…" : selected.size ? `Export ${selected.size} to Excel` : `Export ${shown.length} to Excel`}</button>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {[["new", "Not exported", newCount], ["exported", "Exported", (rows?.length ?? 0) - newCount], ["all", "All", rows?.length ?? 0]].map(([k, l, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => { setTab(k); setSelected(new Set()); }}>{l} <span className="tab-n">{n}</span></button>
        ))}
      </div>
      <ErrorNote error={error} />
      {!rows && !error ? <Spinner /> : rows && shown.length === 0 ? (
        <div className="card"><Empty title={rows.length ? "Nothing here" : "No hot leads yet"}>{rows.length ? "Try another tab." : "When someone replies with real interest, the AI moves them here automatically."}</Empty></div>
      ) : rows && (
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th style={{ width: 32 }}><input type="checkbox" aria-label="Select all" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(shown.map((r) => r.id)))} /></th>
              <th>Lead</th><th>Score</th><th>Last reply</th>{profile.role !== "agent" && <th>Agent</th>}<th>Exported</th>
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td><input type="checkbox" aria-label={`Select ${personName(r.contact)}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td>
                    <Link to="/inbox" className="cell-title">{personName(r.contact)}</Link> {r.conversation?.is_sample && <Badge>Demo</Badge>}
                    <div className="cell-sub mono">{r.contact ? fmtPhone(r.contact.phone_e164) : ""}{r.contact?.suburb ? ` · ${r.contact.suburb}` : ""}</div>
                    <div className="cell-sub">{r.campaign?.name ?? ""}</div>
                  </td>
                  <td><Badge tone={scoreTone(r.conversation?.score, threshold)}>{r.conversation?.score ?? "–"}</Badge>{r.source === "manual" && <div className="cell-sub">Moved in by hand</div>}</td>
                  <td className="small" style={{ maxWidth: 320 }}>{r.conversation?.last_preview ?? "—"}<div className="cell-sub">{r.conversation?.score_reason ?? ""}</div></td>
                  {profile.role !== "agent" && <td>{r.agent}</td>}
                  <td className="small">{r.exported_at ? fmtDateTime(r.exported_at) : <span className="muted">Not yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
