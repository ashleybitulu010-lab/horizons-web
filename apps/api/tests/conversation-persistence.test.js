/**
 * Phase 5.2 — Conversation persistence schema integration tests.
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * RLS tests use SUPABASE_ANON_KEY when available, else SUPABASE_DB_URL + pg role simulation.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const DB_URL = process.env.SUPABASE_DB_URL || '';

const RUN = Boolean(SUPABASE_URL && SERVICE_KEY);
const USE_PG_RLS = !ANON_KEY && Boolean(DB_URL);
const TAG = `phase52-${Date.now()}`;

/** @type {import('@supabase/supabase-js').SupabaseClient} */
let admin;
/** @type {import('pg').Client | null} */
let pgClient = null;
/** @type {string[]} */
const authUserIds = [];
/** @type {string[]} */
const clientIds = [];

function skipIfNeeded(t) {
	if (!RUN) {
		t.skip('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
	}
}

async function getPgClient() {
	if (!USE_PG_RLS) return null;
	if (!pgClient) {
		const { Client } = await import('pg');
		pgClient = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
		await pgClient.connect();
	}
	return pgClient;
}

async function withAuthenticatedRole(authUserId, fn) {
	const pg = await getPgClient();
	if (!pg) throw new Error('pg client unavailable for RLS simulation');
	await pg.query('BEGIN');
	try {
		await pg.query('SET LOCAL ROLE authenticated');
		await pg.query('SELECT set_config($1, $2, true)', ['request.jwt.claim.sub', authUserId]);
		await pg.query('SELECT set_config($1, $2, true)', ['role', 'authenticated']);
		return await fn(pg);
	} finally {
		await pg.query('ROLLBACK');
	}
}

async function createAuthUser(label) {
	const email = `${TAG}-${label}-${randomUUID()}@phase52.ashledger.test`;
	const password = `Phase52!${randomUUID().slice(0, 8)}`;
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
			nom_client: `Phase52 ${label}`,
			auth_user_id: authUserId,
			thread_id: '[]',
		})
		.select('id')
		.single();
	if (error) throw error;
	clientIds.push(data.id);
	return data.id;
}

async function signInClient(email, password) {
	if (!ANON_KEY) throw new Error('ANON_KEY required for signInClient');
	const client = createClient(SUPABASE_URL, ANON_KEY, {
		auth: { autoRefreshToken: false, persistSession: false },
		global: { fetch },
		realtime: { transport: ws },
	});
	const { error } = await client.auth.signInWithPassword({ email, password });
	if (error) throw error;
	return client;
}

async function allocateSequence(clientId) {
	const { data, error } = await admin.rpc('allocate_chat_message_sequence', {
		p_client_id: clientId,
	});
	if (error) throw error;
	return data;
}

async function insertMessage(clientId, role, content, sequence) {
	const { data, error } = await admin
		.from('chat_messages')
		.insert({
			client_id: clientId,
			role,
			content,
			sequence,
			created_at: new Date().toISOString(),
			source: 'backend',
		})
		.select('id, sequence')
		.single();
	if (error) throw error;
	return data;
}

