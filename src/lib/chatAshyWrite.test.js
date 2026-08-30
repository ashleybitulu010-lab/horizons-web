import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeNextPendingAshyWrite,
  isAshyCreateSaleSuccessResponse,
  isAshyPendingWriteConfirmationResponse,
  isAshyWriteSuccessResponse,
} from './chatAshyWrite.js';
import { CHAT_ROUTE } from './chatRouter.js';

test('pending write detected from NEEDS_CONFIRMATION tool result', () => {
  const response = {
    ok: true,
    route: 'ashy',
    data: {
      reply: 'Je confirme ?',
      toolResults: [{ success: false, error: { code: 'NEEDS_CONFIRMATION' }, meta: { requiresConfirmation: true } }],
    },
  };
  assert.equal(isAshyPendingWriteConfirmationResponse(response), true);
  assert.equal(
    computeNextPendingAshyWrite({
      previousPending: false,
      chatRoute: CHAT_ROUTE.ASHY,
      chatResponse: response,
      userMessage: "J'ai vendu 2 poulets à 10 $, payé 20 $",
    }),
    true,
  );
});

test('create expense success clears pending state', () => {
  const response = {
    ok: true,
    route: 'ashy',
    data: {
      reply: 'Dépense enregistrée',
      toolResults: [{ success: true, tool: 'create_expense' }],
    },
  };
  assert.equal(isAshyWriteSuccessResponse(response), true);
  assert.equal(
    computeNextPendingAshyWrite({
      previousPending: true,
      chatRoute: CHAT_ROUTE.ASHY,
      chatResponse: response,
      userMessage: 'oui',
    }),
    false,
  );
});

test('create expense pending detected from NEEDS_CONFIRMATION', () => {
  const response = {
    ok: true,
    route: 'ashy',
    data: {
      reply: 'Je confirme ?',
      toolResults: [{ success: false, error: { code: 'NEEDS_CONFIRMATION' }, meta: { requiresConfirmation: true } }],
    },
  };
  assert.equal(
    computeNextPendingAshyWrite({
      previousPending: false,
      chatRoute: CHAT_ROUTE.ASHY,
      chatResponse: response,
      userMessage: "J'ai dépensé 20 $ pour le transport",
    }),
    true,
  );
});

test('create sale success clears pending state', () => {
  const response = {
    ok: true,
    route: 'ashy',
    data: {
      reply: 'Vente enregistrée',
      toolResults: [{ success: true, tool: 'create_sale' }],
    },
  };
  assert.equal(isAshyCreateSaleSuccessResponse(response), true);
  assert.equal(
    computeNextPendingAshyWrite({
      previousPending: true,
      chatRoute: CHAT_ROUTE.ASHY,
      chatResponse: response,
      userMessage: 'oui',
    }),
    false,
  );
});

test('ashy fallback clears pending state', () => {
  assert.equal(
    computeNextPendingAshyWrite({
      previousPending: true,
      chatRoute: CHAT_ROUTE.N8N,
      chatResponse: { ok: true, route: 'n8n', ashyFallback: true, data: { reply: 'n8n' } },
      userMessage: 'oui',
    }),
    false,
  );
});

test('slot-fill continuation keeps pending while on Ashy route', () => {
  assert.equal(
    computeNextPendingAshyWrite({
      previousPending: true,
      chatRoute: CHAT_ROUTE.ASHY,
      chatResponse: { ok: true, route: 'ashy', data: { reply: 'Combien as-tu encaissé ?', toolResults: [] } },
      userMessage: '20',
    }),
    true,
  );
});
