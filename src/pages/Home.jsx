import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { must, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { NUMBER_STATUS, ROLE_LABEL, ago, fmtPhone, fmtR } from "../lib/format";
import { Badge, Icon, ICONS, Spinner } from "../components/ui";

const COMING = {
  agent: ["Start a campaign from a 5-step wizard", "Your WhatsApp inbox, with every reply scored by AI", "Hot leads you can export to Excel for the CRM", "Follow-ups and key dates"],
  owner: ["Dashboard for your branches", "Each agent’s numbers side by side", "Your branches’ campaigns, hot leads and follow-ups"],
  admin: ["Company-wide dashboard", "Every campaign across all branches", "Do Not Contact list, Shotgun list and rules"],
  support: ["Email and WhatsApp alerts when a number disconnects"],
};

export default function Home() {
  const { profile, isAdmin, canSeeNumbers } = useAuth();
  const [d, setD] = useState(null);

  useEffect(() => {
    (async () => {
      const out = {};
      const nums = (await supabase.rpc("list_whatsapp_numbers").then(must)) ?? [];
      out.myNumber = nums.find((x) => x.agent_id === profile.id) ?? null;
      if (canSeeNumbers) out.numbers = nums.filter((x) => x.status !== "removed");
      if (isAdmin) {
        out.people = await supabase.from("profiles").select("role, status").eq("status", "active").then(must);
        out.branches = await supabase.from("branches").select("id").is("archived_at", null).then(must);
        out.plan = await supabase.from("plan_items").select("price, status").then(must);
      }
      if (profile.role === "agent" && profile.branch_id) {
        out.branch = await supabase.from("branches").select("name").eq("id", profile.branch_id).maybeSingle().then(must);
      }
      setD(out);
    })().catch(() => setD({}));
  }, [profile, isAdmin, canSeeNumbers]);

  if (!d) return <Spinner />;
  const first = profile.full_name.split(" ")[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const n = d.myNumber;
  const bad = n && n.status !== "ok";

  const planTotal = d.plan?.reduce((s, i) => s + Number(i.price), 0) ?? 0;
  const planDone = d.plan?.filter((i) => i.status === "built" || i.status === "signed_off").reduce((s, i) => s + Number(i.price), 0) ?? 0;

  return (
    <>
      {profile.role === "agent" && bad && (
        <div className="banner" role="alert">
          <Icon d={ICONS.alert} />
          <div>
            <strong>Your WhatsApp number is {NUMBER_STATUS[n.status]?.[0].toLowerCase()}.</strong>
            <div className="small">Campaigns can’t send from it until it’s fixed. Fin-Link Support can see this too and will help you re-scan the QR code with your phone.</div>
          </div>
        </div>
      )}
      <div className="page-head">
        <div>
          <p className="eyebrow">{ROLE_LABEL[profile.role]}{d.branch ? ` · ${d.branch.name}` : ""}</p>
          <h1>{greet}, {first}</h1>
          <p className="muted">The portal is being built in stages. Here’s what’s live for you today.</p>
        </div>
      </div>

      <div className="grid g3">
        {profile.role === "agent" && (
          <div className="kpi">
            <div className="kpi-label">Your WhatsApp number</div>
            {n ? (
              <>
                <div className="kpi-value" style={{ fontSize: 22 }}>{n.has_phone ? fmtPhone(n.phone_e164) : n.profile_label}</div>
                <div style={{ marginTop: 6 }}><Badge tone={NUMBER_STATUS[n.status]?.[1]}>{NUMBER_STATUS[n.status]?.[0]}</Badge></div>
                <div className="kpi-sub" style={{ marginTop: 6 }}>Checked {ago(n.last_checked_at)}</div>
              </>
            ) : <div className="kpi-sub" style={{ marginTop: 6 }}>No number linked yet. Ask your Main Admin to link one.</div>}
          </div>
        )}
        {canSeeNumbers && d.numbers && (
          <Link to="/lemlist" className="kpi" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="kpi-label">WhatsApp numbers</div>
            <div className="kpi-value">{d.numbers.filter((x) => x.status === "ok").length}<span className="muted" style={{ fontSize: 16, fontWeight: 400 }}> of {d.numbers.length} sending</span></div>
            <div className="kpi-sub">{d.numbers.filter((x) => x.status !== "ok").length ? `${d.numbers.filter((x) => x.status !== "ok").length} need attention` : "All healthy"} · {d.numbers.filter((x) => !x.agent_id).length} not linked</div>
            {d.numbers.some((x) => !x.has_phone) && <div className="kpi-sub" style={{ color: "var(--bad)", fontWeight: 500, marginTop: 4 }}>{d.numbers.filter((x) => !x.has_phone).length} phone number{d.numbers.filter((x) => !x.has_phone).length > 1 ? "s" : ""} needed →</div>}
          </Link>
        )}
        {isAdmin && d.people && (
          <Link to="/team" className="kpi" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="kpi-label">People</div>
            <div className="kpi-value">{d.people.length}</div>
            <div className="kpi-sub">{d.people.filter((p) => p.role === "agent").length} agents · {d.branches.length} branch{d.branches.length === 1 ? "" : "es"}</div>
          </Link>
        )}
        {isAdmin && d.plan && (
          <Link to="/plan" className="kpi" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="kpi-label">Build progress</div>
            <div className="kpi-value">{planTotal ? Math.round((planDone / planTotal) * 100) : 0}%</div>
            <div className="bar" style={{ marginTop: 8 }}><span className="s-signed" style={{ width: `${planTotal ? (planDone / planTotal) * 100 : 0}%` }} /></div>
            <div className="kpi-sub" style={{ marginTop: 6 }}>{fmtR(planDone)} of {fmtR(planTotal)} delivered</div>
          </Link>
        )}
      </div>

      <section className="card" style={{ marginTop: 18 }}>
        <h2>Coming next for you</h2>
        <ul style={{ margin: "10px 0 0", paddingLeft: 20, color: "var(--muted)" }}>
          {(COMING[profile.role] ?? []).map((c) => <li key={c} style={{ padding: "3px 0" }}>{c}</li>)}
        </ul>
      </section>
    </>
  );
}
