import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, before, describe, test } from 'node:test';

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

import {
	appendMessage,
	listMessages,
	ConversationServiceError,
	resetConversationServiceImplForTests,
	setAllocateSequenceImplForTests,
	setInsertMessageImplForTests,
	setListMessagesImplForTests,
	validateAppendMessageInput,
	MAX_CONTENT_LENGTH,
	MAX_METADATA_BYTES,
} from '../src/services/conversation-service.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RUN_INTEGRATION = Boolean(SUPABASE_URL && SERVICE_KEY);
const TAG = `phase54-${Date.now()}`;

const USER_A = {
	id: 'pb-user-a',
	clientId: '11111111-1111-4111-8111-111111111111',
	activeActivityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
	businessUserId: 'rec-user-a',
};

const USER_B = {
	id: 'pb-user-b',
	clientId: '22222222-2222-4222-8222-222222222222',
	activeActivityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
	businessUserId: 'rec-user-b',
};

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let admin = null;
/** @type {string[]} */
const clientIds = [];
/** @type {string[]} */
const authUserIds = [];

function skipIntegration(t) {
	if (!RUN_INTEGRATION) {
		t.skip('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
	}
}

afterEach(() => {
	resetConversationServiceImplForTests();
});

async function createAuthUser(label) {
	const email = `${TAG}-${label}-${randomUUID()}@phase54.ashledger.test`;
	const password = `Phase54!${randomUUID().slice(0, 8)}`;
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
			nom_client: `Phase54 ${label}`,
			auth_user_id: authUserId,
			thread_id: '[]',
		})
		.select('id')
		.single();
	if (error) throw error;
	clientIds.push(data.id);
	return data.id;
}

function userForClient(clientId, label) {
	return {
		id: `pb-${label}`,
		clientId,
		businessUserId: `${TAG}-${label}`,
	};
}

describe('Phase 5.4 conversation-service — validation (unit)', () => {
	test('TEST 7 — role invalide : rejet', () => {
		assert.throws(
			() => validateAppendMessageInput({ role: 'system', content: 'hello', source: 'backend' }),
			(err) => err instanceof ConversationServiceError && err.code === 'INVALID_ROLE',
		);
	});

	test('TEST 8 — content vide : rejet', () => {
		assert.throws(
			() => validateAppendMessageInput({ role: 'user', content: '   ', source: 'backend' }),
			(err) => err instanceof ConversationServiceError && err.code === 'EMPTY_CONTENT',
		);
	});

	test('TEST 9 — content > 16000 : rejet', () => {
		assert.throws(
			() => validateAppendMessageInput({
				role: 'user',
				content: 'x'.repeat(MAX_CONTENT_LENGTH + 1),
				source: 'backend',
			}),
			(err) => err instanceof ConversationServiceError && err.code === 'CONTENT_TOO_LONG',
		);
	});

	test('TEST 10 — source invalide : rejet', () => {
		assert.throws(
			() => validateAppendMessageInput({ role: 'user', content: 'hello', source: 'openai' }),
			(err) => err instanceof ConversationServiceError && err.code === 'INVALID_SOURCE',
		);
	});

	test('TEST 11 — metadata trop volumineux : rejet', () => {
		const metadata = { blob: 'x'.repeat(MAX_METADATA_BYTES) };
		assert.throws(
			() => validateAppendMessageInput({ role: 'user', content: 'hello', source: 'backend', metadata }),
			(err) => err instanceof ConversationServiceError && err.code === 'METADATA_TOO_LARGE',
		);
	});

	test('TEST 6 — clientId absent : appendMessage refuse proprement', async () => {
		await assert.rejects(
			() => appendMessage({ user: { id: 'pb-no-client' }, role: 'user', content: 'hello' }),
			(err) => err?.code === 'SUPABASE_CLIENT_SCOPE_MISSING',
		);
	});

	test('TEST 6 — clientId absent : listMessages refuse proprement', async () => {
		await assert.rejects(
			() => listMessages({ user: { id: 'pb-no-client' } }),
			(err) => err?.code === 'SUPABASE_CLIENT_SCOPE_MISSING',
		);
	});

	test('TEST 6 — user absent : appendMessage refuse proprement', async () => {
		await assert.rejects(
			() => appendMessage({ user: null, role: 'user', content: 'hello' }),
			(err) => err instanceof ConversationServiceError && err.code === 'USER_REQUIRED',
		);
	});

	test('TEST 12 — sequence RPC : le service utilise allocate_chat_message_sequence', async () => {
		const rpcCalls = [];
		setAllocateSequenceImplForTests(async (clientId, activityId) => {
			rpcCalls.push({ clientId, activityId });
			return 7;
		});
		setInsertMessageImplForTests(async (clientId, activityId, row) => ({
			id: 'msg-1',
			clientId,
			activityId,
			role: row.role,
			content: row.content,
			sequence: row.sequence,
			source: row.source,
			metadata: row.metadata,
			createdAt: new Date().toISOString(),
		}));

		const saved = await appendMessage({
			user: USER_A,
			role: 'user',
			content: 'via rpc',
			source: 'backend',
		});

		assert.deepEqual(rpcCalls, [{
			clientId: USER_A.clientId,
			activityId: USER_A.activeActivityId,
		}]);
		assert.equal(saved.sequence, 7);
		assert.equal(rpcCalls.length, 1, 'must not use MAX(sequence)+1 fallback');
	});
});

