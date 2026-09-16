/**
 * Phase 5.8-F4-B2-C-STAGING — idempotent confirm_and_create_* RPC harness.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

import {
	buildCanonicalOperationPayload,
	canonicalJsonStringify,
} from '../src/lib/agent-operation-idempotency.js';
import {
	evaluateStagingHarnessGate,
	stagingHarnessSkipMessage,
} from './helpers/agent-session-p0-staging-guard.js';

const STAGING_GATE = evaluateStagingHarnessGate();
const STAGING_HARNESS_ENABLED = STAGING_GATE.allowed;
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TAG = `b2c-${Date.now()}`;

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let admin = null;
/** @type {string[]} */
const clientIds = [];
/** @type {string[]} */
const authUserIds = [];
/** @type {string[]} */
const expenseIds = [];
/** @type {string[]} */
const operationRowIds = [];
/** @type {string[]} */
const activityIds = [];
/** @type {Map<string, string>} */
const clientActivityMap = new Map();

function skipStaging(t) {
	if (!STAGING_HARNESS_ENABLED) {
		t.skip(stagingHarnessSkipMessage(STAGING_GATE));
	}
}

function hashExpense(clientId, pendingWrite) {
	const payload = buildCanonicalOperationPayload(clientId, pendingWrite);
	return createHash('sha256').update(canonicalJsonStringify(payload)).digest('hex');
}

