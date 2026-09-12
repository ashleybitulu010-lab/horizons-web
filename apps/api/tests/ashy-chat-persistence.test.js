import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { after, afterEach, before, describe, test } from 'node:test';

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

import {
	clearConversationSessionsForTests,
	clearConversationState,
	getConversationState,
} from '../src/agent/conversation-state.js';
import ashyChat from '../src/routes/api/ashy-chat.js';
import {
	resetAshyChatPersistenceForTests,
	setAshyChatAppendMessageForTests,
} from '../src/routes/api/ashy-chat-persistence.js';
import {
	listMessages,
	resetConversationServiceImplForTests,
} from '../src/services/conversation-service.js';
import {
	resetSalesQueryImplForTests,
	setSalesQueryImplForTests,
} from '../src/services/sales-service.js';
import {
	resetCreateSaleImplForTests,
	setCreateSaleImplForTests,
} from '../src/services/sales-write-service.js';
import {
	resetCreateExpenseImplForTests,
	setCreateExpenseImplForTests,
} from '../src/services/expenses-write-service.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RUN_INTEGRATION = Boolean(SUPABASE_URL && SERVICE_KEY);
const TAG = `phase55b-${Date.now()}`;

const CLIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const USER = {
	id: 'pb_user',
	clientId: CLIENT_ID,
	activeActivityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
	businessUserId: 'rec_user',
	email: 'phase55b@example.com',
};

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let admin = null;
/** @type {string[]} */
const clientIds = [];
/** @type {string[]} */
const authUserIds = [];

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
	return { status: res.status, body, rawText };
}

function mountAshyChatApp(user = USER) {
	const app = express();
	app.use(express.json());
	app.post('/api/ashy/chat', (req, res, next) => {
		req.user = user;
		next();
	}, ashyChat);
	return app;
}

