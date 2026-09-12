import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
	getConversationState,
	saveConversationState,
	clearConversationSessionsForTests,
} from '../src/agent/conversation-state.js';
import {
	normalizeConversationState,
	normalizeAgentSessions,
	compareAgentSessionParity,
	observeAgentSessionParity,
	getAgentSessionParityMetricsForTests,
	resetAgentSessionParityForTests,
	setIsParityEnabledForTests,
	setLoadDbSessionsForParityTests,
	DIVERGENCE_TYPES,
	SEVERITY,
	isAgentSessionParityEnabled,
} from '../src/services/agent-session-parity.js';
import {
	getAgentSessionState,
	resetAgentSessionReaderForTests,
} from '../src/services/agent-session-reader.js';
import {
	resetAgentSessionServiceImplForTests,
	setGetSessionsPairImplForTests,
	setMirrorSessionsAtomicImplForTests,
} from '../src/services/agent-session-service.js';
import {
	mirrorAgentSessionState,
	resetAgentSessionWriterForTests,
	setIsSupabaseConfiguredForTests,
} from '../src/services/agent-session-writer.js';

const CLIENT_A = '11111111-1111-4111-8111-111111111111';
const ACTIVITY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const USER_A = { id: 'pb-a', clientId: CLIENT_A, activeActivityId: ACTIVITY_A, businessUserId: 'rec-a' };
const SESSION = 'sess-parity';

function setGetSessionImplForTests(handler) {
	setGetSessionsPairImplForTests(async (scope) => {
		const draft = await handler(scope.clientId, 'draft');
		const pending = await handler(scope.clientId, 'pending');
		return { draft, pending };
	});
}

function emptyRefs() {
	return {
		lastPeriod: null,
		previousPeriod: null,
		lastProduct: null,
		lastEntity: null,
	};
}

function baseState(overrides = {}) {
	return {
		topic: 'ventes',
		intent: 'query_sales',
		filters: {},
		references: emptyRefs(),
		lastTool: 'get_sales',
		lastAction: null,
		updatedAt: '2026-09-05T10:00:00.000Z',
		pendingWrite: null,
		...overrides,
	};
}

function draftRow(payload) {
	return {
		id: 'draft-1',
		clientId: CLIENT_A,
		stateType: 'draft',
		payload,
		intention: null,
		awaiting: null,
		createdAt: '2026-09-05T00:00:00.000Z',
		updatedAt: '2026-09-05T10:00:00.000Z',
	};
}

function pendingRow(pendingWrite, intention = 'create_expense') {
	return {
		id: 'pending-1',
		clientId: CLIENT_A,
		stateType: 'pending',
		payload: { pendingWrite },
		intention,
		awaiting: 'confirm',
		createdAt: '2026-09-05T00:00:00.000Z',
		updatedAt: '2026-09-05T10:00:00.000Z',
	};
}

afterEach(() => {
	resetAgentSessionParityForTests();
	resetAgentSessionReaderForTests();
	resetAgentSessionServiceImplForTests();
	resetAgentSessionWriterForTests();
	clearConversationSessionsForTests();
	process.env.AGENT_SESSION_PARITY_ENABLED = 'true';
});

describe('Phase 5.8-E2 agent-session-parity — normalization', () => {
	test('1. normalize empty state', () => {
		const norm = normalizeConversationState(null);
		assert.equal(norm.topic, null);
		assert.equal(norm.pendingWrite, null);
	});

	test('2. normalize draft', () => {
		const norm = normalizeConversationState(baseState());
		assert.equal(norm.topic, 'ventes');
		assert.equal(norm.intent, 'query_sales');
	});

	test('3. normalize pending', () => {
		const pw = { tool: 'create_expense', label: 'x', amount: 1 };
		const norm = normalizeConversationState(baseState({ pendingWrite: pw }));
		assert.deepEqual(norm.pendingWrite, pw);
	});

	test('4. normalize cleared', () => {
		const norm = normalizeAgentSessions(draftRow(baseState()), null);
		assert.equal(norm.pendingWrite, null);
	});

	test('24. sessionId absent from DB normalization', () => {
		const norm = normalizeAgentSessions(draftRow({ topic: 'stock' }), null);
		assert.equal(norm.sessionId, undefined);
	});
});

