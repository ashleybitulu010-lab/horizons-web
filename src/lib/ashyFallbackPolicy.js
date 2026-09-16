/**
 * H4 — Ashy V2 ↔ n8n fallback safety boundary (client-side).
 */

import {
  extractClassificationText,
  isAshyWriteConfirmationMessage,
  isAshyWriteCancellationMessage,
  isCreateExpenseIntent,
  isCreateExpenseSlotFillContinuation,
  isCreateSaleIntent,
  isCreateSaleSlotFillContinuation,
} from './chatRouter.js';

export const V2_FALLBACK_POLICY = Object.freeze({
  SAFE_FALLBACK: 'SAFE_FALLBACK',
  NO_FALLBACK: 'NO_FALLBACK',
  AMBIGUOUS_WRITE: 'AMBIGUOUS_WRITE',
});

export const ASHY_ACTION_AMBIGUOUS_REPLY =
  'Je n’ai pas pu confirmer le résultat de cette opération. '
  + 'Elle peut avoir été enregistrée — vérifie ton historique avant de réessayer.';

export const ASHY_ACTION_ERROR_REPLY =
  'Je n’ai pas pu terminer cette opération. Aucune nouvelle écriture automatique n’a été lancée.';

/**
 * Whether this Ashy-bound message is a V2 financial action turn (proposal/confirm/clarify).
 */
export function isAshyActionRequest(message, { pendingAshyWriteConfirmation = false } = {}) {
  const text = extractClassificationText(message);
  if (!text) return false;

  if (pendingAshyWriteConfirmation) {
    if (
      isAshyWriteConfirmationMessage(text)
      || isAshyWriteCancellationMessage(text)
      || isCreateSaleSlotFillContinuation(text)
      || isCreateExpenseSlotFillContinuation(text)
    ) {
      return true;
    }
  }

  if (isCreateSaleIntent(text) || isCreateExpenseIntent(text)) {
    return true;
  }

  if (/^(?:ajoute(?:r|z)?|enregistr(?:e|er))\s+(?:une\s+)?d[eé]pense\b/i.test(text)) {
    return true;
  }

  if (/\bfinalement\b/i.test(text) && pendingAshyWriteConfirmation) {
    return true;
  }

  return false;
}

export function extractServerFallbackPolicy(ashyResponse) {
  const data = ashyResponse?.data || {};
  if (data.fallbackPolicy) return data.fallbackPolicy;
  if (data.v2Http?.fallbackPolicy) return data.v2Http.fallbackPolicy;
  return null;
}

export function extractServerNoN8nFallback(ashyResponse) {
  const data = ashyResponse?.data || {};
  if (data.noN8nFallback === true) return true;
  if (data.v2Http?.noN8nFallback === true) return true;
  return false;
}

/**
 * Decide if Ashy failure may fall back to n8n.
 */
export function resolveAshyFallbackDecision(ashyResponse, context = {}) {
  const {
    message = '',
    pendingAshyWriteConfirmation = false,
    networkError = false,
  } = context;

  if (extractServerNoN8nFallback(ashyResponse)) {
    return { allowFallback: false, policy: V2_FALLBACK_POLICY.NO_FALLBACK, reason: 'server_no_n8n_fallback' };
  }

  const serverPolicy = extractServerFallbackPolicy(ashyResponse);
  if (serverPolicy === V2_FALLBACK_POLICY.NO_FALLBACK) {
    return { allowFallback: false, policy: V2_FALLBACK_POLICY.NO_FALLBACK, reason: 'server_policy_no_fallback' };
  }
  if (serverPolicy === V2_FALLBACK_POLICY.AMBIGUOUS_WRITE) {
    return { allowFallback: false, policy: V2_FALLBACK_POLICY.AMBIGUOUS_WRITE, reason: 'server_policy_ambiguous' };
  }

  const actionRequest = isAshyActionRequest(message, { pendingAshyWriteConfirmation });

  if (actionRequest) {
    if (networkError || !ashyResponse?.ok) {
      return {
        allowFallback: false,
        policy: networkError ? V2_FALLBACK_POLICY.AMBIGUOUS_WRITE : V2_FALLBACK_POLICY.NO_FALLBACK,
        reason: networkError ? 'action_network_error' : 'action_http_error',
      };
    }
    return { allowFallback: false, policy: V2_FALLBACK_POLICY.NO_FALLBACK, reason: 'action_request' };
  }

  if (networkError) {
    return { allowFallback: true, policy: V2_FALLBACK_POLICY.SAFE_FALLBACK, reason: 'read_network_error' };
  }

  if (ashyResponse && !ashyResponse.ok) {
    return { allowFallback: true, policy: V2_FALLBACK_POLICY.SAFE_FALLBACK, reason: 'read_http_error' };
  }

  return { allowFallback: false, policy: V2_FALLBACK_POLICY.SAFE_FALLBACK, reason: 'ashy_ok' };
}

export function buildAshyBlockedFallbackResponse(ashyResponse, context = {}) {
  const decision = resolveAshyFallbackDecision(ashyResponse, context);
  const ambiguous = decision.policy === V2_FALLBACK_POLICY.AMBIGUOUS_WRITE
    || decision.reason === 'action_network_error';

  const serverReply = ashyResponse?.data?.reply;
  const reply = serverReply
    || (ambiguous ? ASHY_ACTION_AMBIGUOUS_REPLY : ASHY_ACTION_ERROR_REPLY);

  return {
    ok: false,
    status: ashyResponse?.status || 503,
    rawText: ashyResponse?.rawText || JSON.stringify({ reply }),
    data: {
      ...(ashyResponse?.data || {}),
      reply,
      noN8nFallback: true,
      fallbackPolicy: decision.policy,
      ashyFallbackBlocked: true,
    },
    route: 'ashy',
    ashyFallbackBlocked: true,
    fallbackPolicy: decision.policy,
    noN8nFallback: true,
  };
}
