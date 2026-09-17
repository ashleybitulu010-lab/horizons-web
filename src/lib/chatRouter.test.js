import assert from 'node:assert/strict';
import test from 'node:test';

import { isAshyReadChatEnabled } from './ashyReadChatFlag.js';
import { isAshyWriteChatEnabled } from './ashyWriteChatFlag.js';
import {
  CHAT_ROUTE,
  extractClassificationText,
  isAshyWriteConfirmationMessage,
  isCreateExpenseIntent,
  isCreateExpenseSlotFillContinuation,
  isCreateSaleIntent,
  isCreateSaleSlotFillContinuation,
  isPdfReportRequest,
  isReadIntent,
  isWriteIntent,
  resolveChatRoute,
} from './chatRouter.js';
import { parseChatReplyResponse } from './chatReply.js';

const READ_ON = { VITE_ASHY_READ_CHAT: 'true', VITE_ASHY_WRITE_CHAT: 'false' };
const WRITE_ON = { VITE_ASHY_READ_CHAT: 'false', VITE_ASHY_WRITE_CHAT: 'true' };
const BOTH_ON = { VITE_ASHY_READ_CHAT: 'true', VITE_ASHY_WRITE_CHAT: 'true' };
const FLAG_OFF = { VITE_ASHY_READ_CHAT: 'false', VITE_ASHY_WRITE_CHAT: 'false' };

test('resolveChatRoute respects env flag helper', () => {
  const rollback = { ...FLAG_OFF, VITE_ASHY_READ_SALES: 'false' };
  assert.equal(resolveChatRoute('Combien ai-je vendu ?', { env: rollback }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Combien ai-je vendu ?', { env: READ_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Quelles sont mes ventes ?', { env: FLAG_OFF }), CHAT_ROUTE.ASHY);
});

test('isAshyReadChatEnabled is false by default', () => {
  assert.equal(isAshyReadChatEnabled({}), false);
  assert.equal(isAshyReadChatEnabled({ VITE_ASHY_READ_CHAT: 'false' }), false);
  assert.equal(isAshyReadChatEnabled({ VITE_ASHY_READ_CHAT: 'true' }), true);
});

test('isAshyWriteChatEnabled is false by default', () => {
  assert.equal(isAshyWriteChatEnabled({}), false);
  assert.equal(isAshyWriteChatEnabled({ VITE_ASHY_WRITE_CHAT: 'false' }), false);
  assert.equal(isAshyWriteChatEnabled({ VITE_ASHY_WRITE_CHAT: 'true' }), true);
});

