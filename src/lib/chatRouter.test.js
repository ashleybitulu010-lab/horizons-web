import assert from 'node:assert/strict';
import test from 'node:test';

import { isAshyReadChatEnabled } from './ashyReadChatFlag.js';
import {
  CHAT_ROUTE,
  extractClassificationText,
  isPdfReportRequest,
  isReadIntent,
  isWriteIntent,
  resolveChatRoute,
} from './chatRouter.js';
import { parseChatReplyResponse } from './chatReply.js';

const FLAG_ON = { VITE_ASHY_READ_CHAT: 'true' };
const FLAG_OFF = { VITE_ASHY_READ_CHAT: 'false' };

test('resolveChatRoute respects env flag helper', () => {
  assert.equal(resolveChatRoute('Combien ai-je vendu ?', { env: FLAG_OFF }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Combien ai-je vendu ?', { env: FLAG_ON }), CHAT_ROUTE.ASHY);
});

test('isAshyReadChatEnabled is false by default', () => {
  assert.equal(isAshyReadChatEnabled({}), false);
  assert.equal(isAshyReadChatEnabled({ VITE_ASHY_READ_CHAT: 'false' }), false);
  assert.equal(isAshyReadChatEnabled({ VITE_ASHY_READ_CHAT: 'true' }), true);
});

test('flag OFF routes every message to n8n', () => {
  assert.equal(resolveChatRoute('Combien ai-je vendu ce mois-ci ?', { flagEnabled: false }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute("J'ai vendu 10 pains", { flagEnabled: false }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Génère mon bilan PDF', { flagEnabled: false }), CHAT_ROUTE.N8N);
});

test('flag ON routes read queries to ashy', () => {
  const opts = { flagEnabled: true };
  assert.equal(resolveChatRoute('Combien ai-je vendu ce mois-ci ?', opts), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Quel est mon bénéfice ?', opts), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Montre mes dettes', opts), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Et mes dépenses ?', opts), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Fais-moi un bilan', opts), CHAT_ROUTE.ASHY);
});

test('flag ON keeps writes on n8n', () => {
  const opts = { flagEnabled: true };
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
  const opts = { flagEnabled: true };
  assert.equal(resolveChatRoute('Génère mon bilan PDF', opts), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Envoie-moi le rapport en PDF', opts), CHAT_ROUTE.N8N);
});

test('flag ON defaults ambiguous messages to n8n', () => {
  const opts = { flagEnabled: true };
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

test('parseChatReplyResponse handles Ashy validation error', () => {
  const parsed = parseChatReplyResponse({
    ok: false,
    rawText: '{"error":{"code":"INVALID_MESSAGE","message":"message is required"}}',
    data: { error: { code: 'INVALID_MESSAGE', message: 'message is required' } },
    route: 'ashy',
  });

  assert.equal(parsed.rawReplyText, 'message is required');
});