describe('Phase 5.2 conversation persistence', { skip: !RUN }, () => {
	before(async () => {
		admin = createClient(SUPABASE_URL, SERVICE_KEY, {
			auth: { autoRefreshToken: false, persistSession: false },
			global: { fetch },
			realtime: { transport: ws },
		});
	});

	after(async () => {
		if (pgClient) {
			await pgClient.end();
			pgClient = null;
		}
		if (!admin) return;
		for (const id of clientIds) {
			await admin.from('clients').delete().eq('id', id);
		}
		for (const uid of authUserIds) {
			await admin.auth.admin.deleteUser(uid);
		}
	});

	test('TEST 1 — client can be represented in chat_messages', async (t) => {
		skipIfNeeded(t);
		const authUser = await createAuthUser('msg');
		const clientId = await createClientRow(authUser.id, 'msg');
		const seq = await allocateSequence(clientId);
		const row = await insertMessage(clientId, 'user', 'Phase52 hello', seq);
		assert.ok(row.id);
		assert.equal(row.sequence, seq);
	});

	test('TEST 2 — two messages receive different sequences', async (t) => {
		skipIfNeeded(t);
		const authUser = await createAuthUser('seq2');
		const clientId = await createClientRow(authUser.id, 'seq2');
		const seq1 = await allocateSequence(clientId);
		const seq2 = await allocateSequence(clientId);
		assert.notEqual(seq1, seq2);
		await insertMessage(clientId, 'user', 'first', seq1);
		await insertMessage(clientId, 'assistant', 'second', seq2);
		const { data, error } = await admin
			.from('chat_messages')
			.select('sequence')
			.eq('client_id', clientId)
			.order('sequence', { ascending: true });
		if (error) throw error;
		assert.deepEqual(data.map((r) => r.sequence), [seq1, seq2]);
	});

	test('TEST 3 — concurrent allocations never duplicate sequence', async (t) => {
		skipIfNeeded(t);
		const authUser = await createAuthUser('conc');
		const clientId = await createClientRow(authUser.id, 'conc');
		const rounds = 8;
		const results = await Promise.all(
			Array.from({ length: rounds }, () => allocateSequence(clientId)),
		);
		assert.equal(new Set(results).size, rounds, `duplicate sequences: ${results.join(',')}`);
	});

	test('TEST 4 — client A cannot read client B messages (authenticated)', async (t) => {
		skipIfNeeded(t);
		const userA = await createAuthUser('a');
		const userB = await createAuthUser('b');
		const clientA = await createClientRow(userA.id, 'a');
		const clientB = await createClientRow(userB.id, 'b');
		const seq = await allocateSequence(clientB);
		await insertMessage(clientB, 'user', 'secret B', seq);

		if (ANON_KEY) {
			const sessionA = await signInClient(userA.email, userA.password);
			const { data, error } = await sessionA
				.from('chat_messages')
				.select('id, content')
				.eq('client_id', clientB);
			assert.ok(!error, error?.message);
			assert.equal(data.length, 0);
		} else {
			const rows = await withAuthenticatedRole(userA.id, async (pg) => {
				const res = await pg.query(
					'select id, content from public.chat_messages where client_id = $1',
					[clientB],
				);
				return res.rows;
			});
			assert.equal(rows.length, 0);
		}
		void clientA;
	});

	test('TEST 5 — authenticated cannot INSERT chat_messages', async (t) => {
		skipIfNeeded(t);
		const user = await createAuthUser('ins');
		const clientId = await createClientRow(user.id, 'ins');

		if (ANON_KEY) {
			const session = await signInClient(user.email, user.password);
			const { error } = await session.from('chat_messages').insert({
				client_id: clientId,
				role: 'user',
				content: 'forged',
				sequence: 1,
				created_at: new Date().toISOString(),
				source: 'frontend',
			});
			assert.ok(error, 'expected INSERT to be denied for authenticated');
			return;
		}

		await assert.rejects(
			() => withAuthenticatedRole(user.id, async (pg) => {
				await pg.query(
					`insert into public.chat_messages (client_id, role, content, sequence, created_at, source)
					 values ($1, 'user', 'forged', 1, now(), 'frontend')`,
					[clientId],
				);
			}),
			(err) => /permission denied|insufficient privilege|42501|row-level security/i.test(String(err?.message || err)),
		);
	});

	test('TEST 6 — authenticated cannot DELETE chat_messages', async (t) => {
		skipIfNeeded(t);
		const user = await createAuthUser('del');
		const clientId = await createClientRow(user.id, 'del');
		const seq = await allocateSequence(clientId);
		const row = await insertMessage(clientId, 'user', 'to delete', seq);

		if (ANON_KEY) {
			const session = await signInClient(user.email, user.password);
			const { error } = await session.from('chat_messages').delete().eq('id', row.id);
			assert.ok(error, 'expected DELETE to be denied for authenticated');
			return;
		}

		const deleteResult = await withAuthenticatedRole(user.id, async (pg) => pg.query(
			'delete from public.chat_messages where id = $1',
			[row.id],
		));
		assert.equal(deleteResult.rowCount, 0);
		const { data: stillThere, error: readErr } = await admin
			.from('chat_messages')
			.select('id')
			.eq('id', row.id)
			.single();
		assert.ok(!readErr && stillThere?.id === row.id);
	});

	test('TEST 7 — authenticated cannot UPDATE agent_sessions', async (t) => {
		skipIfNeeded(t);
		const user = await createAuthUser('upd');
		const clientId = await createClientRow(user.id, 'upd');
		const { data: inserted, error: insErr } = await admin
			.from('agent_sessions')
			.insert({
				client_id: clientId,
				state_type: 'draft',
				payload: { intention: 'vente', slots: {} },
			})
			.select('id')
			.single();
		if (insErr) throw insErr;

		if (ANON_KEY) {
			const session = await signInClient(user.email, user.password);
			const { error } = await session
				.from('agent_sessions')
				.update({ intention: 'hacked' })
				.eq('id', inserted.id);
			assert.ok(error, 'expected UPDATE to be denied for authenticated');
			return;
		}

		const updateResult = await withAuthenticatedRole(user.id, async (pg) => pg.query(
			'update public.agent_sessions set intention = $1 where id = $2',
			['hacked', inserted.id],
		));
		assert.equal(updateResult.rowCount, 0);
		const { data: unchanged, error: readErr } = await admin
			.from('agent_sessions')
			.select('intention')
			.eq('id', inserted.id)
			.single();
		assert.ok(!readErr);
		assert.notEqual(unchanged?.intention, 'hacked');
	});

	test('TEST 8 — authenticated cannot INSERT agent_sessions', async (t) => {
		skipIfNeeded(t);
		const user = await createAuthUser('asins');
		const clientId = await createClientRow(user.id, 'asins');

		if (ANON_KEY) {
			const session = await signInClient(user.email, user.password);
			const { error } = await session.from('agent_sessions').insert({
				client_id: clientId,
				state_type: 'draft',
				payload: { intention: 'vente' },
			});
			assert.ok(error, 'expected INSERT to be denied for authenticated');
			return;
		}

		await assert.rejects(
			() => withAuthenticatedRole(user.id, async (pg) => {
				await pg.query(
					`insert into public.agent_sessions (client_id, state_type, payload)
					 values ($1, 'draft', '{"intention":"vente"}'::jsonb)`,
					[clientId],
				);
			}),
			(err) => /permission denied|insufficient privilege|42501|row-level security/i.test(String(err?.message || err)),
		);
	});

	test('TEST 9 — authenticated cannot access chat_message_counters', async (t) => {
		skipIfNeeded(t);
		const user = await createAuthUser('ctr');
		const clientId = await createClientRow(user.id, 'ctr');
		await allocateSequence(clientId);

		if (ANON_KEY) {
			const session = await signInClient(user.email, user.password);
			const { data, error } = await session.from('chat_message_counters').select('*');
			assert.ok(error || data.length === 0, 'expected counters to be inaccessible');
			return;
		}

		try {
			const result = await withAuthenticatedRole(user.id, async (pg) => pg.query(
				'select * from public.chat_message_counters where client_id = $1',
				[clientId],
			));
			assert.equal(result.rows.length, 0);
		} catch (err) {
			assert.match(String(err?.message || err), /permission denied|insufficient privilege|42501|row-level security/i);
			return;
		}
		const { count, error: adminErr } = await admin
			.from('chat_message_counters')
			.select('*', { count: 'exact', head: true })
			.eq('client_id', clientId);
		assert.ok(!adminErr);
		assert.ok((count || 0) > 0, 'service_role should still see counters row');
	});

	test('TEST 10 — authenticated cannot execute allocate_chat_message_sequence', async (t) => {
		skipIfNeeded(t);
		const user = await createAuthUser('rpc');
		const clientId = await createClientRow(user.id, 'rpc');

		if (ANON_KEY) {
			const session = await signInClient(user.email, user.password);
			const { error } = await session.rpc('allocate_chat_message_sequence', {
				p_client_id: clientId,
			});
			assert.ok(error, 'expected RPC to be denied for authenticated');
			return;
		}

		await assert.rejects(
			() => withAuthenticatedRole(user.id, async (pg) => {
				await pg.query('select public.allocate_chat_message_sequence($1)', [clientId]);
			}),
			(err) => /permission denied|insufficient privilege|42501/i.test(String(err?.message || err)),
		);
	});

	test('TEST 11 — service_role can perform backend operations', async (t) => {
		skipIfNeeded(t);
		const authUser = await createAuthUser('sr');
		const clientId = await createClientRow(authUser.id, 'sr');
		const seq = await allocateSequence(clientId);
		const msg = await insertMessage(clientId, 'assistant', 'service role ok', seq);
		const { data: sessionRow, error: sessErr } = await admin
			.from('agent_sessions')
			.insert({
				client_id: clientId,
				state_type: 'pending',
				payload: { intention: 'vente', slots: { produit: 'test' } },
				intention: 'vente',
				awaiting: 'slots',
			})
			.select('id, state_type')
			.single();
		if (sessErr) throw sessErr;
		assert.equal(sessionRow.state_type, 'pending');
		const { data: counter, error: ctrErr } = await admin
			.from('chat_message_counters')
			.select('next_sequence')
			.eq('client_id', clientId)
			.single();
		if (ctrErr) throw ctrErr;
		assert.ok(counter.next_sequence > seq);
		void msg;
	});

	test('TEST 12 — ON DELETE CASCADE removes dependent rows', async (t) => {
		skipIfNeeded(t);
		const authUser = await createAuthUser('cascade');
		const clientId = await createClientRow(authUser.id, 'cascade');
		const seq = await allocateSequence(clientId);
		await insertMessage(clientId, 'user', 'cascade msg', seq);
		await admin.from('agent_sessions').insert({
			client_id: clientId,
			state_type: 'draft',
			payload: { intention: 'depense' },
		});

		const { error: delErr } = await admin.from('clients').delete().eq('id', clientId);
		if (delErr) throw delErr;
		clientIds.splice(clientIds.indexOf(clientId), 1);

		const { count: msgCount } = await admin
			.from('chat_messages')
			.select('*', { count: 'exact', head: true })
			.eq('client_id', clientId);
		const { count: sessCount } = await admin
			.from('agent_sessions')
			.select('*', { count: 'exact', head: true })
			.eq('client_id', clientId);
		const { count: ctrCount } = await admin
			.from('chat_message_counters')
			.select('*', { count: 'exact', head: true })
			.eq('client_id', clientId);
		assert.equal(msgCount, 0);
		assert.equal(sessCount, 0);
		assert.equal(ctrCount, 0);
	});
});

describe('Phase 5.2 conversation persistence — env gate', () => {
	test('reports skip reason when Supabase env is missing', () => {
		if (RUN) return;
		assert.ok(true, 'integration tests skipped without Supabase credentials');
	});

	test('RLS mode selection', () => {
		if (!RUN) return;
		assert.ok(ANON_KEY || USE_PG_RLS, 'RLS tests need ANON_KEY or SUPABASE_DB_URL');
	});
});
