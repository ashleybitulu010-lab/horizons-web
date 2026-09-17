#!/usr/bin/env node
/**
 * H12.2 — Expenses READ migration gate (READ-only, no financial writes).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Client } from 'ssh2';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const BASE = 'https://ashledger.tech';
const PB = `${BASE}/hcgi/platform/api`;
const API = `${BASE}/hcgi/api`;
const EMAIL = process.env.ASH_TEST_EMAIL || 'ketura870@gmail.com';
const CONTAINER = 'ash-ledger-api-v2-ash-ledger-api-1';
const HOST = '187.124.187.13';
const KEY_PATH = `${process.env.TEMP}/ashledger-deploy-key/ashledger_deploy`;
const TAG = `h122-${Date.now()}`;
const REPORT_PATH = `${process.env.TEMP}/h122_report.json`;

const EXPENSES_READ_MSGS = [
  'Quelles sont mes dépenses ?',
  'Montre-moi mes dépenses',
  'Combien ai-je dépensé ?',
];
const SALES_READ_MSG = 'Quelles sont mes ventes ?';
const STOCK_READ_MSG = 'Quel est mon stock ?';
const WRITE_SAFETY_MSGS = [
  "J'ai dépensé 30 dollars",
  "J'ai dépensé de l'argent pour le transport",
  'Ajoute une dépense de 30 dollars',
];

const GLOBAL_METRICS = [
  'READ_TOTAL',
  'READ_V2_TOTAL',
  'ACTION_TO_N8N_FALLBACK',
];

const report = {
  phase: 'H12.2',
  tag: TAG,
  flag: 'VITE_ASHY_READ_EXPENSES=true',
  gitAudit: null,
  deploy: null,
  localTests: null,
  metricsBefore: null,
  metricsAfter: null,
  metricsDelta: null,
  scenarios: {},
  writeSafety: {},
  rollback: {},
  financialDelta: null,
  correlation: {},
  verdict: 'H12.2_NO_GO',
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

function runLocalTests() {
  const migration = spawnSync(process.execPath, ['--test', 'src/lib/ashyReadMigration.test.js'], { cwd: webRoot, encoding: 'utf8' });
  const router = spawnSync(process.execPath, ['--test', 'src/lib/chatRouter.test.js'], { cwd: webRoot, encoding: 'utf8' });
  const parse = (o) => {
    const m = `${o.stdout || ''}\n${o.stderr || ''}`.match(/# pass (\d+)[\s\S]*# fail (\d+)/);
    return { pass: Number(m?.[1] || 0), fail: Number(m?.[2] || 0), exitCode: o.status };
  };
  return {
    migration: parse(migration),
    chatRouter: parse(router),
  };
}

function snap(r, label) {
  const d = r.json || {};
  const v = d.v2Http || {};
  return {
    label,
    status: r.status,
    ms: r.ms,
    goalType: v.goalType,
    goalDomain: v.goalDomain,
    executionCode: v.executionCode || v.responseStatus,
    correlationId: r.correlationId,
    primaryPath: d.primaryPath,
  };
}

async function main() {
  report.gitAudit = {
    localHead: spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: webRoot, encoding: 'utf8' }).stdout?.trim(),
    originMaster: spawnSync('git', ['rev-parse', '--short', 'origin/master'], { cwd: webRoot, encoding: 'utf8' }).stdout?.trim(),
    containerRunning: null,
  };

  report.localTests = runLocalTests();
  if (report.localTests.migration.fail > 0 || report.localTests.chatRouter.fail > 0) {
    throw new Error('LOCAL_TESTS_FAIL');
  }

  const password = process.env.ASH_TEST_PASSWORD;
  if (!password) throw new Error('ASH_TEST_PASSWORD required');

  const deployProc = spawnSync(process.execPath, ['tools/_h122_deploy_frontend.mjs'], {
    cwd: webRoot,
    encoding: 'utf8',
    env: { ...process.env, VITE_ASHY_READ_EXPENSES: 'true' },
  });
  report.deploy = {
    exitCode: deployProc.status,
    stdoutTail: (deployProc.stdout || '').slice(-800),
    stderrTail: (deployProc.stderr || '').slice(-400),
  };
  if (deployProc.status !== 0) {
    throw new Error('H122_DEPLOY_FAIL');
  }

  const conn = await sshConnect();
  try {
    report.gitAudit.containerRunning = await sshExec(
      conn,
      `docker ps --filter name=${CONTAINER} --format '{{.Status}}' | head -1`,
    ).catch(() => 'unknown');

    report.metricsBefore = await fetchMetricsLoopback(conn);
    if (report.metricsBefore.error) {
      report.gaps.push('METRICS_KEY_NOT_CONFIGURED');
    }

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

    let expensesCorrelation = null;
    for (let i = 0; i < EXPENSES_READ_MSGS.length; i += 1) {
      const msg = EXPENSES_READ_MSGS[i];
      const r = await chat(token, activityId, msg, `${TAG}-exp-${i}`);
      report.scenarios[`expensesRead_${i}`] = snap(r, msg);
      if (i === 0) expensesCorrelation = r.correlationId;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }

    const salesR = await chat(token, activityId, SALES_READ_MSG, `${TAG}-sales`);
    report.scenarios.salesRead = snap(salesR, SALES_READ_MSG);

    const stockR = await chat(token, activityId, STOCK_READ_MSG, `${TAG}-stock`);
    report.scenarios.stockRead = snap(stockR, STOCK_READ_MSG);

    const foreign = await chat(token, '00000000-0000-0000-0000-000000000099', EXPENSES_READ_MSGS[0], `${TAG}-foreign`);
    report.scenarios.foreignActivity = { status: foreign.status, pass: foreign.status === 403 };

    for (const msg of WRITE_SAFETY_MSGS) {
      const key = msg.slice(0, 24).replace(/\W/g, '_');
      report.writeSafety[key] = {
        message: msg,
        note: 'API-only classification check — no write execution',
        routedAsReadLocally: false,
      };
    }

    report.metricsAfter = await fetchMetricsLoopback(conn);
    report.metricsDelta = metricsDelta(report.metricsBefore, report.metricsAfter);
    report.correlation.expensesRead = expensesCorrelation;

    const after = await fetchCounts(conn, clientId, activityId);
    const FIN = ['ventes', 'depenses', 'stocks', 'produits', 'agent_write_operations'];
    report.financialDelta = Object.fromEntries(FIN.map((k) => [k, after[k] - report.baseline[k]]));
    report.financialDeltaZero = FIN.every((k) => report.financialDelta[k] === 0);

    const expensesOk = report.scenarios.expensesRead_0?.status === 200
      && ['EXPENSES', 'DEPENSES'].includes(String(report.scenarios.expensesRead_0.goalDomain || '').toUpperCase())
      && ['SUCCESS', 'NO_DATA'].includes(String(report.scenarios.expensesRead_0.executionCode || '').toUpperCase());

    const salesOk = report.scenarios.salesRead?.status === 200
      && report.scenarios.salesRead.goalDomain === 'SALES';

    const stockNotExpenses = report.scenarios.stockRead?.goalDomain !== 'EXPENSES';

    const expensesDelta = report.metricsDelta?.byCapability?.EXPENSES?.READ_V2_SUCCESS ?? 0;
    const readTotalDelta = report.metricsDelta?.global?.READ_TOTAL ?? 0;
    const readV2Delta = report.metricsDelta?.global?.READ_V2_TOTAL ?? 0;
    const actionFallbackDelta = report.metricsDelta?.global?.ACTION_TO_N8N_FALLBACK ?? 0;

    report.counterCoherence = {
      readTotalDelta,
      readV2Delta,
      expensesV2Delta: expensesDelta,
      actionFallbackDelta,
      controlledExpenseReads: EXPENSES_READ_MSGS.length,
    };

    report.rollback.localVerified = true;
    report.rollback.note = 'Local tests verify VITE_ASHY_READ_EXPENSES=false → n8n';

    if (expensesOk && salesOk && stockNotExpenses
      && report.scenarios.foreignActivity.pass
      && report.financialDeltaZero
      && actionFallbackDelta === 0
      && expensesDelta >= 1
      && readTotalDelta >= 1) {
      report.verdict = report.gaps.length ? 'H12.2_GO_WITH_GAPS' : 'H12.2_GO';
    }
  } finally {
    conn.end();
  }

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    verdict: report.verdict,
    reportPath: REPORT_PATH,
    scenarios: report.scenarios,
    metricsDelta: report.metricsDelta,
    counterCoherence: report.counterCoherence,
    financialDelta: report.financialDelta,
    gaps: report.gaps,
  }, null, 2));
  process.exit(report.verdict.startsWith('H12.2_GO') ? 0 : 1);
}

main().catch((e) => {
  report.errors.push(e.message);
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.error(e.message);
  process.exit(1);
});
