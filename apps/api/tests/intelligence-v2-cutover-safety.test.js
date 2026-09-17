/**
 * H8.0 — Cutover architecture & safety gate (unit).
 * Audits modes, fallback boundaries, idempotence signals, rollback flags.
 * Does NOT activate V2 in production.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ACTION_PROPOSAL_STATUS } from '../src/agent/intelligence-v2/action/action-proposal-contract.js';
import {
	buildV2PrimaryUnhandledAgentResponse,
	CUTOVER_MODE,
	getCutoverDiagnostics,
	isLegacyPrimaryMode,
	isV2PrimaryMode,
	mapFlagsForCutoverMode,
	resolveCutoverMode,
	resolvePrimaryPath,
	shouldBlockLegacyPassthrough,
	shouldRunShadowObservation,
	validateCutoverConfigSafety,
} from '../src/agent/intelligence-v2/v2-cutover-policy.js';
import {
	attachFallbackPolicyToV2Http,
	resolveV2FallbackPolicy,
	V2_FALLBACK_POLICY,
} from '../src/agent/intelligence-v2/v2-fallback-policy.js';
import { handleV2HttpTurn } from '../src/agent/intelligence-v2/v2-http-handler.js';

function env(overrides = {}) {
	return {
		ashyIntelligenceV2: false,
		ashyIntelligenceV2Http: false,
		ashyIntelligenceV2HttpConfirm: false,
		ashyIntelligenceV2Shadow: false,
		ashyIntelligenceV2Actions: false,
		ashyIntelligenceV2Llm: false,
		ashyIntelligenceV2Primary: false,
		ashyV2CutoverMode: '',
		ashyV2PrimarySafeFallback: false,
		openAiApiKey: '',
		...overrides,
	};
}

describe('H8 — cutover mode resolution', () => {
	test('default env resolves LEGACY_ONLY', () => {
		assert.equal(resolveCutoverMode(env()), CUTOVER_MODE.LEGACY_ONLY);
	});

	test('explicit ASHY_V2_CUTOVER_MODE wins over flags', () => {
		const mode = resolveCutoverMode(env({
			ashyV2CutoverMode: 'V2_SHADOW',
			ashyIntelligenceV2: true,
			ashyIntelligenceV2Http: true,
			ashyIntelligenceV2Primary: true,
		}));
		assert.equal(mode, CUTOVER_MODE.V2_SHADOW);
	});

	test('V2_SHADOW from shadow flag bundle', () => {
		const mode = resolveCutoverMode(env({
			ashyIntelligenceV2: true,
			ashyIntelligenceV2Shadow: true,
		}));
		assert.equal(mode, CUTOVER_MODE.V2_SHADOW);
	});

	test('V2_PRIMARY from primary flag bundle', () => {
		const mode = resolveCutoverMode(env({
			ashyIntelligenceV2: true,
			ashyIntelligenceV2Http: true,
			ashyIntelligenceV2Primary: true,
		}));
		assert.equal(mode, CUTOVER_MODE.V2_PRIMARY);
	});

	test('V2_PRIMARY_SAFE_FALLBACK from safe fallback flag', () => {
		const mode = resolveCutoverMode(env({
			ashyIntelligenceV2: true,
			ashyIntelligenceV2Http: true,
			ashyIntelligenceV2Primary: true,
			ashyV2PrimarySafeFallback: true,
		}));
		assert.equal(mode, CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK);
	});

	test('V2 off forces LEGACY_ONLY even with primary flag', () => {
		assert.equal(
			resolveCutoverMode(env({ ashyIntelligenceV2Primary: true })),
			CUTOVER_MODE.LEGACY_ONLY,
		);
	});

	test('mapFlagsForCutoverMode V2_PRIMARY sets HTTP and PRIMARY', () => {
		const flags = mapFlagsForCutoverMode(CUTOVER_MODE.V2_PRIMARY);
		assert.equal(flags.ASHY_INTELLIGENCE_V2, true);
		assert.equal(flags.ASHY_INTELLIGENCE_V2_HTTP, true);
		assert.equal(flags.ASHY_INTELLIGENCE_V2_PRIMARY, true);
		assert.equal(flags.ASHY_V2_PRIMARY_SAFE_FALLBACK, false);
	});

	test('mapFlagsForCutoverMode LEGACY_ONLY disables all V2 flags', () => {
		const flags = mapFlagsForCutoverMode(CUTOVER_MODE.LEGACY_ONLY);
		assert.equal(flags.ASHY_INTELLIGENCE_V2, false);
		assert.equal(flags.ASHY_INTELLIGENCE_V2_HTTP, false);
		assert.equal(flags.ASHY_INTELLIGENCE_V2_PRIMARY, false);
	});
});

describe('H8 — primary path & legacy blocking', () => {
	test('shouldBlockLegacyPassthrough true for V2_PRIMARY modes', () => {
		assert.equal(shouldBlockLegacyPassthrough(CUTOVER_MODE.V2_PRIMARY), true);
		assert.equal(shouldBlockLegacyPassthrough(CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK), true);
	});

	test('shouldBlockLegacyPassthrough false for LEGACY_ONLY and V2_SHADOW', () => {
		assert.equal(shouldBlockLegacyPassthrough(CUTOVER_MODE.LEGACY_ONLY), false);
		assert.equal(shouldBlockLegacyPassthrough(CUTOVER_MODE.V2_SHADOW), false);
	});

	test('shouldRunShadowObservation only in V2_SHADOW without HTTP handled', () => {
		assert.equal(shouldRunShadowObservation(CUTOVER_MODE.V2_SHADOW), true);
		assert.equal(shouldRunShadowObservation(CUTOVER_MODE.V2_SHADOW, { v2HttpHandled: true }), false);
		assert.equal(shouldRunShadowObservation(CUTOVER_MODE.V2_PRIMARY), false);
		assert.equal(shouldRunShadowObservation(CUTOVER_MODE.LEGACY_ONLY), false);
	});

	test('resolvePrimaryPath maps modes correctly', () => {
		assert.equal(resolvePrimaryPath(CUTOVER_MODE.LEGACY_ONLY), 'LEGACY');
		assert.equal(resolvePrimaryPath(CUTOVER_MODE.V2_SHADOW), 'LEGACY_WITH_SHADOW');
		assert.equal(resolvePrimaryPath(CUTOVER_MODE.V2_PRIMARY, { v2HttpHandled: true }), 'V2_HTTP');
		assert.equal(resolvePrimaryPath(CUTOVER_MODE.V2_PRIMARY), 'V2_PRIMARY_UNHANDLED');
	});

	test('isV2PrimaryMode and isLegacyPrimaryMode are mutually exclusive for primary modes', () => {
		assert.equal(isV2PrimaryMode(CUTOVER_MODE.V2_PRIMARY), true);
		assert.equal(isLegacyPrimaryMode(CUTOVER_MODE.V2_PRIMARY), false);
		assert.equal(isLegacyPrimaryMode(CUTOVER_MODE.V2_SHADOW), true);
	});
});

describe('H8 — cutover config safety validation', () => {
	test('production default is safe with all flags off', () => {
		const result = validateCutoverConfigSafety(env());
		assert.equal(result.safe, true);
		assert.equal(result.productionDefaultLegacy, true);
		assert.equal(result.issues.length, 0);
	});

	test('PRIMARY without V2 enabled is unsafe', () => {
		const result = validateCutoverConfigSafety(env({ ashyIntelligenceV2Primary: true }));
		assert.equal(result.safe, false);
		assert.ok(result.issues.some((i) => /ASHY_INTELLIGENCE_V2_PRIMARY requires ASHY_INTELLIGENCE_V2/.test(i)));
	});

	test('SAFE_FALLBACK without PRIMARY is unsafe', () => {
		const result = validateCutoverConfigSafety(env({ ashyV2PrimarySafeFallback: true }));
		assert.equal(result.safe, false);
		assert.ok(result.issues.some((i) => /ASHY_V2_PRIMARY_SAFE_FALLBACK requires/.test(i)));
	});

	test('valid V2_PRIMARY_SAFE_FALLBACK bundle passes validation', () => {
		const result = validateCutoverConfigSafety(env({
			ashyIntelligenceV2: true,
			ashyIntelligenceV2Http: true,
			ashyIntelligenceV2Primary: true,
			ashyV2PrimarySafeFallback: true,
		}));
		assert.equal(result.safe, true);
		assert.equal(result.mode, CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK);
	});
});

describe('H8 — fallback policy routing matrix', () => {
	test('READ success → SAFE_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'QUESTION',
			responseStatus: 'OK',
		});
		assert.equal(r.policy, V2_FALLBACK_POLICY.SAFE_FALLBACK);
		assert.equal(r.noN8nFallback, false);
		assert.equal(r.reason, 'read_v2');
	});

	test('READ NO_DATA → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'QUESTION',
			executionCode: 'NO_DATA',
		});
		assert.equal(r.policy, V2_FALLBACK_POLICY.NO_FALLBACK);
		assert.equal(r.noN8nFallback, true);
	});

	test('READ TIMEOUT in V2_PRIMARY → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'QUESTION',
			executionCode: 'TIMEOUT',
		}, { cutoverMode: CUTOVER_MODE.V2_PRIMARY });
		assert.equal(r.policy, V2_FALLBACK_POLICY.NO_FALLBACK);
	});

	test('READ TIMEOUT in V2_PRIMARY_SAFE_FALLBACK → SAFE_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'QUESTION',
			executionCode: 'TIMEOUT',
		}, { cutoverMode: CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK });
		assert.equal(r.policy, V2_FALLBACK_POLICY.SAFE_FALLBACK);
		assert.equal(r.noN8nFallback, false);
	});

	test('READ PLAN_BUILD_FAILED in SAFE_FALLBACK mode allows fallback', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'ANALYSIS',
			executionCode: 'PLAN_BUILD_FAILED',
		}, { cutoverMode: CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK });
		assert.equal(r.policy, V2_FALLBACK_POLICY.SAFE_FALLBACK);
	});

	test('ACTION proposal → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'ACTION',
			mode: 'action_proposal',
			actionProposalStatus: ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION,
			hasPending: true,
		});
		assert.equal(r.policy, V2_FALLBACK_POLICY.NO_FALLBACK);
		assert.equal(r.noN8nFallback, true);
	});

	test('ACTION clarification → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'ACTION',
			mode: 'action_proposal',
			actionProposalStatus: ACTION_PROPOSAL_STATUS.NEEDS_CLARIFICATION,
		});
		assert.equal(r.policy, V2_FALLBACK_POLICY.NO_FALLBACK);
	});

	test('ACTION committed f4Committed → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'ACTION',
			mode: 'action_proposal',
			f4Committed: true,
		});
		assert.equal(r.policy, V2_FALLBACK_POLICY.NO_FALLBACK);
		assert.equal(r.reason, 'action_committed');
	});

	test('ACTION f4Status COMMITTED → NO_FALLBACK (post-commit)', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'ACTION',
			mode: 'action_proposal',
			f4Status: 'COMMITTED',
		});
		assert.equal(r.policy, V2_FALLBACK_POLICY.NO_FALLBACK);
		assert.equal(r.reason, 'f4_committed');
	});

	test('ACTION f4Status ALREADY_COMPLETED → NO_FALLBACK (idempotent replay)', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'ACTION',
			f4Status: 'ALREADY_COMPLETED',
		});
		assert.equal(r.policy, V2_FALLBACK_POLICY.NO_FALLBACK);
	});

	test('ACTION execution error status → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'ACTION',
			actionProposalStatus: 'TRANSACTIONAL_FAILED',
		});
		assert.equal(r.policy, V2_FALLBACK_POLICY.NO_FALLBACK);
	});

	test('ACTION ambiguous unhandled in primary → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: false,
			primaryPath: 'V2_PRIMARY_UNHANDLED',
			goalType: 'ACTION',
			mode: 'action_proposal',
		}, { cutoverMode: CUTOVER_MODE.V2_PRIMARY });
		assert.equal(r.policy, V2_FALLBACK_POLICY.NO_FALLBACK);
		assert.equal(r.reason, 'primary_unhandled_action');
	});

	test('primary unhandled READ in SAFE_FALLBACK mode → SAFE_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: false,
			primaryPath: 'V2_PRIMARY_UNHANDLED',
			goalType: 'QUESTION',
		}, { cutoverMode: CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK });
		assert.equal(r.policy, V2_FALLBACK_POLICY.SAFE_FALLBACK);
		assert.equal(r.reason, 'primary_unhandled_read_safe');
	});

	test('MISSING_SCOPE → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			code: 'MISSING_SCOPE',
		});
		assert.equal(r.policy, V2_FALLBACK_POLICY.NO_FALLBACK);
	});

	test('not_v2 handled=false → SAFE_FALLBACK (legacy path)', () => {
		const r = resolveV2FallbackPolicy({ handled: false });
		assert.equal(r.policy, V2_FALLBACK_POLICY.SAFE_FALLBACK);
		assert.equal(r.reason, 'not_v2');
	});

	test('attachFallbackPolicyToV2Http enriches diagnostics', () => {
		const enriched = attachFallbackPolicyToV2Http({
			handled: true,
			goalType: 'ACTION',
			f4Committed: true,
		});
		assert.equal(enriched.fallbackPolicy, V2_FALLBACK_POLICY.NO_FALLBACK);
		assert.equal(enriched.noN8nFallback, true);
	});
});

describe('H8 — V2 primary unhandled response', () => {
	test('unhandled READ sets SAFE_FALLBACK only in safe mode', () => {
		const resp = buildV2PrimaryUnhandledAgentResponse({
			cutoverMode: CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK,
			message: 'Quel est mon stock de poulets ?',
			previousState: {},
		});
		assert.equal(resp.v2Http.fallbackPolicy, V2_FALLBACK_POLICY.SAFE_FALLBACK);
		assert.equal(resp.noN8nFallback, false);
		assert.equal(resp.primaryPath, 'V2_PRIMARY_UNHANDLED');
	});

	test('unhandled ACTION blocks n8n fallback', () => {
		const resp = buildV2PrimaryUnhandledAgentResponse({
			cutoverMode: CUTOVER_MODE.V2_PRIMARY,
			message: 'Ajoute une dépense de 30 dollars',
			previousState: {},
		});
		assert.equal(resp.v2Http.fallbackPolicy, V2_FALLBACK_POLICY.NO_FALLBACK);
		assert.equal(resp.noN8nFallback, true);
	});

	test('pending write infers ACTION goal type', () => {
		const resp = buildV2PrimaryUnhandledAgentResponse({
			cutoverMode: CUTOVER_MODE.V2_PRIMARY,
			message: 'ok',
			previousState: { pendingWrite: { tool: 'create_expense', label: 'x', amount: 1 } },
		});
		assert.equal(resp.v2Http.goalType, 'ACTION');
	});

	test('unhandled message with vendu keyword infers ACTION (no read fallback)', () => {
		const resp = buildV2PrimaryUnhandledAgentResponse({
			cutoverMode: CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK,
			message: 'Combien ai-je vendu ?',
			previousState: {},
		});
		assert.equal(resp.v2Http.goalType, 'ACTION');
		assert.equal(resp.v2Http.fallbackPolicy, V2_FALLBACK_POLICY.NO_FALLBACK);
	});
});

describe('H8 — HTTP handler gate (no activation)', () => {
	test('handleV2HttpTurn returns handled=false when HTTP disabled', async () => {
		const result = await handleV2HttpTurn({
			message: 'Combien ai-je vendu ?',
			user: { id: 'u1', clientId: 'c1', activeActivityId: 'a1' },
			sessionId: 's1',
			previousState: {},
			options: { env: env() },
		});
		assert.equal(result.handled, false);
	});
});

describe('H8 — rollback flag mapping', () => {
	test('LEGACY_ONLY flags disable V2 primary path', () => {
		const flags = mapFlagsForCutoverMode(CUTOVER_MODE.LEGACY_ONLY);
		assert.equal(flags.ASHY_INTELLIGENCE_V2_PRIMARY, false);
		assert.equal(flags.ASHY_INTELLIGENCE_V2_HTTP, false);
	});

	test('rollback V2_PRIMARY → LEGACY_ONLY clears blockLegacyPassthrough', () => {
		assert.equal(shouldBlockLegacyPassthrough(CUTOVER_MODE.V2_PRIMARY), true);
		assert.equal(shouldBlockLegacyPassthrough(CUTOVER_MODE.LEGACY_ONLY), false);
	});

	test('getCutoverDiagnostics reflects env without mutation', () => {
		const diag = getCutoverDiagnostics(env({
			ashyIntelligenceV2: true,
			ashyIntelligenceV2Http: true,
			ashyIntelligenceV2Primary: true,
		}));
		assert.equal(diag.cutoverMode, CUTOVER_MODE.V2_PRIMARY);
		assert.equal(diag.blockLegacyPassthrough, true);
		assert.equal(diag.v2Http, true);
	});
});

describe('H8 — double-write protection signals', () => {
	test('REQUEST_HASH_MISMATCH action status blocks fallback', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'ACTION',
			actionProposalStatus: 'REQUEST_HASH_MISMATCH',
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('VERSION_MISMATCH action status blocks fallback', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'ACTION',
			actionProposalStatus: 'VERSION_MISMATCH',
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('ALREADY_CONSUMED blocks fallback', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'ACTION',
			actionProposalStatus: 'ALREADY_CONSUMED',
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('pending action with hasPending blocks fallback', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'ACTION',
			hasPending: true,
		});
		assert.equal(r.reason, 'action_pending');
		assert.equal(r.noN8nFallback, true);
	});
});
