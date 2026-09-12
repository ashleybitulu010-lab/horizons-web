import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { after, afterEach, before, describe, test } from 'node:test';

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

import history from '../src/routes/history.js';
import { requireAuth, rejectForeignIdentity } from '../src/middleware/auth.js';
import { errorMiddleware } from '../src/middleware/error.js';
import {
	HistoryUnavailableError,
	resolveChatHistory,
} from '../src/services/history-loader.js';
import {
	resetConversationServiceImplForTests,
	setListMessagesImplForTests,
} from '../src/services/conversation-service.js';
import {
	resetFetchN8nHistoryImplForTests,
	setFetchN8nHistoryImplForTests,
} from '../src/utils/n8n-history.js';
import { mapSupabaseMessagesToHistoryDto } from '../src/utils/history-mapper.js';
import {
	resetBuildRequestUserImplForTests,
	setBuildRequestUserImplForTests,
} from '../src/services/user-context.js';
import {
	resetTokenVerifierForTests,
	setTokenVerifierForTests,
} from '../src/services/pocketbase-auth.js';

import { appendMessage, listMessages } from '../src/services/conversation-service.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RUN_INTEGRATION = Boolean(SUPABASE_URL && SERVICE_KEY);
const TAG = `phase56-${Date.now()}`;

const ACTIVITY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTIVITY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const USER_A = {
	id: 'pb_user_a',
	email: 'a@example.com',
	airtableId: 'recA123',
	businessUserId: 'recA123',
	clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
	activeActivityId: ACTIVITY_A,
};

const USER_B = {
	id: 'pb_user_b',
	email: 'b@example.com',
	airtableId: 'recB456',
	businessUserId: 'recB456',
	clientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
	activeActivityId: ACTIVITY_B,
};