async function createAuthUser(label) {
	const email = `${TAG}-${label}-${randomUUID()}@b2c.ashledger.test`;
	const password = `B2c!${randomUUID().slice(0, 8)}`;
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
			nom_client: `B2-C ${label}`,
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
			name: `B2-C ${label}`,
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

async function seedPendingSession(clientId, pendingWrite, consumeToken) {
	const activityId = clientActivityMap.get(clientId);
	if (!activityId) {
		throw new Error(`Missing default activity for client ${clientId}`);
	}

	const payload = {
		pendingWrite,
		consumeToken,
	};
	const { data, error } = await admin
		.from('agent_sessions')
		.upsert({
			client_id: clientId,
			activity_id: activityId,
			state_type: 'pending',
			payload,
			awaiting: 'confirm',
			intention: pendingWrite.tool,
			state_version: 1,
		}, { onConflict: 'client_id,activity_id,state_type' })
		.select('id, state_version')
		.single();
	if (error) throw error;
	return { sessionId: data.id, version: data.state_version, activityId };
}

async function countExpenses(clientId) {
	const { count, error } = await admin
		.from('depenses')
		.select('id', { count: 'exact', head: true })
		.eq('client_id', clientId);
	if (error) throw error;
	return count ?? 0;
}

async function rpcConfirmExpense(clientId, {
	consumeToken,
	operationId,
	requestHash,
	activityId = clientActivityMap.get(clientId),
}) {
	return admin.rpc('confirm_and_create_expense', {
		p_client_id: clientId,
		p_activity_id: activityId,
		p_expected_version: null,
		p_consume_token: consumeToken,
		p_operation_id: operationId,
		p_request_hash: requestHash,
	});
}

describe('Phase 5.8-F4-B2-C-STAGING — idempotent confirm RPC', { skip: !STAGING_HARNESS_ENABLED }, () => {
	before(async () => {
		admin = createClient(SUPABASE_URL, SERVICE_KEY, {
			auth: { autoRefreshToken: false, persistSession: false },
			global: { fetch },
			realtime: { transport: ws },
		});
	});

	after(async () => {
		if (!admin) return;
		for (const id of expenseIds.splice(0)) {
			await admin.from('depenses').delete().eq('id', id);
		}
		for (const id of operationRowIds.splice(0)) {
			await admin.from('agent_write_operations').delete().eq('id', id);
		}
		for (const id of activityIds.splice(0)) {
			await admin.from('agent_sessions').delete().eq('activity_id', id);
		}
		for (const id of clientIds.splice(0)) {
			await admin.from('agent_write_operations').delete().eq('client_id', id);
			await admin.from('agent_sessions').delete().eq('client_id', id);
			await admin.from('depenses').delete().eq('client_id', id);
			await admin.from('activities').delete().eq('client_id', id);
			await admin.from('clients').delete().eq('id', id);
			clientActivityMap.delete(id);
		}
		for (const uid of authUserIds) {
			await admin.auth.admin.deleteUser(uid);
		}
	});

	test('1 — first commit creates expense + completed ledger row', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('commit'), 'commit');
		const operationId = randomUUID();
		const consumeToken = `tok-${TAG}`;
		const pendingWrite = { tool: 'create_expense', label: `B2C ${TAG}`, amount: 777 };
		const requestHash = hashExpense(clientId, pendingWrite);

		await seedPendingSession(clientId, pendingWrite, consumeToken);
		const before = await countExpenses(clientId);

		const { data, error } = await rpcConfirmExpense(clientId, {
			consumeToken,
			operationId,
			requestHash,
		});

		assert.equal(error, null, error?.message);
		assert.equal(data.status, 'COMMITTED');
		assert.ok(data.result_id);
		expenseIds.push(data.result_id);

		const after = await countExpenses(clientId);
		assert.equal(after, before + 1);

		const { data: opRow } = await admin
			.from('agent_write_operations')
			.select('id, status, result_id, request_hash')
			.eq('client_id', clientId)
			.eq('operation_id', operationId)
			.single();

		assert.equal(opRow.status, 'completed');
		assert.equal(opRow.result_id, data.result_id);
		assert.equal(opRow.request_hash, requestHash);
		operationRowIds.push(opRow.id);
	});

	test('2 — replay same operation_id + hash returns ALREADY_COMPLETED', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('replay'), 'replay');
		const operationId = randomUUID();
		const consumeToken = `tok-replay-${TAG}`;
		const pendingWrite = { tool: 'create_expense', label: `Replay ${TAG}`, amount: 888 };
		const requestHash = hashExpense(clientId, pendingWrite);

		await seedPendingSession(clientId, pendingWrite, consumeToken);
		const first = await rpcConfirmExpense(clientId, { consumeToken, operationId, requestHash });
		assert.equal(first.error, null);
		assert.equal(first.data.status, 'COMMITTED');
		expenseIds.push(first.data.result_id);

		const countAfterFirst = await countExpenses(clientId);

		const replay = await rpcConfirmExpense(clientId, { consumeToken, operationId, requestHash });
		assert.equal(replay.error, null);
		assert.equal(replay.data.status, 'ALREADY_COMPLETED');
		assert.equal(replay.data.result_id, first.data.result_id);

		const countAfterReplay = await countExpenses(clientId);
		assert.equal(countAfterReplay, countAfterFirst);
	});

	test('3 — hash mismatch rejected', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('hash'), 'hash');
		const operationId = randomUUID();
		const consumeToken = `tok-hash-${TAG}`;
		const pendingWrite = { tool: 'create_expense', label: `Hash ${TAG}`, amount: 999 };
		const requestHash = hashExpense(clientId, pendingWrite);

		await seedPendingSession(clientId, pendingWrite, consumeToken);
		const first = await rpcConfirmExpense(clientId, { consumeToken, operationId, requestHash });
		assert.equal(first.data.status, 'COMMITTED');
		expenseIds.push(first.data.result_id);

		const mismatch = await rpcConfirmExpense(clientId, {
			consumeToken,
			operationId,
			requestHash: `${requestHash}-bad`,
		});

		assert.equal(mismatch.error, null);
		assert.equal(mismatch.data.status, 'REQUEST_HASH_MISMATCH');
		assert.equal(mismatch.data.success, false);
	});

	test('4 — rollback leaves no completed ledger on business failure', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('rollback'), 'rollback');
		const operationId = randomUUID();
		const consumeToken = `tok-rb-${TAG}`;
		const pendingWrite = { tool: 'create_expense', label: '', amount: 100 };
		const requestHash = hashExpense(clientId, pendingWrite);

		await seedPendingSession(clientId, pendingWrite, consumeToken);
		const before = await countExpenses(clientId);

		const { error } = await rpcConfirmExpense(clientId, { consumeToken, operationId, requestHash });
		assert.ok(error, 'expected RPC error for invalid label');

		const after = await countExpenses(clientId);
		assert.equal(after, before);

		const { data: opRows } = await admin
			.from('agent_write_operations')
			.select('id, status')
			.eq('client_id', clientId)
			.eq('operation_id', operationId);

		assert.equal(opRows?.length ?? 0, 0);
	});

	test('5 — same operation_id different clients are isolated', async (t) => {
		skipStaging(t);
		const sharedOperationId = randomUUID();
		const clientA = await createClientRow(await createAuthUser('iso-a'), 'iso-a');
		const clientB = await createClientRow(await createAuthUser('iso-b'), 'iso-b');

		const pendingA = { tool: 'create_expense', label: `IsoA ${TAG}`, amount: 100 };
		const pendingB = { tool: 'create_expense', label: `IsoB ${TAG}`, amount: 200 };
		const hashA = hashExpense(clientA, pendingA);
		const hashB = hashExpense(clientB, pendingB);

		await seedPendingSession(clientA, pendingA, `tok-a-${TAG}`);
		await seedPendingSession(clientB, pendingB, `tok-b-${TAG}`);

		const resA = await rpcConfirmExpense(clientA, {
			consumeToken: `tok-a-${TAG}`,
			operationId: sharedOperationId,
			requestHash: hashA,
		});
		const resB = await rpcConfirmExpense(clientB, {
			consumeToken: `tok-b-${TAG}`,
			operationId: sharedOperationId,
			requestHash: hashB,
		});

		assert.equal(resA.data.status, 'COMMITTED');
		assert.equal(resB.data.status, 'COMMITTED');
		assert.notEqual(resA.data.result_id, resB.data.result_id);
		expenseIds.push(resA.data.result_id, resB.data.result_id);
	});
});
