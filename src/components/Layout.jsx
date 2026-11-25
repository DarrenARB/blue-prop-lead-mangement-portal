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

  const links = [
    { to: "/", label: "Home", icon: ICONS.home, show: true },
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
        <strong>Blue PROP Portal</strong>
      </div>
      <aside className={`side ${open ? "open" : ""}`} aria-label="Main navigation">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">BP</div>
          <div>
            <div className="brand-name">Blue PROP</div>
            <div className="brand-sub">WhatsApp Lead Portal</div>
          </div>
        </div>
        {links.filter((l) => l.show).map((l) => (
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
