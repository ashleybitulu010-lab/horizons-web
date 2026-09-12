import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
	clearConversationSessionsForTests,
	createEmptyConversationState,
	getConversationState,
	mergeConversationState,
	saveConversationState,
} from '../src/agent/conversation-state.js';
import { createAshyAgent } from '../src/agent/index.js';
import { setForceRegexResolverForTests } from '../src/agent/intent-resolver/index.js';
import {
	getAgentSessionState,
	resetAgentSessionReaderForTests,
} from '../src/services/agent-session-reader.js';
import {
	CONSUME_PENDING_STATUS,
	resetAgentSessionServiceImplForTests,
	setConsumeAgentPendingImplForTests,
	setGetSessionsPairImplForTests,
	setMirrorSessionsAtomicImplForTests,
} from '../src/services/agent-session-service.js';
import {
	mapAgentStateToSessions,
	mirrorAgentSessionState,
	resetAgentSessionWriterForTests,
	setIsSupabaseConfiguredForTests,
} from '../src/services/agent-session-writer.js';
import {
	compareAgentSessionParity,
	DIVERGENCE_TYPES,
} from '../src/services/agent-session-parity.js';
import {
	setCreateExpenseImplForTests,
	resetCreateExpenseImplForTests,
} from '../src/services/expenses-write-service.js';

const CLIENT_A = '11111111-1111-4111-8111-111111111111';
const CLIENT_B = '22222222-2222-4222-8222-222222222222';
const ACTIVITY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const ACTIVITY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';
const USER_A = { id: 'pb-a', clientId: CLIENT_A, activeActivityId: ACTIVITY_A, businessUserId: 'rec-a' };
const USER_B = { id: 'pb-b', clientId: CLIENT_B, activeActivityId: ACTIVITY_B, businessUserId: 'rec-b' };
const SESSION = 'sess-p0';

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
		pendingSessionVersion: null,
		pendingConsumeToken: null,
		...overrides,
	};
}

function createAtomicStore() {
	const byClient = new Map();

	function clientStore(clientId) {
		if (!byClient.has(clientId)) {
			byClient.set(clientId, { draft: null, pending: null });
		}
		return byClient.get(clientId);
	}

	function row(clientId, stateType, payload, extra = {}) {
		const store = clientStore(clientId);
		const current = store[stateType];
		const stateVersion = (current?.stateVersion ?? 0) + 1;
		const mapped = {
			id: `${stateType}-${clientId}`,
			clientId,
			stateType,
			payload,
			intention: extra.intention ?? null,
			awaiting: extra.awaiting ?? null,
			stateVersion,
			updatedAt: new Date().toISOString(),
		};
		store[stateType] = mapped;
		return mapped;
	}

	return {
		reset() {
			byClient.clear();
		},
		getPair(clientId) {
			const store = clientStore(clientId);
			return { draft: store.draft, pending: store.pending };
		},
		async mirrorAtomic(clientId, params) {
			const store = clientStore(clientId);
			const draftRow = row(clientId, 'draft', params.draftPayload);
			let pendingVersion = null;
			let pendingCleared = 0;

			if (params.pendingPayload != null) {
				const pendingRow = row(clientId, 'pending', params.pendingPayload, {
					awaiting: params.pendingAwaiting,
					intention: params.pendingIntention,
				});
				pendingVersion = pendingRow.stateVersion;
			} else if (params.clearPendingVersion != null) {
				if (store.pending?.stateVersion === params.clearPendingVersion) {
					store.pending = null;
					pendingCleared = 1;
				}
			} else {
				if (store.pending) {
					store.pending = null;
					pendingCleared = 1;
				}
			}

			return {
				draftVersion: draftRow.stateVersion,
				pendingVersion,
				pendingCleared,
			};
		},
		async consume(clientId, { expectedVersion = null, consumeToken = null } = {}) {
			const store = clientStore(clientId);
			const pending = store.pending;
			if (!pending) {
				return { status: CONSUME_PENDING_STATUS.ALREADY_CONSUMED };
			}

			const versionMatch = expectedVersion != null && pending.stateVersion === expectedVersion;
			const tokenMatch = consumeToken && pending.payload?.consumeToken === consumeToken;
			if (!versionMatch && !tokenMatch) {
				return { status: CONSUME_PENDING_STATUS.VERSION_MISMATCH };
			}

			const payload = pending.payload;
			store.pending = null;
			return {
				status: CONSUME_PENDING_STATUS.CONSUMED,
				payload,
				version: pending.stateVersion,
			};
		},
	};
}

