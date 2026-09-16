#!/usr/bin/env node
/**
 * Phase H3 — HTTP CONFIRMATION + F4-B2 real financial write (vwjkktqcmmhotadicbpg only).
 *
 *   node --env-file=apps/api/.env.staging tools/_ashy_v2_phase_h3_staging_gate.mjs
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const STAGING_REF = 'vwjkktqcmmhotadicbpg';
const PRODUCTION_REF = 'knrwplidgvuvjnuqqmrt';
const TAG = `phase-h3-${Date.now()}`;

process.env.ASHY_INTELLIGENCE_V2 = 'true';
process.env.ASHY_INTELLIGENCE_V2_HTTP = 'true';
process.env.ASHY_INTELLIGENCE_V2_ACTIONS = 'true';
process.env.ASHY_INTELLIGENCE_V2_HTTP_CONFIRM = 'true';
process.env.ASHY_INTELLIGENCE_V2_SHADOW = 'false';
process.env.AGENT_SESSION_TRANSACTIONAL_CONFIRM = 'true';
process.env.AGENT_SESSION_IDEMPOTENT_CONFIRM = 'true';
process.env.AGENT_SESSION_WRITE_DB_FIRST = 'true';
process.env.AGENT_SESSION_PENDING_DB_REQUIRED = 'true';

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
	const email = `${TAG}-${label}-${randomUUID()}@phaseh3.ashledger.test`;
	const password = `H3!${randomUUID().slice(0, 8)}`;
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

async function seedProductAndStock(admin, clientId, activityId) {
	const { data: produit, error: pErr } = await admin
		.from('produits')
		.insert({
			client_id: clientId,
			activity_id: activityId,
			nom_produit: 'poulet',
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
		nom_article: 'poulet',
		entrees: 50,
		sorties: 0,
		seuil_alerte: 5,
	});
	if (sErr) throw sErr;
	return produit.id;
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

async function getWriteOperation(admin, operationId) {
	const { data, error } = await admin
		.from('agent_write_operations')
		.select('*')
		.eq('operation_id', operationId)
		.maybeSingle();
	if (error) throw error;
	return data;
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

function replyHasNoSecrets(reply) {
	const text = String(reply || '');
	return !text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
		&& !text.includes('request_hash')
		&& !text.includes('consumeToken')
		&& !text.includes('state_version');
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
		notSimulated: ['post-commit HTTP network loss'],
		verdict: 'NO-GO',
	};

	const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
		auth: { persistSession: false, autoRefreshToken: false },
	});

	const cleanup = { authUserIds: [], clientIds: [], activityIds: [], operationIds: [] };

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

		await seedProductAndStock(admin, clientA, activityA1);

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

		const app = express();
		app.use(express.json());
		app.post('/api/ashy/chat', (req, res, next) => {
			const tu = req.headers['x-test-user'];
			req.user = tu === 'A2' ? userA2 : tu === 'B1' ? userB1 : userA1;
			next();
		}, resolveActivityScope, rejectForeignScope, ashyChat);

		const server = await new Promise((resolve, reject) => {
			const s = http.createServer(app);
			s.listen(0, '127.0.0.1', () => resolve(s));
			s.on('error', reject);
		});
		const baseUrl = `http://127.0.0.1:${server.address().port}`;

		// --- CREATE_EXPENSE E2E ---
		const depBaseline = await countRows(admin, 'depenses', clientA, activityA1);
		const expSession = `${TAG}-exp-e2e`;

		const expProposal = await postChat(baseUrl, {
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			sessionId: expSession,
			activityId: activityA1,
		});
		const pendingExp = await fetchPendingSession(admin, clientA, activityA1);
		const depAfterProposal = await countRows(admin, 'depenses', clientA, activityA1);
		const opIdExp = pendingExp?.pending?.operationId;
		if (opIdExp) cleanup.operationIds.push(opIdExp);

		const expConfirm = await postChat(baseUrl, {
			message: 'Oui',
			sessionId: expSession,
			activityId: activityA1,
		});
		const depAfterConfirm = await countRows(admin, 'depenses', clientA, activityA1);
		const opExp = opIdExp ? await getWriteOperation(admin, opIdExp) : null;
		const pendingAfterExp = await fetchPendingSession(admin, clientA, activityA1);

		report.scenarios.expenseE2E = expProposal.status === 200
			&& expProposal.body?.v2Http?.actionProposalStatus === 'READY_FOR_CONFIRMATION'
			&& depAfterProposal === depBaseline
			&& expConfirm.status === 200
			&& (expConfirm.body?.v2Http?.actionProposalStatus === 'COMPLETED'
				|| expConfirm.body?.v2Http?.f4Committed === true)
			&& depAfterConfirm === depBaseline + 1
			&& opExp?.status === 'completed'
			&& opExp?.result_id
			&& opExp?.completed_at
			? pass('CREATE_EXPENSE E2E', {
				httpStatus: expConfirm.status,
				reply: expConfirm.body?.reply?.slice(0, 80),
				operationId: opIdExp,
				depBefore: depBaseline,
				depAfter: depAfterConfirm,
				opStatus: opExp?.status,
			})
			: fail('CREATE_EXPENSE E2E', {
				expProposal: expProposal.body?.v2Http,
				expConfirm: expConfirm.body?.v2Http,
				depBaseline,
				depAfterProposal,
				depAfterConfirm,
				opExp,
			});

		// --- DOUBLE CONFIRMATION ---
		const doubleConfirm = await postChat(baseUrl, {
			message: 'Oui',
			sessionId: expSession,
			activityId: activityA1,
		});
		const depAfterDouble = await countRows(admin, 'depenses', clientA, activityA1);

		report.scenarios.doubleConfirm = doubleConfirm.status === 200
			&& (doubleConfirm.body?.v2Http?.actionProposalStatus === 'ALREADY_COMPLETED'
				|| doubleConfirm.body?.v2Http?.actionProposalStatus === 'NO_PENDING_TO_CONFIRM'
				|| doubleConfirm.body?.v2Http?.f4Replay === true)
			&& depAfterDouble === depBaseline + 1
			? pass('double confirmation no double write', {
				status: doubleConfirm.body?.v2Http?.actionProposalStatus,
				depAfterDouble,
			})
			: fail('double confirmation', { doubleConfirm: doubleConfirm.body?.v2Http, depAfterDouble });

		// --- CREATE_SALE E2E ---
		const saleBaseline = await countRows(admin, 'ventes', clientA, activityA1);
		const saleSession = `${TAG}-sale-e2e`;

		const saleProposal = await postChat(baseUrl, {
			message: "J'ai vendu 2 poulets à 10 dollars",
			sessionId: saleSession,
			activityId: activityA1,
		});
		const pendingSale = await fetchPendingSession(admin, clientA, activityA1);
		const saleAfterProposal = await countRows(admin, 'ventes', clientA, activityA1);
		const opIdSale = pendingSale?.pending?.operationId;
		if (opIdSale) cleanup.operationIds.push(opIdSale);

		const saleConfirm = await postChat(baseUrl, {
			message: 'Oui',
			sessionId: saleSession,
			activityId: activityA1,
		});
		const saleAfterConfirm = await countRows(admin, 'ventes', clientA, activityA1);
		const opSale = opIdSale ? await getWriteOperation(admin, opIdSale) : null;

		report.scenarios.saleE2E = saleProposal.status === 200
			&& saleProposal.body?.v2Http?.actionProposalStatus === 'READY_FOR_CONFIRMATION'
			&& saleAfterProposal === saleBaseline
			&& saleConfirm.status === 200
			&& saleConfirm.body?.v2Http?.f4Committed === true
			&& saleAfterConfirm === saleBaseline + 1
			&& opSale?.status === 'completed'
			? pass('CREATE_SALE E2E', {
				saleBefore: saleBaseline,
				saleAfter: saleAfterConfirm,
				opStatus: opSale?.status,
			})
			: fail('CREATE_SALE E2E', {
				saleProposal: saleProposal.body?.v2Http,
				saleConfirm: saleConfirm.body?.v2Http,
				saleBaseline,
				saleAfterConfirm,
				opSale,
			});

		// --- MODIFICATION 25 → 30 ---
		const modSession = `${TAG}-mod`;
		await postChat(baseUrl, {
			message: 'Ajoute une dépense de 25 dollars pour le transport',
			sessionId: modSession,
			activityId: activityA1,
		});
		await postChat(baseUrl, {
			message: 'Finalement 30 dollars',
			sessionId: modSession,
			activityId: activityA1,
		});
		const depBeforeMod = await countRows(admin, 'depenses', clientA, activityA1);
		const pendingMod = await fetchPendingSession(admin, clientA, activityA1);
		if (pendingMod?.pending?.operationId) cleanup.operationIds.push(pendingMod.pending.operationId);
		const modConfirm = await postChat(baseUrl, {
			message: 'Oui',
			sessionId: modSession,
			activityId: activityA1,
		});
		const depAfterMod = await countRows(admin, 'depenses', clientA, activityA1);

		report.scenarios.modification = pendingMod?.pending?.pendingWrite?.amount === 30
			&& modConfirm.body?.v2Http?.f4Committed === true
			&& depAfterMod === depBeforeMod + 1
			? pass('modification before confirm', { amount: pendingMod?.pending?.pendingWrite?.amount, depAfterMod })
			: fail('modification', { pendingMod, modConfirm: modConfirm.body?.v2Http, depBeforeMod, depAfterMod });

		// --- CLARIFICATION ---
		const clarSession = `${TAG}-clar`;
		const clar1 = await postChat(baseUrl, {
			message: 'Ajoute une dépense pour le transport',
			sessionId: clarSession,
			activityId: activityA1,
		});
		const clar2 = await postChat(baseUrl, {
			message: '30 dollars',
			sessionId: clarSession,
			activityId: activityA1,
		});
		const depBeforeClar = await countRows(admin, 'depenses', clientA, activityA1);
		const pendingClar = await fetchPendingSession(admin, clientA, activityA1);
		if (pendingClar?.pending?.operationId) cleanup.operationIds.push(pendingClar.pending.operationId);
		const clarConfirm = await postChat(baseUrl, {
			message: 'Oui',
			sessionId: clarSession,
			activityId: activityA1,
		});
		const depAfterClar = await countRows(admin, 'depenses', clientA, activityA1);

		report.scenarios.clarification = clar1.body?.v2Http?.actionProposalStatus === 'NEEDS_CLARIFICATION'
			&& clar2.body?.v2Http?.actionProposalStatus === 'READY_FOR_CONFIRMATION'
			&& clarConfirm.body?.v2Http?.f4Committed === true
			&& depAfterClar === depBeforeClar + 1
			? pass('clarification → confirm', { depAfterClar })
			: fail('clarification', { clar1: clar1.body?.v2Http, clar2: clar2.body?.v2Http, clarConfirm: clarConfirm.body?.v2Http });

		// --- CROSS ACTIVITY ---
		const crossSession = `${TAG}-cross-act`;
		await postChat(baseUrl, {
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			sessionId: crossSession,
			activityId: activityA1,
		});
		const depBeforeCross = await countRows(admin, 'depenses', clientA, activityA2);
		const crossConfirm = await postChat(baseUrl, {
			message: 'Oui',
			sessionId: crossSession,
			activityId: activityA2,
			testUser: 'A2',
		});
		const depAfterCross = await countRows(admin, 'depenses', clientA, activityA2);

		report.scenarios.crossActivity = crossConfirm.body?.v2Http?.actionProposalStatus === 'NO_PENDING_TO_CONFIRM'
			&& depAfterCross === depBeforeCross
			? pass('cross activity blocked', { status: crossConfirm.body?.v2Http?.actionProposalStatus })
			: fail('cross activity', { crossConfirm: crossConfirm.body?.v2Http, depBeforeCross, depAfterCross });

		// --- CROSS TENANT ---
		const tenantSession = `${TAG}-cross-tenant`;
		await postChat(baseUrl, {
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			sessionId: tenantSession,
			activityId: activityA1,
		});
		const depBeforeTenant = await countRows(admin, 'depenses', clientB, activityB1);
		const tenantConfirm = await postChat(baseUrl, {
			message: 'Oui',
			sessionId: tenantSession,
			activityId: activityB1,
			testUser: 'B1',
		});
		const depAfterTenant = await countRows(admin, 'depenses', clientB, activityB1);
		const pendingTenantIntact = await fetchPendingSession(admin, clientA, activityA1);

		report.scenarios.crossTenant = tenantConfirm.body?.v2Http?.actionProposalStatus === 'NO_PENDING_TO_CONFIRM'
			&& depAfterTenant === depBeforeTenant
			&& pendingTenantIntact?.pending?.pendingWrite
			? pass('cross tenant blocked, pending intact', { status: tenantConfirm.body?.v2Http?.actionProposalStatus })
			: fail('cross tenant', { tenantConfirm: tenantConfirm.body?.v2Http, depBeforeTenant, depAfterTenant });

		// --- CONCURRENT CONFIRM ---
		const concSession = `${TAG}-conc`;
		await postChat(baseUrl, {
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			sessionId: concSession,
			activityId: activityA1,
		});
		const depBeforeConc = await countRows(admin, 'depenses', clientA, activityA1);
		const pendingConc = await fetchPendingSession(admin, clientA, activityA1);
		if (pendingConc?.pending?.operationId) cleanup.operationIds.push(pendingConc.pending.operationId);

		const [concA, concB] = await Promise.all([
			postChat(baseUrl, { message: 'Oui', sessionId: concSession, activityId: activityA1 }),
			postChat(baseUrl, { message: 'Oui', sessionId: concSession, activityId: activityA1 }),
		]);
		const depAfterConc = await countRows(admin, 'depenses', clientA, activityA1);
		const concStatuses = [concA, concB].map((r) => r.body?.v2Http?.actionProposalStatus);

		report.scenarios.concurrent = depAfterConc === depBeforeConc + 1
			&& (concStatuses.includes('COMPLETED') || concStatuses.includes('ALREADY_COMPLETED'))
			? pass('concurrent confirm single write', { depBeforeConc, depAfterConc, concStatuses })
			: fail('concurrent confirm', { depBeforeConc, depAfterConc, concA: concA.body?.v2Http, concB: concB.body?.v2Http });

		// --- NO SECRET LEAK ---
		report.scenarios.noLeak = replyHasNoSecrets(expConfirm.body?.reply)
			&& replyHasNoSecrets(saleConfirm.body?.reply)
			? pass('no internal IDs in user reply')
			: fail('secret leak', { expReply: expConfirm.body?.reply?.slice(0, 120) });

		// --- PENDING FIELDS AT PROPOSAL ---
		report.scenarios.pendingFields = pendingExp?.pending?.operationId
			&& pendingExp?.pending?.consumeToken
			&& pendingExp?.stateVersion != null
			&& pendingExp?.pending?.pendingWrite
			? pass('pending fields at proposal', {
				hasOperationId: true,
				hasConsumeToken: true,
				stateVersion: pendingExp.stateVersion,
			})
			: fail('pending fields', pendingExp);

		server.close();

		const allPass = Object.values(report.scenarios).every((s) => s.status === 'PASS');
		report.verdict = allPass ? 'GO — Phase H3 HTTP CONFIRM + F4-B2 validated' : 'NO-GO — Phase H3 staging failures';
	} finally {
		for (const opId of cleanup.operationIds) {
			await admin.from('agent_write_operations').delete().eq('operation_id', opId);
		}
		for (const clientId of cleanup.clientIds) {
			await admin.from('chat_messages').delete().eq('client_id', clientId);
			await admin.from('agent_sessions').delete().eq('client_id', clientId);
			await admin.from('agent_write_operations').delete().eq('client_id', clientId);
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