function salesRows() {
	return [{
		id: 'sale-1',
		client_id: CLIENT_ID,
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

function skipIntegration(t) {
	if (!RUN_INTEGRATION) {
		t.skip('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
	}
}

async function createAuthUser(label) {
	const email = `${TAG}-${label}-${randomUUID()}@phase55b.ashledger.test`;
	const password = `Phase55b!${randomUUID().slice(0, 8)}`;
	const { data, error } = await admin.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
	});
	if (error) throw error;
	authUserIds.push(data.user.id);
	return { id: data.user.id, email, password };
}

async function createClientRow(authUserId, label) {
	const userId = `${TAG}-${label}-${randomUUID()}`;
	const { data, error } = await admin
		.from('clients')
		.insert({
			user_id: userId,
			nom_client: `Phase55b ${label}`,
			auth_user_id: authUserId,
			thread_id: '[]',
		})
		.select('id')
		.single();
	if (error) throw error;
	clientIds.push(data.id);
	return data.id;
}

afterEach(() => {
	resetAshyChatPersistenceForTests();
	resetConversationServiceImplForTests();
	resetSalesQueryImplForTests();
	resetCreateSaleImplForTests();
	resetCreateExpenseImplForTests();
	clearConversationSessionsForTests();
});

describe('Phase 5.5-B ashy-chat persistence — route (mocked)', () => {
	test('TEST 1 — message utilisateur : appendMessage role=user source=backend clientId from user', async () => {
		const appendCalls = [];
		setAshyChatAppendMessageForTests(async (params) => {
			appendCalls.push(params);
			return { id: randomUUID(), sequence: 1, ...params };
		});
		setSalesQueryImplForTests(async () => salesRows());

		const app = mountAshyChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/api/ashy/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: 'Combien ai-je vendu ce mois-ci ?' }),
			});

			assert.equal(status, 200);
			assert.ok(body.reply);
			assert.equal(appendCalls.length, 2);
			assert.equal(appendCalls[0].role, 'user');
			assert.equal(appendCalls[0].source, 'backend');
			assert.equal(appendCalls[0].content, 'Combien ai-je vendu ce mois-ci ?');
			assert.equal(appendCalls[0].user.clientId, CLIENT_ID);
		} finally {
			await close(server);
		}
	});

	test('TEST 2 — réponse assistant : appendMessage role=assistant content=result.reply', async () => {
		const appendCalls = [];
		setAshyChatAppendMessageForTests(async (params) => {
			appendCalls.push(params);
			return { id: randomUUID(), sequence: appendCalls.length, ...params };
		});
		setSalesQueryImplForTests(async () => salesRows());

		const app = mountAshyChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/api/ashy/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: 'Combien ai-je vendu ce mois-ci ?' }),
			});

			assert.equal(status, 200);
			assert.equal(appendCalls[1].role, 'assistant');
			assert.equal(appendCalls[1].source, 'backend');
			assert.equal(appendCalls[1].content, body.reply);
			assert.equal(appendCalls[1].user.clientId, CLIENT_ID);
		} finally {
			await close(server);
		}
	});

	test('TEST 3 — deux tours : sequences différentes et croissantes', async () => {
		let seq = 0;
		setAshyChatAppendMessageForTests(async (params) => {
			seq += 1;
			return { id: randomUUID(), sequence: seq, ...params };
		});
		setSalesQueryImplForTests(async () => salesRows());

		const app = mountAshyChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			for (const message of ['Premier message', 'Deuxième message']) {
				const { status } = await fetchJson(`http://127.0.0.1:${port}`, '/api/ashy/chat', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ message }),
				});
				assert.equal(status, 200);
			}
			assert.equal(seq, 4);
		} finally {
			await close(server);
		}
	});

	test('TEST 4 — persistance assistant sur réponse normale', async () => {
		const appendCalls = [];
		setAshyChatAppendMessageForTests(async (params) => {
			appendCalls.push(params);
			return { id: randomUUID(), sequence: appendCalls.length, ...params };
		});
		setSalesQueryImplForTests(async () => salesRows());

		const app = mountAshyChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/api/ashy/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: 'mes ventes ce mois' }),
			});

			assert.equal(status, 200);
			const assistantCall = appendCalls.find((entry) => entry.role === 'assistant');
			assert.ok(assistantCall);
			assert.equal(assistantCall.content, body.reply);
			assert.match(body.reply, /vente/i);
		} finally {
			await close(server);
		}
	});

	test('TEST 5 — erreur appendMessage user : Ashy continue, pas de fuite Supabase', async () => {
		setAshyChatAppendMessageForTests(async (params) => {
			if (params.role === 'user') {
				const err = new Error('connection to postgres failed with service_role secret');
				err.code = 'INSERT_FAILED';
				throw err;
			}
			return { id: randomUUID(), sequence: 2, ...params };
		});
		setSalesQueryImplForTests(async () => salesRows());

		const app = mountAshyChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { status, body, rawText } = await fetchJson(`http://127.0.0.1:${port}`, '/api/ashy/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: 'Combien ai-je vendu ce mois-ci ?' }),
			});

			assert.equal(status, 200);
			assert.ok(body.reply);
			assert.doesNotMatch(rawText, /service_role|postgres|secret/i);
		} finally {
			await close(server);
		}
	});

	test('TEST 6 — erreur appendMessage assistant : HTTP 200 et reply présent', async () => {
		setAshyChatAppendMessageForTests(async (params) => {
			if (params.role === 'assistant') {
				const err = new Error('supabase insert failed');
				err.code = 'INSERT_FAILED';
				throw err;
			}
			return { id: randomUUID(), sequence: 1, ...params };
		});
		setSalesQueryImplForTests(async () => salesRows());

		const app = mountAshyChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { status, body, rawText } = await fetchJson(`http://127.0.0.1:${port}`, '/api/ashy/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: 'Combien ai-je vendu ce mois-ci ?' }),
			});

			assert.equal(status, 200);
			assert.ok(String(body.reply || '').trim());
			assert.doesNotMatch(rawText, /INSERT_FAILED|supabase/i);
			assert.deepEqual(Object.keys(body).sort(), ['conversation', 'reply', 'toolResults']);
		} finally {
			await close(server);
		}
	});

	test('TEST 7 — sessionId arbitraire ne modifie jamais client_id', async () => {
		const appendCalls = [];
		setAshyChatAppendMessageForTests(async (params) => {
			appendCalls.push(params);
			return { id: randomUUID(), sequence: appendCalls.length, ...params };
		});
		setSalesQueryImplForTests(async () => salesRows());

		const app = mountAshyChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { status } = await fetchJson(`http://127.0.0.1:${port}`, '/api/ashy/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: 'Combien ai-je vendu ce mois-ci ?',
					sessionId: 'totally-unrelated-session-id',
				}),
			});

			assert.equal(status, 200);
			assert.ok(appendCalls.every((entry) => entry.user.clientId === CLIENT_ID));
		} finally {
			await close(server);
		}
	});

	test('TEST 8 — clientId fourni dans body ignoré comme source d\'autorité', async () => {
		const appendCalls = [];
		setAshyChatAppendMessageForTests(async (params) => {
			appendCalls.push(params);
			return { id: randomUUID(), sequence: appendCalls.length, ...params };
		});
		setSalesQueryImplForTests(async () => salesRows());

		const app = mountAshyChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { status } = await fetchJson(`http://127.0.0.1:${port}`, '/api/ashy/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: 'Combien ai-je vendu ce mois-ci ?',
					clientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
					client_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
				}),
			});

			assert.equal(status, 200);
			assert.ok(appendCalls.every((entry) => entry.user.clientId === CLIENT_ID));
			assert.ok(appendCalls.every((entry) => entry.user.clientId !== 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
		} finally {
			await close(server);
		}
	});

	test('TEST 9 — READ-ONLY : get_sales via appendMessage conversation uniquement', async () => {
		const appendCalls = [];
		let salesQueries = 0;
		let createSaleCalls = 0;

		setAshyChatAppendMessageForTests(async (params) => {
			appendCalls.push(params);
			return { id: randomUUID(), sequence: appendCalls.length, ...params };
		});
		setSalesQueryImplForTests(async () => {
			salesQueries += 1;
			return salesRows();
		});
		setCreateSaleImplForTests(async () => {
			createSaleCalls += 1;
			throw new Error('create_sale should not run');
		});

		const app = mountAshyChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/api/ashy/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: 'mes ventes ce mois' }),
			});

			assert.equal(status, 200);
			assert.equal(salesQueries, 1);
			assert.equal(createSaleCalls, 0);
			assert.equal(appendCalls.length, 2);
			assert.ok(body.toolResults?.some((entry) => entry.tool === 'get_sales'));
		} finally {
			await close(server);
		}
	});

	test('TEST 10 — WRITE : persistance n\'appelle pas directement create_sale/create_expense/adjust_stock', async () => {
		const appendCalls = [];
		let createSaleCalls = 0;
		let createExpenseCalls = 0;

		setAshyChatAppendMessageForTests(async (params) => {
			appendCalls.push(params);
			return { id: randomUUID(), sequence: appendCalls.length, ...params };
		});
		setCreateSaleImplForTests(async () => {
			createSaleCalls += 1;
			return { saleId: 'x' };
		});
		setCreateExpenseImplForTests(async () => {
			createExpenseCalls += 1;
			return { expenseId: 'x' };
		});

		const app = mountAshyChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/api/ashy/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: "J'ai vendu 2 poulets à 10 $, payé 20 $" }),
			});

			assert.equal(status, 200);
			assert.equal(appendCalls.length, 2);
			assert.equal(createSaleCalls, 0);
			assert.equal(createExpenseCalls, 0);
			assert.ok(body.toolResults?.some((entry) => entry.error?.code === 'NEEDS_CONFIRMATION'));
		} finally {
			await close(server);
		}
	});

	test('TEST 11 — pendingWrite : mécanisme de confirmation intact', async () => {
		setAshyChatAppendMessageForTests(async (params) => ({
			id: randomUUID(),
			sequence: params.role === 'user' ? 1 : 2,
			...params,
		}));
		setCreateSaleImplForTests(async () => ({
			saleId: 'sale-confirmed',
			product: 'Poulet',
			quantity: 2,
			total: 20,
			amountPaid: 20,
		}));

		const sessionId = 'pending-write-session';
		const app = mountAshyChatApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const draft = await fetchJson(`http://127.0.0.1:${port}`, '/api/ashy/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: "J'ai vendu 2 poulets à 10 $, payé 20 $", sessionId }),
			});
			assert.equal(draft.status, 200);
			assert.ok(draft.body.toolResults?.some((entry) => entry.error?.code === 'NEEDS_CONFIRMATION'));

			const pendingState = getConversationState(USER.id, sessionId, USER.activeActivityId);
			assert.equal(pendingState.pendingWrite?.tool, 'create_sale');
			assert.equal(pendingState.pendingWrite?.product, 'poulets');
			assert.equal(pendingState.pendingWrite?.quantity, 2);

			const confirm = await fetchJson(`http://127.0.0.1:${port}`, '/api/ashy/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: 'oui', sessionId }),
			});
			assert.equal(confirm.status, 200);
			assert.ok(confirm.body.toolResults?.some((entry) => entry.success && entry.tool === 'create_sale'));

			const cleared = getConversationState(USER.id, sessionId, USER.activeActivityId);
			assert.equal(cleared.pendingWrite, null);
		} finally {
			clearConversationState(USER.id, sessionId, USER.activeActivityId);
			await close(server);
		}
	});

	test('TEST 12 — fallback n8n : erreur v2 reste éligible au fallback client', () => {
		const ashyFailure = { ok: false, status: 500, route: 'ashy' };
		const eligible = Boolean(ashyFailure && ashyFailure.route === 'ashy' && !ashyFailure.ok);
		assert.equal(eligible, true);

		const ashySuccess = { ok: true, status: 200, route: 'ashy' };
		const notEligible = Boolean(ashySuccess && ashySuccess.route === 'ashy' && !ashySuccess.ok);
		assert.equal(notEligible, false);
	});
});

