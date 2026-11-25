import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { SA_BOUNDS, TILE_ATTRIBUTION, TILE_URL, colorHex, markerHtml, reverseLookup, searchAddress } from "../lib/branchStyle";

// Address search (South Africa only) + a map where the pin can be dropped or dragged to the exact spot.
// value: { address, lat, lng, suburb, city, province }
export default function LocationPicker({ value, onChange, icon, color, radiusKm }) {
  const [query, setQuery] = useState(value.address ?? "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const box = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const circle = useRef(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const skipSearch = useRef(true);

  const icn = () => L.divIcon({ className: "bm-icon", html: markerHtml(icon, color, { selected: true, label: "Branch location" }), iconSize: [40, 48], iconAnchor: [20, 46] });

  // place / move the pin (and update suburb, city, province from the map)
  const placeAt = async (lat, lng, fromSearch) => {
    changeRef.current({ ...valueRef.current, lat, lng, ...(fromSearch ?? {}) });
    if (fromSearch) return;
    try {
      const r = await reverseLookup(lat, lng);
      if (r) changeRef.current({ ...valueRef.current, lat, lng, suburb: r.suburb ?? valueRef.current.suburb, city: r.city ?? valueRef.current.city, province: r.province ?? valueRef.current.province, address: valueRef.current.address || r.label });
      if (r && !valueRef.current.address) { skipSearch.current = true; setQuery(r.label); }
    } catch { /* offline: keep the pin */ }
  };

  // map setup
  useEffect(() => {
    const m = L.map(box.current, { scrollWheelZoom: false });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, subdomains: "abcd", maxZoom: 19 }).addTo(m);
    if (valueRef.current.lat != null) m.setView([valueRef.current.lat, valueRef.current.lng], 15);
    else m.fitBounds(SA_BOUNDS);
    m.on("click", (e) => placeAt(e.latlng.lat, e.latlng.lng));
    m.on("focus", () => m.scrollWheelZoom.enable());
    m.on("blur", () => m.scrollWheelZoom.disable());
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(box.current);
    return () => { ro.disconnect(); m.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep pin + coverage circle in sync with the value, icon, colour and radius
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const { lat, lng } = value;
    if (lat == null || lng == null) {
      marker.current?.remove(); circle.current?.remove(); marker.current = circle.current = null;
      return;
    }
    const hex = colorHex(color);
    if (!marker.current) {
      marker.current = L.marker([lat, lng], { draggable: true, icon: icn(), keyboard: true, title: "Drag to the exact spot" }).addTo(m);
      marker.current.on("dragend", (e) => { const p = e.target.getLatLng(); placeAt(p.lat, p.lng); });
    } else {
      marker.current.setLatLng([lat, lng]);
      marker.current.setIcon(icn());
    }
    if (!circle.current) circle.current = L.circle([lat, lng], { radius: radiusKm * 1000, color: hex, weight: 1, fillColor: hex, fillOpacity: 0.1, interactive: false }).addTo(m);
    else { circle.current.setLatLng([lat, lng]); circle.current.setRadius(radiusKm * 1000); circle.current.setStyle({ color: hex, fillColor: hex }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.lat, value.lng, icon, color, radiusKm]);

  // debounced address search (Nominatim asks for at most ~1 request a second)
  useEffect(() => {
    if (skipSearch.current) { skipSearch.current = false; return; }
    const q = query.trim();
    if (q.length < 3) { setResults([]); setOpen(false); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true); setErr(null);
      try {
        const r = await searchAddress(q, ctrl.signal);
        setResults(r); setOpen(true); setActive(r.length ? 0 : -1);
      } catch (e) { if (e.name !== "AbortError") setErr(e.message); }
      finally { setBusy(false); }
    }, 650);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query]);

  function choose(r) {
    skipSearch.current = true;
    setQuery(r.label);
    setOpen(false); setResults([]);
    placeAt(r.lat, r.lng, { address: r.label, suburb: r.suburb, city: r.city ?? valueRef.current.city, province: r.province ?? valueRef.current.province });
    map.current?.flyTo([r.lat, r.lng], 16, { duration: 0.6 });
  }

  function onKey(e) {
    if (!open || !results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % results.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + results.length) % results.length); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); choose(results[active]); }
    else if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="field">
        <label htmlFor="loc-q">Branch address</label>
        <div className="ac">
          <input
            id="loc-q" className="input" autoComplete="off" placeholder="Start typing the street address, e.g. 12 Jan Smuts Ave, Ferndale"
            value={query}
            onChange={(e) => { setQuery(e.target.value); changeRef.current({ ...valueRef.current, address: e.target.value }); }}
            onKeyDown={onKey}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            role="combobox" aria-expanded={open} aria-controls="loc-list" aria-autocomplete="list"
            aria-activedescendant={open && active >= 0 ? `loc-opt-${active}` : undefined}
          />
          {busy && <span className="ac-busy" aria-hidden="true" />}
          {open && (
            <ul id="loc-list" className="ac-list" role="listbox">
              {results.length === 0 && <li className="ac-empty">No matches in South Africa. Try the street and suburb, or drop the pin on the map.</li>}
              {results.map((r, i) => (
                <li key={`${r.lat},${r.lng},${i}`} id={`loc-opt-${i}`} role="option" aria-selected={i === active}
                  className={i === active ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); choose(r); }} onMouseEnter={() => setActive(i)}>
                  <svg viewBox="0 0 24 24" className="ic ic-s" aria-hidden="true"><path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>
                  <span>{r.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {err ? <p className="hint" style={{ color: "var(--bad)" }}>{err}</p>
          : <p className="hint">Pick a suggestion, then drag the pin to the exact spot. You can also click anywhere on the map to drop it.</p>}
      </div>
      <div ref={box} className="branch-map picker-map" role="application" aria-label="Choose the branch location on the map" />
      <p className="small muted">
        {value.lat != null
          ? <>Pinned{value.suburb || value.city ? ` near ${[value.suburb, value.city].filter(Boolean).join(", ")}` : ""}{value.province ? ` · ${value.province}` : ""} · <span className="mono">{value.lat.toFixed(5)}, {value.lng.toFixed(5)}</span></>
          : "No location yet."}
      </p>
    </div>
  );
}
