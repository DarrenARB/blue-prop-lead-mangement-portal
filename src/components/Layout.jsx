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

  // Which menu sections are collapsed: saved on the user's account so it follows them to every sign-in and device.
  const prefKey = `bp-nav-collapsed-${profile.id}`;
  const [collapsed, setCollapsed] = useState(() => {
    const fromAccount = profile.ui_prefs?.nav_collapsed;
    if (Array.isArray(fromAccount)) return fromAccount;
    try { return JSON.parse(localStorage.getItem(prefKey) ?? "[]"); } catch { return []; }
  });
  function toggleSection(key) {
    setCollapsed((cur) => {
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      try { localStorage.setItem(prefKey, JSON.stringify(next)); } catch { /* private mode */ }
      supabase.rpc("set_ui_pref", { p_key: "nav_collapsed", p_value: next }).then(() => {});
      return next;
    });
  }

  // Unread conversations and dates due, refreshed with the page
  const [unread, setUnread] = useState(0);
  const [due, setDue] = useState(0);
  const [pwHelp, setPwHelp] = useState(0);
  const [demoOn, setDemoOn] = useState(false);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("unread", true).eq("archived", false).then(({ count }) => alive && setUnread(count ?? 0));
      supabase.from("settings").select("demo_loaded_at").eq("id", 1).maybeSingle().then(({ data }) => alive && setDemoOn(!!data?.demo_loaded_at));
      if (isAdmin) supabase.from("password_help_requests").select("id", { count: "exact", head: true }).is("resolved_at", null).then(({ count }) => alive && setPwHelp(count ?? 0));
      if (profile.role !== "owner") supabase.from("key_dates").select("id", { count: "exact", head: true }).is("done_at", null).eq("yearly", false).eq("agent_id", profile.id).lte("due_on", today).then(({ count }) => alive && setDue(count ?? 0));
    };
    refresh();
    const t = setInterval(refresh, 30000); // new replies show up without reloading
    window.addEventListener("bp:counts-changed", refresh); // e.g. a conversation was just read
    return () => { alive = false; clearInterval(t); window.removeEventListener("bp:counts-changed", refresh); };
  }, [loc.pathname, profile.id, profile.role, isAdmin]);

  const sections = [
    { key: "main", items: [{ to: "/", label: "Home", icon: ICONS.home, show: true }] },
    { key: "work", title: "Work", items: [
      { to: "/campaigns", label: "Campaigns", icon: ICONS.send, show: true },
      { to: "/inbox", label: "Inbox", icon: ICONS.inbox, show: true, badge: unread ? { n: unread > 99 ? "99+" : unread, tone: "unread", label: `${unread} unread conversation${unread > 1 ? "s" : ""}` } : null },
      { to: "/hot", label: "Hot Leads", icon: ICONS.flame, show: true },
      { to: "/dates", label: "Dates", icon: ICONS.calendar, show: true, badge: due ? { n: due, tone: "warn", label: `${due} date${due > 1 ? "s" : ""} due or overdue` } : null },
    ] },
    { key: "lists", title: "Lists & rules", items: [
      { to: "/dnc", label: "Do Not Contact", icon: ICONS.block, show: true },
      { to: "/shotgun", label: "Shotgun list", icon: ICONS.shotgun, show: isAdmin || profile.role === "owner" },
      { to: "/rules", label: "Rules", icon: ICONS.sliders, show: isAdmin },
    ] },
    { key: "admin", title: "Admin", items: [
      { to: "/branches", label: "Branches", icon: ICONS.map, show: isAdmin },
      { to: "/team", label: "People", icon: ICONS.team, show: isAdmin, badge: pwHelp ? { n: pwHelp, tone: "warn", label: `${pwHelp} forgot-password request${pwHelp > 1 ? "s" : ""}` } : null },
      { to: "/lemlist", label: isAdmin ? "lemlist & numbers" : "WhatsApp numbers", icon: ICONS.phone, show: canSeeNumbers,
        badge: attention.bad || attention.phone ? { n: attention.bad + attention.phone, tone: attention.bad ? "bad" : "warn",
          label: [attention.bad && `${attention.bad} number${attention.bad > 1 ? "s" : ""} need attention`, attention.phone && `${attention.phone} phone number${attention.phone > 1 ? "s" : ""} needed`].filter(Boolean).join(", ") } : null },
      { to: "/plan", label: "Project plan", icon: ICONS.plan, show: isAdmin },
      { to: "/audit", label: "Audit log", icon: ICONS.audit, show: isAdmin },
    ] },
  ].map((sec) => ({ ...sec, items: sec.items.filter((i) => i.show) })).filter((sec) => sec.items.length);

  const isActivePath = (to) => (to === "/" ? loc.pathname === "/" : loc.pathname === to || loc.pathname.startsWith(to + "/"));
  const navItem = (l) => (
    <NavLink key={l.to} to={l.to} end={l.to === "/"} className={({ isActive }) => `nav ${isActive ? "active" : ""}`}>
      <Icon d={l.icon} />{l.label}
      {l.badge && <span className={`nav-badge nb-${l.badge.tone}`} title={l.badge.label} aria-label={l.badge.label}>{l.badge.n}</span>}
    </NavLink>
  );

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
        <nav className="side-nav">
          {sections.map((sec) => {
            if (!sec.title) return <div key={sec.key} className="nav-group">{sec.items.map(navItem)}</div>;
            const isOpen = !collapsed.includes(sec.key);
            const hidden = sec.items.filter((i) => i.badge);
            const total = hidden.reduce((n, i) => n + (parseInt(i.badge.n, 10) || 0), 0);
            const tone = hidden.some((i) => i.badge.tone === "bad") ? "bad" : hidden.some((i) => i.badge.tone === "unread") ? "unread" : hidden.some((i) => i.badge.tone === "warn") ? "warn" : "brand";
            // a collapsed section still shows the page you're on, so you never lose your place
            const visible = isOpen ? sec.items : sec.items.filter((i) => isActivePath(i.to));
            return (
              <div key={sec.key} className="nav-group">
                <button type="button" className="nav-section" aria-expanded={isOpen} aria-controls={`nav-${sec.key}`} onClick={() => toggleSection(sec.key)}>
                  <span>{sec.title}</span>
                  {!isOpen && total > 0 && <span className={`nav-badge nb-${tone}`} aria-label={hidden.map((i) => i.badge.label).join(", ")}>{total}</span>}
                  <svg className={`chev ${isOpen ? "open" : ""}`} viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                </button>
                <div id={`nav-${sec.key}`}>{visible.map(navItem)}</div>
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <div className="me">
            <div className="avatar" aria-hidden="true">{initials(profile.full_name)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="me-name">{profile.full_name}</div>
              <div className="me-role">{ROLE_LABEL[profile.role]}{isFinLink ? " · Fin-Link" : ""}</div>
            </div>
            <NavLink to="/password" className="foot-btn" title="Change password" aria-label="Change password"><Icon d={ICONS.key} /></NavLink>
            <button className="foot-btn" onClick={signOut} title="Sign out" aria-label="Sign out"><Icon d={ICONS.out} /></button>
          </div>
        </div>
      </aside>
      {open && <div className="modal-back" style={{ zIndex: 35, background: "rgba(12,15,36,.35)" }} onClick={() => setOpen(false)} />}
      <main className="main">
        {demoOn && <DemoBanner superAdmin={isFinLink} />}
        <Outlet />
      </main>
    </div>
  );
}

// Shown to everyone while demo data is loaded, so testers know what's made up.
function DemoBanner({ superAdmin }) {
  const [busy, setBusy] = useState(false);
  async function clear() {
    if (!window.confirm("Remove all demo data for everyone? Anything testers did with demo contacts goes with it. Real data isn’t touched.")) return;
    setBusy(true);
    const { error } = await supabase.rpc("clear_demo_data");
    setBusy(false);
    if (error) return window.alert(error.message);
    window.location.reload();
  }
  return (
    <div className="demo-banner" role="status">
      <span className="demo-pill">Demo</span>
      <span><strong>Demo data is loaded.</strong> Items marked [Demo] and numbers starting +27 00 are made up so you can try things out. Nothing is sent to anyone.</span>
      {superAdmin && <button className="btn btn-sm" disabled={busy} onClick={clear}>{busy ? "Removing…" : "Remove demo data"}</button>}
    </div>
  );
}
