/**
 * Phase 5.8-F4-B2-D — Node idempotent replay integration (unit).
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
import { computeRequestHash } from '../src/lib/agent-operation-idempotency.js';
import {
	buildIdempotentRpcParams,
	getIdempotentReplayMetricsForTests,
	IDEMPOTENT_REPLAY_ERROR,
	resetIdempotentReplayMetricsForTests,
	resolveTransactionalToolOutcome,
} from '../src/services/agent-idempotent-replay-service.js';
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
	setConfirmAndCreateSaleImplForTests,
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
import {
	resetCreateSaleImplForTests,
	setCreateSaleImplForTests,
} from '../src/services/sales-write-service.js';

const CLIENT_A = '22222222-2222-4222-8222-222222222222';
const CLIENT_B = '33333333-3333-4333-8333-333333333333';
const ACTIVITY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const ACTIVITY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';
const USER_A = { id: 'pb-f4b2d-a', clientId: CLIENT_A, activeActivityId: ACTIVITY_A, businessUserId: 'rec-b2d-a' };
const USER_B = { id: 'pb-f4b2d-b', clientId: CLIENT_B, activeActivityId: ACTIVITY_B, businessUserId: 'rec-b2d-b' };
const SESSION = 'sess-f4-b2d';
const OPERATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const EXPENSE_PENDING = { tool: 'create_expense', label: 'loyer', amount: 1200 };
const SALE_PENDING = {
	tool: 'create_sale',
	product: 'poulets',
	quantity: 2,
	unitPrice: 10,
	amountPaid: 20,
};

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

function wireDbStore(store) {
	setMirrorSessionsAtomicImplForTests(async (_clientId, params) => {
		store.draft = {
			stateVersion: (store.draft?.stateVersion ?? 0) + 1,
			payload: params.draftPayload,
		};
		if (params.pendingPayload) {
			store.pending = {
				stateVersion: (store.pending?.stateVersion ?? 1) + 1,
				payload: params.pendingPayload,
				awaiting: 'confirm',
			};
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

describe('Phase 5.8-F4-B2-D — Node idempotent replay (unit)', () => {
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
		resetIdempotentReplayMetricsForTests();
		resetCreateExpenseImplForTests();
		resetCreateSaleImplForTests();
		clearConversationSessionsForTests();
		resetConversationStoreForTests();
		setIsTransactionalConfirmEnabledForTests(true);
		setIsIdempotentConfirmEnabledForTests(true);
	});

	test('D1 — première vente via RPC idempotent', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);
		setCreateSaleImplForTests(async () => { throw new Error('legacy sale must not run'); });
		setConfirmAndCreateSaleImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
			result_id: 'sale-d1',
			product: 'poulets',
			quantity: 2,
			unitPrice: 10,
			amountPaid: 20,
			total: 20,
			stockRemaining: 8,
			stockThreshold: 5,
		}));

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				topic: 'sales',
				intent: 'create_sale',
				pendingWrite: SALE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-d1',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });
		assert.equal(result.toolResults[0]?.summary?.saleId, 'sale-d1');
		assert.equal(getConversationState(USER_A.id, SESSION, USER_A.activeActivityId).pendingWrite, null);
	});

	test('D2 — replay vente ALREADY_COMPLETED', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);
		setConfirmAndCreateSaleImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.ALREADY_COMPLETED,
			result_id: 'sale-d2',
			product: 'poulets',
			quantity: 2,
			unitPrice: 10,
			amountPaid: 20,
			total: 20,
			stockRemaining: 8,
			stockThreshold: 5,
		}));

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				topic: 'sales',
				intent: 'create_sale',
				pendingWrite: SALE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-d2',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });
		assert.equal(result.toolResults[0]?.success, true);
		assert.equal(result.toolResults[0]?.summary?.saleId, 'sale-d2');
		assert.equal(getIdempotentReplayMetricsForTests().idempotent_replay_success, 1);
	});

	test('D3 — hash mismatch vente rejeté', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);
		setConfirmAndCreateSaleImplForTests(async () => ({
			success: false,
			status: TRANSACTIONAL_CONFIRM_STATUS.REQUEST_HASH_MISMATCH,
		}));

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				topic: 'sales',
				intent: 'create_sale',
				pendingWrite: SALE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-d3',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });
		assert.match(result.reply, /ne correspond pas/i);
		assert.equal(getConversationState(USER_A.id, SESSION, USER_A.activeActivityId).pendingWrite?.product, 'poulets');
	});

	test('D4 — première dépense COMMITTED', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);
		setCreateExpenseImplForTests(async () => { throw new Error('legacy expense must not run'); });
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
			result_id: 'exp-d4',
			label: 'loyer',
			amount: 1200,
		}));

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-d4',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });
		assert.equal(result.toolResults[0]?.summary?.expenseId, 'exp-d4');
	});

	test('D5 — replay dépense ALREADY_COMPLETED', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.ALREADY_COMPLETED,
			result_id: 'exp-d5',
			label: 'loyer',
			amount: 1200,
		}));

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-d5',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });
		assert.equal(result.toolResults[0]?.summary?.expenseId, 'exp-d5');
		assert.equal(getIdempotentReplayMetricsForTests().idempotent_replay_success, 1);
	});

	test('D6 — hash mismatch dépense rejeté', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: false,
			status: TRANSACTIONAL_CONFIRM_STATUS.REQUEST_HASH_MISMATCH,
		}));

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-d6',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });
		assert.match(result.reply, /ne correspond pas/i);
	});

	test('D7/D8 — timeout post-commit puis retry replay', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);
		let calls = 0;
		setConfirmAndCreateExpenseImplForTests(async () => {
			calls += 1;
			if (calls === 1) {
				return {
					success: true,
					status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
					result_id: 'exp-timeout',
					label: 'loyer',
					amount: 1200,
				};
			}
			return {
				success: true,
				status: TRANSACTIONAL_CONFIRM_STATUS.ALREADY_COMPLETED,
				result_id: 'exp-timeout',
				label: 'loyer',
				amount: 1200,
			};
		});

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-d7',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const first = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });
		assert.equal(first.toolResults[0]?.summary?.expenseId, 'exp-timeout');

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-d7',
			}),
		});

		const retry = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });
		assert.equal(retry.toolResults[0]?.summary?.expenseId, 'exp-timeout');
		assert.equal(calls, 2);
		assert.equal(getIdempotentReplayMetricsForTests().idempotent_replay_success, 1);
	});

	test('D9 — processing géré par SQL (Node ne regénère pas operation_id)', () => {
		const params = buildIdempotentRpcParams(USER_A, {
			pendingOperationId: OPERATION_ID,
		}, EXPENSE_PENDING);
		assert.equal(params.ready, true);
		assert.equal(params.operationId, OPERATION_ID);
		assert.equal(params.requestHash, computeRequestHash(CLIENT_A, EXPENSE_PENDING));
	});

	test('D10 — concurrence même operation_id (mock)', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);
		let rpcCalls = 0;
		setConfirmAndCreateExpenseImplForTests(async () => {
			rpcCalls += 1;
			await new Promise((r) => setTimeout(r, 15));
			return {
				success: true,
				status: rpcCalls === 1
					? TRANSACTIONAL_CONFIRM_STATUS.COMMITTED
					: TRANSACTIONAL_CONFIRM_STATUS.ALREADY_COMPLETED,
				result_id: 'exp-conc',
				label: 'loyer',
				amount: 1200,
			};
		});

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-d10',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const [a, b] = await Promise.all([
			agent.run({ message: 'oui', user: USER_A, sessionId: SESSION }),
			agent.run({ message: 'oui', user: USER_A, sessionId: SESSION }),
		]);
		const ids = [a, b].map((r) => r.toolResults[0]?.summary?.expenseId).filter(Boolean);
		assert.ok(ids.length >= 1);
		assert.ok(ids.every((id) => id === 'exp-conc'));
	});

	test('D11 — isolation cross-tenant', async () => {
		const storeA = { draft: null, pending: null };
		const storeB = { draft: null, pending: null };
		const sharedOp = randomUUID();
		const captured = [];

		setMirrorSessionsAtomicImplForTests(async (scope, params) => {
			const store = scope.clientId === CLIENT_A ? storeA : storeB;
			if (params.pendingPayload) store.pending = { stateVersion: 2, payload: params.pendingPayload };
			return { draftVersion: 1, pendingVersion: 2, pendingCleared: 0 };
		});

		setConfirmAndCreateExpenseImplForTests(async (scope, rpcParams) => {
			captured.push({ clientId: scope.clientId, operationId: rpcParams.operationId });
			return {
				success: true,
				status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
				result_id: `exp-${clientId.slice(0, 8)}`,
				label: 'loyer',
				amount: 1200,
			};
		});

		setGetSessionsPairImplForTests(async () => ({ draft: storeA.draft, pending: storeA.pending }));
		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: sharedOp,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-a',
			}),
			requirePendingDb: true,
		});
		await createAshyAgent().run({ message: 'oui', user: USER_A, sessionId: SESSION });

		setGetSessionsPairImplForTests(async () => ({ draft: storeB.draft, pending: storeB.pending }));
		await persistConversationState({
			user: USER_B,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: sharedOp,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-b',
			}),
			requirePendingDb: true,
		});
		await createAshyAgent().run({ message: 'oui', user: USER_B, sessionId: SESSION });

		assert.equal(captured.length, 2);
		assert.equal(captured[0].operationId, sharedOp);
		assert.equal(captured[1].operationId, sharedOp);
		assert.notEqual(captured[0].clientId, captured[1].clientId);
	});

	test('D12 — operation_id persistant dans pending DB', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: OPERATION_ID,
			}),
			requirePendingDb: false,
		});

		assert.equal(store.pending?.payload?.operationId, OPERATION_ID);
		assert.equal(getConversationState(USER_A.id, SESSION, USER_A.activeActivityId).pendingOperationId, OPERATION_ID);
	});

	test('D13 — result_id replay correct', () => {
		const outcome = resolveTransactionalToolOutcome({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.ALREADY_COMPLETED,
			result_id: 'exp-replay-id',
			label: 'loyer',
			amount: 1200,
			operation: 'create_expense',
		}, EXPENSE_PENDING);
		assert.equal(outcome.success, true);
		assert.equal(outcome.replay, true);
		assert.equal(outcome.toolResult?.data?.summary?.expenseId, 'exp-replay-id');
	});

	test('D14 — replay ne déclenche pas seconde écriture legacy', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);
		setCreateExpenseImplForTests(async () => { throw new Error('double write'); });
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.ALREADY_COMPLETED,
			result_id: 'exp-no-double',
			label: 'loyer',
			amount: 1200,
		}));

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-d14',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });
		assert.equal(result.toolResults[0]?.success, true);
	});

	test('D15 — client_id scope serveur + pas de mint operation_id au confirm', async () => {
		const params = buildIdempotentRpcParams(USER_A, { pendingOperationId: null }, EXPENSE_PENDING);
		assert.equal(params.ready, false);
		assert.equal(params.errorCode, IDEMPOTENT_REPLAY_ERROR.OPERATION_ID_MISSING);

		const store = { draft: null, pending: null };
		wireDbStore(store);
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
			result_id: 'exp-scope',
			label: 'loyer',
			amount: 1200,
		}));

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-d15',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });
		assert.match(result.reply, /identifiant sécurisé/i);
		assert.equal(getIdempotentReplayMetricsForTests().idempotent_replay_blocked, 1);
	});
});
