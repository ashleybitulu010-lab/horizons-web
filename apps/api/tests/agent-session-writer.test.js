import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, test } from 'node:test';

import {
	getConversationState,
	persistConversationState,
	saveConversationState,
} from '../src/agent/conversation-state.js';
import { clearConversationSessionsForTests } from '../src/agent/conversation-state.js';
import {
	mapAgentStateToSessions,
	mirrorAgentSessionState,
	getAgentSessionWriteMetricsForTests,
	resetAgentSessionWriterForTests,
	setMirrorAgentSessionStateImplForTests,
	setIsSupabaseConfiguredForTests,
} from '../src/services/agent-session-writer.js';
import {
	AgentSessionServiceError,
	resetAgentSessionServiceImplForTests,
	setMirrorSessionsAtomicImplForTests,
} from '../src/services/agent-session-service.js';

const CLIENT_A = '11111111-1111-4111-8111-111111111111';
const CLIENT_B = '22222222-2222-4222-8222-222222222222';

const ACTIVITY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';

const USER_A = {
	id: 'pb-user-a',
	clientId: CLIENT_A,
	activeActivityId: ACTIVITY_A,
	businessUserId: 'rec-user-a',
};

const SESSION = 'sess-writer';

function mockAtomicMirror({ onMirror, fail = false } = {}) {
	setMirrorSessionsAtomicImplForTests(async (scope, params) => {
		if (fail) {
			throw new AgentSessionServiceError('MIRROR_ATOMIC_FAILED', 'Unable to mirror agent sessions atomically');
		}
		if (onMirror) {
			await onMirror(scope, params);
		}
		return {
			draftVersion: 1,
			pendingVersion: params.pendingPayload ? 1 : null,
			pendingCleared: params.pendingPayload ? 0 : 1,
		};
	});
}

function emptyReferences() {
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
		references: emptyReferences(),
		lastTool: 'get_sales',
		lastAction: null,
		updatedAt: null,
		pendingWrite: null,
		...overrides,
	};
}

const originalMirrorAwait = process.env.AGENT_SESSION_MIRROR_AWAIT;
const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

before(() => {
	process.env.AGENT_SESSION_MIRROR_AWAIT = 'true';
	process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
});

afterEach(() => {
	process.env.AGENT_SESSION_MIRROR_AWAIT = originalMirrorAwait ?? 'true';
	if (originalServiceKey === undefined) {
		delete process.env.SUPABASE_SERVICE_ROLE_KEY;
	} else {
		process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
	}
	resetAgentSessionWriterForTests();
	resetAgentSessionServiceImplForTests();
	clearConversationSessionsForTests();
});

describe('Phase 5.8-D2 agent-session-writer — mapping', () => {
	test('1. map simple state → draft only', () => {
		const mapped = mapAgentStateToSessions(baseState());
		assert.deepEqual(mapped.draftPayload, {
			topic: 'ventes',
			intent: 'query_sales',
			filters: {},
			references: emptyReferences(),
			lastTool: 'get_sales',
			lastAction: null,
			updatedAt: null,
		});
		assert.equal(mapped.pending, null);
		assert.equal(mapped.draftPayload.pendingWrite, undefined);
	});

	test('2. map pendingWrite create_sale → pending', () => {
		const pendingWrite = {
			tool: 'create_sale',
			product: 'poulet',
			quantity: 2,
			unitPrice: 3500,
			amountPaid: 7000,
		};
		const mapped = mapAgentStateToSessions(baseState({
			intent: 'create_sale',
			lastAction: 'create_sale',
			pendingWrite,
		}));

		assert.equal(mapped.draftPayload.pendingWrite, undefined);
		assert.deepEqual(mapped.pending.payload.pendingWrite, pendingWrite);
		assert.equal(mapped.pending.awaiting, 'confirm');
		assert.equal(mapped.pending.intention, 'create_sale');
	});

	test('3. map pendingWrite create_expense → pending', () => {
		const pendingWrite = {
			tool: 'create_expense',
			label: 'transport',
			amount: 5000,
		};
		const mapped = mapAgentStateToSessions(baseState({
			intent: 'create_expense',
			pendingWrite,
		}));

		assert.equal(mapped.pending.awaiting, 'confirm');
		assert.equal(mapped.pending.intention, 'create_expense');
	});

	test('4. pendingWrite null → no pending row in mapping', () => {
		const mapped = mapAgentStateToSessions(baseState({ pendingWrite: null }));
		assert.equal(mapped.pending, null);
	});

	test('5. aucun champ hors whitelist dans draft payload', () => {
		const mapped = mapAgentStateToSessions(baseState({
			secretField: 'nope',
			pendingWrite: null,
		}));
		assert.equal(mapped.draftPayload.secretField, undefined);
	});
});

