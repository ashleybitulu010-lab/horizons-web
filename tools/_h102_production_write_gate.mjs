#!/usr/bin/env node
/**
 * H10.2 — Production operational write gate.
 * Activates ACTIONS+CONFIRM only after staging gate + local tests pass.
 * On GO: leaves ACTIONS/CONFIRM ON. On failure after activation: rollback from backup.
 *
 *   node tools/_h102_production_write_gate.mjs
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'ssh2';
import {
	buildCanonicalOperationPayload,
	canonicalJsonStringify,
} from '../apps/api/src/lib/agent-operation-idempotency.js';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const apiRoot = path.join(webRoot, 'apps/api');
const BASE = 'https://ashledger.tech';
const PB = `${BASE}/hcgi/platform/api`;
const API = `${BASE}/hcgi/api`;
const EMAIL = process.env.ASH_TEST_EMAIL || 'ketura870@gmail.com';
const CONTAINER = 'ash-ledger-api-v2-ash-ledger-api-1';
const ENV_FILE = '/docker/ash-ledger-api-v2/.env';
const COMPOSE_DIR = '/docker/ash-ledger-api-v2';
const KEY_PATH = `${process.env.TEMP}/ashledger-deploy-key/ashledger_deploy`;
const H101_COMMIT = '1b0ad9a';
const TAG = `h102-${Date.now()}`;
const REPORT_PATH = `${process.env.TEMP}/h102_prod_report.json`;

const EXPENSE_MSG = "J'ai dépensé 2 dollars pour test Ashy H10.2.";
const REJECT_MSG = "J'ai dépensé 5 dollars pour test reject H10.2.";
const MOD_MSG = "J'ai dépensé 25 dollars pour test H10.2.";
const SALE_MSG = "J'ai vendu 1 poulet à 2 dollars pour test Ashy H10.2.";

const READ_REGRESSION = [
	'Quelles sont mes ventes ?',
	'Quelles sont mes dépenses ?',
	'Quel est mon stock ?',
	'Quels sont mes produits ?',
	'Qui me doit de l\'argent ?',
	'Quel est mon bénéfice ?',
	'Compare mes ventes.',
	'Fais-moi le point.',
	'Comment va mon activité ?',
];

const report = {
	phase: 'H10.2',
	tag: TAG,
	H102_BASELINE_LOCKED: null,
	baselineTimestamp: null,
	scenarios: {},
	notSimulated: [],
	errors: [],
	rollbackPerformed: false,
	activated: false,
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

function hashPending(clientId, pendingWrite) {
	const payload = buildCanonicalOperationPayload(clientId, pendingWrite);
	return createHash('sha256').update(canonicalJsonStringify(payload)).digest('hex');
}

function sshConnect() {
	return new Promise((resolve, reject) => {
		const c = new Client();
		c.on('ready', () => resolve(c)).on('error', reject)
			.connect({ host: '187.124.187.13', username: 'root', privateKey: readFileSync(KEY_PATH) });
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

async function chat(token, activityId, message, sessionId) {
	return http('POST', `${API}/api/ashy/chat`, {
		token, activityId, body: { message, sessionId: sessionId || TAG },
	});
}

function snap(r, label = null) {
	const d = r.json || {}; const v = d.v2Http || {};
	return {
		label, status: r.status, ms: r.ms,
		goalType: v.goalType, goalDomain: v.goalDomain, goalObjective: v.goalObjective,
		actionProposalStatus: v.actionProposalStatus, actionStatus: v.actionStatus,
		f4Committed: v.f4Committed, f4Replay: v.f4Replay, f4Status: v.f4Status,
		noN8nFallback: d.noN8nFallback ?? v.noN8nFallback,
		cutoverMode: d.cutoverMode || v.cutoverMode,
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
}));})();`);
}

async function fetchPending(conn, clientId, activityId) {
	return dockerNode(conn, `
const{createClient}=require('@supabase/supabase-js');global.WebSocket=require('ws');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{const{data}=await sb.from('agent_sessions').select('payload,state_version,state_type')
.eq('client_id',${JSON.stringify(clientId)}).eq('activity_id',${JSON.stringify(activityId)})
.eq('state_type','pending').maybeSingle();console.log(JSON.stringify(data||null));})();`);
}

async function fetchExpenseById(conn, id) {
	return dockerNode(conn, `
const{createClient}=require('@supabase/supabase-js');global.WebSocket=require('ws');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{const{data}=await sb.from('depenses').select('id,montant_depense,client_id,activity_id,libelle_depense')
.eq('id',${JSON.stringify(id)}).maybeSingle();console.log(JSON.stringify(data||null));})();`);
}

async function fetchSaleById(conn, id) {
	return dockerNode(conn, `
const{createClient}=require('@supabase/supabase-js');global.WebSocket=require('ws');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{const{data}=await sb.from('ventes').select('id,quantite,prix_unitaire,montant_paye,client_id,activity_id')
.eq('id',${JSON.stringify(id)}).maybeSingle();console.log(JSON.stringify(data||null));})();`);
}

async function fetchWriteOp(conn, operationId) {
	return dockerNode(conn, `
const{createClient}=require('@supabase/supabase-js');global.WebSocket=require('ws');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{const{data}=await sb.from('agent_write_operations').select('status,result_id,operation_id,client_id,request_hash,tool')
.eq('operation_id',${JSON.stringify(operationId)}).maybeSingle();console.log(JSON.stringify(data||null));})();`);
}

async function rpcExpense(conn, clientId, activityId, params) {
	return dockerNode(conn, `
const{createClient}=require('@supabase/supabase-js');global.WebSocket=require('ws');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{const{data,error}=await sb.rpc('confirm_and_create_expense',{
p_client_id:${JSON.stringify(clientId)},p_activity_id:${JSON.stringify(activityId)},
p_consume_token:${JSON.stringify(params.consumeToken ?? null)},
p_operation_id:${JSON.stringify(params.operationId ?? null)},
p_request_hash:${JSON.stringify(params.requestHash ?? null)},
p_expected_version:${params.expectedVersion ?? null}
});console.log(JSON.stringify({data,error:error?.message||null}));})();`);
}

async function auditFlags(conn) {
	const flagScript = readFileSync(new URL('./_ashy_v2_phase_h7_prod_flag_audit.sh', import.meta.url), 'utf8');
	const ashFlags = (await sshExec(conn, `echo ${Buffer.from(flagScript).toString('base64')} | base64 -d | bash`)).split('\n').filter((l) => /^(OFF|ON|ABS):/.test(l));
	const agentFlags = await sshExec(conn, `grep -E '^AGENT_SESSION_(TRANSACTIONAL|IDEMPOTENT|WRITE_DB|PENDING)' ${ENV_FILE} 2>/dev/null | sed 's/=.*/=***/' || echo NO_AGENT_SESSION_FLAGS`);
	return { ashFlags, agentFlags: agentFlags.split('\n') };
}