let atomicStore = createAtomicStore();

function wireAtomicMocks() {
	setIsSupabaseConfiguredForTests(true);
	setGetSessionsPairImplForTests(async (scope) => atomicStore.getPair(scope.clientId));
	setMirrorSessionsAtomicImplForTests(async (scope, params) => atomicStore.mirrorAtomic(scope.clientId, params));
	setConsumeAgentPendingImplForTests(async (scope, params) => atomicStore.consume(scope.clientId, params));
}

afterEach(() => {
	atomicStore.reset();
	resetAgentSessionServiceImplForTests();
	resetAgentSessionWriterForTests();
	resetAgentSessionReaderForTests();
	clearConversationSessionsForTests();
	setForceRegexResolverForTests(false);
	resetCreateExpenseImplForTests();
	delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe('Phase 5.8-P0 — P0-1 atomic mirror', () => {
	beforeEach(() => {
		wireAtomicMocks();
	});

	test('P0-1-A draft only — DB coherent', async () => {
		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState(),
		});
		const { draft, pending } = atomicStore.getPair(CLIENT_A);
		assert.ok(draft);
		assert.equal(pending, null);
	});

	test('P0-1-B draft + pending — no partial observable state', async () => {
		const pw = { tool: 'create_expense', label: 'fuel', amount: 50 };
		const state = baseState({ pendingWrite: pw, pendingConsumeToken: 'tok-b' });
		await mirrorAgentSessionState({ user: USER_A, sessionId: SESSION, state });

		const { draft, pending } = atomicStore.getPair(CLIENT_A);
		assert.ok(draft);
		assert.ok(pending);
		assert.deepEqual(pending.payload.pendingWrite, pw);
	});

	test('P0-1-C replace pending — atomic transition', async () => {
		const pwA = { tool: 'create_expense', label: 'A', amount: 1 };
		const pwB = { tool: 'create_expense', label: 'B', amount: 2 };
		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingWrite: pwA, pendingConsumeToken: 'tok-a' }),
		});
		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingWrite: pwB, pendingConsumeToken: 'tok-b' }),
		});
		const { pending } = atomicStore.getPair(CLIENT_A);
		assert.equal(pending.payload.pendingWrite.label, 'B');
		assert.ok(pending.stateVersion >= 2);
	});

	test('P0-1-D clear pending + draft — conditional clear uses version', async () => {
		const pw = { tool: 'create_expense', label: 'x', amount: 1 };
		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingWrite: pw, pendingConsumeToken: 'tok-1' }),
		});
		const v1 = atomicStore.getPair(CLIENT_A).pending.stateVersion;

		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingSessionVersion: v1 }),
		});

		const pair = atomicStore.getPair(CLIENT_A);
		assert.equal(pair.pending, null);
		assert.ok(pair.draft);
	});

	test('P0-1-F reader finds pending after full save', async () => {
		const pw = { tool: 'create_sale', product: 'poulet', quantity: 2, unitPrice: 5, amountPaid: 10 };
		saveConversationState(USER_A.id, SESSION, baseState({
			pendingWrite: pw,
			pendingConsumeToken: 'tok-read',
		}));
		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: getConversationState(USER_A.id, SESSION, USER_A.activeActivityId),
		});

		const { state, source } = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(source, 'agent_sessions');
		assert.deepEqual(state.pendingWrite, pw);
		assert.ok(state.pendingSessionVersion != null);
	});
});