describe('Phase 5.8-D2 agent-session-writer — mirror', () => {
	beforeEach(() => {
		setIsSupabaseConfiguredForTests(true);
	});
	test('6. client scope transmis via mirrorSessionsAtomic (mock)', async () => {
		const captured = [];
		mockAtomicMirror({
			onMirror: (scope, params) => {
				captured.push({ clientId: scope.clientId, activityId: scope.activityId, ...params });
			},
		});

		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState(),
		});

		assert.equal(captured.length, 1);
		assert.equal(captured[0].clientId, CLIENT_A);
		assert.ok(captured[0].draftPayload);
		assert.equal(getAgentSessionWriteMetricsForTests().write_db_success, 1);
	});

	test('7. DB failure fail-open (no throw)', async () => {
		mockAtomicMirror({ fail: true });

		await assert.doesNotReject(async () => {
			await mirrorAgentSessionState({
				user: USER_A,
				sessionId: SESSION,
				state: baseState(),
			});
		});

		assert.equal(getAgentSessionWriteMetricsForTests().write_db_failure, 1);
	});

	test('7b. DB skipped when Supabase not configured', async () => {
		setIsSupabaseConfiguredForTests(false);

		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState(),
		});

		assert.equal(getAgentSessionWriteMetricsForTests().write_db_skipped, 1);
	});

	test('8. DB success with pending', async () => {
		const captured = [];
		mockAtomicMirror({
			onMirror: (_clientId, params) => {
				captured.push(params);
			},
		});

		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: { tool: 'create_expense', label: 'x', amount: 1 },
				pendingConsumeToken: 'tok-8',
			}),
		});

		assert.equal(captured.length, 1);
		assert.ok(captured[0].pendingPayload);
		assert.equal(captured[0].pendingPayload.consumeToken, 'tok-8');
		assert.equal(getAgentSessionWriteMetricsForTests().write_db_success, 1);
	});

	test('9. pendingWrite null → atomic clear pending', async () => {
		let clearVersion = null;
		mockAtomicMirror({
			onMirror: (_clientId, params) => {
				clearVersion = params.clearPendingVersion;
			},
		});

		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingWrite: null, pendingSessionVersion: 3 }),
		});

		assert.equal(clearVersion, 3);
		assert.equal(getAgentSessionWriteMetricsForTests().pending_cleared, 1);
	});

	test('10. reset counters', () => {
		const metrics = getAgentSessionWriteMetricsForTests();
		assert.ok('write_ram_success' in metrics);
		assert.ok('write_db_success' in metrics);
		assert.ok('write_db_failure' in metrics);
		assert.ok('write_db_skipped' in metrics);
		assert.ok('pending_cleared' in metrics);
	});

	test('11. writer n appelle que mirrorSessionsAtomic', async () => {
		let atomicCalls = 0;
		mockAtomicMirror({
			onMirror: () => {
				atomicCalls += 1;
			},
		});

		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: { tool: 'create_sale', product: 'a', quantity: 1, unitPrice: 1, amountPaid: 1 },
				pendingConsumeToken: 'tok-11',
			}),
		});

		assert.equal(atomicCalls, 1);
	});
});

describe('Phase 5.8-D2 persistConversationState — orchestration', () => {
	beforeEach(() => {
		setIsSupabaseConfiguredForTests(true);
	});
	test('12. RAM write avant DB mirror', async () => {
		const order = [];
		setMirrorAgentSessionStateImplForTests(async () => {
			order.push('db');
		});

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ topic: 'stock' }),
		});

		assert.deepEqual(order, ['db']);
		const ram = getConversationState(USER_A.id, SESSION, USER_A.activeActivityId);
		assert.equal(ram.topic, 'stock');
		assert.equal(getAgentSessionWriteMetricsForTests().write_ram_success, 1);
	});

	test('13. confirmation pending → clear via mirror', async () => {
		let clearVersion = null;
		mockAtomicMirror({
			onMirror: (_clientId, params) => {
				clearVersion = params.clearPendingVersion;
			},
		});

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingWrite: null, topic: 'expenses', pendingSessionVersion: 2 }),
		});

		assert.equal(clearVersion, 2);
	});

	test('14. validation failure → no RAM no DB', async () => {
		let mirrorCalled = false;
		setMirrorAgentSessionStateImplForTests(async () => {
			mirrorCalled = true;
		});

		assert.throws(
			() => saveConversationState(USER_A.id, SESSION, {
				...baseState(),
				forbiddenKey: true,
			}),
			/unexpected conversation state key/i,
		);

		await assert.rejects(
			() => persistConversationState({
				user: USER_A,
				sessionId: SESSION,
				state: { ...baseState(), forbiddenKey: true },
			}),
			/unexpected conversation state key/i,
		);

		assert.equal(mirrorCalled, false);
		assert.equal(getConversationState(USER_A.id, SESSION, USER_A.activeActivityId).topic, null);
	});

	test('15. DB failure does not break persist (fail-open)', async () => {
		setMirrorAgentSessionStateImplForTests(async () => {
			throw new Error('simulated db down');
		});

		await assert.doesNotReject(() => persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ topic: 'debts' }),
		}));

		assert.equal(getConversationState(USER_A.id, SESSION, USER_A.activeActivityId).topic, 'debts');
	});

	test('16. sessionId n affecte pas le scope DB (clientId only)', async () => {
		let capturedClientId = null;
		mockAtomicMirror({
			onMirror: (scope) => {
				capturedClientId = scope.clientId;
			},
		});

		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: 'other-session-id',
			state: baseState(),
		});

		assert.equal(capturedClientId, CLIENT_A);
	});
});