function parseFlagsState(ashFlags) {
	return {
		v2: ashFlags.some((l) => l.startsWith('ON:ASHY_INTELLIGENCE_V2:')),
		http: ashFlags.some((l) => l.startsWith('ON:ASHY_INTELLIGENCE_V2_HTTP:')),
		primary: ashFlags.some((l) => l.startsWith('ON:ASHY_INTELLIGENCE_V2_PRIMARY:')),
		actions: ashFlags.some((l) => l.startsWith('ON:ASHY_INTELLIGENCE_V2_ACTIONS:')),
		confirm: ashFlags.some((l) => l.startsWith('ON:ASHY_INTELLIGENCE_V2_HTTP_CONFIRM:')),
		shadow: ashFlags.some((l) => l.startsWith('ON:ASHY_INTELLIGENCE_V2_SHADOW:')),
	};
}

async function activateActionsConfirm(conn) {
	const backup = `${ENV_FILE}.bak.h102-${Date.now()}`;
	const bash = `
set -euo pipefail
cp "${ENV_FILE}" "${backup}"
sed -i 's|^ASHY_INTELLIGENCE_V2_ACTIONS=.*|ASHY_INTELLIGENCE_V2_ACTIONS=true|' "${ENV_FILE}" || echo 'ASHY_INTELLIGENCE_V2_ACTIONS=true' >> "${ENV_FILE}"
grep -q '^ASHY_INTELLIGENCE_V2_ACTIONS=' "${ENV_FILE}" || echo 'ASHY_INTELLIGENCE_V2_ACTIONS=true' >> "${ENV_FILE}"
sed -i 's|^ASHY_INTELLIGENCE_V2_HTTP_CONFIRM=.*|ASHY_INTELLIGENCE_V2_HTTP_CONFIRM=true|' "${ENV_FILE}" || echo 'ASHY_INTELLIGENCE_V2_HTTP_CONFIRM=true' >> "${ENV_FILE}"
grep -q '^ASHY_INTELLIGENCE_V2_HTTP_CONFIRM=' "${ENV_FILE}" || echo 'ASHY_INTELLIGENCE_V2_HTTP_CONFIRM=true' >> "${ENV_FILE}"
cd ${COMPOSE_DIR}
docker compose -f docker-compose.parallel.yml up -d ash-ledger-api
echo BACKUP=${backup}
sleep 10
`;
	const out = await sshExec(conn, bash);
	return out.match(/BACKUP=(\S+)/)?.[1] || backup;
}

