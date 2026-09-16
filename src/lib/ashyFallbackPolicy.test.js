import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASHY_ACTION_AMBIGUOUS_REPLY,
  buildAshyBlockedFallbackResponse,
  isAshyActionRequest,
  resolveAshyFallbackDecision,
  V2_FALLBACK_POLICY,
} from './ashyFallbackPolicy.js';

test('READ message allows fallback on HTTP 500', () => {
  const d = resolveAshyFallbackDecision(
    { ok: false, status: 500, data: {}, route: 'ashy' },
    { message: 'Combien ai-je vendu ce mois-ci ?' },
  );
  assert.equal(d.allowFallback, true);
  assert.equal(d.policy, V2_FALLBACK_POLICY.SAFE_FALLBACK);
});

test('READ message allows fallback on network error', () => {
  const d = resolveAshyFallbackDecision(null, {
    message: 'Combien ai-je vendu ce mois-ci ?',
    networkError: true,
  });
  assert.equal(d.allowFallback, true);
});

test('ACTION proposal blocks fallback on HTTP 500', () => {
  const d = resolveAshyFallbackDecision(
    { ok: false, status: 500, data: {}, route: 'ashy' },
    { message: 'Ajoute une dépense de 30 dollars pour le transport' },
  );
  assert.equal(d.allowFallback, false);
});

test('ACTION confirm blocks fallback on network error', () => {
  const d = resolveAshyFallbackDecision(null, {
    message: 'Oui',
    pendingAshyWriteConfirmation: true,
    networkError: true,
  });
  assert.equal(d.allowFallback, false);
  assert.equal(d.policy, V2_FALLBACK_POLICY.AMBIGUOUS_WRITE);
});

test('server noN8nFallback blocks fallback', () => {
  const d = resolveAshyFallbackDecision(
    { ok: false, status: 500, data: { noN8nFallback: true }, route: 'ashy' },
    { message: 'Combien ai-je vendu ?' },
  );
  assert.equal(d.allowFallback, false);
});

test('server v2Http noN8nFallback blocks fallback', () => {
  const d = resolveAshyFallbackDecision(
    {
      ok: false,
      status: 500,
      data: { v2Http: { noN8nFallback: true, fallbackPolicy: 'NO_FALLBACK' } },
      route: 'ashy',
    },
    { message: 'Combien ai-je vendu ?' },
  );
  assert.equal(d.allowFallback, false);
});

test('create_sale intent is action request', () => {
  assert.equal(isAshyActionRequest("J'ai vendu 2 poulets à 10 dollars"), true);
});

test('create_expense prefix is action request', () => {
  assert.equal(isAshyActionRequest('Ajoute une dépense de 30 dollars pour le transport'), true);
});

test('confirmation with pending is action request', () => {
  assert.equal(isAshyActionRequest('Oui', { pendingAshyWriteConfirmation: true }), true);
});

test('READ question is not action request', () => {
  assert.equal(isAshyActionRequest('Combien ai-je vendu ce mois-ci ?'), false);
});

test('blocked response uses ambiguous message on network error', () => {
  const res = buildAshyBlockedFallbackResponse(null, {
    message: 'Oui',
    pendingAshyWriteConfirmation: true,
    networkError: true,
  });
  assert.equal(res.ashyFallbackBlocked, true);
  assert.equal(res.noN8nFallback, true);
  assert.equal(res.data.reply, ASHY_ACTION_AMBIGUOUS_REPLY);
  assert.equal(res.route, 'ashy');
});

test('blocked response preserves server reply when present', () => {
  const res = buildAshyBlockedFallbackResponse(
    { ok: false, status: 422, data: { reply: 'Erreur contrôlée' }, route: 'ashy' },
    { message: 'Ajoute une dépense de 30 dollars pour le transport' },
  );
  assert.equal(res.data.reply, 'Erreur contrôlée');
});

test('401 READ allows fallback', () => {
  const d = resolveAshyFallbackDecision(
    { ok: false, status: 401, data: {}, route: 'ashy' },
    { message: 'Combien ai-je dépensé ce mois-ci ?' },
  );
  assert.equal(d.allowFallback, true);
});

test('403 ACTION blocks fallback', () => {
  const d = resolveAshyFallbackDecision(
    { ok: false, status: 403, data: {}, route: 'ashy' },
    { message: 'Ajoute une dépense de 30 dollars pour le transport' },
  );
  assert.equal(d.allowFallback, false);
});

test('502 ACTION blocks fallback', () => {
  const d = resolveAshyFallbackDecision(
    { ok: false, status: 502, data: {}, route: 'ashy' },
    { message: "J'ai vendu 2 poulets à 10 dollars" },
  );
  assert.equal(d.allowFallback, false);
});

test('malformed response ACTION blocks fallback', () => {
  const d = resolveAshyFallbackDecision(
    { ok: false, status: 500, data: {}, rawText: '', route: 'ashy' },
    { message: 'Ajoute une dépense de 30 dollars pour le transport' },
  );
  assert.equal(d.allowFallback, false);
});

test('clarification slot fill with pending is action', () => {
  assert.equal(isAshyActionRequest('30 dollars', { pendingAshyWriteConfirmation: true }), true);
});

test('modification avec pending is action', () => {
  assert.equal(isAshyActionRequest('Finalement 30 dollars', { pendingAshyWriteConfirmation: true }), true);
});

test('COMMITTED server policy blocks fallback', () => {
  const d = resolveAshyFallbackDecision(
    {
      ok: true,
      status: 200,
      data: {
        noN8nFallback: true,
        fallbackPolicy: 'NO_FALLBACK',
        v2Http: { f4Committed: true },
      },
      route: 'ashy',
    },
    { message: 'Oui', pendingAshyWriteConfirmation: true },
  );
  assert.equal(d.allowFallback, false);
});