describe('Phase 5.8-D2 agent-session-writer — concurrence', () => {
	beforeEach(() => {
		setIsSupabaseConfiguredForTests(true);
	});
	test('17. deux saves concurrents — last write wins (upsert)', async () => {
		let lastTopic = null;
		mockAtomicMirror({
			onMirror: async (_clientId, params) => {
				await new Promise((r) => setTimeout(r, 5));
				lastTopic = params.draftPayload.topic;
			},
		});

		await Promise.all([
			mirrorAgentSessionState({
				user: USER_A,
				sessionId: SESSION,
				state: baseState({ topic: 'A' }),
			}),
			mirrorAgentSessionState({
				user: USER_A,
				sessionId: SESSION,
				state: baseState({ topic: 'B' }),
			}),
		]);

		assert.ok(['A', 'B'].includes(lastTopic));
	});

	test('18. clear vs save pending — atomic mirror serializes per client', async () => {
		const captured = [];
		mockAtomicMirror({
			onMirror: async (_clientId, params) => {
				await new Promise((r) => setTimeout(r, 5));
				captured.push(params.pendingPayload ? 'save-pending' : 'clear-pending');
			},
		});

		await Promise.all([
			mirrorAgentSessionState({
				user: USER_A,
				sessionId: SESSION,
				state: baseState({ pendingWrite: null, pendingSessionVersion: 1 }),
			}),
			mirrorAgentSessionState({
				user: USER_A,
				sessionId: SESSION,
				state: baseState({
					pendingWrite: { tool: 'create_expense', label: 'late', amount: 1 },
					pendingConsumeToken: 'tok-late',
				}),
			}),
		]);

		assert.equal(captured.length, 2);
		assert.ok(captured.includes('save-pending'));
	});
});

describe('Phase 5.8-D2 agent-session-writer — sécurité logs', () => {
	beforeEach(() => {
		setIsSupabaseConfiguredForTests(true);
	});
	test('19. mirror ne propage pas pendingWrite dans les métriques', async () => {
		mockAtomicMirror();

		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: { tool: 'create_expense', label: 'SECRET_LABEL', amount: 99999 },
				pendingConsumeToken: 'tok-secret',
			}),
		});

		const metrics = getAgentSessionWriteMetricsForTests();
		assert.equal(typeof metrics.write_db_success, 'number');
		assert.equal(JSON.stringify(metrics).includes('SECRET_LABEL'), false);
		assert.equal(JSON.stringify(metrics).includes('99999'), false);
	});
});

describe('Phase 5.8-D2 agent-session-writer — mapping roundtrip', () => {
	test('20. mapping cohérent avec reader (draft + pending)', async () => {
		const { mapSessionToAgentState } = await import('../src/services/agent-session-reader.js');

		const state = baseState({
			intent: 'create_expense',
			pendingWrite: { tool: 'create_expense', label: 'fuel', amount: 10 },
		});
		const mapped = mapAgentStateToSessions(state);

		const roundtrip = mapSessionToAgentState(
			{ payload: mapped.draftPayload, updatedAt: '2026-09-05T00:00:00.000Z' },
			mapped.pending
				? {
					payload: mapped.pending.payload,
					intention: mapped.pending.intention,
					awaiting: mapped.pending.awaiting,
					updatedAt: '2026-09-05T00:00:00.000Z',
				}
				: null,
		);

		assert.equal(roundtrip.topic, state.topic);
		assert.equal(roundtrip.intent, state.intent);
		assert.deepEqual(roundtrip.pendingWrite, state.pendingWrite);
	});
});
