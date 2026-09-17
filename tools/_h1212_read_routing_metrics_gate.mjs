#!/usr/bin/env node
/**
 * H12.1.2 — READ routing metrics endpoint verification (READ-only, no runtime changes).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Client } from 'ssh2';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const apiRoot = `${webRoot}/apps/api`;
const BASE = 'https://ashledger.tech';
const PB = `${BASE}/hcgi/platform/api`;
const API = `${BASE}/hcgi/api`;
const EMAIL = process.env.ASH_TEST_EMAIL || 'ketura870@gmail.com';
const CONTAINER = 'ash-ledger-api-v2-ash-ledger-api-1';
const HOST = '187.124.187.13';
const KEY_PATH = `${process.env.TEMP}/ashledger-deploy-key/ashledger_deploy`;
const TAG = `h1212-${Date.now()}`;
const REPORT_PATH = `${process.env.TEMP}/h1212_report.json`;

const READ_SCENARIOS = [
	{ key: 'sales', message: 'Quelles sont mes ventes ?', capability: 'SALES' },
	{ key: 'expenses', message: 'Quelles sont mes dépenses ?', capability: 'EXPENSES' },
	{ key: 'stock', message: 'Quel est mon stock ?', capability: 'STOCK' },
];

const GLOBAL_METRICS = [
	'READ_TOTAL',
	'READ_V2_TOTAL',
	'READ_LEGACY_TOTAL',
	'READ_N8N_FALLBACK_TOTAL',
	'READ_V2_ERROR_TOTAL',
	'READ_SAFE_FALLBACK_TOTAL',
	'ACTION_TO_N8N_FALLBACK',
];

const CAPABILITIES = [
	'SALES', 'EXPENSES', 'STOCK', 'PRODUCTS', 'DEBTS', 'PROFIT', 'REPORT', 'HISTORY',
];

const report = {
	phase: 'H12.1.2',
	tag: TAG,
	endpointAudit: {
		route: 'GET /api/read-routing/metrics',
		publicRoute: 'GET /hcgi/api/api/read-routing/metrics',
		middleware: 'requireInternalHealthKey',
		authHeader: 'x-ash-internal-key',
		envVar: 'ASH_INTERNAL_HEALTH_KEY',
		handler: 'read-routing-metrics.js → getReadRoutingMetricsSnapshot()',
	},
	security: {},
	loopback: {},
	metricsExposed: {},
	metricsBefore: null,
	metricsAfter: null,
	metricsDelta: null,
	controlledReads: {},
	correlation: {},
	fallback: { status: 'NOT_SIMULATED' },
	actionSafety: {},
	financialDelta: null,
	latency: {},
	localTests: null,
	verdict: 'H12.1.2_NO_GO',
	errors: [],
	gaps: [],
};

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

async function dockerExecNode(conn, js) {
	const out = await sshExec(conn, `echo ${Buffer.from(js).toString('base64')} | base64 -d | docker exec -i ${CONTAINER} node`);
	const line = out.split('\n').filter(Boolean).pop();
	return JSON.parse(line);
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

async function fetchCounts(conn, clientId, activityId) {
	return dockerExecNode(conn, `
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

function metricsDelta(before, after) {
	if (!before?.global || !after?.global) return null;
	const delta = { global: {}, byCapability: {} };
	for (const k of GLOBAL_METRICS) {
		delta.global[k] = (after.global[k] || 0) - (before.global[k] || 0);
	}
	for (const cap of new Set([
		...Object.keys(before.byCapability || {}),
		...Object.keys(after.byCapability || {}),
	])) {
		delta.byCapability[cap] = {};
		for (const outcome of ['READ_V2_SUCCESS', 'READ_V2_ERROR', 'READ_SAFE_FALLBACK', 'READ_LEGACY', 'READ_N8N_FALLBACK']) {
			delta.byCapability[cap][outcome] = (after.byCapability?.[cap]?.[outcome] || 0)
				- (before.byCapability?.[cap]?.[outcome] || 0);
		}
	}
	return delta;
}

function auditMetricsExposed(snapshot) {
	const exposed = { global: {}, capabilities: {} };
	if (!snapshot?.global) {
		return { error: 'invalid_snapshot' };
	}
	for (const k of GLOBAL_METRICS) {
		exposed.global[k] = Object.prototype.hasOwnProperty.call(snapshot.global, k)
			? 'EXPOSED'
			: 'NOT_EXPOSED';
	}
	for (const cap of CAPABILITIES) {
		if (snapshot.byCapability?.[cap]) {
			exposed.capabilities[cap] = 'EXPOSED';
		} else {
			exposed.capabilities[cap] = 'NOT_EXPOSED';
		}
	}
	return exposed;
}

function runLocalTests() {
	const obs = spawnSync(process.execPath, ['--test', 'tests/read-routing-observability.test.js'], { cwd: apiRoot, encoding: 'utf8' });
	const parse = (o) => {
		const m = `${o.stdout || ''}\n${o.stderr || ''}`.match(/# pass (\d+)[\s\S]*# fail (\d+)/);
		return { pass: Number(m?.[1] || 0), fail: Number(m?.[2] || 0), exitCode: o.status };
	};
	return { readRoutingObs: parse(obs) };
}

async function loopbackMetricsRequest(conn, mode) {
	const headerBlock = mode === 'none'
		? 'const headers = {};'
		: mode === 'wrong'
			? "const headers = { 'x-ash-internal-key': 'wrong-key-h1212' };"
			: "const headers = { 'x-ash-internal-key': process.env.ASH_INTERNAL_HEALTH_KEY || '' };";
	const js = `
const port = Number(process.env.PORT || 3001);
const url = 'http://127.0.0.1:' + port + '/api/read-routing/metrics';
${headerBlock}
try {
  const res = await fetch(url, { method: 'GET', headers });
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { /* */ }
  console.log(JSON.stringify({ status: res.status, json, port }));
} catch (e) {
  console.log(JSON.stringify({ status: 0, error: e.message, port }));
}
`;
	return dockerExecNode(conn, js);
}

async function fetchMetricsLoopback(conn) {
	const js = `
