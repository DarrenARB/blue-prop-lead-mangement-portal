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

// Password box with a show/hide (eye) button. Takes the same props as an <input>.
export function PasswordInput({ id, className = "input", ...props }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input id={id} className={className} type={show ? "text" : "password"} autoCapitalize="none" spellCheck={false} {...props} />
      <button
        type="button"
        className="pw-toggle"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        aria-controls={id}
        title={show ? "Hide password" : "Show password"}
      >
        {show ? (
          <svg viewBox="0 0 24 24" className="ic" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3.2 4.3M6.1 6.1C3.9 7.6 2.5 9.8 2 12c1 2.5 5 7 10 7a9.9 9.9 0 0 0 4.2-.9" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" className="ic" aria-hidden="true"><path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
        )}
      </button>
    </div>
  );
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
  // Keep the latest onClose without re-running the effect: parents pass a new function on every
  // render (every keystroke), and re-running the effect used to steal focus while typing.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Escape closes the dialog.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") closeRef.current?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Focus the first field once, when the dialog opens (not the close button).
  useEffect(() => {
    const body = ref.current;
    const first = body?.querySelector(".modal-body input:not([type=hidden]), .modal-body select, .modal-body textarea")
      ?? body?.querySelector(".modal-foot button, .modal-body button");
    first?.focus();
  }, []);
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
  map: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14",
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
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z",
  archive: "M21 8v13H3V8M1 3h22v5H1zM10 12h4",
  copy: "M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  calgrid: "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4M8 14h2M14 14h2M8 18h2",
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
  flame: "M12 22c4 0 7-3 7-7 0-3-2-5.5-3.5-7-.5 2-1.5 3-3 3.5C13 8 12 5 9 2c0 4-4 6.5-4 11 0 5 3 9 7 9z",
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  block: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.9 4.9l14.2 14.2",
  shotgun: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 8l5 5M22 8l-5 5",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
};
