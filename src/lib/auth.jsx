import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);
  const [recovery, setRecovery] = useState(false); // arrived from a "reset your password" email link

  const loadProfile = useCallback(async (sess) => {
    if (!sess) { setProfile(null); return; }
    const { data, error } = await supabase.from("profiles").select("*").eq("id", sess.user.id).maybeSingle();
    if (error) { setProfileError(error.message); setProfile(null); return; }
    setProfileError(data ? (data.status !== "active" ? "This account has been deactivated." : null) : "No portal profile is linked to this login.");
    setProfile(data && data.status === "active" ? data : null);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      loadProfile(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") loadProfile(sess);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const value = {
    session,
    profile,
    profileError,
    loading: session === undefined || (session && !profile && !profileError),
    refreshProfile: () => loadProfile(session),
    signOut: () => forceSignOut(),
    recovery,
    endRecovery: () => {
      setRecovery(false);
      // tidy the one-time ?code=… from the address bar
      if (window.location.search) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    },
    isAdmin: !!profile && (profile.role === "admin" || profile.role === "superadmin" || profile.is_fin_link),
    isSuperAdmin: !!profile && (profile.role === "superadmin" || profile.is_fin_link),
    isFinLink: !!profile?.is_fin_link,
    canSeeNumbers: !!profile && (["admin", "superadmin", "owner"].includes(profile.role) || profile.is_fin_link),
    canManageNumbers: !!profile && (["admin", "superadmin"].includes(profile.role) || profile.is_fin_link),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

// Signing out must always work, even when the server has already ended the session (for example after a
// password reset). If the server refuses, clear this browser's copy of the session and go back to sign-in.
export async function forceSignOut() {
  try {
    const { error } = await supabase.auth.signOut();
    if (!error) return;
  } catch { /* fall through */ }
  try { await supabase.auth.signOut({ scope: "local" }); } catch { /* fall through */ }
  try { Object.keys(localStorage).filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token")).forEach((k) => localStorage.removeItem(k)); } catch { /* private mode */ }
  window.location.hash = "#/";
  window.location.reload();
}

// True when an auth error means "this login has ended" rather than "you typed something wrong".
export const isSessionGone = (err) => /session (missing|not found)|session_not_found|refresh token|jwt expired|invalid jwt/i.test(String(err?.message ?? err ?? "") + " " + String(err?.code ?? ""));