const port = Number(process.env.PORT || 3001);
const key = process.env.ASH_INTERNAL_HEALTH_KEY;
if (!key) { console.log(JSON.stringify({ error: 'KEY_NOT_CONFIGURED' })); process.exit(0); }
const url = 'http://127.0.0.1:' + port + '/api/read-routing/metrics';
try {
  const res = await fetch(url, { method: 'GET', headers: { 'x-ash-internal-key': key } });
  const text = await res.text();
  console.log(text);
} catch (e) {
  console.log(JSON.stringify({ error: e.message }));
}
`;
	const out = await sshExec(conn, `echo ${Buffer.from(js).toString('base64')} | base64 -d | docker exec -i ${CONTAINER} node`);
	const line = out.split('\n').filter(Boolean).pop();
	return JSON.parse(line);
}

async function checkCorrelationInLogs(conn, correlationId) {
	if (!correlationId) return { found: false, reason: 'no_correlation_id' };
	const safe = correlationId.replace(/[^a-zA-Z0-9-]/g, '');
	const out = await sshExec(
		conn,
		`docker logs ${CONTAINER} 2>&1 | grep "ashy_read_routing" | grep "${safe}" | tail -1 | sed 's/password[^,]*//g'`,
	).catch(() => '');
	return {
		correlationId: safe,
		logLineFound: Boolean(out && out.includes(safe)),
		logSnippet: out ? out.slice(0, 200) : null,
	};
}

async function main() {
	report.localTests = runLocalTests();
	if (report.localTests.readRoutingObs.fail > 0) {
		throw new Error('LOCAL_READ_ROUTING_TESTS_FAIL');
	}

	const password = process.env.ASH_TEST_PASSWORD;
	if (!password) throw new Error('ASH_TEST_PASSWORD required');

	// Public security (never send real key)
	report.security.publicNoKey = await http('GET', `${API}/api/read-routing/metrics`);
	report.security.publicWrongKey = await http('GET', `${API}/api/read-routing/metrics`, {
		headers: { 'x-ash-internal-key': 'wrong-key-h1212-public' },
	});
	report.security.publicNoKeyPass = [401, 403, 404].includes(report.security.publicNoKey.status);
	report.security.publicWrongKeyPass = [401, 403, 404].includes(report.security.publicWrongKey.status);
	report.security.publicNoKeyLeaksMetrics = Boolean(
		report.security.publicNoKey.json?.global?.READ_TOTAL != null
		&& report.security.publicNoKey.status === 200,
	);

	const conn = await sshConnect();
	try {
		const keyConfigured = await sshExec(
			conn,
			`docker exec ${CONTAINER} sh -lc 'test -n "$ASH_INTERNAL_HEALTH_KEY" && echo yes || echo no'`,
		);
		report.loopback.keyConfigured = keyConfigured === 'yes';

		report.security.loopbackNoKey = await loopbackMetricsRequest(conn, 'none');
		report.security.loopbackWrongKey = await loopbackMetricsRequest(conn, 'wrong');
		report.security.loopbackGoodKey = await loopbackMetricsRequest(conn, 'good');

		report.security.loopbackNoKeyPass = report.security.loopbackNoKey.status === 401;
		report.security.loopbackWrongKeyPass = report.security.loopbackWrongKey.status === 401;
		report.security.loopbackGoodKeyPass = report.security.loopbackGoodKey.status === 200;
		report.loopback.port = report.security.loopbackGoodKey.port || report.security.loopbackNoKey.port;

		report.metricsBefore = await fetchMetricsLoopback(conn);
		report.metricsExposed = auditMetricsExposed(report.metricsBefore);

		const auth = await http('POST', `${PB}/collections/users/auth-with-password`, {
			body: { identity: EMAIL, password },
		});
		if (auth.status !== 200) throw new Error(`AUTH_${auth.status}`);
		report.security.authContainsPassword = (auth.rawText || '').includes(password);
		const token = auth.json.token;
		const me = await http('GET', `${API}/api/me`, { token });
		const clientId = me.json?.user?.clientId;
		const activityId = me.json?.user?.activeActivityId;
		if (!clientId || !activityId) throw new Error('AUTH_SCOPE_MISSING');

		report.baseline = await fetchCounts(conn, clientId, activityId);

		let correlationCheck = null;
		for (const scenario of READ_SCENARIOS) {
			const r = await chat(token, activityId, scenario.message, `${TAG}-${scenario.key}`);
			report.controlledReads[scenario.key] = {
				status: r.status,
				ms: r.ms,
				correlationId: r.correlationId,
				goalDomain: r.json?.v2Http?.goalDomain,
				executionCode: r.json?.v2Http?.executionCode || r.json?.v2Http?.responseStatus,
				capability: scenario.capability,
			};
			if (!correlationCheck && r.correlationId) {
				correlationCheck = await checkCorrelationInLogs(conn, r.correlationId);
			}
			await new Promise((resolve) => setTimeout(resolve, 400));
		}

		report.correlation = correlationCheck || { found: false, reason: 'not_checked' };

		report.metricsAfter = await fetchMetricsLoopback(conn);
		report.metricsDelta = metricsDelta(report.metricsBefore, report.metricsAfter);

		const after = await fetchCounts(conn, clientId, activityId);
		const FIN = ['ventes', 'depenses', 'stocks', 'produits', 'agent_write_operations'];
		report.financialDelta = Object.fromEntries(FIN.map((k) => [k, after[k] - report.baseline[k]]));
		report.financialDeltaZero = FIN.every((k) => report.financialDelta[k] === 0);

		report.latency = Object.fromEntries(
			Object.entries(report.controlledReads).map(([k, v]) => [k, v.ms]),
		);

		report.actionSafety = {
			before: report.metricsBefore?.global?.ACTION_TO_N8N_FALLBACK ?? null,
			after: report.metricsAfter?.global?.ACTION_TO_N8N_FALLBACK ?? null,
			delta: (report.metricsAfter?.global?.ACTION_TO_N8N_FALLBACK || 0)
				- (report.metricsBefore?.global?.ACTION_TO_N8N_FALLBACK || 0),
		};

		const salesDelta = report.metricsDelta?.byCapability?.SALES?.READ_V2_SUCCESS ?? null;
		const expensesDelta = report.metricsDelta?.byCapability?.EXPENSES?.READ_V2_SUCCESS ?? null;
		const stockDelta = report.metricsDelta?.byCapability?.STOCK?.READ_V2_SUCCESS ?? null;
		const readTotalDelta = report.metricsDelta?.global?.READ_TOTAL ?? null;

		report.counterCoherence = {
			readTotalDelta,
			salesV2Delta: salesDelta,
			expensesV2Delta: expensesDelta,
			stockV2Delta: stockDelta,
			controlledReadCount: READ_SCENARIOS.length,
			note: 'Each successful V2 READ increments READ_TOTAL and READ_V2_TOTAL once per request',
		};

		const countersCoherent = readTotalDelta >= READ_SCENARIOS.length
			&& salesDelta >= 1
			&& expensesDelta >= 1
			&& stockDelta >= 1;

		const securityOk = report.security.publicNoKeyPass
			&& report.security.publicWrongKeyPass
			&& !report.security.publicNoKeyLeaksMetrics
			&& report.security.loopbackNoKeyPass
			&& report.security.loopbackWrongKeyPass
			&& report.security.loopbackGoodKeyPass
			&& !report.security.authContainsPassword;

		const notExposed = Object.values(report.metricsExposed.capabilities || {})
			.filter((v) => v === 'NOT_EXPOSED');
		if (notExposed.length) {
			report.gaps.push('CAPABILITIES_NOT_YET_POPULATED');
		}

		if (securityOk
			&& report.loopback.keyConfigured
			&& countersCoherent
			&& report.financialDeltaZero
			&& report.actionSafety.after === 0
			&& report.correlation.logLineFound) {
			report.verdict = report.gaps.length ? 'H12.1.2_GO_WITH_GAPS' : 'H12.1.2_GO';
		} else if (report.security.loopbackGoodKeyPass && !securityOk) {
			report.verdict = 'H12.1.2_NO_GO';
			report.errors.push('SECURITY_CHECK_FAILED');
		} else if (!countersCoherent) {
			report.gaps.push('COUNTER_DELTA_MISMATCH');
			report.verdict = report.security.loopbackGoodKeyPass ? 'H12.1.2_GO_WITH_GAPS' : 'H12.1.2_NO_GO';
		}
	} finally {
		conn.end();
	}

	writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
	console.log(JSON.stringify({
		verdict: report.verdict,
		reportPath: REPORT_PATH,
		security: {
			publicNoKey: report.security.publicNoKey?.status,
			publicWrongKey: report.security.publicWrongKey?.status,
			loopbackNoKey: report.security.loopbackNoKey?.status,
			loopbackWrongKey: report.security.loopbackWrongKey?.status,
			loopbackGoodKey: report.security.loopbackGoodKey?.status,
			loopbackPort: report.loopback.port,
		},
		metricsDelta: report.metricsDelta,
		counterCoherence: report.counterCoherence,
		correlation: report.correlation,
		financialDelta: report.financialDelta,
		gaps: report.gaps,
	}, null, 2));
	process.exit(report.verdict.startsWith('H12.1.2_GO') ? 0 : 1);
}

main().catch((e) => {
	report.errors.push(e.message);
	writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
	console.error(e.message);
	process.exit(1);
});
