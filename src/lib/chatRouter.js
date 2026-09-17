/**
 * Phase 3.7 + 3.9 + 4.1 — conservative read/write classifier for chat routing.
 * Write-first when uncertain; create_sale/create_expense route to Ashy when write flag is ON.
 */

import { isAshyReadChatEnabled } from './ashyReadChatFlag.js';
import { isAshyWriteChatEnabled } from './ashyWriteChatFlag.js';
import { isMigratedReadIntent, READ_CAPABILITY } from './ashyReadMigration.js';

export const CHAT_ROUTE = Object.freeze({
  ASHY: 'ashy',
  N8N: 'n8n',
});

const CREATE_SALE_PREFIX = /^j['']?ai vendu\b/i;
const CREATE_EXPENSE_PREFIX = /^j['']?ai d[eé]pens[eé]/i;

const WRITE_PREFIX_PATTERNS = [
  CREATE_SALE_PREFIX,
  CREATE_EXPENSE_PREFIX,
  /^j['']?ai re[cç]u du stock/i,
  /^j['']?ai re[cç]u un paiement/i,
  /^je veux ajouter un nouveau produit/i,
  /^un client me doit\b/i,
  /^transf[eè]re\b/i,
  /^ajoute un client\b/i,
];

const WRITE_RECEIVED_PATTERN = /^j['']?ai re[cç]u\b/i;

const WRITE_ACTION_PATTERNS = [
  /\b(enregistr(?:e|er|é)|ajoute(?:r|z)?|cr[eé][eé](?:r|z)?|modifier|modifie(?:r|z)?|annule(?:r|z)?|supprime(?:r|z)?|retire(?:r|z)?)\b/i,
  /\b(annule|modifier|modifie|supprime|corrige)\b.*\b(vente|d[eé]pense|stock|produit|dette)/i,
];

const ASHY_WRITE_CONFIRMATION_PATTERN = /^(?:oui|yes|ok|confirme(?:r|z)?|je confirme|c['']est bon|vas[- ]?y)\b[!?.]*$/i;

const ASHY_WRITE_CANCEL_PATTERN = /^(?:non|no|annule(?:r|z)?)\b[!?.]*$/i;

const PDF_REQUEST_PATTERN = /\b(pdf|document|fichier|export(?:e)?|t[eé]l[eé]charg(?:e|er)|envoie[- ]?moi)\b/i;
const PDF_REPORT_CONTEXT_PATTERN = /\b(bilan|rapport|synth[eè]se|r[eé]sum[eé]|r[eé]cap(?:itulatif)?)\b/i;