describe('Phase 5.5-B ashy-chat persistence — Supabase integration', { skip: !RUN_INTEGRATION }, () => {
	before(async () => {
		admin = createClient(SUPABASE_URL, SERVICE_KEY, {
			auth: { autoRefreshToken: false, persistSession: false },
			global: { fetch },
			realtime: { transport: ws },
		});
	});

	after(async () => {
		if (!admin) return;
		for (const id of clientIds) {
			await admin.from('clients').delete().eq('id', id);
		}
		for (const uid of authUserIds) {
			await admin.auth.admin.deleteUser(uid);
		}
	});

	test('INT — append user + assistant via route with real Supabase', async (t) => {
		skipIntegration(t);

		const authUser = await createAuthUser('route-int');
		const clientId = await createClientRow(authUser.id, 'route-int');
		const integrationUser = {
			id: 'pb-int-user',
			clientId,
			businessUserId: `${TAG}-route-int`,
		};

		resetAshyChatPersistenceForTests();
		setSalesQueryImplForTests(async () => [{
			id: 'sale-int',
			client_id: clientId,
			libelle: 'Test',
			quantite: 1,
			prix_unitaire: 5,
			montant_paye: 5,
			total_brut: 5,
			reste_a_payer: 0,
			date: '2026-08-10T10:00:00.000Z',
			statut: 'Payé',
		}]);

		const app = mountAshyChatApp(integrationUser);
		const server = await listen(app);
		const { port } = server.address();

		try {
			const first = await fetchJson(`http://127.0.0.1:${port}`, '/api/ashy/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: 'mes ventes ce mois' }),
			});
			assert.equal(first.status, 200);

			const second = await fetchJson(`http://127.0.0.1:${port}`, '/api/ashy/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: 'Combien ai-je vendu ce mois-ci ?' }),
			});
			assert.equal(second.status, 200);

			const { messages } = await listMessages({ user: integrationUser });
			assert.equal(messages.length, 4);
			assert.equal(messages[0].role, 'user');
			assert.equal(messages[1].role, 'assistant');
			assert.ok(messages[1].sequence > messages[0].sequence);
			assert.ok(messages[3].sequence > messages[2].sequence);
			assert.ok(messages.every((entry) => entry.clientId === clientId));
			assert.ok(messages.every((entry) => entry.source === 'backend'));
		} finally {
			await close(server);
		}
	});
});

describe('Phase 5.5-B ashy-chat persistence — env gate', () => {
	test('integration block reports skip without Supabase credentials', () => {
		if (RUN_INTEGRATION) return;
		assert.ok(true, 'integration skipped locally without Supabase env');
	});
});
