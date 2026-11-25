import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import AuthShell from "../components/AuthShell";
import { ErrorNote, Field, useToast } from "../components/ui";

export default function ChangePassword({ forced }) {
  const { profile, refreshProfile, signOut } = useAuth();
  const toast = useToast();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (pw.length < 10) return setError("Use at least 10 characters.");
    if (pw !== pw2) return setError("The two passwords don’t match.");
    if (/^Bp-/.test(pw)) return setError("Choose your own password, not the temporary one.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { setBusy(false); return setError(error.message); }
    await supabase.rpc("mark_password_changed");
    await refreshProfile();
    setBusy(false); setPw(""); setPw2("");
    toast("Password changed");
  }

  const form = (
    <form className={forced ? "auth-card" : "card stack"} style={forced ? undefined : { maxWidth: 480 }} onSubmit={submit}>
      {forced && (
        <div>
          <h2>Welcome, {profile.full_name.split(" ")[0]}</h2>
          <p className="muted" style={{ marginTop: 6 }}>You signed in with a temporary password. Choose your own to continue.</p>
        </div>
      )}
      <Field label="New password" id="np" hint="At least 10 characters."><input id="np" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
      <Field label="Confirm new password" id="np2"><input id="np2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></Field>
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
