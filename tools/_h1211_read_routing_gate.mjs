#!/usr/bin/env node
/**
 * H12.1.1 — READ routing observability gate (READ-only, no financial writes).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Client } from 'ssh2';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const apiRoot = path.join(webRoot, 'apps', 'api');
const BASE = 'https://ashledger.tech';
const PB = `${BASE}/hcgi/platform/api`;
const API = `${BASE}/hcgi/api`;
const EMAIL = process.env.ASH_TEST_EMAIL || 'ketura870@gmail.com';
const CONTAINER = 'ash-ledger-api-v2-ash-ledger-api-1';
const HOST = '187.124.187.13';
const KEY_PATH = `${process.env.TEMP}/ashledger-deploy-key/ashledger_deploy`;
const TAG = `h1211-${Date.now()}`;
const REPORT_PATH = `${process.env.TEMP}/h1211_report.json`;
const H11_READ_P50 = 1037;

const READ_SCENARIOS = [
	{ key: 'sales', message: 'Quelles sont mes ventes ?', expectedCapability: 'SALES' },
	{ key: 'expenses', message: 'Quelles sont mes dépenses ?', expectedCapability: 'EXPENSES' },
	{ key: 'stock', message: 'Quel est mon stock ?', expectedCapability: 'STOCK' },
	{ key: 'products', message: 'Liste mes produits', expectedCapability: 'PRODUCTS' },
	{ key: 'debts', message: 'Qui me doit de l\'argent ?', expectedCapability: 'DEBTS' },
	{ key: 'profit', message: 'Quel est mon bénéfice ?', expectedCapability: 'PROFIT' },
	{ key: 'report', message: 'Fais-moi le point', expectedCapability: 'REPORT' },
];

const report = {
	phase: 'H12.1.1',
	tag: TAG,
	gitAudit: null,
	baseline: null,
	scenarios: {},
	metricsBefore: null,
	metricsAfter: null,
	metricsDelta: null,
	latency: {},
	financialDelta: null,
	localTests: null,
	security: {},
	verdict: 'H12.1.1_NO_GO',
	errors: [],
};

function stats(v) {
	if (!v.length) return { count: 0, min: null, p50: null, p95: null, max: null };
	const s = [...v].sort((a, b) => a - b);
	return {
		count: s.length,
		min: s[0],
		p50: s[Math.floor(s.length / 2)],
		p95: s[Math.floor(s.length * 0.95)] ?? s[s.length - 1],
		max: s[s.length - 1],
	};
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

async function dockerNode(conn, js) {
	const out = await sshExec(conn, `echo ${Buffer.from(js).toString('base64')} | base64 -d | docker exec -i ${CONTAINER} node`);
	return JSON.parse(out.split('\n').pop());
}

async function http(method, url, { token, body, activityId, headers = {} } = {}) {
	const h = { Accept: 'application/json', ...headers };
	if (token) h.Authorization = `Bearer ${token}`;
	if (activityId) h['X-Activity-Id'] = activityId;
	if (body) h['Content-Type'] = 'application/json; charset=UTF-8';
	const t0 = Date.now();
	const res = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
	const text = await res.text();
	let json = null;
	try { json = JSON.parse(text); } catch { /* */ }
	return {
		status: res.status,
		json,
		ms: Date.now() - t0,
		correlationId: res.headers.get('X-Ash-Read-Correlation') || res.headers.get('x-ash-read-correlation'),
		rawText: text,
	};
}

async function chat(token, activityId, message, sessionId) {
	return http('POST', `${API}/api/ashy/chat`, {
		token,
		activityId,
		body: { message, sessionId: sessionId || TAG },
	});
}

async function fetchMetrics(conn, internalKey) {
	return dockerNode(conn, `
const http=require('http');
const key=${JSON.stringify(internalKey)};
const req=http.request({hostname:'127.0.0.1',port:3000,path:'/api/read-routing/metrics',method:'GET',headers:{'x-ash-internal-key':key}},res=>{let b='';res.on('data',d=>b+=d);res.on('end',()=>console.log(b));});
req.on('error',e=>{console.log(JSON.stringify({error:e.message}));process.exit(1);});
req.end();`);
}

