import assert from 'node:assert/strict';
import test from 'node:test';

import { parseChatReplyResponse } from './chatReply.js';
import { CHAT_ROUTE, resolveChatRoute } from './chatRouter.js';
import {
  fetchChatResponse,
  shouldFallbackAshyToN8n,
} from './chatTransport.js';

const baseCtx = {
  message: 'Combien ai-je vendu ce mois-ci ?',
  sessionId: 'user-1',
  user: { id: 'pb-1' },
  stableId: 'user-1',
  currency: { currency: 'USD' },
  recentMessages: [],
  token: 'tok',
};

function mockAshy(result) {
  return async () => result;
}

function mockN8n(result) {
  return async () => result;
}

function throwingAshy() {
  return async () => {
    throw new Error('network');
  };
}

test('Ashy OK returns Ashy response without calling n8n', async () => {
  let n8nCalls = 0;
  const res = await fetchChatResponse({
    ...baseCtx,
    chatRoute: CHAT_ROUTE.ASHY,
    sendAshy: mockAshy({
      ok: true,
      status: 200,
      rawText: '{"reply":"3 ventes"}',
      data: { reply: '3 ventes' },
      route: 'ashy',
    }),
    sendN8n: async () => { n8nCalls += 1; return { ok: true, route: 'n8n' }; },
  });

  assert.equal(res.route, 'ashy');
  assert.equal(res.data.reply, '3 ventes');
  assert.equal(n8nCalls, 0);
});

test('Ashy 422 falls back to n8n', async () => {
  let n8nCalls = 0;
  const res = await fetchChatResponse({
    ...baseCtx,
    chatRoute: CHAT_ROUTE.ASHY,
    sendAshy: mockAshy({
      ok: false,
      status: 422,
      rawText: '{"error":{"message":"invalid"}}',
      data: { error: { message: 'invalid' } },
      route: 'ashy',
    }),
    sendN8n: async () => {
      n8nCalls += 1;
      return {
        ok: true,
        status: 200,
        rawText: '{"reply":"fallback n8n"}',
        data: { reply: 'fallback n8n' },
        route: 'n8n',
      };
    },
  });

  assert.equal(n8nCalls, 1);
  assert.equal(res.route, 'n8n');
  assert.equal(res.ashyFallback, true);
  assert.equal(res.data.reply, 'fallback n8n');
});

test('Ashy 500 falls back to n8n', async () => {
  const res = await fetchChatResponse({
    ...baseCtx,
    chatRoute: CHAT_ROUTE.ASHY,
    sendAshy: mockAshy({
      ok: false,
      status: 500,
      rawText: '{"message":"fail"}',
      data: { message: 'fail' },
      route: 'ashy',
    }),
    sendN8n: mockN8n({
      ok: true,
      status: 200,
      rawText: '{"reply":"n8n ok"}',
      data: { reply: 'n8n ok' },
      route: 'n8n',
    }),
  });

  assert.equal(res.ashyFallback, true);
  assert.equal(res.data.reply, 'n8n ok');
});

test('Ashy network error falls back to n8n', async () => {
  const res = await fetchChatResponse({
    ...baseCtx,
    chatRoute: CHAT_ROUTE.ASHY,
    sendAshy: throwingAshy(),
    sendN8n: mockN8n({
      ok: true,
      status: 200,
      rawText: '{"reply":"after network fail"}',
      data: { reply: 'after network fail' },
      route: 'n8n',
    }),
  });

  assert.equal(res.ashyFallback, true);
  assert.equal(res.data.reply, 'after network fail');
});

test('Ashy fail + n8n fail returns n8n error response', async () => {
  const res = await fetchChatResponse({
    ...baseCtx,
    chatRoute: CHAT_ROUTE.ASHY,
    sendAshy: mockAshy({
      ok: false,
      status: 503,
      rawText: '',
      data: {},
      route: 'ashy',
    }),
    sendN8n: mockN8n({
      ok: false,
      status: 500,
      rawText: '{"error":"n8n down"}',
      data: { error: 'n8n down' },
      route: 'n8n',
    }),
  });

  assert.equal(res.ashyFallback, true);
  assert.equal(res.ok, false);
  const parsed = parseChatReplyResponse(res);
  assert.equal(parsed.rawReplyText, 'n8n down');
});

test('FLAG OFF route uses n8n directly without Ashy', async () => {
  let ashyCalls = 0;
  const res = await fetchChatResponse({
    ...baseCtx,
    chatRoute: CHAT_ROUTE.N8N,
    sendAshy: async () => { ashyCalls += 1; return { ok: true, route: 'ashy' }; },
    sendN8n: mockN8n({
      ok: true,
      status: 200,
      rawText: '{"reply":"n8n direct"}',
      data: { reply: 'n8n direct' },
      route: 'n8n',
    }),
  });

  assert.equal(ashyCalls, 0);
  assert.equal(res.data.reply, 'n8n direct');
  assert.equal(res.ashyFallback, undefined);
});

test('write with FLAG ON resolves to n8n route only', () => {
  const route = resolveChatRoute("J'ai vendu 10 pains", {
    env: { VITE_ASHY_READ_CHAT: 'true' },
  });
  assert.equal(route, CHAT_ROUTE.N8N);
});

test('shouldFallbackAshyToN8n detects failed Ashy HTTP', () => {
  assert.equal(shouldFallbackAshyToN8n({ route: 'ashy', ok: false }), true);
  assert.equal(shouldFallbackAshyToN8n({ route: 'ashy', ok: true }), false);
});

test('ashy fallback n8n success suppresses dashboard refresh for reads', () => {
  const parsed = parseChatReplyResponse({
    ok: true,
    rawText: '{"reply":"read via n8n"}',
    data: { reply: 'read via n8n' },
    route: 'n8n',
    ashyFallback: true,
  });
  assert.equal(parsed.shouldRefreshDashboard, false);
});

test('direct n8n write success still refreshes dashboard', () => {
  const parsed = parseChatReplyResponse({
    ok: true,
    rawText: '{"reply":"Vente enregistrée."}',
    data: { reply: 'Vente enregistrée.' },
    route: 'n8n',
  });
  assert.equal(parsed.shouldRefreshDashboard, true);
});
