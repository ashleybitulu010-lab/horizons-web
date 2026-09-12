/**
 * Phase 5.8-F4-B2-D-STAGING — Node replay validation against real staging RPC.
 * Exercises post-commit replay path (timeout simulation via direct RPC replay).
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
const TAG = `b2d-${Date.now()}`;

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let admin = null;
/** @type {string[]} */
const clientIds = [];
/** @type {string[]} */
const authUserIds = [];
/** @type {string[]} */
const expenseIds = [];

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
	const email = `${TAG}-${label}-${randomUUID()}@b2d.ashledger.test`;
	const { data, error } = await admin.auth.admin.createUser({
		email,
		password: `B2d!${randomUUID().slice(0, 8)}`,
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
			nom_client: `B2-D ${label}`,
			auth_user_id: authUserId,
			thread_id: '[]',
		})
		.select('id')
		.single();
	if (error) throw error;
	clientIds.push(data.id);
	return data.id;
}

async function seedPending(clientId, pendingWrite, consumeToken, operationId) {
	const { error } = await admin.from('agent_sessions').upsert({
		client_id: clientId,
		state_type: 'pending',
		payload: { pendingWrite, consumeToken, operationId },
		awaiting: 'confirm',
		intention: pendingWrite.tool,
		state_version: 1,
	}, { onConflict: 'client_id,state_type' });
	if (error) throw error;
}

async function countExpenses(clientId) {
	const { count } = await admin
		.from('depenses')
		.select('id', { count: 'exact', head: true })
		.eq('client_id', clientId);
	return count ?? 0;
}

describe('Phase 5.8-F4-B2-D-STAGING — replay post-commit', { skip: !STAGING_HARNESS_ENABLED }, () => {
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
		for (const id of clientIds.splice(0)) {
			await admin.from('agent_write_operations').delete().eq('client_id', id);
			await admin.from('agent_sessions').delete().eq('client_id', id);
			await admin.from('depenses').delete().eq('client_id', id);
			await admin.from('clients').delete().eq('id', id);
		}
		for (const uid of authUserIds) {
			await admin.auth.admin.deleteUser(uid);
		}
	});

	test('1 — commit then replay (timeout simulation)', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('replay'), 'replay');
		const operationId = randomUUID();
		const consumeToken = `tok-${TAG}`;
		const pendingWrite = { tool: 'create_expense', label: `B2D ${TAG}`, amount: 4321 };
		const requestHash = hashExpense(clientId, pendingWrite);

		await seedPending(clientId, pendingWrite, consumeToken, operationId);
		const before = await countExpenses(clientId);

		const first = await admin.rpc('confirm_and_create_expense', {
			p_client_id: clientId,
			p_consume_token: consumeToken,
			p_operation_id: operationId,
			p_request_hash: requestHash,
		});
		assert.equal(first.data.status, 'COMMITTED');
		expenseIds.push(first.data.result_id);

		const mid = await countExpenses(clientId);
		assert.equal(mid, before + 1);

		const replay = await admin.rpc('confirm_and_create_expense', {
			p_client_id: clientId,
			p_consume_token: consumeToken,
			p_operation_id: operationId,
			p_request_hash: requestHash,
		});
		assert.equal(replay.data.status, 'ALREADY_COMPLETED');
		assert.equal(replay.data.result_id, first.data.result_id);

		const after = await countExpenses(clientId);
		assert.equal(after, mid);
	});

	test('2 — hash mismatch after commit', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('hash'), 'hash');
		const operationId = randomUUID();
		const consumeToken = `tok-h-${TAG}`;
		const pendingWrite = { tool: 'create_expense', label: `Hash ${TAG}`, amount: 111 };
		const requestHash = hashExpense(clientId, pendingWrite);

		await seedPending(clientId, pendingWrite, consumeToken, operationId);
		const first = await admin.rpc('confirm_and_create_expense', {
			p_client_id: clientId,
			p_consume_token: consumeToken,
			p_operation_id: operationId,
			p_request_hash: requestHash,
		});
		assert.equal(first.data.status, 'COMMITTED');
		expenseIds.push(first.data.result_id);

		const before = await countExpenses(clientId);
		const mismatch = await admin.rpc('confirm_and_create_expense', {
			p_client_id: clientId,
			p_consume_token: consumeToken,
			p_operation_id: operationId,
			p_request_hash: `${requestHash}-bad`,
		});
		assert.equal(mismatch.data.status, 'REQUEST_HASH_MISMATCH');
		assert.equal(await countExpenses(clientId), before);
	});

	test('3 — cross-tenant same operation_id', async (t) => {
		skipStaging(t);
		const sharedOp = randomUUID();
		const clientA = await createClientRow(await createAuthUser('xa'), 'xa');
		const clientB = await createClientRow(await createAuthUser('xb'), 'xb');
		const pendingA = { tool: 'create_expense', label: `A ${TAG}`, amount: 100 };
		const pendingB = { tool: 'create_expense', label: `B ${TAG}`, amount: 200 };

		await seedPending(clientA, pendingA, `tok-a-${TAG}`, sharedOp);
		await seedPending(clientB, pendingB, `tok-b-${TAG}`, sharedOp);

		const resA = await admin.rpc('confirm_and_create_expense', {
			p_client_id: clientA,
			p_consume_token: `tok-a-${TAG}`,
			p_operation_id: sharedOp,
			p_request_hash: hashExpense(clientA, pendingA),
		});
		const resB = await admin.rpc('confirm_and_create_expense', {
			p_client_id: clientB,
			p_consume_token: `tok-b-${TAG}`,
			p_operation_id: sharedOp,
			p_request_hash: hashExpense(clientB, pendingB),
		});

		assert.equal(resA.data.status, 'COMMITTED');
		assert.equal(resB.data.status, 'COMMITTED');
		assert.notEqual(resA.data.result_id, resB.data.result_id);
		expenseIds.push(resA.data.result_id, resB.data.result_id);
	});
});