async function fetchCounts(conn, clientId, activityId) {
	return dockerNode(conn, `
const{createClient}=require('@supabase/supabase-js');global.WebSocket=require('ws');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{const cid=${JSON.stringify(clientId)};const aid=${JSON.stringify(activityId)};
async function c(t,o){let q=sb.from(t).select(o.col||'id',{count:'exact',head:true});
if(o.client)q=q.eq('client_id',cid);if(o.activity)q=q.eq('activity_id',aid);
const{count,error}=await q;if(error)throw error;return count??0;}
console.log(JSON.stringify({
ventes:await c('ventes',{client:true,activity:true}),
depenses:await c('depenses',{client:true,activity:true}),
stocks:await c('stocks',{client:true,activity:true,col:'*'}),
produits:await c('produits',{client:true,activity:true}),
agent_write_operations:await c('agent_write_operations',{client:true,activity:false}),
}));})();`);
}

function runLocalTests() {
	const obs = spawnSync(process.execPath, ['--test', 'tests/read-routing-observability.test.js'], { cwd: apiRoot, encoding: 'utf8' });
	const transport = spawnSync(process.execPath, ['--test', 'src/lib/chatTransport.test.js'], { cwd: webRoot, encoding: 'utf8' });
	const parse = (o) => {
		const m = `${o.stdout || ''}\n${o.stderr || ''}`.match(/# pass (\d+)[\s\S]*# fail (\d+)/);
		return { pass: Number(m?.[1] || 0), fail: Number(m?.[2] || 0), exitCode: o.status };
	};
	return {
		readRoutingObs: parse(obs),
		chatTransport: parse(transport),
	};
}

function snap(r, label, expectedCapability) {
	const d = r.json || {};
	const v = d.v2Http || {};
	return {
		label,
		status: r.status,
		ms: r.ms,
		correlationId: r.correlationId,
		goalType: v.goalType,
		goalDomain: v.goalDomain,
		executionCode: v.executionCode || v.responseStatus,
		primaryPath: d.primaryPath,
		fallbackPolicy: d.fallbackPolicy,
		noN8nFallback: d.noN8nFallback,
		expectedCapability,
		path: v.goalDomain === expectedCapability || (expectedCapability === 'REPORT' && v.goalDomain === 'GENERAL')
			? 'V2'
			: (r.status === 200 ? 'V2_OR_LEGACY' : 'ERROR'),
	};
}

function metricsDelta(before, after) {
	if (!before?.global || !after?.global) return null;
	const delta = { global: {}, byCapability: {} };
	for (const k of Object.keys(after.global)) {
		delta.global[k] = (after.global[k] || 0) - (before.global[k] || 0);
	}
	for (const cap of new Set([...Object.keys(before.byCapability || {}), ...Object.keys(after.byCapability || {})])) {
		delta.byCapability[cap] = {};
		for (const outcome of ['READ_V2_SUCCESS', 'READ_V2_ERROR', 'READ_SAFE_FALLBACK', 'READ_LEGACY', 'READ_N8N_FALLBACK']) {
			delta.byCapability[cap][outcome] = (after.byCapability?.[cap]?.[outcome] || 0) - (before.byCapability?.[cap]?.[outcome] || 0);
		}
	}
	return delta;
}

async function main() {
	report.gitAudit = {
		localHead: spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: webRoot, encoding: 'utf8' }).stdout?.trim(),
		originMaster: spawnSync('git', ['rev-parse', '--short', 'origin/master'], { cwd: webRoot, encoding: 'utf8' }).stdout?.trim(),
	};

	report.localTests = runLocalTests();
	if (report.localTests.readRoutingObs.fail > 0) {
		throw new Error('LOCAL_READ_ROUTING_TESTS_FAIL');
	}

	const password = process.env.ASH_TEST_PASSWORD;
	if (!password) throw new Error('ASH_TEST_PASSWORD required');

	const conn = await sshConnect();
	try {
		const internalKey = await sshExec(conn, `docker exec ${CONTAINER} printenv ASH_INTERNAL_HEALTH_KEY`).catch(() => '');
		report.metricsBefore = internalKey ? await fetchMetrics(conn, internalKey.trim()) : { NOT_INSTRUMENTED: true };

		const auth = await http('POST', `${PB}/collections/users/auth-with-password`, {
			body: { identity: EMAIL, password },
		});
		if (auth.status !== 200) throw new Error(`AUTH_${auth.status}`);
		const token = auth.json.token;
		report.security.authContainsPassword = JSON.stringify(auth.rawText || '').includes(password);
		const me = await http('GET', `${API}/api/me`, { token });
		const clientId = me.json?.user?.clientId;
		const activityId = me.json?.user?.activeActivityId;
		if (!clientId || !activityId) throw new Error('AUTH_SCOPE_MISSING');

		report.baseline = await fetchCounts(conn, clientId, activityId);

		const salesMs = [];
		for (const scenario of READ_SCENARIOS) {
			const r = await chat(token, activityId, scenario.message, `${TAG}-${scenario.key}`);
			if (scenario.key === 'sales') salesMs.push(r.ms);
			report.scenarios[scenario.key] = snap(r, scenario.message, scenario.expectedCapability);
			await new Promise((resolve) => setTimeout(resolve, 300));
		}

		const foreign = await chat(token, '00000000-0000-0000-0000-000000000099', READ_SCENARIOS[0].message);
		report.security.foreignActivity = { status: foreign.status, pass: foreign.status === 403 };

		report.metricsAfter = internalKey ? await fetchMetrics(conn, internalKey.trim()) : { NOT_INSTRUMENTED: true };
		report.metricsDelta = metricsDelta(report.metricsBefore, report.metricsAfter);

		const after = await fetchCounts(conn, clientId, activityId);
		const FIN = ['ventes', 'depenses', 'stocks', 'produits', 'agent_write_operations'];
		report.financialDelta = Object.fromEntries(FIN.map((k) => [k, after[k] - report.baseline[k]]));
		report.financialDeltaZero = FIN.every((k) => report.financialDelta[k] === 0);

		report.latency.salesRead = stats(salesMs);
		report.latency.h11ReferenceP50 = H11_READ_P50;

		const salesScenario = report.scenarios.sales;
		const salesObservable = salesScenario.status === 200
			&& salesScenario.goalDomain === 'SALES'
			&& salesScenario.executionCode === 'SUCCESS'
			&& Boolean(salesScenario.correlationId);
		const salesMetricsOk = report.metricsDelta?.byCapability?.SALES?.READ_V2_SUCCESS >= 1
			|| report.metricsAfter?.byCapability?.SALES?.READ_V2_SUCCESS >= 1;
		const actionToN8nZero = (report.metricsAfter?.global?.ACTION_TO_N8N_FALLBACK || 0) === 0;
		const noSecretsInMetrics = !JSON.stringify(report.metricsAfter || {}).match(/Bearer|password|service_role/i);

		report.security.noSecretsInMetrics = noSecretsInMetrics;
		report.observability = {
			salesObservable,
			salesMetricsOk,
			actionToN8nZero,
			correlationPresent: Boolean(salesScenario.correlationId),
		};

		if (salesObservable && report.financialDeltaZero && report.security.foreignActivity.pass && actionToN8nZero && noSecretsInMetrics) {
			const gaps = [];
			if (!internalKey || report.metricsAfter?.NOT_INSTRUMENTED) gaps.push('METRICS_ENDPOINT');
			if (!salesMetricsOk) gaps.push('SALES_V2_COUNTER');
			report.verdict = gaps.length ? 'H12.1.1_GO_WITH_GAPS' : 'H12.1.1_GO';
			report.gaps = gaps;
		}
	} finally {
		conn.end();
	}

	writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
	console.log(JSON.stringify({
		verdict: report.verdict,
		reportPath: REPORT_PATH,
		observability: report.observability,
		metricsDelta: report.metricsDelta,
		financialDelta: report.financialDelta,
		scenarios: report.scenarios,
	}, null, 2));
	process.exit(report.verdict.startsWith('H12.1.1_GO') ? 0 : 1);
}

main().catch((e) => {
	report.errors.push(e.message);
	writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
	console.error(e);
	process.exit(1);
});
