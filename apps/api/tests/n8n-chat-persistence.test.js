import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, describe, test } from 'node:test';

import express from 'express';

import chat from '../src/routes/chat.js';
import ashyChat from '../src/routes/api/ashy-chat.js';
import { requireAuth, rejectForeignIdentity } from '../src/middleware/auth.js';
import { errorMiddleware } from '../src/middleware/error.js';
import {
	parseN8nChatUpstreamResponse,
	persistN8nAssistantMessage,
	persistN8nUserMessage,
	resetN8nChatPersistenceForTests,
	setN8nChatAppendMessageForTests,
} from '../src/services/n8n-chat-persistence.js';
import {
	resetAshyChatPersistenceForTests,
	setAshyChatAppendMessageForTests,
} from '../src/routes/api/ashy-chat-persistence.js';
import {
	clearConversationSessionsForTests,
} from '../src/agent/conversation-state.js';
import {
	resetSalesQueryImplForTests,
	setSalesQueryImplForTests,
} from '../src/services/sales-service.js';
import { buildN8nExternalKey, normalizeN8nMessageContent } from '../src/utils/n8n-idempotency.js';
import {
	resetTokenVerifierForTests,
	setTokenVerifierForTests,
} from '../src/services/pocketbase-auth.js';
import {
	resetBuildRequestUserImplForTests,
	setBuildRequestUserImplForTests,
} from '../src/services/user-context.js';

const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const USER_A = {
	id: 'pb_user_a',
	email: 'a@example.com',
	firstName: 'Alice',
	lastName: 'A',
	airtableId: 'recA123',
	businessUserId: 'recA123',
	clientId: CLIENT_A,
};

const USER_B = {
	id: 'pb_user_b',
	email: 'b@example.com',
	firstName: 'Bob',
	lastName: 'B',
	airtableId: 'recB456',
	businessUserId: 'recB456',
	clientId: CLIENT_B,
};

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = {
	N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL,
	N8N_CHAT_WEBHOOK: process.env.N8N_CHAT_WEBHOOK,
	N8N_SAVE_MESSAGE_WEBHOOK: process.env.N8N_SAVE_MESSAGE_WEBHOOK,
};

function buildUserFromRecord(record) {
	const base = {
		id: record.id,
		email: record.email || null,
		firstName: record.firstName || null,
		lastName: record.lastName || null,
		airtableId: record.airtableId || null,
		businessUserId: record.airtableId || record.id || record.email,
		clientId: null,
	};
	if (record.id === USER_A.id) return { ...base, clientId: USER_A.clientId };
	if (record.id === USER_B.id) return { ...base, clientId: USER_B.clientId };
	return base;
}

function listen(app) {
	return new Promise((resolve, reject) => {
		const server = http.createServer(app);
		server.listen(0, '127.0.0.1', () => resolve(server));
		server.on('error', reject);
	});
}

function close(server) {
	return new Promise((resolve, reject) => {
		server.close((err) => (err ? reject(err) : resolve()));
	});
}

async function fetchJson(baseUrl, routePath, options = {}) {
	const res = await fetch(`${baseUrl}${routePath}`, options);
	const rawText = await res.text();
	let body = {};
	try {
		body = rawText ? JSON.parse(rawText) : {};
	} catch {
		body = {};
	}
	return { status: res.status, body, rawText, res };
}

function isN8nChatWebhook(url) {
	return String(url).includes('n8n.test/hook/chat');
}

function installN8nChatFetchMock(handler) {
	global.fetch = async (url, init) => {
		if (isN8nChatWebhook(url)) {
			return handler(url, init);
		}
		return ORIGINAL_FETCH(url, init);
	};
}

function mountChatApp() {
	const app = express();
	app.use(express.json());
	app.post('/chat', requireAuth, rejectForeignIdentity, chat);
	app.use(errorMiddleware);
	return app;
}

function mountAshyApp() {
	const app = express();
	app.use(express.json());
	app.post('/api/ashy/chat', (req, _res, next) => {
		req.user = USER_A;
		next();
	}, ashyChat);
	return app;
}

afterEach(() => {
	resetN8nChatPersistenceForTests();
	resetAshyChatPersistenceForTests();
	resetTokenVerifierForTests();
	resetBuildRequestUserImplForTests();
	global.fetch = ORIGINAL_FETCH;
	process.env.N8N_WEBHOOK_URL = ORIGINAL_ENV.N8N_WEBHOOK_URL;
	process.env.N8N_CHAT_WEBHOOK = ORIGINAL_ENV.N8N_CHAT_WEBHOOK;
	process.env.N8N_SAVE_MESSAGE_WEBHOOK = ORIGINAL_ENV.N8N_SAVE_MESSAGE_WEBHOOK;
});

