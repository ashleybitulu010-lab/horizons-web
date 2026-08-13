import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const POCKETBASE_URL = (Deno.env.get('POCKETBASE_URL') || 'https://ashledger.tech/hcgi/platform').replace(/\/$/, '');
const POCKETBASE_ADMIN_EMAIL = Deno.env.get('POCKETBASE_ADMIN_EMAIL') || '';
const POCKETBASE_ADMIN_PASSWORD = Deno.env.get('POCKETBASE_ADMIN_PASSWORD') || '';
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
const TELEGRAM_SUPPORT_CHAT_ID = String(Deno.env.get('TELEGRAM_SUPPORT_CHAT_ID') || '8970261173');
const SUPPORT_BRIDGE_SECRET = Deno.env.get('SUPPORT_BRIDGE_SECRET') || '';

const ALLOWED_ORIGINS = new Set([
  'https://ashledger.tech',
  'https://www.ashledger.tech',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

const CHAT_MARKER_RE = /\[SC:([a-z0-9]+)\]/i;

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin');
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://ashledger.tech';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-support-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=UTF-8',
    Vary: 'Origin',
  };
}

function json(request: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });
}

async function validatePocketBaseUser(authorization: string) {
  const response = await fetch(`${POCKETBASE_URL}/api/collections/users/auth-refresh`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      Accept: 'application/json; charset=UTF-8',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return (payload?.record || payload) as Record<string, unknown>;
}

async function pocketBaseAdminToken() {
  const endpoints = [
    `${POCKETBASE_URL}/api/collections/_superusers/auth-with-password`,
    `${POCKETBASE_URL}/api/admins/auth-with-password`,
  ];
  for (const url of endpoints) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        identity: POCKETBASE_ADMIN_EMAIL,
        password: POCKETBASE_ADMIN_PASSWORD,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) continue;
    const payload = await res.json();
    if (payload?.token) return String(payload.token);
  }
  throw new Error('Unable to authenticate PocketBase admin');
}

