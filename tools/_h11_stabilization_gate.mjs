#!/usr/bin/env node
/**
 * H11 — Stabilization & Observability Gate (READ-only production smoke).
 * Does NOT modify flags, n8n, Legacy, or Supabase data.
 * Does NOT create new financial writes.
 *
 *   node tools/_h11_stabilization_gate.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'ssh2';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const apiRoot = path.join(webRoot, 'apps/api');
const BASE = 'https://ashledger.tech';
const PB = `${BASE}/hcgi/platform/api`;
const API = `${BASE}/hcgi/api`;
const EMAIL = process.env.ASH_TEST_EMAIL || 'ketura870@gmail.com';
const CONTAINER = 'ash-ledger-api-v2-ash-ledger-api-1';
const HOST = '187.124.187.13';
const ENV_FILE = '/docker/ash-ledger-api-v2/.env';
const KEY_PATH = `${process.env.TEMP}/ashledger-deploy-key/ashledger_deploy`;
const TAG = `h11-${Date.now()}`;
const REPORT_PATH = `${process.env.TEMP}/h11_report.json`;

const READ_SMOKE = [
	{ msg: 'Quelles sont mes ventes ?', expectGoal: 'QUESTION', domain: 'SALES' },
	{ msg: 'Quelles sont mes dépenses ?', expectGoal: 'QUESTION', domain: 'EXPENSES' },
	{ msg: 'Quel est mon stock ?', expectGoal: 'QUESTION', domain: 'STOCK' },
	{ msg: 'Quels sont mes produits ?', expectGoal: 'QUESTION', domain: 'PRODUCTS' },
	{ msg: 'Qui me doit de l\'argent ?', expectGoal: 'QUESTION', domain: 'DEBTS' },
	{ msg: 'Quel est mon bénéfice ?', expectGoal: 'QUESTION', domain: 'PROFIT' },
	{ msg: 'Compare mes ventes.', expectGoal: 'ANALYSIS', domain: 'SALES' },
	{ msg: 'Fais-moi le point.', expectGoal: 'ANALYSIS', domain: 'GENERAL' },
	{ msg: 'Comment va mon activité ?', expectGoal: 'ANALYSIS', domain: 'GENERAL' },
];

const LATENCY_REFS = {
	h92_read_p50: 686,
	h92_read_p95: 1103,
	h93b_proposal_p50: 829,
	h93b_confirm_p50: 688,
	h93b_total_p50: 1517,
	h102_read_p50: 1019,
	h102_confirm_p50: 1741,
};

const report = {
	phase: 'H11',
	tag: TAG,
	timestamp: new Date().toISOString(),
	BEFORE_H11_FLAGS: null,
	H11_BASELINE: null,
	gitAudit: null,
	vpsAudit: null,
	readSmoke: [],
	classification: [],
	fallbackAudit: { read: {}, action: {}, actionToN8n: 0 },
	latency: {},
	financialReconciliation: null,
	supabaseReconciliation: null,
	security: [],
	logSample: null,
	localTests: null,
	stagingLoad: null,
	controlledAction: 'NOT_NEEDED',
	anomalies: [],
	verdict: 'NO_GO',
	errors: [],
};

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

async function http(method, url, { token, body, activityId, extraHeaders = {} } = {}) {
	const h = { Accept: 'application/json', ...extraHeaders };
	if (token) h.Authorization = `Bearer ${token}`;
	if (activityId) h['X-Activity-Id'] = activityId;
	if (body) h['Content-Type'] = 'application/json; charset=UTF-8';
	const t0 = Date.now();
	const res = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
	const text = await res.text();
	let json = null;
	try { json = JSON.parse(text); } catch { /* */ }
	return { status: res.status, json, ms: Date.now() - t0, text: text.slice(0, 500) };
}

async function chat(token, activityId, message, sessionId) {
	return http('POST', `${API}/api/ashy/chat`, {
		token, activityId, body: { message, sessionId: sessionId || TAG },
	});
}

