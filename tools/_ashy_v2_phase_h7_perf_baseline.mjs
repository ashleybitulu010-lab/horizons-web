#!/usr/bin/env node
/**
 * Phase H7 — V2 READ latency baseline (staging only, 5 samples).
 *
 *   node --env-file=apps/api/.env.staging tools/_ashy_v2_phase_h7_perf_baseline.mjs
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const STAGING_REF = 'vwjkktqcmmhotadicbpg';
const PRODUCTION_REF = 'knrwplidgvuvjnuqqmrt';
const SAMPLES = 5;
const READ_MESSAGE = 'Combien ai-je vendu ce mois-ci ?';

process.env.ASHY_INTELLIGENCE_V2 = 'true';
process.env.ASHY_INTELLIGENCE_V2_HTTP = 'true';
process.env.ASHY_INTELLIGENCE_V2_PRIMARY = 'true';
process.env.ASHY_INTELLIGENCE_V2_SHADOW = 'false';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function assertStagingOnly() {
	const ref = (SUPABASE_URL.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i) || [])[1]?.toLowerCase();
	if (ref === PRODUCTION_REF) throw new Error('Production blocked');
	if (ref !== STAGING_REF) throw new Error(`Expected staging ${STAGING_REF}`);
}

function stats(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const sum = sorted.reduce((a, b) => a + b, 0);
	const p50 = sorted[Math.floor(sorted.length / 2)] ?? null;
	return {
		count: sorted.length,
		min: sorted[0] ?? null,
		max: sorted[sorted.length - 1] ?? null,
		mean: sorted.length ? Math.round(sum / sorted.length) : null,
		p50,
		samples: sorted,
	};
}

async function main() {
	assertStagingOnly();
	if (process.env.RUN_STAGING !== 'true') throw new Error('RUN_STAGING must be true');

	const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
		auth: { persistSession: false, autoRefreshToken: false },
	});

	const tag = `h7-perf-${Date.now()}`;
	const auth = (await admin.auth.admin.createUser({
		email: `${tag}@perf.ashledger.test`,
		password: `P!${randomUUID().slice(0, 8)}`,
		email_confirm: true,
	})).data.user.id;

	const clientId = (await admin.from('clients').insert({
		user_id: tag,
		nom_client: tag,
		auth_user_id: auth,
	}).select('id').single()).data.id;

	const activityId = (await admin.from('activities').insert({
		client_id: clientId,
		name: 'perf',
		type: 'commerce',
		is_default: true,
	}).select('id').single()).data.id;

	const user = { id: auth, clientId, activeActivityId: activityId, businessUserId: tag };
	const { default: ashyChat } = await import('../apps/api/src/routes/api/ashy-chat.js');
	const { resolveActivityScope } = await import('../apps/api/src/middleware/activity-scope.js');
	const { rejectForeignScope } = await import('../apps/api/src/middleware/auth.js');

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

	const latencies = [];
	for (let i = 0; i < SAMPLES; i += 1) {
		const t0 = Date.now();
		const res = await fetch(`${baseUrl}/api/ashy/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Activity-Id': activityId },
			body: JSON.stringify({ message: READ_MESSAGE, sessionId: `${tag}-${i}` }),
		});
		const body = await res.json().catch(() => ({}));
		const ms = Date.now() - t0;
		latencies.push(ms);
		if (res.status !== 200 || !body?.v2Http?.handled) {
			console.error('Sample failed', { i, status: res.status, body: body?.v2Http });
		}
	}

	server.close();
	await admin.from('chat_messages').delete().eq('client_id', clientId);
	await admin.from('agent_sessions').delete().eq('client_id', clientId);
	await admin.from('activities').delete().eq('client_id', clientId);
	await admin.from('clients').delete().eq('id', clientId);
	await admin.auth.admin.deleteUser(auth);

	const report = {
		target: STAGING_REF,
		message: READ_MESSAGE,
		latencyMs: stats(latencies),
		note: 'Single-process local server; not identical to VPS production path',
		performanceWarning: stats(latencies).p50 > 5000,
	};
	console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
