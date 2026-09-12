/**
 * Phase 5.8-F4-B2-C — Durable idempotency for transactional confirmation (unit).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, before, describe, test } from 'node:test';

import {
	clearConversationSessionsForTests,
	getConversationState,
	persistConversationState,
} from '../src/agent/conversation-state.js';
import { resetConversationStoreForTests } from '../src/agent/conversation-store.js';
import { createAshyAgent } from '../src/agent/index.js';
import { setForceRegexResolverForTests } from '../src/agent/intent-resolver/index.js';
import {
	computeRequestHash,
} from '../src/lib/agent-operation-idempotency.js';
import { resetAgentSessionReaderForTests } from '../src/services/agent-session-reader.js';
import {
	resetAgentSessionServiceImplForTests,
	setGetSessionsPairImplForTests,
	setMirrorSessionsAtomicImplForTests,
} from '../src/services/agent-session-service.js';
import {
	getTransactionalWriteMetricsForTests,
	resetAgentTransactionalWriteForTests,
	setConfirmAndCreateExpenseImplForTests,
	setIsIdempotentConfirmEnabledForTests,
	setIsTransactionalConfirmEnabledForTests,
	TRANSACTIONAL_CONFIRM_STATUS,
} from '../src/services/agent-transactional-write-service.js';
import {
	resetAgentSessionWriterForTests,
	setIsSupabaseConfiguredForTests,
} from '../src/services/agent-session-writer.js';
import {
	resetCreateExpenseImplForTests,
	setCreateExpenseImplForTests,
} from '../src/services/expenses-write-service.js';

const CLIENT_A = '22222222-2222-4222-8222-222222222222';
const CLIENT_B = '33333333-3333-4333-8333-333333333333';
const ACTIVITY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const ACTIVITY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';
const USER_A = { id: 'pb-f4b2c-a', clientId: CLIENT_A, activeActivityId: ACTIVITY_A, businessUserId: 'rec-b2c-a' };
const USER_B = { id: 'pb-f4b2c-b', clientId: CLIENT_B, activeActivityId: ACTIVITY_B, businessUserId: 'rec-b2c-b' };
const SESSION = 'sess-f4-b2c';
const OPERATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EXPENSE_PENDING = { tool: 'create_expense', label: 'transport', amount: 500 };

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
		topic: 'expenses',
		intent: 'create_expense',
		filters: {},
		references: emptyReferences(),
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

function draftRow(payload, version = 1) {
	return {
		id: 'draft-b2c',
		clientId: CLIENT_A,
		stateType: 'draft',
		payload,
		intention: null,
		awaiting: null,
		stateVersion: version,
		updatedAt: '2026-09-09T00:00:00.000Z',
	};
}

function pendingRow(pendingPayload, extras = {}) {
	return {
		id: 'pending-b2c',
		clientId: extras.clientId ?? CLIENT_A,
		stateType: 'pending',
		payload: pendingPayload,
		intention: pendingPayload.pendingWrite?.tool ?? 'create_expense',
		awaiting: 'confirm',
		stateVersion: extras.stateVersion ?? 2,
		updatedAt: '2026-09-09T01:00:00.000Z',
	};
}

function wireDbStore(store) {
	setMirrorSessionsAtomicImplForTests(async (_clientId, params) => {
		store.draft = draftRow(params.draftPayload, (store.draft?.stateVersion ?? 0) + 1);
		if (params.pendingPayload) {
			store.pending = pendingRow(
				params.pendingPayload,
				{ stateVersion: (store.pending?.stateVersion ?? 1) + 1 },
			);
		} else if (params.clearPendingVersion != null) {
			if (store.pending?.stateVersion === params.clearPendingVersion) {
				store.pending = null;
			}
		} else {
			store.pending = null;
		}
		return {
			draftVersion: store.draft?.stateVersion ?? 1,
			pendingVersion: store.pending?.stateVersion ?? null,
			pendingCleared: store.pending ? 0 : 1,
		};
	});

	setGetSessionsPairImplForTests(async () => ({
		draft: store.draft,
		pending: store.pending,
	}));
}

describe('Phase 5.8-F4-B2-C — idempotent transactional confirmation (unit)', () => {
	before(() => {
		process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
		process.env.AGENT_SESSION_TRANSACTIONAL_CONFIRM = 'true';
		process.env.AGENT_SESSION_IDEMPOTENT_CONFIRM = 'true';
		setForceRegexResolverForTests(true);
		setIsSupabaseConfiguredForTests(true);
		setIsTransactionalConfirmEnabledForTests(true);
		setIsIdempotentConfirmEnabledForTests(true);
	});

	afterEach(() => {
		resetAgentSessionServiceImplForTests();
		resetAgentSessionWriterForTests();
		resetAgentSessionReaderForTests();
		resetAgentTransactionalWriteForTests();
		resetCreateExpenseImplForTests();
		clearConversationSessionsForTests();
		resetConversationStoreForTests();
		setIsSupabaseConfiguredForTests(true);
		setIsTransactionalConfirmEnabledForTests(true);
		setIsIdempotentConfirmEnabledForTests(true);
	});

	test('B2-C-1 — first operation commits with operation_id + hash', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);
		let captured = null;

		setCreateExpenseImplForTests(async () => {
			throw new Error('executeTool must not run when transactional succeeds');
		});

		setConfirmAndCreateExpenseImplForTests(async (scope, params) => {
			captured = { clientId: scope.clientId, activityId: scope.activityId, ...params };
			return {
				success: true,
				status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
				operation: 'create_expense',
				result_id: 'exp-b2c-1',
				pending_consumed: true,
				label: 'transport',
				amount: 500,
			};
		});

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-b2c',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });

		assert.equal(result.toolResults[0]?.success, true);
		assert.equal(result.toolResults[0]?.summary?.expenseId, 'exp-b2c-1');
		assert.equal(captured.clientId, CLIENT_A);
		assert.equal(captured.operationId, OPERATION_ID);
		assert.equal(captured.requestHash, computeRequestHash(CLIENT_A, EXPENSE_PENDING));
		assert.equal(getTransactionalWriteMetricsForTests().transactional_write_success, 1);
	});

	test('B2-C-2 — replay same operation_id + hash returns existing result', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);
		let callCount = 0;

		setConfirmAndCreateExpenseImplForTests(async () => {
			callCount += 1;
			return {
				success: true,
				status: TRANSACTIONAL_CONFIRM_STATUS.ALREADY_COMPLETED,
				operation: 'create_expense',
				result_id: 'exp-b2c-replay',
				pending_consumed: true,
				label: 'transport',
				amount: 500,
			};
		});

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-b2c',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });

		assert.equal(callCount, 1);
		assert.equal(result.toolResults[0]?.success, true);
		assert.equal(result.toolResults[0]?.summary?.expenseId, 'exp-b2c-replay');
		assert.equal(getConversationState(USER_A.id, SESSION, USER_A.activeActivityId).pendingWrite, null);
	});

	test('B2-C-3 — same operation_id + different hash rejected', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);

		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: false,
			status: TRANSACTIONAL_CONFIRM_STATUS.REQUEST_HASH_MISMATCH,
			pending_consumed: false,
		}));

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-b2c',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });

		assert.match(result.reply, /ne correspond pas/i);
		assert.equal(getTransactionalWriteMetricsForTests().transactional_write_conflict, 1);
	});

	test('B2-C-4 — concurrent calls share one RPC outcome (mocked single write)', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);
		let inFlight = 0;
		let maxInFlight = 0;

		setConfirmAndCreateExpenseImplForTests(async () => {
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 20));
			inFlight -= 1;
			return {
				success: true,
				status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
				result_id: 'exp-b2c-conc',
				label: 'transport',
				amount: 500,
			};
		});

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-b2c',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const [r1, r2] = await Promise.all([
			agent.run({ message: 'oui', user: USER_A, sessionId: SESSION }),
			agent.run({ message: 'oui', user: USER_A, sessionId: SESSION }),
		]);

		const successes = [r1, r2].filter((r) => r.toolResults[0]?.success);
		assert.ok(successes.length >= 1);
		assert.ok(maxInFlight >= 1);
	});

	test('B2-C-5 — business failure preserves pending (rollback path)', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);

		setConfirmAndCreateExpenseImplForTests(async () => {
			const err = new Error('amount must be positive');
			err.code = 'INVALID_PARAMETER';
			throw err;
		});

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-b2c',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });

		assert.equal(result.toolResults[0]?.success, false);
		assert.equal(getConversationState(USER_A.id, SESSION, USER_A.activeActivityId).pendingWrite?.label, 'transport');
		assert.equal(getConversationState(USER_A.id, SESSION, USER_A.activeActivityId).pendingOperationId, OPERATION_ID);
		assert.equal(getTransactionalWriteMetricsForTests().transactional_write_rollback, 1);
	});

	test('B2-C-6 — timeout retry replays ALREADY_COMPLETED without second write', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);
		let calls = 0;

		setConfirmAndCreateExpenseImplForTests(async () => {
			calls += 1;
			if (calls === 1) {
				return {
					success: true,
					status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
					result_id: 'exp-b2c-timeout',
					label: 'transport',
					amount: 500,
				};
			}
			return {
				success: true,
				status: TRANSACTIONAL_CONFIRM_STATUS.ALREADY_COMPLETED,
				result_id: 'exp-b2c-timeout',
				label: 'transport',
				amount: 500,
			};
		});

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-b2c',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const first = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });
		assert.equal(first.toolResults[0]?.summary?.expenseId, 'exp-b2c-timeout');

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-b2c',
			}),
		});

		const retry = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });
		assert.equal(retry.toolResults[0]?.summary?.expenseId, 'exp-b2c-timeout');
		assert.equal(calls, 2);
	});

	test('B2-C-7 — same operation_id different clients are independent', async () => {
		const storeA = { draft: null, pending: null };
		const storeB = { draft: null, pending: null };
		const capturedClients = [];

		setMirrorSessionsAtomicImplForTests(async (scope, params) => {
			const store = scope.clientId === CLIENT_A ? storeA : storeB;
			store.draft = draftRow(params.draftPayload, (store.draft?.stateVersion ?? 0) + 1);
			if (params.pendingPayload) {
				store.pending = pendingRow(params.pendingPayload, { clientId: scope.clientId, stateVersion: 2 });
			}
			return { draftVersion: 1, pendingVersion: 2, pendingCleared: 0 };
		});

		setGetSessionsPairImplForTests(async (_clientId) => ({
			draft: storeA.draft,
			pending: storeA.pending,
		}));

		setConfirmAndCreateExpenseImplForTests(async (scope) => {
			capturedClients.push(scope.clientId);
			return {
				success: true,
				status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
				result_id: `exp-${scope.clientId.slice(0, 8)}`,
				label: 'transport',
				amount: 500,
			};
		});

		const sharedOpId = randomUUID();

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: sharedOpId,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-a',
			}),
			requirePendingDb: true,
		});

		setGetSessionsPairImplForTests(async () => ({
			draft: storeB.draft,
			pending: storeB.pending,
		}));

		await persistConversationState({
			user: USER_B,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: sharedOpId,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-b',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });

		setGetSessionsPairImplForTests(async () => ({
			draft: storeB.draft,
			pending: storeB.pending,
		}));

		await agent.run({ message: 'oui', user: USER_B, sessionId: SESSION });

		assert.deepEqual(capturedClients, [CLIENT_A, CLIENT_B]);
	});

	test('B2-C-8 — client_id comes from authenticated user scope, not pending payload', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);
		let captured = null;

		setConfirmAndCreateExpenseImplForTests(async (scope, params) => {
			captured = { clientId: scope.clientId, activityId: scope.activityId, ...params };
			return {
				success: true,
				status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
				result_id: 'exp-scope',
				label: 'transport',
				amount: 500,
			};
		});

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-b2c',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });

		assert.equal(captured.clientId, CLIENT_A);
		assert.equal(captured.requestHash, computeRequestHash(CLIENT_A, EXPENSE_PENDING));
		assert.notEqual(captured.requestHash, computeRequestHash(CLIENT_B, EXPENSE_PENDING));
	});

	test('B2-C-9 — operation_id generated server-side at pending creation', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);

		setCreateExpenseImplForTests(async () => ({
			success: false,
			error: { code: 'NEEDS_CONFIRMATION', message: 'confirm' },
		}));

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({ filters: { label: 'loyer', amount: 1200 } }),
		});

		const agent = createAshyAgent();
		await agent.run({
			message: 'dépense loyer 1200',
			user: USER_A,
			sessionId: SESSION,
		});

		const stored = getConversationState(USER_A.id, SESSION, USER_A.activeActivityId);
		assert.ok(stored.pendingOperationId);
		assert.match(stored.pendingOperationId, /^[0-9a-f-]{36}$/i);
		assert.notEqual(stored.pendingOperationId, 'operation-id-from-model');
	});

	test('B2-C-10 — replay returns correct result_id', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);
		const replayId = 'exp-b2c-10-replay';

		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.ALREADY_COMPLETED,
			result_id: replayId,
			label: 'transport',
			amount: 500,
		}));

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-b2c',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });

		assert.equal(result.toolResults[0]?.summary?.expenseId, replayId);
	});
});
