import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { createAshyAgent } from '../src/agent/index.js';
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
	resolveV2FallbackPolicy,
	V2_FALLBACK_POLICY,
} from '../src/agent/intelligence-v2/v2-fallback-policy.js';
import { handleV2HttpTurn } from '../src/agent/intelligence-v2/v2-http-handler.js';
import {
	resetAgentSessionReaderForTests,
	setGetAgentSessionStateImplForTests,
} from '../src/services/agent-session-reader.js';
import {
	resetAgentSessionWriterForTests,
} from '../src/services/agent-session-writer.js';
import {
	resetAgentTransactionalWriteForTests,
} from '../src/services/agent-transactional-write-service.js';

const PRIMARY_ENV = {
	ashyIntelligenceV2: true,
	ashyIntelligenceV2Http: true,
	ashyIntelligenceV2Actions: true,
	ashyIntelligenceV2HttpConfirm: true,
	ashyIntelligenceV2Shadow: false,
	ashyIntelligenceV2Primary: true,
	ashyV2PrimarySafeFallback: false,
};

const SHADOW_ENV = {
	ashyIntelligenceV2: true,
	ashyIntelligenceV2Http: false,
	ashyIntelligenceV2Shadow: true,
	ashyIntelligenceV2Primary: false,
};

function user() {
	return {
		id: 'pb-h6',
		clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		activeActivityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
		businessUserId: 'rec-h6',
	};
}

function emptyState(overrides = {}) {
	return {
		topic: null,
		intent: null,
		filters: {},
		references: {},
		lastTool: null,
		lastAction: null,
		updatedAt: null,
		pendingWrite: null,
		pendingSessionVersion: null,
		pendingConsumeToken: null,
		pendingOperationId: null,
		...overrides,
	};
}

function envWithPrimary(overrides = {}) {
	return { ...PRIMARY_ENV, ...overrides };
}

afterEach(() => {
	resetAgentSessionReaderForTests();
	resetAgentSessionWriterForTests();
	resetAgentTransactionalWriteForTests();
	delete process.env.ASHY_INTELLIGENCE_V2;
	delete process.env.ASHY_INTELLIGENCE_V2_HTTP;
	delete process.env.ASHY_INTELLIGENCE_V2_PRIMARY;
	delete process.env.ASHY_V2_CUTOVER_MODE;
	delete process.env.ASHY_V2_PRIMARY_SAFE_FALLBACK;
});

describe('H6 cutover modes — resolution', () => {
	test('default env → LEGACY_ONLY', () => {
		assert.equal(resolveCutoverMode({}), CUTOVER_MODE.LEGACY_ONLY);
	});

	test('V2 off + primary flag → still LEGACY_ONLY', () => {
		assert.equal(resolveCutoverMode({
			ashyIntelligenceV2: false,
			ashyIntelligenceV2Primary: true,
		}), CUTOVER_MODE.LEGACY_ONLY);
	});

	test('V2 shadow without HTTP → V2_SHADOW', () => {
		assert.equal(resolveCutoverMode(SHADOW_ENV), CUTOVER_MODE.V2_SHADOW);
	});

	test('V2 primary requires HTTP → V2_PRIMARY', () => {
		assert.equal(resolveCutoverMode(PRIMARY_ENV), CUTOVER_MODE.V2_PRIMARY);
	});

	test('safe fallback flag → V2_PRIMARY_SAFE_FALLBACK', () => {
		assert.equal(resolveCutoverMode({
			...PRIMARY_ENV,
			ashyV2PrimarySafeFallback: true,
		}), CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK);
	});

	test('explicit ASHY_V2_CUTOVER_MODE overrides flags', () => {
		assert.equal(resolveCutoverMode({
			ashyV2CutoverMode: 'v2_shadow',
			ashyIntelligenceV2Primary: true,
		}), CUTOVER_MODE.V2_SHADOW);
	});

	test('mapFlagsForCutoverMode V2_PRIMARY bundles HTTP + primary', () => {
		const flags = mapFlagsForCutoverMode(CUTOVER_MODE.V2_PRIMARY);
		assert.equal(flags.ASHY_INTELLIGENCE_V2_PRIMARY, true);
		assert.equal(flags.ASHY_INTELLIGENCE_V2_HTTP, true);
		assert.equal(flags.ASHY_INTELLIGENCE_V2_SHADOW, false);
	});
});