describe('Phase 5.7-B n8n-chat-persistence — unit', () => {
	test('parseN8nChatUpstreamResponse — valid JSON reply is persistable', () => {
		const result = parseN8nChatUpstreamResponse(JSON.stringify({ reply: 'Bonjour' }), 'application/json');
		assert.equal(result.persistAssistant, true);
		assert.equal(result.reply, 'Bonjour');
	});

	test('parseN8nChatUpstreamResponse — empty body is not persistable', () => {
		const result = parseN8nChatUpstreamResponse('', 'application/json');
		assert.equal(result.persistAssistant, false);
	});

	test('parseN8nChatUpstreamResponse — malformed JSON object without reply is not persistable', () => {
		const result = parseN8nChatUpstreamResponse(JSON.stringify({ foo: 'bar' }), 'application/json');
		assert.equal(result.persistAssistant, false);
	});

	test('parseN8nChatUpstreamResponse — plain text is persistable', () => {
		const result = parseN8nChatUpstreamResponse('Réponse directe', 'text/plain');
		assert.equal(result.persistAssistant, true);
		assert.equal(result.reply, 'Réponse directe');
	});

	test('persistN8nUserMessage uses source n8n and req.user scope', async () => {
		const calls = [];
		setN8nChatAppendMessageForTests(async (params) => {
			calls.push(params);
			return { id: 'msg-1' };
		});

		const result = await persistN8nUserMessage(USER_A, 'Hello n8n');
		assert.equal(result.saved, true);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].user, USER_A);
		assert.equal(calls[0].role, 'user');
		assert.equal(calls[0].content, 'Hello n8n');
		assert.equal(calls[0].source, 'n8n');
		assert.equal(calls[0].metadata.route, 'n8n_chat');
		assert.match(calls[0].metadata.external_key, /^n8n:user:/);
	});

	test('persistN8nAssistantMessage stores limited PDF metadata only', async () => {
		const calls = [];
		setN8nChatAppendMessageForTests(async (params) => {
			calls.push(params);
			return { id: 'msg-2' };
		});

		await persistN8nAssistantMessage(USER_A, 'Voici le bilan', {
			reply: 'Voici le bilan',
			pdf_base64: 'JVBERi0xVeryLongBase64',
			filename: 'bilan.pdf',
			mime_type: 'application/pdf',
			type: 'pdf',
		});

		assert.equal(calls.length, 1);
		assert.equal(calls[0].source, 'n8n');
		assert.equal(calls[0].metadata.filename, 'bilan.pdf');
		assert.equal(calls[0].metadata.mime_type, 'application/pdf');
		assert.equal(calls[0].metadata.type, 'pdf');
		assert.equal(calls[0].metadata.has_pdf, true);
		assert.equal(Object.hasOwn(calls[0].metadata, 'pdf_base64'), false);
	});

	test('persistN8nAssistantMessage rejects empty reply', async () => {
		let called = false;
		setN8nChatAppendMessageForTests(async () => {
			called = true;
		});
		const result = await persistN8nAssistantMessage(USER_A, '   ', null);
		assert.equal(result.saved, false);
		assert.equal(result.code, 'EMPTY_REPLY');
		assert.equal(called, false);
	});

	test('Supabase failure on persist does not throw', async () => {
		setN8nChatAppendMessageForTests(async () => {
			const err = new Error('insert failed');
			err.code = 'INSERT_FAILED';
			throw err;
		});
		const result = await persistN8nUserMessage(USER_A, 'Hello');
		assert.equal(result.saved, false);
		assert.equal(result.code, 'INSERT_FAILED');
	});

	test('two identical legitimate messages both persist', async () => {
		const calls = [];
		setN8nChatAppendMessageForTests(async (params) => {
			calls.push(params);
			return { id: `msg-${calls.length}` };
		});

		await persistN8nUserMessage(USER_A, 'Quel est mon stock ?');
		await persistN8nUserMessage(USER_A, 'Quel est mon stock ?');
		assert.equal(calls.length, 2);
	});

	test('normalizeN8nMessageContent collapses whitespace', () => {
		assert.equal(normalizeN8nMessageContent('  hello   world  '), 'hello world');
	});

	test('buildN8nExternalKey is documented soft key format', () => {
		const key = buildN8nExternalKey({
			clientId: CLIENT_A,
			role: 'user',
			content: 'Bonjour',
			timestampMs: 1_700_000_000_000,
		});
		assert.match(key, /^n8n:user:[a-f0-9]{16}$/);
	});
});

