#!/usr/bin/env node
/**
 * H10.1 — Write intent hardening gate.
 * Deploys classifier fix, validates staging + production read-only.
 * Does NOT enable ACTIONS or CONFIRM.
 *
 *   node --env-file=apps/api/.env.staging tools/_h101_write_intent_gate.mjs
 */
import { spawnSync } from 'node:child_process';
import { Client } from 'ssh2';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { classifyGoal } from '../apps/api/src/agent/intelligence-v2/goal-classifier.js';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const apiRoot = path.join(webRoot, 'apps/api');
const KEY_PATH = `${process.env.TEMP}/ashledger-deploy-key/ashledger_deploy`;
const HOST = '187.124.187.13';
const REMOTE_API = '/opt/ashledger/apps/api';
const CONTAINER = 'ash-ledger-api-v2-ash-ledger-api-1';
const BASE = 'https://ashledger.tech';
const PB = `${BASE}/hcgi/platform/api`;
const API = `${BASE}/hcgi/api`;
const EMAIL = process.env.ASH_TEST_EMAIL || 'ketura870@gmail.com';
const STAGING_REF = 'vwjkktqcmmhotadicbpg';
const PRODUCTION_REF = 'knrwplidgvuvjnuqqmrt';
const TAG = `h101-${Date.now()}`;
const H92_P50 = 686;
const H92_P95 = 1103;

const DEPLOY_FILES = [
	'src/agent/intelligence-v2/goal-classifier-rules.js',
	'tests/intelligence-v2-classifier-h101.test.js',
];

const READ_SAMPLES = [
	'Quelles sont mes ventes ?',
	'Quel est mon stock ?',
	'Quels sont mes produits ?',
	'Compare mes ventes.',
	'Qui me doit de l\'argent ?',
	'Quel est mon bénéfice ?',
];

const report = {
	phase: 'H10.1',
	tag: TAG,
	errors: [],
	notSimulated: [],
	verdict: 'NO_GO',
};

function pass(name, detail = null) { return { name, status: 'PASS', detail }; }
function fail(name, detail) { return { name, status: 'FAIL', detail }; }

function stats(v) {
	if (!v.length) return { count: 0, min: null, max: null, mean: null, p50: null, p95: null };
	const s = [...v].sort((a, b) => a - b);
	return {
		count: s.length, min: s[0], max: s[s.length - 1],
		mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
		p50: s[Math.floor(s.length / 2)],
		p95: s[Math.floor(s.length * 0.95)] ?? s[s.length - 1],
	};
}

function assertStagingRef() {
	const url = process.env.SUPABASE_URL || '';
	const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
	const ref = match ? match[1].toLowerCase() : null;
	if (ref === PRODUCTION_REF) throw new Error('Production Supabase blocked for staging section');
	if (ref !== STAGING_REF) throw new Error(`Expected staging ${STAGING_REF}, got ${ref || url}`);
}

function sshConnect() {
	return new Promise((resolve, reject) => {
		const c = new Client();
		c.on('ready', () => resolve(c)).on('error', reject)
			.connect({ host: HOST, username: 'root', privateKey: readFileSync(KEY_PATH) });
	});
}

function sshExec(conn, cmd) {
	return new Promise((resolve, reject) => {
		conn.exec(cmd, (err, st) => {
			if (err) return reject(err);
			let o = '';
			st.on('data', (d) => { o += d.toString(); });
			st.stderr.on('data', (d) => { o += d.toString(); });
			st.on('close', (code) => (code ? reject(new Error(o)) : resolve(o.trim())));
		});
	});
}

function sftpUpload(conn, localPath, remotePath) {
	return new Promise((resolve, reject) => {
		conn.sftp((err, sftp) => {
			if (err) return reject(err);
			sftp.fastPut(localPath, remotePath, (putErr) => (putErr ? reject(putErr) : resolve()));
		});
	});
}