async function rollbackActionsOff(conn, backupPath) {
	report.rollbackPerformed = true;
	const bash = backupPath ? `
set -euo pipefail
cp "${backupPath}" "${ENV_FILE}"
cd ${COMPOSE_DIR}
docker compose -f docker-compose.parallel.yml up -d ash-ledger-api
sleep 8
echo ROLLBACK_OK
` : `
set -euo pipefail
sed -i 's|^ASHY_INTELLIGENCE_V2_ACTIONS=.*|ASHY_INTELLIGENCE_V2_ACTIONS=false|' "${ENV_FILE}"
sed -i 's|^ASHY_INTELLIGENCE_V2_HTTP_CONFIRM=.*|ASHY_INTELLIGENCE_V2_HTTP_CONFIRM=false|' "${ENV_FILE}"
cd ${COMPOSE_DIR}
docker compose -f docker-compose.parallel.yml up -d ash-ledger-api
sleep 8
echo ROLLBACK_FLAGS_OFF
`;
	return sshExec(conn, bash);
}

function gitLocalAudit() {
	const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: webRoot, encoding: 'utf8' });
	const full = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: webRoot, encoding: 'utf8' });
	const h101Local = spawnSync('git', ['cat-file', '-t', H101_COMMIT], { cwd: webRoot, encoding: 'utf8' });
	const h101Ancestor = spawnSync('git', ['merge-base', '--is-ancestor', H101_COMMIT, 'HEAD'], { cwd: webRoot });
	return {
		localHead: head.stdout?.trim() || 'NO_GIT',
		localFull: full.stdout?.trim() || null,
		h101CommitExists: h101Local.status === 0,
		h101TraceableLocally: h101Ancestor.status === 0,
	};
}

function runLocalClassifierTests() {
	const r = spawnSync(process.execPath, ['--test', 'apps/api/tests/intelligence-v2-classifier-h101.test.js'], {
		cwd: webRoot, encoding: 'utf8',
	});
	return {
		exitCode: r.status,
		stdout: r.stdout?.slice(-2000) || '',
		stderr: r.stderr?.slice(-1000) || '',
	};
}

function runStagingGate() {
	const stagingEnv = path.join(apiRoot, '.env.staging');
	const args = existsSync(stagingEnv)
		? ['--env-file=apps/api/.env.staging', 'tools/_h102_staging_write_gate.mjs']
		: ['tools/_h102_staging_write_gate.mjs'];
	const r = spawnSync(process.execPath, args, {
		cwd: webRoot,
		env: { ...process.env, RUN_STAGING: 'true' },
		encoding: 'utf8',
	});
	return {
		exitCode: r.status,
		stdout: r.stdout?.slice(-3000) || '',
		stderr: r.stderr?.slice(-1500) || '',
	};
}

async function failAfterActivation(conn, envBackup, message) {
	report.errors.push(message);
	if (report.activated && envBackup && !report.rollbackPerformed) {
		try { await rollbackActionsOff(conn, envBackup); } catch (e) { report.errors.push(`rollback:${e.message}`); }
	}
	throw new Error(message);
}

