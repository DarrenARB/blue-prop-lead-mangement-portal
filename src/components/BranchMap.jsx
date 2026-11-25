import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { SA_BOUNDS, TILE_ATTRIBUTION, TILE_URL, colorHex, markerHtml } from "../lib/branchStyle";

const pinIcon = (b, selected) =>
  L.divIcon({ className: "bm-icon", html: markerHtml(b.icon, b.color, { selected, label: b.name }), iconSize: [40, 48], iconAnchor: [20, 46], popupAnchor: [0, -44] });

// Overview map: every branch as an icon pin with a coverage circle. Click a pin to select it.
export default function BranchMap({ branches, selectedId, onSelect, height = 520 }) {
  const box = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const markers = useRef({});
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  // create the map once
  useEffect(() => {
    const m = L.map(box.current, { zoomControl: true, scrollWheelZoom: false, attributionControl: true });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, subdomains: "abcd", maxZoom: 19 }).addTo(m);
    m.fitBounds(SA_BOUNDS);
    m.on("focus", () => m.scrollWheelZoom.enable());
    m.on("blur", () => m.scrollWheelZoom.disable());
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(box.current);
    return () => { ro.disconnect(); m.remove(); };
  }, []);

  // redraw pins + circles when branches change
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    layer.current.clearLayers();
    markers.current = {};
    const placed = branches.filter((b) => b.lat != null && b.lng != null && !b.archived_at);
    for (const b of placed) {
      const hex = colorHex(b.color);
      L.circle([b.lat, b.lng], { radius: (b.radius_km || 10) * 1000, color: hex, weight: 1, opacity: 0.5, fillColor: hex, fillOpacity: 0.1, interactive: false }).addTo(layer.current);
      const mk = L.marker([b.lat, b.lng], { icon: pinIcon(b, b.id === selectedId), title: b.name, alt: b.name, keyboard: true, riseOnHover: true })
        .addTo(layer.current)
        .bindTooltip(b.name, { direction: "top", offset: [0, -44] })
        .on("click", () => selectRef.current?.(b.id));
      markers.current[b.id] = mk;
    }
    if (placed.length === 1) m.setView([placed[0].lat, placed[0].lng], 10);
    else if (placed.length > 1) m.fitBounds(L.latLngBounds(placed.map((b) => [b.lat, b.lng])).pad(0.35), { maxZoom: 11 });
    else m.fitBounds(SA_BOUNDS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches]);

  // highlight + fly to the selected branch
  useEffect(() => {
    for (const [id, mk] of Object.entries(markers.current)) {
      const b = branches.find((x) => x.id === id);
      if (b) mk.setIcon(pinIcon(b, id === selectedId));
    }
    const b = branches.find((x) => x.id === selectedId);
    if (b?.lat != null && map.current) map.current.flyTo([b.lat, b.lng], Math.max(map.current.getZoom(), 11), { duration: 0.6 });
  }, [selectedId, branches]);

  return <div ref={box} className="branch-map" style={{ height }} role="application" aria-label="Map of Blue PROP branches" />;
}
