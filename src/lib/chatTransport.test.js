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

test('write with read flag ON only resolves create_sale to n8n', () => {
  const route = resolveChatRoute("J'ai vendu 10 pains", {
    env: { VITE_ASHY_READ_CHAT: 'true', VITE_ASHY_WRITE_CHAT: 'false' },
  });
  assert.equal(route, CHAT_ROUTE.N8N);
});

test('write flag ON routes create_sale to Ashy in fetchChatResponse', async () => {
  let ashyCalls = 0;
  let n8nCalls = 0;
  const res = await fetchChatResponse({
    ...baseCtx,
    message: "J'ai vendu 2 poulets à 10 $, payé 20 $",
    chatRoute: CHAT_ROUTE.ASHY,
    sendAshy: async () => {
      ashyCalls += 1;
      return {
        ok: true,
        status: 200,
        rawText: '{"reply":"Preview vente"}',
        data: {
          reply: 'Preview vente',
          toolResults: [{ success: false, error: { code: 'NEEDS_CONFIRMATION' } }],
        },
        route: 'ashy',
      };
    },
    sendN8n: async () => { n8nCalls += 1; return { ok: true, route: 'n8n' }; },
  });

  assert.equal(ashyCalls, 1);
  assert.equal(n8nCalls, 0);
  assert.equal(res.route, 'ashy');
});

test('Ashy create_expense success does not fallback to n8n', async () => {
  let n8nCalls = 0;
  const res = await fetchChatResponse({
    ...baseCtx,
    message: 'oui',
    chatRoute: CHAT_ROUTE.ASHY,
    sendAshy: mockAshy({
      ok: true,
      status: 200,
      rawText: '{"reply":"Dépense enregistrée."}',
      data: {
        reply: 'Dépense enregistrée.',
        toolResults: [{ success: true, tool: 'create_expense' }],
      },
      route: 'ashy',
    }),
    sendN8n: async () => { n8nCalls += 1; return { ok: true, route: 'n8n' }; },
  });

  assert.equal(n8nCalls, 0);
  assert.equal(res.route, 'ashy');
  const parsed = parseChatReplyResponse(res);
  assert.equal(parsed.shouldRefreshDashboard, true);
});

test('Ashy create_sale success does not fallback to n8n', async () => {
  let n8nCalls = 0;
  const res = await fetchChatResponse({
    ...baseCtx,
    message: 'oui',
    chatRoute: CHAT_ROUTE.ASHY,
    sendAshy: mockAshy({
      ok: true,
      status: 200,
      rawText: '{"reply":"Vente enregistrée."}',
      data: {
        reply: 'Vente enregistrée.',
        toolResults: [{ success: true, tool: 'create_sale' }],
      },
      route: 'ashy',
    }),
    sendN8n: async () => { n8nCalls += 1; return { ok: true, route: 'n8n' }; },
  });

  assert.equal(n8nCalls, 0);
  assert.equal(res.route, 'ashy');
  const parsed = parseChatReplyResponse(res);
  assert.equal(parsed.shouldRefreshDashboard, true);
});

test('H4: Ashy write failure does NOT fall back to n8n', async () => {
  let ashyCalls = 0;
  let n8nCalls = 0;
  const res = await fetchChatResponse({
    ...baseCtx,
    message: "J'ai vendu 2 poulets à 10 $",
    chatRoute: CHAT_ROUTE.ASHY,
    sendAshy: async () => {
      ashyCalls += 1;
      return {
        ok: false,
        status: 500,
        rawText: '{"message":"fail"}',
        data: { message: 'fail' },
        route: 'ashy',
      };
    },
    sendN8n: async () => {
      n8nCalls += 1;
      return {
        ok: true,
        status: 200,
        rawText: '{"reply":"Vente via n8n"}',
        data: { reply: 'Vente via n8n' },
        route: 'n8n',
      };
    },
  });

  assert.equal(ashyCalls, 1);
  assert.equal(n8nCalls, 0);
  assert.equal(res.ashyFallbackBlocked, true);
  assert.equal(res.noN8nFallback, true);
  assert.equal(res.route, 'ashy');
});

test('H4: Ashy action network error does NOT fall back to n8n', async () => {
  let n8nCalls = 0;
  const res = await fetchChatResponse({
    ...baseCtx,
    message: 'Ajoute une dépense de 30 dollars pour le transport',
    chatRoute: CHAT_ROUTE.ASHY,
    sendAshy: throwingAshy(),
    sendN8n: async () => { n8nCalls += 1; return { ok: true, route: 'n8n' }; },
  });
  assert.equal(n8nCalls, 0);
  assert.equal(res.ashyFallbackBlocked, true);
  assert.equal(res.noN8nFallback, true);
});

test('H4: Ashy confirm network error with pending does NOT fall back to n8n', async () => {
  let n8nCalls = 0;
  const res = await fetchChatResponse({
    ...baseCtx,
    message: 'Oui',
    chatRoute: CHAT_ROUTE.ASHY,
    pendingAshyWriteConfirmation: true,
    sendAshy: throwingAshy(),
    sendN8n: async () => { n8nCalls += 1; return { ok: true, route: 'n8n' }; },
  });
  assert.equal(n8nCalls, 0);
  assert.equal(res.ashyFallbackBlocked, true);
});

test('H4: server noN8nFallback blocks n8n even for READ-shaped message', async () => {
  let n8nCalls = 0;
  const res = await fetchChatResponse({
    ...baseCtx,
    message: 'Combien ai-je vendu ce mois-ci ?',
    chatRoute: CHAT_ROUTE.ASHY,
    sendAshy: mockAshy({
      ok: false,
      status: 500,
      rawText: '{}',
      data: { noN8nFallback: true, fallbackPolicy: 'NO_FALLBACK' },
      route: 'ashy',
    }),
    sendN8n: async () => { n8nCalls += 1; return { ok: true, route: 'n8n' }; },
  });
  assert.equal(n8nCalls, 0);
  assert.equal(res.ashyFallbackBlocked, true);
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
