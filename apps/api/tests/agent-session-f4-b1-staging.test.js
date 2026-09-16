/**
 * Phase 5.8-F4-B1-STAGING — Real Supabase transactional confirm + business write.
 * Requires explicit opt-in (see tests/agent-session-p0-staging.README.md).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

import { setForceRegexResolverForTests } from '../src/agent/intent-resolver/index.js';
import {
	clearConversationSessionsForTests,
	getConversationState,
} from '../src/agent/conversation-state.js';
import {
	getAgentSessionState,
	resetAgentSessionReaderForTests,
} from '../src/services/agent-session-reader.js';
import {
	mirrorSessionsAtomic,
	resetAgentSessionServiceImplForTests,
} from '../src/services/agent-session-service.js';
import { createAshyAgent } from '../src/agent/index.js';
import {
	confirmAndCreateExpense,
	confirmAndCreateSale,
	resetAgentTransactionalWriteForTests,
	setIsTransactionalConfirmEnabledForTests,
	TRANSACTIONAL_CONFIRM_STATUS,
} from '../src/services/agent-transactional-write-service.js';
import { resetAgentSessionWriterForTests } from '../src/services/agent-session-writer.js';
import {
	evaluateStagingHarnessGate,
	stagingHarnessSkipMessage,
} from './helpers/agent-session-p0-staging-guard.js';

const STAGING_GATE = evaluateStagingHarnessGate();
const STAGING_HARNESS_ENABLED = STAGING_GATE.allowed;
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TAG = `f4b1-${Date.now()}`;

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let admin = null;
/** @type {string[]} */
const clientIds = [];
/** @type {string[]} */
const authUserIds = [];
/** @type {string[]} */
const expenseIds = [];
/** @type {string[]} */
const saleIds = [];
/** @type {string[]} */
const activityIds = [];
/** @type {Map<string, string>} */
const clientActivityMap = new Map();

function skipStaging(t) {
	if (!STAGING_HARNESS_ENABLED) {
		t.skip(stagingHarnessSkipMessage(STAGING_GATE));
	}
}

function emptyDraft(topic = 'staging') {
	return {
		topic,
		intent: null,
		filters: {},
		references: {
			lastPeriod: null,
			previousPeriod: null,
			lastProduct: null,
			lastEntity: null,
		},
		lastTool: null,
		lastAction: null,
		updatedAt: new Date().toISOString(),
	};
}

function expensePending(label, amount, token) {
	return {
		pendingWrite: { tool: 'create_expense', label, amount },
		consumeToken: token,
	};
}

function salePending(product, quantity, unitPrice, amountPaid, token) {
	return {
		pendingWrite: {
			tool: 'create_sale',
			product,
			quantity,
			unitPrice,
			amountPaid,
		},
		consumeToken: token,
	};
}

async function createAuthUser(label) {
	const email = `${TAG}-${label}-${randomUUID()}@f4b1.ashledger.test`;
	const password = `F4b1!${randomUUID().slice(0, 8)}`;
	const { data, error } = await admin.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
	});
	if (error) throw error;
	authUserIds.push(data.user.id);
	return data.user.id;
}

async function createClientRow(authUserId, label) {
	const userId = `${TAG}-${label}-${randomUUID()}`;
	const { data, error } = await admin
		.from('clients')
		.insert({
			user_id: userId,
			nom_client: `F4-B1 ${label}`,
			auth_user_id: authUserId,
			thread_id: '[]',
		})
		.select('id')
		.single();
	if (error) throw error;
	clientIds.push(data.id);
	await createDefaultActivity(data.id, label);
	return data.id;
}

async function createDefaultActivity(clientId, label) {
	const { data, error } = await admin
		.from('activities')
		.insert({
			client_id: clientId,
			name: `F4-B1 ${label}`,
			type: 'commerce',
			is_default: true,
		})
		.select('id')
		.single();
	if (error) throw error;
	activityIds.push(data.id);
	clientActivityMap.set(clientId, data.id);
	return data.id;
}

function userForClient(clientId, label) {
	const activeActivityId = clientActivityMap.get(clientId);
	if (!activeActivityId) {
		throw new Error(`Missing default activity for client ${clientId}`);
	}
	return {
		id: `pb-${label}`,
		clientId,
		activeActivityId,
		businessUserId: `${TAG}-${label}`,
	};
}

