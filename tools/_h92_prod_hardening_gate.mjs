#!/usr/bin/env node
/** H9.2 — deploy READ hardening fixes + production validation (ACTIONS/CONFIRM stay OFF). */
import { Client } from 'ssh2';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const TAG = `h92-${Date.now()}`;

const FILES = [
	'src/agent/intelligence-v2/goal-classifier-rules.js',
	'src/agent/intelligence-v2/response/response-templates.js',
	'src/agent/intelligence-v2/financial/financial-analyzer.js',
	'src/agent/intent-resolver/regex-resolver.js',
];

const READ_SAMPLES = [
	'Quelles dettes clients ?',
	'Compare mes ventes.',
	'Compare mes dépenses.',
	'Quel est mon bénéfice ?',
	'Compare mon bénéfice.',
	'Comment évolue mon bénéfice ?',
	'Quels sont mes produits ?',
	'Liste mes produits.',
	'Quel est mon stock ?',
	'Fais-moi le point.',
	'Comment va mon activité ?',
	'Quelles sont mes ventes ?',
	'Quelles sont mes dépenses ?',
	'Qui me doit de l\'argent ?',
	'Quel est mon chiffre d\'affaires ?',
	'Comment évoluent mes ventes ?',
	'Comment évoluent mes dépenses ?',
	'Compare ventes et dépenses',
	'Montre-moi mon stock actuel',
	'Résumé de mon activité',
];

const report = { phase: 'H9.2', tag: TAG, errors: [], verdict: 'NO_GO' };

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

async function fetchCounts(conn, clientId, activityId) {
	const js = `const{createClient}=require('@supabase/supabase-js');global.WebSocket=require('ws');const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});(async()=>{const cid=${JSON.stringify(clientId)};const aid=${JSON.stringify(activityId)};async function c(t,o){let q=sb.from(t).select(o.col||'id',{count:'exact',head:true});if(o.client)q=q.eq('client_id',cid);if(o.activity)q=q.eq('activity_id',aid);const{count}=await q;return count??0;}console.log(JSON.stringify({ventes:await c('ventes',{client:true,activity:true}),depenses:await c('depenses',{client:true,activity:true}),stocks:await c('stocks',{client:true,activity:true,col:'*'}),produits:await c('produits',{client:true,activity:true}),agent_write_operations:await c('agent_write_operations',{client:true,activity:false})}));})();`;
	const out = await sshExec(conn, `echo ${Buffer.from(js).toString('base64')} | base64 -d | docker exec -i ${CONTAINER} node`);
	return JSON.parse(out.split('\n').pop());
}

function snap(r, msg) {
	const d = r.json || {}; const v = d.v2Http || {};
	return {
		message: msg.slice(0, 50), status: r.status, ms: r.ms,
		v2Handled: v.handled === true,
		goalType: v.goalType, goalDomain: v.goalDomain, goalObjective: v.goalObjective,
		responseStatus: v.responseStatus, executionCode: v.executionCode,
		actionStatus: v.actionStatus, cutoverMode: d.cutoverMode || v.cutoverMode,
		noN8nFallback: d.noN8nFallback ?? v.noN8nFallback,
	};
}

