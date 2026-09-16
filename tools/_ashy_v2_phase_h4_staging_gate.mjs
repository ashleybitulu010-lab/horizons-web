#!/usr/bin/env node
/**
 * Phase H4 — n8n fallback safety boundary (vwjkktqcmmhotadicbpg only).
 *
 *   node --env-file=apps/api/.env.staging tools/_ashy_v2_phase_h4_staging_gate.mjs
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const STAGING_REF = 'vwjkktqcmmhotadicbpg';
const PRODUCTION_REF = 'knrwplidgvuvjnuqqmrt';
const TAG = `phase-h4-${Date.now()}`;

process.env.ASHY_INTELLIGENCE_V2 = 'true';
process.env.ASHY_INTELLIGENCE_V2_HTTP = 'true';
process.env.ASHY_INTELLIGENCE_V2_ACTIONS = 'true';
process.env.ASHY_INTELLIGENCE_V2_HTTP_CONFIRM = 'true';
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
	const email = `${TAG}-${label}-${randomUUID()}@phaseh4.ashledger.test`;
	const { data, error } = await admin.auth.admin.createUser({
		email,
		password: `H4!${randomUUID().slice(0, 8)}`,
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

async function countRows(admin, table, clientId, activityId) {
	const { count, error } = await admin
		.from(table)
		.select('id', { count: 'exact', head: true })
		.eq('client_id', clientId)
		.eq('activity_id', activityId);
	if (error) throw error;
	return count ?? 0;
}

async function postAshy(baseUrl, { message, sessionId, activityId }) {
	const res = await fetch(`${baseUrl}/api/ashy/chat`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Activity-Id': activityId,
		},
		body: JSON.stringify({ message, sessionId }),
	});
	const body = await res.json().catch(() => ({}));
	return { status: res.status, body };
}

async function main() {
	assertStagingOnly();

	const report = {
		tag: TAG,
		target: STAGING_REF,
		scenarios: {},
		notSimulated: ['post-commit HTTP network loss', 'READ n8n fallback live webhook'],
		verdict: 'NO-GO',
	};

	const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
		auth: { persistSession: false, autoRefreshToken: false },
	});

	const cleanup = { authUserIds: [], clientIds: [] };

	try {
		const { default: ashyChat } = await import('../apps/api/src/routes/api/ashy-chat.js');
		const { resolveActivityScope } = await import('../apps/api/src/middleware/activity-scope.js');
		const { rejectForeignScope } = await import('../apps/api/src/middleware/auth.js');
		const { fetchChatResponse } = await import('../src/lib/chatTransport.js');
		const { CHAT_ROUTE } = await import('../src/lib/chatRouter.js');

		const authA = await createAuthUser(admin, 'client-a');
		cleanup.authUserIds.push(authA);
		const clientA = await createClientRow(admin, authA, 'client-a');
		cleanup.clientIds.push(clientA);
		const activityA1 = await createActivity(admin, clientA, 'A1', true);

		const userA1 = {
			id: authA,
			clientId: clientA,
			activeActivityId: activityA1,
			businessUserId: `${TAG}-a1`,
		};

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
		const baseUrl = `http://127.0.0.1:${server.address().port}`;

		const sendAshy = async ({ message, sessionId }) => {
			const res = await fetch(`${baseUrl}/api/ashy/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Activity-Id': activityA1 },
				body: JSON.stringify({ message, sessionId }),
			});
			const rawText = await res.text();
			let data = {};
			try { data = rawText ? JSON.parse(rawText) : {}; } catch { data = {}; }
			return { ok: res.ok, status: res.status, rawText, data, route: 'ashy' };
		};

		let n8nCalls = 0;
		const sendN8n = async () => {
			n8nCalls += 1;
			return {
				ok: true,
				status: 200,
				rawText: '{"reply":"n8n should not run"}',
				data: { reply: 'n8n should not run' },
				route: 'n8n',
			};
		};

		// READ contract via direct Ashy
		const readRes = await postAshy(baseUrl, {
			message: 'Combien ai-je vendu ce mois-ci ?',
			sessionId: `${TAG}-read`,
			activityId: activityA1,
		});

		// ACTION proposal contract
		const depBefore = await countRows(admin, 'depenses', clientA, activityA1);
		const proposalRes = await postAshy(baseUrl, {
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			sessionId: `${TAG}-prop`,
			activityId: activityA1,
		});
		const depAfterProposal = await countRows(admin, 'depenses', clientA, activityA1);

		n8nCalls = 0;
		const transportProposal = await fetchChatResponse({
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			chatRoute: CHAT_ROUTE.ASHY,
			sessionId: `${TAG}-tr-prop`,
			user: userA1,
			stableId: userA1.id,
			currency: { currency: 'USD' },
			recentMessages: [],
			token: null,
			sendAshy,
			sendN8n,
		});

		n8nCalls = 0;
		const transportConfirm = await fetchChatResponse({
			message: 'Oui',
			chatRoute: CHAT_ROUTE.ASHY,
			sessionId: `${TAG}-tr-conf`,
			user: userA1,
			stableId: userA1.id,
			currency: { currency: 'USD' },
			recentMessages: [],
			token: null,
			pendingAshyWriteConfirmation: true,
			sendAshy: async () => {
				await postAshy(baseUrl, {
					message: 'Ajoute une dépense de 30 dollars pour le transport',
					sessionId: `${TAG}-tr-conf`,
					activityId: activityA1,
				});
				return sendAshy({ message: 'Oui', sessionId: `${TAG}-tr-conf` });
			},
			sendN8n,
		});
		const depAfterConfirm = await countRows(admin, 'depenses', clientA, activityA1);

		n8nCalls = 0;
		const transportAction500 = await fetchChatResponse({
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			chatRoute: CHAT_ROUTE.ASHY,
			sessionId: `${TAG}-500`,
			user: userA1,
			stableId: userA1.id,
			currency: { currency: 'USD' },
			recentMessages: [],
			token: null,
			sendAshy: async () => ({
				ok: false,
				status: 500,
				rawText: '{}',
				data: { noN8nFallback: true, fallbackPolicy: 'NO_FALLBACK' },
				route: 'ashy',
			}),
			sendN8n,
		});

		report.scenarios.readSafeFallback = readRes.status === 200
			&& readRes.body?.noN8nFallback === false
			&& readRes.body?.fallbackPolicy === 'SAFE_FALLBACK'
			? pass('READ exposes SAFE_FALLBACK', {
				fallbackPolicy: readRes.body?.fallbackPolicy,
			})
			: fail('READ fallback policy', readRes.body);

		report.scenarios.actionProposalNoFallback = proposalRes.status === 200
			&& proposalRes.body?.noN8nFallback === true
			&& proposalRes.body?.v2Http?.actionProposalStatus === 'READY_FOR_CONFIRMATION'
			&& depAfterProposal === depBefore
			? pass('ACTION proposal noN8nFallback', {
				status: proposalRes.body?.v2Http?.actionProposalStatus,
			})
			: fail('ACTION proposal', { proposalRes: proposalRes.body, depBefore, depAfterProposal });

		report.scenarios.transportProposalNoN8n = n8nCalls === 0
			&& transportProposal.noN8nFallback !== false
			? pass('chatTransport proposal blocked n8n', { n8nCalls, blocked: transportProposal.ashyFallbackBlocked })
			: fail('transport proposal n8n', { n8nCalls, transportProposal });

		report.scenarios.transportConfirmNoN8n = n8nCalls === 0
			&& depAfterConfirm === depBefore + 1
			? pass('chatTransport confirm blocked n8n + single write', {
				n8nCalls,
				depAfterConfirm,
				f4Committed: transportConfirm.data?.v2Http?.f4Committed,
			})
			: fail('transport confirm', { n8nCalls, depAfterConfirm, transportConfirm });

		report.scenarios.action500NoN8n = n8nCalls === 0
			&& transportAction500.ashyFallbackBlocked === true
			? pass('ACTION HTTP 500 blocked n8n', { n8nCalls })
			: fail('ACTION 500 n8n', { n8nCalls, transportAction500 });

		server.close();

		const allPass = Object.values(report.scenarios).every((s) => s.status === 'PASS');
		report.verdict = allPass ? 'GO — Phase H4 fallback boundary validated' : 'NO-GO — Phase H4 staging failures';
	} finally {
		for (const clientId of cleanup.clientIds) {
			await admin.from('chat_messages').delete().eq('client_id', clientId);
			await admin.from('agent_sessions').delete().eq('client_id', clientId);
			await admin.from('agent_write_operations').delete().eq('client_id', clientId);
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