async function readDbPair(clientId, activityId = clientActivityMap.get(clientId)) {
	const { data, error } = await admin
		.from('agent_sessions')
		.select('state_type, payload, state_version, awaiting, intention')
		.eq('client_id', clientId)
		.eq('activity_id', activityId);
	if (error) throw error;
	const draft = data?.find((r) => r.state_type === 'draft') ?? null;
	const pending = data?.find((r) => r.state_type === 'pending') ?? null;
	return { draft, pending };
}

async function seedPendingExpense(clientId, user, { label = 'transport', amount = 50 } = {}) {
	const token = `tok-${TAG}-${randomUUID()}`;
	await mirrorSessionsAtomic({
		user,
		draftPayload: emptyDraft('expenses'),
		pendingPayload: expensePending(label, amount, token),
		pendingAwaiting: 'confirm',
		pendingIntention: 'create_expense',
	});
	const pair = await readDbPair(clientId);
	return {
		token,
		version: pair.pending.state_version,
		label,
		amount,
	};
}

async function seedProductAndStock(clientId, productName, quantity = 20) {
	const activityId = clientActivityMap.get(clientId);
	if (!activityId) {
		throw new Error(`Missing default activity for client ${clientId}`);
	}

	const { data: produit, error: pErr } = await admin
		.from('produits')
		.insert({
			client_id: clientId,
			activity_id: activityId,
			nom_produit: productName,
			prix_vente_unitaire: 10,
			prix_achat_unitaire: 5,
		})
		.select('id')
		.single();
	if (pErr) throw pErr;

	const { error: sErr } = await admin.from('stocks').insert({
		client_id: clientId,
		activity_id: activityId,
		produit_id: produit.id,
		nom_article: productName,
		entrees: quantity,
		sorties: 0,
		seuil_alerte: 5,
	});
	if (sErr) throw sErr;

	return produit.id;
}

async function seedPendingSale(clientId, user, {
	product = 'poulets-f4b1',
	quantity = 2,
	unitPrice = 10,
	amountPaid = 20,
	stockQty = 20,
} = {}) {
	await seedProductAndStock(clientId, product, stockQty);
	const token = `tok-${TAG}-${randomUUID()}`;
	await mirrorSessionsAtomic({
		user,
		draftPayload: emptyDraft('sales'),
		pendingPayload: salePending(product, quantity, unitPrice, amountPaid, token),
		pendingAwaiting: 'confirm',
		pendingIntention: 'create_sale',
	});
	const pair = await readDbPair(clientId);
	return { token, version: pair.pending.state_version, product, quantity, unitPrice, amountPaid };
}

async function cleanupClient(clientId) {
	await admin.from('agent_sessions').delete().eq('client_id', clientId);
	await admin.from('ventes').delete().eq('client_id', clientId);
	await admin.from('depenses').delete().eq('client_id', clientId);
	await admin.from('stocks').delete().eq('client_id', clientId);
	await admin.from('produits').delete().eq('client_id', clientId);
	await admin.from('activities').delete().eq('client_id', clientId);
	await admin.from('clients').delete().eq('id', clientId);
	clientActivityMap.delete(clientId);
}

