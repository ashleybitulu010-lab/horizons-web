#!/usr/bin/env node
/**
 * H10.2 — Staging operational write gate (vwjkktqcmmhotadicbpg only).
 * Extends H9.3-A with H10.1 clarification, reject, modification, multi-turn,
 * independent sessions, and HTTP-level concurrency checks.
 *
 *   RUN_STAGING=true node --env-file=apps/api/.env.staging tools/_h102_staging_write_gate.mjs
 */
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import {
	buildCanonicalOperationPayload,
	canonicalJsonStringify,
} from '../apps/api/src/lib/agent-operation-idempotency.js';

const STAGING_REF = 'vwjkktqcmmhotadicbpg';
const PRODUCTION_REF = 'knrwplidgvuvjnuqqmrt';
const TAG = `h102-${Date.now()}`;

process.env.ASHY_INTELLIGENCE_V2 = 'true';
process.env.ASHY_INTELLIGENCE_V2_HTTP = 'true';
process.env.ASHY_INTELLIGENCE_V2_PRIMARY = 'true';
process.env.ASHY_V2_PRIMARY_SAFE_FALLBACK = 'true';
process.env.ASHY_V2_CUTOVER_MODE = 'V2_PRIMARY_SAFE_FALLBACK';
process.env.ASHY_INTELLIGENCE_V2_ACTIONS = 'true';
process.env.ASHY_INTELLIGENCE_V2_HTTP_CONFIRM = 'true';
process.env.ASHY_INTELLIGENCE_V2_SHADOW = 'false';
process.env.AGENT_SESSION_TRANSACTIONAL_CONFIRM = 'true';
process.env.AGENT_SESSION_IDEMPOTENT_CONFIRM = 'true';
process.env.AGENT_SESSION_WRITE_DB_FIRST = 'true';
process.env.AGENT_SESSION_PENDING_DB_REQUIRED = 'true';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Documented from create_sale_atomic migration (sorties += quantity on confirm). */
const CREATE_SALE_ATOMIC_BEHAVIOR = {
	rpc: 'create_sale_atomic',
	stockEffect: 'increments stocks.sorties by sale quantity when stock row exists and disponible >= quantity',
	verifiedBy: 'getStockSorties before/after sale confirm',
};

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

function hashPending(clientId, pendingWrite) {
	const payload = buildCanonicalOperationPayload(clientId, pendingWrite);
	return createHash('sha256').update(canonicalJsonStringify(payload)).digest('hex');
}

