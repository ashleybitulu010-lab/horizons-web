#!/usr/bin/env node
/**
 * Phase H1 — HTTP READ staging gate (vwjkktqcmmhotadicbpg only).
 *
 *   node --env-file=apps/api/.env.staging tools/_ashy_v2_phase_h1_staging_gate.mjs
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const STAGING_REF = 'vwjkktqcmmhotadicbpg';
const PRODUCTION_REF = 'knrwplidgvuvjnuqqmrt';
const TAG = `phase-h1-${Date.now()}`;

process.env.ASHY_INTELLIGENCE_V2 = 'true';
process.env.ASHY_INTELLIGENCE_V2_HTTP = 'true';
process.env.ASHY_INTELLIGENCE_V2_ACTIONS = 'false';
process.env.ASHY_INTELLIGENCE_V2_SHADOW = 'false';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function pass(name, detail = null) {
	return { name, status: 'PASS', detail };
}

function fail(name, detail) {
	return { name, status: 'FAIL', detail };
}

function assertStagingOnly() {
	const match = SUPABASE_URL.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
	const ref = match ? match[1].toLowerCase() : null;
	if (ref === PRODUCTION_REF) throw new Error('Production blocked');
	if (ref !== STAGING_REF) throw new Error(`Expected staging ${STAGING_REF}, got ${ref || SUPABASE_URL}`);
	if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY required');
	if (process.env.RUN_STAGING !== 'true') throw new Error('RUN_STAGING must be true');
}

async function createAuthUser(admin, label) {
	const email = `${TAG}-${label}-${randomUUID()}@phaseh1.ashledger.test`;
	const password = `H1!${randomUUID().slice(0, 8)}`;
	const { data, error } = await admin.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
	});
	if (error) throw error;
	return data.user.id;
}

async function createClientRow(admin, authUserId, label) {
	const userId = `${TAG}-${label}-${randomUUID()}`;
	const { data, error } = await admin
		.from('clients')
		.insert({ user_id: userId, nom_client: `${TAG} ${label}`, auth_user_id: authUserId })
		.select('id')
		.single();
	if (error) throw error;
	return data.id;
}

async function createActivity(admin, clientId, name, isDefault = false) {
	const { data, error } = await admin
		.from('activities')
		.insert({ client_id: clientId, name, type: 'commerce', is_default: isDefault })
		.select('id')
		.single();
	if (error) throw error;
	return data.id;
}

async function countRows(admin, table, clientId, activityId = null) {
	let q = admin.from(table).select('id', { count: 'exact', head: true }).eq('client_id', clientId);
	if (activityId) q = q.eq('activity_id', activityId);
	const { count, error } = await q;
	if (error) throw error;
	return count ?? 0;
}

async function mountHttpServer({ ashyChat, resolveActivityScope, rejectForeignScope }) {
	const app = express();
	app.use(express.json());
	return { app, listen: () => new Promise((resolve, reject) => {
		const server = http.createServer(app);
		server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
		server.on('error', reject);
	}) };
}

async function postChat(baseUrl, { user, message, sessionId, activityId = null }) {
	const headers = { 'Content-Type': 'application/json' };
	if (activityId) headers['X-Activity-Id'] = activityId;
	const res = await fetch(`${baseUrl}/api/ashy/chat`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ message, sessionId: sessionId || TAG }),
	});
	const body = await res.json().catch(() => ({}));
	return { status: res.status, body };
}

async function main() {
	assertStagingOnly();

	const report = {
		tag: TAG,
		target: STAGING_REF,
		config: {
			V2: process.env.ASHY_INTELLIGENCE_V2,
			V2_HTTP: process.env.ASHY_INTELLIGENCE_V2_HTTP,
			V2_ACTIONS: process.env.ASHY_INTELLIGENCE_V2_ACTIONS,
			V2_SHADOW: process.env.ASHY_INTELLIGENCE_V2_SHADOW,
		},
		scenarios: {},
		verdict: 'NO-GO',
	};

	const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
		auth: { persistSession: false, autoRefreshToken: false },
	});

	const cleanup = {
		authUserIds: [],
		clientIds: [],
		activityIds: [],
	};

	try {
		const { default: ashyChat } = await import('../apps/api/src/routes/api/ashy-chat.js');
		const { resolveActivityScope } = await import('../apps/api/src/middleware/activity-scope.js');
		const { rejectForeignScope } = await import('../apps/api/src/middleware/auth.js');

		const authA = await createAuthUser(admin, 'client-a');
		const authB = await createAuthUser(admin, 'client-b');
		cleanup.authUserIds.push(authA, authB);

		const clientA = await createClientRow(admin, authA, 'client-a');
		const clientB = await createClientRow(admin, authB, 'client-b');
		cleanup.clientIds.push(clientA, clientB);

		const activityA1 = await createActivity(admin, clientA, 'A1', true);
		const activityA2 = await createActivity(admin, clientA, 'A2', false);
		const activityB1 = await createActivity(admin, clientB, 'B1', true);
		cleanup.activityIds.push(activityA1, activityA2, activityB1);

		await admin.from('produits').insert({
			client_id: clientA,
			activity_id: activityA1,
			nom_produit: `${TAG}-poulet`,
			prix_vente_unitaire: 10,
			prix_achat_unitaire: 5,
		});
		await admin.from('stocks').insert({
			client_id: clientA,
			activity_id: activityA1,
			nom_article: `${TAG}-poulet`,
			entrees: 20,
			sorties: 0,
			seuil_alerte: 5,
		});

		const userA1 = {
			id: authA,
			clientId: clientA,
			activeActivityId: activityA1,
			businessUserId: `${TAG}-a1`,
		};
		const userA2 = { ...userA1, activeActivityId: activityA2, businessUserId: `${TAG}-a2` };
		const userB1 = {
			id: authB,
			clientId: clientB,
			activeActivityId: activityB1,
			businessUserId: `${TAG}-b1`,
		};

		const { app, listen } = await mountHttpServer({ ashyChat, resolveActivityScope, rejectForeignScope });
		app.post('/api/ashy/chat', (req, res, next) => {
			req.user = req.headers['x-test-user'] === 'A2' ? userA2 : req.headers['x-test-user'] === 'B1' ? userB1 : userA1;
			next();
		}, resolveActivityScope, rejectForeignScope, ashyChat);

		const { server, port } = await listen();
		const baseUrl = `http://127.0.0.1:${port}`;

		const depBefore = await countRows(admin, 'depenses', clientA, activityA1);
		const saleBefore = await countRows(admin, 'ventes', clientA, activityA1);

		const readSales = await postChat(baseUrl, {
			user: userA1,
			message: 'Combien ai-je vendu ce mois-ci ?',
			sessionId: `${TAG}-read`,
			activityId: activityA1,
		});

		const readExpenses = await postChat(baseUrl, {
			user: userA1,
			message: 'Combien ai-je dépensé ce mois-ci ?',
			sessionId: `${TAG}-read-exp`,
			activityId: activityA1,
		});

		const context1 = await postChat(baseUrl, {
			user: userA1,
			message: 'Combien ai-je vendu ce mois-ci ?',
			sessionId: `${TAG}-ctx`,
			activityId: activityA1,
		});
		const context2 = await postChat(baseUrl, {
			user: userA1,
			message: 'Et le mois dernier ?',
			sessionId: `${TAG}-ctx`,
			activityId: activityA1,
		});

		const actionBlock = await postChat(baseUrl, {
			user: userA1,
			message: "J'ai dépensé 25 $ pour le transport",
			sessionId: `${TAG}-action`,
			activityId: activityA1,
		});

		const depAfterAction = await countRows(admin, 'depenses', clientA, activityA1);
		const saleAfterAction = await countRows(admin, 'ventes', clientA, activityA1);

		const foreignActivity = await fetch(`${baseUrl}/api/ashy/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Activity-Id': activityB1,
				'X-Test-User': 'A2',
			},
			body: JSON.stringify({ message: 'Combien ai-je vendu ?', sessionId: `${TAG}-foreign` }),
		});

		const readA2 = await fetch(`${baseUrl}/api/ashy/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Activity-Id': activityA2,
				'X-Test-User': 'A2',
			},
			body: JSON.stringify({ message: 'Combien ai-je dépensé ce mois-ci ?', sessionId: `${TAG}-a2` }),
		});
		const bodyA2 = await readA2.json();

		const { count: msgCount } = await admin
			.from('chat_messages')
			.select('id', { count: 'exact', head: true })
			.eq('client_id', clientA)
			.eq('activity_id', activityA1);

		report.scenarios.readSales = readSales.status === 200 && readSales.body?.v2Http?.handled
			? pass('read sales HTTP', { status: readSales.status, goalType: readSales.body?.v2Http?.goalType })
			: fail('read sales HTTP', readSales);

		report.scenarios.readExpenses = readExpenses.status === 200 && readExpenses.body?.v2Http?.handled
			? pass('read expenses HTTP', { status: readExpenses.status })
			: fail('read expenses HTTP', readExpenses);

		report.scenarios.context = context1.status === 200 && context2.status === 200
			? pass('multi-turn context', { first: context1.body?.v2Http?.goalType, second: context2.body?.conversation?.filters?.period })
			: fail('multi-turn context', { context1, context2 });

		report.scenarios.writeBlock = actionBlock.status === 200
			&& actionBlock.body?.v2Http?.goalType === 'ACTION'
			&& depAfterAction === depBefore
			&& saleAfterAction === saleBefore
			? pass('action blocked — no financial write', { depBefore, depAfterAction, reply: actionBlock.body?.reply?.slice(0, 80) })
			: fail('action blocked', { actionBlock, depBefore, depAfterAction, saleBefore, saleAfterAction });

		report.scenarios.foreignActivity = foreignActivity.status === 403
			? pass('foreign activity 403', { status: foreignActivity.status })
			: fail('foreign activity 403', { status: foreignActivity.status });

		report.scenarios.activityA2 = readA2.status === 200 && bodyA2?.v2Http?.handled
			? pass('activity A2 read', { status: readA2.status })
			: fail('activity A2 read', { status: readA2.status, body: bodyA2 });

		report.scenarios.persistence = msgCount >= 2
			? pass('chat_messages persistence', { msgCount })
			: fail('chat_messages persistence', { msgCount });

		server.close();

		const allPass = Object.values(report.scenarios).every((s) => s.status === 'PASS');
		report.verdict = allPass ? 'GO — Phase H1 HTTP READ validated' : 'NO-GO — Phase H1 staging failures';
	} finally {
		for (const clientId of cleanup.clientIds) {
			await admin.from('chat_messages').delete().eq('client_id', clientId);
			await admin.from('agent_sessions').delete().eq('client_id', clientId);
			await admin.from('depenses').delete().eq('client_id', clientId);
			await admin.from('ventes').delete().eq('client_id', clientId);
			await admin.from('stocks').delete().eq('client_id', clientId);
			await admin.from('produits').delete().eq('client_id', clientId);
			await admin.from('activities').delete().eq('client_id', clientId);
			await admin.from('clients').delete().eq('id', clientId);
		}
		for (const uid of cleanup.authUserIds) {
			await admin.auth.admin.deleteUser(uid);
		}
	}

	console.log(JSON.stringify(report, null, 2));
	process.exit(report.verdict.startsWith('GO') ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
