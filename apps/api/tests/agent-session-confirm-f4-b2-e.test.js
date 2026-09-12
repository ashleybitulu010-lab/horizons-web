/**
 * Phase 5.8-F4-B2-E — Final hardening + adversarial tests (unit).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, before, describe, test } from 'node:test';

import {
	clearConversationState,
	clearConversationSessionsForTests,
	getConversationState,
	mergeConversationState,
	persistConversationState,
} from '../src/agent/conversation-state.js';
import { resetConversationStoreForTests } from '../src/agent/conversation-store.js';
import {
	createAshyAgent,
	TRANSACTIONAL_FALLBACK_BLOCKED_REPLY,
} from '../src/agent/index.js';
import { setForceRegexResolverForTests } from '../src/agent/intent-resolver/index.js';
import { computeRequestHash } from '../src/lib/agent-operation-idempotency.js';
import {
	buildIdempotentRpcParams,
	IDEMPOTENT_REPLAY_ERROR,
	resolveTransactionalToolOutcome,
} from '../src/services/agent-idempotent-replay-service.js';
import {
	getAgentSessionState,
	mapSessionToAgentState,
	resetAgentSessionReaderForTests,
} from '../src/services/agent-session-reader.js';
import {
	resetAgentSessionServiceImplForTests,
	setGetSessionsPairImplForTests,
	setMirrorSessionsAtomicImplForTests,
} from '../src/services/agent-session-service.js';
import {
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
import { assertNoIdentityParams } from '../src/tools/validation.js';

const CLIENT_A = '22222222-2222-4222-8222-222222222222';
const CLIENT_B = '33333333-3333-4333-8333-333333333333';
const ACTIVITY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const ACTIVITY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';
const USER_A = { id: 'pb-b2e-a', clientId: CLIENT_A, activeActivityId: ACTIVITY_A, businessUserId: 'rec-b2e-a' };
const USER_B = { id: 'pb-b2e-b', clientId: CLIENT_B, activeActivityId: ACTIVITY_B, businessUserId: 'rec-b2e-b' };
const SESSION = 'sess-b2e';
const OPERATION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EXPENSE_PENDING = { tool: 'create_expense', label: 'loyer', amount: 900 };
const SALE_PENDING = {
	tool: 'create_sale',
	product: 'poulets',
	quantity: 1,
	unitPrice: 10,
	amountPaid: 10,
};

function baseState(overrides = {}) {
	return {
		topic: 'expenses',
		intent: 'create_expense',
		filters: {},
		references: {
			lastPeriod: null,
			previousPeriod: null,
			lastProduct: null,
			lastEntity: null,
		},
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

describe('Phase 5.8-F4-B2-E — hardening + security (unit)', () => {
	before(() => {
		process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
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
		resetCreateSaleImplForTests();
		clearConversationSessionsForTests();
		resetConversationStoreForTests();
		setIsSupabaseConfiguredForTests(true);
		setIsTransactionalConfirmEnabledForTests(true);
		setIsIdempotentConfirmEnabledForTests(true);
	});

	test('E-legacy-1 — legacy bypass guard message defined', () => {
		assert.match(TRANSACTIONAL_FALLBACK_BLOCKED_REPLY, /canal sécurisé/i);
	});

	test('E-sec-1 — clientId in tool input rejected', () => {
		assert.throws(
			() => assertNoIdentityParams({ clientId: CLIENT_B, label: 'x', amount: 1 }, 'create_expense'),
			(err) => err?.code === 'FORBIDDEN_PARAMETER',
		);
	});

	test('E-sec-2 — hash mismatch preserves pending', async () => {
		const store = { pending: null };
		setMirrorSessionsAtomicImplForTests(async (_c, p) => {
			if (p.pendingPayload) store.pending = p.pendingPayload;
			return { draftVersion: 1, pendingVersion: 2, pendingCleared: 0 };
		});
		setGetSessionsPairImplForTests(async () => ({ draft: null, pending: store.pending ? {
			stateVersion: 2,
			payload: store.pending,
			awaiting: 'confirm',
		} : null }));
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
				pendingConsumeToken: 'tok-hash',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });
		const stored = getConversationState(USER_A.id, SESSION, USER_A.activeActivityId);
		assert.equal(stored.pendingWrite?.label, 'loyer');
		assert.equal(stored.pendingOperationId, OPERATION_ID);
	});

	test('E-sec-3 — missing operation_id preserves pending', async () => {
		setConfirmAndCreateExpenseImplForTests(async () => {
			throw new Error('RPC must not run without operation_id');
		});

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-missing-op',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });
		const stored = getConversationState(USER_A.id, SESSION, USER_A.activeActivityId);
		assert.equal(stored.pendingWrite?.amount, 900);
	});

	test('E-sec-4 — buildIdempotentRpcParams rejects missing operation_id', () => {
		const params = buildIdempotentRpcParams(USER_A, { pendingOperationId: null }, EXPENSE_PENDING);
		assert.equal(params.ready, false);
		assert.equal(params.errorCode, IDEMPOTENT_REPLAY_ERROR.OPERATION_ID_MISSING);
	});

	test('E-sec-5 — cross-tenant hash isolation', () => {
		const hashA = computeRequestHash(CLIENT_A, EXPENSE_PENDING);
		const hashB = computeRequestHash(CLIENT_B, EXPENSE_PENDING);
		assert.notEqual(hashA, hashB);
	});

	test('E-sec-6 — replay returns same result_id for sale', () => {
		const outcome = resolveTransactionalToolOutcome({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.ALREADY_COMPLETED,
			result_id: 'sale-replay-e',
			product: 'poulets',
			quantity: 1,
			unitPrice: 10,
			amountPaid: 10,
			total: 10,
			stockRemaining: 5,
			stockThreshold: 5,
			operation: 'create_sale',
		}, SALE_PENDING);
		assert.equal(outcome.toolResult?.data?.summary?.saleId, 'sale-replay-e');
		assert.equal(outcome.replay, true);
	});

	test('E-sec-7 — concurrent confirmations same operation_id (mock)', async () => {
		let rpcCalls = 0;
		setConfirmAndCreateExpenseImplForTests(async () => {
			rpcCalls += 1;
			return {
				success: true,
				status: rpcCalls === 1
					? TRANSACTIONAL_CONFIRM_STATUS.COMMITTED
					: TRANSACTIONAL_CONFIRM_STATUS.ALREADY_COMPLETED,
				result_id: 'exp-conc-e',
				label: 'loyer',
				amount: 900,
			};
		});

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: EXPENSE_PENDING,
				pendingOperationId: OPERATION_ID,
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-conc',
			}),
		});

		const agent = createAshyAgent();
		const [a, b] = await Promise.all([
			agent.run({ message: 'oui', user: USER_A, sessionId: SESSION }),
			agent.run({ message: 'oui', user: USER_A, sessionId: SESSION }),
		]);
		const ids = [a, b].flatMap((r) => r.toolResults.map((t) => t.summary?.expenseId)).filter(Boolean);
		assert.ok(ids.length >= 1);
		assert.ok(ids.every((id) => id === 'exp-conc-e'));
		assert.ok(rpcCalls >= 1);
	});

	test('E-sec-8 — DB pending restores operation_id after RAM clear', async () => {
		const dbPending = {
			payload: {
				pendingWrite: EXPENSE_PENDING,
				consumeToken: 'tok-db',
				operationId: OPERATION_ID,
			},
			stateVersion: 3,
			awaiting: 'confirm',
		};

		setGetSessionsPairImplForTests(async () => ({
			draft: { payload: {}, stateVersion: 1 },
			pending: dbPending,
		}));

		clearConversationState(USER_A.id, SESSION);

		const { state } = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(state.pendingOperationId, OPERATION_ID);
		assert.equal(state.pendingWrite?.label, 'loyer');

		const mapped = mapSessionToAgentState(
			{ payload: {} },
			dbPending,
		);
		assert.equal(mapped.pendingOperationId, OPERATION_ID);
	});

	test('E-sec-9 — single operation_id mint point (mergeConversationState only)', () => {
		const first = mergeConversationState(baseState(), { pendingWrite: EXPENSE_PENDING });
		assert.ok(first.pendingOperationId);

		const second = mergeConversationState(first, { pendingWrite: EXPENSE_PENDING });
		assert.equal(second.pendingOperationId, first.pendingOperationId);
	});

	test('E-sec-10 — replay cross-tenant independent (params)', () => {
		const sharedOp = randomUUID();
		const paramsA = buildIdempotentRpcParams(USER_A, { pendingOperationId: sharedOp }, EXPENSE_PENDING);
		const paramsB = buildIdempotentRpcParams(USER_B, { pendingOperationId: sharedOp }, EXPENSE_PENDING);
		assert.equal(paramsA.operationId, sharedOp);
		assert.equal(paramsB.operationId, sharedOp);
		assert.notEqual(paramsA.requestHash, paramsB.requestHash);
	});
});
