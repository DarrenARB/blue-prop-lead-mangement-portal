import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

// "Show: All agents / one agent" for admins and Branch Owners. Agents only ever see their own, so it's hidden for them.
// The choice is kept for the session so it follows you between Inbox, Hot Leads, Campaigns and Dates.
const KEY = "bp-agent-filter";
export function useAgentFilter() {
  const [agent, setAgent] = useState(() => { try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; } });
  const set = (v) => { setAgent(v); try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch { /* private mode */ } };
  return [agent, set];
}

export default function AgentFilter({ value, onChange }) {
  const { profile } = useAuth();
  const [agents, setAgents] = useState([]);
  useEffect(() => {
    if (profile.role === "agent") return;
    supabase.from("profiles").select("id, full_name").eq("role", "agent").order("full_name").then(({ data }) => setAgents(data ?? []));
  }, [profile.role]);
  if (profile.role === "agent" || agents.length < 2) return null;
  return (
    <label className="agent-filter">
      <span className="muted small">Show</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Show one agent">
        <option value="">All agents</option>
        {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
      </select>
    </label>
  );
}
