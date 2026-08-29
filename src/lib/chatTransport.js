/**
 * Phase 3.7 — chat transport with Ashy → n8n fallback for read routes.
 */

import { sendAshyChatMessage } from './ashyChatApi.js';
import { sendN8nChatMessage } from './n8nChatApi.js';
import { CHAT_ROUTE } from './chatRouter.js';

/**
 * Ashy attempt failed — eligible for n8n fallback (HTTP 4xx/5xx only).
 */
export function shouldFallbackAshyToN8n(ashyResponse) {
  return Boolean(ashyResponse && ashyResponse.route === 'ashy' && !ashyResponse.ok);
}

function buildN8nPayload({
  message,
  sessionId,
  user,
  stableId,
  currency,
  recentMessages,
  token,
}) {
  return {
    message,
    sessionId,
    user,
    stableId,
    currency,
    recentMessages,
    token,
  };
}

/**
 * Resolve chat backend call with at most 1 Ashy + 1 n8n attempt.
 *
 * @returns {Promise<{ ok: boolean, status: number, rawText: string, data: object, route: 'ashy' | 'n8n', ashyFallback?: boolean }>}
 */
export async function fetchChatResponse({
  message,
  chatRoute,
  sessionId,
  user,
  stableId,
  currency,
  recentMessages,
  token,
  sendAshy = sendAshyChatMessage,
  sendN8n = sendN8nChatMessage,
}) {
  const n8nPayload = buildN8nPayload({
    message,
    sessionId,
    user,
    stableId,
    currency,
    recentMessages,
    token,
  });

  if (chatRoute !== CHAT_ROUTE.ASHY) {
    return sendN8n(n8nPayload);
  }

  let ashyResponse;
  try {
    ashyResponse = await sendAshy({ message, sessionId, token });
  } catch {
    const n8nResponse = await sendN8n(n8nPayload);
    return { ...n8nResponse, ashyFallback: true };
  }

  if (ashyResponse.ok) {
    return ashyResponse;
  }

  const n8nResponse = await sendN8n(n8nPayload);
  return { ...n8nResponse, ashyFallback: true };
}
