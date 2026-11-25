import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { ROLE_LABEL, initials } from "../lib/format";
import { Icon, ICONS } from "./ui";

export default function Layout() {
  const { profile, isAdmin, isFinLink, canSeeNumbers, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  // Live count of numbers that need attention, shown as a badge on the menu so it's seen from any page.
  const [attention, setAttention] = useState({ bad: 0, phone: 0 });
  useEffect(() => {
    if (!canSeeNumbers) return;
    let alive = true;
    const check = () => supabase.rpc("list_whatsapp_numbers").then(({ data }) => {
      if (!alive || !data) return;
      const live = data.filter((n) => n.status !== "removed");
      setAttention({ bad: live.filter((n) => n.status !== "ok").length, phone: isAdmin ? live.filter((n) => !n.has_phone).length : 0 });
    });
    check();
    const t = setInterval(check, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [canSeeNumbers, isAdmin, loc.pathname]);

  // Unread conversations and dates due, refreshed with the page
  const [unread, setUnread] = useState(0);
  const [due, setDue] = useState(0);
  useEffect(() => {
    let alive = true;
    const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("unread", true).eq("archived", false).then(({ count }) => alive && setUnread(count ?? 0));
    if (profile.role !== "owner") supabase.from("key_dates").select("id", { count: "exact", head: true }).is("done_at", null).eq("yearly", false).eq("agent_id", profile.id).lte("due_on", today).then(({ count }) => alive && setDue(count ?? 0));
    return () => { alive = false; };
  }, [loc.pathname, profile.id, profile.role]);

  const links = [
    { to: "/", label: "Home", icon: ICONS.home, show: true },
    { section: "Work" },
    { to: "/campaigns", label: "Campaigns", icon: ICONS.send, show: true },
    { to: "/inbox", label: "Inbox", icon: ICONS.inbox, show: true, badge: unread ? { n: unread, tone: "brand", label: `${unread} unread conversation${unread > 1 ? "s" : ""}` } : null },
    { to: "/hot", label: "Hot Leads", icon: ICONS.flame, show: true },
    { to: "/dates", label: "Dates", icon: ICONS.calendar, show: true, badge: due ? { n: due, tone: "warn", label: `${due} date${due > 1 ? "s" : ""} due or overdue` } : null },
    { section: "Lists & rules" },
    { to: "/dnc", label: "Do Not Contact", icon: ICONS.block, show: true },
    { to: "/shotgun", label: "Shotgun list", icon: ICONS.shotgun, show: isAdmin || profile.role === "owner" },
    { to: "/rules", label: "Rules", icon: ICONS.sliders, show: isAdmin },
    { section: "Admin", show: isAdmin || canSeeNumbers },
    { to: "/branches", label: "Branches", icon: ICONS.map, show: isAdmin },
    { to: "/team", label: "People", icon: ICONS.team, show: isAdmin },
    { to: "/lemlist", label: isAdmin ? "lemlist & numbers" : "WhatsApp numbers", icon: ICONS.phone, show: canSeeNumbers,
      badge: attention.bad || attention.phone ? { n: attention.bad + attention.phone, tone: attention.bad ? "bad" : "warn",
        label: [attention.bad && `${attention.bad} number${attention.bad > 1 ? "s" : ""} need attention`, attention.phone && `${attention.phone} phone number${attention.phone > 1 ? "s" : ""} needed`].filter(Boolean).join(", ") } : null },
    { to: "/plan", label: "Project plan", icon: ICONS.plan, show: isAdmin },
    { to: "/audit", label: "Audit log", icon: ICONS.audit, show: isAdmin },
  ];

  return (
    <div className="shell">
      <div className="topbar">
        <button className="icon-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Icon d={ICONS.menu} /></button>
        <img src="./brand/blue-property-group-logo.png" alt="Blue Property Group" style={{ height: 30, borderRadius: 4 }} /><strong>Lead Portal</strong>
      </div>
      <aside className={`side ${open ? "open" : ""}`} aria-label="Main navigation">
        <div className="brand">
          <img className="brand-logo" src="./brand/blue-property-group-logo.png" alt="Blue Property Group" />
          <div className="brand-sub">WhatsApp Lead Portal</div>
        </div>
        {links.filter((l) => l.show !== false && (l.section || l.show)).map((l, i) => l.section ? <div key={`s${i}`} className="nav-section">{l.section}</div> : (
          <NavLink key={l.to} to={l.to} end={l.to === "/"} className={({ isActive }) => `nav ${isActive ? "active" : ""}`}>
            <Icon d={l.icon} />{l.label}
            {l.badge && <span className={`nav-badge nb-${l.badge.tone}`} title={l.badge.label} aria-label={l.badge.label}>{l.badge.n}</span>}
          </NavLink>
        ))}
        <div className="side-foot">
          <div className="me">
            <div className="avatar" aria-hidden="true">{initials(profile.full_name)}</div>
            <div>
              <div className="me-name">{profile.full_name}</div>
              <div className="me-role">{ROLE_LABEL[profile.role]}{isFinLink ? " · Fin-Link" : ""}</div>
            </div>
          </div>
          <NavLink to="/password" className={({ isActive }) => `nav ${isActive ? "active" : ""}`}><Icon d={ICONS.key} />Change password</NavLink>
          <button className="nav nav-btn" onClick={signOut}><Icon d={ICONS.out} />Sign out</button>
        </div>
      </aside>
      {open && <div className="modal-back" style={{ zIndex: 35, background: "rgba(12,15,36,.35)" }} onClick={() => setOpen(false)} />}
      <main className="main"><Outlet /></main>
    </div>
  );
}
