import logger from '../utils/logger.js';
import { pocketbaseClient as pb } from '../utils/pocketbaseClient.js';

const N8N_GET_USER_WEBHOOK = process.env.N8N_GET_USER_WEBHOOK;

export const getAirtableId = async (req, res) => {
  const user = req.user;

  if (!N8N_GET_USER_WEBHOOK) {
    return res.json({ airtableId: user.airtableId || null });
  }

  const upstream = await fetch(N8N_GET_USER_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: user.email,
      userId: user.businessUserId || user.id,
      pbUserId: user.id,
    }),
    signal: AbortSignal.timeout(10000),
  });

  const rawBody = await upstream.text();
  logger.info(`n8n getAirtableId status: ${upstream.status}`);

  if (!upstream.ok) {
    throw new Error(`n8n getAirtableId failed: ${upstream.status} ${upstream.statusText}`);
  }

  if (!rawBody || !rawBody.trim()) {
    return res.json({ airtableId: null });
  }

  let data;
  try {
    data = JSON.parse(rawBody);
  } catch {
    logger.warn(`getAirtableId non-JSON: ${rawBody}`);
    return res.json({ airtableId: null });
  }

  const airtableId =
    data.airtableId ??
    data.id ??
    data.recordId ??
    data.record_id ??
    (Array.isArray(data) && data[0]?.id) ??
    null;

  res.json({ airtableId });
};

const SIGNUP_WEBHOOK = process.env.N8N_SIGNUP_WEBHOOK;
const LOGIN_WEBHOOK = process.env.N8N_LOGIN_WEBHOOK;
const DEV_MODE = process.env.DEV_MODE === 'true';

async function callWebhook(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  return { ok: res.ok, status: res.status, data };
}

export const signup = async (req, res) => {
  const { email, firstName, lastName, password } = req.body ?? {};
  if (!email || !firstName || !lastName || !password) {
    return res.status(422).json({ error: 'email, firstName, lastName and password are required' });
  }

  const name = `${firstName} ${lastName}`.trim();

  // In dev mode: delete existing user with same email and re-create
  if (DEV_MODE) {
    try {
      const existing = await pb.collection('users').getFirstListItem(`email="${email}"`);
      if (existing) {
        await pb.collection('users').delete(existing.id);
      }
    } catch (e) {
      // No existing user — that's fine
    }

    try {
      const record = await pb.collection('users').create({
        email,
        name,
        firstName,
        lastName,
        password,
        passwordConfirm: password,
      });
      return res.json({
        success: true,
        devMode: true,
        message: 'Compte de test mis à jour avec succès',
        userId: record.id,
      });
    } catch (err) {
      const details = err?.response?.data || err?.data || {};
      return res.status(400).json({ error: 'Signup failed', details });
    }
  }

  // Production mode: standard creation (fails on duplicate)
  if (SIGNUP_WEBHOOK) {
    const { ok, status, data } = await callWebhook(SIGNUP_WEBHOOK, { email, name, firstName, lastName, password });
    if (!ok) {
      const msg = (typeof data === 'object' && (data.message || data.error)) || 'Signup failed';
      return res.status(status).json({ error: msg });
    }
    return res.json({ success: true, data });
  }

  // Fallback: direct PocketBase creation
  try {
    const record = await pb.collection('users').create({
      email,
      name,
      firstName,
      lastName,
      password,
      passwordConfirm: password,
    });
    return res.json({ success: true, userId: record.id });
  } catch (err) {
    const details = err?.response?.data || err?.data || {};
    return res.status(400).json({ error: 'Signup failed', details });
  }
};

export const login = async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(422).json({ error: 'email and password are required' });
  }
  if (!LOGIN_WEBHOOK) {
    return res.status(503).json({ error: 'Login service not configured (N8N_LOGIN_WEBHOOK missing)' });
  }
  const { ok, status, data } = await callWebhook(LOGIN_WEBHOOK, { email, password });
  if (!ok) {
    const msg = (typeof data === 'object' && (data.message || data.error)) || 'Invalid credentials';
    return res.status(status).json({ error: msg });
  }
  const token =
    (typeof data === 'object' && (data.token || data.accessToken || data.access_token)) || null;
  const user =
    (typeof data === 'object' && data.user) ||
    { email, name: (typeof data === 'object' && data.name) || email.split('@')[0] };
  res.json({ token, user });
};
