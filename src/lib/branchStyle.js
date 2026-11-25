// Branch icons, colours, map tiles and geocoding helpers.

export const BRANCH_ICONS = {
  office: { label: "Office", d: "M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3" },
  home: { label: "Home", d: "M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6" },
  keys: { label: "Keys", d: "M15 7a4 4 0 1 1-3.9 4.9L3 20v-3l2-2h2v-2h2l1.1-1.1A4 4 0 0 1 15 7zM16 9.5h.01" },
  tower: { label: "Tower", d: "M8 21V3h8v18M5 21h14M11 7h2M11 11h2M11 15h2" },
  coastal: { label: "Coastal", d: "M2 19c2 0 2-1.5 4-1.5S8 19 10 19s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M12 15V7M12 7C10 5 7 5 5 7M12 7c2-2 5-2 7 0M12 7c-.5-2-2-3.5-4-4" },
  mountain: { label: "Mountain", d: "M3 20l6-10 4 6 3-4 5 8zM9 10l1.5 2.5" },
  garden: { label: "Garden", d: "M12 3l6 9h-3l4 6H5l4-6H6zM12 18v3" },
  star: { label: "Star", d: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" },
};

export const BRANCH_COLORS = {
  blue: { label: "Blue", hex: "#1B489B" },
  teal: { label: "Teal", hex: "#0E7C86" },
  green: { label: "Green", hex: "#2F7D32" },
  orange: { label: "Orange", hex: "#C2570C" },
  rose: { label: "Rose", hex: "#B4235A" },
  violet: { label: "Violet", hex: "#6B3FA0" },
};

export const PROVINCES = [
  "Gauteng", "Western Cape", "KwaZulu-Natal", "Eastern Cape", "Free State",
  "Limpopo", "Mpumalanga", "North West", "Northern Cape",
];

export const SA_BOUNDS = [[-35.2, 16.2], [-21.9, 33.2]];

export const TILE_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

export const colorHex = (c) => (BRANCH_COLORS[c] ?? BRANCH_COLORS.blue).hex;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

// HTML for a Leaflet divIcon: a coloured pin with the branch icon inside.
export function markerHtml(icon, color, { selected = false, label = "" } = {}) {
  const hex = colorHex(color);
  const d = (BRANCH_ICONS[icon] ?? BRANCH_ICONS.office).d;
  return `<div class="bm-pin${selected ? " bm-sel" : ""}" style="--pin:${hex}" aria-label="${esc(label)}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg></div>`;
}

// OpenStreetMap Nominatim (free, ~1 request/second). Limited to South Africa.
const NOMINATIM = "https://nominatim.openstreetmap.org";

function pick(addr) {
  return {
    suburb: addr.suburb || addr.neighbourhood || addr.quarter || addr.village || addr.town || null,
    city: addr.city || addr.town || addr.municipality || addr.county || null,
    province: normaliseProvince(addr.state || addr.province || null),
  };
}

export function normaliseProvince(p) {
  if (!p) return null;
  const s = p.toLowerCase().replace(/[^a-z]/g, "");
  return PROVINCES.find((x) => x.toLowerCase().replace(/[^a-z]/g, "") === s) ?? p;
}

export async function searchAddress(q, signal) {
  const url = `${NOMINATIM}/search?format=jsonv2&addressdetails=1&countrycodes=za&limit=6&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal, headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new Error("Address search is busy. Try again in a moment.");
  const rows = await res.json();
  return rows.map((r) => ({
    label: r.display_name.replace(/, South Africa$/, ""),
    lat: Number(r.lat),
    lng: Number(r.lon),
    ...pick(r.address ?? {}),
  }));
}

export async function reverseLookup(lat, lng, signal) {
  const url = `${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&zoom=16&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, { signal, headers: { "Accept-Language": "en" } });
  if (!res.ok) return null;
  const r = await res.json();
  if (!r || r.error) return null;
  return { label: (r.display_name ?? "").replace(/, South Africa$/, ""), ...pick(r.address ?? {}) };
}