async function createAuthUser(admin, label) {
	const email = `${TAG}-${label}-${randomUUID()}@h102.ashledger.test`;
	const { data, error } = await admin.auth.admin.createUser({
		email,
		password: `H102!${randomUUID().slice(0, 8)}`,
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

async function seedProductAndStock(admin, clientId, activityId, productName = 'poulet') {
	const { data: produit, error: pErr } = await admin
		.from('produits')
		.insert({
			client_id: clientId,
			activity_id: activityId,
			nom_produit: productName,
			prix_vente_unitaire: 30,
			prix_achat_unitaire: 15,
		})
		.select('id')
		.single();
	if (pErr) throw pErr;
	await admin.from('stocks').insert({
		client_id: clientId,
		activity_id: activityId,
		produit_id: produit.id,
		nom_article: productName,
		entrees: 100,
		sorties: 0,
		seuil_alerte: 5,
	});
	return produit.id;
}

async function snapshotCounts(admin, clientId, activityId) {
	async function c(table, opts = {}) {
		let q = admin.from(table).select(opts.col || 'id', { count: 'exact', head: true }).eq('client_id', clientId);
		if (opts.activity) q = q.eq('activity_id', activityId);
		const { count, error } = await q;
		if (error) throw error;
		return count ?? 0;
	}
	return {
		ventes: await c('ventes', { activity: true }),
		depenses: await c('depenses', { activity: true }),
		stocks: await c('stocks', { activity: true, col: '*' }),
		produits: await c('produits', { activity: true }),
		agent_write_operations: await c('agent_write_operations'),
		agent_sessions: await c('agent_sessions'),
		chat_messages: await c('chat_messages'),
	};
}

async function fetchPendingSession(admin, clientId, activityId) {
	const { data, error } = await admin
		.from('agent_sessions')
		.select('payload, state_version, state_type')
		.eq('client_id', clientId)
		.eq('activity_id', activityId)
		.eq('state_type', 'pending')
		.maybeSingle();
	if (error) throw error;
	return { pending: data?.payload ?? null, stateVersion: data?.state_version ?? null };
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

async function getStockSorties(admin, clientId, activityId, productName) {
	const { data, error } = await admin
		.from('stocks')
		.select('sorties, entrees, nom_article')
		.eq('client_id', clientId)
		.eq('activity_id', activityId)
		.ilike('nom_article', productName)
		.maybeSingle();
	if (error) throw error;
	return data;
}

async function getExpenseById(admin, expenseId) {
	const { data, error } = await admin
		.from('depenses')
		.select('montant_depense, libelle_depense, activity_id')
		.eq('id', expenseId)
		.maybeSingle();
	if (error) throw error;
	return data;
}

async function postChat(baseUrl, { message, sessionId, activityId, testUser = null }) {
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
		&& !text.includes('operationId');
}

async function seedPending(admin, clientId, activityId, pendingWrite, consumeToken, operationId, stateVersion = 1) {
	const { error } = await admin.from('agent_sessions').upsert({
		client_id: clientId,
		activity_id: activityId,
		state_type: 'pending',
		payload: { pendingWrite, consumeToken, operationId },
		awaiting: 'confirm',
		intention: pendingWrite.tool,
		state_version: stateVersion,
	}, { onConflict: 'client_id,activity_id,state_type' });
	if (error) throw error;
}

async function rpcExpense(admin, clientId, activityId, { consumeToken, operationId, requestHash, expectedVersion = null }) {
	return admin.rpc('confirm_and_create_expense', {
		p_client_id: clientId,
		p_activity_id: activityId,
		p_consume_token: consumeToken,
		p_operation_id: operationId,
		p_request_hash: requestHash,
		p_expected_version: expectedVersion,
	});
}

async function cleanupClient(admin, clientId, authUserId) {
	await admin.from('chat_messages').delete().eq('client_id', clientId);
	await admin.from('agent_sessions').delete().eq('client_id', clientId);
	await admin.from('agent_write_operations').delete().eq('client_id', clientId);
	await admin.from('depenses').delete().eq('client_id', clientId);
	await admin.from('ventes').delete().eq('client_id', clientId);
	await admin.from('stocks').delete().eq('client_id', clientId);
	await admin.from('produits').delete().eq('client_id', clientId);
	await admin.from('activities').delete().eq('client_id', clientId);
	await admin.from('clients').delete().eq('id', clientId);
	if (authUserId) await admin.auth.admin.deleteUser(authUserId);
}

async function main() {
	assertStagingOnly();

	const report = {
		phase: 'H10.2',
		tag: TAG,
		target: STAGING_REF,
		flags: {
			V2: process.env.ASHY_INTELLIGENCE_V2,
			HTTP: process.env.ASHY_INTELLIGENCE_V2_HTTP,
			PRIMARY: process.env.ASHY_INTELLIGENCE_V2_PRIMARY,
			SAFE_FALLBACK: process.env.ASHY_V2_PRIMARY_SAFE_FALLBACK,
			CUTOVER_MODE: process.env.ASHY_V2_CUTOVER_MODE,
			ACTIONS: process.env.ASHY_INTELLIGENCE_V2_ACTIONS,
			CONFIRM: process.env.ASHY_INTELLIGENCE_V2_HTTP_CONFIRM,
			SHADOW: process.env.ASHY_INTELLIGENCE_V2_SHADOW,
		},
		createSaleAtomicBehavior: CREATE_SALE_ATOMIC_BEHAVIOR,
		scenarios: {},
		notSimulated: ['H10.2 production cutover', 'post-commit HTTP network loss', 'extended 30min monitoring'],
		verdict: 'NO_GO',
	};

	const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
		auth: { persistSession: false, autoRefreshToken: false },
	});

	const cleanup = [];

	try {
		const { default: ashyChat } = await import('../apps/api/src/routes/api/ashy-chat.js');
		const { resolveActivityScope } = await import('../apps/api/src/middleware/activity-scope.js');
		const { rejectForeignScope } = await import('../apps/api/src/middleware/auth.js');

		const authA = await createAuthUser(admin, 'client-a');
		const authB = await createAuthUser(admin, 'client-b');
		const clientA = await createClientRow(admin, authA, 'client-a');
		const clientB = await createClientRow(admin, authB, 'client-b');
		const activityA1 = await createActivity(admin, clientA, 'A1', true);
		const activityA2 = await createActivity(admin, clientA, 'A2', false);
		const activityB1 = await createActivity(admin, clientB, 'B1', true);
		cleanup.push({ clientId: clientA, authUserId: authA });
		cleanup.push({ clientId: clientB, authUserId: authB });

		await seedProductAndStock(admin, clientA, activityA1, 'poulet');

		const userA1 = { id: authA, clientId: clientA, activeActivityId: activityA1, businessUserId: `${TAG}-a1` };
		const userA2 = { ...userA1, activeActivityId: activityA2, businessUserId: `${TAG}-a2` };
		const userB1 = { id: authB, clientId: clientB, activeActivityId: activityB1, businessUserId: `${TAG}-b1` };

		report.baseline = await snapshotCounts(admin, clientA, activityA1);

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

		// --- 1. Expense clarification (NEEDS_CLARIFICATION → amount → confirm) ---
		const clarSession = `${TAG}-clar`;
		const clar1 = await postChat(baseUrl, {
			message: "J'ai dépensé de l'argent pour le transport.",
			sessionId: clarSession,
			activityId: activityA1,
		});
		const depAfterClar1 = (await snapshotCounts(admin, clientA, activityA1)).depenses;
		const clar2 = await postChat(baseUrl, { message: '30 dollars.', sessionId: clarSession, activityId: activityA1 });
		const pendingClar = await fetchPendingSession(admin, clientA, activityA1);
		const clar3 = await postChat(baseUrl, { message: 'Oui.', sessionId: clarSession, activityId: activityA1 });
		const depAfterClar = (await snapshotCounts(admin, clientA, activityA1)).depenses;
		const opClar = pendingClar?.pending?.operationId
			? await getWriteOperation(admin, pendingClar.pending.operationId)
			: null;
		const clarExpense = opClar?.result_id ? await getExpenseById(admin, opClar.result_id) : null;
		const pendingAfterClar = await fetchPendingSession(admin, clientA, activityA1);

		report.scenarios.expenseClarification = clar1.status === 200
			&& clar1.body?.v2Http?.goalType === 'ACTION'
			&& clar1.body?.v2Http?.goalDomain === 'EXPENSES'
			&& (clar1.body?.v2Http?.actionProposalStatus === 'NEEDS_CLARIFICATION'
				|| clar1.body?.v2Http?.actionStatus === 'NEEDS_CLARIFICATION')
			&& depAfterClar1 === report.baseline.depenses
			&& clar2.body?.v2Http?.actionProposalStatus === 'READY_FOR_CONFIRMATION'
			&& pendingClar?.pending?.pendingWrite?.amount === 30
			&& pendingClar?.pending?.operationId
			&& pendingClar?.pending?.consumeToken
			&& pendingClar?.stateVersion != null
			&& (clar3.body?.v2Http?.actionProposalStatus === 'COMPLETED' || clar3.body?.v2Http?.f4Committed === true)
			&& depAfterClar === report.baseline.depenses + 1
			&& opClar?.status === 'completed'
			&& opClar?.result_id
			&& Number(clarExpense?.montant_depense) === 30
			&& !pendingAfterClar?.pending?.pendingWrite
			? pass('expense clarification F4-B2', {
				amount: clarExpense?.montant_depense,
				opStatus: opClar?.status,
				resultId: opClar?.result_id,
			})
			: fail('expense clarification', {
				clar1: clar1.body?.v2Http,
				clar2: clar2.body?.v2Http,
				clar3: clar3.body?.v2Http,
				pendingClar,
				opClar,
				clarExpense,
				depAfterClar,
			});

		// --- 2. Sale with seeded poulet + stock sorties (create_sale_atomic) ---
		const stockBefore = await getStockSorties(admin, clientA, activityA1, 'poulet');
		const saleSession = `${TAG}-sale`;
		const ventesBefore = (await snapshotCounts(admin, clientA, activityA1)).ventes;
		const saleProp = await postChat(baseUrl, {
			message: "J'ai vendu 1 poulet à 2 dollars.",
			sessionId: saleSession,
			activityId: activityA1,
		});
		const pendingSale = await fetchPendingSession(admin, clientA, activityA1);
		const ventesAfterProp = (await snapshotCounts(admin, clientA, activityA1)).ventes;
		const saleConfirm = await postChat(baseUrl, { message: 'Oui', sessionId: saleSession, activityId: activityA1 });
		const ventesAfter = (await snapshotCounts(admin, clientA, activityA1)).ventes;
		const stockAfter = await getStockSorties(admin, clientA, activityA1, 'poulet');
		const opSale = pendingSale?.pending?.operationId
			? await getWriteOperation(admin, pendingSale.pending.operationId)
			: null;
		const stockDelta = (stockAfter?.sorties ?? 0) - (stockBefore?.sorties ?? 0);

		report.scenarios.saleWithProduct = saleProp.status === 200
			&& saleProp.body?.v2Http?.goalType === 'ACTION'
			&& saleProp.body?.v2Http?.goalDomain === 'SALES'
			&& saleProp.body?.v2Http?.actionProposalStatus === 'READY_FOR_CONFIRMATION'
			&& ventesAfterProp === ventesBefore
			&& saleConfirm.body?.v2Http?.f4Committed === true
			&& ventesAfter === ventesBefore + 1
			&& opSale?.status === 'completed'
			&& stockDelta === 1
			? pass('sale E2E + stock sorties', {
				ventesAfter,
				stockBefore: stockBefore?.sorties,
				stockAfter: stockAfter?.sorties,
				stockDelta,
				createSaleAtomic: CREATE_SALE_ATOMIC_BEHAVIOR.stockEffect,
			})
			: fail('sale with product', {
				saleProp: saleProp.body?.v2Http,
				saleConfirm: saleConfirm.body?.v2Http,
				ventesAfter,
				stockBefore,
				stockAfter,
				stockDelta,
			});

		// --- 3. Reject (zero write, pending cleared) ---
		const rejSession = `${TAG}-rej`;
		const depBeforeRej = (await snapshotCounts(admin, clientA, activityA1)).depenses;
		const awBeforeRej = (await snapshotCounts(admin, clientA, activityA1)).agent_write_operations;
		await postChat(baseUrl, {
			message: "J'ai dépensé 30 dollars pour le transport.",
			sessionId: rejSession,
			activityId: activityA1,
		});
		const rej = await postChat(baseUrl, { message: 'Non.', sessionId: rejSession, activityId: activityA1 });
		const depAfterRej = (await snapshotCounts(admin, clientA, activityA1)).depenses;
		const awAfterRej = (await snapshotCounts(admin, clientA, activityA1)).agent_write_operations;
		const pendingAfterRej = await fetchPendingSession(admin, clientA, activityA1);

		report.scenarios.reject = rej.status === 200
			&& (rej.body?.v2Http?.actionProposalStatus === 'CONFIRMATION_REJECTED'
				|| rej.body?.v2Http?.actionStatus === 'CONFIRMATION_REJECTED')
			&& depAfterRej === depBeforeRej
			&& awAfterRej === awBeforeRej
			&& !pendingAfterRej?.pending?.pendingWrite
			? pass('reject no write', { status: rej.body?.v2Http?.actionProposalStatus })
			: fail('reject', { rej: rej.body?.v2Http, depAfterRej, pendingAfterRej });

		// --- 4. Modification (25 → 30, request_hash changed, never persists 25) ---
		const modSession = `${TAG}-mod`;
		const depBeforeMod = (await snapshotCounts(admin, clientA, activityA1)).depenses;
		await postChat(baseUrl, {
			message: "J'ai dépensé 25 dollars pour le transport.",
			sessionId: modSession,
			activityId: activityA1,
		});
		const pendingMod1 = await fetchPendingSession(admin, clientA, activityA1);
		const hash1 = hashPending(clientA, pendingMod1?.pending?.pendingWrite);
		const amountBeforeMod = pendingMod1?.pending?.pendingWrite?.amount;
		await postChat(baseUrl, { message: 'Finalement 30 dollars.', sessionId: modSession, activityId: activityA1 });
		const pendingMod2 = await fetchPendingSession(admin, clientA, activityA1);
		const hash2 = hashPending(clientA, pendingMod2?.pending?.pendingWrite);
		const modConfirm = await postChat(baseUrl, { message: 'Oui', sessionId: modSession, activityId: activityA1 });
		const depAfterMod = (await snapshotCounts(admin, clientA, activityA1)).depenses;
		const modOp = pendingMod2?.pending?.operationId
			? await getWriteOperation(admin, pendingMod2.pending.operationId)
			: null;
		const modExpense = modOp?.result_id ? await getExpenseById(admin, modOp.result_id) : null;

		report.scenarios.modification = hash1 !== hash2
			&& amountBeforeMod === 25
			&& pendingMod2?.pending?.pendingWrite?.amount === 30
			&& modConfirm.body?.v2Http?.f4Committed === true
			&& depAfterMod === depBeforeMod + 1
			&& Number(modExpense?.montant_depense) === 30
			&& Number(modExpense?.montant_depense) !== 25
			? pass('modification 25→30', { montant: modExpense?.montant_depense, hashChanged: true })
			: fail('modification', {
				hash1: hash1?.slice(0, 8),
				hash2: hash2?.slice(0, 8),
				amountBeforeMod,
				modExpense,
				modConfirm: modConfirm.body?.v2Http,
			});

		// --- 5. Multi-turn (amount then label → one write) ---
		const mtSession = `${TAG}-mt`;
		const depBeforeMt = (await snapshotCounts(admin, clientA, activityA1)).depenses;
		await postChat(baseUrl, { message: "J'ai dépensé 30 dollars.", sessionId: mtSession, activityId: activityA1 });
		await postChat(baseUrl, { message: 'pour le transport.', sessionId: mtSession, activityId: activityA1 });
		const mtConfirm = await postChat(baseUrl, { message: 'Oui.', sessionId: mtSession, activityId: activityA1 });
		const depAfterMt = (await snapshotCounts(admin, clientA, activityA1)).depenses;

		report.scenarios.multiTurn = mtConfirm.body?.v2Http?.f4Committed === true
			&& depAfterMt === depBeforeMt + 1
			? pass('multi-turn single write', { depAfterMt })
			: fail('multi-turn', { mtConfirm: mtConfirm.body?.v2Http, depBeforeMt, depAfterMt });

		// --- 6. Multiple independent operations (sequential; one pending per activity) ---
		const sessA = `${TAG}-indep-a`;
		const sessB = `${TAG}-indep-b`;
		const depBeforeIndep = (await snapshotCounts(admin, clientA, activityA1)).depenses;
		await postChat(baseUrl, { message: "J'ai dépensé 10 dollars pour A.", sessionId: sessA, activityId: activityA1 });
		const pendingA = await fetchPendingSession(admin, clientA, activityA1);
		const opIdA = pendingA?.pending?.operationId;
		const confirmA = await postChat(baseUrl, { message: 'Oui', sessionId: sessA, activityId: activityA1 });
		const depAfterA = (await snapshotCounts(admin, clientA, activityA1)).depenses;
		await postChat(baseUrl, { message: "J'ai dépensé 20 dollars pour B.", sessionId: sessB, activityId: activityA1 });
		const pendingB = await fetchPendingSession(admin, clientA, activityA1);
		const opIdB = pendingB?.pending?.operationId;
		const confirmB = await postChat(baseUrl, { message: 'Oui', sessionId: sessB, activityId: activityA1 });
		const depAfterIndep = (await snapshotCounts(admin, clientA, activityA1)).depenses;
		const opA = opIdA ? await getWriteOperation(admin, opIdA) : null;
		const opB = opIdB ? await getWriteOperation(admin, opIdB) : null;

		report.scenarios.independentOps = confirmA.body?.v2Http?.f4Committed === true
			&& confirmB.body?.v2Http?.f4Committed === true
			&& depAfterA === depBeforeIndep + 1
			&& depAfterIndep === depBeforeIndep + 2
			&& opIdA && opIdB && opIdA !== opIdB
			&& opA?.status === 'completed' && opB?.status === 'completed'
			&& opA?.result_id !== opB?.result_id
			? pass('independent sequential ops', {
				opIdA,
				opIdB,
				depAfterIndep,
			})
			: fail('independent ops', {
				confirmA: confirmA.body?.v2Http,
				confirmB: confirmB.body?.v2Http,
				opIdA,
				opIdB,
				opA,
				opB,
				depAfterA,
				depAfterIndep,
			});

		// --- 10. Activity isolation (A1 pending, confirm on A2) ---
		const isoSession = `${TAG}-iso-act`;
		await postChat(baseUrl, {
			message: "J'ai dépensé 30 dollars pour le transport.",
			sessionId: isoSession,
			activityId: activityA1,
		});
		const depA2Before = (await snapshotCounts(admin, clientA, activityA2)).depenses;
		const crossAct = await postChat(baseUrl, {
			message: 'Oui',
			sessionId: isoSession,
			activityId: activityA2,
			testUser: 'A2',
		});
		const depA2After = (await snapshotCounts(admin, clientA, activityA2)).depenses;
		report.scenarios.activityIsolation = crossAct.body?.v2Http?.actionProposalStatus === 'NO_PENDING_TO_CONFIRM'
			&& depA2After === depA2Before
			? pass('activity isolation', { status: crossAct.body?.v2Http?.actionProposalStatus })
			: fail('activity isolation', { crossAct: crossAct.body?.v2Http, depA2Before, depA2After });

		// --- 11. Tenant isolation (A pending, confirm on B) ---
		const tenantSession = `${TAG}-iso-tenant`;
		await postChat(baseUrl, {
			message: "J'ai dépensé 30 dollars pour le transport.",
			sessionId: tenantSession,
			activityId: activityA1,
		});
		const depBBefore = (await snapshotCounts(admin, clientB, activityB1)).depenses;
		const crossTenant = await postChat(baseUrl, {
			message: 'Oui',
			sessionId: tenantSession,
			activityId: activityB1,
			testUser: 'B1',
		});
		const depBAfter = (await snapshotCounts(admin, clientB, activityB1)).depenses;
		report.scenarios.tenantIsolation = crossTenant.body?.v2Http?.actionProposalStatus === 'NO_PENDING_TO_CONFIRM'
			&& depBAfter === depBBefore
			? pass('tenant isolation', { status: crossTenant.body?.v2Http?.actionProposalStatus })
			: fail('tenant isolation', { crossTenant: crossTenant.body?.v2Http, depBBefore, depBAfter });

		// --- 12. n8n isolation (noN8nFallback on ACTION paths) ---
		report.scenarios.n8nIsolation = clar1.body?.v2Http?.noN8nFallback !== false
			&& saleProp.body?.v2Http?.noN8nFallback !== false
			? pass('ACTION no n8n fallback', {
				clarification: clar1.body?.v2Http?.noN8nFallback,
				sale: saleProp.body?.v2Http?.noN8nFallback,
			})
			: fail('n8n isolation', { clar: clar1.body?.v2Http, sale: saleProp.body?.v2Http });

		// --- Adversarial RPC (isolated client) ---
		const authAdv = await createAuthUser(admin, 'adv');
		const clientAdv = await createClientRow(admin, authAdv, 'adv');
		const activityAdv = await createActivity(admin, clientAdv, 'ADV', true);
		cleanup.push({ clientId: clientAdv, authUserId: authAdv });

		const advPending = { tool: 'create_expense', label: `H102 ${TAG}`, amount: 30 };
		const advOpId = randomUUID();
		const advToken = `tok-${TAG}`;
		const advHash = hashPending(clientAdv, advPending);
		await seedPending(admin, clientAdv, activityAdv, advPending, advToken, advOpId, 1);

		// --- 7. Idempotency ALREADY_COMPLETED replay ---
		const rpcFirst = await rpcExpense(admin, clientAdv, activityAdv, {
			consumeToken: advToken, operationId: advOpId, requestHash: advHash,
		});
		const depAdvMid = (await snapshotCounts(admin, clientAdv, activityAdv)).depenses;
		const rpcReplay = await rpcExpense(admin, clientAdv, activityAdv, {
			consumeToken: advToken, operationId: advOpId, requestHash: advHash,
		});
		report.scenarios.idempotencyReplay = rpcFirst.data?.status === 'COMMITTED'
			&& rpcReplay.data?.status === 'ALREADY_COMPLETED'
			&& rpcReplay.data?.result_id === rpcFirst.data?.result_id
			&& depAdvMid === (await snapshotCounts(admin, clientAdv, activityAdv)).depenses
			? pass('idempotency ALREADY_COMPLETED', { first: rpcFirst.data?.status, replay: rpcReplay.data?.status })
			: fail('idempotency replay', { rpcFirst: rpcFirst.data, rpcReplay: rpcReplay.data });

		// --- 8. REQUEST_HASH_MISMATCH ---
		const hashOpId = randomUUID();
		const hashToken = `tok-hash-${TAG}`;
		const hashPendingPayload = { tool: 'create_expense', label: `Hash ${TAG}`, amount: 40 };
		const goodHash = hashPending(clientAdv, hashPendingPayload);
		await seedPending(admin, clientAdv, activityAdv, hashPendingPayload, hashToken, hashOpId, 2);
		const depBeforeHash = (await snapshotCounts(admin, clientAdv, activityAdv)).depenses;
		const hashCommit = await rpcExpense(admin, clientAdv, activityAdv, {
			consumeToken: hashToken, operationId: hashOpId, requestHash: goodHash,
		});
		const hashMismatch = await rpcExpense(admin, clientAdv, activityAdv, {
			consumeToken: hashToken, operationId: hashOpId, requestHash: `${goodHash}-bad`,
		});
		report.scenarios.requestHashMismatch = hashCommit.data?.status === 'COMMITTED'
			&& hashMismatch.data?.status === 'REQUEST_HASH_MISMATCH'
			&& (await snapshotCounts(admin, clientAdv, activityAdv)).depenses === depBeforeHash + 1
			? pass('REQUEST_HASH_MISMATCH blocked', { mismatch: hashMismatch.data?.status })
			: fail('request hash mismatch', { hashCommit: hashCommit.data, hashMismatch: hashMismatch.data });

		// --- 9a. Token mismatch ---
		const tokOpId = randomUUID();
		const tokPending = { tool: 'create_expense', label: `Tok ${TAG}`, amount: 50 };
		const tokHash = hashPending(clientAdv, tokPending);
		await seedPending(admin, clientAdv, activityAdv, tokPending, `good-${TAG}`, tokOpId, 3);
		const depBeforeTok = (await snapshotCounts(admin, clientAdv, activityAdv)).depenses;
		const tokBad = await rpcExpense(admin, clientAdv, activityAdv, {
			consumeToken: 'invalid-token', operationId: tokOpId, requestHash: tokHash,
		});
		report.scenarios.tokenMismatch = (tokBad.error || tokBad.data?.status === 'TOKEN_MISMATCH' || tokBad.data?.status === 'VERSION_MISMATCH')
			&& (await snapshotCounts(admin, clientAdv, activityAdv)).depenses === depBeforeTok
			? pass('token mismatch blocked', { status: tokBad.data?.status || tokBad.error?.message })
			: fail('token mismatch', tokBad);

		// --- 9b. Stale version ---
		const verOpId = randomUUID();
		const verPending = { tool: 'create_expense', label: `Ver ${TAG}`, amount: 60 };
		const verHash = hashPending(clientAdv, verPending);
		await seedPending(admin, clientAdv, activityAdv, verPending, `ver-${TAG}`, verOpId, 1);
		await admin.from('agent_sessions')
			.update({ state_version: 2 })
			.eq('client_id', clientAdv)
			.eq('activity_id', activityAdv)
			.eq('state_type', 'pending');
		const depBeforeVer = (await snapshotCounts(admin, clientAdv, activityAdv)).depenses;
		const verBad = await rpcExpense(admin, clientAdv, activityAdv, {
			consumeToken: null,
			operationId: verOpId,
			requestHash: verHash,
			expectedVersion: 1,
		});
		report.scenarios.staleVersion = verBad.data?.status === 'VERSION_MISMATCH'
			&& (await snapshotCounts(admin, clientAdv, activityAdv)).depenses === depBeforeVer
			? pass('stale version blocked', { status: verBad.data?.status, dbVersion: 2, expectedVersion: 1 })
			: fail('stale version', verBad.data);

		// --- 13. Concurrency: parallel POST confirm on same pending → one write ---
		const concSession = `${TAG}-conc-http`;
		const depBeforeConcHttp = (await snapshotCounts(admin, clientA, activityA1)).depenses;
		await postChat(baseUrl, {
			message: "J'ai dépensé 15 dollars pour conc HTTP.",
			sessionId: concSession,
			activityId: activityA1,
		});
		const [concHttpA, concHttpB] = await Promise.all([
			postChat(baseUrl, { message: 'Oui', sessionId: concSession, activityId: activityA1 }),
			postChat(baseUrl, { message: 'Oui', sessionId: concSession, activityId: activityA1 }),
		]);
		const depAfterConcHttp = (await snapshotCounts(admin, clientA, activityA1)).depenses;
		const concStatuses = [
			concHttpA.body?.v2Http?.actionProposalStatus,
			concHttpB.body?.v2Http?.actionProposalStatus,
		];
		const concCommitted = concStatuses.some((s) => s === 'COMPLETED' || s === 'ALREADY_COMPLETED')
			|| concHttpA.body?.v2Http?.f4Committed === true
			|| concHttpB.body?.v2Http?.f4Committed === true;

		report.scenarios.concurrency = depAfterConcHttp === depBeforeConcHttp + 1
			&& concCommitted
			? pass('parallel POST confirm single write', { depAfterConcHttp, statuses: concStatuses })
			: fail('concurrency', { concHttpA: concHttpA.body?.v2Http, concHttpB: concHttpB.body?.v2Http, depAfterConcHttp });

		report.scenarios.noSecretLeak = replyHasNoSecrets(clar3.body?.reply)
			&& replyHasNoSecrets(saleConfirm.body?.reply)
			? pass('no secrets in reply')
			: fail('secret leak', { clarReply: clar3.body?.reply?.slice(0, 80) });

		const finalSnap = await snapshotCounts(admin, clientA, activityA1);
		report.finalSnapshot = finalSnap;
		report.financialDelta = {
			ventes: finalSnap.ventes - report.baseline.ventes,
			depenses: finalSnap.depenses - report.baseline.depenses,
			stocks: finalSnap.stocks - report.baseline.stocks,
			produits: finalSnap.produits - report.baseline.produits,
			agent_write_operations: finalSnap.agent_write_operations - report.baseline.agent_write_operations,
		};

		server.close();

		const allPass = Object.values(report.scenarios).every((s) => s.status === 'PASS');
		report.verdict = allPass ? 'GO_H10_2_STAGING_READY' : 'NO_GO';
	} finally {
		for (const { clientId, authUserId } of cleanup) {
			await cleanupClient(admin, clientId, authUserId);
		}
	}

	writeFileSync(`${process.env.TEMP}/h102_staging_report.json`, JSON.stringify(report, null, 2));
	console.log(JSON.stringify({
		verdict: report.verdict,
		scenarios: report.scenarios,
		financialDelta: report.financialDelta,
		createSaleAtomicBehavior: report.createSaleAtomicBehavior,
	}, null, 2));
	process.exit(report.verdict === 'GO_H10_2_STAGING_READY' ? 0 : 1);
}

main().catch((err) => {
	console.error('FATAL:', err.message);
	process.exit(1);
});
