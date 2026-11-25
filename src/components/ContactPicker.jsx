import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { fmtPhone } from "../lib/format";

// Type a name, number, email or suburb and pick the exact person from the people you're talking to.
// Agents see their own leads and conversations; admins see everyone.
export default function ContactPicker({ id = "cp", value, onChange, autoFocus }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setItems([]); return; }
    const my = ++seq.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      const { data } = await supabase.rpc("search_contacts", { p_q: t, p_limit: 12 });
      if (my !== seq.current) return;
      setBusy(false);
      setItems(data ?? []); setActive(0); setOpen(true);
    }, 220);
    return () => clearTimeout(timer);
  }, [q]);

  const name = (c) => [c.first_name, c.last_name].filter(Boolean).join(" ") || "No name";
  function choose(c) {
    if (c.on_dnc) return;
    onChange(c); setOpen(false); setQ("");
  }
  function onKey(e) {
    if (!open || !items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + items.length) % items.length); }
    else if (e.key === "Enter") { e.preventDefault(); choose(items[active]); }
    else if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
  }

  if (value) {
    return (
      <div className="picked">
        <div>
          <div className="cell-title">{name(value)}</div>
          <div className="cell-sub">{[fmtPhone(value.phone_e164), value.email, value.suburb].filter(Boolean).join(" · ")}</div>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => onChange(null)}>Change</button>
      </div>
    );
  }

  return (
    <div className="ac">
      <input id={id} className="input" autoComplete="off" autoFocus={autoFocus} value={q}
        placeholder="Start typing a name, number, email or suburb"
        onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} onFocus={() => items.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? `${id}-opt-${active}` : undefined} />
      {busy && <span className="ac-busy" aria-hidden="true" />}
      {open && (
        <ul id={`${id}-list`} className="ac-list" role="listbox">
          {items.length === 0 && <li className="ac-empty">Nobody matches. Check the spelling, or enter the number by hand below.</li>}
          {items.map((c, i) => (
            <li key={c.id} id={`${id}-opt-${i}`} role="option" aria-selected={i === active} aria-disabled={c.on_dnc}
              className={`${i === active ? "on" : ""} ${c.on_dnc ? "dim" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); choose(c); }} onMouseEnter={() => setActive(i)}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="cell-title">{name(c)}</span>
                <span className="cell-sub" style={{ display: "block" }}>{[fmtPhone(c.phone_e164), c.email, c.suburb].filter(Boolean).join(" · ")}</span>
              </span>
              {c.on_dnc && <span className="badge b-muted">Already on the list</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
