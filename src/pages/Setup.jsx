import { useState } from "react";
import { callFn, supabase } from "../lib/supabase";
import AuthShell from "../components/AuthShell";
import { ErrorNote, Field, PasswordInput } from "../components/ui";

// First-run screen: only shown while the portal has no accounts. Creates the Fin-Link Main Admin.
export default function Setup({ onDone }) {
  const [f, setF] = useState({ full_name: "", email: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (f.password.length < 10) return setError("Use a password of at least 10 characters.");
    if (f.password !== f.confirm) return setError("The two passwords don’t match.");
    setBusy(true);
    try {
      await callFn("admin-users", { action: "bootstrap", full_name: f.full_name, email: f.email, password: f.password });
      const { error } = await supabase.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
      if (error) throw error;
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <form className="auth-card" onSubmit={submit}>
        <div>
          <p className="eyebrow">First-time setup</p>
          <h2>Create the first admin account</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            This account is the Fin-Link Main Admin. It can invite everyone else and sees the project plan and finances.
            This screen disappears once it’s done.
          </p>
        </div>
        <Field label="Full name" id="s-name"><input id="s-name" className="input" value={f.full_name} onChange={set("full_name")} required /></Field>
        <Field label="Email" id="s-email"><input id="s-email" className="input" type="email" autoComplete="username" value={f.email} onChange={set("email")} required /></Field>
        <Field label="Password" id="s-pw" hint="At least 10 characters."><PasswordInput id="s-pw" autoComplete="new-password" value={f.password} onChange={set("password")} required /></Field>
        <Field label="Confirm password" id="s-pw2"><PasswordInput id="s-pw2" autoComplete="new-password" value={f.confirm} onChange={set("confirm")} required /></Field>
        <ErrorNote error={error} />
        <button className="btn btn-primary" disabled={busy}>{busy ? "Creating…" : "Create admin account"}</button>
      </form>
    </AuthShell>
  );
}