async function createSupportMessage(chatId: string, content: string) {
  const token = await pocketBaseAdminToken();
  const res = await fetch(`${POCKETBASE_URL}/api/collections/support_messages/records`, {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      chat: chatId,
      content,
      sender_type: 'support',
      is_read: false,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PocketBase create message failed: ${res.status} ${text}`);
  }
  return await res.json();
}

async function bumpUnread(chatId: string) {
  try {
    const token = await pocketBaseAdminToken();
    const getRes = await fetch(`${POCKETBASE_URL}/api/collections/support_chats/records/${chatId}`, {
      headers: { Authorization: token, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!getRes.ok) return;
    const chat = await getRes.json();
    const unread = Number(chat?.unread_count || 0) + 1;
    await fetch(`${POCKETBASE_URL}/api/collections/support_chats/records/${chatId}`, {
      method: 'PATCH',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ unread_count: unread }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* non-fatal */
  }
}

async function resolveClientIdentity(pbUser: Record<string, unknown>) {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const candidates = [
    pbUser.airtableId,
    pbUser.airtable_id,
    pbUser.id,
    pbUser.email,
  ].map((v) => String(v || '').trim()).filter(Boolean);

  let row: { id?: string; user_id?: string; email?: string; nom_client?: string } | null = null;
  if (candidates.length) {
    const { data } = await admin
      .from('clients')
      .select('id,user_id,email,nom_client')
      .in('user_id', candidates)
      .limit(1)
      .maybeSingle();
    row = data;
  }

  const firstName = String(pbUser.firstName || '').trim();
  const lastName = String(pbUser.lastName || '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const displayName = fullName
    || String(pbUser.name || '').trim()
    || row?.nom_client
    || String(pbUser.email || '').trim()
    || 'Client';

  return {
    clientPublicId: row?.user_id || String(pbUser.id || ''),
    clientUuid: row?.id || '',
    email: row?.email || String(pbUser.email || '').trim().toLowerCase() || '',
    displayName,
  };
}

function buildTelegramText(identity: {
  displayName: string;
  clientPublicId: string;
  email: string;
}, supportChatId: string, message: string) {
  return [
    '🟠 NOUVEAU MESSAGE — SERVICE CLIENT',
    `Client : ${identity.displayName}`,
    `ID client : ${identity.clientPublicId || '—'}`,
    `Email : ${identity.email || '—'}`,
    `Message :`,
    message,
    '',
    `[SC:${supportChatId}]`,
    '(Répondez à ce message pour répondre au client dans Ash Ledger)',
  ].join('\n');
}

async function sendTelegram(text: string, replyToMessageId?: number) {
  if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN missing');
  const payload: Record<string, unknown> = {
    chat_id: TELEGRAM_SUPPORT_CHAT_ID,
    text,
  };
  if (replyToMessageId) payload.reply_to_message_id = replyToMessageId;
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.ok) {
    throw new Error(`Telegram send failed: ${JSON.stringify(body)}`);
  }
  return body.result;
}

async function handleClientMessage(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    return json(request, 401, { error: 'PocketBase authentication required' });
  }
  const pbUser = await validatePocketBaseUser(authorization);
  if (!pbUser?.id) return json(request, 401, { error: 'Invalid PocketBase session' });

  const body = await request.json().catch(() => ({}));
  const message = String(body?.message || '').trim();
  const supportChatId = String(body?.chatId || body?.supportChatId || '').trim();
  if (!message) return json(request, 400, { error: 'message is required' });
  if (!supportChatId) return json(request, 400, { error: 'chatId is required' });

  const identity = await resolveClientIdentity(pbUser);
  const text = buildTelegramText(identity, supportChatId, message);
  const tg = await sendTelegram(text);

  return json(request, 200, {
    sent: true,
    telegramMessageId: tg?.message_id || null,
    clientPublicId: identity.clientPublicId,
    email: identity.email,
  });
}

function extractSupportChatId(update: Record<string, unknown>) {
  const message = (update.message || update.edited_message || {}) as Record<string, unknown>;
  const reply = (message.reply_to_message || {}) as Record<string, unknown>;
  const candidates = [reply.text, reply.caption, message.text, message.caption]
    .map((v) => String(v || ''));
  for (const text of candidates) {
    const match = text.match(CHAT_MARKER_RE);
    if (match?.[1]) return match[1];
  }
  return '';
}

async function handleTelegramWebhook(request: Request) {
  if (SUPPORT_BRIDGE_SECRET) {
    const headerSecret = request.headers.get('x-telegram-bot-api-secret-token')
      || request.headers.get('x-support-secret')
      || '';
    if (headerSecret !== SUPPORT_BRIDGE_SECRET) {
      return json(request, 401, { error: 'Invalid webhook secret' });
    }
  }

  const update = await request.json().catch(() => ({}));
  const message = (update.message || update.edited_message) as Record<string, unknown> | undefined;
  if (!message) return json(request, 200, { ignored: true, reason: 'no_message' });

  const chat = message.chat as Record<string, unknown> | undefined;
  const chatId = String(chat?.id || '');
  if (chatId && chatId !== TELEGRAM_SUPPORT_CHAT_ID) {
    return json(request, 200, { ignored: true, reason: 'wrong_chat' });
  }

  // Only accept replies to our tagged messages (prevents cross-client mixups)
  if (!message.reply_to_message) {
    return json(request, 200, {
      ignored: true,
      reason: 'reply_required',
      hint: 'Reply to the client message that contains [SC:...]',
    });
  }

  const supportChatId = extractSupportChatId(update);
  if (!supportChatId) {
    return json(request, 200, { ignored: true, reason: 'missing_sc_marker' });
  }

  const text = String(message.text || message.caption || '').trim();
  if (!text) return json(request, 200, { ignored: true, reason: 'empty' });

  await createSupportMessage(supportChatId, text);
  await bumpUnread(supportChatId);

  return json(request, 200, { delivered: true, supportChatId });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== 'POST') {
    return json(request, 405, { error: 'Method not allowed' });
  }

  const url = new URL(request.url);
  const isTelegram = url.pathname.endsWith('/telegram')
    || request.headers.get('x-telegram-bot-api-secret-token')
    || (request.headers.get('content-type') || '').includes('application/json')
      && url.searchParams.get('source') === 'telegram';

  try {
    // Telegram webhook path: /functions/v1/support-bridge/telegram
    if (url.pathname.includes('/telegram') || url.searchParams.get('source') === 'telegram') {
      return await handleTelegramWebhook(request);
    }

    // Heuristic: telegram updates have "update_id"
    const clone = request.clone();
    const peek = await clone.json().catch(() => null);
    if (peek && typeof peek === 'object' && 'update_id' in (peek as object)) {
      return await handleTelegramWebhook(new Request(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(peek),
      }));
    }

    return await handleClientMessage(request);
  } catch (error) {
    console.error('support-bridge error', error instanceof Error ? error.message : error);
    return json(request, 500, { error: 'support bridge failed' });
  }
});