const USER_NO_CLIENT = {
	id: 'pb_user_nc',
	email: 'nc@example.com',
	businessUserId: 'pb_user_nc',
	clientId: null,
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

	if (record.id === USER_A.id) {
		return { ...base, clientId: USER_A.clientId, activeActivityId: USER_A.activeActivityId };
	}
	if (record.id === USER_B.id) {
		return { ...base, clientId: USER_B.clientId, activeActivityId: USER_B.activeActivityId };
	}
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

function mountHistoryApp() {
	const app = express();
	app.use(express.json());
	app.post('/history', requireAuth, rejectForeignIdentity, history);
	app.use(errorMiddleware);
	return app;
}

afterEach(() => {
	resetConversationServiceImplForTests();
	resetFetchN8nHistoryImplForTests();
	resetTokenVerifierForTests();
	resetBuildRequestUserImplForTests();
});

function supabaseRow(overrides) {
	return {
		id: 'msg-1',
		clientId: USER_A.clientId,
		activityId: USER_A.activeActivityId,
		role: 'user',
		content: 'Hello',
		sequence: 1,
		source: 'backend',
		metadata: {},
		createdAt: '2026-08-01T10:00:00.000Z',
		...overrides,
	};
}

describe('Phase 5.6 history-loader — unit', () => {
	test('1. Supabase history success', async () => {
		setListMessagesImplForTests(async () => [supabaseRow({
			id: 'msg-1',
			content: 'Hello Supabase',
		})]);
		setFetchN8nHistoryImplForTests(async () => ({ messages: [] }));

		const result = await resolveChatHistory(USER_A);
		assert.equal(result.source, 'supabase');
		assert.equal(result.messages.length, 1);
		assert.equal(result.messages[0].content, 'Hello Supabase');
		assert.equal(result.messages[0].timestamp, '2026-08-01T10:00:00.000Z');
	});

	test('2. Supabase empty → n8n fallback', async () => {
		setListMessagesImplForTests(async () => []);
		setFetchN8nHistoryImplForTests(async () => ({
			messages: [{ id: 'n8n-1', role: 'assistant', content: 'Legacy', timestamp: '2026-07-01T09:00:00.000Z' }],
		}));

		const result = await resolveChatHistory(USER_A);
		assert.equal(result.source, 'n8n_history');
		assert.equal(result.messages[0].content, 'Legacy');
	});

	test('3. Supabase error → n8n fallback', async () => {
		setListMessagesImplForTests(async () => {
			const err = new Error('supabase down');
			err.code = 'SELECT_FAILED';
			throw err;
		});
		setFetchN8nHistoryImplForTests(async () => ({
			messages: [{ id: 'n8n-1', role: 'user', content: 'Fallback', timestamp: '2026-07-01T09:00:00.000Z' }],
		}));

		const result = await resolveChatHistory(USER_A);
		assert.equal(result.source, 'n8n_history');
		assert.equal(result.messages.length, 1);
	});

	test('4. n8n error with Supabase data still succeeds', async () => {
		setListMessagesImplForTests(async () => [supabaseRow({
			id: 'msg-1',
			content: 'Primary',
		})]);
		setFetchN8nHistoryImplForTests(async () => {
			throw new Error('n8n history failed: 502');
		});

		const result = await resolveChatHistory(USER_A);
		assert.equal(result.source, 'supabase');
		assert.equal(result.messages.length, 1);
	});

	test('5. both sources unavailable → HISTORY_UNAVAILABLE', async () => {
		setListMessagesImplForTests(async () => {
			const err = new Error('select failed');
			err.code = 'SELECT_FAILED';
			throw err;
		});
		setFetchN8nHistoryImplForTests(async () => {
			throw new Error('n8n history failed: 502');
		});

		await assert.rejects(
			() => resolveChatHistory(USER_A),
			(err) => err instanceof HistoryUnavailableError,
		);
	});

	test('6. correct DTO shape from mapper', () => {
		const dto = mapSupabaseMessagesToHistoryDto([{
			id: 'uuid-1',
			clientId: USER_A.clientId,
			role: 'assistant',
			content: 'Reply',
			sequence: 2,
			source: 'backend',
			metadata: { route: 'ashy' },
			createdAt: '2026-08-01T11:00:00.000Z',
		}]);

		assert.deepEqual(dto, [{
			id: 'uuid-1',
			role: 'assistant',
			content: 'Reply',
			timestamp: '2026-08-01T11:00:00.000Z',
		}]);
		assert.equal(Object.hasOwn(dto[0], 'clientId'), false);
		assert.equal(Object.hasOwn(dto[0], 'sequence'), false);
	});

	test('7. merged source when both have messages', async () => {
		setListMessagesImplForTests(async () => [supabaseRow({
			id: 'sb-1',
			content: 'New',
			createdAt: '2026-08-10T10:00:00.000Z',
		})]);
		setFetchN8nHistoryImplForTests(async () => ({
			messages: [{ id: 'n8n-old', role: 'user', content: 'Old', timestamp: '2026-07-01T09:00:00.000Z' }],
		}));

		const result = await resolveChatHistory(USER_A);
		assert.equal(result.source, 'merged');
		assert.equal(result.messages.length, 2);
		assert.equal(result.messages[0].content, 'Old');
		assert.equal(result.messages[1].content, 'New');
	});

	test('8. user without client scope uses n8n only', async () => {
		let listCalled = false;
		setListMessagesImplForTests(async () => {
			listCalled = true;
			return [];
		});
		setFetchN8nHistoryImplForTests(async () => ({
			messages: [{ id: 'n8n-1', role: 'user', content: 'Only n8n', timestamp: '2026-07-01T09:00:00.000Z' }],
		}));

		const result = await resolveChatHistory(USER_NO_CLIENT);
		assert.equal(result.source, 'n8n_history');
		assert.equal(listCalled, false);
	});

	test('12. repeated identical messages are not blindly collapsed in merge', async () => {
		setListMessagesImplForTests(async () => [
			supabaseRow({
				id: 'sb-1',
				content: 'Bonjour',
				sequence: 1,
				createdAt: '2026-08-01T10:00:00.000Z',
			}),
			supabaseRow({
				id: 'sb-2',
				content: 'Bonjour',
				sequence: 3,
				createdAt: '2026-08-05T10:00:00.000Z',
			}),
		]);
		setFetchN8nHistoryImplForTests(async () => ({
			messages: [
				{ id: 'n8n-1', role: 'user', content: 'Bonjour', timestamp: '2026-08-05T10:00:30.000Z' },
			],
		}));

		const result = await resolveChatHistory(USER_A);
		assert.equal(result.messages.length, 2);
		assert.ok(result.messages.every((m) => m.id.startsWith('sb-')));
	});
});

describe('Phase 5.6 POST /history — route', () => {
	test.beforeEach(() => {
		setTokenVerifierForTests(async (token) => {
			if (token === 'valid-token-a') return USER_A;
			if (token === 'valid-token-b') return USER_B;
			return null;
		});
		setBuildRequestUserImplForTests(async (record) => buildUserFromRecord(record));
	});

	test('9. tenant isolation via listMessages scope (mock)', async () => {
		setListMessagesImplForTests(async (clientId) => {
			assert.equal(clientId, USER_A.clientId);
			return [supabaseRow({
				id: 'msg-a',
				content: 'Secret A',
			})];
		});
		setFetchN8nHistoryImplForTests(async () => ({ messages: [] }));

		const app = mountHistoryApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/history', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer valid-token-a',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ user_id: USER_A.airtableId, encoding: 'UTF-8' }),
			});

			assert.equal(status, 200);
			assert.equal(body.success, true);
			assert.equal(body.messages[0].content, 'Secret A');
			assert.equal(body.remote.source, 'supabase');
		} finally {
			await close(server);
		}
	});

	test('10. unauthorized request → 401', async () => {
		const app = mountHistoryApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/history', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ user_id: USER_A.airtableId }),
			});
			assert.equal(status, 401);
			assert.equal(body.error.code, 'UNAUTHENTICATED');
		} finally {
			await close(server);
		}
	});

	test('11. foreign identity rejection → 403', async () => {
		const app = mountHistoryApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/history', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer valid-token-a',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ user_id: USER_B.airtableId }),
			});
			assert.equal(status, 403);
			assert.equal(body.error.code, 'FORBIDDEN');
		} finally {
			await close(server);
		}
	});

	test('13. frontend response compatibility', async () => {
		setListMessagesImplForTests(async () => [supabaseRow({
			id: 'msg-1',
			role: 'assistant',
			content: 'Réponse',
			sequence: 2,
			createdAt: '2026-08-01T11:00:00.000Z',
		})]);
		setFetchN8nHistoryImplForTests(async () => ({ messages: [] }));

		const app = mountHistoryApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			const { status, body, rawText } = await fetchJson(`http://127.0.0.1:${port}`, '/history', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer valid-token-a',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ user_id: USER_A.airtableId, encoding: 'UTF-8' }),
			});

			assert.equal(status, 200);
			assert.equal(body.success, true);
			assert.ok(Array.isArray(body.messages));
			assert.equal(typeof body.messages[0].id, 'string');
			assert.equal(body.messages[0].role, 'assistant');
			assert.equal(body.messages[0].content, 'Réponse');
			assert.ok(body.messages[0].timestamp);
			assert.doesNotMatch(rawText, /service_role|supabase.*key|postgres password/i);
		} finally {
			await close(server);
		}
	});

	test('14. body clientId is ignored — req.user scope only', async () => {
		let seenClientId = null;
		setListMessagesImplForTests(async (clientId) => {
			seenClientId = clientId;
			return [];
		});
		setFetchN8nHistoryImplForTests(async () => ({ messages: [] }));

		const app = mountHistoryApp();
		const server = await listen(app);
		const { port } = server.address();

		try {
			await fetchJson(`http://127.0.0.1:${port}`, '/history', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer valid-token-a',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					user_id: USER_A.airtableId,
					clientId: USER_B.clientId,
					client_id: USER_B.clientId,
				}),
			});
			assert.equal(seenClientId, USER_A.clientId);
		} finally {
			await close(server);
		}
	});
});