const READ_PATTERNS = [
  /^(combien|quel(?:le)?|quels|montre|liste|donne|affiche|compare)\b/i,
  /^(?:et\s+)?(?:mes|les)\s+(?:ventes|d[eé]penses|dettes|produits)\s*\??$/i,
  /^(?:et\s+)?mon stock\s*\??$/i,
  /combien.*(?:vendu|ventes|d[eé]pens|reste|me doit)/i,
  /quel(?:le)?s?\s+(?:est\s+)?(?:mon|mes|le|la)\s+(?:b[eé]n[eé]fice|stock|total|montant|produit)/i,
  /(?:mes|les)\s+(?:ventes|d[eé]penses|dettes|produits)\b/i,
  /(?:mon|l['’])(?:état|etat)\s+(?:de\s+)?(?:mon\s+)?stock/i,
  /(?:mon\s+)?catalogue\b/i,
  /qui me doit/i,
  /\b(?:bilan|r[eé]cap(?:itulatif)?|synth[eè]se|r[eé]sum[eé]|b[eé]n[eé]fice)\b/i,
  /\bcompare(?:r|z)?\b/i,
  /meilleur\s+produit/i,
  /produit.*(?:mieux|plus).*vendu/i,
  /(?:produits?\s+)?(?:presque\s+)?(?:[eé]puis|stock\s+faible)/i,
  /o[uù]\s+en\s+suis/i,
  /combien\s+(?:de\s+)?produits\b/i,
  /combien\s+me\s+reste/i,
  /reste[- ]?t[- ]?il\s+de/i,
  /dettes?\s+(?:impay|r[eé]gl)/i,
  /^(?:donne[- ]?moi|fais[- ]?(?:moi)?)\s+(?:le\s+)?(?:total|r[eé]cap)/i,
];

/**
 * Strip reply-to prefix (↩ snippet) before classification.
 */
export function extractClassificationText(message) {
  const raw = String(message || '').trim();
  if (!raw.startsWith('↩')) return raw;
  const parts = raw.split(/\n\n/);
  if (parts.length < 2) return raw;
  return parts.slice(1).join('\n\n').trim() || raw;
}

export function isPdfReportRequest(text) {
  const t = String(text || '');
  return PDF_REQUEST_PATTERN.test(t) && PDF_REPORT_CONTEXT_PATTERN.test(t);
}

export function isCreateSaleIntent(text) {
  const t = String(text || '').trim();
  if (!t || /^combien/i.test(t)) return false;
  return CREATE_SALE_PREFIX.test(t);
}

export function isCreateExpenseIntent(text) {
  const t = String(text || '').trim();
  if (!t || /^combien/i.test(t)) return false;
  return CREATE_EXPENSE_PREFIX.test(t);
}

export function isAshyWriteConfirmationMessage(text) {
  return ASHY_WRITE_CONFIRMATION_PATTERN.test(String(text || '').trim());
}

export function isAshyWriteCancellationMessage(text) {
  return ASHY_WRITE_CANCEL_PATTERN.test(String(text || '').trim());
}

export function isCreateSaleSlotFillContinuation(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 120) return false;
  if (isAshyWriteConfirmationMessage(t) || isAshyWriteCancellationMessage(t)) return false;
  if (/^(?:pay[eé]|encaiss[eé])\s+\d/i.test(t)) return true;
  if (/^\d+([.,]\d+)?\s*[$€]?$/i.test(t)) return true;
  return false;
}

export function isCreateExpenseSlotFillContinuation(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 120) return false;
  if (isAshyWriteConfirmationMessage(t) || isAshyWriteCancellationMessage(t)) return false;
  if (isCreateSaleIntent(t) || isCreateExpenseIntent(t)) return false;
  if (/^\d+([.,]\d+)?\s*[$€]?$/i.test(t)) return true;
  if (/^(?:pour\s+)?[a-zàâäéèêëïîôùûüç0-9\s\-'«»]+$/i.test(t) && !/^(j['']?ai|je veux|un client)/i.test(t)) {
    return true;
  }
  return false;
}

export function isWriteIntent(text) {
  const t = String(text || '').trim();
  if (!t) return false;

  if (WRITE_PREFIX_PATTERNS.some((pattern) => pattern.test(t))) {
    return true;
  }

  if (WRITE_RECEIVED_PATTERN.test(t) && !/^(combien|quel)/i.test(t)) {
    return true;
  }

  if (WRITE_ACTION_PATTERNS.some((pattern) => pattern.test(t))) {
    return true;
  }

  // Transactional amounts after write-style openers (slot-fill continuations).
  if (/^\d+([.,]\d+)?\s*[$€]?/i.test(t) && t.length < 120) {
    return true;
  }

  return false;
}

export function isReadIntent(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return READ_PATTERNS.some((pattern) => pattern.test(t));
}

/**
 * @returns {'ashy' | 'n8n'}
 */
export function resolveChatRoute(message, options = {}) {
  const readFlag = options.readFlagEnabled ?? isAshyReadChatEnabled(options.env);
  const writeFlag = options.writeFlagEnabled ?? isAshyWriteChatEnabled(options.env);
  const pendingAshyWrite = Boolean(options.pendingAshyWriteConfirmation);
  const text = extractClassificationText(message);

  if (isPdfReportRequest(text)) {
    return CHAT_ROUTE.N8N;
  }

  if (writeFlag) {
    if (pendingAshyWrite) {
      if (
        isAshyWriteConfirmationMessage(text)
        || isAshyWriteCancellationMessage(text)
        || isCreateSaleSlotFillContinuation(text)
        || isCreateExpenseSlotFillContinuation(text)
      ) {
        return CHAT_ROUTE.ASHY;
      }
    }

    if (isCreateSaleIntent(text) || isCreateExpenseIntent(text)) {
      return CHAT_ROUTE.ASHY;
    }

    if (isWriteIntent(text)) {
      return CHAT_ROUTE.N8N;
    }
  } else if (isWriteIntent(text)) {
    return CHAT_ROUTE.N8N;
  }

  // H12.1 / H12.2 — incremental READ migrations (independent of global read flag).
  if (isMigratedReadIntent(READ_CAPABILITY.SALES, text, options.env)) {
    return CHAT_ROUTE.ASHY;
  }
  if (isMigratedReadIntent(READ_CAPABILITY.EXPENSES, text, options.env)) {
    return CHAT_ROUTE.ASHY;
  }

  if (!readFlag && !writeFlag) {
    return CHAT_ROUTE.N8N;
  }

  if (readFlag && isReadIntent(text)) {
    return CHAT_ROUTE.ASHY;
  }

  return CHAT_ROUTE.N8N;
}
