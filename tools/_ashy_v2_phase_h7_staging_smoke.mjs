#!/usr/bin/env node
/**
 * Phase H7 — Staging smoke (non-destructive subset).
 *
 *   node --env-file=apps/api/.env.staging tools/_ashy_v2_phase_h7_staging_smoke.mjs
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const STAGING_REF = 'vwjkktqcmmhotadicbpg';
const PRODUCTION_REF = 'knrwplidgvuvjnuqqmrt';
const TAG = `phase-h7-smoke-${Date.now()}`;

process.env.ASHY_INTELLIGENCE_V2 = 'true';
process.env.ASHY_INTELLIGENCE_V2_HTTP = 'true';
process.env.ASHY_INTELLIGENCE_V2_PRIMARY = 'true';
process.env.ASHY_INTELLIGENCE_V2_ACTIONS = 'true';
process.env.ASHY_INTELLIGENCE_V2_HTTP_CONFIRM = 'true';
process.env.AGENT_SESSION_TRANSACTIONAL_CONFIRM = 'true';
process.env.AGENT_SESSION_IDEMPOTENT_CONFIRM = 'true';

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
	if (ref !== STAGING_REF) throw new Error(`Expected staging ${STAGING_REF}`);
	if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY required');
	if (process.env.RUN_STAGING !== 'true') throw new Error('RUN_STAGING must be true');
}

async function createAuthUser(admin) {
	const email = `${TAG}-${randomUUID()}@phaseh7.ashledger.test`;
	const { data, error } = await admin.auth.admin.createUser({
		email,
		password: `H7!${randomUUID().slice(0, 8)}`,
		email_confirm: true,
	});
	if (error) throw error;
	return data.user.id;
}

async function createClientRow(admin, authUserId) {
	const userId = `${TAG}-${randomUUID()}`;
	const { data, error } = await admin
		.from('clients')
		.insert({ user_id: userId, nom_client: TAG, auth_user_id: authUserId })
		.select('id')
		.single();
	if (error) throw error;
	return data.id;
}

async function createActivity(admin, clientId) {
	const { data, error } = await admin
		.from('activities')
		.insert({ client_id: clientId, name: 'H7', type: 'commerce', is_default: true })
		.select('id')
		.single();
	if (error) throw error;
	return data.id;
}

async function postChat(baseUrl, { message, sessionId, activityId }) {
	const res = await fetch(`${baseUrl}/api/ashy/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'X-Activity-Id': activityId },
		body: JSON.stringify({ message, sessionId }),
	});
	return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function main() {
	assertStagingOnly();

	const report = { tag: TAG, scenarios: {}, verdict: 'NO-GO' };
	const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
	const cleanup = { authUserIds: [], clientIds: [] };

	try {
		const { default: ashyChat } = await import('../apps/api/src/routes/api/ashy-chat.js');
		const { resolveActivityScope } = await import('../apps/api/src/middleware/activity-scope.js');
		const { rejectForeignScope } = await import('../apps/api/src/middleware/auth.js');

		const auth = await createAuthUser(admin);
		cleanup.authUserIds.push(auth);
		const clientId = await createClientRow(admin, auth);
		cleanup.clientIds.push(clientId);
		const activityId = await createActivity(admin, clientId);

		const user = { id: auth, clientId, activeActivityId: activityId, businessUserId: TAG };
		const app = express();
		app.use(express.json());
		app.post('/api/ashy/chat', (req, res, next) => {
			req.user = user;
			next();
		}, resolveActivityScope, rejectForeignScope, ashyChat);

		const server = await new Promise((resolve, reject) => {
			const s = http.createServer(app);
			s.listen(0, '127.0.0.1', () => resolve(s));
			s.on('error', reject);
		});
		const baseUrl = `http://127.0.0.1:${server.address().port}`;

		const read = await postChat(baseUrl, {
			message: 'Combien ai-je vendu ce mois-ci ?',
			sessionId: `${TAG}-read`,
			activityId,
		});
		report.scenarios.read = read.status === 200 && read.body?.v2Http?.handled
			? pass('V2 primary READ', { cutoverMode: read.body?.cutoverMode })
			: fail('V2 primary READ', read.body);

		const proposal = await postChat(baseUrl, {
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			sessionId: `${TAG}-act`,
			activityId,
		});
		report.scenarios.proposal = proposal.body?.noN8nFallback === true
			? pass('ACTION proposal NO_FALLBACK')
			: fail('ACTION proposal', proposal.body?.v2Http);

		server.close();

		const allPass = Object.values(report.scenarios).every((s) => s.status === 'PASS');
		report.verdict = allPass ? 'GO — H7 staging smoke' : 'NO-GO — H7 staging smoke';
	} finally {
		for (const cid of cleanup.clientIds) {
			await admin.from('chat_messages').delete().eq('client_id', cid);
			await admin.from('agent_sessions').delete().eq('client_id', cid);
			await admin.from('activities').delete().eq('client_id', cid);
			await admin.from('clients').delete().eq('id', cid);
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