test('flag OFF routes non-migrated messages to n8n', () => {
  const rollback = { ...FLAG_OFF, VITE_ASHY_READ_SALES: 'false' };
  assert.equal(resolveChatRoute('Combien ai-je vendu ce mois-ci ?', { env: rollback }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute("J'ai vendu 10 pains", { env: rollback }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Génère mon bilan PDF', { env: rollback }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Bonjour Ashy', { env: FLAG_OFF }), CHAT_ROUTE.N8N);
});

test('H12.1 SALES read routes to ashy when global read flag OFF', () => {
  assert.equal(resolveChatRoute('Quelles sont mes ventes ?', { env: FLAG_OFF }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Quelles sont mes dépenses ?', { env: FLAG_OFF }), CHAT_ROUTE.N8N);
});

test('flag ON routes read queries to ashy', () => {
  const opts = { env: READ_ON };
  assert.equal(resolveChatRoute('Combien ai-je vendu ce mois-ci ?', opts), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Quel est mon bénéfice ?', opts), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Montre mes dettes', opts), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Et mes dépenses ?', opts), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Fais-moi un bilan', opts), CHAT_ROUTE.ASHY);
});

test('read flag ON keeps create_sale on n8n when write flag OFF', () => {
  const opts = { env: READ_ON };
  assert.equal(resolveChatRoute("J'ai vendu 10 pains à 2 $", opts), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('oui', { ...opts, pendingAshyWriteConfirmation: true }), CHAT_ROUTE.N8N);
});

test('write flag ON routes create_sale to ashy', () => {
  const opts = { env: WRITE_ON };
  assert.equal(resolveChatRoute("J'ai vendu 2 poulets à 10 $, payé 20 $", opts), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute("J'ai vendu ", opts), CHAT_ROUTE.ASHY);
});

test('write flag ON routes confirmation to ashy when pending', () => {
  const opts = { env: WRITE_ON, pendingAshyWriteConfirmation: true };
  assert.equal(resolveChatRoute('oui', opts), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('ok', opts), CHAT_ROUTE.ASHY);
  assert.equal(isAshyWriteConfirmationMessage('oui'), true);
});

test('write flag ON routes slot-fill continuation to ashy when pending', () => {
  const opts = { env: WRITE_ON, pendingAshyWriteConfirmation: true };
  assert.equal(resolveChatRoute('20', opts), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('payé 20', opts), CHAT_ROUTE.ASHY);
  assert.equal(isCreateSaleSlotFillContinuation('20'), true);
});

test('write flag ON without pending keeps bare numeric on n8n', () => {
  assert.equal(resolveChatRoute('20', { env: WRITE_ON }), CHAT_ROUTE.N8N);
});

test('write flag ON routes create_expense to ashy', () => {
  const opts = { env: WRITE_ON };
  assert.equal(resolveChatRoute("J'ai dépensé 20 $ pour le transport", opts), CHAT_ROUTE.ASHY);
  assert.equal(isCreateExpenseIntent("J'ai dépensé 20 $"), true);
});

test('write flag ON routes expense slot-fill to ashy when pending', () => {
  const opts = { env: WRITE_ON, pendingAshyWriteConfirmation: true };
  assert.equal(resolveChatRoute('transport', opts), CHAT_ROUTE.ASHY);
  assert.equal(isCreateExpenseSlotFillContinuation('transport'), true);
});

test('write flag ON keeps stock writes on n8n', () => {
  const opts = { env: WRITE_ON };
  assert.equal(resolveChatRoute("J'ai dépensé 20 $ pour le transport", opts), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute("J'ai reçu du stock : poulet 50 kg", opts), CHAT_ROUTE.N8N);
});

test('write flag ON keeps other writes on n8n', () => {
  const opts = { env: WRITE_ON };
  assert.equal(resolveChatRoute('Je veux ajouter un nouveau produit', opts), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute("J'ai reçu du stock : poulet 50 kg", opts), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Un client me doit 100 $', opts), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute("J'ai reçu un paiement de 50 $", opts), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Transfère 100 $ vers caisse', opts), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Modifier la vente de hier', opts), CHAT_ROUTE.N8N);
});

test('both flags ON routes reads and Ashy writes to ashy', () => {
  const opts = { env: BOTH_ON };
  assert.equal(resolveChatRoute('Combien ai-je vendu ce mois-ci ?', opts), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute("J'ai vendu 2 poulets à 10 $, payé 20 $", opts), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute("J'ai dépensé 20 $ pour le transport", opts), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute("J'ai reçu du stock : poulet 50 kg", opts), CHAT_ROUTE.N8N);
});

test('flag ON keeps writes on n8n when only read flag (legacy 3.7)', () => {
  const opts = { env: READ_ON };
  assert.equal(resolveChatRoute("J'ai vendu 10 pains à 2 $", opts), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute("J'ai dépensé 20 $ pour le transport", opts), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Je veux ajouter un nouveau produit', opts), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute("J'ai reçu du stock : poulet 50 kg", opts), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Un client me doit 100 $', opts), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute("J'ai reçu un paiement de 50 $", opts), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Transfère 100 $ vers caisse', opts), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Modifier la vente de hier', opts), CHAT_ROUTE.N8N);
});

test('flag ON keeps PDF requests on n8n', () => {
  const opts = { env: READ_ON };
  assert.equal(resolveChatRoute('Génère mon bilan PDF', opts), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Envoie-moi le rapport en PDF', opts), CHAT_ROUTE.N8N);
});

test('flag ON defaults ambiguous messages to n8n', () => {
  const opts = { env: READ_ON };
  assert.equal(resolveChatRoute('Bonjour Ashy', opts), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Merci', opts), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('OK', opts), CHAT_ROUTE.N8N);
});

test('extractClassificationText strips reply prefix', () => {
  const text = extractClassificationText('↩ ancien message…\n\nCombien ai-je vendu ?');
  assert.equal(text, 'Combien ai-je vendu ?');
});

test('isWriteIntent and isReadIntent are mutually exclusive for QuickAdd drafts', () => {
  assert.equal(isWriteIntent("J'ai vendu "), true);
  assert.equal(isReadIntent("J'ai vendu "), false);
  assert.equal(isCreateSaleIntent("J'ai vendu "), true);
});

test('isPdfReportRequest detects explicit PDF report asks', () => {
  assert.equal(isPdfReportRequest('Génère mon bilan PDF'), true);
  assert.equal(isPdfReportRequest('Quel est mon bénéfice ?'), false);
});

test('parseChatReplyResponse handles Ashy success with toolResults', () => {
  const parsed = parseChatReplyResponse({
    ok: true,
    rawText: '{"reply":"Sur ce mois-ci, tu as 3 ventes.","toolResults":[{"success":true}]}',
    data: {
      reply: 'Sur ce mois-ci, tu as 3 ventes.',
      toolResults: [{ success: true, tool: 'get_sales' }],
    },
    route: 'ashy',
  });

  assert.match(parsed.rawReplyText, /3 ventes/);
  assert.equal(parsed.toolResults.length, 1);
  assert.equal(parsed.shouldRefreshDashboard, false);
  assert.equal(parsed.hasPdf, false);
});

test('parseChatReplyResponse handles n8n dashboard refresh flag', () => {
  const parsed = parseChatReplyResponse({
    ok: true,
    rawText: '{"reply":"Vente enregistrée."}',
    data: { reply: 'Vente enregistrée.' },
    route: 'n8n',
  });

  assert.equal(parsed.shouldRefreshDashboard, true);
});

test('parseChatReplyResponse handles Ashy create_sale success with dashboard refresh', () => {
  const parsed = parseChatReplyResponse({
    ok: true,
    rawText: '{"reply":"Vente enregistrée."}',
    data: {
      reply: 'Vente enregistrée.',
      toolResults: [{ success: true, tool: 'create_sale' }],
    },
    route: 'ashy',
  });

  assert.equal(parsed.shouldRefreshDashboard, true);
});

test('parseChatReplyResponse handles Ashy create_expense success with dashboard refresh', () => {
  const parsed = parseChatReplyResponse({
    ok: true,
    rawText: '{"reply":"Dépense enregistrée."}',
    data: {
      reply: 'Dépense enregistrée.',
      toolResults: [{ success: true, tool: 'create_expense' }],
    },
    route: 'ashy',
  });

  assert.equal(parsed.shouldRefreshDashboard, true);
});

test('parseChatReplyResponse handles Ashy preview without dashboard refresh', () => {
  const parsed = parseChatReplyResponse({
    ok: true,
    rawText: '{}',
    data: {
      reply: 'Je confirme ?',
      toolResults: [{ success: false, error: { code: 'NEEDS_CONFIRMATION' } }],
    },
    route: 'ashy',
  });

  assert.equal(parsed.shouldRefreshDashboard, false);
});

test('parseChatReplyResponse handles Ashy validation error', () => {
  const parsed = parseChatReplyResponse({
    ok: false,
    rawText: '{"error":{"code":"INVALID_MESSAGE","message":"message is required"}}',
    data: { error: { code: 'INVALID_MESSAGE', message: 'message is required' } },
    route: 'ashy',
  });

  assert.equal(parsed.rawReplyText, 'message is required');
});