async function main() {
	const password = process.env.ASH_TEST_PASSWORD;
	if (!password) throw new Error('ASH_TEST_PASSWORD required');

	const conn = await sshConnect();
	try {
		report.deploy = [];
		for (const rel of FILES) {
			await sftpUpload(conn, path.join(apiRoot, rel), `${REMOTE_API}/${rel}`);
			report.deploy.push(rel);
		}
		report.rebuild = await sshExec(conn, 'cd /docker/ash-ledger-api-v2 && docker compose -f docker-compose.parallel.yml build ash-ledger-api && docker compose -f docker-compose.parallel.yml up -d ash-ledger-api');

		const flagScript = readFileSync(new URL('./_ashy_v2_phase_h7_prod_flag_audit.sh', import.meta.url), 'utf8');
		const flags = (await sshExec(conn, `echo ${Buffer.from(flagScript).toString('base64')} | base64 -d | bash`)).split('\n').filter((l) => /^(OFF|ON|ABS):/.test(l));
		report.flags = flags;
		report.flagsState = {
			actions: flags.some((l) => l.startsWith('ON:ASHY_INTELLIGENCE_V2_ACTIONS:')),
			confirm: flags.some((l) => l.startsWith('ON:ASHY_INTELLIGENCE_V2_HTTP_CONFIRM:')),
		};
		if (report.flagsState.actions || report.flagsState.confirm) throw new Error('CRITICAL_ACTIONS_OR_CONFIRM_ON');

		const login = await http('POST', `${PB}/collections/users/auth-with-password`, { body: { identity: EMAIL, password } });
		const token = login.json?.token;
		const me = await http('GET', `${API}/api/me`, { token });
		const clientId = me.json?.user?.clientId;
		const activityId = me.json?.user?.activeActivityId;

		report.baseline = await fetchCounts(conn, clientId, activityId);

		const results = []; const latencies = [];
		for (let i = 0; i < READ_SAMPLES.length; i++) {
			const msg = READ_SAMPLES[i];
			const r = await http('POST', `${API}/api/ashy/chat`, { token, activityId, body: { message: msg, sessionId: `${TAG}-r${i}` } });
			const s = snap(r, msg);
			results.push(s);
			if (r.status === 200 && s.v2Handled) latencies.push(r.ms);
		}
		report.readTraffic = results;
		report.readStats = {
			samples: READ_SAMPLES.length,
			success: results.filter((s) => s.status === 200 && s.v2Handled).length,
			latency: stats(latencies),
		};

		const debts = results.find((s) => s.message.startsWith('Quelles dettes'));
		const compareSales = results.find((s) => s.message.startsWith('Compare mes ventes'));
		report.fixValidation = {
			debts: {
				pass: debts?.goalType !== 'ACTION' && debts?.goalDomain === 'DEBTS',
				goalType: debts?.goalType, goalDomain: debts?.goalDomain, goalObjective: debts?.goalObjective,
			},
			compareSales: {
				pass: compareSales?.responseStatus === 'NO_DATA' && compareSales?.executionCode === 'SUCCESS',
				responseStatus: compareSales?.responseStatus, executionCode: compareSales?.executionCode,
			},
			noReadAsAction: results.filter((s) => s.goalType === 'ACTION' && s.actionStatus !== 'V2_ACTIONS_DISABLED').length === 0,
		};

		const actionR = await http('POST', `${API}/api/ashy/chat`, { token, activityId, body: { message: "J'ai vendu 2 produits à 30 dollars.", sessionId: `${TAG}-action` } });
		report.actionBlocking = snap(actionR, 'action');

		report.finalSnapshot = await fetchCounts(conn, clientId, activityId);
		report.financialDelta = {};
		for (const k of Object.keys(report.baseline)) report.financialDelta[k] = report.finalSnapshot[k] - report.baseline[k];

		const finOk = Object.values(report.financialDelta).every((v) => v === 0);
		const fixesOk = report.fixValidation.debts.pass && report.fixValidation.compareSales.pass && report.fixValidation.noReadAsAction;
		const readOk = report.readStats.success >= 18;
		const perfWarn = report.readStats.latency.p95 > 1000;
		report.verdict = finOk && fixesOk && readOk ? (perfWarn ? 'GO_WITH_PERFORMANCE_WARNING' : 'GO_H9_3_READY') : 'NO_GO';

		writeFileSync(`${process.env.TEMP}/h92_prod_report.json`, JSON.stringify(report, null, 2));
		console.log(JSON.stringify({
			verdict: report.verdict,
			fixValidation: report.fixValidation,
			readStats: report.readStats,
			financialDelta: report.financialDelta,
			flagsState: report.flagsState,
		}, null, 2));
	} finally {
		conn.end();
	}
}

main().catch((e) => {
	report.errors.push(e.message);
	writeFileSync(`${process.env.TEMP}/h92_prod_report.json`, JSON.stringify(report, null, 2));
	console.error('FATAL:', e.message);
	process.exit(1);
});
