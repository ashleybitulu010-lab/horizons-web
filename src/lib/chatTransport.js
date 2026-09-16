/**
 * Phase 3.7 + H4 — chat transport with Ashy → n8n fallback (READ only when safe).
 */

import { sendAshyChatMessage } from './ashyChatApi.js';
import { sendN8nChatMessage } from './n8nChatApi.js';
import { CHAT_ROUTE } from './chatRouter.js';
import {
  buildAshyBlockedFallbackResponse,
  resolveAshyFallbackDecision,
} from './ashyFallbackPolicy.js';

/**
 * Ashy attempt failed — eligible for n8n fallback only when policy allows.
 */
export function shouldFallbackAshyToN8n(ashyResponse, context = {}) {
  return resolveAshyFallbackDecision(ashyResponse, context).allowFallback;
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

function logFallbackDecision(decision, context = {}) {
  if (typeof console === 'undefined' || !console.info) return;
  const event = decision.allowFallback ? 'v2_read_fallback_n8n' : 'v2_fallback_blocked';
  console.info(`[chat-transport] ${event}`, {
    reason: decision.reason,
    policy: decision.policy,
    pendingAshyWrite: Boolean(context.pendingAshyWriteConfirmation),
  });
}

/**
 * Resolve chat backend call with at most 1 Ashy + 1 n8n attempt.
 *
 * @returns {Promise<{ ok: boolean, status: number, rawText: string, data: object, route: 'ashy' | 'n8n', ashyFallback?: boolean, ashyFallbackBlocked?: boolean, noN8nFallback?: boolean, fallbackPolicy?: string }>}
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
  pendingAshyWriteConfirmation = false,
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

  const fallbackContext = {
    message,
    pendingAshyWriteConfirmation,
    chatRoute,
  };

  if (chatRoute !== CHAT_ROUTE.ASHY) {
    return sendN8n(n8nPayload);
  }

  let ashyResponse;
  try {
    ashyResponse = await sendAshy({ message, sessionId, token });
  } catch {
    const decision = resolveAshyFallbackDecision(null, {
      ...fallbackContext,
      networkError: true,
    });
    logFallbackDecision(decision, fallbackContext);
    if (!decision.allowFallback) {
      return buildAshyBlockedFallbackResponse(null, {
        ...fallbackContext,
        networkError: true,
      });
    }
    const n8nResponse = await sendN8n(n8nPayload);
    return { ...n8nResponse, ashyFallback: true };
  }

  if (ashyResponse.ok) {
    return ashyResponse;
  }

  const decision = resolveAshyFallbackDecision(ashyResponse, fallbackContext);
  logFallbackDecision(decision, fallbackContext);
  if (!decision.allowFallback) {
    return buildAshyBlockedFallbackResponse(ashyResponse, fallbackContext);
  }

  const n8nResponse = await sendN8n(n8nPayload);
  return { ...n8nResponse, ashyFallback: true };
}
