import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://knrwplidgvuvjnuqqmrt.supabase.co';
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_STORAGE_KEY = 'ash-supabase-auth';
const CLIENT_ID_KEY = 'ash_supabase_client_id';

export function supabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON);
}

function browserStorage() {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage;
}

/** Persist Supabase Auth like a native app (survives reload + PWA relaunch). */
export const supabase = supabaseConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: browserStorage(),
      storageKey: SUPABASE_STORAGE_KEY,
    },
  })
  : null;

function readStoredClientId() {
  try {
    return localStorage.getItem(CLIENT_ID_KEY);
  } catch {
    return null;
  }
}

function writeStoredClientId(clientId) {
  try {
    if (clientId) localStorage.setItem(CLIENT_ID_KEY, clientId);
    else localStorage.removeItem(CLIENT_ID_KEY);
  } catch {
    /* ignore */
  }
}

async function sessionStillValid(minTtlMs = 60_000) {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) return null;
  const expiresAtMs = (data.session.expires_at || 0) * 1000;
  if (expiresAtMs && expiresAtMs <= Date.now() + minTtlMs) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshed.session?.access_token) return null;
    return refreshed.session;
  }
  return data.session;
}

export async function supabaseSelect(table, query) {
  if (!supabaseConfigured()) return null;
  const qs = query.startsWith('?') ? query : `?${query}`;
  try {
    const session = await sessionStillValid();
    const authorization = session?.access_token || SUPABASE_ANON;
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
 * Exchange PocketBase token for a persisted Supabase session.
 * Reuses / refreshes an existing session when still valid (Remember me).
 */
export async function createDashboardSession(pocketBaseToken) {
  if (!supabase || !pocketBaseToken) {
    throw new Error('PocketBase authentication is required');
  }

  const existing = await sessionStillValid(90_000);
  const storedClientId = readStoredClientId();
  if (existing?.access_token && storedClientId) {
    await supabase.realtime.setAuth(existing.access_token);
    return storedClientId;
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

  writeStoredClientId(payload.client_id);
  await supabase.realtime.setAuth(payload.access_token);
  return payload.client_id;
}

/** Clear persisted Supabase Auth (explicit logout only). */
export async function clearDashboardSession() {
  writeStoredClientId(null);
  if (!supabase) return;
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    /* ignore */
  }
}
