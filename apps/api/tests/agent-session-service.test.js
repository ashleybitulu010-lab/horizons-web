import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, before, describe, test } from 'node:test';

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

import {
	getSession,
	saveSession,
	clearSession,
	AgentSessionServiceError,
	validateSaveSessionInput,
	validateSessionPayload,
	resetAgentSessionServiceImplForTests,
	setGetSessionImplForTests,
	setSaveSessionImplForTests,
	setClearSessionImplForTests,
	MAX_PAYLOAD_BYTES,
	VALID_STATE_TYPES,
} from '../src/services/agent-session-service.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RUN_INTEGRATION = Boolean(SUPABASE_URL && SERVICE_KEY);
const TAG = `phase58b-${Date.now()}`;

const CLIENT_A = '11111111-1111-4111-8111-111111111111';
const CLIENT_B = '22222222-2222-4222-8222-222222222222';

const ACTIVITY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const ACTIVITY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';

const USER_A = {
	id: 'pb-user-a',
	clientId: CLIENT_A,
	activeActivityId: ACTIVITY_A,
	businessUserId: 'rec-user-a',
};

const USER_B = {
	id: 'pb-user-b',
	clientId: CLIENT_B,
	activeActivityId: ACTIVITY_B,
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
	resetAgentSessionServiceImplForTests();
});

