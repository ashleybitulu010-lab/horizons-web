import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const POCKETBASE_URL = Deno.env.get('POCKETBASE_URL')
  || 'https://ashledger.tech/hcgi/platform';

const ALLOWED_ORIGINS = new Set([
  'https://ashledger.tech',
  'https://www.ashledger.tech',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

type PocketBaseRecord = {
  id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  airtableId?: string;
  airtable_id?: string;
};

type ClientRow = {
  id: string;
  user_id: string;
  auth_user_id: string | null;
};

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin');
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : 'https://ashledger.tech';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=UTF-8',
    Vary: 'Origin',
  };
}

function json(request: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(request),
  });
}

function displayName(record: PocketBaseRecord) {
  const fullName = [record.firstName, record.lastName].filter(Boolean).join(' ').trim();
  return fullName || record.name || record.email || `Utilisateur ${record.id || ''}`.trim();
}

function identifierCandidates(record: PocketBaseRecord) {
  return Array.from(new Set([
    record.airtableId,
    record.airtable_id,
    record.id,
    record.email,
  ].filter((value): value is string => Boolean(value))));
}

async function validatePocketBaseToken(authorization: string) {
  const response = await fetch(
    `${POCKETBASE_URL.replace(/\/$/, '')}/api/collections/users/auth-refresh`,
    {
      method: 'POST',
      headers: {
        Authorization: authorization,
        Accept: 'application/json; charset=UTF-8',
      },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) return null;
  const payload = await response.json();
  return (payload?.record || payload) as PocketBaseRecord;
}

async function getOrCreateClient(
  admin: ReturnType<typeof createClient>,
  record: PocketBaseRecord,
) {
  const candidates = identifierCandidates(record);
  if (!record.id || !candidates.length) {
    throw new Error('PocketBase user has no stable identifier');
  }

  const { data: existing, error: findError } = await admin
    .from('clients')
    .select('id,user_id,auth_user_id')
    .in('user_id', candidates)
    .limit(1)
    .maybeSingle();

  if (findError) throw findError;
  if (existing) return existing as ClientRow;

  const canonicalUserId = record.airtableId || record.airtable_id || record.id;
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 30);
  const { data: created, error: createError } = await admin
    .from('clients')
    .insert({
      user_id: canonicalUserId,
      nom_client: displayName(record) || 'Client',
      date_inscription: now.toISOString(),
      date_fin_abonnement: end.toISOString(),
      thread_id: '[]',
    })
    .select('id,user_id,auth_user_id')
    .single();

  if (!createError && created) return created as ClientRow;

  // A parallel request may have initialized this PocketBase account.
  const { data: concurrent, error: concurrentError } = await admin
    .from('clients')
    .select('id,user_id,auth_user_id')
    .eq('user_id', canonicalUserId)
    .maybeSingle();

  if (concurrentError) throw concurrentError;
  if (concurrent) return concurrent as ClientRow;
  throw createError || new Error('Unable to initialize client');
}

async function findAuthUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email === email);
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
  return null;
}

async function getOrCreateAuthUser(
  admin: ReturnType<typeof createClient>,
  client: ClientRow,
  record: PocketBaseRecord,
) {
  if (client.auth_user_id) {
    const { data, error } = await admin.auth.admin.getUserById(client.auth_user_id);
    if (!error && data.user?.email) return data.user;
  }

  if (!record.id) throw new Error('PocketBase user id is missing');
  const email = `pb-${record.id.toLowerCase()}@auth.ashledger.local`;

  let authUser = await findAuthUserByEmail(admin, email);
  if (!authUser) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        pocketbase_user_id: record.id,
        source: 'pocketbase',
      },
    });
    if (error) {
      authUser = await findAuthUserByEmail(admin, email);
      if (!authUser) throw error;
    } else {
      authUser = data.user;
    }
  }

  const { data: linked, error: linkError } = await admin
    .from('clients')
    .update({ auth_user_id: authUser.id })
    .eq('id', client.id)
    .select('auth_user_id')
    .single();

  if (!linkError && linked?.auth_user_id === authUser.id) return authUser;

  const { data: concurrent, error: concurrentError } = await admin
    .from('clients')
    .select('auth_user_id')
    .eq('id', client.id)
    .single();

  if (concurrentError) throw concurrentError;
  if (concurrent?.auth_user_id) {
    const { data, error } = await admin.auth.admin.getUserById(concurrent.auth_user_id);
    if (!error && data.user?.email) return data.user;
  }
  throw linkError || new Error('Unable to link Supabase auth user');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== 'POST') {
    return json(request, 405, { error: 'Method not allowed' });
  }

  const origin = request.headers.get('origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json(request, 403, { error: 'Origin not allowed' });
  }

  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    return json(request, 401, { error: 'PocketBase authentication required' });
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(request, 500, { error: 'Supabase function is not configured' });
  }

  try {
    const record = await validatePocketBaseToken(authorization);
    if (!record?.id) {
      return json(request, 401, { error: 'Invalid PocketBase session' });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const client = await getOrCreateClient(admin, record);
    const authUser = await getOrCreateAuthUser(admin, client, record);

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: authUser.email!,
    });
    if (linkError || !link.properties?.hashed_token) {
      throw linkError || new Error('Unable to generate dashboard session');
    }

    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: verified, error: verifyError } = await authClient.auth.verifyOtp({
      type: 'magiclink',
      token_hash: link.properties.hashed_token,
    });
    if (verifyError || !verified.session) {
      throw verifyError || new Error('Unable to verify dashboard session');
    }

    return json(request, 200, {
      access_token: verified.session.access_token,
      refresh_token: verified.session.refresh_token,
      expires_at: verified.session.expires_at,
      token_type: verified.session.token_type,
      client_id: client.id,
    });
  } catch (error) {
    console.error('dashboard-session error', error instanceof Error ? error.message : error);
    return json(request, 500, { error: 'Unable to create dashboard session' });
  }
});
