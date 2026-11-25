import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export function Badge({ tone = "muted", children }) {
  return <span className={`badge b-${tone}`}>{children}</span>;
}

export function Spinner({ label = "Loading" }) {
  return <div className="spinner" role="status" aria-label={label}><span /></div>;
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="note note-bad" role="alert">{String(error.message || error)}</div>;
}

export function Field({ label, hint, children, id }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Modal({ title, sub, onClose, children, footer, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector("input, select, textarea, button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
        <div className="modal-head">
          <div>
            <h2 id="modal-title">{title}</h2>
            {sub && <p className="muted">{sub}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" className="ic" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const show = useCallback((text, tone = "ok") => {
    setToast({ text, tone, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && <div className={`toast t-${toast.tone}`} role="status" key={toast.id}>{toast.text}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function CopyButton({ text, label = "Copy", className = "btn btn-sm" }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600); }
        catch { setDone(false); }
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function Icon({ d, className = "ic" }) {
  return <svg viewBox="0 0 24 24" className={className} aria-hidden="true"><path d={d} /></svg>;
}

export const ICONS = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  team: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM22 19v-1a4 4 0 0 0-3-3.87M16 4.13A3 3 0 0 1 16 10",
  phone: "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2",
  plan: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
  audit: "M4 6h16M4 12h16M4 18h10",
  out: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  key: "M15 7a4 4 0 1 1-3.9 4.9L3 20v-3l2-2h2v-2h2l1.1-1.1A4 4 0 0 1 15 7z",
  refresh: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  plus: "M12 5v14M5 12h14",
  menu: "M4 6h16M4 12h16M4 18h16",
  alert: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
};
