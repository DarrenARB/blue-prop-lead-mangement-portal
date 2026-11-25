import { useCallback, useEffect, useState } from "react";
import { must, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { fmtDate, fmtDateTime, fmtPhone } from "../lib/format";
import { Badge, Empty, ErrorNote, Spinner, useToast } from "../components/ui";

// Shotgun list: people an agent tried to upload who are already another agent's lead.
// Main Admins see and decide everything, company-wide. Branch Owners see only entries involving their
// branch, and decide only when both agents are in their branch (one branch never takes another's lead).
export default function Shotgun() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [months, setMonths] = useState(3);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("open");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const [list, settings] = await Promise.all([
        supabase.rpc("list_shotgun").then(must),
        supabase.from("settings").select("shotgun_months").eq("id", 1).single().then(must),
      ]);
      setRows(list ?? []);
      setMonths(settings?.shotgun_months ?? 3);
    } catch (e) { setError(e); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function resolve(r, action) {
    setBusy(r.id);
    const { error } = await supabase.rpc("resolve_shotgun", { p_id: r.id, p_action: action });
    setBusy("");
    if (error) return toast(error.message, "bad");
    toast(action === "keep" ? `Kept with ${r.holder_name}` : `Moved to ${r.tried_name}. ${first(r.holder_name)} stops messaging them.`);
    load();
  }
  const open = (rows ?? []).filter((r) => !r.outcome);
  const shown = tab === "open" ? open : (rows ?? []).filter((r) => r.outcome);
  const first = (n) => (n ?? "").split(" ")[0];
  const branch = (b) => (!b ? "No branch" : /branch/i.test(b) ? b : `${b} branch`);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{isAdmin ? "Company-wide" : "Your branches"}</p>
          <h1>Shotgun list</h1>
          <p className="muted">
            Branches are part of one company, so two agents never work the same person. When someone uploads a person who is already another agent’s lead (contacted in the last {months} month{months === 1 ? "" : "s"}), they’re left out of the upload and listed here.{" "}
            {isAdmin ? "Keep them with the agent who has them, or move them to the agent who asked." : "You can decide when both agents are in your branch. If the other agent is in a different branch, a Main Admin decides."}
          </p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "open"} className={`tab ${tab === "open" ? "active" : ""}`} onClick={() => setTab("open")}>Waiting <span className="tab-n">{open.length}</span></button>
        <button role="tab" aria-selected={tab === "done"} className={`tab ${tab === "done" ? "active" : ""}`} onClick={() => setTab("done")}>Decided <span className="tab-n">{(rows?.length ?? 0) - open.length}</span></button>
      </div>
      <ErrorNote error={error} />
      {!rows && !error ? <Spinner /> : rows && shown.length === 0 ? (
        <div className="card"><Empty title={tab === "open" ? "Nobody waiting" : "Nothing decided yet"}>{tab === "open" ? "No agent has tried to upload someone who is already another agent’s lead." : ""}</Empty></div>
      ) : rows && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Person</th><th>Lead of</th><th>Wanted by</th><th>{tab === "open" ? "Free from" : "Outcome"}</th>{tab === "open" && <th></th>}</tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td><div className="cell-title">{r.contact_name || "Unnamed contact"}</div><div className="cell-sub mono">{r.contact_phone ? fmtPhone(r.contact_phone) : ""}{r.contact_suburb ? ` · ${r.contact_suburb}` : ""}</div></td>
                  <td>{r.holder_name}<div className="cell-sub">{branch(r.holder_branch)}{r.holder_campaign ? ` · ${r.holder_campaign}` : ""} · last contact {fmtDate(r.last_contacted_at)}</div></td>
                  <td>{r.tried_name}<div className="cell-sub">{branch(r.tried_branch)}{r.tried_campaign ? ` · ${r.tried_campaign}` : ""} · {fmtDateTime(r.tried_at)}</div></td>
                  <td>{tab === "open" ? <>{fmtDate(r.free_from)}{!r.same_branch && <div className="cell-sub"><Badge tone="warn">Different branches</Badge></div>}</>
                    : <><Badge tone={r.outcome === "released" ? "brand" : "muted"}>{r.outcome === "released" ? `Moved to ${r.tried_name}` : `Kept with ${r.holder_name}`}</Badge><div className="cell-sub">{r.resolved_by_name ?? ""} · {fmtDateTime(r.resolved_at)}</div></>}</td>
                  {tab === "open" && (
                    <td className="num">
                      {r.can_resolve ? (
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                          <button className="btn btn-sm" disabled={busy === r.id} onClick={() => resolve(r, "keep")}>Keep with {first(r.holder_name)}</button>
                          <button className="btn btn-sm btn-primary" disabled={busy === r.id} onClick={() => resolve(r, "release")}>Move to {first(r.tried_name)}</button>
                        </div>
                      ) : <span className="small muted">A Main Admin decides (other branch)</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