describe('Phase 5.8-F4-B1-STAGING — prerequisites', { skip: !STAGING_HARNESS_ENABLED }, () => {
	before(async () => {
		admin = createClient(SUPABASE_URL, SERVICE_KEY, {
			auth: { autoRefreshToken: false, persistSession: false },
			global: { fetch },
			realtime: { transport: ws },
		});
		setIsTransactionalConfirmEnabledForTests(true);
		process.env.AGENT_SESSION_TRANSACTIONAL_CONFIRM = 'true';
		process.env.AGENT_SESSION_PENDING_DB_REQUIRED = 'true';
		process.env.AGENT_SESSION_WRITE_DB_FIRST = 'true';
		setForceRegexResolverForTests(true);
	});

	after(async () => {
		for (const id of clientIds.splice(0)) {
			await cleanupClient(id);
		}
		for (const uid of authUserIds) {
			await admin.auth.admin.deleteUser(uid);
		}
		resetAgentSessionServiceImplForTests();
		resetAgentSessionWriterForTests();
		resetAgentSessionReaderForTests();
		resetAgentTransactionalWriteForTests();
		clearConversationSessionsForTests();
	});

	test('RPC — confirm_and_create_expense present', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('rpc-exp'), 'rpc-exp');
		const user = userForClient(clientId, 'rpc-exp');
		const pending = await seedPendingExpense(clientId, user, { label: 'rpc-check', amount: 1 });

		const result = await confirmAndCreateExpense({
			user,
			consumeToken: pending.token,
			expectedVersion: pending.version,
		});

		assert.equal(result.success, true);
		assert.equal(result.status, TRANSACTIONAL_CONFIRM_STATUS.COMMITTED);
		assert.ok(result.result_id);
		expenseIds.push(result.result_id);
	});

	test('RPC — confirm_and_create_sale present', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('rpc-sale'), 'rpc-sale');
		const user = userForClient(clientId, 'rpc-sale');
		const pending = await seedPendingSale(clientId, user);

		const result = await confirmAndCreateSale({
			user,
			consumeToken: pending.token,
			expectedVersion: pending.version,
		});

		assert.equal(result.success, true);
		assert.equal(result.status, TRANSACTIONAL_CONFIRM_STATUS.COMMITTED);
		assert.ok(result.result_id);
		saleIds.push(result.result_id);
	});
});