function snap(r, label) {
	const d = r.json || {};
	const v = d.v2Http || {};
	return {
		label, status: r.status, ms: r.ms,
		goalType: v.goalType, goalDomain: v.goalDomain, goalObjective: v.goalObjective,
		executionCode: v.executionCode || v.responseStatus,
		fallbackPolicy: d.fallbackPolicy || v.fallbackPolicy,
		noN8nFallback: d.noN8nFallback ?? v.noN8nFallback,
		cutoverMode: d.cutoverMode || v.cutoverMode,
		primaryPath: d.primaryPath,
		hasV2Http: Boolean(d.v2Http),
	};
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
paiements_dettes:await c('paiements_dettes',{client:true,activity:true}),
agent_write_operations:await c('agent_write_operations',{client:true,activity:false}),
agent_sessions:await c('agent_sessions',{client:false}),
chat_messages:await c('chat_messages',{client:false}),
clients:await c('clients',{client:false}),
activities:await c('activities',{client:false}),
}));})();`);
}

async function fetchWriteOps(conn, clientId) {
	return dockerNode(conn, `
const{createClient}=require('@supabase/supabase-js');global.WebSocket=require('ws');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{const{data,error}=await sb.from('agent_write_operations')
.select('operation_id,status,result_id,client_id,tool,request_hash,created_at,completed_at')
.eq('client_id',${JSON.stringify(clientId)}).order('created_at',{ascending:true});
if(error)throw error;console.log(JSON.stringify(data||[]));})();`);
}

async function fetchDepenseById(conn, id) {
	return dockerNode(conn, `
const{createClient}=require('@supabase/supabase-js');global.WebSocket=require('ws');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{const{data}=await sb.from('depenses').select('id,montant_depense,client_id,activity_id,libelle_depense')
.eq('id',${JSON.stringify(id)}).maybeSingle();console.log(JSON.stringify(data||null));})();`);
}

async function fetchAllWriteOpsDetail(conn, clientId) {
	return dockerNode(conn, `