async function http(method, url, { token, body, activityId } = {}) {
	const h = { Accept: 'application/json' };
	if (token) h.Authorization = `Bearer ${token}`;
	if (activityId) h['X-Activity-Id'] = activityId;
	if (body) h['Content-Type'] = 'application/json; charset=UTF-8';
	const t0 = Date.now();
	const res = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
	const text = await res.text();
	let json = null;
	try { json = JSON.parse(text); } catch { /* */ }
	return { status: res.status, json, ms: Date.now() - t0 };
}

function snap(r, msg) {
	const d = r.json || {}; const v = d.v2Http || {};
	return {
		message: msg.slice(0, 80), status: r.status, ms: r.ms,
		goalType: v.goalType, goalDomain: v.goalDomain, goalObjective: v.goalObjective,
		actionStatus: v.actionStatus, actionProposalStatus: v.actionProposalStatus,
		responseStatus: v.responseStatus, executionCode: v.executionCode,
		cutoverMode: d.cutoverMode || v.cutoverMode,
	};
}

async function fetchCounts(conn, clientId, activityId) {
	const js = `const{createClient}=require('@supabase/supabase-js');global.WebSocket=require('ws');const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});(async()=>{const cid=${JSON.stringify(clientId)};const aid=${JSON.stringify(activityId)};async function c(t,o){let q=sb.from(t).select(o.col||'id',{count:'exact',head:true});if(o.client)q=q.eq('client_id',cid);if(o.activity)q=q.eq('activity_id',aid);const{count}=await q;return count??0;}console.log(JSON.stringify({ventes:await c('ventes',{client:true,activity:true}),depenses:await c('depenses',{client:true,activity:true}),stocks:await c('stocks',{client:true,activity:true,col:'*'}),produits:await c('produits',{client:true,activity:true}),agent_write_operations:await c('agent_write_operations',{client:true,activity:false})}));})();`;
	const out = await sshExec(conn, `echo ${Buffer.from(js).toString('base64')} | base64 -d | docker exec -i ${CONTAINER} node`);
	return JSON.parse(out.split('\n').pop());
}

async function runLocalTests() {
	const r = spawnSync(process.execPath, ['--test', 'tests/intelligence-v2-classifier-h101.test.js'], {
		cwd: apiRoot, encoding: 'utf8',
	});
	return {
		exitCode: r.status,
		stdout: r.stdout?.slice(-2000) || '',
		stderr: r.stderr?.slice(-1000) || '',
	};
}

async function runStagingClassifier() {
	assertStagingRef();
	const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
	const { data: activities } = await sb.from('activities').select('id, client_id').limit(1);
	const activity = activities?.[0];
	if (!activity) throw new Error('No staging activity found');

	const [{ count: produits }, { count: stocks }] = await Promise.all([
		sb.from('produits').select('id', { count: 'exact', head: true }).eq('activity_id', activity.id),
		sb.from('stocks').select('*', { count: 'exact', head: true }).eq('activity_id', activity.id),
	]);

	const refDate = new Date('2026-09-12T12:00:00.000Z');
	const cases = [
		{ msg: "J'ai dépensé de l'argent pour le transport.", expect: { type: 'ACTION', domain: 'EXPENSES', objective: 'CREATE' } },
		{ msg: "J'ai vendu 1 poulet à 2 dollars.", expect: { type: 'ACTION', domain: 'SALES', objective: 'CREATE' } },
	];
	const results = [];
	for (const c of cases) {
		const r = await classifyGoal(c.msg, {}, { referenceDate: refDate, forceRules: true });
		const g = r.goal;
		const ok = g?.type === c.expect.type && g?.domain === c.expect.domain && g?.objective === c.expect.objective;
		results.push({ message: c.msg, ok, goal: g, source: r.source });
	}

	return {
		activityId: activity.id,
		produits: produits ?? 0,
		stocks: stocks ?? 0,
		results,
		allPass: results.every((x) => x.ok),
	};
}

