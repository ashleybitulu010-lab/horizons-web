/**
 * Phase 5.8-F4-B2-E-STAGING — Final hardening validation on Ash Ledger staging.
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
const TAG = `b2e-${Date.now()}`;

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let admin = null;
const clientIds = [];
const authUserIds = [];
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
	const email = `${TAG}-${label}-${randomUUID()}@b2e.ashledger.test`;
	const { data, error } = await admin.auth.admin.createUser({
		email,
		password: `B2e!${randomUUID().slice(0, 8)}`,
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
			nom_client: `B2-E ${label}`,
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

async function rpcExpense(clientId, { consumeToken, operationId, requestHash }) {
	return admin.rpc('confirm_and_create_expense', {
		p_client_id: clientId,
		p_consume_token: consumeToken,
		p_operation_id: operationId,
		p_request_hash: requestHash,
	});
}

describe('Phase 5.8-F4-B2-E-STAGING — hardening harness', { skip: !STAGING_HARNESS_ENABLED }, () => {
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

	test('E4 — first expense COMMITTED + ledger', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('e4'), 'e4');
		const operationId = randomUUID();
		const pending = { tool: 'create_expense', label: `E4 ${TAG}`, amount: 444 };
		const hash = hashExpense(clientId, pending);
		await seedPending(clientId, pending, `tok-e4-${TAG}`, operationId);

		const res = await rpcExpense(clientId, {
			consumeToken: `tok-e4-${TAG}`,
			operationId,
			requestHash: hash,
		});
		assert.equal(res.data.status, 'COMMITTED');
		expenseIds.push(res.data.result_id);

		const { data: ledger } = await admin
			.from('agent_write_operations')
			.select('status, result_id')
			.eq('client_id', clientId)
			.eq('operation_id', operationId)
			.single();
		assert.equal(ledger.status, 'completed');
		assert.equal(ledger.result_id, res.data.result_id);
	});

	test('E5 — replay expense ALREADY_COMPLETED', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('e5'), 'e5');
		const operationId = randomUUID();
		const pending = { tool: 'create_expense', label: `E5 ${TAG}`, amount: 555 };
		const hash = hashExpense(clientId, pending);
		await seedPending(clientId, pending, `tok-e5-${TAG}`, operationId);

		const first = await rpcExpense(clientId, {
			consumeToken: `tok-e5-${TAG}`,
			operationId,
			requestHash: hash,
		});
		expenseIds.push(first.data.result_id);
		const mid = await countExpenses(clientId);

		const replay = await rpcExpense(clientId, {
			consumeToken: `tok-e5-${TAG}`,
			operationId,
			requestHash: hash,
		});
		assert.equal(replay.data.status, 'ALREADY_COMPLETED');
		assert.equal(replay.data.result_id, first.data.result_id);
		assert.equal(await countExpenses(clientId), mid);
	});

	test('E6 — concurrent expense same operation_id', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('e6'), 'e6');
		const operationId = randomUUID();
		const pending = { tool: 'create_expense', label: `E6 ${TAG}`, amount: 666 };
		const hash = hashExpense(clientId, pending);
		await seedPending(clientId, pending, `tok-e6-${TAG}`, operationId);
		const before = await countExpenses(clientId);

		const [a, b] = await Promise.all([
			rpcExpense(clientId, {
				consumeToken: `tok-e6-${TAG}`,
				operationId,
				requestHash: hash,
			}),
			rpcExpense(clientId, {
				consumeToken: `tok-e6-${TAG}`,
				operationId,
				requestHash: hash,
			}),
		]);

		const statuses = [a.data?.status, b.data?.status].sort();
		assert.ok(statuses.includes('COMMITTED') || statuses.includes('ALREADY_COMPLETED'));
		const after = await countExpenses(clientId);
		assert.equal(after, before + 1);

		const resultId = a.data?.result_id || b.data?.result_id;
		if (resultId) expenseIds.push(resultId);
	});

	test('E7 — hash mismatch', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('e7'), 'e7');
		const operationId = randomUUID();
		const pending = { tool: 'create_expense', label: `E7 ${TAG}`, amount: 777 };
		const hash = hashExpense(clientId, pending);
		await seedPending(clientId, pending, `tok-e7-${TAG}`, operationId);

		const first = await rpcExpense(clientId, {
			consumeToken: `tok-e7-${TAG}`,
			operationId,
			requestHash: hash,
		});
		expenseIds.push(first.data.result_id);
		const before = await countExpenses(clientId);

		const mismatch = await rpcExpense(clientId, {
			consumeToken: `tok-e7-${TAG}`,
			operationId,
			requestHash: `${hash}-bad`,
		});
		assert.equal(mismatch.data.status, 'REQUEST_HASH_MISMATCH');
		assert.equal(await countExpenses(clientId), before);
	});

	test('E8 — rollback no ledger row', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('e8'), 'e8');
		const operationId = randomUUID();
		const pending = { tool: 'create_expense', label: '', amount: 100 };
		const hash = hashExpense(clientId, pending);
		await seedPending(clientId, pending, `tok-e8-${TAG}`, operationId);
		const before = await countExpenses(clientId);

		const { error } = await rpcExpense(clientId, {
			consumeToken: `tok-e8-${TAG}`,
			operationId,
			requestHash: hash,
		});
		assert.ok(error);
		assert.equal(await countExpenses(clientId), before);

		const { data: rows } = await admin
			.from('agent_write_operations')
			.select('id')
			.eq('client_id', clientId)
			.eq('operation_id', operationId);
		assert.equal(rows?.length ?? 0, 0);
	});

	test('E9 — cross tenant same operation_id', async (t) => {
		skipStaging(t);
		const sharedOp = randomUUID();
		const clientA = await createClientRow(await createAuthUser('e9a'), 'e9a');
		const clientB = await createClientRow(await createAuthUser('e9b'), 'e9b');
		const pendingA = { tool: 'create_expense', label: `A ${TAG}`, amount: 100 };
		const pendingB = { tool: 'create_expense', label: `B ${TAG}`, amount: 200 };

		await seedPending(clientA, pendingA, `tok-a-${TAG}`, sharedOp);
		await seedPending(clientB, pendingB, `tok-b-${TAG}`, sharedOp);

		const resA = await rpcExpense(clientA, {
			consumeToken: `tok-a-${TAG}`,
			operationId: sharedOp,
			requestHash: hashExpense(clientA, pendingA),
		});
		const resB = await rpcExpense(clientB, {
			consumeToken: `tok-b-${TAG}`,
			operationId: sharedOp,
			requestHash: hashExpense(clientB, pendingB),
		});

		assert.equal(resA.data.status, 'COMMITTED');
		assert.equal(resB.data.status, 'COMMITTED');
		assert.notEqual(resA.data.result_id, resB.data.result_id);
		expenseIds.push(resA.data.result_id, resB.data.result_id);
	});

	test('E10 — pending payload carries operationId', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('e10'), 'e10');
		const operationId = randomUUID();
		const pending = { tool: 'create_expense', label: `E10 ${TAG}`, amount: 1010 };
		await seedPending(clientId, pending, `tok-e10-${TAG}`, operationId);

		const { data: session } = await admin
			.from('agent_sessions')
			.select('payload')
			.eq('client_id', clientId)
			.eq('state_type', 'pending')
			.single();

		assert.equal(session.payload.operationId, operationId);
	});

	test('E11 — replay result_id stable', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('e11'), 'e11');
		const operationId = randomUUID();
		const pending = { tool: 'create_expense', label: `E11 ${TAG}`, amount: 1111 };
		const hash = hashExpense(clientId, pending);
		await seedPending(clientId, pending, `tok-e11-${TAG}`, operationId);

		const first = await rpcExpense(clientId, {
			consumeToken: `tok-e11-${TAG}`,
			operationId,
			requestHash: hash,
		});
		const replay = await rpcExpense(clientId, {
			consumeToken: `tok-e11-${TAG}`,
			operationId,
			requestHash: hash,
		});
		assert.equal(replay.data.result_id, first.data.result_id);
		expenseIds.push(first.data.result_id);
	});

	test('E12 — missing operation_id uses F4-B1 path (no ledger)', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('e12'), 'e12');
		const pending = { tool: 'create_expense', label: `E12 ${TAG}`, amount: 1212 };
		await seedPending(clientId, pending, `tok-e12-${TAG}`, null);
		const before = await countExpenses(clientId);

		const res = await admin.rpc('confirm_and_create_expense', {
			p_client_id: clientId,
			p_consume_token: `tok-e12-${TAG}`,
		});
		assert.equal(res.data.status, 'COMMITTED');
		expenseIds.push(res.data.result_id);
		assert.equal(await countExpenses(clientId), before + 1);

		const { count } = await admin
			.from('agent_write_operations')
			.select('id', { count: 'exact', head: true })
			.eq('client_id', clientId);
		assert.equal(count ?? 0, 0);
	});
});
