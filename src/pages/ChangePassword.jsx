import { useState } from "react";
import { supabase } from "../lib/supabase";
import { forceSignOut, isSessionGone, useAuth } from "../lib/auth";
import AuthShell from "../components/AuthShell";
import { ErrorNote, Field, PasswordInput, useToast } from "../components/ui";

export default function ChangePassword({ forced, recovery }) {
  const { profile, refreshProfile, signOut, endRecovery } = useAuth();
  const toast = useToast();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [expired, setExpired] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (pw.length < 10) return setError("Use at least 10 characters.");
    if (pw !== pw2) return setError("The two passwords don’t match.");
    if (/^Bp-/.test(pw)) return setError("Choose your own password, not a temporary one.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) {
      setBusy(false);
      if (isSessionGone(error)) {
        setExpired(true);
        return;
      }
      return setError(error.message);
    }
    await supabase.rpc("mark_password_changed");
    await refreshProfile();
    if (recovery) endRecovery();
    setBusy(false); setPw(""); setPw2("");
    toast("Password changed");
  }

  if (expired) {
    const box = (
      <div className={forced ? "auth-card" : "card stack"} style={forced ? undefined : { maxWidth: 480 }}>
        <h2>Please sign in again</h2>
        <p className="muted">This login was ended, usually because the password was reset after you signed in. Sign in with the most recent temporary password you were given, then choose your own.</p>
        <button className="btn btn-primary" onClick={forceSignOut}>Back to sign in</button>
      </div>
    );
    return forced ? <AuthShell>{box}</AuthShell> : box;
  }

  const form = (
    <form className={forced ? "auth-card" : "card stack"} style={forced ? undefined : { maxWidth: 480 }} onSubmit={submit}>
      {forced && (
        <div>
          <h2>{recovery ? "Choose a new password" : `Welcome, ${profile.full_name.split(" ")[0]}`}</h2>
          <p className="muted" style={{ marginTop: 6 }}>{recovery ? `For ${profile.email}. You’ll stay signed in once it’s saved.` : "You signed in with a temporary password. Choose your own to continue."}</p>
        </div>
      )}
      <Field label="New password" id="np" hint="At least 10 characters."><PasswordInput id="np" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
      <Field label="Confirm new password" id="np2"><PasswordInput id="np2" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></Field>
      <ErrorNote error={error} />
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
        {forced && <button type="button" className="btn" onClick={signOut}>Sign out</button>}
      </div>
    </form>
  );

  if (forced) return <AuthShell>{form}</AuthShell>;
  return (
    <>
      <div className="page-head"><div><h1>Change password</h1></div></div>
      {form}
    </>
  );
}
