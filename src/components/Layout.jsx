import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { ROLE_LABEL, initials } from "../lib/format";
import { Icon, ICONS } from "./ui";

export default function Layout() {
  const { profile, isAdmin, isFinLink, canSeeNumbers, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  const links = [
    { to: "/", label: "Home", icon: ICONS.home, show: true },
    { to: "/team", label: "Branches & people", icon: ICONS.team, show: isAdmin },
    { to: "/lemlist", label: isAdmin ? "lemlist & numbers" : "WhatsApp numbers", icon: ICONS.phone, show: canSeeNumbers },
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
