import { useCallback, useEffect, useMemo, useState } from "react";
import { must, supabase } from "../lib/supabase";
import { BRANCH_COLORS, BRANCH_ICONS, PROVINCES, colorHex } from "../lib/branchStyle";
import BranchMap from "../components/BranchMap";
import LocationPicker from "../components/LocationPicker";
import { Badge, Empty, ErrorNote, Field, Icon, ICONS, Modal, Spinner, useToast } from "../components/ui";

export function BranchGlyph({ icon, color, size = 40 }) {
  const d = (BRANCH_ICONS[icon] ?? BRANCH_ICONS.office).d;
  return (
    <span className="glyph" style={{ "--pin": colorHex(color), width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d={d} /></svg>
    </span>
  );
}

export default function Branches() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [modal, setModal] = useState(null); // branch or {} for new
  const [province, setProvince] = useState(null); // province filter

  const load = useCallback(async () => {
    try {
      const [branches, people, owners] = await Promise.all([
        supabase.from("branches").select("*").order("name").then(must),
        supabase.from("profiles").select("id, full_name, role, status, branch_id").then(must),
        supabase.from("branch_owners").select("*").then(must),
      ]);
      setData({ branches, people, owners });
    } catch (e) { setError(e); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const active = useMemo(() => (data?.branches ?? []).filter((b) => !b.archived_at), [data]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;

  const inProv = (b) => !province || b.province === province;
  const shown = (showArchived ? data.branches : active).filter(inProv);
  const onMap = active.filter(inProv);
  const countIn = (p) => active.filter((b) => b.province === p).length;
  const covered = new Set(active.map((b) => b.province).filter(Boolean));
  const unplaced = active.filter((b) => b.lat == null);
  const agentsIn = (id) => data.people.filter((p) => p.role === "agent" && p.status === "active" && p.branch_id === id).length;
  const ownersOf = (id) => data.owners.filter((o) => o.branch_id === id).map((o) => data.people.find((p) => p.id === o.owner_id)?.full_name).filter(Boolean);

  async function toggleArchive(b) {
    const { error } = await supabase.from("branches").update({ archived_at: b.archived_at ? null : new Date().toISOString() }).eq("id", b.id);
    if (error) return toast(error.message, "bad");
    toast(b.archived_at ? `${b.name} restored` : `${b.name} archived`);
    load();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Main Admin</p>
          <h1>{active.length ? `${active.length} branch${active.length === 1 ? "" : "es"} across ${covered.size} province${covered.size === 1 ? "" : "s"}` : "Branches"}</h1>
          <p className="muted">Each office on the map, with the area it covers. Archiving a branch keeps its campaigns and history.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal(province ? { province } : {})}><Icon d={ICONS.plus} />Add branch</button>
      </div>

      <section className="card map-card">
        <div className="map-grid">
          <div className="map-wrap">
            <BranchMap branches={onMap} selectedId={selected} onSelect={setSelected} />
            <div className="prov-strip" role="group" aria-label="Filter by province">
              {PROVINCES.map((p) => {
                const n = countIn(p);
                return (
                  <button key={p} type="button" className={`prov ${n ? "has" : ""} ${province === p ? "on" : ""}`} aria-pressed={province === p}
                    onClick={() => { setProvince(province === p ? null : p); setSelected(null); }}
                    title={n ? `Show only ${p} (${n})` : `No branches in ${p} yet`}>
                    {n > 0 && <svg viewBox="0 0 24 24" className="ic ic-s" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>}
                    {p}{n > 0 && <span className="prov-n">{n}</span>}
                  </button>
                );
              })}
              {province && <button type="button" className="btn-link small" onClick={() => setProvince(null)}>Show all provinces</button>}
            </div>
          </div>

          <div className="branch-list">
            <div className="row spread" style={{ padding: "2px 2px 10px" }}>
              <h2>{province ? `Branches in ${province}` : "Branches"}</h2>
              {data.branches.length > active.length && (
                <label className="check small"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label>
              )}
            </div>
            {active.some((b) => !b.province) && <div className="note note-warn small" style={{ marginBottom: 10 }}>{active.filter((b) => !b.province).length} branch{active.filter((b) => !b.province).length > 1 ? "es have" : " has"} no province, so {active.filter((b) => !b.province).length > 1 ? "they don’t" : "it doesn’t"} show under any province filter. Edit to set it.</div>}
            {unplaced.length > 0 && <div className="note note-warn small" style={{ marginBottom: 10 }}>{unplaced.length} branch{unplaced.length > 1 ? "es aren’t" : " isn’t"} on the map yet. Edit {unplaced.length > 1 ? "them" : "it"} to add the address.</div>}
            {shown.length === 0 ? (
              province
                ? <Empty title={`No branches in ${province} yet`} action={<button className="btn" onClick={() => setProvince(null)}>Show all provinces</button>} />
                : <Empty title="No branches yet" action={<button className="btn btn-primary" onClick={() => setModal({})}>Add the first branch</button>}>
                    Add Blue PROP’s offices to see how they cover South Africa.
                  </Empty>
            ) : (
              <ul className="bcards">
                {shown.map((b) => (
                  <li key={b.id}>
                    <div className={`bcard ${selected === b.id ? "on" : ""} ${b.archived_at ? "dim" : ""}`}>
                      <button className="bcard-main" onClick={() => setSelected(b.id)} aria-pressed={selected === b.id} disabled={b.lat == null || !!b.archived_at}>
                        <BranchGlyph icon={b.icon} color={b.color} />
                        <span className="bcard-text">
                          <span className="cell-title">{b.name}</span>
                          <span className="cell-sub">{[b.suburb, b.city].filter(Boolean).join(", ") || (b.lat == null ? "No location yet" : "Location set")}{b.province ? ` · ${b.province}` : ""}</span>
                          <span className="cell-sub">{agentsIn(b.id)} agent{agentsIn(b.id) === 1 ? "" : "s"} · {ownersOf(b.id).join(", ") || "No Branch Owner"} · {b.radius_km} km area</span>
                        </span>
                      </button>
                      <div className="bcard-actions">
                        {b.archived_at ? <Badge>Archived</Badge> : b.lat == null ? <Badge tone="warn">Not on map</Badge> : !b.province ? <Badge tone="warn">No province</Badge> : null}
                        {!b.archived_at && <button className="btn btn-sm" onClick={() => setModal(b)}>Edit</button>}
                        <button className="btn btn-sm" onClick={() => toggleArchive(b)}>{b.archived_at ? "Restore" : "Archive"}</button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {modal && <BranchModal branch={modal} onClose={() => setModal(null)} onSaved={(id, isNew) => { setModal(null); load().then(() => setSelected(id)); toast(isNew ? "Branch added" : "Branch saved"); }} />}
    </>
  );
}

function BranchModal({ branch, onClose, onSaved }) {
  const isNew = !branch.id;
  const [name, setName] = useState(branch.name ?? "");
  const [icon, setIcon] = useState(branch.icon ?? "office");
  const [color, setColor] = useState(branch.color ?? "blue");
  const [radius, setRadius] = useState(branch.radius_km ?? 10);
  const [loc, setLoc] = useState({
    address: branch.address ?? "", lat: branch.lat ?? null, lng: branch.lng ?? null,
    suburb: branch.suburb ?? null, city: branch.city ?? null, province: branch.province ?? null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Give the branch a name.");
    if (!loc.province) return setError("Choose the branch’s province.");
    setBusy(true);
    const row = {
      name: name.trim(), icon, color, radius_km: Math.max(2, Math.min(100, Math.round(Number(radius)) || 10)),
      address: loc.address?.trim() || null, lat: loc.lat, lng: loc.lng,
      suburb: loc.suburb, city: loc.city, province: loc.province,
    };
    const q = isNew ? supabase.from("branches").insert(row).select("id").single() : supabase.from("branches").update(row).eq("id", branch.id).select("id").single();
    const { data, error } = await q;
    setBusy(false);
    if (error) return setError(error.code === "23505" ? "A branch with that name already exists." : error.message);
    onSaved(data.id, isNew);
  }

  return (
    <Modal wide title={isNew ? "Add a branch" : `Edit ${branch.name}`} sub="Name it, find it on the map and give it an icon." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="branch-form" disabled={busy}>{busy ? "Saving…" : isNew ? "Add branch" : "Save branch"}</button></>}>
      <form id="branch-form" className="stack" onSubmit={submit}>
        <Field label="Branch name" id="b-name"><input id="b-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ferndale" required /></Field>

        <LocationPicker value={loc} onChange={setLoc} icon={icon} color={color} radiusKm={Math.max(2, Math.min(100, Number(radius) || 10))}>
          <Field label="Town or city" id="b-city" hint="Shown on the branch card.">
            <input id="b-city" className="input" value={loc.city ?? ""} onChange={(e) => setLoc({ ...loc, city: e.target.value || null })} placeholder="Randburg" />
          </Field>
          <Field label="Province (required)" id="b-prov" hint={loc.province && loc.lat != null ? "Filled in from the address. Change it if it’s wrong." : "Filled in automatically when you pick an address or drop the pin."}>
            <select id="b-prov" className="select" value={PROVINCES.includes(loc.province) ? loc.province : ""} onChange={(e) => setLoc({ ...loc, province: e.target.value || null })} required>
              <option value="">Choose a province…</option>
              {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </LocationPicker>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 500, fontSize: 13.5, marginBottom: 6 }}>Icon</legend>
          <div className="pick-grid">
            {Object.entries(BRANCH_ICONS).map(([k, v]) => (
              <label key={k} className={`pick ${icon === k ? "on" : ""}`}>
                <input type="radio" name="b-icon" value={k} checked={icon === k} onChange={() => setIcon(k)} />
                <BranchGlyph icon={k} color={color} size={36} />
                <span className="small">{v.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 500, fontSize: 13.5, marginBottom: 6 }}>Colour</legend>
          <div className="row" style={{ gap: 8 }}>
            {Object.entries(BRANCH_COLORS).map(([k, v]) => (
              <label key={k} className={`swatch ${color === k ? "on" : ""}`}>
                <input type="radio" name="b-color" value={k} checked={color === k} onChange={() => setColor(k)} />
                <span className="sw" style={{ background: v.hex }}>{color === k && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>}</span>
                <span className="small">{v.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Area it covers around the branch" id="b-radius" hint="Shown as a circle on the map, so you can see where branches overlap and where there are gaps.">
          <span className="row" style={{ gap: 8 }}><input id="b-radius" className="input" type="number" inputMode="numeric" min="2" max="100" step="1" value={radius} onChange={(e) => setRadius(e.target.value)} style={{ width: 100 }} /><span className="muted">km</span></span>
        </Field>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
