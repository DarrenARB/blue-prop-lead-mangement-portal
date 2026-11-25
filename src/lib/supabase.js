import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(SUPABASE_URL, KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Calls one of our Edge Functions and turns error bodies into readable messages.
export async function callFn(name, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: KEY,
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  let out = {};
  try { out = await res.json(); } catch { /* empty */ }
  if (!res.ok || out.error) throw new Error(out.error || `Something went wrong (${res.status}).`);
  return out;
}

// Throws on a Supabase query error, returns data otherwise.
export function must({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}