describe('Phase 5.8-E2 agent-session-parity — compare', () => {
	test('5. empty = match', () => {
		const result = compareAgentSessionParity({
			ramState: baseState({
				topic: null,
				intent: null,
				lastTool: null,
				filters: {},
				references: emptyRefs(),
			}),
			draftSession: null,
			pendingSession: null,
		});
		assert.equal(result.match, true);
	});

	test('6. draft = match', () => {
		const state = baseState();
		const result = compareAgentSessionParity({
			ramState: state,
			draftSession: draftRow(state),
			pendingSession: null,
		});
		assert.equal(result.match, true);
	});

	test('7. pending = match', () => {
		const pw = { tool: 'create_sale', product: 'a', quantity: 1, unitPrice: 1, amountPaid: 1 };
		const state = baseState({ pendingWrite: pw, intent: 'create_sale' });
		const result = compareAgentSessionParity({
			ramState: state,
			draftSession: draftRow({ ...state, pendingWrite: undefined }),
			pendingSession: pendingRow(pw, 'create_sale'),
		});
		assert.equal(result.match, true);
	});

	test('8. cleared = match', () => {
		const state = baseState({ pendingWrite: null });
		const result = compareAgentSessionParity({
			ramState: state,
			draftSession: draftRow(state),
			pendingSession: null,
		});
		assert.equal(result.match, true);
	});

	test('9. updatedAt-only = benign match on content', () => {
		const state = baseState({ updatedAt: '2026-09-05T10:00:01.000Z' });
		const dbState = baseState({ updatedAt: '2026-09-05T10:00:00.000Z' });
		const result = compareAgentSessionParity({
			ramState: state,
			draftSession: draftRow(dbState),
			pendingSession: null,
		});
		assert.equal(result.match, true);
		assert.equal(result.severity, SEVERITY.BENIGN);
		assert.ok(result.divergenceTypes.includes(DIVERGENCE_TYPES.UPDATED_AT_ONLY));
	});

	test('10. topic mismatch', () => {
		const result = compareAgentSessionParity({
			ramState: baseState({ topic: 'ventes' }),
			draftSession: draftRow(baseState({ topic: 'depenses' })),
		});
		assert.equal(result.match, false);
		assert.ok(result.divergenceTypes.includes(DIVERGENCE_TYPES.TOPIC_MISMATCH));
	});

	test('11. intent mismatch', () => {
		const result = compareAgentSessionParity({
			ramState: baseState({ intent: 'a' }),
			draftSession: draftRow(baseState({ intent: 'b' })),
		});
		assert.ok(result.divergenceTypes.includes(DIVERGENCE_TYPES.INTENT_MISMATCH));
	});

	test('12. filters mismatch', () => {
		const result = compareAgentSessionParity({
			ramState: baseState({ filters: { period: 'current_month' } }),
			draftSession: draftRow(baseState({ filters: { period: 'previous_month' } })),
		});
		assert.ok(result.divergenceTypes.includes(DIVERGENCE_TYPES.FILTERS_MISMATCH));
	});

	test('13. references mismatch', () => {
		const result = compareAgentSessionParity({
			ramState: baseState({ references: { ...emptyRefs(), lastEntity: 'sales' } }),
			draftSession: draftRow(baseState({ references: emptyRefs() })),
		});
		assert.ok(result.divergenceTypes.includes(DIVERGENCE_TYPES.REFERENCES_MISMATCH));
	});

	test('14. lastTool mismatch', () => {
		const result = compareAgentSessionParity({
			ramState: baseState({ lastTool: 'get_sales' }),
			draftSession: draftRow(baseState({ lastTool: 'get_expenses' })),
		});
		assert.ok(result.divergenceTypes.includes(DIVERGENCE_TYPES.LAST_TOOL_MISMATCH));
	});

	test('15. lastAction mismatch', () => {
		const result = compareAgentSessionParity({
			ramState: baseState({ lastAction: 'a' }),
			draftSession: draftRow(baseState({ lastAction: 'b' })),
		});
		assert.ok(result.divergenceTypes.includes(DIVERGENCE_TYPES.LAST_ACTION_MISMATCH));
	});

	test('16. pending mismatch', () => {
		const result = compareAgentSessionParity({
			ramState: baseState({
				pendingWrite: { tool: 'create_expense', label: 'a', amount: 1 },
			}),
			draftSession: draftRow(baseState()),
			pendingSession: pendingRow({ tool: 'create_expense', label: 'b', amount: 2 }),
		});
		assert.ok(result.divergenceTypes.includes(DIVERGENCE_TYPES.PENDING_MISMATCH));
		assert.equal(result.severity, SEVERITY.CRITICAL);
	});

	test('17. pending RAM only = critical (P0-1)', () => {
		const pw = { tool: 'create_expense', label: 'transport', amount: 20 };
		const result = compareAgentSessionParity({
			ramState: baseState({ pendingWrite: pw }),
			draftSession: draftRow(baseState()),
			pendingSession: null,
		});
		assert.equal(result.match, false);
		assert.ok(result.divergenceTypes.includes(DIVERGENCE_TYPES.PENDING_RAM_ONLY));
		assert.equal(result.severity, SEVERITY.CRITICAL);
	});

	test('18. pending DB only = critical', () => {
		const pw = { tool: 'create_expense', label: 'x', amount: 1 };
		const result = compareAgentSessionParity({
			ramState: baseState({ pendingWrite: null }),
			draftSession: draftRow(baseState()),
			pendingSession: pendingRow(pw),
		});
		assert.ok(result.divergenceTypes.includes(DIVERGENCE_TYPES.PENDING_DB_ONLY));
		assert.equal(result.severity, SEVERITY.CRITICAL);
	});

	test('19. DB missing after write = transient when mirror failed', () => {
		const result = compareAgentSessionParity({
			ramState: baseState(),
			draftSession: null,
			pendingSession: null,
			mirrorOutcome: 'failure',
		});
		assert.ok(result.divergenceTypes.includes(DIVERGENCE_TYPES.DB_MISSING));
		assert.equal(result.severity, SEVERITY.TRANSIENT);
	});
});

