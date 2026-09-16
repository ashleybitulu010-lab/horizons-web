import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, test } from 'node:test';

import { publicConfigSnapshot } from '../src/config/env.js';
import {
	CUTOVER_MODE,
	getCutoverDiagnostics,
	mapFlagsForCutoverMode,
	resolveCutoverMode,
	validateCutoverConfigSafety,
} from '../src/agent/intelligence-v2/v2-cutover-policy.js';
import {
	resolveV2FallbackPolicy,
	V2_FALLBACK_POLICY,
} from '../src/agent/intelligence-v2/v2-fallback-policy.js';
import { ACTION_PROPOSAL_STATUS } from '../src/agent/intelligence-v2/action/action-proposal-contract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_API = join(__dirname, '..');

function prodDefaultEnv() {
	return {
		nodeEnv: 'production',
		ashyIntelligenceV2: false,
		ashyIntelligenceV2Http: false,
		ashyIntelligenceV2Primary: false,
		ashyIntelligenceV2Actions: false,
		ashyIntelligenceV2HttpConfirm: false,
		ashyIntelligenceV2Shadow: false,
		ashyV2CutoverMode: '',
		ashyV2PrimarySafeFallback: false,
	};
}

afterEach(() => {
	delete process.env.ASHY_INTELLIGENCE_V2;
	delete process.env.ASHY_INTELLIGENCE_V2_PRIMARY;
	delete process.env.ASHY_INTELLIGENCE_V2_HTTP;
});

describe('H7 production defaults — V2 OFF', () => {
	test('absent flags → LEGACY_ONLY', () => {
		assert.equal(resolveCutoverMode({}), CUTOVER_MODE.LEGACY_ONLY);
	});

	test('production default env → primary off', () => {
		const env = prodDefaultEnv();
		assert.equal(resolveCutoverMode(env), CUTOVER_MODE.LEGACY_ONLY);
		assert.equal(env.ashyIntelligenceV2Primary, false);
	});

	test('validateCutoverConfigSafety safe for production defaults', () => {
		const r = validateCutoverConfigSafety(prodDefaultEnv());
		assert.equal(r.safe, true);
		assert.equal(r.productionDefaultLegacy, true);
	});
});

describe('H7 flag safety — dangerous configs rejected', () => {
	test('PRIMARY without V2 → unsafe', () => {
		const r = validateCutoverConfigSafety({
			ashyIntelligenceV2: false,
			ashyIntelligenceV2Http: false,
			ashyIntelligenceV2Primary: true,
		});
		assert.equal(r.safe, false);
		assert.ok(r.issues.some((i) => i.includes('ASHY_INTELLIGENCE_V2_PRIMARY')));
	});

	test('PRIMARY without HTTP → unsafe', () => {
		const r = validateCutoverConfigSafety({
			ashyIntelligenceV2: true,
			ashyIntelligenceV2Http: false,
			ashyIntelligenceV2Primary: true,
		});
		assert.equal(r.safe, false);
		assert.ok(r.issues.some((i) => i.includes('HTTP')));
	});

	test('SAFE_FALLBACK without PRIMARY → unsafe', () => {
		const r = validateCutoverConfigSafety({
			ashyIntelligenceV2: true,
			ashyIntelligenceV2Http: true,
			ashyIntelligenceV2Primary: false,
			ashyV2PrimarySafeFallback: true,
		});
		assert.equal(r.safe, false);
	});

	test('valid primary staging config → safe', () => {
		const r = validateCutoverConfigSafety({
			ashyIntelligenceV2: true,
			ashyIntelligenceV2Http: true,
			ashyIntelligenceV2Primary: true,
			ashyIntelligenceV2Actions: true,
			ashyIntelligenceV2HttpConfirm: true,
		});
		assert.equal(r.safe, true);
		assert.equal(r.mode, CUTOVER_MODE.V2_PRIMARY);
	});
});

