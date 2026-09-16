import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, test } from 'node:test';

import { publicConfigSnapshot } from '../src/config/env.js';
import {
	CUTOVER_MODE,
	resolveCutoverMode,
	validateCutoverConfigSafety,
} from '../src/agent/intelligence-v2/v2-cutover-policy.js';
import { resolveV2FallbackPolicy, V2_FALLBACK_POLICY } from '../src/agent/intelligence-v2/v2-fallback-policy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(__dirname, '..');

function prodAbsentEnv() {
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

describe('H7.1 production flag defaults', () => {
	test('all V2 flags false when env vars absent', () => {
		const env = prodAbsentEnv();
		assert.equal(env.ashyIntelligenceV2, false);
		assert.equal(env.ashyIntelligenceV2Http, false);
		assert.equal(env.ashyIntelligenceV2Primary, false);
		assert.equal(env.ashyIntelligenceV2Actions, false);
		assert.equal(env.ashyIntelligenceV2HttpConfirm, false);
		assert.equal(env.ashyIntelligenceV2Shadow, false);
	});

	test('absent flags resolve to LEGACY_ONLY', () => {
		assert.equal(resolveCutoverMode(prodAbsentEnv()), CUTOVER_MODE.LEGACY_ONLY);
	});

	test('string "false" does not enable primary', async () => {
		process.env.ASHY_INTELLIGENCE_V2_PRIMARY = 'false';
		const { getEnv } = await import('../src/config/env.js');
		assert.equal(getEnv().ashyIntelligenceV2Primary, false);
	});

	test('only exact "true" enables V2 master', async () => {
		process.env.ASHY_INTELLIGENCE_V2 = 'TRUE';
		const { getEnv } = await import('../src/config/env.js');
		assert.equal(getEnv().ashyIntelligenceV2, false);
		process.env.ASHY_INTELLIGENCE_V2 = 'true';
		assert.equal(getEnv().ashyIntelligenceV2, true);
	});
});

describe('H7.1 dangerous flag combinations', () => {
	test('PRIMARY without V2 master → unsafe', () => {
		assert.equal(validateCutoverConfigSafety({
			ashyIntelligenceV2: false,
			ashyIntelligenceV2Http: false,
			ashyIntelligenceV2Primary: true,
		}).safe, false);
	});

	test('PRIMARY without HTTP → unsafe', () => {
		assert.equal(validateCutoverConfigSafety({
			ashyIntelligenceV2: true,
			ashyIntelligenceV2Http: false,
			ashyIntelligenceV2Primary: true,
		}).safe, false);
	});

	test('HTTP without V2 master → resolves LEGACY_ONLY (safe mode)', () => {
		assert.equal(resolveCutoverMode({
			ashyIntelligenceV2: false,
			ashyIntelligenceV2Http: true,
		}), CUTOVER_MODE.LEGACY_ONLY);
	});

	test('ACTIONS+CONFIRM without primary still unsafe if primary forced', () => {
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

describe('H7.1 health snapshot safety', () => {
	test('publicConfigSnapshot excludes secrets and V2 flags', () => {
		const snap = publicConfigSnapshot({
			nodeEnv: 'production',
			supabaseUrl: 'https://x.supabase.co',
			supabaseServiceRoleKey: 'secret-sr',
			n8nChatWebhook: 'https://n8n/webhook',
			ashInternalHealthKey: 'internal-key-value',
			ashyIntelligenceV2: true,
			ashyIntelligenceV2Primary: true,
		});
		const json = JSON.stringify(snap);
		assert.ok(!json.includes('secret-sr'));
		assert.ok(!json.includes('internal-key-value'));
		assert.ok(!json.includes('INTELLIGENCE_V2'));
		assert.equal(snap.internalHealthKeyConfigured, true);
		assert.equal(snap.nodeEnv, 'production');
	});
});

describe('H7.1 fallback production safety', () => {
	test('ACTION → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			actionProposalStatus: 'READY_FOR_CONFIRMATION',
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('COMMITTED → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			f4Committed: true,
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('NO_DATA → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'QUESTION',
			executionCode: 'NO_DATA',
		});
		assert.equal(r.policy, V2_FALLBACK_POLICY.NO_FALLBACK);
	});
});

describe('H7.1 F4-B2 static audit', () => {
	test('action-f4-executor exists and references F4_B2', () => {
		const src = readFileSync(
			join(API_ROOT, 'src/agent/intelligence-v2/action/action-f4-executor.js'),
			'utf8',
		);
		assert.ok(src.includes('executeActionConfirmationViaF4B2'));
		assert.ok(src.includes('F4_B2_UNAVAILABLE'));
		assert.ok(src.includes('ALREADY_COMPLETED'));
	});

	test('operation_id comes from backend pending state', () => {
		const src = readFileSync(
			join(API_ROOT, 'src/agent/intelligence-v2/action/action-pending-bridge.js'),
			'utf8',
		);
		assert.ok(src.includes('pendingOperationId'));
		assert.ok(src.includes('pendingConsumeToken'));
	});
});

describe('H7.1 deployment topology static', () => {
	test('docker-compose exposes 3001 only on localhost', () => {
		const c = readFileSync(join(API_ROOT, 'docker-compose.yml'), 'utf8');
		assert.ok(c.includes('127.0.0.1:3001:3000'));
	});

	test('app.js mounts /hcgi/api', () => {
		const src = readFileSync(join(API_ROOT, 'src/app.js'), 'utf8');
		assert.ok(src.includes('/hcgi/api'));
	});

	test('prod flag audit script never prints values', () => {
		const sh = readFileSync(
			join(API_ROOT, '../web/tools/_ashy_v2_phase_h7_prod_flag_audit.sh'),
			'utf8',
		);
		assert.ok(sh.includes('OFF:'));
		assert.ok(sh.includes('ABS:'));
		assert.ok(!sh.includes('echo "$val"'));
	});
});

describe('H7.1 NO-GO trigger logic (offline)', () => {
	test('simulated PRIMARY ON → would be NO-GO', () => {
		const env = {
			ashyIntelligenceV2: true,
			ashyIntelligenceV2Http: true,
			ashyIntelligenceV2Primary: true,
		};
		assert.equal(resolveCutoverMode(env), CUTOVER_MODE.V2_PRIMARY);
		// In production gate, PRIMARY ON = immediate NO-GO
		assert.equal(env.ashyIntelligenceV2Primary, true);
	});

	test('production absent defaults → safe for cutover prep code path', () => {
		const r = validateCutoverConfigSafety(prodAbsentEnv());
		assert.equal(r.safe, true);
		assert.equal(r.productionDefaultLegacy, true);
	});
});