describe('Phase 5.8-E2 agent-session-parity — observe', () => {
	beforeEach(() => {
		setIsParityEnabledForTests(true);
		setIsSupabaseConfiguredForTests(true);
	});

	test('20. parity counters match', async () => {
		saveConversationState(USER_A.id, SESSION, baseState());
		setLoadDbSessionsForParityTests(async () => ({
			draft: draftRow(baseState()),
			pending: null,
		}));

		await observeAgentSessionParity({ user: USER_A, sessionId: SESSION, mirrorOutcome: 'success' });
		const m = getAgentSessionParityMetricsForTests();
		assert.equal(m.parity_check, 1);
		assert.equal(m.parity_match, 1);
	});

	test('21. reset counters', () => {
		resetAgentSessionParityForTests();
		const m = getAgentSessionParityMetricsForTests();
		assert.equal(m.parity_check, 0);
		assert.equal(m.parity_divergence, 0);
	});

	test('22-23. metrics contain no pendingWrite secrets', async () => {
		const secretLabel = 'SECRET_FINANCIAL_LABEL_XYZ';
		saveConversationState(USER_A.id, SESSION, baseState({
			pendingWrite: { tool: 'create_expense', label: secretLabel, amount: 99999 },
		}));
		setLoadDbSessionsForParityTests(async () => ({ draft: draftRow(baseState()), pending: null }));

		await observeAgentSessionParity({ user: USER_A, sessionId: SESSION, mirrorOutcome: 'success' });
		const metricsJson = JSON.stringify(getAgentSessionParityMetricsForTests());
		assert.equal(metricsJson.includes(secretLabel), false);
		assert.equal(metricsJson.includes('99999'), false);
	});

	test('feature flag disabled → skipped', async () => {
		setIsParityEnabledForTests(false);
		await observeAgentSessionParity({ user: USER_A, sessionId: SESSION });
		assert.equal(getAgentSessionParityMetricsForTests().parity_skipped, 1);
	});
});