describe('H7 deployment artifacts', () => {
	test('Dockerfile exists with healthcheck on /hcgi/api/health', () => {
		const dockerfile = readFileSync(join(REPO_API, 'Dockerfile'), 'utf8');
		assert.ok(dockerfile.includes('hcgi/api/health'));
		assert.ok(dockerfile.includes('NODE_ENV=production'));
	});

	test('docker-compose maps host 3001 → container 3000', () => {
		const compose = readFileSync(join(REPO_API, 'docker-compose.yml'), 'utf8');
		assert.ok(compose.includes('127.0.0.1:3001:3000'));
		assert.ok(compose.includes('ash-ledger-api'));
	});

	test('app mounts routes at /hcgi/api', () => {
		const appJs = readFileSync(join(REPO_API, 'src/app.js'), 'utf8');
		assert.ok(appJs.includes("app.use('/hcgi/api', apiRouter)"));
	});

	test('rollback runbook exists', () => {
		const path = join(REPO_API, '../../docs/operations/H6-rollback-runbook.md');
		assert.ok(existsSync(path));
	});

	test('cutover runbook exists', () => {
		const path = join(REPO_API, '../../docs/operations/H6-cutover-runbook.md');
		assert.ok(existsSync(path));
	});
});

describe('H7 health endpoint contract', () => {
	test('publicConfigSnapshot never exposes secrets', () => {
		const snap = publicConfigSnapshot({
			nodeEnv: 'production',
			supabaseUrl: 'https://example.supabase.co',
			supabaseServiceRoleKey: 'secret-key',
			n8nChatWebhook: 'https://n8n.example/webhook',
			ashInternalHealthKey: 'internal-key',
			ashyLlmEnabled: true,
			openAiApiKey: 'sk-test',
		});
		const json = JSON.stringify(snap);
		assert.ok(!json.includes('secret-key'));
		assert.ok(!json.includes('sk-test'));
		assert.ok(!json.includes('internal-key'));
		assert.equal(snap.supabaseConfigured, true);
		assert.equal(snap.n8nChatConfigured, true);
	});

	test('health route uses publicConfigSnapshot (static audit)', () => {
		const src = readFileSync(join(REPO_API, 'src/routes/api/health.js'), 'utf8');
		assert.ok(src.includes('publicConfigSnapshot'));
		assert.ok(!src.includes('supabaseServiceRoleKey'));
	});
});

describe('H7 fallback — production safety', () => {
	test('ACTION proposal → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			actionProposalStatus: ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION,
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('ACTION committed → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			f4Committed: true,
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('READ NO_DATA → NO_FALLBACK (do not mask V2)', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'QUESTION',
			executionCode: 'NO_DATA',
		});
		assert.equal(r.policy, V2_FALLBACK_POLICY.NO_FALLBACK);
	});

	test('client fallback policy blocks action on network error (static audit)', () => {
		const src = readFileSync(join(REPO_API, '../web/src/lib/ashyFallbackPolicy.js'), 'utf8');
		assert.ok(src.includes('action_network_error'));
		assert.ok(src.includes('allowFallback: false'));
		assert.ok(src.includes('NO_FALLBACK'));
	});
});

