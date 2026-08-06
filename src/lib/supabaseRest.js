import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://knrwplidgvuvjnuqqmrt.supabase.co';
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export function supabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON);
}

export const supabase = supabaseConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })
  : null;

export async function supabaseSelect(table, query) {
  if (!supabaseConfigured()) return null;
  const qs = query.startsWith('?') ? query : `?${query}`;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const authorization = sessionData.session?.access_token || SUPABASE_ANON;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs}`, {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${authorization}`,
        Accept: 'application/json; charset=UTF-8',
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Resolve Supabase clients.id from PocketBase / Airtable user identifiers. */
export async function resolveClientId(user) {
  if (!user) return null;
  const candidates = [user.airtableId, user.id, user.email].filter(Boolean);
  for (const userId of candidates) {
    const rows = await supabaseSelect(
      'clients',
      `user_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`,
    );
    if (Array.isArray(rows) && rows[0]?.id) return rows[0].id;
  }
  return null;
}

/**
 * Exchange the current PocketBase session for a short-lived Supabase session.
 * The Edge Function validates PocketBase before linking the matching client.
 */
export async function createDashboardSession(pocketBaseToken) {
  if (!supabase || !pocketBaseToken) {
    throw new Error('PocketBase authentication is required');
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/dashboard-session`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${pocketBaseToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      Accept: 'application/json; charset=UTF-8',
    },
    body: '{}',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to create dashboard session');
  }
  if (!payload.access_token || !payload.refresh_token || !payload.client_id) {
    throw new Error('Dashboard session response is incomplete');
  }

  const { error } = await supabase.auth.setSession({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
  });
  if (error) throw error;
  await supabase.realtime.setAuth(payload.access_token);
  return payload.client_id;
}