async function main() {
	const password = process.env.ASH_TEST_PASSWORD;
	if (!password) throw new Error('ASH_TEST_PASSWORD required');

	report.localTests = runLocalTests();
	report.scenarios = {};
	report.scenarios.localH101 = report.localTests.exitCode === 0
		? pass('H10.1 unit tests', { exitCode: 0 })
		: fail('H10.1 unit tests', { exitCode: report.localTests.exitCode, stderr: report.localTests.stderr });

	if (process.env.RUN_STAGING === 'true') {
		report.scenarios.stagingClassifier = await runStagingClassifier();
		report.scenarios.staging = report.scenarios.stagingClassifier.allPass
			? pass('staging classifier empty catalog', report.scenarios.stagingClassifier)
			: fail('staging classifier', report.scenarios.stagingClassifier);
	} else {
		report.notSimulated.push('staging DB classifier (set RUN_STAGING=true with .env.staging)');
	}

	const conn = await sshConnect();
	try {
		report.deploy = [];
		for (const rel of DEPLOY_FILES) {
			await sftpUpload(conn, path.join(apiRoot, rel), `${REMOTE_API}/${rel}`);
			report.deploy.push(rel);
		}
		report.rebuild = await sshExec(conn, 'cd /docker/ash-ledger-api-v2 && docker compose -f docker-compose.parallel.yml build ash-ledger-api && docker compose -f docker-compose.parallel.yml up -d ash-ledger-api');

		const flagScript = readFileSync(new URL('./_ashy_v2_phase_h7_prod_flag_audit.sh', import.meta.url), 'utf8');
		const flags = (await sshExec(conn, `echo ${Buffer.from(flagScript).toString('base64')} | base64 -d | bash`)).split('\n').filter((l) => /^(OFF|ON|ABS):/.test(l));
		report.flags = flags;
		report.flagsState = {
			v2: flags.some((l) => l.startsWith('ON:ASHY_INTELLIGENCE_V2:')),
			http: flags.some((l) => l.startsWith('ON:ASHY_INTELLIGENCE_V2_HTTP:')),
			primary: flags.some((l) => l.startsWith('ON:ASHY_INTELLIGENCE_V2_PRIMARY:')),
			actions: flags.some((l) => l.startsWith('ON:ASHY_INTELLIGENCE_V2_ACTIONS:')),
			confirm: flags.some((l) => l.startsWith('ON:ASHY_INTELLIGENCE_V2_HTTP_CONFIRM:')),
		};
		if (report.flagsState.actions || report.flagsState.confirm) {
			report.errors.push('CRITICAL: ACTIONS or CONFIRM must stay OFF during H10.1');
		}

		const login = await http('POST', `${PB}/collections/users/auth-with-password`, { body: { identity: EMAIL, password } });
		const token = login.json?.token;
		const me = await http('GET', `${API}/api/me`, { token });
		const clientId = me.json?.user?.clientId;
		const activityId = me.json?.user?.activeActivityId;

		report.baseline = await fetchCounts(conn, clientId, activityId);

		const blockerCases = [
			{ msg: "J'ai dépensé de l'argent pour le transport.", expect: { goalType: 'ACTION', goalDomain: 'EXPENSES', goalObjective: 'CREATE', proposalStatus: 'NEEDS_CLARIFICATION' } },
			{ msg: "J'ai vendu 1 poulet à 2 dollars.", expect: { goalType: 'ACTION', goalDomain: 'SALES', goalObjective: 'CREATE' } },
		];
		const blockerResults = [];
		const latencies = [];
		for (let i = 0; i < blockerCases.length; i++) {
			const c = blockerCases[i];
			const r = await http('POST', `${API}/api/ashy/chat`, { token, activityId, body: { message: c.msg, sessionId: `${TAG}-b${i}` } });
			const s = snap(r, c.msg);
			latencies.push(r.ms);
			const classificationOk = r.status === 200
				&& s.goalType === c.expect.goalType
				&& s.goalDomain === c.expect.goalDomain
				&& s.goalObjective === c.expect.goalObjective;
			const actionsOff = !report.flagsState?.actions;
			const writeBlockedOk = actionsOff && s.actionStatus === 'V2_ACTIONS_DISABLED';
			const proposalOk = !c.expect.proposalStatus
				|| s.actionProposalStatus === c.expect.proposalStatus
				|| s.actionStatus === c.expect.proposalStatus
				|| writeBlockedOk;
			const ok = classificationOk && proposalOk && (writeBlockedOk || s.actionStatus === 'NEEDS_CLARIFICATION' || s.actionProposalStatus === 'NEEDS_CLARIFICATION');
			blockerResults.push({ ...s, ok, expect: c.expect });
		}
		report.scenarios.blockers = blockerResults.every((b) => b.ok)
			? pass('H10 blockers fixed (read-only)', blockerResults)
			: fail('H10 blockers', blockerResults);

		const readResults = [];
		for (let i = 0; i < READ_SAMPLES.length; i++) {
			const msg = READ_SAMPLES[i];
			const r = await http('POST', `${API}/api/ashy/chat`, { token, activityId, body: { message: msg, sessionId: `${TAG}-r${i}` } });
			const s = snap(r, msg);
			readResults.push({ ...s, ok: r.status === 200 && s.goalType !== 'ACTION' });
			if (r.status === 200) latencies.push(r.ms);
		}
		report.scenarios.readRegression = readResults.every((r) => r.ok)
			? pass('READ regression', { count: readResults.length })
			: fail('READ regression', readResults.filter((r) => !r.ok));

		report.performance = {
			samples: latencies.length,
			stats: stats(latencies),
			h92Baseline: { p50: H92_P50, p95: H92_P95 },
			deltaP50: stats(latencies).p50 != null ? stats(latencies).p50 - H92_P50 : null,
			deltaP95: stats(latencies).p95 != null ? stats(latencies).p95 - H92_P95 : null,
		};

		report.finalSnapshot = await fetchCounts(conn, clientId, activityId);
		report.financialDelta = {};
		for (const k of Object.keys(report.baseline)) {
			report.financialDelta[k] = report.finalSnapshot[k] - report.baseline[k];
		}
		report.scenarios.financialIntegrity = Object.values(report.financialDelta).every((v) => v === 0)
			? pass('financial delta zero', report.financialDelta)
			: fail('financial delta', report.financialDelta);

		const blockersOk = report.scenarios.blockers?.status === 'PASS';
		const readOk = report.scenarios.readRegression?.status === 'PASS';
		const localOk = report.scenarios.localH101?.status === 'PASS';
		const finOk = report.scenarios.financialIntegrity?.status === 'PASS';
		const flagsOk = !report.flagsState.actions && !report.flagsState.confirm;
		const perfWarn = report.performance.stats.p95 > H92_P95;

		if (blockersOk && readOk && localOk && finOk && flagsOk) {
			report.verdict = perfWarn ? 'GO_WITH_PERFORMANCE_WARNING' : 'GO_H10_2_READY';
		} else {
			report.verdict = 'NO_GO';
		}
	} finally {
		conn.end();
	}

	const outPath = `${process.env.TEMP}/h101_prod_report.json`;
	writeFileSync(outPath, JSON.stringify(report, null, 2));
	console.log(JSON.stringify({
		verdict: report.verdict,
		flagsState: report.flagsState,
		blockers: report.scenarios.blockers,
		financialDelta: report.financialDelta,
		performance: report.performance,
		artifact: outPath,
	}, null, 2));
}

main().catch((e) => {
	report.errors.push(e.message);
	writeFileSync(`${process.env.TEMP}/h101_prod_report.json`, JSON.stringify(report, null, 2));
	console.error('FATAL:', e.message);
	process.exit(1);
});
