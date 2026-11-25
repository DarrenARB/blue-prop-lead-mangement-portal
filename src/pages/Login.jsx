import { useState } from "react";
import { supabase } from "../lib/supabase";
import AuthShell from "../components/AuthShell";
import { ErrorNote, Field, PasswordInput } from "../components/ui";

export default function Login() {
  const [view, setView] = useState("signin"); // signin | forgot | sent
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(null); // 'email' once reset emails are switched on, otherwise 'admin'

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message === "Invalid login credentials" ? "That email and password don’t match." : error.message);
  }

  async function forgot(e) {
    e.preventDefault();
    const addr = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return setError("Enter the email address you sign in with.");
    setBusy(true); setError(null);
    try {
      const { data: how } = await supabase.rpc("password_reset_mode");
      setMode(how === "email" ? "email" : "admin");
      if (how === "email") {
        // The link brings them back here to choose a new password.
        const { error } = await supabase.auth.resetPasswordForEmail(addr, { redirectTo: window.location.origin + window.location.pathname });
        if (error && !/rate limit/i.test(error.message)) throw error;
      } else {
        const { error } = await supabase.rpc("request_password_help", { p_email: addr });
        if (error) throw error;
      }
      setView("sent");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (view === "sent") {
    return (
      <AuthShell>
        <div className="auth-card">
          <div>
            <h2>{mode === "email" ? "Check your email" : "Request sent"}</h2>
            <p className="muted" style={{ marginTop: 6 }}>
              {mode === "email"
                ? `If ${email.trim()} has a portal account, we’ve sent it a link to choose a new password. The link works once and expires after an hour. Check your spam folder if it doesn’t arrive in a few minutes.`
                : `If ${email.trim()} has a portal account, your Main Admin has been told you need a new password. They’ll send you a temporary one to sign in with, and you’ll then choose your own.`}
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => { setView("signin"); setPassword(""); }}>Back to sign in</button>
        </div>
      </AuthShell>
    );
  }

  if (view === "forgot") {
    return (
      <AuthShell>
        <form className="auth-card" onSubmit={forgot}>
          <div>
            <h2>Forgot your password?</h2>
            <p className="muted" style={{ marginTop: 6 }}>Enter the email you sign in with and we’ll help you set a new password.</p>
          </div>
          <Field label="Email" id="fp-email">
            <input id="fp-email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <ErrorNote error={error} />
          <button className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Reset my password"}</button>
          <button type="button" className="btn-link small" style={{ alignSelf: "flex-start" }} onClick={() => { setView("signin"); setError(null); }}>Back to sign in</button>
        </form>
      </AuthShell>
    );
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
          <PasswordInput id="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorNote error={error} />
        <button className="btn btn-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <button type="button" className="btn-link small" style={{ alignSelf: "flex-start" }} onClick={() => { setView("forgot"); setError(null); }}>Forgot your password?</button>
      </form>
    </AuthShell>
  );
}
