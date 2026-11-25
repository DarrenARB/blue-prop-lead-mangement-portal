import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);

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
    signOut: () => supabase.auth.signOut(),
    isAdmin: !!profile && (profile.role === "admin" || profile.is_fin_link),
    isFinLink: !!profile?.is_fin_link,
    canSeeNumbers: !!profile && (profile.role === "admin" || profile.role === "support" || profile.role === "owner" || profile.is_fin_link),
    canManageNumbers: !!profile && (profile.role === "admin" || profile.role === "support" || profile.is_fin_link),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