describe('H6 primary routing helpers', () => {
	test('isV2PrimaryMode true for both primary modes', () => {
		assert.equal(isV2PrimaryMode(CUTOVER_MODE.V2_PRIMARY), true);
		assert.equal(isV2PrimaryMode(CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK), true);
		assert.equal(isV2PrimaryMode(CUTOVER_MODE.LEGACY_ONLY), false);
	});

	test('isLegacyPrimaryMode for legacy + shadow', () => {
		assert.equal(isLegacyPrimaryMode(CUTOVER_MODE.LEGACY_ONLY), true);
		assert.equal(isLegacyPrimaryMode(CUTOVER_MODE.V2_SHADOW), true);
		assert.equal(isLegacyPrimaryMode(CUTOVER_MODE.V2_PRIMARY), false);
	});

	test('shouldBlockLegacyPassthrough only on primary modes', () => {
		assert.equal(shouldBlockLegacyPassthrough(CUTOVER_MODE.V2_PRIMARY), true);
		assert.equal(shouldBlockLegacyPassthrough(CUTOVER_MODE.LEGACY_ONLY), false);
	});

	test('resolvePrimaryPath V2 handled → V2_HTTP', () => {
		assert.equal(resolvePrimaryPath(CUTOVER_MODE.V2_PRIMARY, { v2HttpHandled: true }), 'V2_HTTP');
	});

	test('resolvePrimaryPath primary unhandled', () => {
		assert.equal(resolvePrimaryPath(CUTOVER_MODE.V2_PRIMARY), 'V2_PRIMARY_UNHANDLED');
	});

	test('shadow only in V2_SHADOW on legacy path', () => {
		assert.equal(shouldRunShadowObservation(CUTOVER_MODE.V2_SHADOW), true);
		assert.equal(shouldRunShadowObservation(CUTOVER_MODE.V2_SHADOW, { v2HttpHandled: true }), false);
		assert.equal(shouldRunShadowObservation(CUTOVER_MODE.V2_PRIMARY), false);
		assert.equal(shouldRunShadowObservation(CUTOVER_MODE.LEGACY_ONLY), false);
	});
});

describe('H6 config safety', () => {
	test('primary without V2 flagged unsafe', () => {
		const r = validateCutoverConfigSafety({
			ashyIntelligenceV2: false,
			ashyIntelligenceV2Http: false,
			ashyIntelligenceV2Primary: true,
		});
		assert.equal(r.safe, false);
		assert.ok(r.issues.length > 0);
	});

	test('valid primary config is safe', () => {
		const r = validateCutoverConfigSafety(PRIMARY_ENV);
		assert.equal(r.safe, true);
	});

	test('production default keeps legacy', () => {
		const r = validateCutoverConfigSafety({});
		assert.equal(r.productionDefaultLegacy, true);
	});

	test('getCutoverDiagnostics exposes mode', () => {
		const d = getCutoverDiagnostics(PRIMARY_ENV);
		assert.equal(d.cutoverMode, CUTOVER_MODE.V2_PRIMARY);
		assert.equal(d.blockLegacyPassthrough, true);
	});
});

describe('H6 fallback — NO_DATA and execution errors', () => {
	test('NO_DATA → NO_FALLBACK (do not mask empty V2)', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'QUESTION',
			executionCode: 'NO_DATA',
		});
		assert.equal(r.noN8nFallback, true);
		assert.equal(r.reason, 'read_no_data');
	});

	test('PARTIAL → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'ANALYSIS',
			executionCode: 'PARTIAL',
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('TIMEOUT strict primary → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'QUESTION',
			executionCode: 'TIMEOUT',
		}, { cutoverMode: CUTOVER_MODE.V2_PRIMARY });
		assert.equal(r.noN8nFallback, true);
	});

	test('TIMEOUT safe primary → SAFE_FALLBACK for READ', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'QUESTION',
			executionCode: 'TIMEOUT',
		}, { cutoverMode: CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK });
		assert.equal(r.policy, V2_FALLBACK_POLICY.SAFE_FALLBACK);
		assert.equal(r.noN8nFallback, false);
	});

	test('EXECUTION_ERROR safe mode READ → SAFE_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'MIXED',
			responseStatus: 'EXECUTION_ERROR',
		}, { cutoverMode: CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK });
		assert.equal(r.policy, V2_FALLBACK_POLICY.SAFE_FALLBACK);
	});
});

describe('H6 fallback — primary unhandled', () => {
	test('unhandled READ strict → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: false,
			primaryPath: 'V2_PRIMARY_UNHANDLED',
			goalType: 'QUESTION',
		}, { cutoverMode: CUTOVER_MODE.V2_PRIMARY });
		assert.equal(r.noN8nFallback, true);
	});

	test('unhandled READ safe → SAFE_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: false,
			primaryPath: 'V2_PRIMARY_UNHANDLED',
			goalType: 'QUESTION',
		}, { cutoverMode: CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK });
		assert.equal(r.policy, V2_FALLBACK_POLICY.SAFE_FALLBACK);
	});

	test('unhandled ACTION → NO_FALLBACK always', () => {
		const r = resolveV2FallbackPolicy({
			handled: false,
			primaryPath: 'V2_PRIMARY_UNHANDLED',
			goalType: 'ACTION',
			mode: 'action_proposal',
		}, { cutoverMode: CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK });
		assert.equal(r.noN8nFallback, true);
	});
});

