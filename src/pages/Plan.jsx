import { useCallback, useEffect, useMemo, useState } from "react";
import { must, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { GROUP_LABEL, PLAN_STATUS, fmtDate, fmtR } from "../lib/format";
import { Badge, CopyButton, ErrorNote, Field, Icon, ICONS, Modal, Spinner, useToast } from "../components/ui";

const GROUP_ORDER = ["foundation", "agent", "admin", "owner", "support"];
const STATUS_FILTERS = [["all", "All"], ["not_started", "Not started"], ["in_progress", "In progress"], ["built", "Awaiting sign-off"], ["signed_off", "Signed off"]];

function readBasis() { try { return localStorage.getItem("plan-earned-basis") || "built"; } catch { return "built"; } }

export default function Plan() {
  const { isFinLink } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [payments, setPayments] = useState([]);
  const [draws, setDraws] = useState([]);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [group, setGroup] = useState("all");
  const [edit, setEdit] = useState(null);
  const [money, setMoney] = useState(null); // 'payment' | 'drawdown'
  const [update, setUpdate] = useState(false);
  const [basis, setBasis] = useState(readBasis);
  const [projectValue, setProjectValue] = useState(null);
  const [editValue, setEditValue] = useState(false);

  const load = useCallback(async () => {
    try {
      const it = await supabase.from("plan_items").select("*").order("sort").then(must);
      const st = await supabase.from("settings").select("project_value").eq("id", 1).maybeSingle().then(must);
      setProjectValue(Number(st?.project_value ?? 0));
      setItems(it);
      if (isFinLink) {
        setPayments(await supabase.from("plan_payments").select("*").order("received_on", { ascending: false }).then(must));
        setDraws(await supabase.from("plan_drawdowns").select("*").order("taken_on", { ascending: false }).then(must));
      }
    } catch (e) { setError(e); }
  }, [isFinLink]);
  useEffect(() => { load(); }, [load]);

  const t = useMemo(() => {
    if (!items) return null;
    const sum = (arr) => arr.reduce((s, i) => s + Number(i.price), 0);
    const by = (st) => items.filter((i) => i.status === st);
    const total = sum(items);
    const signed = sum(by("signed_off"));
    const built = sum(by("built"));
    const inProg = by("in_progress");
    const progValue = inProg.reduce((s, i) => s + Number(i.price) * (i.progress / 100), 0);
    const earned = basis === "signed" ? signed : signed + built;
    const paid = payments.reduce((s, p) => s + Number(p.amount), 0);
    const drawn = draws.reduce((s, d) => s + Number(d.amount), 0);
    const available = Math.max(0, Math.min(paid, earned) - drawn);
    return {
      total, signed, built, progValue, earned, paid, drawn, available,
      unpaidEarned: Math.max(0, earned - paid),
      paidAhead: Math.max(0, paid - earned),
      remaining: total - signed - built,
      counts: { all: items.length, not_started: by("not_started").length, in_progress: inProg.length, built: by("built").length, signed_off: by("signed_off").length },
      unpriced: items.filter((i) => Number(i.price) === 0).length,
    };
  }, [items, payments, draws, basis]);

  if (error) return <ErrorNote error={error} />;
  if (!items || !t) return <Spinner />;

  const gap = Math.round((projectValue ?? t.total) - t.total);
  const pct = (v) => (t.total ? (v / t.total) * 100 : 0);
  const shown = items.filter((i) => (filter === "all" || i.status === filter) && (group === "all" || i.grp === group));

  function setBasisSaved(v) { setBasis(v); try { localStorage.setItem("plan-earned-basis", v); } catch { /* ignore */ } }

  async function deleteMoney(table, row) {
    const { error } = await supabase.from(table).delete().eq("id", row.id);
    if (error) return toast(error.message, "bad");
    toast("Removed"); load();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Project plan</p>
          <h1>{Math.round(pct(t.signed + t.built))}% of the build delivered</h1>
          <p className="muted">
            The project value is split across every foundation and user story from the signed-off prototype (excl. VAT).
            {isFinLink ? " Only Fin-Link can change statuses and see the money panel." : " Fin-Link updates statuses as work is delivered."}
          </p>
        </div>
        <div className="row">
          {isFinLink && <button className="btn" onClick={() => setEditValue(true)}>Project value</button>}
          <button className="btn" onClick={() => setUpdate(true)}>Client update</button>
        </div>
      </div>

      {gap !== 0 && (
        <div className="banner" role="alert" style={{ alignItems: "center" }}>
          <Icon d={ICONS.alert} />
          <div style={{ flex: 1 }}>
            <strong>The line items add up to {fmtR(t.total)}, which is {fmtR(Math.abs(gap))} {gap > 0 ? "less" : "more"} than the {fmtR(projectValue)} project value.</strong>
            <div className="small">Every story and component gets a share of the project value. Adjust item prices until nothing is left over{t.unpriced ? `; ${t.unpriced} item${t.unpriced > 1 ? "s have" : " has"} no price yet` : ""}.</div>
          </div>
          {isFinLink && <button className="btn btn-sm" onClick={() => setEditValue(true)}>Change project value</button>}
        </div>
      )}

      {/* ---------- progress ---------- */}
      <section className="card">
        <div className="grid g4">
          <div className="kpi hero">
            <div className="kpi-label">Project value</div>
            <div className="kpi-value">{fmtR(projectValue)}</div>
            <div className="kpi-sub">{gap === 0 ? `Fully allocated across ${t.counts.all} items` : `${fmtR(t.total)} allocated to ${t.counts.all} items`}</div>
          </div>
          <div className="kpi"><div className="kpi-label">Signed off</div><div className="kpi-value" style={{ color: "var(--ok)" }}>{fmtR(t.signed)}</div><div className="kpi-sub">{t.counts.signed_off} items</div></div>
          <div className="kpi"><div className="kpi-label">Built, awaiting sign-off</div><div className="kpi-value" style={{ color: "var(--warn)" }}>{fmtR(t.built)}</div><div className="kpi-sub">{t.counts.built} items</div></div>
          <div className="kpi"><div className="kpi-label">Still to deliver</div><div className="kpi-value">{fmtR(t.remaining)}</div><div className="kpi-sub">{t.counts.in_progress} in progress · {t.counts.not_started} not started</div></div>
        </div>
        <div className="bar" style={{ marginTop: 18, height: 14 }} aria-label="Build value delivered">
          <span className="s-signed" style={{ width: `${pct(t.signed)}%` }} />
          <span className="s-built" style={{ width: `${pct(t.built)}%` }} />
          <span className="s-prog" style={{ width: `${pct(t.progValue)}%` }} />
        </div>
        <div className="legend" style={{ marginTop: 8 }}>
          <span><i style={{ background: "var(--ok)" }} />Signed off</span>
          <span><i style={{ background: "#E2A33A" }} />Built, awaiting sign-off</span>
          <span><i style={{ background: "var(--brand)", opacity: .55 }} />In progress (by % done, {fmtR(t.progValue)})</span>
        </div>
      </section>

      {/* ---------- money (Fin-Link only) ---------- */}
      {isFinLink && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>What you can draw</h2>
              <p className="muted small">You can draw what Blue PROP has paid, up to the value of the work delivered, minus what you’ve already drawn. Visible to Fin-Link only.</p>
            </div>
            <div className="row">
              <label className="small muted" htmlFor="basis">Count as earned</label>
              <select id="basis" className="select" style={{ width: "auto", minHeight: 36, fontSize: 14 }} value={basis} onChange={(e) => setBasisSaved(e.target.value)}>
                <option value="built">Built + signed off</option>
                <option value="signed">Signed off only</option>
              </select>
            </div>
          </div>
          <div className="grid g2">
            <div>
              <div className="money-row"><span>Paid by Blue PROP</span><strong>{fmtR(t.paid)}</strong></div>
              <div className="money-row"><span>Earned (work {basis === "signed" ? "signed off" : "built or signed off"})</span><strong>{fmtR(t.earned)}</strong></div>
              <div className="money-row"><span>Drawn so far</span><strong>− {fmtR(t.drawn)}</strong></div>
              <div className="money-row money-total"><span><strong>Available to draw now</strong></span><strong style={{ color: "var(--ok)" }}>{fmtR(t.available)}</strong></div>
              {t.paidAhead > 0 && <p className="note note-info" style={{ marginTop: 10 }}>{fmtR(t.paidAhead)} has been paid ahead of delivery. It becomes available as more items are {basis === "signed" ? "signed off" : "built"}.</p>}
              {t.unpaidEarned > 0 && <p className="note note-warn" style={{ marginTop: 10 }}>{fmtR(t.unpaidEarned)} of delivered work hasn’t been paid yet. Worth invoicing.</p>}
            </div>
            <div className="stack">
              <div>
                <div className="row spread"><h3>Client payments</h3><button className="btn btn-sm" onClick={() => setMoney("payment")}><Icon d={ICONS.plus} className="ic ic-s" />Add</button></div>
                {payments.length === 0 ? <p className="muted small" style={{ marginTop: 6 }}>No payments recorded yet.</p> : payments.map((p) => (
                  <div key={p.id} className="money-row small"><span>{fmtDate(p.received_on)}{p.note ? ` · ${p.note}` : ""}</span><span className="row"><strong>{fmtR(p.amount)}</strong><button className="btn-link small" onClick={() => deleteMoney("plan_payments", p)} aria-label="Remove payment">Remove</button></span></div>
                ))}
              </div>
              <div>
                <div className="row spread"><h3>Your drawdowns</h3><button className="btn btn-sm" onClick={() => setMoney("drawdown")}><Icon d={ICONS.plus} className="ic ic-s" />Add</button></div>
                {draws.length === 0 ? <p className="muted small" style={{ marginTop: 6 }}>Nothing drawn yet.</p> : draws.map((d) => (
                  <div key={d.id} className="money-row small"><span>{fmtDate(d.taken_on)}{d.note ? ` · ${d.note}` : ""}</span><span className="row"><strong>{fmtR(d.amount)}</strong><button className="btn-link small" onClick={() => deleteMoney("plan_drawdowns", d)} aria-label="Remove drawdown">Remove</button></span></div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ---------- items ---------- */}
      <section className="card">
        <div className="card-head">
          <div className="filters" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map(([k, l]) => (
              <button key={k} className={`chip ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>{l} · {t.counts[k]}</button>
            ))}
          </div>
          <select className="select" style={{ width: "auto", minHeight: 36, fontSize: 14 }} value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Filter by area">
            <option value="all">All areas</option>
            {GROUP_ORDER.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
          </select>
        </div>

        {GROUP_ORDER.filter((g) => group === "all" || g === group).map((g) => {
          const rows = shown.filter((i) => i.grp === g);
          if (!rows.length) return null;
          const all = items.filter((i) => i.grp === g);
          const done = all.filter((i) => i.status === "built" || i.status === "signed_off");
          return (
            <div key={g}>
              <div className="group-head">
                <h3>{GROUP_LABEL[g]}</h3>
                <span className="muted small">{done.length} of {all.length} delivered · {fmtR(done.reduce((s, i) => s + Number(i.price), 0))} of {fmtR(all.reduce((s, i) => s + Number(i.price), 0))}</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th style={{ width: 84 }}>ID</th><th>What we build</th><th className="num">Value</th><th>Status</th>{isFinLink && <th></th>}</tr></thead>
                  <tbody>
                    {rows.map((i) => (
                      <tr key={i.code}>
                        <td className="code">{i.code}</td>
                        <td>
                          <div className="cell-title">{i.title}</div>
                          <div className="cell-sub">{i.detail}</div>
                          {i.notes && <div className="cell-sub" style={{ color: "var(--brand)", marginTop: 2 }}>Note: {i.notes}</div>}
                        </td>
                        <td className="num">{Number(i.price) ? fmtR(i.price) : <span className="muted">Not priced</span>}</td>
                        <td>
                          <Badge tone={PLAN_STATUS[i.status][1]}>{PLAN_STATUS[i.status][0]}{i.status === "in_progress" ? ` · ${i.progress}%` : ""}</Badge>
                          {i.signed_off_at ? <div className="cell-sub">Signed off {fmtDate(i.signed_off_at)}</div> : i.built_at ? <div className="cell-sub">Built {fmtDate(i.built_at)}</div> : null}
                        </td>
                        {isFinLink && <td className="num"><button className="btn btn-sm" onClick={() => setEdit(i)}>Update</button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
        {shown.length === 0 && <p className="muted" style={{ padding: 16 }}>Nothing matches this filter.</p>}
      </section>

      {editValue && <ProjectValueModal value={projectValue} allocated={t.total} onClose={() => setEditValue(false)} onSaved={() => { setEditValue(false); load(); toast("Project value saved"); }} />}
      {edit && <EditItem item={edit} projectValue={projectValue} allocated={t.total} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); toast("Saved"); }} />}
      {money && <MoneyModal kind={money} onClose={() => setMoney(null)} onSaved={() => { setMoney(null); load(); toast(money === "payment" ? "Payment recorded" : "Drawdown recorded"); }} />}
      {update && <ClientUpdate items={items} totals={t} onClose={() => setUpdate(false)} />}
    </>
  );
}

function EditItem({ item, projectValue, allocated, onClose, onSaved }) {
  const [f, setF] = useState({ status: item.status, progress: item.progress, price: item.price, notes: item.notes ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.from("plan_items").update({
      status: f.status,
      progress: f.status === "in_progress" ? Math.max(0, Math.min(99, Number(f.progress) || 0)) : f.progress,
      price: Number(f.price) || 0,
      notes: f.notes.trim() || null,
    }).eq("code", item.code);
    setBusy(false);
    if (error) return setError(error);
    onSaved();
  }
  return (
    <Modal title={`${item.code} · ${item.title}`} sub={item.detail} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="item-form" disabled={busy}>{busy ? "Saving…" : "Save"}</button></>}>
      <form id="item-form" className="stack" onSubmit={submit}>
        <div className="seg">
          {Object.entries(PLAN_STATUS).map(([k, [l]]) => (
            <label key={k} className={f.status === k ? "on" : ""}>
              <input type="radio" name="st" value={k} checked={f.status === k} onChange={() => setF({ ...f, status: k })} />
              <span className="t">{l}</span>
            </label>
          ))}
        </div>
        {f.status === "in_progress" && (
          <Field label={`How far along? ${f.progress}%`} id="it-prog">
            <input id="it-prog" type="range" min="0" max="95" step="5" value={f.progress} onChange={(e) => setF({ ...f, progress: e.target.value })} />
          </Field>
        )}
        <Field label="Value (R, excl. VAT)" id="it-price" hint={(() => {
          const after = allocated - Number(item.price) + (Number(f.price) || 0);
          const left = projectValue - after;
          return left === 0 ? `Items will total ${fmtR(after)}, exactly the project value.` : `Items will total ${fmtR(after)}: ${fmtR(Math.abs(left))} ${left > 0 ? "left to allocate" : "over the project value"}. Balance it on another item.`;
        })()}>
          <input id="it-price" className="input" type="number" min="0" step="50" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        </Field>
        <Field label="Note" id="it-notes" hint="Shown to the client on this page and in client updates.">
          <textarea id="it-notes" className="textarea" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

function ProjectValueModal({ value, allocated, onClose, onSaved }) {
  const [v, setV] = useState(String(value ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    const n = Number(String(v).replace(/[^\d.]/g, ""));
    if (!n) return setError("Enter the project value.");
    setBusy(true); setError(null);
    const { error } = await supabase.from("settings").update({ project_value: n }).eq("id", 1);
    setBusy(false);
    if (error) return setError(error);
    onSaved();
  }
  return (
    <Modal title="Project value" sub="The total the project is worth. Every story and component is a share of it." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="pv-form" disabled={busy}>Save</button></>}>
      <form id="pv-form" className="stack" onSubmit={submit}>
        <Field label="Project value (R, excl. VAT)" id="pv" hint={`Items currently total ${fmtR(allocated)}.`}>
          <input id="pv" className="input" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} required />
        </Field>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

function MoneyModal({ kind, onClose, onSaved }) {
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), amount: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    const amount = Number(String(f.amount).replace(/[^\d.]/g, ""));
    if (!amount) return setError("Enter an amount.");
    setBusy(true); setError(null);
    const row = kind === "payment"
      ? { received_on: f.date, amount, note: f.note.trim() || null }
      : { taken_on: f.date, amount, note: f.note.trim() || null };
    const { error } = await supabase.from(kind === "payment" ? "plan_payments" : "plan_drawdowns").insert(row);
    setBusy(false);
    if (error) return setError(error);
    onSaved();
  }
  return (
    <Modal title={kind === "payment" ? "Record a client payment" : "Record a drawdown"} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="money-form" disabled={busy}>Save</button></>}>
      <form id="money-form" className="stack" onSubmit={submit}>
        <div className="grid g2">
          <Field label="Date" id="m-date"><input id="m-date" className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
          <Field label="Amount (R)" id="m-amt"><input id="m-amt" className="input" inputMode="decimal" placeholder="50 000" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></Field>
        </div>
        <Field label="Note (optional)" id="m-note"><input id="m-note" className="input" placeholder={kind === "payment" ? "Deposit, invoice INV-001" : "Transferred to personal account"} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

function ClientUpdate({ items, totals, onClose }) {
  const [since, setSince] = useState("");
  const inRange = (iso) => !since || (iso && iso.slice(0, 10) >= since);
  const line = (i) => `• ${i.code}  ${i.title}${Number(i.price) ? ` (${fmtR(i.price)})` : ""}`;
  const signed = items.filter((i) => i.status === "signed_off" && inRange(i.signed_off_at));
  const built = items.filter((i) => i.status === "built" && inRange(i.built_at));
  const prog = items.filter((i) => i.status === "in_progress");
  const delivered = totals.signed + totals.built;
  const text = [
    `Blue PROP WhatsApp Portal: progress update, ${fmtDate(new Date().toISOString())}`,
    "",
    `Delivered so far: ${fmtR(delivered)} of ${fmtR(totals.total)} (${Math.round((delivered / totals.total) * 100)}%).`,
    "",
    built.length ? `Built and ready for your sign-off${since ? " (since " + fmtDate(since) + ")" : ""}:\n${built.map(line).join("\n")}` : null,
    signed.length ? `Signed off${since ? " (since " + fmtDate(since) + ")" : ""}:\n${signed.map(line).join("\n")}` : null,
    prog.length ? `In progress:\n${prog.map((i) => `${line(i)}, about ${i.progress}% done`).join("\n")}` : null,
    "",
    "Please test the items awaiting sign-off and let us know if they can be signed off.",
  ].filter((x) => x !== null).join("\n\n").replace(/\n{3,}/g, "\n\n");
  return (
    <Modal title="Client update" sub="A ready-to-send summary of delivered stories. Prices are as quoted." onClose={onClose} wide
      footer={<><CopyButton text={text} label="Copy update" className="btn btn-primary" /><button className="btn" onClick={onClose}>Close</button></>}>
      <Field label="Only include items delivered since (optional)" id="cu-since">
        <input id="cu-since" className="input" type="date" value={since} onChange={(e) => setSince(e.target.value)} style={{ maxWidth: 220 }} />
      </Field>
      <pre className="update">{text}</pre>
    </Modal>
  );
}
