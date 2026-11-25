// Split-screen frame for sign-in, first-run setup and forced password change.
export default function AuthShell({ children }) {
  return (
    <div className="auth">
      <section className="auth-side">
        <div className="brand" style={{ padding: 0 }}>
          <img className="brand-logo" src="./brand/blue-property-group-logo.png" alt="Blue Property Group" style={{ width: 150 }} />
          <div className="brand-sub">WhatsApp Lead Portal</div>
        </div>
        <div style={{ position: "relative", zIndex: 1 }}>
          <h1>WhatsApp campaigns agents can launch in <span className="hl">minutes</span>.</h1>
          <p>Each agent sends from their own number. Replies land in one inbox, and the best leads go straight to the CRM.</p>
        </div>
        <p className="small" style={{ color: "#7F8BA6", position: "relative", zIndex: 1 }}>Built by Fin-Link</p>
        <svg className="auth-art" viewBox="0 0 380 380" aria-hidden="true">
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3A47A3" /><stop offset="1" stopColor="#161C4A" /></linearGradient>
          </defs>
          <rect x="110" y="40" width="190" height="320" rx="30" fill="url(#g1)" stroke="#4452B0" strokeWidth="2" />
          <rect x="128" y="74" width="154" height="252" rx="12" fill="#10153A" />
          <rect x="140" y="92" width="104" height="34" rx="12" fill="#2A3270" />
          <rect x="166" y="138" width="104" height="44" rx="12" fill="#FC4F15" />
          <rect x="140" y="194" width="88" height="30" rx="12" fill="#2A3270" />
          <rect x="182" y="236" width="88" height="30" rx="12" fill="#FC4F15" />
          <circle cx="92" cy="120" r="34" fill="#FC4F15" opacity=".25" />
          <circle cx="320" cy="300" r="22" fill="#FC4F15" opacity=".35" />
        </svg>
      </section>
      <section className="auth-form">{children}</section>
    </div>
  );
}
