#!/usr/bin/env node
/**
 * Phase H6 — Cutover simulation (vwjkktqcmmhotadicbpg only).
 *
 *   node --env-file=apps/api/.env.staging tools/_ashy_v2_phase_h6_staging_gate.mjs
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const STAGING_REF = 'vwjkktqcmmhotadicbpg';
const PRODUCTION_REF = 'knrwplidgvuvjnuqqmrt';
const TAG = `phase-h6-${Date.now()}`;

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

function applyCutoverMode(mode) {
	const base = {
		ASHY_INTELLIGENCE_V2: 'true',
		ASHY_INTELLIGENCE_V2_ACTIONS: 'true',
		ASHY_INTELLIGENCE_V2_HTTP_CONFIRM: 'true',
		ASHY_INTELLIGENCE_V2_SHADOW: 'false',
		ASHY_INTELLIGENCE_V2_HTTP: 'false',
		ASHY_INTELLIGENCE_V2_PRIMARY: 'false',
		ASHY_V2_PRIMARY_SAFE_FALLBACK: 'false',
		AGENT_SESSION_TRANSACTIONAL_CONFIRM: 'true',
		AGENT_SESSION_IDEMPOTENT_CONFIRM: 'true',
		AGENT_SESSION_WRITE_DB_FIRST: 'true',
		AGENT_SESSION_PENDING_DB_REQUIRED: 'true',
	};
	if (mode === 'LEGACY_ONLY') {
		Object.assign(base, { ASHY_INTELLIGENCE_V2: 'false' });
	} else if (mode === 'V2_SHADOW') {
		Object.assign(base, { ASHY_INTELLIGENCE_V2_SHADOW: 'true' });
	} else if (mode === 'V2_PRIMARY') {
		Object.assign(base, {
			ASHY_INTELLIGENCE_V2_HTTP: 'true',
			ASHY_INTELLIGENCE_V2_PRIMARY: 'true',
		});
	}
	for (const [k, v] of Object.entries(base)) {
		process.env[k] = v;
	}
}

async function createAuthUser(admin, label) {
	const email = `${TAG}-${label}-${randomUUID()}@phaseh6.ashledger.test`;
	const { data, error } = await admin.auth.admin.createUser({
		email,
		password: `H6!${randomUUID().slice(0, 8)}`,
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
	await admin.from('stocks').insert({
		client_id: clientId,
		activity_id: activityId,
		produit_id: produit.id,
		nom_article: 'poulet',
		entrees: 50,
		sorties: 0,
		seuil_alerte: 5,
	});
}

async function countRows(admin, table, clientId, activityId = null) {
	let q = admin.from(table).select('id', { count: 'exact', head: true }).eq('client_id', clientId);
	if (activityId) q = q.eq('activity_id', activityId);
	const { count, error } = await q;
	if (error) throw error;
	return count ?? 0;
}

async function snapshotCounts(admin, clientId, activityId) {
	return {
		depenses: await countRows(admin, 'depenses', clientId, activityId),
		ventes: await countRows(admin, 'ventes', clientId, activityId),
		agent_write_operations: await countRows(admin, 'agent_write_operations', clientId),
		agent_sessions: await countRows(admin, 'agent_sessions', clientId, activityId),
		chat_messages: await countRows(admin, 'chat_messages', clientId),
	};
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

async function getLatestWriteOperation(admin, clientId) {
	const { data, error } = await admin
		.from('agent_write_operations')
		.select('*')
		.eq('client_id', clientId)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	return data;
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

async function postChat(baseUrl, { message, sessionId, activityId }) {
	const res = await fetch(`${baseUrl}/api/ashy/chat`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Activity-Id': activityId,
		},
		body: JSON.stringify({ message, sessionId: sessionId || TAG }),
	});
	const body = await res.json().catch(() => ({}));
	return { status: res.status, body };
}

async function buildServer(userA1) {
	const { default: ashyChat } = await import('../apps/api/src/routes/api/ashy-chat.js');
	const { resolveActivityScope } = await import('../apps/api/src/middleware/activity-scope.js');
	const { rejectForeignScope } = await import('../apps/api/src/middleware/auth.js');

	const app = express();
	app.use(express.json());
	app.post('/api/ashy/chat', (req, res, next) => {
		req.user = userA1;
		next();
	}, resolveActivityScope, rejectForeignScope, ashyChat);

	const server = await new Promise((resolve, reject) => {
		const s = http.createServer(app);
		s.listen(0, '127.0.0.1', () => resolve(s));
		s.on('error', reject);
	});
	return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function main() {
	assertStagingOnly();

	const report = {
		tag: TAG,
		target: STAGING_REF,
		steps: {},
		counters: {},
		latencyMs: {},
		notSimulated: ['production cutover', 'percentage canary', 'post-commit HTTP network loss'],
		verdict: 'NO-GO',
	};

	const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
		auth: { persistSession: false, autoRefreshToken: false },
	});

	const cleanup = { authUserIds: [], clientIds: [], operationIds: [] };
	let server = null;

	try {
		const authA = await createAuthUser(admin, 'client-a');
		cleanup.authUserIds.push(authA);
		const clientA = await createClientRow(admin, authA, 'client-a');
		cleanup.clientIds.push(clientA);
		const activityA1 = await createActivity(admin, clientA, 'A1', true);
		await seedProductAndStock(admin, clientA, activityA1);

		const userA1 = {
			id: authA,
			clientId: clientA,
			activeActivityId: activityA1,
			businessUserId: `${TAG}-a1`,
		};

		report.counters.baseline = await snapshotCounts(admin, clientA, activityA1);

		// STEP A — Legacy primary
		applyCutoverMode('LEGACY_ONLY');
		({ server } = await buildServer(userA1));
		let baseUrl = `http://127.0.0.1:${server.address().port}`;

		const legacyRead = await postChat(baseUrl, {
			message: 'Bonjour',
			sessionId: `${TAG}-legacy`,
			activityId: activityA1,
		});
		const afterLegacy = await snapshotCounts(admin, clientA, activityA1);

		report.steps.stepA_legacyPrimary = legacyRead.status === 200
			&& !legacyRead.body?.v2Http?.handled
			&& afterLegacy.depenses === report.counters.baseline.depenses
			? pass('STEP A Legacy primary', { reply: legacyRead.body?.reply?.slice(0, 60) })
			: fail('STEP A Legacy primary', { legacyRead: legacyRead.body, afterLegacy });

		server.close();
		server = null;

		// STEP B — V2 shadow
		applyCutoverMode('V2_SHADOW');
		({ server, baseUrl } = await buildServer(userA1));
		const shadowRead = await postChat(baseUrl, {
			message: 'Combien ai-je vendu ce mois-ci ?',
			sessionId: `${TAG}-shadow`,
			activityId: activityA1,
		});
		const afterShadow = await snapshotCounts(admin, clientA, activityA1);

		report.steps.stepB_v2Shadow = shadowRead.status === 200
			&& !shadowRead.body?.v2Http?.handled
			&& afterShadow.depenses === report.counters.baseline.depenses
			? pass('STEP B V2 shadow (legacy responds)', { cutoverMode: shadowRead.body?.cutoverMode })
			: fail('STEP B V2 shadow', { shadowRead: shadowRead.body, afterShadow });

		server.close();
		server = null;

		// STEP C-H — V2 primary full cycle
		applyCutoverMode('V2_PRIMARY');
		({ server, baseUrl } = await buildServer(userA1));

		const t0 = Date.now();
		const primaryRead = await postChat(baseUrl, {
			message: 'Combien ai-je vendu ce mois-ci ?',
			sessionId: `${TAG}-pread`,
			activityId: activityA1,
		});
		report.latencyMs.v2Read = Date.now() - t0;
		const afterPrimaryRead = await snapshotCounts(admin, clientA, activityA1);

		report.steps.stepC_v2PrimaryRead = primaryRead.status === 200
			&& primaryRead.body?.v2Http?.handled === true
			&& primaryRead.body?.cutoverMode === 'V2_PRIMARY'
			&& primaryRead.body?.primaryPath === 'V2_HTTP'
			&& afterPrimaryRead.depenses === report.counters.baseline.depenses
			&& afterPrimaryRead.ventes === report.counters.baseline.ventes
			? pass('STEP C V2 primary READ', { latencyMs: report.latencyMs.v2Read })
			: fail('STEP C V2 primary READ', { primaryRead: primaryRead.body, afterPrimaryRead });

		const depBaseline = afterPrimaryRead.depenses;
		const expSession = `${TAG}-exp-h6`;

		const expProposal = await postChat(baseUrl, {
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			sessionId: expSession,
			activityId: activityA1,
		});
		const depAfterProposal = await countRows(admin, 'depenses', clientA, activityA1);
		const pendingExp = await fetchPendingSession(admin, clientA, activityA1);
		const opIdExp = pendingExp?.pending?.operationId;
		if (opIdExp) cleanup.operationIds.push(opIdExp);

		report.steps.stepD_v2PrimaryProposal = expProposal.status === 200
			&& expProposal.body?.v2Http?.actionProposalStatus === 'READY_FOR_CONFIRMATION'
			&& expProposal.body?.noN8nFallback === true
			&& depAfterProposal === depBaseline
			? pass('STEP D V2 primary ACTION proposal (zero write)', { operationId: opIdExp })
			: fail('STEP D proposal', { expProposal: expProposal.body?.v2Http, depAfterProposal, depBaseline });

		const t1 = Date.now();
		const expConfirm = await postChat(baseUrl, {
			message: 'Oui',
			sessionId: expSession,
			activityId: activityA1,
		});
		report.latencyMs.v2Confirm = Date.now() - t1;
		const depAfterConfirm = await countRows(admin, 'depenses', clientA, activityA1);
		const opExp = opIdExp
			? await getWriteOperation(admin, opIdExp)
			: await getLatestWriteOperation(admin, clientA);

		report.steps.stepE_v2PrimaryConfirm = expConfirm.status === 200
			&& (expConfirm.body?.v2Http?.f4Committed === true
				|| expConfirm.body?.v2Http?.actionProposalStatus === 'COMPLETED')
			&& depAfterConfirm === depBaseline + 1
			&& (opExp?.status === 'completed' || opExp?.status === 'committed')
			? pass('STEP E V2 primary confirm (+1 write)', { depAfterConfirm, opStatus: opExp?.status, operationId: opExp?.operation_id })
			: fail('STEP E confirm', { expConfirm: expConfirm.body?.v2Http, depAfterConfirm, opExp });

		const doubleConfirm = await postChat(baseUrl, {
			message: 'Oui',
			sessionId: expSession,
			activityId: activityA1,
		});
		const depAfterDouble = await countRows(admin, 'depenses', clientA, activityA1);

		report.steps.stepF_idempotentRetry = doubleConfirm.status === 200
			&& (doubleConfirm.body?.v2Http?.actionProposalStatus === 'ALREADY_COMPLETED'
				|| doubleConfirm.body?.v2Http?.f4Replay === true
				|| doubleConfirm.body?.v2Http?.actionProposalStatus === 'NO_PENDING_TO_CONFIRM')
			&& depAfterDouble === depBaseline + 1
			? pass('STEP F idempotent retry (+0 write)', { status: doubleConfirm.body?.v2Http?.actionProposalStatus })
			: fail('STEP F retry', { doubleConfirm: doubleConfirm.body?.v2Http, depAfterDouble });

		server.close();
		server = null;

		// STEP G — rollback to Legacy
		applyCutoverMode('LEGACY_ONLY');
		({ server, baseUrl } = await buildServer(userA1));

		const rollbackRead = await postChat(baseUrl, {
			message: 'Bonjour après rollback',
			sessionId: `${TAG}-rollback`,
			activityId: activityA1,
		});
		const afterRollback = await snapshotCounts(admin, clientA, activityA1);

		report.steps.stepG_rollback = rollbackRead.status === 200
			&& !rollbackRead.body?.v2Http?.handled
			&& afterRollback.depenses === depBaseline + 1
			? pass('STEP G rollback to Legacy (no extra writes)', { depenses: afterRollback.depenses })
			: fail('STEP G rollback', { rollbackRead: rollbackRead.body, afterRollback });

		report.steps.stepH_legacyAfterRollback = rollbackRead.body?.reply
			? pass('STEP H Legacy chat continues after rollback')
			: fail('STEP H legacy after rollback', rollbackRead.body);

		report.counters.final = afterRollback;

		server.close();
		server = null;

		const allPass = Object.values(report.steps).every((s) => s.status === 'PASS');
		report.verdict = allPass
			? 'GO — Phase H6 cutover simulation validated (staging)'
			: 'NO-GO — Phase H6 staging failures';
	} finally {
		if (server) server.close();
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
