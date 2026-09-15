import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

// These are client-safe public identifiers. Vercel env vars still take precedence.
// Keeping the fallback makes the Git-imported deployment immediately usable while
// all privileged credentials remain server-only.
const FALLBACK_SUPABASE_URL = "https://tlyczyfsboqrtrdpwizp.supabase.co";
const FALLBACK_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_gMTGwNPjdwgNuzzRPpUPyA_ezrPfCrT";

function publicConfig() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || FALLBACK_SUPABASE_PUBLISHABLE_KEY
  };
}

export function isSupabaseConfigured() {
  const { url, key } = publicConfig();
  return Boolean(url && key);
}

export function getSupabase() {
  if (client !== undefined) return client;
  const { url, key } = publicConfig();
  client = url && key ? createClient(url, key) : null;
  return client;
}
