#!/usr/bin/env node
/**
 * Phase H2 — HTTP ACTION PROPOSAL staging gate (vwjkktqcmmhotadicbpg only).
 *
 *   node --env-file=apps/api/.env.staging tools/_ashy_v2_phase_h2_staging_gate.mjs
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const STAGING_REF = 'vwjkktqcmmhotadicbpg';
const PRODUCTION_REF = 'knrwplidgvuvjnuqqmrt';
const TAG = `phase-h2-${Date.now()}`;

process.env.ASHY_INTELLIGENCE_V2 = 'true';
process.env.ASHY_INTELLIGENCE_V2_HTTP = 'true';
process.env.ASHY_INTELLIGENCE_V2_ACTIONS = 'true';
process.env.ASHY_INTELLIGENCE_V2_HTTP_CONFIRM = 'false';
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
	const email = `${TAG}-${label}-${randomUUID()}@phaseh2.ashledger.test`;
	const password = `H2!${randomUUID().slice(0, 8)}`;
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

async function fetchPendingSession(admin, clientId, activityId) {
	const { data, error } = await admin
		.from('agent_sessions')
		.select('payload, state_version, state_type, updated_at')
		.eq('client_id', clientId)
		.eq('activity_id', activityId)
		.eq('state_type', 'pending')
		.maybeSingle();
	if (error) throw error;
	return {
		pending: data?.payload ?? null,
		stateVersion: data?.state_version ?? null,
	};
}

async function postChat(baseUrl, { message, sessionId, activityId = null, testUser = null }) {
	const headers = { 'Content-Type': 'application/json' };
	if (activityId) headers['X-Activity-Id'] = activityId;
	if (testUser) headers['X-Test-User'] = testUser;
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
			V2_HTTP_CONFIRM: process.env.ASHY_INTELLIGENCE_V2_HTTP_CONFIRM,
			V2_SHADOW: process.env.ASHY_INTELLIGENCE_V2_SHADOW,
		},
		scenarios: {},
		verdict: 'NO-GO',
	};

	const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
		auth: { persistSession: false, autoRefreshToken: false },
	});

	const cleanup = { authUserIds: [], clientIds: [], activityIds: [] };

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

		const userA1 = {
			id: authA,
			clientId: clientA,
			activeActivityId: activityA1,
			businessUserId: `${TAG}-a1`,
		};
		const userA2 = { ...userA1, activeActivityId: activityA2, businessUserId: `${TAG}-a2` };

		const app = express();
		app.use(express.json());
		app.post('/api/ashy/chat', (req, res, next) => {
			req.user = req.headers['x-test-user'] === 'A2' ? userA2 : userA1;
			next();
		}, resolveActivityScope, rejectForeignScope, ashyChat);

		const server = await new Promise((resolve, reject) => {
			const s = http.createServer(app);
			s.listen(0, '127.0.0.1', () => resolve(s));
			s.on('error', reject);
		});
		const baseUrl = `http://127.0.0.1:${server.address().port}`;

		const depBefore = await countRows(admin, 'depenses', clientA, activityA1);
		const saleBefore = await countRows(admin, 'ventes', clientA, activityA1);

		const expenseProposal = await postChat(baseUrl, {
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			sessionId: `${TAG}-exp`,
			activityId: activityA1,
		});

		const sessionAfterProposal = await fetchPendingSession(admin, clientA, activityA1);
		const pendingAfterProposal = sessionAfterProposal?.pending || null;

		const saleProposal = await postChat(baseUrl, {
			message: "J'ai vendu 2 poulets à 10 dollars",
			sessionId: `${TAG}-sale`,
			activityId: activityA1,
		});

		const clarify1 = await postChat(baseUrl, {
			message: 'Ajoute une dépense pour le transport',
			sessionId: `${TAG}-clarify`,
			activityId: activityA1,
		});
		const clarify2 = await postChat(baseUrl, {
			message: '30 dollars',
			sessionId: `${TAG}-clarify`,
			activityId: activityA1,
		});

		const mod1 = await postChat(baseUrl, {
			message: 'Ajoute une dépense de 25 dollars pour le transport',
			sessionId: `${TAG}-mod`,
			activityId: activityA1,
		});
		await postChat(baseUrl, {
			message: 'Finalement 30 dollars',
			sessionId: `${TAG}-mod`,
			activityId: activityA1,
		});
		const sessionAfterMod = await fetchPendingSession(admin, clientA, activityA1);

		const confirmFlow = await postChat(baseUrl, {
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			sessionId: `${TAG}-confirm`,
			activityId: activityA1,
		});
		const confirmReply = await postChat(baseUrl, {
			message: 'Oui',
			sessionId: `${TAG}-confirm`,
			activityId: activityA1,
		});

		const depAfter = await countRows(admin, 'depenses', clientA, activityA1);
		const saleAfter = await countRows(admin, 'ventes', clientA, activityA1);

		const crossActivityConfirm = await postChat(baseUrl, {
			message: 'Oui',
			sessionId: `${TAG}-exp`,
			activityId: activityA2,
			testUser: 'A2',
		});

		report.scenarios.expenseProposal = expenseProposal.status === 200
			&& expenseProposal.body?.v2Http?.actionProposalStatus === 'READY_FOR_CONFIRMATION'
			&& pendingAfterProposal?.pendingWrite?.tool === 'create_expense'
			&& pendingAfterProposal?.pendingWrite?.amount === 30
			&& pendingAfterProposal?.operationId
			&& pendingAfterProposal?.consumeToken
			? pass('expense proposal + pending DB', {
				status: expenseProposal.status,
				amount: pendingAfterProposal?.pendingWrite?.amount,
				hasOperationId: Boolean(pendingAfterProposal?.operationId),
			})
			: fail('expense proposal', { expenseProposal, pendingAfterProposal });

		report.scenarios.saleProposal = saleProposal.status === 200
			&& saleProposal.body?.v2Http?.actionProposalStatus === 'READY_FOR_CONFIRMATION'
			? pass('sale proposal HTTP', { status: saleProposal.status })
			: fail('sale proposal', saleProposal);

		report.scenarios.clarification = clarify1.status === 200
			&& clarify2.status === 200
			&& clarify2.body?.v2Http?.actionProposalStatus === 'READY_FOR_CONFIRMATION'
			? pass('clarification flow', {
				first: clarify1.body?.v2Http?.actionProposalStatus,
				second: clarify2.body?.v2Http?.actionProposalStatus,
			})
			: fail('clarification flow', { clarify1, clarify2 });

		report.scenarios.modification = mod1.status === 200
			&& sessionAfterMod?.pending?.pendingWrite?.amount === 30
			? pass('modification pending amount', { amount: sessionAfterMod?.pending?.pendingWrite?.amount })
			: fail('modification', { mod1, pending: sessionAfterMod?.pending });

		report.scenarios.noWrite = depAfter === depBefore && saleAfter === saleBefore
			? pass('no financial writes', { depBefore, depAfter, saleBefore, saleAfter })
			: fail('financial write detected', { depBefore, depAfter, saleBefore, saleAfter });

		report.scenarios.confirmH2 = confirmFlow.status === 200
			&& confirmReply.status === 200
			&& confirmReply.body?.v2Http?.actionProposalStatus === 'CONFIRMED'
			? pass('confirmation without F4-B2', { status: confirmReply.body?.v2Http?.actionProposalStatus })
			: fail('confirmation H2', { confirmFlow, confirmReply });

		report.scenarios.crossActivity = crossActivityConfirm.status === 200
			&& crossActivityConfirm.body?.v2Http?.actionProposalStatus === 'NO_PENDING_TO_CONFIRM'
			? pass('cross activity confirm blocked', { status: crossActivityConfirm.body?.v2Http?.actionProposalStatus })
			: fail('cross activity', crossActivityConfirm);

		server.close();

		const allPass = Object.values(report.scenarios).every((s) => s.status === 'PASS');
		report.verdict = allPass ? 'GO — Phase H2 HTTP ACTION PROPOSAL validated' : 'NO-GO — Phase H2 staging failures';
	} finally {
		for (const clientId of cleanup.clientIds) {
			await admin.from('chat_messages').delete().eq('client_id', clientId);
			await admin.from('agent_sessions').delete().eq('client_id', clientId);
			await admin.from('depenses').delete().eq('client_id', clientId);
			await admin.from('ventes').delete().eq('client_id', clientId);
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
