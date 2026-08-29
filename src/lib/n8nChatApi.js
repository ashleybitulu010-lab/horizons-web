/**
 * Phase 3.7 — client for POST /chat (n8n proxy). Payload unchanged from pre-3.7 ChatContext.
 */

import apiServerClient from './apiServerClient.js';

/**
 * @returns {Promise<{ ok: boolean, status: number, rawText: string, data: object, route: 'n8n' }>}
 */
export async function sendN8nChatMessage({
  message,
  sessionId,
  user,
  stableId,
  currency,
  recentMessages,
  token,
}) {
  const headers = {
    'Content-Type': 'application/json; charset=UTF-8',
    Accept: 'application/json; charset=UTF-8',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await apiServerClient.fetch('/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message,
      sessionId: sessionId || stableId || user?.email || 'default',
      session_id: sessionId || stableId || user?.email || 'default',
      userId: stableId || '',
      airtableId: user?.airtableId || null,
      pbUserId: user?.id || '',
      firstName: user?.firstName || user?.name?.split(' ')[0] || '',
      lastName: user?.lastName || user?.name?.split(' ').slice(1).join(' ') || '',
      email: user?.email || '',
      currency: currency.currency || currency.displayCurrency,
      ledgerCurrency: currency.currency || currency.ledgerCurrency,
      usdCdfRate: currency.usdCdfRate,
      recent_messages: recentMessages,
      encoding: 'UTF-8',
      responseEncoding: 'UTF-8',
      emojiFont: 'Noto Color Emoji',
      pdfEncoding: 'UTF-8',
      pdfEmojiFonts: [
        'Noto Color Emoji',
        'Apple Color Emoji',
        'Segoe UI Emoji',
      ],
      reportCurrency: currency.currency || currency.displayCurrency,
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
    route: 'n8n',
  };
}