describe('Phase 5.8-F4-B1-STAGING — transactional flows', { skip: !STAGING_HARNESS_ENABLED }, () => {
	before(async () => {
		if (!admin) {
			admin = createClient(SUPABASE_URL, SERVICE_KEY, {
				auth: { autoRefreshToken: false, persistSession: false },
				global: { fetch },
				realtime: { transport: ws },
			});
		}
		setIsTransactionalConfirmEnabledForTests(true);
		setForceRegexResolverForTests(true);
	});

	test('1 — expense success', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('exp-ok'), 'exp-ok');
		const user = userForClient(clientId, 'exp-ok');
		const pending = await seedPendingExpense(clientId, user, { label: 'loyer', amount: 50 });

		const result = await confirmAndCreateExpense({
			user,
			consumeToken: pending.token,
			expectedVersion: pending.version,
		});

		assert.equal(result.success, true);
		assert.equal((await readDbPair(clientId)).pending, null);
		const { count } = await admin.from('depenses').select('id', { count: 'exact', head: true }).eq('client_id', clientId);
		assert.equal(count, 1);
	});

	test('2 — expense rollback (invalid amount)', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('exp-rb'), 'exp-rb');
		const user = userForClient(clientId, 'exp-rb');
		const token = `tok-${TAG}-${randomUUID()}`;
		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: {
				pendingWrite: { tool: 'create_expense', label: 'bad', amount: -5 },
				consumeToken: token,
			},
			pendingAwaiting: 'confirm',
		});
		const version = (await readDbPair(clientId)).pending.state_version;

		await assert.rejects(
			() => confirmAndCreateExpense({ user, consumeToken: token, expectedVersion: version }),
		);

		assert.ok((await readDbPair(clientId)).pending);
		const { count } = await admin.from('depenses').select('id', { count: 'exact', head: true }).eq('client_id', clientId);
		assert.equal(count, 0);
	});

	test('3 — sale success', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('sale-ok'), 'sale-ok');
		const user = userForClient(clientId, 'sale-ok');
		const pending = await seedPendingSale(clientId, user);

		const result = await confirmAndCreateSale({
			user,
			consumeToken: pending.token,
			expectedVersion: pending.version,
		});

		assert.equal(result.success, true);
		assert.equal((await readDbPair(clientId)).pending, null);
		const { count: ventes } = await admin.from('ventes').select('id', { count: 'exact', head: true }).eq('client_id', clientId);
		assert.equal(ventes, 1);
	});

	test('4 — sale rollback (product missing)', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('sale-rb'), 'sale-rb');
		const user = userForClient(clientId, 'sale-rb');
		const token = `tok-${TAG}-${randomUUID()}`;
		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: salePending('produit-inexistant-f4b1', 1, 10, 10, token),
			pendingAwaiting: 'confirm',
		});
		const version = (await readDbPair(clientId)).pending.state_version;

		await assert.rejects(
			() => confirmAndCreateSale({ user, consumeToken: token, expectedVersion: version }),
		);

		assert.ok((await readDbPair(clientId)).pending);
		const { count } = await admin.from('ventes').select('id', { count: 'exact', head: true }).eq('client_id', clientId);
		assert.equal(count, 0);
	});

	test('5 — concurrent expense confirmation', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('exp-conc'), 'exp-conc');
		const user = userForClient(clientId, 'exp-conc');
		const pending = await seedPendingExpense(clientId, user, { amount: 25 });

		const [a, b] = await Promise.all([
			confirmAndCreateExpense({ user, consumeToken: pending.token, expectedVersion: pending.version }),
			confirmAndCreateExpense({ user, consumeToken: pending.token, expectedVersion: pending.version }),
		]);

		const successes = [a, b].filter((r) => r.success);
		const conflicts = [a, b].filter((r) => r.status === TRANSACTIONAL_CONFIRM_STATUS.ALREADY_CONSUMED);
		assert.equal(successes.length, 1);
		assert.equal(conflicts.length, 1);
		const { count } = await admin.from('depenses').select('id', { count: 'exact', head: true }).eq('client_id', clientId);
		assert.equal(count, 1);
	});

	test('6 — concurrent sale confirmation', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('sale-conc'), 'sale-conc');
		const user = userForClient(clientId, 'sale-conc');
		const pending = await seedPendingSale(clientId, user, { quantity: 1 });

		const [a, b] = await Promise.all([
			confirmAndCreateSale({ user, consumeToken: pending.token, expectedVersion: pending.version }),
			confirmAndCreateSale({ user, consumeToken: pending.token, expectedVersion: pending.version }),
		]);

		const successes = [a, b].filter((r) => r.success);
		const conflicts = [a, b].filter((r) => r.status === TRANSACTIONAL_CONFIRM_STATUS.ALREADY_CONSUMED);
		assert.equal(successes.length, 1);
		assert.equal(conflicts.length, 1);
		const { count } = await admin.from('ventes').select('id', { count: 'exact', head: true }).eq('client_id', clientId);
		assert.equal(count, 1);
	});

	test('7 — multi-tenant expense isolation', async (t) => {
		skipStaging(t);
		const clientA = await createClientRow(await createAuthUser('mt-a'), 'mt-a');
		const clientB = await createClientRow(await createAuthUser('mt-b'), 'mt-b');
		const userA = userForClient(clientA, 'mt-a');
		const userB = userForClient(clientB, 'mt-b');
		const pendingA = await seedPendingExpense(clientA, userA, { label: 'A', amount: 50 });
		await seedPendingExpense(clientB, userB, { label: 'B', amount: 100 });

		const result = await confirmAndCreateExpense({
			user: userA,
			consumeToken: pendingA.token,
			expectedVersion: pendingA.version,
		});
		assert.equal(result.success, true);

		const pairB = await readDbPair(clientB);
		assert.ok(pairB.pending);
		assert.equal(pairB.pending.payload.pendingWrite.amount, 100);
	});

	test('8 — multi-tenant sale isolation', async (t) => {
		skipStaging(t);
		const clientA = await createClientRow(await createAuthUser('mts-a'), 'mts-a');
		const clientB = await createClientRow(await createAuthUser('mts-b'), 'mts-b');
		const userA = userForClient(clientA, 'mts-a');
		const userB = userForClient(clientB, 'mts-b');
		const pendingA = await seedPendingSale(clientA, userA, { product: 'prod-a-f4b1' });
		await seedPendingSale(clientB, userB, { product: 'prod-b-f4b1' });

		const result = await confirmAndCreateSale({
			user: userA,
			consumeToken: pendingA.token,
			expectedVersion: pendingA.version,
		});
		assert.equal(result.success, true);
		assert.ok((await readDbPair(clientB)).pending);
	});

	test('9 — restart after success', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('restart-ok'), 'restart-ok');
		const user = userForClient(clientId, 'restart-ok');
		const sessionId = 'sess-f4b1-restart-ok';
		const pending = await seedPendingExpense(clientId, user, { amount: 30 });

		await confirmAndCreateExpense({
			user,
			consumeToken: pending.token,
			expectedVersion: pending.version,
		});

		clearConversationSessionsForTests();
		resetAgentSessionReaderForTests();

		const { state, source } = await getAgentSessionState({ user, sessionId });
		assert.equal(source, 'agent_sessions');
		assert.equal(state.pendingWrite, null);
		assert.equal((await readDbPair(clientId)).pending, null);
	});

	test('10 — restart after rollback', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('restart-rb'), 'restart-rb');
		const user = userForClient(clientId, 'restart-rb');
		const sessionId = 'sess-f4b1-restart-rb';
		const pending = await seedPendingExpense(clientId, user, { label: 'bad', amount: 40 });
		const version = (await readDbPair(clientId)).pending.state_version;

		await admin.from('agent_sessions').update({
			payload: {
				pendingWrite: { tool: 'create_expense', label: 'bad', amount: -1 },
				consumeToken: pending.token,
			},
		}).eq('client_id', clientId).eq('state_type', 'pending');

		await assert.rejects(
			() => confirmAndCreateExpense({ user, consumeToken: pending.token, expectedVersion: version }),
		);

		clearConversationSessionsForTests();
		resetAgentSessionReaderForTests();

		const { state } = await getAgentSessionState({ user, sessionId });
		assert.equal(state.pendingWrite?.label, 'bad');
		assert.ok((await readDbPair(clientId)).pending);
	});

	test('11 — version mismatch', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('ver-mis'), 'ver-mis');
		const user = userForClient(clientId, 'ver-mis');
		const pending = await seedPendingExpense(clientId, user);

		const result = await confirmAndCreateExpense({
			user,
			expectedVersion: pending.version + 999,
		});

		assert.equal(result.status, TRANSACTIONAL_CONFIRM_STATUS.VERSION_MISMATCH);
		assert.ok((await readDbPair(clientId)).pending);
	});

	test('12 — token mismatch', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('tok-mis'), 'tok-mis');
		const user = userForClient(clientId, 'tok-mis');
		const pending = await seedPendingExpense(clientId, user);

		const result = await confirmAndCreateExpense({
			user,
			consumeToken: 'wrong-token',
		});

		assert.equal(result.status, TRANSACTIONAL_CONFIRM_STATUS.VERSION_MISMATCH);
		assert.ok((await readDbPair(clientId)).pending);
	});

	test('13 — pending absent', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('no-pend'), 'no-pend');
		const user = userForClient(clientId, 'no-pend');

		const result = await confirmAndCreateExpense({
			user,
			consumeToken: 'missing',
			expectedVersion: 1,
		});

		assert.equal(result.status, TRANSACTIONAL_CONFIRM_STATUS.ALREADY_CONSUMED);
	});

	test('14 — stock insufficient rollback', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('stock-rb'), 'stock-rb');
		const user = userForClient(clientId, 'stock-rb');
		const product = 'stock-low-f4b1';
		await seedProductAndStock(clientId, product, 1);
		const token = `tok-${TAG}-${randomUUID()}`;
		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: salePending(product, 5, 10, 50, token),
			pendingAwaiting: 'confirm',
		});
		const version = (await readDbPair(clientId)).pending.state_version;

		await assert.rejects(
			() => confirmAndCreateSale({ user, consumeToken: token, expectedVersion: version }),
		);

		assert.ok((await readDbPair(clientId)).pending);
		const { data: stocks } = await admin.from('stocks').select('sorties').eq('client_id', clientId);
		assert.equal(stocks[0]?.sorties ?? 0, 0);
		const { count } = await admin.from('ventes').select('id', { count: 'exact', head: true }).eq('client_id', clientId);
		assert.equal(count, 0);
	});

	test('agent — full expense confirmation flow', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('agent-exp'), 'agent-exp');
		const user = userForClient(clientId, 'agent-exp');
		const sessionId = 'sess-f4b1-agent-exp';
		const agent = createAshyAgent();

		await agent.run({
			message: "J'ai dépensé 75 $ pour le carburant",
			user,
			sessionId,
		});
		assert.ok((await readDbPair(clientId)).pending);

		const confirm = await agent.run({ message: 'oui', user, sessionId });
		assert.equal(confirm.toolResults[0]?.success, true);
		assert.equal((await readDbPair(clientId)).pending, null);
		assert.equal(getConversationState(user.id, sessionId).pendingWrite, null);
	});
});

describe('Phase 5.8-F4-B1-STAGING — skip marker', () => {
	test('staging blocked when safety gate is not satisfied', (t) => {
		if (!STAGING_HARNESS_ENABLED) {
			t.skip(stagingHarnessSkipMessage(STAGING_GATE));
		}
	});
});