async function createAuthUser(label) {
	const email = `${TAG}-${label}-${randomUUID()}@phase58b.ashledger.test`;
	const password = `Phase58b!${randomUUID().slice(0, 8)}`;
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
			nom_client: `Phase58b ${label}`,
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

describe('Phase 5.8-B agent-session-service — validation (unit)', () => {
	test('stateType invalide : rejet', () => {
		assert.throws(
			() => validateSaveSessionInput({ stateType: 'active', payload: {} }),
			(err) => err instanceof AgentSessionServiceError && err.code === 'INVALID_STATE_TYPE',
		);
	});

	test('stateType manquant : rejet', () => {
		assert.throws(
			() => validateSaveSessionInput({ payload: {} }),
			(err) => err instanceof AgentSessionServiceError && err.code === 'INVALID_STATE_TYPE',
		);
	});

	test('payload non objet : rejet', () => {
		assert.throws(
			() => validateSessionPayload([]),
			(err) => err instanceof AgentSessionServiceError && err.code === 'INVALID_PAYLOAD',
		);
		assert.throws(
			() => validateSessionPayload('text'),
			(err) => err instanceof AgentSessionServiceError && err.code === 'INVALID_PAYLOAD',
		);
	});

	test('payload trop volumineux : rejet', () => {
		const payload = { blob: 'x'.repeat(MAX_PAYLOAD_BYTES) };
		assert.throws(
			() => validateSessionPayload(payload),
			(err) => err instanceof AgentSessionServiceError && err.code === 'PAYLOAD_TOO_LARGE',
		);
	});

	test('awaiting invalide : rejet', () => {
		assert.throws(
			() => validateSaveSessionInput({ stateType: 'draft', payload: {}, awaiting: 'unknown' }),
			(err) => err instanceof AgentSessionServiceError && err.code === 'INVALID_AWAITING',
		);
	});

	test('awaiting valide : accepté', () => {
		for (const awaiting of ['slots', 'confirm', 'price_choice']) {
			const result = validateSaveSessionInput({ stateType: 'pending', payload: {}, awaiting });
			assert.equal(result.awaiting, awaiting);
		}
	});

	test('stateType draft et pending : acceptés', () => {
		for (const stateType of VALID_STATE_TYPES) {
			const result = validateSaveSessionInput({ stateType, payload: { topic: 'test' } });
			assert.equal(result.stateType, stateType);
		}
	});
});

describe('Phase 5.8-B agent-session-service — tenant scope (unit)', () => {
	test('TEST 1 — Client A crée une session draft', async () => {
		const store = new Map();
		setSaveSessionImplForTests(async (scope, row) => ({
			id: 'sess-a-draft',
			clientId: scope.clientId,
			activityId: scope.activityId,
			stateType: row.stateType,
			payload: row.payload,
			intention: row.intention,
			awaiting: row.awaiting,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}));
		setGetSessionImplForTests(async (scope, stateType) => {
			const key = `${scope.clientId}:${stateType}`;
			return store.get(key) ?? null;
		});

		const saved = await saveSession({
			user: USER_A,
			stateType: 'draft',
			payload: { topic: 'vente', filters: {} },
		});
		store.set(`${CLIENT_A}:draft`, saved);

		assert.equal(saved.clientId, CLIENT_A);
		assert.equal(saved.stateType, 'draft');
		assert.deepEqual(saved.payload, { topic: 'vente', filters: {} });
	});

	test('TEST 2 — Client A peut relire sa session', async () => {
		const sessionRow = {
			id: 'sess-a-draft',
			clientId: CLIENT_A,
			stateType: 'draft',
			payload: { topic: 'vente' },
			intention: null,
			awaiting: null,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		setGetSessionImplForTests(async (scope, stateType) => {
			if (scope.clientId === CLIENT_A && stateType === 'draft') return sessionRow;
			return null;
		});

		const session = await getSession({ user: USER_A, stateType: 'draft' });
		assert.ok(session);
		assert.equal(session.clientId, CLIENT_A);
		assert.equal(session.payload.topic, 'vente');
	});

	test('TEST 3 — Client B ne peut pas lire la session de Client A', async () => {
		setGetSessionImplForTests(async (scope, stateType) => {
			if (scope.clientId === CLIENT_A && stateType === 'draft') {
				return {
					id: 'sess-a-draft',
					clientId: CLIENT_A,
					stateType: 'draft',
					payload: { secret: true },
					intention: null,
					awaiting: null,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				};
			}
			return null;
		});

		const session = await getSession({ user: USER_B, stateType: 'draft' });
		assert.equal(session, null);
	});

	test('TEST 4 — Client B ne peut pas modifier la session de Client A', async () => {
		const store = new Map();
		store.set(`${CLIENT_A}:draft`, {
			id: 'sess-a-draft',
			clientId: CLIENT_A,
			stateType: 'draft',
			payload: { original: true },
			intention: null,
			awaiting: null,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		setSaveSessionImplForTests(async (scope, row) => {
			const saved = {
				id: `sess-${scope.clientId}-${row.stateType}`,
				clientId: scope.clientId,
				activityId: scope.activityId,
				stateType: row.stateType,
				payload: row.payload,
				intention: row.intention,
				awaiting: row.awaiting,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			store.set(`${scope.clientId}:${row.stateType}`, saved);
			return saved;
		});

		await saveSession({
			user: USER_B,
			stateType: 'draft',
			payload: { hijack: true },
		});

		const aSession = store.get(`${CLIENT_A}:draft`);
		const bSession = store.get(`${CLIENT_B}:draft`);
		assert.deepEqual(aSession.payload, { original: true });
		assert.deepEqual(bSession.payload, { hijack: true });
		assert.notEqual(aSession.clientId, bSession.clientId);
	});

	test('TEST 5 — Client B ne peut pas supprimer la session de Client A', async () => {
		const store = new Map();
		store.set(`${CLIENT_A}:draft`, { id: 'sess-a' });

		setClearSessionImplForTests(async (scope, stateType) => {
			const key = `${scope.clientId}:${stateType}`;
			const existed = store.has(key);
			store.delete(key);
			return { deleted: existed ? 1 : 0 };
		});

		const result = await clearSession({ user: USER_B, stateType: 'draft' });
		assert.equal(result.deleted, 0);
		assert.ok(store.has(`${CLIENT_A}:draft`));
	});

	test('TEST 6 — clientId externe ignoré : scope reste user.clientId', async () => {
		let capturedClientId = null;
		setSaveSessionImplForTests(async (scope, row) => {
			capturedClientId = scope.clientId;
			return {
				id: 'sess-scope',
				clientId: scope.clientId,
				stateType: row.stateType,
				payload: row.payload,
				intention: row.intention,
				awaiting: row.awaiting,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
		});

		await saveSession({
			user: USER_A,
			clientId: CLIENT_B,
			stateType: 'draft',
			payload: {},
		});

		assert.equal(capturedClientId, CLIENT_A);
	});

	test('user absent : rejet', async () => {
		await assert.rejects(
			() => getSession({ user: null, stateType: 'draft' }),
			(err) => err instanceof AgentSessionServiceError && err.code === 'USER_REQUIRED',
		);
	});

	test('clientId absent : rejet', async () => {
		await assert.rejects(
			() => saveSession({ user: { id: 'pb-no-client' }, stateType: 'draft', payload: {} }),
			(err) => err?.code === 'SUPABASE_CLIENT_SCOPE_MISSING',
		);
	});

	test('activityId absent : rejet', async () => {
		await assert.rejects(
			() => saveSession({
				user: { id: 'pb-no-activity', clientId: CLIENT_A },
				stateType: 'draft',
				payload: {},
			}),
			(err) => err?.code === 'SUPABASE_ACTIVITY_SCOPE_MISSING',
		);
	});
});

describe('Phase 5.8-B agent-session-service — CRUD (unit)', () => {
	test('getSession retourne null si absent', async () => {
		setGetSessionImplForTests(async () => null);
		const session = await getSession({ user: USER_A, stateType: 'pending' });
		assert.equal(session, null);
	});

	test('saveSession upsert remplace le payload existant', async () => {
		const store = new Map();
		setSaveSessionImplForTests(async (scope, row) => {
			const key = `${scope.clientId}:${row.stateType}`;
			const saved = {
				id: store.has(key) ? store.get(key).id : randomUUID(),
				clientId: scope.clientId,
				stateType: row.stateType,
				payload: row.payload,
				intention: row.intention,
				awaiting: row.awaiting,
				createdAt: store.has(key) ? store.get(key).createdAt : new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			store.set(key, saved);
			return saved;
		});

		const first = await saveSession({
			user: USER_A,
			stateType: 'draft',
			payload: { v: 1 },
		});
		const second = await saveSession({
			user: USER_A,
			stateType: 'draft',
			payload: { v: 2 },
		});

		assert.equal(first.id, second.id);
		assert.deepEqual(second.payload, { v: 2 });
		assert.equal(store.size, 1);
	});

	test('clearSession retourne deleted=1 quand une ligne existe', async () => {
		setClearSessionImplForTests(async () => ({ deleted: 1 }));
		const result = await clearSession({ user: USER_A, stateType: 'draft' });
		assert.equal(result.deleted, 1);
	});

	test('clearSession retourne deleted=0 quand absent', async () => {
		setClearSessionImplForTests(async () => ({ deleted: 0 }));
		const result = await clearSession({ user: USER_A, stateType: 'pending' });
		assert.equal(result.deleted, 0);
	});

	test('pending state avec awaiting confirm', async () => {
		let captured = null;
		setSaveSessionImplForTests(async (scope, row) => {
			captured = { clientId: scope.clientId, ...row };
			return {
				id: 'sess-pending',
				clientId: scope.clientId,
				stateType: row.stateType,
				payload: row.payload,
				intention: row.intention,
				awaiting: row.awaiting,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
		});

		const pendingWrite = {
			tool: 'create_sale',
			product: 'Poulet',
			quantity: 2,
			unitPrice: 3500,
			amountPaid: 7000,
		};

		await saveSession({
			user: USER_A,
			stateType: 'pending',
			payload: { pendingWrite },
			awaiting: 'confirm',
			intention: 'create_sale',
		});

		assert.equal(captured.stateType, 'pending');
		assert.equal(captured.awaiting, 'confirm');
		assert.equal(captured.intention, 'create_sale');
		assert.deepEqual(captured.payload.pendingWrite, pendingWrite);
	});

	test('concurrence — deux upserts simultanés : dernier gagne (pas de SELECT-then-INSERT)', async () => {
		const store = new Map();
		setSaveSessionImplForTests(async (scope, row) => {
			await new Promise((r) => setTimeout(r, 5));
			const key = `${scope.clientId}:${row.stateType}`;
			const saved = {
				id: store.has(key) ? store.get(key).id : randomUUID(),
				clientId: scope.clientId,
				stateType: row.stateType,
				payload: row.payload,
				intention: row.intention,
				awaiting: row.awaiting,
				createdAt: store.has(key) ? store.get(key).createdAt : new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			store.set(key, saved);
			return saved;
		});

		const [a, b] = await Promise.all([
			saveSession({ user: USER_A, stateType: 'draft', payload: { winner: 'maybe-a' } }),
			saveSession({ user: USER_A, stateType: 'draft', payload: { winner: 'maybe-b' } }),
		]);

		assert.equal(store.size, 1);
		const final = store.get(`${CLIENT_A}:draft`);
		assert.ok(['maybe-a', 'maybe-b'].includes(final.payload.winner));
		assert.equal(a.id, b.id, 'same row id via upsert semantics');
	});

	test('Supabase non configuré : erreur générique sans fuite', async () => {
		if (RUN_INTEGRATION) {
			return;
		}

		await assert.rejects(
			() => getSession({ user: USER_A, stateType: 'draft' }),
			(err) => {
				assert.equal(err.code, 'SUPABASE_UNAVAILABLE');
				assert.ok(!String(err.message).includes('password'));
				assert.ok(!String(err.message).includes('secret'));
				return true;
			},
		);
	});
});

describe('Phase 5.8-B agent-session-service — integration', { skip: !RUN_INTEGRATION }, () => {
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
			await admin.from('agent_sessions').delete().eq('client_id', id);
			await admin.from('clients').delete().eq('id', id);
		}
		for (const uid of authUserIds) {
			await admin.auth.admin.deleteUser(uid);
		}
	});

	test('insert/upsert/read/delete draft', async (t) => {
		skipIntegration(t);
		const authUser = await createAuthUser('draft-flow');
		const clientId = await createClientRow(authUser.id, 'draft-flow');
		const user = userForClient(clientId, 'draft-flow');

		const saved = await saveSession({
			user,
			stateType: 'draft',
			payload: { topic: 'depense', filters: { month: '2026-09' } },
			intention: 'create_expense',
		});

		assert.equal(saved.clientId, clientId);
		assert.equal(saved.stateType, 'draft');
		assert.equal(saved.intention, 'create_expense');

		const loaded = await getSession({ user, stateType: 'draft' });
		assert.ok(loaded);
		assert.equal(loaded.id, saved.id);
		assert.deepEqual(loaded.payload, saved.payload);

		const updated = await saveSession({
			user,
			stateType: 'draft',
			payload: { topic: 'depense', filters: { month: '2026-10' } },
		});
		assert.equal(updated.id, saved.id);
		assert.equal(updated.payload.filters.month, '2026-10');

		const cleared = await clearSession({ user, stateType: 'draft' });
		assert.equal(cleared.deleted, 1);

		const gone = await getSession({ user, stateType: 'draft' });
		assert.equal(gone, null);
	});

	test('pending state avec awaiting et pendingWrite payload', async (t) => {
		skipIntegration(t);
		const authUser = await createAuthUser('pending-flow');
		const clientId = await createClientRow(authUser.id, 'pending-flow');
		const user = userForClient(clientId, 'pending-flow');

		const saved = await saveSession({
			user,
			stateType: 'pending',
			payload: {
				pendingWrite: {
					tool: 'create_expense',
					label: 'Transport',
					amount: 5000,
				},
			},
			awaiting: 'confirm',
		});

		assert.equal(saved.stateType, 'pending');
		assert.equal(saved.awaiting, 'confirm');
		assert.equal(saved.payload.pendingWrite.tool, 'create_expense');

		await clearSession({ user, stateType: 'pending' });
	});

	test('plusieurs state_type par client', async (t) => {
		skipIntegration(t);
		const authUser = await createAuthUser('multi-type');
		const clientId = await createClientRow(authUser.id, 'multi-type');
		const user = userForClient(clientId, 'multi-type');

		await saveSession({ user, stateType: 'draft', payload: { kind: 'draft' } });
		await saveSession({ user, stateType: 'pending', payload: { kind: 'pending' }, awaiting: 'slots' });

		const draft = await getSession({ user, stateType: 'draft' });
		const pending = await getSession({ user, stateType: 'pending' });
		assert.equal(draft.payload.kind, 'draft');
		assert.equal(pending.payload.kind, 'pending');
		assert.equal(pending.awaiting, 'slots');

		await clearSession({ user, stateType: 'draft' });
		await clearSession({ user, stateType: 'pending' });
	});

	test('isolation tenant — Client B ne voit pas la session de Client A', async (t) => {
		skipIntegration(t);
		const authA = await createAuthUser('tenant-a');
		const authB = await createAuthUser('tenant-b');
		const clientA = await createClientRow(authA.id, 'tenant-a');
		const clientB = await createClientRow(authB.id, 'tenant-b');
		const userA = userForClient(clientA, 'tenant-a');
		const userB = userForClient(clientB, 'tenant-b');

		await saveSession({
			user: userA,
			stateType: 'draft',
			payload: { tenantSecret: 'A-only' },
		});

		const bView = await getSession({ user: userB, stateType: 'draft' });
		assert.equal(bView, null);

		const bClear = await clearSession({ user: userB, stateType: 'draft' });
		assert.equal(bClear.deleted, 0);

		const aView = await getSession({ user: userA, stateType: 'draft' });
		assert.ok(aView);
		assert.equal(aView.payload.tenantSecret, 'A-only');

		await clearSession({ user: userA, stateType: 'draft' });
	});

	test('upsert concurrent — une seule ligne par (client_id, state_type)', async (t) => {
		skipIntegration(t);
		const authUser = await createAuthUser('concurrent');
		const clientId = await createClientRow(authUser.id, 'concurrent');
		const user = userForClient(clientId, 'concurrent');

		const [first, second] = await Promise.all([
			saveSession({ user, stateType: 'draft', payload: { n: 1 } }),
			saveSession({ user, stateType: 'draft', payload: { n: 2 } }),
		]);

		assert.equal(first.id, second.id);

		const { data: rows, error } = await admin
			.from('agent_sessions')
			.select('id')
			.eq('client_id', clientId)
			.eq('state_type', 'draft');
		assert.ifError(error);
		assert.equal(rows.length, 1);

		await clearSession({ user, stateType: 'draft' });
	});
});

describe('Phase 5.8-B agent-session-service — integration skip marker', () => {
	test('integration block skipped without credentials', (t) => {
		if (!RUN_INTEGRATION) {
			t.skip('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
		}
	});
});
