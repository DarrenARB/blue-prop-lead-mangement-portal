import { useCallback, useEffect, useState } from "react";
import { must, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { fmtDate, fmtDateTime, fmtPhone } from "../lib/format";
import { Badge, Empty, ErrorNote, Spinner, useToast } from "../components/ui";

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
      const [s, people, camps, settings] = await Promise.all([
        supabase.from("shotgun").select("*, contact:contacts(first_name, last_name, phone_e164, suburb)").order("tried_at", { ascending: false }).limit(500).then(must),
        supabase.from("profiles").select("id, full_name").then(must),
        supabase.from("campaigns").select("id, name").then(must),
        supabase.from("settings").select("shotgun_months").eq("id", 1).single().then(must),
      ]);
      const pn = Object.fromEntries((people ?? []).map((p) => [p.id, p.full_name]));
      const cn = Object.fromEntries((camps ?? []).map((c) => [c.id, c.name]));
      setRows((s ?? []).map((r) => ({ ...r, holder: pn[r.holder_agent_id] ?? "Another agent", tried: pn[r.tried_agent_id] ?? "Another agent", holderCamp: cn[r.holder_campaign_id], triedCamp: cn[r.tried_campaign_id], resolver: pn[r.resolved_by] })));
      setMonths(settings?.shotgun_months ?? 3);
    } catch (e) { setError(e); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function resolve(r, action) {
    setBusy(r.id);
    const { error } = await supabase.rpc("resolve_shotgun", { p_id: r.id, p_action: action });
    setBusy("");
    if (error) return toast(error.message, "bad");
    toast(action === "keep" ? `Kept with ${r.holder}` : `Released to ${r.tried} and added to their campaign`);
    load();
  }
  const open = (rows ?? []).filter((r) => !r.outcome);
  const shown = tab === "open" ? open : (rows ?? []).filter((r) => r.outcome);
  const who = (c) => [c?.first_name, c?.last_name].filter(Boolean).join(" ") || "Unnamed contact";

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Company-wide</p>
          <h1>Shotgun list</h1>
          <p className="muted">When an agent uploads someone another agent messaged in the last {months} month{months === 1 ? "" : "s"}, that person is held for the first agent and listed here. {isAdmin ? "Keep them with the first agent, or release them to the agent who asked." : "An admin decides who keeps them."}</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "open"} className={`tab ${tab === "open" ? "active" : ""}`} onClick={() => setTab("open")}>Waiting <span className="tab-n">{open.length}</span></button>
        <button role="tab" aria-selected={tab === "done"} className={`tab ${tab === "done" ? "active" : ""}`} onClick={() => setTab("done")}>Resolved <span className="tab-n">{(rows?.length ?? 0) - open.length}</span></button>
      </div>
      <ErrorNote error={error} />
      {!rows && !error ? <Spinner /> : rows && shown.length === 0 ? (
        <div className="card"><Empty title={tab === "open" ? "Nobody waiting" : "Nothing resolved yet"}>{tab === "open" ? "No agent has tried to upload someone another agent is already talking to." : ""}</Empty></div>
      ) : rows && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Contact</th><th>Held by</th><th>Wanted by</th><th>{tab === "open" ? "Free from" : "Outcome"}</th>{isAdmin && tab === "open" && <th></th>}</tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td><div className="cell-title">{who(r.contact)}</div><div className="cell-sub mono">{r.contact ? fmtPhone(r.contact.phone_e164) : ""}{r.contact?.suburb ? ` · ${r.contact.suburb}` : ""}</div></td>
                  <td>{r.holder}<div className="cell-sub">{r.holderCamp ? `${r.holderCamp} · ` : ""}last messaged {fmtDate(r.last_contacted_at)}</div></td>
                  <td>{r.tried}<div className="cell-sub">{r.triedCamp ?? "—"} · {fmtDateTime(r.tried_at)}</div></td>
                  <td>{tab === "open" ? fmtDate(r.free_from) : <><Badge tone={r.outcome === "released" ? "brand" : "muted"}>{r.outcome === "released" ? `Released to ${r.tried}` : `Kept with ${r.holder}`}</Badge><div className="cell-sub">{r.resolver ?? ""} · {fmtDateTime(r.resolved_at)}</div></>}</td>
                  {isAdmin && tab === "open" && (
                    <td className="num"><div className="row" style={{ justifyContent: "flex-end" }}>
                      <button className="btn btn-sm" disabled={busy === r.id} onClick={() => resolve(r, "keep")}>Keep with {r.holder.split(" ")[0]}</button>
                      <button className="btn btn-sm btn-primary" disabled={busy === r.id} onClick={() => resolve(r, "release")}>Release to {r.tried.split(" ")[0]}</button>
                    </div></td>
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