describe('Phase 5.8-P0 — P0-2 clear/save race', () => {
	beforeEach(() => {
		wireAtomicMocks();
	});

	test('Cas 1 — clear A then pending B remains', async () => {
		const pwA = { tool: 'create_expense', label: 'A', amount: 1 };
		const pwB = { tool: 'create_expense', label: 'B', amount: 2 };

		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingWrite: pwA, pendingConsumeToken: 'tok-a' }),
		});
		const versionA = atomicStore.getPair(CLIENT_A).pending.stateVersion;

		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingWrite: pwB, pendingConsumeToken: 'tok-b' }),
		});

		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingSessionVersion: versionA }),
		});

		const pending = atomicStore.getPair(CLIENT_A).pending;
		assert.ok(pending);
		assert.equal(pending.payload.pendingWrite.label, 'B');
	});

	test('Cas 2 — stale clear does not remove newer pending', async () => {
		const pwA = { tool: 'create_expense', label: 'A', amount: 1 };
		const pwB = { tool: 'create_expense', label: 'B', amount: 2 };
		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingWrite: pwA, pendingConsumeToken: 'tok-a' }),
		});
		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingWrite: pwB, pendingConsumeToken: 'tok-b' }),
		});

		const result = await atomicStore.mirrorAtomic(CLIENT_A, {
			draftPayload: baseState(),
			pendingPayload: null,
			clearPendingVersion: 1,
		});
		assert.equal(result.pendingCleared, 0);
		assert.equal(atomicStore.getPair(CLIENT_A).pending.payload.pendingWrite.label, 'B');
	});

	test('Cas 4 — clear already absent is safe', async () => {
		const result = await atomicStore.mirrorAtomic(CLIENT_A, {
			draftPayload: baseState(),
			pendingPayload: null,
			clearPendingVersion: 99,
		});
		assert.equal(result.pendingCleared, 0);
	});

	test('multi-client — conflict on A does not touch B', async () => {
		const pwA = { tool: 'create_expense', label: 'A', amount: 1 };
		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingWrite: pwA, pendingConsumeToken: 'tok-a' }),
		});
		const versionA = atomicStore.getPair(CLIENT_A).pending.stateVersion;

		const pwB = { tool: 'create_expense', label: 'B', amount: 2 };
		await mirrorAgentSessionState({
			user: USER_B,
			sessionId: SESSION,
			state: baseState({ pendingWrite: pwB, pendingConsumeToken: 'tok-b' }),
		});

		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingSessionVersion: versionA }),
		});

		assert.equal(atomicStore.getPair(CLIENT_A).pending, null);
		assert.equal(atomicStore.getPair(CLIENT_B).pending.payload.pendingWrite.label, 'B');
	});
});

