/**
 * P1-E — Final staging E2E gate (vwjkktqcmmhotadicbpg only).
 *
 *   node --env-file=apps/api/.env.staging tools/_p1e_staging_e2e_gate.mjs
 */
import { randomUUID, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const STAGING_REF = 'vwjkktqcmmhotadicbpg';
const PRODUCTION_REF = 'knrwplidgvuvjnuqqmrt';
const TAG = `p1e-e2e-${Date.now()}`;

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function assertStagingOnly() {
	const match = SUPABASE_URL.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
	const ref = match ? match[1].toLowerCase() : null;
	if (ref === PRODUCTION_REF) {
		throw new Error('Production blocked for P1-E E2E gate');
	}
	if (ref !== STAGING_REF) {
		throw new Error(`Expected staging ${STAGING_REF}, got ${ref || SUPABASE_URL}`);
	}
	if (!SERVICE_KEY) {
		throw new Error('SUPABASE_SERVICE_ROLE_KEY required');
	}
}

async function connectPg() {
	const dbUrl = process.env.SUPABASE_DB_URL;
	if (dbUrl) {
		const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
		await client.connect();
		return client;
	}
	const host = process.env.SUPABASE_DB_HOST || `db.${STAGING_REF}.supabase.co`;
	const password = process.env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_PASS;
	if (!password) throw new Error('DB password required');
	const user = /pooler\.supabase\.com/i.test(host) ? `postgres.${STAGING_REF}` : 'postgres';
	const client = new pg.Client({
		host,
		port: Number(process.env.SUPABASE_DB_PORT || 5432),
		user,
		password,
		database: 'postgres',
		ssl: { rejectUnauthorized: false },
	});
	await client.connect();
	return client;
}

function makeUser({ id, clientId, activeActivityId }) {
	return { id, clientId, activeActivityId };
}

function pass(name, detail = null) {
	return { name, status: 'PASS', detail };
}

function fail(name, detail) {
	return { name, status: 'FAIL', detail };
}

function computeRequestHash(clientId, pendingWrite) {
	const payload = {
		amount: Number(pendingWrite.amount),
		clientId,
		label: String(pendingWrite.label || '').trim(),
		tool: pendingWrite.tool,
	};
	const ordered = Object.fromEntries(Object.keys(payload).sort().map((k) => [k, payload[k]]));
	return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

async function createAuthUser(admin, label) {
	const email = `${TAG}-${label}-${randomUUID()}@p1e.ashledger.test`;
	const password = `P1e!${randomUUID().slice(0, 8)}`;
	const { data, error } = await admin.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
	});
	if (error) throw error;
	return { id: data.user.id, email };
}

async function createClientRow(admin, authUserId, label) {
	const userId = `${TAG}-${label}-${randomUUID()}`;
	const { data, error } = await admin
		.from('clients')
		.insert({
			user_id: userId,
			nom_client: `${TAG} ${label}`,
			auth_user_id: authUserId,
		})
		.select('id')
		.single();
	if (error) throw error;
	return data.id;
}

async function createActivity(admin, clientId, { name, isDefault = false, type = 'commerce' }) {
	const { data, error } = await admin
		.from('activities')
		.insert({ client_id: clientId, name, type, is_default: isDefault })
		.select('id, client_id, name, type, is_default')
		.single();
	if (error) throw error;
	return {
		id: data.id,
		clientId: data.client_id,
		name: data.name,
		type: data.type,
		isDefault: Boolean(data.is_default),
	};
}

async function seedInitialMessage(admin, clientId, activityId, content) {
	const { data: seq, error: seqErr } = await admin.rpc('allocate_chat_message_sequence', {
		p_client_id: clientId,
		p_activity_id: activityId,
	});
	if (seqErr) throw seqErr;

	const { data, error } = await admin
		.from('chat_messages')
		.insert({
			client_id: clientId,
			activity_id: activityId,
			sequence: seq,
			role: 'user',
			content,
			source: 'backend',
			metadata: { p1e_e2e: TAG },
			created_at: new Date().toISOString(),
		})
		.select('id, client_id, activity_id, sequence, content')
		.single();
	if (error) throw error;
	return data;
}

