#!/usr/bin/env node
/**
 * H12.1 — SALES read migration gate (READ-only, no financial writes).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Client } from 'ssh2';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const BASE = 'https://ashledger.tech';
const PB = `${BASE}/hcgi/platform/api`;
const API = `${BASE}/hcgi/api`;
const EMAIL = process.env.ASH_TEST_EMAIL || 'ketura870@gmail.com';
const CONTAINER = 'ash-ledger-api-v2-ash-ledger-api-1';
const HOST = '187.124.187.13';
const KEY_PATH = `${process.env.TEMP}/ashledger-deploy-key/ashledger_deploy`;
const TAG = `h121-${Date.now()}`;
const REPORT_PATH = `${process.env.TEMP}/h121_report.json`;
const H11_READ_P50 = 1037;

const SALES_READ_MSG = 'Quelles sont mes ventes ?';
const EXPENSES_READ_MSG = 'Quelles sont mes dépenses ?';
const CONTROL_N8N_MSG = 'Bonjour Ashy';

const report = {
  phase: 'H12.1',
  tag: TAG,
  selectedRead: 'SALES',
  gitAudit: null,
  baseline: null,
  scenarios: {},
  latency: {},
  financialDelta: null,
  rollback: {},
  localTests: null,
  verdict: 'H12.1_NO_GO',
  errors: [],
};

function stats(v) {
  if (!v.length) return { count: 0, p50: null, p95: null, max: null };
  const s = [...v].sort((a, b) => a - b);
  return {
    count: s.length,
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
  const migration = spawnSync(process.execPath, ['--test', 'src/lib/ashyReadMigration.test.js'], { cwd: webRoot, encoding: 'utf8' });
  const router = spawnSync(process.execPath, ['--test', 'src/lib/chatRouter.test.js'], { cwd: webRoot, encoding: 'utf8' });
  const transport = spawnSync(process.execPath, ['--test', 'src/lib/chatTransport.test.js'], { cwd: webRoot, encoding: 'utf8' });
  const parse = (o) => {
    const m = `${o.stdout || ''}\n${o.stderr || ''}`.match(/# pass (\d+)[\s\S]*# fail (\d+)/);
    return { pass: Number(m?.[1] || 0), fail: Number(m?.[2] || 0), exitCode: o.status };
  };
  return {
    migration: parse(migration),
    chatRouter: parse(router),
    chatTransport: parse(transport),
  };
}

function snap(r, label) {
  const d = r.json || {};
  const v = d.v2Http || {};
  return {
    label, status: r.status, ms: r.ms,
    goalType: v.goalType, goalDomain: v.goalDomain,
    executionCode: v.executionCode || v.responseStatus,
    primaryPath: d.primaryPath,
    fallbackPolicy: d.fallbackPolicy,
    noN8nFallback: d.noN8nFallback,
  };
}

async function main() {
  report.gitAudit = {
    localHead: spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: webRoot, encoding: 'utf8' }).stdout?.trim(),
    originMaster: spawnSync('git', ['rev-parse', '--short', 'origin/master'], { cwd: webRoot, encoding: 'utf8' }).stdout?.trim(),
  };

  report.localTests = runLocalTests();
  if (report.localTests.migration.fail > 0 || report.localTests.chatRouter.fail > 0) {
    throw new Error('LOCAL_TESTS_FAIL');
  }

  const password = process.env.ASH_TEST_PASSWORD;
  if (!password) throw new Error('ASH_TEST_PASSWORD required');

  const conn = await sshConnect();
  try {
    const auth = await http('POST', `${PB}/collections/users/auth-with-password`, {
      body: { identity: EMAIL, password },
    });
    if (auth.status !== 200) throw new Error(`AUTH_${auth.status}`);
    const token = auth.json.token;
    const me = await http('GET', `${API}/api/me`, { token });
    const clientId = me.json?.user?.clientId;
    const activityId = me.json?.user?.activeActivityId;
    if (!clientId || !activityId) throw new Error('AUTH_SCOPE_MISSING');

    report.baseline = await fetchCounts(conn, clientId, activityId);

    const salesMs = [];
    const r1 = await chat(token, activityId, SALES_READ_MSG);
    salesMs.push(r1.ms);
    report.scenarios.salesRead = snap(r1, SALES_READ_MSG);

    const r2 = await chat(token, activityId, EXPENSES_READ_MSG);
    report.scenarios.expensesReadControl = snap(r2, EXPENSES_READ_MSG);

    const foreign = await chat(token, '00000000-0000-0000-0000-000000000099', SALES_READ_MSG);
    report.scenarios.foreignActivity = { status: foreign.status, pass: foreign.status === 403 };

    const after = await fetchCounts(conn, clientId, activityId);
    const FIN = ['ventes', 'depenses', 'stocks', 'produits', 'agent_write_operations'];
    report.financialDelta = Object.fromEntries(FIN.map((k) => [k, after[k] - report.baseline[k]]));
    report.financialDeltaZero = FIN.every((k) => report.financialDelta[k] === 0);

    report.latency.salesRead = stats(salesMs);
    report.latency.h11ReferenceP50 = H11_READ_P50;

    const salesOk = r1.status === 200
      && report.scenarios.salesRead.goalDomain === 'SALES'
      && report.scenarios.salesRead.executionCode === 'SUCCESS';
    const scopeOk = foreign.status === 403;
    const deltaOk = report.financialDeltaZero;

    if (salesOk && scopeOk && deltaOk) {
      const p50 = report.latency.salesRead.p50;
      report.verdict = p50 && p50 > H11_READ_P50 * 1.5
        ? 'H12.1_GO_WITH_WARNING'
        : 'H12.1_GO';
    }
  } finally {
    conn.end();
  }

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ verdict: report.verdict, reportPath: REPORT_PATH, scenarios: report.scenarios, financialDelta: report.financialDelta }, null, 2));
  process.exit(report.verdict.startsWith('H12.1_GO') ? 0 : 1);
}

main().catch((e) => {
  report.errors.push(e.message);
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.error(e);
  process.exit(1);
});