describe('Phase 5.8-E2 agent-session-parity — P0 scenarios', () => {
	beforeEach(() => {
		setIsSupabaseConfiguredForTests(true);
	});

	test('25. P0-1 DB partial: draft present, pending absent, RAM pending', () => {
		const pw = { tool: 'create_sale', product: 'p', quantity: 1, unitPrice: 1, amountPaid: 1 };
		const result = compareAgentSessionParity({
			ramState: baseState({ pendingWrite: pw, intent: 'create_sale' }),
			draftSession: draftRow(baseState({ intent: 'create_sale' })),
			pendingSession: null,
			mirrorOutcome: 'success',
		});
		assert.equal(result.match, false);
		assert.ok(result.divergenceTypes.includes(DIVERGENCE_TYPES.PENDING_RAM_ONLY));
		assert.equal(result.severity, SEVERITY.CRITICAL);
	});

	test('26. P0-2 clear/save race — save then clear wins (same generation)', async () => {
		const store = { pending: null, version: 0 };
		setMirrorSessionsAtomicImplForTests(async (_clientId, params) => {
			if (params.pendingPayload) {
				store.pending = params.pendingPayload.pendingWrite;
				store.version += 1;
			} else if (params.clearPendingVersion == null || params.clearPendingVersion === store.version) {
				store.pending = null;
			}
			return {
				draftVersion: 1,
				pendingVersion: store.pending ? store.version : null,
				pendingCleared: store.pending ? 0 : 1,
			};
		});

		const pwB = { tool: 'create_expense', label: 'B', amount: 2 };
		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingWrite: pwB, pendingConsumeToken: 'tok-26' }),
		});
		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingWrite: null, pendingSessionVersion: store.version }),
		});

		assert.equal(store.pending, null);
	});

	test('26b. P0-2 stale clear does not remove newer pending', async () => {
		const store = { pending: null, version: 0 };
		setMirrorSessionsAtomicImplForTests(async (_clientId, params) => {
			if (params.pendingPayload) {
				store.pending = params.pendingPayload.pendingWrite;
				store.version += 1;
			} else if (params.clearPendingVersion != null && params.clearPendingVersion === store.version) {
				store.pending = null;
			} else if (params.clearPendingVersion == null) {
				store.pending = null;
			}
			return {
				draftVersion: 1,
				pendingVersion: store.pending ? store.version : null,
				pendingCleared: 0,
			};
		});

		const pwA = { tool: 'create_expense', label: 'A', amount: 1 };
		const pw = { tool: 'create_expense', label: 'B', amount: 2 };
		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingWrite: pwA, pendingConsumeToken: 'tok-a' }),
		});
		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingWrite: pw, pendingConsumeToken: 'tok-b' }),
		});
		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingWrite: null, pendingSessionVersion: 1 }),
		});

		assert.equal(store.pending?.label, 'B');
	});
});

describe('Phase 5.8-E2 agent-session-parity — reader 5.8-C (observe only)', () => {
	test('27. DB draft only merges RAM pending — reader preserves pendingWrite (F1)', async () => {
		const pw = { tool: 'create_expense', label: 'lost', amount: 10 };
		saveConversationState(USER_A.id, SESSION, baseState({ pendingWrite: pw }));

		setGetSessionImplForTests(async (_clientId, stateType) => {
			if (stateType === 'draft') return draftRow(baseState({ topic: 'ventes' }));
			return null;
		});

		const { state, source, readMode } = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(source, 'agent_sessions');
		assert.equal(readMode, 'RAM_PENDING_MERGE');
		assert.equal(state.pendingWrite.label, 'lost');
		assert.equal(getConversationState(USER_A.id, SESSION, USER_A.activeActivityId).pendingWrite?.label, 'lost');

		const parity = compareAgentSessionParity({
			ramState: getConversationState(USER_A.id, SESSION, USER_A.activeActivityId),
			draftSession: draftRow(baseState({ topic: 'ventes' })),
			pendingSession: null,
		});
		assert.ok(parity.divergenceTypes.includes(DIVERGENCE_TYPES.PENDING_RAM_ONLY));
	});
});

describe('Phase 5.8-E2 agent-session-parity — restart & multi-instance', () => {
	test('28. restart with DB pending — reader retrouve pending', async () => {
		const pw = { tool: 'create_expense', label: 'fuel', amount: 50 };
		clearConversationSessionsForTests();

		setGetSessionImplForTests(async (_clientId, stateType) => {
			if (stateType === 'draft') return draftRow(baseState({ topic: 'expenses' }));
			if (stateType === 'pending') return pendingRow(pw);
			return null;
		});

		const { state } = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.deepEqual(state.pendingWrite, pw);
	});

	test('29. restart without DB pending — pending perdu', async () => {
		clearConversationSessionsForTests();

		setGetSessionImplForTests(async () => null);

		const { state, source } = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(source, 'conversation_store_fallback');
		assert.equal(state.pendingWrite, null);
	});

	test('30. multi-instance — DB partagée, RAM locale diverge', () => {
		const ramA = baseState({ topic: 'ventes', pendingWrite: null });
		const ramB = baseState({ topic: 'depenses', pendingWrite: null });
		const dbDraft = draftRow(baseState({ topic: 'depenses' }));

		const parityA = compareAgentSessionParity({ ramState: ramA, draftSession: dbDraft });
		const parityB = compareAgentSessionParity({ ramState: ramB, draftSession: dbDraft });

		assert.equal(parityA.match, false);
		assert.equal(parityB.match, true);
	});
});

describe('Phase 5.8-E2 agent-session-parity — feature flag', () => {
	test('isAgentSessionParityEnabled respects env false', () => {
		resetAgentSessionParityForTests();
		process.env.AGENT_SESSION_PARITY_ENABLED = 'false';
		assert.equal(isAgentSessionParityEnabled(), false);
	});
});
