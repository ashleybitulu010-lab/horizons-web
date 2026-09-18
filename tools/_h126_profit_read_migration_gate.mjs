#!/usr/bin/env node
/**
 * H12.6 — Profit/Analysis READ migration gate (READ-only, no financial writes).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Client } from 'ssh2';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const apiRoot = path.join(webRoot, 'apps', 'api');
const BASE = 'https://ashledger.tech';
const PB = `${BASE}/hcgi/platform/api`;
const API = `${BASE}/hcgi/api`;
const EMAIL = process.env.ASH_TEST_EMAIL || 'ketura870@gmail.com';
const CONTAINER = 'ash-ledger-api-v2-ash-ledger-api-1';
const HOST = '187.124.187.13';
const KEY_PATH = `${process.env.TEMP}/ashledger-deploy-key/ashledger_deploy`;
const TAG = `h126-${Date.now()}`;
const REPORT_PATH = `${process.env.TEMP}/h126_report.json`;

const PROFIT_READ_MSGS = [
  'Quel est mon bénéfice ?',
  'Combien ai-je gagné ?',
  'Quel est mon profit ?',
];
const ANALYSIS_MSGS = [
  'Analyse mes résultats',
  'Comment vont mes finances ?',
  'Pourquoi mon bénéfice a changé ?',
];
const COMPARE_MSGS = [
  'Compare mon bénéfice avec le mois passé',
  'Mon bénéfice a-t-il augmenté ?',
];
const MARGIN_MSG = 'Quelle est ma marge ?';
const SALES_READ_MSG = 'Quelles sont mes ventes ?';
const EXPENSES_READ_MSG = 'Quelles sont mes dépenses ?';
const STOCK_READ_MSG = 'Combien me reste-t-il de poulets ?';
const PRODUCTS_READ_MSG = 'Liste mes produits';
const DEBTS_READ_MSG = 'Qui me doit de l\'argent ?';
const PDF_MSG = 'Génère mon bilan PDF';

const GLOBAL_METRICS = ['READ_TOTAL', 'READ_V2_TOTAL', 'ACTION_TO_N8N_FALLBACK'];

const report = {
  phase: 'H12.6',
  tag: TAG,
  flag: 'VITE_ASHY_READ_PROFIT=true',
  gitAudit: null,
  deploy: {},
  localTests: null,
  metricsBefore: null,
  metricsAfter: null,
  metricsDelta: null,
  scenarios: {},
  financialDelta: null,
  correlation: {},
  verdict: 'H12.6_NO_GO',
  errors: [],
  gaps: [
    'Compare mes dépenses et mes revenus — classifier EXPENSES COMPARE (frontend routes PROFIT)',
    'GENERAL SUMMARIZE metrics map to REPORT not PROFIT',
    'Comment évoluent mes ventes/dépenses — not frontend profit route (SALES/EXPENSES COMPARE)',
    'Quelle est l\'évolution de mon chiffre d\'affaires — SALES COMPARE, not profit frontend route',
  ],
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

async function clearPendingWrites(conn, clientId) {
  return dockerExecNode(conn, `
const{createClient}=require('@supabase/supabase-js');global.WebSocket=require('ws');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{const cid=${JSON.stringify(clientId)};
const del=await sb.from('agent_sessions').delete().eq('client_id',cid).eq('state_type','pending');
console.log(JSON.stringify({ cleared:true, deleted:del.count??null, error:del.error?.message||null }));
})();`);
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
paiements_dettes:await c('paiements_dettes',{client:true,activity:true}),
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
    for (const outcome of ['READ_V2_SUCCESS', 'READ_V2_ERROR', 'READ_SAFE_FALLBACK']) {
      delta.byCapability[cap][outcome] = (after.byCapability?.[cap]?.[outcome] || 0)
        - (before.byCapability?.[cap]?.[outcome] || 0);
    }
  }
  return delta;
}

function runLocalTests() {
  const migration = spawnSync(process.execPath, ['--test', 'src/lib/ashyReadMigration.test.js'], { cwd: webRoot, encoding: 'utf8' });
  const router = spawnSync(process.execPath, ['--test', 'src/lib/chatRouter.test.js'], { cwd: webRoot, encoding: 'utf8' });
  const apiClassifier = spawnSync(process.execPath, ['--test', 'tests/intelligence-v2-classifier-h126.test.js'], { cwd: apiRoot, encoding: 'utf8' });
  const apiResponse = spawnSync(process.execPath, ['--test', 'tests/intelligence-v2-response.test.js'], { cwd: apiRoot, encoding: 'utf8' });
  const apiFinancial = spawnSync(process.execPath, ['--test', 'tests/intelligence-v2-financial.test.js'], { cwd: apiRoot, encoding: 'utf8' });
  const parse = (o) => {
    const m = `${o.stdout || ''}\n${o.stderr || ''}`.match(/# pass (\d+)[\s\S]*# fail (\d+)/);
    return { pass: Number(m?.[1] || 0), fail: Number(m?.[2] || 0), exitCode: o.status };
  };
  return {
    migration: parse(migration),
    chatRouter: parse(router),
    apiClassifier: parse(apiClassifier),
    apiResponse: parse(apiResponse),
    apiFinancial: parse(apiFinancial),
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
    goalObjective: v.goalObjective,
    executionCode: v.executionCode || v.responseStatus,
    correlationId: r.correlationId,
    primaryPath: d.primaryPath,
    replyPreview: String(d.reply || d.message || '').slice(0, 120),
  };
}

function isProfitAnalysisSuccess(s) {
  if (s.status !== 200) return false;
  const domain = String(s.goalDomain || '').toUpperCase();
  const code = String(s.executionCode || '').toUpperCase();
  const okDomain = ['PROFIT', 'GENERAL', 'REPORT'].includes(domain);
  const okCode = ['SUCCESS', 'NO_DATA', 'PARTIAL'].includes(code);
  return okDomain && okCode;
}

async function main() {
  report.gitAudit = {
    localHead: spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: webRoot, encoding: 'utf8' }).stdout?.trim(),
  };

  report.localTests = runLocalTests();
  if (report.localTests.migration.fail > 0
    || report.localTests.chatRouter.fail > 0
    || report.localTests.apiClassifier.fail > 0
    || report.localTests.apiResponse.fail > 0
    || report.localTests.apiFinancial.fail > 0) {
    throw new Error('LOCAL_TESTS_FAIL');
  }

  const password = process.env.ASH_TEST_PASSWORD;
  if (!password) throw new Error('ASH_TEST_PASSWORD required');

  const apiDeploy = spawnSync(process.execPath, ['tools/_h126_deploy_api.mjs'], { cwd: webRoot, encoding: 'utf8' });
  report.deploy.api = { exitCode: apiDeploy.status, stderrTail: (apiDeploy.stderr || '').slice(-400) };
  if (apiDeploy.status !== 0) throw new Error('H126_API_DEPLOY_FAIL');

  const feDeploy = spawnSync(process.execPath, ['tools/_h126_deploy_frontend.mjs'], {
    cwd: webRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      VITE_ASHY_READ_EXPENSES: 'true',
      VITE_ASHY_READ_STOCK: 'true',
      VITE_ASHY_READ_PRODUCTS: 'true',
      VITE_ASHY_READ_DEBTS: 'true',
      VITE_ASHY_READ_PROFIT: 'true',
    },
  });
  report.deploy.frontend = { exitCode: feDeploy.status, stdoutTail: (feDeploy.stdout || '').slice(-600) };
  if (feDeploy.status !== 0) throw new Error('H126_FRONTEND_DEPLOY_FAIL');

  const conn = await sshConnect();
  try {
    report.metricsBefore = await fetchMetricsLoopback(conn);

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
    report.pendingCleanup = await clearPendingWrites(conn, clientId);

    let profitCorrelation = null;
    for (let i = 0; i < PROFIT_READ_MSGS.length; i += 1) {
      const msg = PROFIT_READ_MSGS[i];
      const r = await chat(token, activityId, msg, `${TAG}-profit-${i}`);
      report.scenarios[`profitRead_${i}`] = snap(r, msg);
      if (i === 0) profitCorrelation = r.correlationId;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }

    for (let i = 0; i < ANALYSIS_MSGS.length; i += 1) {
      const msg = ANALYSIS_MSGS[i];
      const r = await chat(token, activityId, msg, `${TAG}-analysis-${i}`);
      report.scenarios[`analysisRead_${i}`] = snap(r, msg);
      await new Promise((resolve) => setTimeout(resolve, 350));
    }

    for (let i = 0; i < COMPARE_MSGS.length; i += 1) {
      const msg = COMPARE_MSGS[i];
      const r = await chat(token, activityId, msg, `${TAG}-compare-${i}`);
      report.scenarios[`compareRead_${i}`] = snap(r, msg);
      await new Promise((resolve) => setTimeout(resolve, 350));
    }

    report.scenarios.marginRead = snap(await chat(token, activityId, MARGIN_MSG, `${TAG}-margin`), MARGIN_MSG);
    report.scenarios.salesRead = snap(await chat(token, activityId, SALES_READ_MSG, `${TAG}-sales`), SALES_READ_MSG);
    report.scenarios.expensesRead = snap(await chat(token, activityId, EXPENSES_READ_MSG, `${TAG}-expenses`), EXPENSES_READ_MSG);
    report.scenarios.stockRead = snap(await chat(token, activityId, STOCK_READ_MSG, `${TAG}-stock`), STOCK_READ_MSG);
    report.scenarios.productsRead = snap(await chat(token, activityId, PRODUCTS_READ_MSG, `${TAG}-products`), PRODUCTS_READ_MSG);
    report.scenarios.debtsRead = snap(await chat(token, activityId, DEBTS_READ_MSG, `${TAG}-debts`), DEBTS_READ_MSG);
    report.scenarios.pdfRead = snap(await chat(token, activityId, PDF_MSG, `${TAG}-pdf`), PDF_MSG);

    const foreign = await chat(token, '00000000-0000-0000-0000-000000000099', PROFIT_READ_MSGS[0], `${TAG}-foreign`);
    report.scenarios.foreignActivity = { status: foreign.status, pass: foreign.status === 403 };

    report.metricsAfter = await fetchMetricsLoopback(conn);
    report.metricsDelta = metricsDelta(report.metricsBefore, report.metricsAfter);
    report.correlation.profitRead = profitCorrelation;

    const after = await fetchCounts(conn, clientId, activityId);
    const FIN = ['ventes', 'depenses', 'stocks', 'produits', 'paiements_dettes', 'agent_write_operations'];
    report.financialDelta = Object.fromEntries(FIN.map((k) => [k, after[k] - report.baseline[k]]));
    report.financialDeltaZero = FIN.every((k) => report.financialDelta[k] === 0);

    const profitScenarios = Object.entries(report.scenarios).filter(([k]) => k.startsWith('profitRead_'));
    const analysisScenarios = Object.entries(report.scenarios).filter(([k]) => k.startsWith('analysisRead_'));
    const compareScenarios = Object.entries(report.scenarios).filter(([k]) => k.startsWith('compareRead_'));

    const profitOk = profitScenarios.every(([, s]) => s.status === 200
      && s.goalDomain === 'PROFIT'
      && s.goalType === 'QUESTION'
      && ['SUCCESS', 'NO_DATA'].includes(String(s.executionCode || '').toUpperCase()));

    const analysisOk = analysisScenarios.every(([, s]) => isProfitAnalysisSuccess(s));
    const compareOk = compareScenarios.every(([, s]) => isProfitAnalysisSuccess(s)
      || (s.goalDomain === 'PROFIT' && ['SUCCESS', 'NO_DATA'].includes(String(s.executionCode || '').toUpperCase())));

    const marginOk = report.scenarios.marginRead?.goalDomain === 'PROFIT';
    const salesOk = report.scenarios.salesRead?.goalDomain === 'SALES';
    const expensesOk = report.scenarios.expensesRead?.goalDomain === 'EXPENSES';
    const stockOk = report.scenarios.stockRead?.goalDomain === 'STOCK';
    const productsOk = report.scenarios.productsRead?.goalDomain === 'PRODUCTS';
    const debtsOk = report.scenarios.debtsRead?.goalDomain === 'DEBTS';
    const pdfLegacy = report.scenarios.pdfRead?.primaryPath !== 'v2Http' || report.scenarios.pdfRead?.goalDomain !== 'PROFIT';

    const profitDelta = (report.metricsDelta?.byCapability?.PROFIT?.READ_V2_SUCCESS ?? 0)
      + (report.metricsDelta?.byCapability?.REPORT?.READ_V2_SUCCESS ?? 0);
    const actionFallbackDelta = report.metricsDelta?.global?.ACTION_TO_N8N_FALLBACK ?? 0;

    report.counterCoherence = {
      readTotalDelta: report.metricsDelta?.global?.READ_TOTAL ?? 0,
      readV2Delta: report.metricsDelta?.global?.READ_V2_TOTAL ?? 0,
      profitV2Delta: profitDelta,
      actionFallbackDelta,
      controlledProfitReads: PROFIT_READ_MSGS.length + ANALYSIS_MSGS.length + COMPARE_MSGS.length + 1,
    };

    report.rollback = { localVerified: true, note: 'VITE_ASHY_READ_PROFIT=false → n8n (local tests)' };

    if (profitOk && analysisOk && compareOk && marginOk
      && salesOk && expensesOk && stockOk && productsOk && debtsOk
      && pdfLegacy
      && report.scenarios.foreignActivity.pass
      && report.financialDeltaZero
      && actionFallbackDelta === 0
      && profitDelta >= 1) {
      report.verdict = report.gaps.length ? 'H12.6_GO_WITH_GAPS' : 'H12.6_GO';
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
    financialDelta: report.financialDelta,
  }, null, 2));
  process.exit(report.verdict.startsWith('H12.6_GO') ? 0 : 1);
}

main().catch((e) => {
  report.errors.push(e.message);
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.error(e.message);
  process.exit(1);
});