describe('Phase 5.7-B POST /chat — route', () => {
	test.beforeEach(() => {
		process.env.N8N_WEBHOOK_URL = 'https://n8n.test/hook/chat';
		delete process.env.N8N_CHAT_WEBHOOK;

		setTokenVerifierForTests(async (token) => {
			if (token === 'valid-token-a') return USER_A;
			if (token === 'valid-token-b') return USER_B;
			return null;
		});
		setBuildRequestUserImplForTests(async (record) => buildUserFromRecord(record));
	});

	test('1. /chat n8n → user message persisted', async () => {
		const calls = [];
		setN8nChatAppendMessageForTests(async (params) => {
			calls.push(params);
			return { id: `msg-${calls.length}` };
		});

		installN8nChatFetchMock(async () => new Response(JSON.stringify({ reply: 'Salut' }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		}));

		const app = mountChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/chat', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer valid-token-a',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ message: 'Bonjour', clientId: CLIENT_B }),
			});

			assert.equal(status, 200);
			assert.equal(body.reply, 'Salut');
			assert.equal(calls.length, 2);
			assert.equal(calls[0].role, 'user');
			assert.equal(calls[0].content, 'Bonjour');
			assert.equal(calls[0].source, 'n8n');
			assert.equal(calls[0].user.clientId, CLIENT_A);
		} finally {
			await close(server);
		}
	});

	test('2. /chat n8n → assistant message persisted', async () => {
		const calls = [];
		setN8nChatAppendMessageForTests(async (params) => {
			calls.push(params);
			return { id: `msg-${calls.length}` };
		});

		installN8nChatFetchMock(async () => new Response(JSON.stringify({ output: 'Réponse assistant' }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		}));

		const app = mountChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { status } = await fetchJson(`http://127.0.0.1:${port}`, '/chat', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer valid-token-a',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ message: 'Question' }),
			});

			assert.equal(status, 200);
			assert.equal(calls.length, 2);
			assert.equal(calls[1].role, 'assistant');
			assert.equal(calls[1].content, 'Réponse assistant');
			assert.equal(calls[1].source, 'n8n');
		} finally {
			await close(server);
		}
	});

	test('7. n8n failure → no assistant persisted', async () => {
		const calls = [];
		setN8nChatAppendMessageForTests(async (params) => {
			calls.push(params);
			return { id: 'msg-1' };
		});

		installN8nChatFetchMock(async () => new Response('fail', { status: 502 }));

		const app = mountChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { status } = await fetchJson(`http://127.0.0.1:${port}`, '/chat', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer valid-token-a',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ message: 'Question' }),
			});

			assert.equal(status, 500);
			assert.equal(calls.length, 1);
			assert.equal(calls[0].role, 'user');
		} finally {
			await close(server);
		}
	});

	test('8. Supabase failure → n8n response still 200', async () => {
		setN8nChatAppendMessageForTests(async () => {
			const err = new Error('insert failed');
			err.code = 'INSERT_FAILED';
			throw err;
		});

		installN8nChatFetchMock(async () => new Response(JSON.stringify({ reply: 'OK n8n' }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		}));

		const app = mountChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/chat', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer valid-token-a',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ message: 'Question' }),
			});

			assert.equal(status, 200);
			assert.equal(body.reply, 'OK n8n');
		} finally {
			await close(server);
		}
	});

	test('9. malformed n8n response → no assistant persisted', async () => {
		const calls = [];
		setN8nChatAppendMessageForTests(async (params) => {
			calls.push(params);
			return { id: 'msg-1' };
		});

		installN8nChatFetchMock(async () => new Response(JSON.stringify({ unexpected: true }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		}));

		const app = mountChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/chat', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer valid-token-a',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ message: 'Question' }),
			});

			assert.equal(status, 200);
			assert.match(body.reply, /compréhensible/);
			assert.equal(calls.length, 1);
			assert.equal(calls[0].role, 'user');
		} finally {
			await close(server);
		}
	});

	test('10. PDF metadata limited in assistant persist', async () => {
		const calls = [];
		setN8nChatAppendMessageForTests(async (params) => {
			calls.push(params);
			return { id: 'msg-2' };
		});

		installN8nChatFetchMock(async () => new Response(JSON.stringify({
			reply: 'PDF prêt',
			pdf_base64: 'JVBERi0x'.repeat(100),
			filename: 'rapport.pdf',
			mime_type: 'application/pdf',
		}), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		}));

		const app = mountChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			await fetchJson(`http://127.0.0.1:${port}`, '/chat', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer valid-token-a',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ message: 'PDF' }),
			});

			const assistantCall = calls.find((c) => c.role === 'assistant');
			assert.ok(assistantCall);
			assert.equal(assistantCall.metadata.filename, 'rapport.pdf');
			assert.equal(Object.hasOwn(assistantCall.metadata, 'pdf_base64'), false);
		} finally {
			await close(server);
		}
	});

	test('11. /thread/message does not create chat_messages', async () => {
		const threadSrc = await import('node:fs/promises').then((fs) =>
			fs.readFile(new URL('../src/routes/thread.js', import.meta.url), 'utf8'),
		);
		assert.doesNotMatch(threadSrc, /appendMessage|n8n-chat-persistence/);
	});

	test('13. sequences delegated to appendMessage (unique per call)', async () => {
		const sequences = [];
		setN8nChatAppendMessageForTests(async (params) => {
			sequences.push(params.role);
			return { id: `msg-${sequences.length}`, sequence: sequences.length };
		});

		installN8nChatFetchMock(async () => new Response(JSON.stringify({ reply: 'A' }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		}));

		const app = mountChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			await fetchJson(`http://127.0.0.1:${port}`, '/chat', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer valid-token-a',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ message: 'One' }),
			});
			assert.deepEqual(sequences, ['user', 'assistant']);
		} finally {
			await close(server);
		}
	});

	test('15. cross-tenant — append uses req.user clientId only', async () => {
		let seenClientScope = null;
		setN8nChatAppendMessageForTests(async (params) => {
			seenClientScope = params.user.clientId;
			return { id: 'msg-1' };
		});

		installN8nChatFetchMock(async () => new Response(JSON.stringify({ reply: 'OK' }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		}));

		const app = mountChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			await fetchJson(`http://127.0.0.1:${port}`, '/chat', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer valid-token-a',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					message: 'Hello',
					clientId: CLIENT_B,
					client_id: CLIENT_B,
				}),
			});
			assert.equal(seenClientScope, CLIENT_A);
		} finally {
			await close(server);
		}
	});

	test('16. response does not expose secrets', async () => {
		setN8nChatAppendMessageForTests(async () => ({ id: 'msg-1' }));

		installN8nChatFetchMock(async () => new Response(JSON.stringify({ reply: 'OK' }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		}));

		const app = mountChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { rawText } = await fetchJson(`http://127.0.0.1:${port}`, '/chat', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer valid-token-a',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ message: 'Hello' }),
			});
			assert.doesNotMatch(rawText, /service_role|SUPABASE_SERVICE_ROLE_KEY|x-api-key/i);
		} finally {
			await close(server);
		}
	});
});