async function main() {
	const password = process.env.ASH_TEST_PASSWORD;
	if (!password) throw new Error('ASH_TEST_PASSWORD required');

	const readMs = [];
	const proposalMs = [];
	const confirmMs = [];
	let envBackup = null;
	let conn = null;
	let lastCommittedOp = null;

	try {
		// Step 1 — Git/VPS audit
		report.gitAudit = gitLocalAudit();
		conn = await sshConnect();
		const vpsFull = await sshExec(conn, 'cd /opt/ashledger && git rev-parse HEAD 2>/dev/null || echo NO_GIT');
		const vpsShort = await sshExec(conn, 'cd /opt/ashledger && git rev-parse --short HEAD 2>/dev/null || echo NO_GIT');
		const h101OnVps = await sshExec(conn, `cd /opt/ashledger && git cat-file -t ${H101_COMMIT} 2>/dev/null && echo EXISTS || echo MISSING`);
		const h101VpsAncestor = await sshExec(conn, `cd /opt/ashledger && git merge-base --is-ancestor ${H101_COMMIT} HEAD 2>/dev/null && echo TRACEABLE || echo NOT_TRACEABLE`);
		const markers = await sshExec(conn, `docker exec ${CONTAINER} sh -c "
test -f /app/src/agent/intelligence-v2/action/action-f4-executor.js &&
test -f /app/src/lib/agent-operation-idempotency.js &&
test -f /app/src/agent/intelligence-v2/v2-fallback-policy.js &&
test -f /app/src/agent/intelligence-v2/goal-classifier-rules.js &&
echo MARKERS_OK || echo MARKERS_MISSING"`);
		report.codeVersion = {
			localHead: report.gitAudit.localHead,
			vpsGit: vpsShort,
			vpsGitFull: vpsFull,
			h101Commit: H101_COMMIT,
			h101LocalExists: report.gitAudit.h101CommitExists,
			h101LocalTraceable: report.gitAudit.h101TraceableLocally,
			h101VpsExists: h101OnVps.includes('EXISTS'),
			h101VpsTraceable: h101VpsAncestor.includes('TRACEABLE'),
			markers,
		};
		report.scenarios.gitAudit = report.codeVersion.h101VpsTraceable
			&& report.codeVersion.h101LocalTraceable
			&& markers.includes('MARKERS_OK')
			? pass('git/VPS audit', report.codeVersion)
			: fail('git/VPS audit', report.codeVersion);
		if (report.scenarios.gitAudit.status === 'FAIL') throw new Error('GIT_VPS_AUDIT_FAIL');

		// Step 2 — Verify flags (ACTIONS/CONFIRM must be OFF)
		const preAudit = await auditFlags(conn);
		report.preFlags = preAudit;
		report.preFlagsState = parseFlagsState(preAudit.ashFlags);
		if (report.preFlagsState.actions) throw new Error('ACTIONS_ALREADY_ON_STOP');
		if (!report.preFlagsState.v2 || !report.preFlagsState.http || !report.preFlagsState.primary) {
			throw new Error('V2_PRIMARY_NOT_ON');
		}
		if (report.preFlagsState.shadow) throw new Error('SHADOW_MUST_BE_OFF');
		report.scenarios.preFlags = report.preFlagsState.actions || report.preFlagsState.confirm
			? fail('pre-activation flags', report.preFlagsState)
			: pass('V2/HTTP/PRIMARY ON, ACTIONS/CONFIRM/SHADOW OFF', report.preFlagsState);

		// Auth (needed for baseline + READ)
		const login = await http('POST', `${PB}/collections/users/auth-with-password`, { body: { identity: EMAIL, password } });
		if (login.status !== 200 || !login.json?.token) throw new Error(`LOGIN_${login.status}`);
		const token = login.json.token;
		const me = await http('GET', `${API}/api/me`, { token });
		const clientId = me.json?.user?.clientId;
		const activityId = me.json?.user?.activeActivityId;
		if (!clientId || !activityId) throw new Error('AUTH_SCOPE_MISSING');

		// Step 3 — H102_BASELINE_LOCKED
		report.baselineTimestamp = new Date().toISOString();
		report.H102_BASELINE_LOCKED = await fetchCounts(conn, clientId, activityId);
		report.scenarios.baseline = pass('H102_BASELINE_LOCKED', report.H102_BASELINE_LOCKED);

		// Step 4 — Health, auth, scope
		report.health = {
			api: (await http('GET', `${API}/health`)).status === 200,
			pb: (await http('GET', `${PB}/health`)).status === 200,
			docker: await sshExec(conn, `docker ps --filter name=ash-ledger-api-v2 --format "{{.Status}}"`),
			nginx: await sshExec(conn, 'nginx -t 2>&1 | tail -1'),
		};
		const foreignMe = await http('GET', `${API}/api/me`, { token, activityId: '00000000-0000-0000-0000-000000000099' });
		const foreignChat = await chat(token, '00000000-0000-0000-0000-000000000099', 'Quel est mon stock ?', `${TAG}-foreign`);
		report.scope = {
			ownMe: me.status === 200,
			foreignMe403: foreignMe.status === 403,
			foreignChat403: foreignChat.status === 403,
		};
		report.scenarios.health = report.health.api && report.health.pb
			? pass('health', report.health) : fail('health', report.health);
		report.scenarios.auth = me.status === 200 && clientId && activityId
			? pass('auth', { hasClientId: true, hasActivityId: true }) : fail('auth', { me: me.status });
		report.scenarios.scope = report.scope.foreignMe403 && report.scope.foreignChat403
			? pass('scope 403 foreign', report.scope) : fail('scope', report.scope);
		if (report.scenarios.health.status === 'FAIL' || report.scenarios.scope.status === 'FAIL') {
			throw new Error('PRE_ACTIVATION_HEALTH_SCOPE_FAIL');
		}

		// Step 5 — READ regression (9 messages, zero financial delta)
		const countsBeforeRead = { ...report.H102_BASELINE_LOCKED };
		const readResults = [];
		for (let i = 0; i < READ_REGRESSION.length; i++) {
			const msg = READ_REGRESSION[i];
			const r = await chat(token, activityId, msg, `${TAG}-read-${i}`);
			readMs.push(r.ms);
			const s = snap(r, msg.slice(0, 40));
			readResults.push({ msg: msg.slice(0, 40), ok: r.status === 200 && s.goalType !== 'ACTION', ...s });
		}
		const countsAfterRead = await fetchCounts(conn, clientId, activityId);
		const readFinDelta = {};
		for (const k of Object.keys(countsBeforeRead)) {
			readFinDelta[k] = countsAfterRead[k] - countsBeforeRead[k];
		}
		const readZeroFin = Object.entries(readFinDelta)
			.filter(([k]) => ['ventes', 'depenses', 'stocks', 'produits', 'agent_write_operations'].includes(k))
			.every(([, v]) => v === 0);
		report.readRegression = readResults;
		report.readFinDelta = readFinDelta;
		report.scenarios.readRegression = readResults.every((x) => x.ok) && readZeroFin
			? pass('READ regression 9/9 zero write', { count: readResults.length, readFinDelta })
			: fail('READ regression', { fails: readResults.filter((x) => !x.ok), readFinDelta });
		if (report.scenarios.readRegression.status === 'FAIL') throw new Error('READ_REGRESSION_FAIL');

		// Step 6 — Staging gate
		report.stagingGate = runStagingGate();
		report.scenarios.stagingGate = report.stagingGate.exitCode === 0
			? pass('staging write gate', { exitCode: 0 })
			: fail('staging write gate', { exitCode: report.stagingGate.exitCode, stderr: report.stagingGate.stderr });
		if (report.scenarios.stagingGate.status === 'FAIL') throw new Error('STAGING_GATE_FAIL');

		// Step 7 — Local classifier tests
		report.localTests = runLocalClassifierTests();
		report.scenarios.localTests = report.localTests.exitCode === 0
			? pass('H10.1 classifier tests', { exitCode: 0 })
			: fail('H10.1 classifier tests', { exitCode: report.localTests.exitCode, stderr: report.localTests.stderr });
		if (report.scenarios.localTests.status === 'FAIL') throw new Error('LOCAL_TESTS_FAIL');

		// Step 8 — Activate ACTIONS+CONFIRM (backup .env first)
		envBackup = await activateActionsConfirm(conn);
		report.envBackup = envBackup;
		report.activationTime = new Date().toISOString();
		report.activated = true;

		const postAudit = await auditFlags(conn);
		report.postFlags = postAudit;
		report.postFlagsState = parseFlagsState(postAudit.ashFlags);
		if (!report.postFlagsState.actions || !report.postFlagsState.confirm) {
			await failAfterActivation(conn, envBackup, 'ACTIVATION_FLAGS_NOT_LOADED');
		}
		report.scenarios.activation = pass('ACTIONS+CONFIRM activated', report.postFlagsState);

		const postHealth = {
			api: (await http('GET', `${API}/health`)).status === 200,
			me: (await http('GET', `${API}/api/me`, { token })).status === 200,
		};
		if (!postHealth.api) await failAfterActivation(conn, envBackup, 'POST_HEALTH_FAIL');
		report.postHealth = postHealth;

		const writeBaseline = await fetchCounts(conn, clientId, activityId);

		// Step 9 — Production expense ($2)
		const expSession = `${TAG}-exp`;
		const expProposal = await chat(token, activityId, EXPENSE_MSG, expSession);
		proposalMs.push(expProposal.ms);
		const expPropS = snap(expProposal, 'expense-proposal');
		const preConfirm = await fetchCounts(conn, clientId, activityId);
		const pendingExp = await fetchPending(conn, clientId, activityId);
		const preConfirmDelta = {
			depenses: preConfirm.depenses - writeBaseline.depenses,
			agent_write_operations: preConfirm.agent_write_operations - writeBaseline.agent_write_operations,
		};
		if (expProposal.status !== 200
			|| expPropS.goalType !== 'ACTION'
			|| expPropS.actionProposalStatus !== 'READY_FOR_CONFIRMATION'
			|| preConfirmDelta.depenses !== 0
			|| preConfirmDelta.agent_write_operations !== 0
			|| !pendingExp?.payload?.operationId) {
			await failAfterActivation(conn, envBackup, 'EXPENSE_PROPOSAL_FAIL');
		}

		const expConfirm = await chat(token, activityId, 'Oui', expSession);
		confirmMs.push(expConfirm.ms);
		const expConfS = snap(expConfirm, 'expense-confirm');
		const postExp = await fetchCounts(conn, clientId, activityId);
		const writeOpExp = await fetchWriteOp(conn, pendingExp.payload.operationId);
		const expenseRow = writeOpExp?.result_id ? await fetchExpenseById(conn, writeOpExp.result_id) : null;
		const expDelta = {
			depenses: postExp.depenses - writeBaseline.depenses,
			agent_write_operations: postExp.agent_write_operations - writeBaseline.agent_write_operations,
		};
		report.expense = {
			proposal: expPropS, confirm: expConfS, preConfirmDelta, confirmDelta: expDelta,
			dbVerification: {
				montant: expenseRow?.montant_depense,
				clientMatch: expenseRow?.client_id === clientId,
				activityMatch: expenseRow?.activity_id === activityId,
				amountMatch: Number(expenseRow?.montant_depense) === 2,
			},
		};
		if (expConfirm.status !== 200
			|| !(expConfS.f4Committed || expConfS.actionProposalStatus === 'COMPLETED')
			|| expDelta.depenses !== 1
			|| expDelta.agent_write_operations !== 1
			|| writeOpExp?.status !== 'completed'
			|| !report.expense.dbVerification.amountMatch) {
			await failAfterActivation(conn, envBackup, 'EXPENSE_CONFIRM_FAIL');
		}
		lastCommittedOp = {
			operationId: pendingExp.payload.operationId,
			consumeToken: pendingExp.payload.consumeToken,
			pendingWrite: pendingExp.payload.pendingWrite,
			requestHash: hashPending(clientId, pendingExp.payload.pendingWrite),
		};
		report.scenarios.expense = pass('production expense $2', report.expense.dbVerification);

		let countsAfterWrites = postExp;

		// Step 10 — Production reject (new session)
		const rejSession = `${TAG}-rej`;
		const countsBeforeRej = await fetchCounts(conn, clientId, activityId);
		await chat(token, activityId, REJECT_MSG, rejSession);
		const rej = await chat(token, activityId, 'Non.', rejSession);
		const countsAfterRej = await fetchCounts(conn, clientId, activityId);
		const pendingAfterRej = await fetchPending(conn, clientId, activityId);
		const rejDelta = {
			depenses: countsAfterRej.depenses - countsBeforeRej.depenses,
			agent_write_operations: countsAfterRej.agent_write_operations - countsBeforeRej.agent_write_operations,
		};
		report.reject = { snap: snap(rej, 'reject'), delta: rejDelta };
		if (rejDelta.depenses !== 0 || rejDelta.agent_write_operations !== 0 || pendingAfterRej?.payload?.pendingWrite) {
			await failAfterActivation(conn, envBackup, 'REJECT_FAIL');
		}
		report.scenarios.reject = pass('production reject zero write', rejDelta);
		countsAfterWrites = countsAfterRej;

		// Step 11 — Production modification (25 → 30)
		const modSession = `${TAG}-mod`;
		const countsBeforeMod = await fetchCounts(conn, clientId, activityId);
		await chat(token, activityId, MOD_MSG, modSession);
		const pendingMod1 = await fetchPending(conn, clientId, activityId);
		const hash1 = hashPending(clientId, pendingMod1?.payload?.pendingWrite);
		proposalMs.push((await chat(token, activityId, 'Finalement 30 dollars.', modSession)).ms);
		const pendingMod2 = await fetchPending(conn, clientId, activityId);
		const hash2 = hashPending(clientId, pendingMod2?.payload?.pendingWrite);
		const modConfirm = await chat(token, activityId, 'Oui', modSession);
		confirmMs.push(modConfirm.ms);
		const countsAfterMod = await fetchCounts(conn, clientId, activityId);
		const modWriteOp = pendingMod2?.payload?.operationId
			? await fetchWriteOp(conn, pendingMod2.payload.operationId) : null;
		const modExpense = modWriteOp?.result_id ? await fetchExpenseById(conn, modWriteOp.result_id) : null;
		const modDelta = {
			depenses: countsAfterMod.depenses - countsBeforeMod.depenses,
			agent_write_operations: countsAfterMod.agent_write_operations - countsBeforeMod.agent_write_operations,
		};
		report.modification = {
			hashChanged: hash1 !== hash2,
			montant: modExpense?.montant_depense,
			delta: modDelta,
		};
		if (hash1 === hash2
			|| Number(modExpense?.montant_depense) !== 30
			|| modDelta.depenses !== 1
			|| modDelta.agent_write_operations !== 1) {
			await failAfterActivation(conn, envBackup, 'MODIFICATION_FAIL');
		}
		lastCommittedOp = {
			operationId: pendingMod2.payload.operationId,
			consumeToken: pendingMod2.payload.consumeToken,
			pendingWrite: pendingMod2.payload.pendingWrite,
			requestHash: hash2,
		};
		report.scenarios.modification = pass('modification 25→30', { montant: 30 });
		countsAfterWrites = countsAfterMod;

		// Step 12 — Production sale (only if produits > 0)
		report.sale = { executed: false, reason: 'skipped' };
		if (report.H102_BASELINE_LOCKED.produits > 0) {
			const saleSession = `${TAG}-sale`;
			const countsBeforeSale = await fetchCounts(conn, clientId, activityId);
			const saleProposal = await chat(token, activityId, SALE_MSG, saleSession);
			proposalMs.push(saleProposal.ms);
			const salePropS = snap(saleProposal, 'sale-proposal');
			const countsAfterSaleProp = await fetchCounts(conn, clientId, activityId);
			const pendingSale = await fetchPending(conn, clientId, activityId);
			if (saleProposal.status === 200 && salePropS.actionProposalStatus === 'READY_FOR_CONFIRMATION') {
				const saleConfirm = await chat(token, activityId, 'Oui', saleSession);
				confirmMs.push(saleConfirm.ms);
				const countsAfterSale = await fetchCounts(conn, clientId, activityId);
				const saleWriteOp = pendingSale?.payload?.operationId
					? await fetchWriteOp(conn, pendingSale.payload.operationId) : null;
				const saleRow = saleWriteOp?.result_id ? await fetchSaleById(conn, saleWriteOp.result_id) : null;
				report.sale = {
					executed: true,
					proposal: salePropS,
					confirm: snap(saleConfirm, 'sale-confirm'),
					delta: {
						ventes: countsAfterSale.ventes - countsBeforeSale.ventes,
						agent_write_operations: countsAfterSale.agent_write_operations - countsBeforeSale.agent_write_operations,
					},
					saleRow,
				};
				if (report.sale.delta.ventes !== 1 || saleWriteOp?.status !== 'completed') {
					await failAfterActivation(conn, envBackup, 'SALE_FAIL');
				}
				lastCommittedOp = {
					operationId: pendingSale.payload.operationId,
					consumeToken: pendingSale.payload.consumeToken,
					pendingWrite: pendingSale.payload.pendingWrite,
					requestHash: hashPending(clientId, pendingSale.payload.pendingWrite),
				};
				countsAfterWrites = countsAfterSale;
				report.scenarios.sale = pass('production sale', report.sale.delta);
			} else {
				await failAfterActivation(conn, envBackup, 'SALE_PROPOSAL_FAIL');
			}
		} else {
			report.notSimulated.push('CREATE_SALE_PRODUCTION');
			report.sale.reason = 'NOT_SIMULATED CREATE_SALE_PRODUCTION';
			report.scenarios.sale = pass('sale skipped (produits=0)', { notSimulated: true });
		}

		// Step 13 — Idempotency replay on last committed operation
		const countsBeforeReplay = await fetchCounts(conn, clientId, activityId);
		const replay = await rpcExpense(conn, clientId, activityId, {
			consumeToken: lastCommittedOp.consumeToken,
			operationId: lastCommittedOp.operationId,
			requestHash: lastCommittedOp.requestHash,
		});
		const countsAfterReplay = await fetchCounts(conn, clientId, activityId);
		report.idempotencyReplay = {
			status: replay.data?.status,
			result_id: replay.data?.result_id,
			replayDelta: { depenses: countsAfterReplay.depenses - countsBeforeReplay.depenses },
		};
		const idempOk = replay.data?.status === 'ALREADY_COMPLETED' && report.idempotencyReplay.replayDelta.depenses === 0;
		report.scenarios.idempotency = idempOk
			? pass('idempotency ALREADY_COMPLETED', report.idempotencyReplay)
			: fail('idempotency replay', report.idempotencyReplay);
		if (!idempOk) await failAfterActivation(conn, envBackup, 'IDEMPOTENCY_FAIL');

		// Step 14 — History POST /history 200
		const history = await http('POST', `${API}/history`, { token, activityId, body: {} });
		report.history = { status: history.status, pass: history.status === 200 };
		report.scenarios.history = history.status === 200
			? pass('history persistence', { status: 200 })
			: fail('history', { status: history.status });
		if (history.status !== 200) await failAfterActivation(conn, envBackup, 'HISTORY_FAIL');

		// Step 15 — Post-write READ
		const postReadResults = [];
		for (const msg of ['Quelles sont mes dépenses?', 'Quel est mon bénéfice?']) {
			const r = await chat(token, activityId, msg, `${TAG}-post-${postReadResults.length}`);
			readMs.push(r.ms);
			const s = snap(r, msg);
			postReadResults.push({ msg, ok: r.status === 200 && s.goalType !== 'ACTION', ...s });
		}
		report.scenarios.postWriteRead = postReadResults.every((x) => x.ok)
			? pass('post-write READ', postReadResults)
			: fail('post-write READ', postReadResults);

		// Step 16 — Performance stats
		report.performance = {
			read: stats(readMs),
			proposal: stats(proposalMs),
			confirm: stats(confirmMs),
			refH92: { p50: 686, p95: 1103 },
			refH93B: { proposal: 829, confirm: 688, total: 1517 },
		};

		// Step 17 — Logs grep (no secrets)
		report.logs = (await sshExec(conn, `docker logs ${CONTAINER} --since 20m 2>&1 | grep -iE 'f4_confirm|transactional_write_committed|action proposal|ALREADY_COMPLETED|fallback|scope|proposal|confirmation' | grep -viE 'password|Bearer|service_role|jwt|secret' | tail -15 || echo NO_MATCHES`)).split('\n').slice(0, 12);
		report.scenarios.logs = pass('logs sampled', { lines: report.logs.filter(Boolean).length });

		// Step 18 — Rollback readiness (LEGACY_ONLY ref exists) — check only, do NOT rollback
		const legacyOnlyRef = await sshExec(conn, `docker exec ${CONTAINER} grep -l 'LEGACY_ONLY' /app/src/agent/intelligence-v2/v2-cutover-policy.js 2>/dev/null && echo LEGACY_ONLY_REF_OK || echo LEGACY_ONLY_REF_MISSING`);
		const rollbackGitRef = await sshExec(conn, 'cd /opt/ashledger && git cat-file -t 6097852 2>/dev/null && echo OK || echo MISSING');
		report.rollbackReady = {
			legacyOnlyPolicy: legacyOnlyRef.includes('LEGACY_ONLY_REF_OK'),
			ref6097852: rollbackGitRef.includes('OK'),
		};
		report.scenarios.rollbackReady = report.rollbackReady.legacyOnlyPolicy && report.rollbackReady.ref6097852
			? pass('LEGACY_ONLY rollback ref exists', report.rollbackReady)
			: fail('rollback readiness', report.rollbackReady);

		// Final snapshot vs H102_BASELINE_LOCKED
		report.finalSnapshot = await fetchCounts(conn, clientId, activityId);
		report.finalDelta = {};
		for (const k of Object.keys(report.H102_BASELINE_LOCKED)) {
			report.finalDelta[k] = report.finalSnapshot[k] - report.H102_BASELINE_LOCKED[k];
		}

		const expectedDepenses = 2;
		const expectedVentes = report.sale.executed ? 1 : 0;
		const expectedOps = report.sale.executed ? 3 : 2;
		const finOk = report.finalDelta.depenses === expectedDepenses
			&& report.finalDelta.ventes === expectedVentes
			&& report.finalDelta.agent_write_operations === expectedOps
			&& report.finalDelta.stocks === 0
			&& report.finalDelta.produits === 0;

		report.scenarios.financialIntegrity = finOk
			? pass('financial integrity', report.finalDelta)
			: fail('financial integrity', { expectedDepenses, expectedVentes, expectedOps, actual: report.finalDelta });

		// Verdict — on GO leave ACTIONS/CONFIRM ON
		const allPass = Object.values(report.scenarios).every((s) => s.status === 'PASS');
		const perfWarn = (report.performance.read.p95 || 0) > 1500
			|| (report.performance.proposal.p95 || 0) > 2000
			|| (report.performance.confirm.p95 || 0) > 2000;

		if (allPass && finOk && idempOk) {
			report.verdict = perfWarn ? 'GO_WITH_PERFORMANCE_WARNING' : 'GO_H11_READY';
			report.finalFlagsState = report.postFlagsState;
		} else {
			report.verdict = 'NO_GO';
			if (report.activated && envBackup && !report.rollbackPerformed) {
				await rollbackActionsOff(conn, envBackup);
			}
		}
	} catch (e) {
		report.errors.push(e.message);
		report.verdict = 'NO_GO';
		if (conn && report.activated && envBackup && !report.rollbackPerformed) {
			try { await rollbackActionsOff(conn, envBackup); } catch (rbErr) { report.errors.push(`rollback:${rbErr.message}`); }
		}
	} finally {
		if (conn) conn.end();
	}

	writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
	console.log(JSON.stringify({
		tag: TAG,
		verdict: report.verdict,
		artifact: REPORT_PATH,
		scenarios: Object.fromEntries(Object.entries(report.scenarios).map(([k, v]) => [k, v.status])),
		finalDelta: report.finalDelta,
		rollbackPerformed: report.rollbackPerformed,
		activated: report.activated,
		notSimulated: report.notSimulated,
		errors: report.errors,
	}, null, 2));
	process.exit(report.verdict.startsWith('GO') ? 0 : 1);
}

main().catch((e) => {
	report.errors.push(e.message);
	writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
	console.error('FATAL:', e.message);
	process.exit(1);
});