describe('H6 fallback — action safety preserved', () => {
	test('proposal still NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			actionProposalStatus: ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION,
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('committed still NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			f4Committed: true,
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('ambiguous action status NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			actionProposalStatus: 'ACTION_AMBIGUOUS',
		});
		assert.equal(r.noN8nFallback, true);
	});
});

describe('H6 agent routing — primary blocks legacy passthrough', () => {
	test('buildV2PrimaryUnhandledAgentResponse blocks legacy passthrough', () => {
		const result = buildV2PrimaryUnhandledAgentResponse({
			cutoverMode: CUTOVER_MODE.V2_PRIMARY,
			message: 'xyzzy nonsense unclassified phrase h6',
			previousState: emptyState({ topic: 'sales', intent: 'query_sales' }),
			user: user(),
		});

		assert.equal(result.cutoverMode, CUTOVER_MODE.V2_PRIMARY);
		assert.equal(result.primaryPath, 'V2_PRIMARY_UNHANDLED');
		assert.equal(result.intentDiagnostics, null);
		assert.equal(result.noN8nFallback, true);
		assert.equal(result.conversation?.topic, 'sales');
	});

	test('V2 primary agent.run never returns legacy intentDiagnostics on blocked path', async () => {
		process.env.ASHY_INTELLIGENCE_V2 = 'true';
		process.env.ASHY_INTELLIGENCE_V2_HTTP = 'true';
		process.env.ASHY_INTELLIGENCE_V2_PRIMARY = 'true';
		process.env.ASHY_INTELLIGENCE_V2_ACTIONS = 'false';

		setGetAgentSessionStateImplForTests(async () => ({ state: emptyState(), source: 'test' }));
		const result = await createAshyAgent().run({
			message: 'xyzzy h6 blocked legacy passthrough marker',
			user: user(),
			sessionId: 's-h6-block',
		});

		if (result.primaryPath === 'V2_PRIMARY_UNHANDLED') {
			assert.equal(result.intentDiagnostics, null);
			assert.equal(result.noN8nFallback, true);
		} else {
			assert.equal(result.primaryPath, 'V2_HTTP');
			assert.equal(result.cutoverMode, CUTOVER_MODE.V2_PRIMARY);
		}
	});

	test('legacy mode still returns intentDiagnostics', async () => {
		setGetAgentSessionStateImplForTests(async () => ({ state: emptyState(), source: 'test' }));
		const agent = createAshyAgent();
		const result = await agent.run({
			message: 'Bonjour',
			user: user(),
			sessionId: 's-h6-legacy',
		});
		assert.ok(result.intentDiagnostics);
		assert.equal(result.cutoverMode, undefined);
	});
});

describe('H6 agent routing — V2 primary READ', () => {
	test('V2 primary READ returns cutoverMode + V2_HTTP path', async () => {
		process.env.ASHY_INTELLIGENCE_V2 = 'true';
		process.env.ASHY_INTELLIGENCE_V2_HTTP = 'true';
		process.env.ASHY_INTELLIGENCE_V2_PRIMARY = 'true';

		setGetAgentSessionStateImplForTests(async () => ({ state: emptyState(), source: 'test' }));
		const agent = createAshyAgent();
		const result = await agent.run({
			message: 'Combien ai-je vendu ce mois-ci ?',
			user: user(),
			sessionId: 's-h6-read',
		});

		assert.equal(result.cutoverMode, CUTOVER_MODE.V2_PRIMARY);
		assert.equal(result.primaryPath, 'V2_HTTP');
		assert.ok(result.v2Http?.handled);
	});
});

describe('H6 agent routing — action proposal under primary', () => {
	test('expense proposal NO_FALLBACK under primary', async () => {
		process.env.ASHY_INTELLIGENCE_V2 = 'true';
		process.env.ASHY_INTELLIGENCE_V2_HTTP = 'true';
		process.env.ASHY_INTELLIGENCE_V2_ACTIONS = 'true';
		process.env.ASHY_INTELLIGENCE_V2_PRIMARY = 'true';

		setGetAgentSessionStateImplForTests(async () => ({ state: emptyState(), source: 'test' }));
		const result = await handleV2HttpTurn({
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			user: user(),
			sessionId: 's-h6-prop',
			previousState: emptyState(),
			options: { forceHttp: true, env: envWithPrimary() },
		});
		assert.equal(result.agentResponse.noN8nFallback, true);
		assert.equal(result.agentResponse.fallbackPolicy, V2_FALLBACK_POLICY.NO_FALLBACK);
	});
});

