/**
 * Phase 5.8-F4-B2-B-STAGING — agent_write_operations schema validation.
 * Schema-only: no runtime idempotence, no RPC B2-C, no Node integration.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

import {
	evaluateStagingHarnessGate,
	stagingHarnessSkipMessage,
} from './helpers/agent-session-p0-staging-guard.js';

const STAGING_GATE = evaluateStagingHarnessGate();
const STAGING_HARNESS_ENABLED = STAGING_GATE.allowed;
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TAG = `b2b-${Date.now()}`;

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let admin = null;
/** @type {import('pg').Client | null} */
let pgClient = null;
/** @type {string[]} */
const clientIds = [];
/** @type {string[]} */
const authUserIds = [];
/** @type {string[]} */
const operationRowIds = [];

function skipStaging(t) {
	if (!STAGING_HARNESS_ENABLED) {
		t.skip(stagingHarnessSkipMessage(STAGING_GATE));
	}
}

function baseRow(clientId, operationId, overrides = {}) {
	return {
		operation_id: operationId,
		client_id: clientId,
		tool: 'create_expense',
		status: 'processing',
		request_hash: `hash-${TAG}-${randomUUID()}`,
		attempt_count: 0,
		...overrides,
	};
}

async function createAuthUser(label) {
	const email = `${TAG}-${label}-${randomUUID()}@b2b.ashledger.test`;
	const password = `B2b!${randomUUID().slice(0, 8)}`;
	const { data, error } = await admin.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
	});
	if (error) throw error;
	authUserIds.push(data.user.id);
	return { userId: data.user.id, email, password };
}

async function createClientRow(authUserId, label) {
	const userId = `${TAG}-${label}-${randomUUID()}`;
	const { data, error } = await admin
		.from('clients')
		.insert({
			user_id: userId,
			nom_client: `B2-B ${label}`,
			auth_user_id: authUserId,
			thread_id: '[]',
		})
		.select('id')
		.single();
	if (error) throw error;
	clientIds.push(data.id);
	return data.id;
}

async function connectPgClient() {
	if (pgClient) return pgClient;
	const { default: pg } = await import('pg');
	const urlMatch = (SUPABASE_URL || '').match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
	const projectRef = urlMatch ? urlMatch[1].toLowerCase() : null;
	let host = process.env.SUPABASE_DB_HOST;
	const port = Number(process.env.SUPABASE_DB_PORT || 5432);
	const password = process.env.SUPABASE_DB_PASSWORD;
	let user = 'postgres';
	if (host && /pooler\.supabase\.com/i.test(host) && projectRef) {
		user = `postgres.${projectRef}`;
	}
	if (!host && projectRef) {
		host = `db.${projectRef}.supabase.co`;
	}
	if (!host || !password) {
		throw new Error('SUPABASE_DB_HOST and SUPABASE_DB_PASSWORD required for pg RLS tests');
	}
	pgClient = new pg.Client({
		host,
		port,
		user,
		password,
		database: 'postgres',
		ssl: { rejectUnauthorized: false },
	});
	await pgClient.connect();
	return pgClient;
}

