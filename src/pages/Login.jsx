import { useState } from "react";
import { supabase } from "../lib/supabase";
import AuthShell from "../components/AuthShell";
import { ErrorNote, Field } from "../components/ui";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message === "Invalid login credentials" ? "That email and password don’t match." : error.message);
  }

  return (
    <AuthShell>
      <form className="auth-card" onSubmit={submit}>
        <div>
          <h2>Sign in</h2>
          <p className="muted" style={{ marginTop: 6 }}>Use the email and password your Main Admin gave you.</p>
        </div>
        <Field label="Email" id="email">
          <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" id="password">
          <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorNote error={error} />
        <button className="btn btn-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="muted small">Forgot your password? Ask your Main Admin to reset it.</p>
      </form>
    </AuthShell>
  );
}
