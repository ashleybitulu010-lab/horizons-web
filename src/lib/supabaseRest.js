import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://knrwplidgvuvjnuqqmrt.supabase.co';
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export function supabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON);
}

/**
 * Supabase is used as a data client only: application authentication remains
 * in PocketBase and every dashboard request is explicitly scoped by client_id.
 */
export const supabase = supabaseConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  : null;

export async function supabaseSelect(table, query) {
  if (!supabaseConfigured()) return null;
  const qs = query.startsWith('?') ? query : `?${query}`;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs}`, {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
        Accept: 'application/json',
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
