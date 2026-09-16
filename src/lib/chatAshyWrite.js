/**
 * Phase 3.9 + 4.1 — Ashy write flow helpers (routing state + response detection).
 */

import {
  extractClassificationText,
  isAshyWriteConfirmationMessage,
  isCreateExpenseIntent,
  isCreateExpenseSlotFillContinuation,
  isCreateSaleIntent,
  isCreateSaleSlotFillContinuation,
} from './chatRouter.js';
import { CHAT_ROUTE } from './chatRouter.js';

const ASHY_WRITE_SUCCESS_TOOLS = new Set(['create_sale', 'create_expense']);

export function isAshyPendingWriteConfirmationResponse(response) {
  if (!response || response.route !== 'ashy') return false;
  if (response.ashyFallbackBlocked) return false;

  const v2Status = response.data?.v2Http?.actionProposalStatus;
  if (v2Status === 'READY_FOR_CONFIRMATION' || v2Status === 'NEEDS_CLARIFICATION') {
    return true;
  }

  if (!response.ok) return false;

  const results = response.data?.toolResults;
  if (Array.isArray(results)) {
    return results.some(
      (r) => r?.error?.code === 'NEEDS_CONFIRMATION' || r?.meta?.requiresConfirmation,
    );
  }
  const reply = String(response.data?.reply || '');
  return /Je confirme\s*\?/i.test(reply);
}

export function isAshyWriteSuccessResponse(response) {
  if (!response || response.route !== 'ashy' || !response.ok || response.ashyFallback) {
    return false;
  }
  const results = response.data?.toolResults;
  return Array.isArray(results)
    && results.some((r) => r?.success && ASHY_WRITE_SUCCESS_TOOLS.has(r?.tool));
}

/** @deprecated use isAshyWriteSuccessResponse */
export function isAshyCreateSaleSuccessResponse(response) {
  if (!response || response.route !== 'ashy' || !response.ok || response.ashyFallback) {
    return false;
  }
  const results = response.data?.toolResults;
  return Array.isArray(results)
    && results.some((r) => r?.success && r?.tool === 'create_sale');
}

function isAshyWriteSlotFillContinuation(text) {
  return isCreateSaleSlotFillContinuation(text) || isCreateExpenseSlotFillContinuation(text);
}

function isAshyRoutedWriteIntent(text) {
  return isCreateSaleIntent(text) || isCreateExpenseIntent(text);
}

export function computeNextPendingAshyWrite({
  previousPending,
  chatRoute,
  chatResponse,
  userMessage,
}) {
  if (chatResponse?.ashyFallback || chatResponse?.ashyFallbackBlocked || chatRoute === CHAT_ROUTE.N8N) {
    return false;
  }

  if (isAshyWriteSuccessResponse(chatResponse)) {
    return false;
  }

  const text = extractClassificationText(userMessage);

  if (chatRoute !== CHAT_ROUTE.ASHY) {
    return false;
  }

  if (isAshyPendingWriteConfirmationResponse(chatResponse)) {
    return true;
  }

  if (isAshyRoutedWriteIntent(text)) {
    return true;
  }

  if (previousPending && (
    isAshyWriteConfirmationMessage(text)
    || isAshyWriteSlotFillContinuation(text)
  )) {
    return true;
  }

  if (previousPending && chatResponse?.ok) {
    const results = chatResponse.data?.toolResults;
    if (!Array.isArray(results) || results.length === 0) {
      return true;
    }
  }

  return false;
}