describe('Phase 5.8-P0 — P0-3 confirmation idempotence', () => {
	beforeEach(() => {
		wireAtomicMocks();
	});

	test('double consume — second returns ALREADY_CONSUMED', async () => {
		const pw = { tool: 'create_expense', label: 'fuel', amount: 50 };
		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingWrite: pw, pendingConsumeToken: 'tok-dup' }),
		});
		const version = atomicStore.getPair(CLIENT_A).pending.stateVersion;

		const first = await atomicStore.consume(CLIENT_A, { expectedVersion: version, consumeToken: 'tok-dup' });
		const second = await atomicStore.consume(CLIENT_A, { expectedVersion: version, consumeToken: 'tok-dup' });

		assert.equal(first.status, CONSUME_PENDING_STATUS.CONSUMED);
		assert.equal(second.status, CONSUME_PENDING_STATUS.ALREADY_CONSUMED);
	});

	test('concurrent consume simulation — only one wins', async () => {
		const pw = { tool: 'create_expense', label: 'fuel', amount: 50 };
		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ pendingWrite: pw, pendingConsumeToken: 'tok-race' }),
		});
		const version = atomicStore.getPair(CLIENT_A).pending.stateVersion;

		const results = await Promise.all([
			atomicStore.consume(CLIENT_A, { expectedVersion: version, consumeToken: 'tok-race' }),
			atomicStore.consume(CLIENT_A, { expectedVersion: version, consumeToken: 'tok-race' }),
		]);

		const consumed = results.filter((r) => r.status === CONSUME_PENDING_STATUS.CONSUMED);
		const rejected = results.filter((r) => r.status !== CONSUME_PENDING_STATUS.CONSUMED);
		assert.equal(consumed.length, 1);
		assert.equal(rejected.length, 1);
	});

	test('agent orchestrator — duplicate confirmation does not double-write', async () => {
		process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
		setForceRegexResolverForTests(true);
		const agent = createAshyAgent();

		const pw = { tool: 'create_expense', label: 'fuel', amount: 50 };
		saveConversationState(USER_A.id, SESSION, baseState({
			intent: 'create_expense',
			topic: 'expenses',
			pendingWrite: pw,
			pendingConsumeToken: 'tok-orch',
		}));
		await mirrorAgentSessionState({
			user: USER_A,
			sessionId: SESSION,
			state: getConversationState(USER_A.id, SESSION, USER_A.activeActivityId),
		});
		const version = atomicStore.getPair(CLIENT_A).pending.stateVersion;
		saveConversationState(USER_A.id, SESSION, mergeConversationState(
			getConversationState(USER_A.id, SESSION, USER_A.activeActivityId),
			{ pendingSessionVersion: version },
		));

		let writeCount = 0;
		setCreateExpenseImplForTests(async () => {
			writeCount += 1;
			return {
				expenseId: 'exp-1',
				label: 'fuel',
				amount: 50,
			};
		});

		await Promise.all([
			agent.run({ message: 'oui', user: USER_A, sessionId: SESSION }),
			agent.run({ message: 'oui', user: USER_A, sessionId: SESSION }),
		]);

		assert.equal(writeCount, 1);
		resetCreateExpenseImplForTests();
	});
});

describe('Phase 5.8-P0 — E2 parity after fix', () => {
	test('P0-1 partial DB no longer detected when atomic pair present', () => {
		const pw = { tool: 'create_expense', label: 'x', amount: 1 };
		const draftSession = {
			stateType: 'draft',
			payload: baseState(),
			stateVersion: 1,
		};
		const pendingSession = {
			stateType: 'pending',
			payload: { pendingWrite: pw, consumeToken: 'tok' },
			stateVersion: 2,
		};
		const result = compareAgentSessionParity({
			ramState: baseState({ pendingWrite: pw, pendingConsumeToken: 'tok' }),
			draftSession,
			pendingSession,
			mirrorOutcome: 'success',
		});
		assert.equal(result.match, true);
		assert.equal(result.divergenceTypes.includes(DIVERGENCE_TYPES.PENDING_RAM_ONLY), false);
	});
});

describe('Phase 5.8-P0 — mapAgentStateToSessions', () => {
	test('includes consumeToken in pending payload', () => {
		const pw = { tool: 'create_expense', label: 'x', amount: 1 };
		const mapped = mapAgentStateToSessions(baseState({
			pendingWrite: pw,
			pendingConsumeToken: 'my-token',
		}));
		assert.equal(mapped.pending.payload.consumeToken, 'my-token');
		assert.equal(mapped.clearPendingVersion, null);
	});

	test('clear passes pendingSessionVersion', () => {
		const mapped = mapAgentStateToSessions(baseState({ pendingSessionVersion: 7 }));
		assert.equal(mapped.clearPendingVersion, 7);
	});
});