describe('Phase 5.7-B Ashy isolation', () => {
	test.afterEach(() => {
		resetSalesQueryImplForTests();
		clearConversationSessionsForTests();
	});

	function salesRows() {
		return [{
			id: 'sale-1',
			client_id: CLIENT_A,
			libelle: 'Poulet',
			quantite: 2,
			prix_unitaire: 10,
			montant_paye: 20,
			total_brut: 20,
			reste_a_payer: 0,
			date: '2026-08-10T10:00:00.000Z',
			statut: 'Payé',
		}];
	}

	test('12. Ashy v2 uses source backend only, not n8n', async () => {
		const ashyCalls = [];
		const n8nCalls = [];

		setAshyChatAppendMessageForTests(async (params) => {
			ashyCalls.push(params);
			return { id: 'ashy-1' };
		});
		setN8nChatAppendMessageForTests(async (params) => {
			n8nCalls.push(params);
			return { id: 'n8n-1' };
		});
		setSalesQueryImplForTests(async () => salesRows());

		const app = mountAshyApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { status } = await fetchJson(`http://127.0.0.1:${port}`, '/api/ashy/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: 'Combien de ventes ce mois ?' }),
			});

			assert.equal(status, 200);
			assert.ok(ashyCalls.length >= 1);
			assert.equal(n8nCalls.length, 0);
			assert.ok(ashyCalls.every((c) => c.source === 'backend'));
		} finally {
			await close(server);
		}
	});
});