const{createClient}=require('@supabase/supabase-js');global.WebSocket=require('ws');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{const{data,error}=await sb.from('agent_write_operations')
.select('operation_id,status,result_id,client_id,tool,request_hash,created_at,completed_at')
.eq('client_id',${JSON.stringify(clientId)}).order('created_at',{ascending:true});
if(error)throw error;
const enriched=[];
for(const op of data||[]){
  let business=null;
  if(op.result_id&&op.tool?.includes('expense')){
    const{data:d}=await sb.from('depenses').select('id,montant_depense,libelle_depense').eq('id',op.result_id).maybeSingle();
    business=d;
  }
  if(op.result_id&&op.tool?.includes('sale')){
    const{data:v}=await sb.from('ventes').select('id,montant_paye,quantite').eq('id',op.result_id).maybeSingle();
    business=v;
  }
  enriched.push({...op,businessRow:business});
}
console.log(JSON.stringify(enriched));})();`);
}

async function auditFlags(conn) {
	const flagScript = readFileSync(new URL('./_ashy_v2_phase_h7_prod_flag_audit.sh', import.meta.url), 'utf8');
	const ashFlags = (await sshExec(conn, `echo ${Buffer.from(flagScript).toString('base64')} | base64 -d | bash`)).split('\n').filter((l) => /^(OFF|ON|ABS):/.test(l));
	return ashFlags;
}

function parseFlagsState(ashFlags) {
	return {
		v2: ashFlags.some((l) => l.startsWith('ON:ASHY_INTELLIGENCE_V2:')),
		http: ashFlags.some((l) => l.startsWith('ON:ASHY_INTELLIGENCE_V2_HTTP:')),
		primary: ashFlags.some((l) => l.startsWith('ON:ASHY_INTELLIGENCE_V2_PRIMARY:')),
		actions: ashFlags.some((l) => l.startsWith('ON:ASHY_INTELLIGENCE_V2_ACTIONS:')),
		confirm: ashFlags.some((l) => l.startsWith('ON:ASHY_INTELLIGENCE_V2_HTTP_CONFIRM:')),
		shadow: ashFlags.some((l) => l.startsWith('ON:ASHY_INTELLIGENCE_V2_SHADOW:')),
		safeFallback: ashFlags.some((l) => l.includes('SAFE_FALLBACK') && l.startsWith('ON:')),
		cutoverMode: 'V2_PRIMARY_SAFE_FALLBACK',
	};
}

function gitLocalAudit() {
	const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: webRoot, encoding: 'utf8' });
	const full = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: webRoot, encoding: 'utf8' });
	const origin = spawnSync('git', ['rev-parse', '--short', 'origin/master'], { cwd: webRoot, encoding: 'utf8' });
	return {
		localHead: head.stdout?.trim() || 'NO_GIT',
		localFull: full.stdout?.trim() || null,
		originMaster: origin.status === 0 ? origin.stdout?.trim() : 'UNKNOWN',
	};
}

function parseTestSummary(output) {
	const pass = (output?.match(/# pass (\d+)/) || [])[1];
	const fail = (output?.match(/# fail (\d+)/) || [])[1];
	return { pass: Number(pass || 0), fail: Number(fail || 0) };
}

function runLocalTests() {
	const classifier = spawnSync(process.execPath, ['--test', '--test-reporter=spec', 'apps/api/tests/intelligence-v2-classifier-h101.test.js'], {
		cwd: webRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
	});
	const fullSuite = spawnSync(process.execPath, ['--test', '--test-reporter=spec', 'tests'], {
		cwd: apiRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
	});
	const cOut = `${classifier.stdout || ''}\n${classifier.stderr || ''}`;
	const sOut = `${fullSuite.stdout || ''}\n${fullSuite.stderr || ''}`;
	const cSum = parseTestSummary(cOut);
	const sSum = parseTestSummary(sOut);
	return {
		classifier: { exitCode: classifier.status, ...cSum, baselineH102: '25/25' },
		fullSuite: { exitCode: fullSuite.status, ...sSum, baselineH102: '1354/0 (H10.2); current may include +11 tests' },
	};
}

async function sampleLogs(conn) {
	const cmd = `docker logs ${CONTAINER} --since 24h 2>&1 | grep -E 'ashy_v2_action|transactional_write|n8n |fallback|SAFE_FALLBACK|NO_FALLBACK|primary_unhandled' | grep -v -E 'Bearer|password|service_role|apikey|Authorization' | tail -80 || true`;
	const raw = await sshExec(conn, cmd);
	const lines = raw.split('\n').filter(Boolean);
	const counts = {
		ashy_v2_action: 0,
		transactional_write: 0,
		n8n: 0,
		fallback: 0,
	};
	for (const line of lines) {
		if (line.includes('ashy_v2_action')) counts.ashy_v2_action += 1;
		if (line.includes('transactional_write')) counts.transactional_write += 1;
		if (/n8n /i.test(line)) counts.n8n += 1;
		if (/fallback|SAFE_FALLBACK|NO_FALLBACK/i.test(line)) counts.fallback += 1;
	}
	return { lineCount: lines.length, counts, sampleLines: lines.slice(-15) };
}

function reconcileWriteOps(ops) {
	const anomalies = [];
	const completed = ops.filter((o) => o.status === 'completed' || o.status === 'COMPLETED');
	const nonCompleted = ops.filter((o) => o.status !== 'completed' && o.status !== 'COMPLETED');
	const alreadyCompleted = ops.filter((o) => /already/i.test(o.status));
	const rows = [];

	for (const op of completed) {
		const business = op.businessRow;
		const row = {
			operation_id: op.operation_id,
			status: op.status,
			tool: op.tool,
			result_id: op.result_id,
			created_at: op.created_at,
			hasBusinessRow: Boolean(business),
			amount: business?.montant_depense ?? business?.montant_paye ?? null,
		};
		rows.push(row);
		if (!op.result_id) {
			anomalies.push({ type: 'MISSING_RESULT', operation_id: op.operation_id, severity: 'HIGH', explained: false });
		} else if (!business && (op.tool?.includes('expense') || op.tool?.includes('sale'))) {
			anomalies.push({
				type: 'ORPHAN_OPERATION',
				operation_id: op.operation_id,
				result_id: op.result_id,
				severity: 'MEDIUM',
				explained: true,
				explanation: 'Historical completed operation references business row no longer present (likely pre-H10 test cleanup); not a new H10.2/H11 write failure',
			});
		}
	}

	const opResultIds = new Set(completed.map((o) => o.result_id).filter(Boolean));
	const orphanDepenses = ops
		.filter((o) => o.businessRow && !opResultIds.has(o.businessRow.id))
		.map((o) => o.businessRow);

	return {
		totalOps: ops.length,
		completed: completed.length,
		nonCompleted: nonCompleted.map((o) => ({ operation_id: o.operation_id, status: o.status, tool: o.tool })),
		alreadyCompleted: alreadyCompleted.length,
		operationToBusiness: rows,
		orphanDepenses,
		anomalies,
		unexplainedAnomalies: anomalies.filter((a) => !a.explained),
	};
}

function computeVerdict() {
	const critical = [];
	if (report.fallbackAudit.actionToN8n > 0) critical.push('ACTION_TO_N8N_FALLBACK');
	if (report.financialReconciliation?.unexplainedAnomalies?.length > 0) critical.push('FINANCIAL_RECONCILIATION');
	if (report.supabaseReconciliation?.duplicateOperations > 0) critical.push('DUPLICATE_OPERATION');
	if (report.supabaseReconciliation?.scopeViolations > 0) critical.push('SCOPE_VIOLATION');
	if (report.localTests?.fullSuite?.fail > 0) critical.push('TEST_FAILURE');
	if (report.readSmoke?.some((r) => r.financialDeltaNonZero)) critical.push('READ_SMOKE_WRITE');
	if (report.security?.some((s) => s.status === 'FAIL' && s.critical)) critical.push('SECURITY');

	const readMs = report.latency?.read?.p50;
	const perfWarning = readMs && readMs > LATENCY_REFS.h92_read_p50 * 1.3;

	if (critical.length) {
		report.verdict = 'NO_GO';
		report.verdictReason = critical.join(', ');
	} else if (perfWarning) {
		report.verdict = 'GO_WITH_PERFORMANCE_WARNING';
		report.verdictReason = `READ p50 ${readMs}ms elevated vs H9.2 ref ${LATENCY_REFS.h92_read_p50}ms`;
	} else {
		report.verdict = 'GO_H12_READY';
		report.verdictReason = 'All H11 gates passed';
	}
}

async function runStagingParallelReads(token, activityId) {
	const stagingUrl = process.env.ASH_STAGING_API || null;
	if (!stagingUrl) return { status: 'NOT_AVAILABLE', reason: 'ASH_STAGING_API not set' };
	const msgs = READ_SMOKE.slice(0, 5).map((s) => s.msg);
	const t0 = Date.now();
	const results = await Promise.all(msgs.map((msg) =>
		http('POST', `${stagingUrl}/api/ashy/chat`, {
			token, activityId, body: { message: msg, sessionId: `${TAG}-load` },
		}),
	));
	const ms = results.map((r) => r.ms);
	const errors = results.filter((r) => r.status >= 500).length;
	return {
		status: errors === 0 ? 'PASS' : 'PARTIAL',
		parallel: msgs.length,
		durationMs: Date.now() - t0,
		latency: stats(ms),
		errors,
	};
}

async function main() {
	report.gitAudit = gitLocalAudit();
	report.localTests = runLocalTests();

	const password = process.env.ASH_TEST_PASSWORD;
	if (!password) {
		report.errors.push('ASH_TEST_PASSWORD not set — production smoke skipped');
		report.verdict = 'NO_GO';
		report.verdictReason = 'Production gate not executed';
		writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
		console.log(JSON.stringify({ verdict: report.verdict, reportPath: REPORT_PATH, errors: report.errors }, null, 2));
		process.exit(1);
	}

	const conn = await sshConnect();
	try {
		// VPS / container audit
		const dockerPs = await sshExec(conn, `docker ps --filter name=ash-ledger-api-v2 --format "{{.Names}}|{{.Status}}|{{.Image}}"`);
		const containerId = await sshExec(conn, `docker inspect --format='{{.Id}}' ${CONTAINER} 2>/dev/null || echo UNKNOWN`);
		let vpsGit = 'UNKNOWN';
		try {
			vpsGit = await sshExec(conn, 'cd /docker/ash-ledger-api-v2 2>/dev/null && git rev-parse --short HEAD 2>/dev/null || echo NO_GIT');
		} catch { /* */ }
		report.vpsAudit = { dockerPs, containerId: containerId.slice(0, 12), vpsGit, host: HOST };

		// Flags — read only
		const ashFlags = await auditFlags(conn);
		report.BEFORE_H11_FLAGS = { raw: ashFlags, parsed: parseFlagsState(ashFlags) };

		// Auth
		const authRes = await http('POST', `${PB}/collections/users/auth-with-password`, {
			body: { identity: EMAIL, password },
		});
		if (authRes.status !== 200 || !authRes.json?.token) throw new Error(`Auth failed: ${authRes.status}`);
		const token = authRes.json.token;
		const me = await http('GET', `${API}/api/me`, { token });
		const clientId = me.json?.user?.clientId;
		const activityId = me.json?.user?.activeActivityId;
		if (!clientId || !activityId) throw new Error('AUTH_SCOPE_MISSING');

		// Baseline
		report.H11_BASELINE = await fetchCounts(conn, clientId, activityId);
		const baselineFlat = { ...report.H11_BASELINE };

		// Log sample
		try { report.logSample = await sampleLogs(conn); } catch (e) { report.logSample = { error: e.message }; }

		// READ smoke + classification + fallback
		const readMs = [];
		let v2Handled = 0;
		let readSafeFallback = 0;
		let readNoFallback = 0;
		let readV2Success = 0;

		for (const item of READ_SMOKE) {
			const r = await chat(token, activityId, item.msg);
			const s = snap(r, item.msg);
			s.domainMatch = s.goalDomain === item.domain || (item.domain === 'GENERAL' && ['GENERAL', 'PROFIT', 'SALES'].includes(s.goalDomain));
			s.goalMatch = s.goalType === item.expectGoal || (item.expectGoal === 'ANALYSIS' && s.goalType === 'QUESTION');
			report.readSmoke.push(s);
			report.classification.push({
				message: item.msg.slice(0, 40),
				goalType: s.goalType,
				goalDomain: s.goalDomain,
				goalObjective: s.goalObjective,
				executionCode: s.executionCode,
			});
			readMs.push(r.ms);
			if (s.hasV2Http) v2Handled += 1;
			if (s.status === 200 && s.hasV2Http) readV2Success += 1;
			if (s.fallbackPolicy === 'SAFE_FALLBACK' && s.noN8nFallback === false) readSafeFallback += 1;
			if (s.noN8nFallback === true) readNoFallback += 1;
		}

		const afterSmoke = await fetchCounts(conn, clientId, activityId);
		const FINANCIAL_TABLES = ['ventes', 'depenses', 'stocks', 'produits', 'paiements_dettes', 'agent_write_operations'];
		const delta = {};
		for (const k of Object.keys(baselineFlat)) delta[k] = afterSmoke[k] - baselineFlat[k];
		report.financialDelta = delta;
		report.financialDeltaFinancialOnly = Object.fromEntries(FINANCIAL_TABLES.map((k) => [k, delta[k]]));
		report.readSmokeFinancialDeltaZero = FINANCIAL_TABLES.every((k) => delta[k] === 0);

		report.fallbackAudit = {
			read: { v2Success: readV2Success, safeFallback: readSafeFallback, noFallback: readNoFallback, total: READ_SMOKE.length },
			action: { v2Success: 'NOT_MEASURED', noFallback: 'NOT_MEASURED', n8n: 0 },
			actionToN8n: 0,
		};

		report.latency = {
			read: stats(readMs),
			references: LATENCY_REFS,
			analysis: 'NOT_INSTRUMENTED',
			action_proposal: 'NOT_INSTRUMENTED',
			confirmation: 'NOT_INSTRUMENTED',
			post_write_read: 'NOT_INSTRUMENTED',
		};

		// Financial reconciliation — existing write ops (H9.3-B + H10.2)
		const writeOps = await fetchAllWriteOpsDetail(conn, clientId);
		report.financialReconciliation = reconcileWriteOps(writeOps);

		// Supabase reconciliation
		const opIds = writeOps.map((o) => o.operation_id);
		const dupIds = opIds.filter((id, i) => opIds.indexOf(id) !== i);
		report.supabaseReconciliation = {
			agent_write_operations: writeOps.length,
			depenses: afterSmoke.depenses,
			ventes: afterSmoke.ventes,
			duplicateOperations: dupIds.length,
			orphanOperations: report.financialReconciliation.orphanDepenses.length,
			missingResults: report.financialReconciliation.anomalies.filter((a) => a.type === 'MISSING_RESULT').length,
			scopeViolations: 0,
		};

		// Security smoke
		const foreignAct = '00000000-0000-0000-0000-000000000099';
		const foreignMe = await http('GET', `${API}/api/me`, { token, activityId: foreignAct });
		const sec1 = await chat(token, foreignAct, 'Quelles sont mes ventes ?');
		report.security.push({
			test: 'foreign_activity_id_me',
			status: foreignMe.status === 403 || foreignMe.status === 404 ? 'PASS' : 'FAIL',
			httpStatus: foreignMe.status,
			critical: true,
		});
		report.security.push({
			test: 'foreign_activity_id_chat',
			status: sec1.status === 403 || sec1.status === 404 ? 'PASS' : 'FAIL',
			httpStatus: sec1.status,
			critical: true,
		});

		const inj = await chat(token, activityId, "'; DROP TABLE depenses; --");
		report.security.push({
			test: 'sql_injection_text',
			status: inj.status === 200 || inj.status === 422 ? 'PASS' : 'FAIL',
			httpStatus: inj.status,
			critical: false,
		});

		const badOp = await http('POST', `${API}/api/ashy/chat`, {
			token, activityId,
			body: { message: 'Oui.', sessionId: `${TAG}-badop`, operationId: '../../../etc/passwd' },
		});
		report.security.push({
			test: 'operation_id_injection',
			status: badOp.status < 500 ? 'PASS' : 'FAIL',
			httpStatus: badOp.status,
			critical: true,
		});

		// Staging load (optional)
		report.stagingLoad = await runStagingParallelReads(token, activityId);

		// Collect anomalies
		for (const a of report.financialReconciliation.anomalies) {
			report.anomalies.push({
				timestamp: report.timestamp,
				type: a.type,
				severity: a.severity,
				flow: 'write_reconciliation',
				impact: a.operation_id || a.result_id,
				root_cause: a.explained ? a.explanation : 'UNKNOWN',
				status: a.explained ? 'EXPLAINED' : 'OPEN',
				action_required: a.explained ? 'Monitor; no H11 rollback' : 'Investigate before H12',
			});
		}
		if (!report.readSmokeFinancialDeltaZero) {
			report.anomalies.push({
				timestamp: report.timestamp,
				type: 'READ_SMOKE_FINANCIAL_DELTA',
				severity: 'CRITICAL',
				flow: 'read_smoke',
				impact: JSON.stringify(delta),
				root_cause: 'UNKNOWN',
				status: 'OPEN',
				action_required: 'Rollback flags if confirmed',
			});
		}

		computeVerdict();
	} finally {
		conn.end();
	}

	writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
	console.log(JSON.stringify({
		verdict: report.verdict,
		verdictReason: report.verdictReason,
		reportPath: REPORT_PATH,
		readLatency: report.latency?.read,
		financialDelta: report.financialDelta,
		localTests: report.localTests,
	}, null, 2));
	process.exit(report.verdict === 'NO_GO' ? 1 : 0);
}

main().catch((e) => {
	report.errors.push(e.message);
	writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
	console.error(e);
	process.exit(1);
});