describe('Phase 5.8-F4-B2-B-STAGING — agent_write_operations schema', { skip: !STAGING_HARNESS_ENABLED }, () => {
	before(async () => {
		admin = createClient(SUPABASE_URL, SERVICE_KEY, {
			auth: { autoRefreshToken: false, persistSession: false },
			global: { fetch },
			realtime: { transport: ws },
		});
	});

	after(async () => {
		if (!admin) return;
		for (const id of operationRowIds.splice(0)) {
			await admin.from('agent_write_operations').delete().eq('id', id);
		}
		for (const id of clientIds.splice(0)) {
			await admin.from('agent_write_operations').delete().eq('client_id', id);
			await admin.from('clients').delete().eq('id', id);
		}
		for (const uid of authUserIds) {
			await admin.auth.admin.deleteUser(uid);
		}
		if (pgClient) {
			await pgClient.end();
			pgClient = null;
		}
	});

	test('1 — INSERT processing', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('proc').then((u) => u.userId), 'proc');
		const operationId = randomUUID();

		const { data, error } = await admin
			.from('agent_write_operations')
			.insert(baseRow(clientId, operationId))
			.select('id, status, operation_id')
			.single();

		assert.equal(error, null);
		assert.equal(data.status, 'processing');
		assert.equal(data.operation_id, operationId);
		operationRowIds.push(data.id);
	});

	test('2 — INSERT completed', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('done').then((u) => u.userId), 'done');
		const operationId = randomUUID();
		const resultId = randomUUID();

		const { data, error } = await admin
			.from('agent_write_operations')
			.insert(baseRow(clientId, operationId, {
				status: 'completed',
				result_id: resultId,
				completed_at: new Date().toISOString(),
			}))
			.select('id, status, result_id, completed_at')
			.single();

		assert.equal(error, null);
		assert.equal(data.status, 'completed');
		assert.equal(data.result_id, resultId);
		assert.ok(data.completed_at);
		operationRowIds.push(data.id);
	});

	test('3 — duplicate operation_id same client → rejet', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('dup').then((u) => u.userId), 'dup');
		const operationId = randomUUID();

		const first = await admin.from('agent_write_operations').insert(baseRow(clientId, operationId)).select('id').single();
		assert.equal(first.error, null);
		operationRowIds.push(first.data.id);

		const second = await admin.from('agent_write_operations').insert(baseRow(clientId, operationId)).select('id').single();
		assert.ok(second.error);
		assert.match(String(second.error.message || second.error.code), /duplicate|unique|23505/i);
	});

	test('4 — même operation_id autre client → accepté', async (t) => {
		skipStaging(t);
		const sharedOperationId = randomUUID();
		const clientA = await createClientRow(await createAuthUser('xa').then((u) => u.userId), 'xa');
		const clientB = await createClientRow(await createAuthUser('xb').then((u) => u.userId), 'xb');

		const rowA = await admin.from('agent_write_operations').insert(baseRow(clientA, sharedOperationId)).select('id').single();
		const rowB = await admin.from('agent_write_operations').insert(baseRow(clientB, sharedOperationId)).select('id').single();

		assert.equal(rowA.error, null);
		assert.equal(rowB.error, null);
		operationRowIds.push(rowA.data.id, rowB.data.id);
	});

	test('5 — invalid status → rejet', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('bad-st').then((u) => u.userId), 'bad-st');

		const { error } = await admin.from('agent_write_operations').insert(baseRow(clientId, randomUUID(), {
			status: 'failed',
		}));

		assert.ok(error);
		assert.match(String(error.message || error.code), /check|constraint|23514/i);
	});

	test('6 — invalid tool → rejet', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('bad-tool').then((u) => u.userId), 'bad-tool');

		const { error } = await admin.from('agent_write_operations').insert(baseRow(clientId, randomUUID(), {
			tool: 'Create-Expense',
		}));

		assert.ok(error);
		assert.match(String(error.message || error.code), /check|constraint|23514/i);
	});

	test('7 — request_hash obligatoire', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('no-hash').then((u) => u.userId), 'no-hash');

		const { error } = await admin.from('agent_write_operations').insert({
			operation_id: randomUUID(),
			client_id: clientId,
			tool: 'create_expense',
			status: 'processing',
			request_hash: '',
		});

		assert.ok(error);
	});

	test('8 — client_id obligatoire', async (t) => {
		skipStaging(t);

		const { error } = await admin.from('agent_write_operations').insert({
			operation_id: randomUUID(),
			client_id: null,
			tool: 'create_expense',
			status: 'processing',
			request_hash: `hash-${TAG}`,
		});

		assert.ok(error);
	});

	test('9 — attempt_count >= 0', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('neg-at').then((u) => u.userId), 'neg-at');

		const { error } = await admin.from('agent_write_operations').insert(baseRow(clientId, randomUUID(), {
			attempt_count: -1,
		}));

		assert.ok(error);
		assert.match(String(error.message || error.code), /check|constraint|23514/i);
	});

	test('10 — metadata object', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('meta').then((u) => u.userId), 'meta');

		const bad = await admin.from('agent_write_operations').insert(baseRow(clientId, randomUUID(), {
			metadata: ['not-an-object'],
		}));
		assert.ok(bad.error);

		const good = await admin.from('agent_write_operations').insert(baseRow(clientId, randomUUID(), {
			metadata: { stockRemaining: 5 },
		})).select('id').single();
		assert.equal(good.error, null);
		operationRowIds.push(good.data.id);
	});

	test('11 — service_role access', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('svc').then((u) => u.userId), 'svc');
		const operationId = randomUUID();

		const insert = await admin.from('agent_write_operations').insert(baseRow(clientId, operationId)).select('id').single();
		assert.equal(insert.error, null);
		operationRowIds.push(insert.data.id);

		const { data, error } = await admin
			.from('agent_write_operations')
			.select('id')
			.eq('client_id', clientId)
			.eq('operation_id', operationId)
			.single();

		assert.equal(error, null);
		assert.equal(data.id, insert.data.id);
	});

	test('12 — authenticated direct write denied', async (t) => {
		skipStaging(t);
		const db = await connectPgClient();
		const { rows } = await db.query(`
			select has_table_privilege('authenticated', 'public.agent_write_operations', 'INSERT') as can_insert
		`);
		assert.equal(rows[0]?.can_insert, false);
	});

	test('13 — cross-tenant read denied (no authenticated SELECT)', async (t) => {
		skipStaging(t);
		const db = await connectPgClient();
		const { rows } = await db.query(`
			select has_table_privilege('authenticated', 'public.agent_write_operations', 'SELECT') as can_select
		`);
		assert.equal(rows[0]?.can_select, false);
	});

	test('14 — cascade client → operation', async (t) => {
		skipStaging(t);
		const auth = await createAuthUser('cascade');
		const clientId = await createClientRow(auth.userId, 'cascade');
		const operationId = randomUUID();

		const inserted = await admin.from('agent_write_operations').insert(baseRow(clientId, operationId)).select('id').single();
		assert.equal(inserted.error, null);

		const { count: before } = await admin
			.from('agent_write_operations')
			.select('id', { count: 'exact', head: true })
			.eq('client_id', clientId);
		assert.equal(before, 1);

		await admin.from('clients').delete().eq('id', clientId);
		clientIds.splice(clientIds.indexOf(clientId), 1);

		const { count: after } = await admin
			.from('agent_write_operations')
			.select('id', { count: 'exact', head: true })
			.eq('operation_id', operationId);
		assert.equal(after, 0);
	});
});

describe('Phase 5.8-F4-B2-B-STAGING — skip marker', () => {
	test('staging blocked when safety gate is not satisfied', (t) => {
		if (!STAGING_HARNESS_ENABLED) {
			t.skip(stagingHarnessSkipMessage(STAGING_GATE));
		}
	});
});
