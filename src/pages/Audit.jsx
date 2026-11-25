import { useEffect, useState } from "react";
import { must, supabase } from "../lib/supabase";
import { fmtDateTime } from "../lib/format";
import { Badge, Empty, ErrorNote, Spinner } from "../components/ui";

const TYPES = { people: "People", branches: "Branches", lemlist: "lemlist", numbers: "Numbers", plan_items: "Project plan", plan_payments: "Payments", plan_drawdowns: "Drawdowns", campaigns: "Campaigns", dnc: "Do Not Contact", shotgun: "Shotgun list", hot_leads: "Hot Leads", export: "Exports", settings: "Rules" };

export default function Audit() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [type, setType] = useState("all");

  useEffect(() => {
    let q = supabase.from("audit_log").select("id, at, actor_name, type, summary").order("at", { ascending: false }).limit(300);
    if (type !== "all") q = q.eq("type", type);
    q.then(must).then(setRows).catch(setError);
  }, [type]);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Main Admin</p>
          <h1>Audit log</h1>
          <p className="muted">Every change to people, branches, numbers and the project plan, with who did it and when.</p>
        </div>
        <select className="select" style={{ width: "auto" }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
          <option value="all">Everything</option>
          {Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <ErrorNote error={error} />
      {!rows && !error ? <Spinner /> : rows && rows.length === 0 ? <div className="card"><Empty title="Nothing logged yet" /></div> : rows && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Who</th><th>Type</th><th>What happened</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="small" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.at)}</td>
                  <td>{r.actor_name}</td>
                  <td><Badge tone="brand">{TYPES[r.type] ?? r.type}</Badge></td>
                  <td>{r.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