describe('H6 error matrix spot checks', () => {
	const readCases = [
		{ label: 'READ success', v2Http: { handled: true, goalType: 'QUESTION' }, expectFallback: false },
		{ label: 'READ no data', v2Http: { handled: true, goalType: 'QUESTION', executionCode: 'NO_DATA' }, expectFallback: true, noN8n: true },
		{ label: 'network not_v2', v2Http: { handled: false }, expectFallback: false },
	];

	for (const c of readCases) {
		test(`matrix ${c.label}`, () => {
			const r = resolveV2FallbackPolicy(c.v2Http);
			if (c.noN8n) {
				assert.equal(r.noN8nFallback, true);
			} else if (c.expectFallback) {
				assert.equal(r.noN8nFallback, false);
			}
		});
	}

	test('ACTION confirmation committed blocks fallback', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			f4Committed: true,
			actionProposalStatus: ACTION_PROPOSAL_STATUS.COMPLETED,
		});
		assert.equal(r.noN8nFallback, true);
	});
});

describe('H6 rollback semantics (flag-only)', () => {
	test('primary → legacy via flag change', () => {
		assert.equal(resolveCutoverMode(PRIMARY_ENV), CUTOVER_MODE.V2_PRIMARY);
		assert.equal(resolveCutoverMode({
			ashyIntelligenceV2: true,
			ashyIntelligenceV2Http: false,
			ashyIntelligenceV2Primary: false,
			ashyIntelligenceV2Shadow: false,
		}), CUTOVER_MODE.LEGACY_ONLY);
	});

	test('rollback disables blockLegacyPassthrough', () => {
		assert.equal(shouldBlockLegacyPassthrough(resolveCutoverMode(PRIMARY_ENV)), true);
		assert.equal(shouldBlockLegacyPassthrough(CUTOVER_MODE.LEGACY_ONLY), false);
	});
});

describe('H6 frontend contract fields', () => {
	test('v2Http carries cutoverMode when set on diagnostics', async () => {
		process.env.ASHY_INTELLIGENCE_V2 = 'true';
		process.env.ASHY_INTELLIGENCE_V2_HTTP = 'true';
		process.env.ASHY_INTELLIGENCE_V2_PRIMARY = 'true';

		setGetAgentSessionStateImplForTests(async () => ({ state: emptyState(), source: 'test' }));
		const result = await createAshyAgent().run({
			message: 'Combien ai-je dépensé ce mois-ci ?',
			user: user(),
			sessionId: 's-h6-contract',
		});
		assert.equal(result.v2Http?.cutoverMode, CUTOVER_MODE.V2_PRIMARY);
		assert.equal(result.v2Http?.primaryPath, 'V2_HTTP');
	});
});

describe('H6 security — scope and forged IDs', () => {
	test('missing scope under V2 HTTP → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			code: 'MISSING_SCOPE',
			goalType: 'ACTION',
			mode: 'action_proposal',
		});
		assert.equal(r.noN8nFallback, true);
	});
});

describe('H6 idempotence policy', () => {
	test('ALREADY_COMPLETED status NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			actionProposalStatus: ACTION_PROPOSAL_STATUS.ALREADY_COMPLETED,
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('OPERATION_ID_MISSING NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			actionProposalStatus: 'OPERATION_ID_MISSING',
		});
		assert.equal(r.noN8nFallback, true);
	});
});

describe('H6 persistence contract', () => {
	test('primary unhandled preserves prior conversation snapshot', () => {
		const state = emptyState({ topic: 'sales', intent: 'query_sales' });
		const result = buildV2PrimaryUnhandledAgentResponse({
			cutoverMode: CUTOVER_MODE.V2_PRIMARY,
			message: 'zzzz unhandled h6 persistence',
			previousState: state,
			user: user(),
		});
		assert.equal(result.conversation?.topic, 'sales');
		assert.equal(result.conversation?.intent, 'query_sales');
	});
});

describe('H6 canary readiness (deterministic flag)', () => {
	test('cutover mode is deterministic from env snapshot', () => {
		const a = resolveCutoverMode(PRIMARY_ENV);
		const b = resolveCutoverMode(PRIMARY_ENV);
		assert.equal(a, b);
		assert.equal(a, CUTOVER_MODE.V2_PRIMARY);
	});
});