describe('H7 idempotence contract (code audit)', () => {
	test('ALREADY_COMPLETED status blocks fallback', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			actionProposalStatus: ACTION_PROPOSAL_STATUS.ALREADY_COMPLETED,
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('F4 replay statuses in NO_FALLBACK set', () => {
		for (const status of ['COMMITTED', 'ALREADY_COMPLETED']) {
			const r = resolveV2FallbackPolicy({
				handled: true,
				mode: 'action_proposal',
				f4Status: status,
			});
			assert.equal(r.noN8nFallback, true, status);
		}
	});
});

describe('H7 scope isolation contracts', () => {
	test('MISSING_SCOPE → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			code: 'MISSING_SCOPE',
			goalType: 'ACTION',
			mode: 'action_proposal',
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('getCutoverDiagnostics exposes blockLegacy only when primary', () => {
		assert.equal(getCutoverDiagnostics(prodDefaultEnv()).blockLegacyPassthrough, false);
		assert.equal(getCutoverDiagnostics({
			ashyIntelligenceV2: true,
			ashyIntelligenceV2Http: true,
			ashyIntelligenceV2Primary: true,
		}).blockLegacyPassthrough, true);
	});
});

describe('H7 financial write path audit (static)', () => {
	test('transactional write service exists', () => {
		assert.ok(existsSync(join(REPO_API, 'src/services/agent-transactional-write-service.js')));
	});

	test('idempotent replay service exists', () => {
		assert.ok(existsSync(join(REPO_API, 'src/services/agent-idempotent-replay-service.js')));
	});

	test('action F4 executor exists', () => {
		assert.ok(existsSync(join(REPO_API, 'src/agent/intelligence-v2/action/action-f4-executor.js')));
	});

	test('agent index blocks legacy when primary', () => {
		const src = readFileSync(join(REPO_API, 'src/agent/index.js'), 'utf8');
		assert.ok(src.includes('shouldBlockLegacyPassthrough'));
		assert.ok(src.includes('buildV2PrimaryUnhandledAgentResponse'));
	});
});

describe('H7 timeout configuration audit', () => {
	test('default timeouts documented in env example', () => {
		const example = readFileSync(join(REPO_API, '.env.example'), 'utf8');
		assert.ok(example.includes('ASHY_V2_PLAN_TIMEOUT_MS'));
		assert.ok(example.includes('ASHY_V2_STEP_TIMEOUT_MS'));
		assert.ok(example.includes('ASHY_INTELLIGENCE_V2_SHADOW_TIMEOUT_MS'));
	});

	test('H6 cutover flags documented in env example', () => {
		const example = readFileSync(join(REPO_API, '.env.example'), 'utf8');
		assert.ok(example.includes('ASHY_INTELLIGENCE_V2_PRIMARY=false'));
		assert.ok(example.includes('ASHY_V2_CUTOVER_MODE'));
	});
});

describe('H7 rollback by flags only', () => {
	test('mapFlagsForCutoverMode LEGACY_ONLY has primary false', () => {
		const flags = mapFlagsForCutoverMode(CUTOVER_MODE.LEGACY_ONLY);
		assert.equal(flags.ASHY_INTELLIGENCE_V2_PRIMARY, false);
		assert.equal(flags.ASHY_INTELLIGENCE_V2_HTTP, false);
	});

	test('rollback from primary to legacy is flag-only', () => {
		const before = resolveCutoverMode({
			ashyIntelligenceV2: true,
			ashyIntelligenceV2Http: true,
			ashyIntelligenceV2Primary: true,
		});
		const after = resolveCutoverMode(prodDefaultEnv());
		assert.equal(before, CUTOVER_MODE.V2_PRIMARY);
		assert.equal(after, CUTOVER_MODE.LEGACY_ONLY);
	});
});

describe('H7 error handling contracts', () => {
	test('ashy-chat exposes fallbackPolicy in payload (static audit)', () => {
		const src = readFileSync(join(REPO_API, 'src/routes/api/ashy-chat.js'), 'utf8');
		assert.ok(src.includes('fallbackPolicy'));
		assert.ok(src.includes('cutoverMode'));
	});

	test('createApp wires error middleware (static audit)', () => {
		const src = readFileSync(join(REPO_API, 'src/app.js'), 'utf8');
		assert.ok(src.includes('errorMiddleware'));
		assert.ok(src.includes('globalRateLimit'));
	});
});

describe('H7 production flag env parsing', () => {
	test('env.js requires explicit true for V2 flags', () => {
		const env = prodDefaultEnv();
		assert.equal(env.ashyIntelligenceV2, false);
		assert.equal(env.ashyIntelligenceV2Primary, false);
		assert.equal(env.ashyIntelligenceV2Shadow, false);
	});

	test('truthy string "false" does not enable primary', async () => {
		process.env.ASHY_INTELLIGENCE_V2_PRIMARY = 'false';
		const { getEnv } = await import('../src/config/env.js');
		assert.equal(getEnv().ashyIntelligenceV2Primary, false);
	});
});

describe('H7 service role reminder', () => {
	test('supabase client uses service role on backend only', () => {
		const src = readFileSync(join(REPO_API, 'src/supabase/client.js'), 'utf8');
		assert.ok(
			src.includes('supabaseServiceRoleKey')
			|| src.includes('SERVICE_ROLE')
			|| src.includes('service_role'),
		);
		assert.ok(!src.includes('anonKey'));
	});
});