describe('Phase 5.6 history — Supabase integration', { skip: !RUN_INTEGRATION }, () => {
	/** @type {import('@supabase/supabase-js').SupabaseClient} */
	let admin;
	const clientIds = [];
	const authUserIds = [];

	before(async () => {
		admin = createClient(SUPABASE_URL, SERVICE_KEY, {
			auth: { autoRefreshToken: false, persistSession: false },
			global: { fetch },
			realtime: { transport: ws },
		});
	});

	after(async () => {
		for (const id of clientIds) {
			await admin.from('clients').delete().eq('id', id);
		}
		for (const uid of authUserIds) {
			await admin.auth.admin.deleteUser(uid);
		}
	});

	test('integration — append + resolveChatHistory reads Supabase', async (t) => {
		if (!RUN_INTEGRATION) t.skip('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');

		resetConversationServiceImplForTests();
		resetFetchN8nHistoryImplForTests();
		setFetchN8nHistoryImplForTests(async () => ({ messages: [] }));

		const email = `${TAG}-${randomUUID()}@phase56.ashledger.test`;
		const { data: authData, error: authErr } = await admin.auth.admin.createUser({
			email,
			password: `Phase56!${randomUUID().slice(0, 8)}`,
			email_confirm: true,
		});
		if (authErr) throw authErr;
		authUserIds.push(authData.user.id);

		const userId = `${TAG}-${randomUUID()}`;
		const { data: clientRow, error: clientErr } = await admin
			.from('clients')
			.insert({
				user_id: userId,
				nom_client: 'Phase56 history',
				auth_user_id: authData.user.id,
				thread_id: '[]',
			})
			.select('id')
			.single();
		if (clientErr) throw clientErr;
		clientIds.push(clientRow.id);

		const user = {
			id: 'pb-int',
			clientId: clientRow.id,
			businessUserId: userId,
		};

		await appendMessage({ user, role: 'user', content: 'Integration user', source: 'backend' });
		await appendMessage({ user, role: 'assistant', content: 'Integration assistant', source: 'backend' });

		const result = await resolveChatHistory(user);
		assert.equal(result.source, 'supabase');
		assert.equal(result.messages.length, 2);
		assert.equal(result.messages[0].role, 'user');
		assert.equal(result.messages[1].role, 'assistant');
		assert.ok(result.messages[0].timestamp);
		assert.ok(result.messages[1].timestamp);

		const listed = await listMessages({ user });
		assert.equal(listed.count, 2);
	});
});

describe('Phase 5.6 history — env gate', () => {
	test('integration skipped without Supabase credentials', () => {
		if (RUN_INTEGRATION) return;
		assert.ok(true, 'integration skipped locally');
	});
});
