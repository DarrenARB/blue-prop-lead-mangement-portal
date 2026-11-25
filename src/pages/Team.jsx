import { useCallback, useEffect, useMemo, useState } from "react";
import { callFn, must, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { NUMBER_STATUS, ROLE_LABEL, fmtPhone } from "../lib/format";
import { Badge, CopyButton, Empty, ErrorNote, Field, Icon, ICONS, Modal, Spinner, useToast } from "../components/ui";

const ROLE_HELP = {
  agent: "Runs campaigns from their own number",
  owner: "Oversees one or more branches",
  admin: "Manages people, rules and everything",
  support: "Fin-Link: keeps numbers connected",
};

export default function Team() {
  const { profile: me } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [branchModal, setBranchModal] = useState(null); // {id?, name}
  const [personModal, setPersonModal] = useState(null); // {mode:'invite'|'edit', person?}
  const [secret, setSecret] = useState(null); // {name, email, password, kind}
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    try {
      const [branches, people, owners, numbers] = await Promise.all([
        supabase.from("branches").select("*").order("name").then(must),
        supabase.from("profiles").select("*").order("full_name").then(must),
        supabase.from("branch_owners").select("*").then(must),
        supabase.rpc("list_whatsapp_numbers").then(must),
      ]);
      setData({ branches, people, owners, numbers });
    } catch (e) { setError(e); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const branchName = useMemo(() => Object.fromEntries((data?.branches ?? []).map((b) => [b.id, b.name])), [data]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;

  const activeBranches = data.branches.filter((b) => !b.archived_at);
  const shownBranches = showArchived ? data.branches : activeBranches;
  const agentsIn = (bid) => data.people.filter((p) => p.role === "agent" && p.branch_id === bid && p.status === "active").length;
  const ownersOf = (bid) => data.owners.filter((o) => o.branch_id === bid).map((o) => data.people.find((p) => p.id === o.owner_id)?.full_name).filter(Boolean);
  const numberOf = (pid) => data.numbers.find((n) => n.agent_id === pid);

  async function saveBranch(e) {
    e.preventDefault();
    const name = branchModal.name.trim();
    if (!name) return;
    const q = branchModal.id
      ? supabase.from("branches").update({ name }).eq("id", branchModal.id)
      : supabase.from("branches").insert({ name });
    const { error } = await q;
    if (error) return toast(error.code === "23505" ? "A branch with that name already exists." : error.message, "bad");
    toast(branchModal.id ? "Branch renamed" : "Branch added");
    setBranchModal(null); load();
  }

  async function toggleArchive(b) {
    const { error } = await supabase.from("branches").update({ archived_at: b.archived_at ? null : new Date().toISOString() }).eq("id", b.id);
    if (error) return toast(error.message, "bad");
    toast(b.archived_at ? `${b.name} restored` : `${b.name} archived`);
    load();
  }

  async function runPersonAction(action, person) {
    try {
      const out = await callFn("admin-users", { action, id: person.id });
      if (action === "reset_password") setSecret({ name: person.full_name, email: person.email, password: out.temp_password, kind: "reset" });
      else toast(action === "deactivate" ? `${person.full_name} deactivated` : `${person.full_name} reactivated`);
      setConfirm(null); load();
    } catch (e) { toast(e.message, "bad"); }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Main Admin</p>
          <h1>Branches & people</h1>
          <p className="muted">Everyone gets their own login. Agents belong to one branch and send from one WhatsApp number; Branch Owners see the branches they oversee.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setPersonModal({ mode: "invite" })}><Icon d={ICONS.plus} />Invite someone</button>
      </div>

      {/* ---------- Branches ---------- */}
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Branches</h2>
            <p className="muted small">{activeBranches.length} active{data.branches.length > activeBranches.length ? ` · ${data.branches.length - activeBranches.length} archived` : ""}</p>
          </div>
          <div className="row">
            {data.branches.length > activeBranches.length && (
              <label className="check small"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label>
            )}
            <button className="btn btn-sm" onClick={() => setBranchModal({ name: "" })}><Icon d={ICONS.plus} className="ic ic-s" />Add branch</button>
          </div>
        </div>
        {shownBranches.length === 0 ? (
          <Empty title="No branches yet">Add Blue PROP’s offices first, then invite agents into them.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Branch</th><th>Branch Owner</th><th className="num">Agents</th><th></th></tr></thead>
              <tbody>
                {shownBranches.map((b) => (
                  <tr key={b.id} className={b.archived_at ? "dim" : ""}>
                    <td><span className="cell-title">{b.name}</span>{b.archived_at && <> <Badge>Archived</Badge></>}</td>
                    <td>{ownersOf(b.id).join(", ") || <span className="muted">None yet</span>}</td>
                    <td className="num">{agentsIn(b.id)}</td>
                    <td className="num">
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        {!b.archived_at && <button className="btn btn-sm" onClick={() => setBranchModal({ id: b.id, name: b.name })}>Rename</button>}
                        <button className="btn btn-sm" onClick={() => toggleArchive(b)}>{b.archived_at ? "Restore" : "Archive"}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------- People ---------- */}
      <section className="card">
        <div className="card-head">
          <div>
            <h2>People</h2>
            <p className="muted small">{data.people.filter((p) => p.status === "active").length} active</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Person</th><th>Role</th><th>Branch</th><th>WhatsApp number</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data.people.map((p) => {
                const n = numberOf(p.id);
                const ownedBranches = data.owners.filter((o) => o.owner_id === p.id).map((o) => branchName[o.branch_id]);
                const locked = p.is_fin_link && !me.is_fin_link;
                return (
                  <tr key={p.id} className={p.status !== "active" ? "dim" : ""}>
                    <td><div className="cell-title">{p.full_name}{p.id === me.id && <span className="muted"> (you)</span>}</div><div className="cell-sub">{p.email}</div></td>
                    <td>{ROLE_LABEL[p.role]}{p.is_fin_link && <div className="cell-sub">Fin-Link</div>}</td>
                    <td>{p.role === "agent" ? (branchName[p.branch_id] ?? "—") : p.role === "owner" ? ownedBranches.join(", ") || "—" : <span className="muted">All</span>}</td>
                    <td>
                      {p.role !== "agent" ? <span className="muted">—</span> : n ? (
                        <div>{n.has_phone ? <div>{fmtPhone(n.phone_e164)}</div> : <div style={{ color: "var(--bad)", fontWeight: 500 }}>Phone number needed</div>}<Badge tone={NUMBER_STATUS[n.status]?.[1]}>{NUMBER_STATUS[n.status]?.[0]}</Badge></div>
                      ) : <Badge tone="warn">No number</Badge>}
                    </td>
                    <td>{p.status === "active" ? (p.must_change_password ? <Badge tone="brand">Invited</Badge> : <Badge tone="ok">Active</Badge>) : <Badge>Deactivated</Badge>}</td>
                    <td className="num">
                      {!locked && (
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                          {p.status === "active" && <button className="btn btn-sm" onClick={() => setPersonModal({ mode: "edit", person: p })}>Edit</button>}
                          {p.status === "active" && <button className="btn btn-sm" onClick={() => setConfirm({ action: "reset_password", person: p })}>Reset password</button>}
                          {p.id !== me.id && (p.status === "active"
                            ? <button className="btn btn-sm btn-danger" onClick={() => setConfirm({ action: "deactivate", person: p })}>Deactivate</button>
                            : <button className="btn btn-sm" onClick={() => runPersonAction("reactivate", p)}>Reactivate</button>)}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {branchModal && (
        <Modal title={branchModal.id ? "Rename branch" : "Add a branch"} onClose={() => setBranchModal(null)}
          footer={<><button className="btn" onClick={() => setBranchModal(null)}>Cancel</button><button className="btn btn-primary" form="branch-form">{branchModal.id ? "Save" : "Add branch"}</button></>}>
          <form id="branch-form" onSubmit={saveBranch}>
            <Field label="Branch name" id="bname"><input id="bname" className="input" value={branchModal.name} onChange={(e) => setBranchModal({ ...branchModal, name: e.target.value })} required /></Field>
          </form>
        </Modal>
      )}

      {personModal && (
        <PersonModal
          mode={personModal.mode}
          person={personModal.person}
          data={data}
          me={me}
          onClose={() => setPersonModal(null)}
          onSaved={(out) => {
            setPersonModal(null); load();
            if (out?.temp_password) setSecret({ ...out, kind: "invite" });
            else toast("Changes saved");
          }}
        />
      )}

      {confirm && (
        <Modal
          title={confirm.action === "deactivate" ? `Deactivate ${confirm.person.full_name}?` : `Reset ${confirm.person.full_name}’s password?`}
          onClose={() => setConfirm(null)}
          footer={<>
            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button className={`btn ${confirm.action === "deactivate" ? "btn-danger" : "btn-primary"}`} onClick={() => runPersonAction(confirm.action, confirm.person)}>
              {confirm.action === "deactivate" ? "Deactivate" : "Reset password"}
            </button>
          </>}
        >
          {confirm.action === "deactivate" ? (
            <>
              <p>{confirm.person.full_name} won’t be able to sign in{numberOf(confirm.person.id) ? <>, and their number <strong>{fmtPhone(numberOf(confirm.person.id).phone_e164) || numberOf(confirm.person.id).profile_label}</strong> is freed so it can be given to someone else</> : ""}.</p>
              <p className="note note-info">Running campaigns will be paused here too once campaigns are live in the portal. You can reactivate them later.</p>
            </>
          ) : (
            <p>They’ll get a new temporary password and must choose their own the next time they sign in.</p>
          )}
        </Modal>
      )}

      {secret && <SecretModal secret={secret} onClose={() => setSecret(null)} />}
    </>
  );
}

function PersonModal({ mode, person, data, me, onClose, onSaved }) {
  const isEdit = mode === "edit";
  const currentNumber = isEdit ? data.numbers.find((n) => n.agent_id === person.id) : null;
  const [f, setF] = useState({
    full_name: person?.full_name ?? "",
    email: person?.email ?? "",
    role: person?.role ?? "agent",
    branch_id: person?.branch_id ?? "",
    owner_branch_ids: isEdit ? data.owners.filter((o) => o.owner_id === person.id).map((o) => o.branch_id) : [],
    number_id: currentNumber?.id ?? "",
    phone: currentNumber?.phone_e164 ? fmtPhone(currentNumber.phone_e164) : "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const branches = data.branches.filter((b) => !b.archived_at);
  const freeNumbers = data.numbers.filter((n) => (!n.agent_id || n.agent_id === person?.id) && n.status !== "removed");
  const chosen = data.numbers.find((n) => n.id === f.number_id);
  const roles = me.is_fin_link ? ["agent", "owner", "admin", "support"] : ["agent", "owner", "admin"];
  const selfEdit = isEdit && person.id === me.id;

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const payload = {
        action: isEdit ? "update" : "invite",
        id: person?.id,
        full_name: f.full_name, email: f.email, role: f.role,
        branch_id: f.role === "agent" ? f.branch_id || null : null,
        owner_branch_ids: f.role === "owner" ? f.owner_branch_ids : [],
      };
      if (f.role === "agent") {
        payload.number_id = f.number_id || null;
        const saved = chosen?.phone_e164 ? fmtPhone(chosen.phone_e164) : "";
        payload.phone = f.number_id && f.phone.trim() && f.phone.trim() !== saved ? f.phone : null;
      }
      const out = await callFn("admin-users", payload);
      onSaved(isEdit ? null : { ...out, name: f.full_name, email: f.email.trim().toLowerCase() });
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      title={isEdit ? `Edit ${person.full_name}` : "Invite someone"}
      sub={isEdit ? person.email : "They get their own login. You’ll see a temporary password to send them."}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="person-form" disabled={busy}>{busy ? "Saving…" : isEdit ? "Save changes" : "Create login"}</button></>}
    >
      <form id="person-form" className="stack" onSubmit={submit}>
        <Field label="Full name" id="p-name"><input id="p-name" className="input" value={f.full_name} onChange={set("full_name")} required /></Field>
        {!isEdit && <Field label="Email address" id="p-email"><input id="p-email" className="input" type="email" value={f.email} onChange={set("email")} required /></Field>}
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }} disabled={selfEdit}>
          <legend style={{ fontWeight: 500, fontSize: 13.5, marginBottom: 6 }}>Role</legend>
          <div className="seg">
            {roles.map((r) => (
              <label key={r} className={f.role === r ? "on" : ""}>
                <input type="radio" name="role" value={r} checked={f.role === r} onChange={set("role")} />
                <span className="t">{ROLE_LABEL[r]}</span><span className="d">{ROLE_HELP[r]}</span>
              </label>
            ))}
          </div>
          {selfEdit && <p className="hint">You can’t change your own role.</p>}
        </fieldset>

        {f.role === "agent" && (
          <>
            <Field label="Branch" id="p-branch" hint="An agent belongs to exactly one branch.">
              <select id="p-branch" className="select" value={f.branch_id} onChange={set("branch_id")} required>
                <option value="">Choose a branch…</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            {branches.length === 0 && <p className="note note-warn">Add a branch first.</p>}
            <Field label="WhatsApp number" id="p-number" hint="Only numbers that aren’t linked to anyone are listed. Every campaign this agent creates will send from it.">
              <select id="p-number" className="select" value={f.number_id} onChange={(e) => {
                const n = data.numbers.find((x) => x.id === e.target.value);
                setF({ ...f, number_id: e.target.value, phone: n?.phone_e164 ? fmtPhone(n.phone_e164) : "" });
              }}>
                <option value="">No number yet</option>
                {freeNumbers.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.has_phone ? fmtPhone(n.phone_e164) : `“${n.profile_label || "WhatsApp"}” (phone number needed)`} · {n.lemlist_user_name ?? n.lemlist_user_id} · {NUMBER_STATUS[n.status]?.[0]}
                  </option>
                ))}
              </select>
            </Field>
            {chosen && !chosen.has_phone && (
              <div className="note note-warn"><strong>Phone number needed.</strong> lemlist only shares the WhatsApp profile name (“{chosen.profile_label || "WhatsApp"}”), so enter the number on the phone that scanned the QR code. It’s stored encrypted.</div>
            )}
            {chosen && (
              <Field label={chosen.has_phone ? "Phone number" : "Phone number (required)"} id="p-phone" hint={chosen.has_phone ? "Saved and encrypted. Change it only if it’s wrong." : "For example 082 555 0141. Only admins, Support and this agent will see it."}>
                <input id="p-phone" className="input" inputMode="tel" autoComplete="off" placeholder="082 555 0141" value={f.phone} onChange={set("phone")} required={!chosen.has_phone} />
              </Field>
            )}
            {freeNumbers.length === 0 && <p className="note note-info">No free numbers. Connect a lemlist user or sync numbers on the lemlist page.</p>}
          </>
        )}

        {f.role === "owner" && (
          <div className="field">
            <span style={{ fontWeight: 500, fontSize: 13.5 }}>Branches they oversee</span>
            {branches.map((b) => (
              <label key={b.id} className="check">
                <input type="checkbox" checked={f.owner_branch_ids.includes(b.id)}
                  onChange={(e) => setF({ ...f, owner_branch_ids: e.target.checked ? [...f.owner_branch_ids, b.id] : f.owner_branch_ids.filter((x) => x !== b.id) })} />
                {b.name}
              </label>
            ))}
            {branches.length === 0 && <p className="note note-warn">Add a branch first.</p>}
          </div>
        )}
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

function SecretModal({ secret, onClose }) {
  const url = window.location.origin + window.location.pathname;
  const message =
    `Hi ${secret.name.split(" ")[0]}, ${secret.kind === "invite" ? "your Blue PROP WhatsApp Portal login is ready" : "your Blue PROP WhatsApp Portal password has been reset"}.\n\n` +
    `Sign in at: ${url}\nEmail: ${secret.email}\nTemporary password: ${secret.password}\n\nYou’ll be asked to choose your own password when you sign in.`;
  return (
    <Modal
      title={secret.kind === "invite" ? `${secret.name} can now sign in` : "New temporary password"}
      sub="Send these details to them privately. The password is shown only once."
      onClose={onClose}
      footer={<><CopyButton text={message} label="Copy message" className="btn" /><button className="btn btn-primary" onClick={onClose}>Done</button></>}
    >
      <div className="secret" aria-label="Temporary password">{secret.password}</div>
      <pre className="update">{message}</pre>
    </Modal>
  );
}