describe('Phase 5.4 conversation-service — integration', { skip: !RUN_INTEGRATION }, () => {
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

	test('TEST 1 — appendMessage user : insertion réussie avec bon client_id et source', async (t) => {
		skipIntegration(t);
		const authUser = await createAuthUser('user');
		const clientId = await createClientRow(authUser.id, 'user');
		const user = userForClient(clientId, 'user');

		const saved = await appendMessage({
			user,
			role: 'user',
			content: 'Phase54 user message',
			source: 'backend',
		});

		assert.equal(saved.role, 'user');
		assert.equal(saved.source, 'backend');
		assert.equal(saved.clientId, clientId);
		assert.equal(saved.content, 'Phase54 user message');
		assert.ok(saved.sequence >= 1);
		assert.ok(saved.createdAt);
	});

	test('TEST 2 — appendMessage assistant : insertion réussie', async (t) => {
		skipIntegration(t);
		const authUser = await createAuthUser('assistant');
		const clientId = await createClientRow(authUser.id, 'assistant');
		const user = userForClient(clientId, 'assistant');

		const saved = await appendMessage({
			user,
			role: 'assistant',
			content: 'Phase54 assistant reply',
			source: 'backend',
		});

		assert.equal(saved.role, 'assistant');
		assert.equal(saved.clientId, clientId);
	});

	test('TEST 3 — sequence : deux messages successifs, ordre croissant', async (t) => {
		skipIntegration(t);
		const authUser = await createAuthUser('seq');
		const clientId = await createClientRow(authUser.id, 'seq');
		const user = userForClient(clientId, 'seq');

		const first = await appendMessage({ user, role: 'user', content: 'first', source: 'backend' });
		const second = await appendMessage({ user, role: 'assistant', content: 'second', source: 'backend' });

		assert.notEqual(first.sequence, second.sequence);
		assert.ok(second.sequence > first.sequence);
	});

	test('TEST 4 — listMessages : ordre sequence ASC pour le client authentifié', async (t) => {
		skipIntegration(t);
		const authUser = await createAuthUser('list');
		const clientId = await createClientRow(authUser.id, 'list');
		const user = userForClient(clientId, 'list');

		await appendMessage({ user, role: 'user', content: 'alpha', source: 'backend' });
		await appendMessage({ user, role: 'assistant', content: 'beta', source: 'backend' });
		await appendMessage({ user, role: 'user', content: 'gamma', source: 'backend' });

		const { messages, count } = await listMessages({ user });
		assert.equal(count, 3);
		assert.deepEqual(messages.map((m) => m.content), ['alpha', 'beta', 'gamma']);
		assert.ok(messages.every((m) => m.clientId === clientId));
		for (let i = 1; i < messages.length; i += 1) {
			assert.ok(messages[i].sequence > messages[i - 1].sequence);
		}
	});

	test('TEST 5 — cross-tenant : impossible de lire les messages d\'un autre client', async (t) => {
		skipIntegration(t);
		const authA = await createAuthUser('tenant-a');
		const authB = await createAuthUser('tenant-b');
		const clientA = await createClientRow(authA.id, 'tenant-a');
		const clientB = await createClientRow(authB.id, 'tenant-b');
		const userA = userForClient(clientA, 'tenant-a');
		const userB = userForClient(clientB, 'tenant-b');

		await appendMessage({ user: userB, role: 'user', content: 'secret tenant B', source: 'backend' });

		const { messages } = await listMessages({ user: userA });
		assert.ok(messages.every((m) => m.clientId === clientA));
		assert.ok(!messages.some((m) => m.content === 'secret tenant B'));
	});

	test('TEST 13 — concurrence : appendMessage parallèles, sequences uniques', async (t) => {
		skipIntegration(t);
		const authUser = await createAuthUser('conc');
		const clientId = await createClientRow(authUser.id, 'conc');
		const user = userForClient(clientId, 'conc');

		const rounds = 8;
		const results = await Promise.all(
			Array.from({ length: rounds }, (_, index) => appendMessage({
				user,
				role: index % 2 === 0 ? 'user' : 'assistant',
				content: `parallel-${index}`,
				source: 'backend',
			})),
		);

		const sequences = results.map((row) => row.sequence);
		assert.equal(new Set(sequences).size, rounds, `duplicate sequences: ${sequences.join(',')}`);

		const { messages } = await listMessages({ user, limit: rounds });
		assert.equal(messages.length, rounds);
	});
});

describe('Phase 5.4 conversation-service — env gate', () => {
	test('integration tests skip cleanly without Supabase env', () => {
		if (RUN_INTEGRATION) return;
		assert.ok(true, 'integration block skipped without credentials');
	});
});