async function listMessagesForScope(admin, clientId, activityId) {
	const { data, error } = await admin
		.from('chat_messages')
		.select('id, client_id, activity_id, sequence, content')
		.eq('client_id', clientId)
		.eq('activity_id', activityId)
		.order('sequence', { ascending: true });
	if (error) throw error;
	return data || [];
}

async function getCounter(admin, clientId, activityId) {
	const { data, error } = await admin
		.from('chat_message_counters')
		.select('client_id, activity_id, next_sequence')
		.eq('client_id', clientId)
		.eq('activity_id', activityId)
		.maybeSingle();
	if (error) throw error;
	return data;
}

async function savePending(admin, clientId, activityId, consumeToken, pendingWrite = null) {
	const payload = {
		consumeToken,
		pendingWrite: pendingWrite || { tool: 'create_expense', label: `${TAG} pending`, amount: 100 },
	};
	const { data, error } = await admin
		.from('agent_sessions')
		.upsert(
			{
				client_id: clientId,
				activity_id: activityId,
				state_type: 'pending',
				payload,
				awaiting: 'confirm',
				intention: 'create_expense',
			},
			{ onConflict: 'client_id,activity_id,state_type' },
		)
		.select('id, state_version, payload')
		.single();
	if (error) throw error;
	return data;
}

async function consumePending(admin, clientId, activityId, consumeToken) {
	const { data, error } = await admin.rpc('consume_agent_pending', {
		p_client_id: clientId,
		p_activity_id: activityId,
		p_expected_version: null,
		p_consume_token: consumeToken,
	});
	if (error) throw error;
	return data;
}

async function cleanupFixtures(admin, pgClient, ids) {
	const {
		authUserIds = [],
		clientIds = [],
		activityIds = [],
		messageIds = [],
		sessionIds = [],
		operationIds = [],
		expenseIds = [],
	} = ids;

	for (const opId of operationIds) {
		await admin.from('agent_write_operations').delete().eq('operation_id', opId);
	}
	for (const expenseId of expenseIds) {
		await admin.from('depenses').delete().eq('id', expenseId);
	}
	for (const sessionId of sessionIds) {
		await admin.from('agent_sessions').delete().eq('id', sessionId);
	}
	for (const messageId of messageIds) {
		await admin.from('chat_messages').delete().eq('id', messageId);
	}
	for (const activityId of activityIds) {
		await admin.from('chat_message_counters').delete().eq('activity_id', activityId);
		await admin.from('agent_sessions').delete().eq('activity_id', activityId);
	}
	for (const clientId of clientIds) {
		await admin.from('chat_message_counters').delete().eq('client_id', clientId);
		await admin.from('chat_messages').delete().eq('client_id', clientId);
		await admin.from('agent_sessions').delete().eq('client_id', clientId);
		await admin.from('depenses').delete().eq('client_id', clientId);
		await admin.from('agent_write_operations').delete().eq('client_id', clientId);
		await admin.from('activities').delete().eq('client_id', clientId);
		await admin.from('clients').delete().eq('id', clientId);
	}
	for (const authUserId of authUserIds) {
		await admin.auth.admin.deleteUser(authUserId);
	}

	if (pgClient) {
		for (const clientId of clientIds) {
			const { rows } = await pgClient.query(
				`select count(*)::int as n from public.chat_messages where client_id = $1 and metadata->>'p1e_e2e' = $2`,
				[clientId, TAG],
			);
			if (rows[0]?.n > 0) {
				throw new Error(`Cleanup incomplete: ${rows[0].n} chat_messages remain for ${clientId}`);
			}
		}
	}
}

