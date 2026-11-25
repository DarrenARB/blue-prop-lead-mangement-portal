import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "./lib/auth";
import { supabase } from "./lib/supabase";
import { Spinner } from "./components/ui";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import ChangePassword from "./pages/ChangePassword";
import Home from "./pages/Home";
import Team from "./pages/Team";
import Branches from "./pages/Branches";
import Lemlist from "./pages/Lemlist";
import Plan from "./pages/Plan";
import Audit from "./pages/Audit";

export default function App() {
  const { session, profile, profileError, loading, isAdmin, canSeeNumbers, signOut } = useAuth();
  const [setUp, setSetUp] = useState(null);

  useEffect(() => {
    supabase.rpc("portal_is_set_up").then(({ data, error }) => setSetUp(error ? true : !!data));
  }, [session]);

  if (setUp === null || loading) return <div className="auth-form" style={{ minHeight: "100vh" }}><Spinner /></div>;
  if (!setUp) return <Setup onDone={() => setSetUp(true)} />;
  if (!session) return <Login />;
  if (!profile) {
    return (
      <div className="auth-form" style={{ minHeight: "100vh" }}>
        <div className="auth-card">
          <h2>Can’t open the portal</h2>
          <div className="note note-bad">{profileError || "Your account isn’t set up yet."}</div>
          <p className="muted">Ask your Main Admin to check your account.</p>
          <button className="btn" onClick={signOut}>Sign out</button>
        </div>
      </div>
    );
  }
  if (profile.must_change_password) return <ChangePassword forced />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="branches" element={isAdmin ? <Branches /> : <Navigate to="/" />} />
        <Route path="team" element={isAdmin ? <Team /> : <Navigate to="/" />} />
        <Route path="lemlist" element={canSeeNumbers ? <Lemlist /> : <Navigate to="/" />} />
        <Route path="plan" element={isAdmin ? <Plan /> : <Navigate to="/" />} />
        <Route path="audit" element={isAdmin ? <Audit /> : <Navigate to="/" />} />
        <Route path="password" element={<ChangePassword />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  );
}
