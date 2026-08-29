/**
 * Phase 3.7 — client for POST /api/ashy/chat (read-only Ashy backend).
 */

import apiServerClient from './apiServerClient.js';

/**
 * @returns {Promise<{ ok: boolean, status: number, rawText: string, data: object, route: 'ashy' }>}
 */
export async function sendAshyChatMessage({
  message,
  sessionId,
  token,
}) {
  const headers = {
    'Content-Type': 'application/json; charset=UTF-8',
    Accept: 'application/json; charset=UTF-8',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await apiServerClient.fetch('/api/ashy/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: String(message || '').trim(),
      sessionId: sessionId || 'default',
    }),
  });

  const rawText = await res.text();
  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = {};
  }

  return {
    ok: res.ok,
    status: res.status,
    rawText,
    data,
    route: 'ashy',
  };
}