async function main() {
	assertStagingOnly();

	const report = {
		tag: TAG,
		target: STAGING_REF,
		sections: {},
		verdict: 'NO-GO',
	};

	const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
		auth: { persistSession: false, autoRefreshToken: false },
	});

	const pgClient = await connectPg();

	const cleanupIds = {
		authUserIds: [],
		clientIds: [],
		activityIds: [],
		messageIds: [],
		sessionIds: [],
		operationIds: [],
		expenseIds: [],
	};

	const { resolveActivityReference } = await import('../apps/api/src/services/activity-reference-resolver.js');
	const { appendMessage, listMessages } = await import('../apps/api/src/services/conversation-service.js');
	const { validateActivityForClient, resolveDefaultActivity } = await import('../apps/api/src/services/activity-scope.js');
	const { assertActivityOwnership } = await import('../apps/api/src/services/supabase-scoped.js');

	try {
		// -------------------------------------------------------------------
		// 1. Fixtures
		// -------------------------------------------------------------------
		const authA = await createAuthUser(admin, 'client-a');
		const authB = await createAuthUser(admin, 'client-b');
		cleanupIds.authUserIds.push(authA.id, authB.id);

		const clientA = await createClientRow(admin, authA.id, 'client-a');
		const clientB = await createClientRow(admin, authB.id, 'client-b');
		cleanupIds.clientIds.push(clientA, clientB);

		const activityA1 = await createActivity(admin, clientA, { name: 'A1', isDefault: true });
		const activityA2 = await createActivity(admin, clientA, { name: 'A2', isDefault: false });
		const activityB1 = await createActivity(admin, clientB, { name: 'B1', isDefault: true });
		cleanupIds.activityIds.push(activityA1.id, activityA2.id, activityB1.id);

		const userA1 = makeUser({ id: authA.id, clientId: clientA, activeActivityId: activityA1.id });
		const userA2 = makeUser({ id: authA.id, clientId: clientA, activeActivityId: activityA2.id });
		const userB1 = makeUser({ id: authB.id, clientId: clientB, activeActivityId: activityB1.id });

		report.sections.fixtures = pass('fixtures', {
			clientA,
			clientB,
			activityA1: activityA1.id,
			activityA2: activityA2.id,
			activityB1: activityB1.id,
		});

		// -------------------------------------------------------------------
		// 2. Chat messages (seed)
		// -------------------------------------------------------------------
		const msgA1 = await seedInitialMessage(admin, clientA, activityA1.id, 'message activité A1');
		const msgA2 = await seedInitialMessage(admin, clientA, activityA2.id, 'message activité A2');
		const msgB1 = await seedInitialMessage(admin, clientB, activityB1.id, 'message activité B1');
		cleanupIds.messageIds.push(msgA1.id, msgA2.id, msgB1.id);

		const chatSeedOk = msgA1.activity_id === activityA1.id
			&& msgA2.activity_id === activityA2.id
			&& msgB1.activity_id === activityB1.id
			&& msgA1.client_id === clientA
			&& Number.isFinite(Number(msgA1.sequence));
		report.sections.chatIsolation = chatSeedOk
			? pass('chat seed messages', { msgA1: msgA1.sequence, msgA2: msgA2.sequence, msgB1: msgB1.sequence })
			: fail('chat seed messages', { msgA1, msgA2, msgB1 });

		// -------------------------------------------------------------------
		// 3. History isolation
		// -------------------------------------------------------------------
		const histA1 = await listMessages({ user: userA1 });
		const histA2 = await listMessages({ user: userA2 });
		const histB1 = await listMessages({ user: userB1 });

		const contentsA1 = histA1.messages.map((m) => m.content);
		const contentsA2 = histA2.messages.map((m) => m.content);
		const contentsB1 = histB1.messages.map((m) => m.content);

		const historyOk = contentsA1.every((c) => c.includes('A1') && !c.includes('A2') && !c.includes('B1'))
			&& contentsA2.every((c) => c.includes('A2') && !c.includes('A1') && !c.includes('B1'))
			&& contentsB1.every((c) => c.includes('B1') && !c.includes('A1') && !c.includes('A2'))
			&& !contentsA1.some((c) => c.includes('A2'))
			&& !contentsA2.some((c) => c.includes('A1'));

		report.sections.historyIsolation = historyOk
			? pass('history isolation', { counts: { A1: histA1.count, A2: histA2.count, B1: histB1.count } })
			: fail('history isolation', { contentsA1, contentsA2, contentsB1 });

		// -------------------------------------------------------------------
		// 4. Chat append
		// -------------------------------------------------------------------
		const appendA1 = await appendMessage({
			user: userA1,
			role: 'user',
			content: `${TAG} append A1`,
			source: 'backend',
			metadata: { p1e_e2e: TAG },
		});
		const appendA2 = await appendMessage({
			user: userA2,
			role: 'user',
			content: `${TAG} append A2`,
			source: 'backend',
			metadata: { p1e_e2e: TAG },
		});
		cleanupIds.messageIds.push(appendA1.id, appendA2.id);

		const appendOk = appendA1.activityId === activityA1.id
			&& appendA2.activityId === activityA2.id
			&& appendA1.sequence >= 2
			&& appendA2.sequence >= 2;

		report.sections.chatAppend = appendOk
			? pass('chat append (independent per-activity sequences)', { seqA1: appendA1.sequence, seqA2: appendA2.sequence })
			: fail('chat append', { appendA1, appendA2 });

		// -------------------------------------------------------------------
		// 5. Counter isolation
		// -------------------------------------------------------------------
		const ctrA1 = await getCounter(admin, clientA, activityA1.id);
		const ctrA2 = await getCounter(admin, clientA, activityA2.id);
		const ctrB1 = await getCounter(admin, clientB, activityB1.id);

		const counterOk = ctrA1?.activity_id === activityA1.id
			&& ctrA2?.activity_id === activityA2.id
			&& ctrB1?.activity_id === activityB1.id
			&& ctrA1.client_id === clientA
			&& ctrA2.client_id === clientA
			&& ctrB1.client_id === clientB
			&& ctrA1.next_sequence > 1
			&& ctrA2.next_sequence > 1
			&& ctrA1.activity_id !== ctrA2.activity_id;

		report.sections.counterIsolation = counterOk
			? pass('counter isolation', { ctrA1, ctrA2, ctrB1 })
			: fail('counter isolation', { ctrA1, ctrA2, ctrB1 });

		// -------------------------------------------------------------------
		// 6. Session isolation
		// -------------------------------------------------------------------
		const tokenA1 = randomUUID();
		const tokenA2 = randomUUID();
		const pendingA1 = await savePending(admin, clientA, activityA1.id, tokenA1);
		const pendingA2 = await savePending(admin, clientA, activityA2.id, tokenA2);
		cleanupIds.sessionIds.push(pendingA1.id, pendingA2.id);

		const consumeOkA1 = await consumePending(admin, clientA, activityA1.id, tokenA1);
		const consumeDenyA1FromA2 = await consumePending(admin, clientA, activityA2.id, tokenA1);

		const pendingA2After = await admin
			.from('agent_sessions')
			.select('id, activity_id, state_type')
			.eq('id', pendingA2.id)
			.maybeSingle();

		const sessionOk = consumeOkA1?.status === 'CONSUMED'
			&& consumeDenyA1FromA2?.status === 'VERSION_MISMATCH'
			&& pendingA2After.data?.state_type === 'pending';

		report.sections.sessionIsolation = sessionOk
			? pass('session isolation', { consumeOkA1: consumeOkA1.status, consumeDeny: consumeDenyA1FromA2.status })
			: fail('session isolation', { consumeOkA1, consumeDenyA1FromA2, pendingA2After: pendingA2After.data });

		// -------------------------------------------------------------------
		// 7. Activity resolution
		// -------------------------------------------------------------------
		const resA1 = await resolveActivityReference(clientA, 'A1');
		const resA2 = await resolveActivityReference(clientA, 'A2');
		const resB1FromA = await resolveActivityReference(clientA, 'B1');

		const ambigA1 = await createActivity(admin, clientA, { name: 'Boulangerie Paris', isDefault: false });
		const ambigA2 = await createActivity(admin, clientA, { name: 'Boulangerie Paris Est', isDefault: false });
		cleanupIds.activityIds.push(ambigA1.id, ambigA2.id);

		const resAmbig = await resolveActivityReference(clientA, 'Boulangerie Paris');

		const resolverOk = resA1.status === 'RESOLVED' && resA1.activity.id === activityA1.id
			&& resA2.status === 'RESOLVED' && resA2.activity.id === activityA2.id
			&& resB1FromA.status === 'NOT_FOUND'
			&& resAmbig.status === 'AMBIGUOUS'
			&& resAmbig.matches.length >= 2;

		report.sections.activityResolver = (resA1.status === 'RESOLVED' && resA2.status === 'RESOLVED' && resB1FromA.status === 'NOT_FOUND')
			? pass('activity resolver', { resA1: resA1.status, resA2: resA2.status, crossTenant: resB1FromA.status })
			: fail('activity resolver', { resA1, resA2, resB1FromA });

		report.sections.ambiguousResolver = resAmbig.status === 'AMBIGUOUS'
			? pass('ambiguous resolver', { matchCount: resAmbig.matches.length })
			: fail('ambiguous resolver', resAmbig);

		report.sections.crossTenant = resB1FromA.status === 'NOT_FOUND'
			? pass('cross-tenant NOT_FOUND')
			: fail('cross-tenant', resB1FromA);

		// -------------------------------------------------------------------
		// 8. Ashy activityReference (resolver → UUID, not LLM authority)
		// -------------------------------------------------------------------
		const ashyResolved = await resolveActivityReference(clientA, 'A1');
		const ashyOk = ashyResolved.status === 'RESOLVED'
			&& ashyResolved.activity.id === activityA1.id
			&& ashyResolved.activity.id !== 'A1'
			&& /^[0-9a-f-]{36}$/i.test(ashyResolved.activity.id);

		report.sections.ashyActivityReference = ashyOk
			? pass('activityReference A1 → UUID', { resolvedId: ashyResolved.activity.id })
			: fail('activityReference', ashyResolved);

		// -------------------------------------------------------------------
		// 9. Report isolation
		// -------------------------------------------------------------------
		const expenseA1 = await admin.from('depenses').insert({
			client_id: clientA,
			activity_id: activityA1.id,
			libelle_depense: `${TAG} dep A1`,
			type_depense: 'test',
			montant_depense: 500,
			date: new Date().toISOString(),
		}).select('id').single();
		const expenseA2 = await admin.from('depenses').insert({
			client_id: clientA,
			activity_id: activityA2.id,
			libelle_depense: `${TAG} dep A2`,
			type_depense: 'test',
			montant_depense: 1200,
			date: new Date().toISOString(),
		}).select('id').single();
		if (expenseA1.error) throw expenseA1.error;
		if (expenseA2.error) throw expenseA2.error;
		cleanupIds.expenseIds.push(expenseA1.data.id, expenseA2.data.id);

		const { rows: scopedExpenses } = await pgClient.query(
			`select activity_id, coalesce(sum(montant_depense), 0)::numeric as total
       from public.depenses
       where client_id = $1 and activity_id = any($2::uuid[])
       group by activity_id`,
			[clientA, [activityA1.id, activityA2.id]],
		);
		const repA1 = scopedExpenses.find((r) => r.activity_id === activityA1.id);
		const repA2 = scopedExpenses.find((r) => r.activity_id === activityA2.id);

		const { rows: leakRows } = await pgClient.query(
			`select count(*)::int as n from public.depenses
       where client_id = $1 and activity_id = $2 and libelle_depense like $3`,
			[clientA, activityA1.id, `%dep A2%`],
		);

		const reportOk = repA1 && repA2
			&& Number(repA1.total) !== Number(repA2.total)
			&& Number(repA1.total) >= 500
			&& Number(repA2.total) >= 1200
			&& leakRows[0]?.n === 0;

		report.sections.reports = reportOk
			? pass('report isolation (activity-scoped depenses)', {
				expensesA1: repA1.total,
				expensesA2: repA2.total,
			})
			: fail('report isolation', { repA1, repA2, leakRows });

		// -------------------------------------------------------------------
		// 10. Synthesis
		// -------------------------------------------------------------------
		const { rows: synRows } = await pgClient.query(
			`select activity_id, coalesce(sum(total_depenses), 0)::numeric as dep
       from public.synthese_mensuelle_by_activity
       where client_id = $1 and activity_id = any($2::uuid[])
       group by activity_id`,
			[clientA, [activityA1.id, activityA2.id]],
		);
		const synA1 = synRows.find((r) => r.activity_id === activityA1.id);
		const synA2 = synRows.find((r) => r.activity_id === activityA2.id);
		const synOk = synA1 && synA2 && Number(synA1.dep) !== Number(synA2.dep);

		report.sections.synthesis = synOk
			? pass('synthese_mensuelle_by_activity', { A1: synA1.dep, A2: synA2.dep })
			: fail('synthese_mensuelle_by_activity', { synA1, synA2, synRows });

		// -------------------------------------------------------------------
		// 11. Security
		// -------------------------------------------------------------------
		const security = [];

		try {
			assertActivityOwnership(userA1, activityA2.id);
			security.push(fail('A1→A2 ownership', 'expected ACTIVITY_OWNERSHIP_VIOLATION'));
		} catch (err) {
			security.push(err.code === 'ACTIVITY_OWNERSHIP_VIOLATION'
				? pass('A1→A2 ownership DENY')
				: fail('A1→A2 ownership', err.message));
		}

		try {
			await validateActivityForClient(clientA, activityB1.id);
			security.push(fail('A1→B1 validate', 'expected ACTIVITY_OWNERSHIP_VIOLATION'));
		} catch (err) {
			security.push(err.code === 'ACTIVITY_OWNERSHIP_VIOLATION'
				? pass('A1→B1 validate DENY')
				: fail('A1→B1 validate', err.message));
		}

		try {
			await validateActivityForClient(clientA, randomUUID());
			security.push(fail('foreign activity UUID', 'expected ACTIVITY_OWNERSHIP_VIOLATION'));
		} catch (err) {
			security.push(err.code === 'ACTIVITY_OWNERSHIP_VIOLATION'
				? pass('foreign activity UUID DENY')
				: fail('foreign activity UUID', err.message));
		}

		const defaultAct = await resolveDefaultActivity(clientA);
		security.push(defaultAct.id === activityA1.id
			? pass('no activity_id → default activity', { defaultId: defaultAct.id })
			: fail('default activity', defaultAct));

		report.sections.security = security.every((s) => s.status === 'PASS')
			? pass('security', security)
			: fail('security', security);

		// -------------------------------------------------------------------
		// 12. Idempotency regression (staging only)
		// -------------------------------------------------------------------
		const idemToken = randomUUID();
		const idemOpId = randomUUID();
		const pendingWrite = { tool: 'create_expense', label: `${TAG} idem`, amount: 77 };
		const requestHash = computeRequestHash(clientA, pendingWrite);
		const idemPending = await savePending(admin, clientA, activityA1.id, idemToken, pendingWrite);
		cleanupIds.sessionIds.push(idemPending.id);
		cleanupIds.operationIds.push(idemOpId);

		const rpc1 = await admin.rpc('confirm_and_create_expense', {
			p_client_id: clientA,
			p_activity_id: activityA1.id,
			p_expected_version: null,
			p_consume_token: idemToken,
			p_operation_id: idemOpId,
			p_request_hash: requestHash,
		});
		if (rpc1.error) throw rpc1.error;
		if (rpc1.data?.result_id) cleanupIds.expenseIds.push(rpc1.data.result_id);

		const rpc2 = await admin.rpc('confirm_and_create_expense', {
			p_client_id: clientA,
			p_activity_id: activityA1.id,
			p_expected_version: null,
			p_consume_token: idemToken,
			p_operation_id: idemOpId,
			p_request_hash: requestHash,
		});
		if (rpc2.error) throw rpc2.error;

		const rpc3 = await admin.rpc('confirm_and_create_expense', {
			p_client_id: clientA,
			p_activity_id: activityA1.id,
			p_expected_version: null,
			p_consume_token: idemToken,
			p_operation_id: idemOpId,
			p_request_hash: 'bad-hash-value',
		});
		if (rpc3.error) throw rpc3.error;

		const idemTokenA2 = randomUUID();
		const idemOpA2 = randomUUID();
		await savePending(admin, clientA, activityA2.id, idemTokenA2);
		const rpcCross = await admin.rpc('confirm_and_create_expense', {
			p_client_id: clientA,
			p_activity_id: activityA2.id,
			p_expected_version: null,
			p_consume_token: idemTokenA2,
			p_operation_id: idemOpId,
			p_request_hash: requestHash,
		});
		if (rpcCross.error) throw rpcCross.error;

		const { count: opCount } = await admin
			.from('agent_write_operations')
			.select('*', { count: 'exact', head: true })
			.eq('operation_id', idemOpId);

		const { count: expenseCount } = await admin
			.from('depenses')
			.select('*', { count: 'exact', head: true })
			.eq('client_id', clientA)
			.ilike('libelle_depense', `%${TAG} idem%`);

		const idemOk = rpc1.data?.status === 'COMMITTED'
			&& rpc2.data?.status === 'ALREADY_COMPLETED'
			&& rpc3.data?.status === 'REQUEST_HASH_MISMATCH'
			&& rpcCross.data?.status === 'ALREADY_COMPLETED'
			&& rpcCross.data?.result_id === rpc1.data?.result_id
			&& opCount === 1
			&& expenseCount === 1;

		report.sections.idempotency = idemOk
			? pass('idempotency', {
				first: rpc1.data?.status,
				replay: rpc2.data?.status,
				badHash: rpc3.data?.status,
				crossActivity: rpcCross.data?.status,
			})
			: fail('idempotency', { rpc1: rpc1.data, rpc2: rpc2.data, rpc3: rpc3.data, rpcCross: rpcCross.data, opCount });

		// -------------------------------------------------------------------
		// Aggregate resolver check (included in overall)
		// -------------------------------------------------------------------
		if (!resolverOk) {
			report.sections.activityResolver = fail('activity resolver overall', { resA1, resA2, resB1FromA, resAmbig });
		}

	} finally {
		// -------------------------------------------------------------------
		// 13. Cleanup
		// -------------------------------------------------------------------
		try {
			await cleanupFixtures(admin, pgClient, cleanupIds);
			report.sections.cleanup = pass('cleanup', { tag: TAG });
		} catch (err) {
			report.sections.cleanup = fail('cleanup', err.message);
		}
		await pgClient.end();
	}

	const allSections = Object.values(report.sections);
	const allPass = allSections.every((s) => {
		if (s.status) return s.status === 'PASS';
		return false;
	});
	report.verdict = allPass ? 'GO FOR P1-E.1 PRODUCTION' : 'NO-GO';

	console.log(JSON.stringify(report, null, 2));
	process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
