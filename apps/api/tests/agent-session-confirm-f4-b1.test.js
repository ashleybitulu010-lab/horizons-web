/**
 * Phase 5.8-F4-B1 — Transactional confirm + business write (unit).
 */
import assert from 'node:assert/strict';
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
	resetAgentSessionReaderForTests,
} from '../src/services/agent-session-reader.js';
import {
	resetAgentSessionServiceImplForTests,
	setConsumeAgentPendingImplForTests,
	setGetSessionsPairImplForTests,
	setMirrorSessionsAtomicImplForTests,
	CONSUME_PENDING_STATUS,
} from '../src/services/agent-session-service.js';
import {
	getTransactionalWriteMetricsForTests,
	resetAgentTransactionalWriteForTests,
	setConfirmAndCreateExpenseImplForTests,
	setConfirmAndCreateSaleImplForTests,
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
const USER_A = { id: 'pb-f4b1-a', clientId: CLIENT_A, activeActivityId: ACTIVITY_A, businessUserId: 'rec-f4b1-a' };
const USER_B = { id: 'pb-f4b1-b', clientId: CLIENT_B, activeActivityId: ACTIVITY_B, businessUserId: 'rec-f4b1-b' };
const SESSION = 'sess-f4b1';

const originalTransactional = process.env.AGENT_SESSION_TRANSACTIONAL_CONFIRM;

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
		...overrides,
	};
}

function draftRow(payload, version = 1) {
	return {
		id: 'draft-f4',
		clientId: CLIENT_A,
		stateType: 'draft',
		payload,
		intention: null,
		awaiting: null,
		stateVersion: version,
		updatedAt: '2026-09-08T00:00:00.000Z',
	};
}

function pendingRow(pendingPayload, extras = {}) {
	return {
		id: 'pending-f4',
		clientId: extras.clientId ?? CLIENT_A,
		stateType: 'pending',
		payload: pendingPayload,
		intention: pendingPayload.pendingWrite?.tool ?? 'create_expense',
		awaiting: 'confirm',
		stateVersion: extras.stateVersion ?? 2,
		updatedAt: '2026-09-08T01:00:00.000Z',
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

describe('Phase 5.8-F4-B1 — transactional confirmation (unit)', () => {
	before(() => {
		process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
		process.env.AGENT_SESSION_TRANSACTIONAL_CONFIRM = 'true';
		setForceRegexResolverForTests(true);
		setIsSupabaseConfiguredForTests(true);
		setIsTransactionalConfirmEnabledForTests(true);
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
	});

	test('F4-B1-1 — expense success via transactional RPC (no legacy consume)', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);

		setCreateExpenseImplForTests(async () => {
			throw new Error('executeTool create_expense must not run when transactional succeeds');
		});

		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
			operation: 'create_expense',
			result_id: 'exp-f4b1-1',
			pending_consumed: true,
			label: 'transport',
			amount: 500,
		}));

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: { tool: 'create_expense', label: 'transport', amount: 500 },
				pendingSessionVersion: store.pending?.stateVersion ?? 2,
				pendingConsumeToken: 'tok-f4b1',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });

		assert.equal(result.toolResults[0]?.success, true);
		assert.equal(result.toolResults[0]?.summary?.expenseId, 'exp-f4b1-1');
		const stored = getConversationState(USER_A.id, SESSION, USER_A.activeActivityId);
		assert.equal(stored.pendingWrite, null);
		assert.equal(getTransactionalWriteMetricsForTests().transactional_write_success, 1);
	});

	test('F4-B1-2 — expense rollback preserves pending', async () => {
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
				pendingWrite: { tool: 'create_expense', label: 'transport', amount: 500 },
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-f4b1',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });

		assert.equal(result.toolResults[0]?.success, false);
		const stored = getConversationState(USER_A.id, SESSION, USER_A.activeActivityId);
		assert.equal(stored.pendingWrite?.label, 'transport');
		assert.equal(stored.pendingConsumeToken, 'tok-f4b1');
		assert.equal(getTransactionalWriteMetricsForTests().transactional_write_rollback, 1);
	});

	test('F4-B1-3 — concurrent conflict ALREADY_CONSUMED', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);

		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: false,
			status: TRANSACTIONAL_CONFIRM_STATUS.ALREADY_CONSUMED,
			pending_consumed: false,
		}));

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: { tool: 'create_expense', label: 'transport', amount: 500 },
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-f4b1',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });

		assert.match(result.reply, /déjà été enregistrée/i);
		assert.equal(getTransactionalWriteMetricsForTests().transactional_write_conflict, 1);
	});

	test('F4-B1-4 — VERSION_MISMATCH conflict', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);

		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: false,
			status: TRANSACTIONAL_CONFIRM_STATUS.VERSION_MISMATCH,
			pending_consumed: false,
		}));

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: { tool: 'create_expense', label: 'transport', amount: 500 },
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-f4b1',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });

		assert.match(result.reply, /autre confirmation/i);
		assert.equal(getTransactionalWriteMetricsForTests().transactional_write_conflict, 1);
	});

	test('F4-B1-5 — sale success via transactional RPC', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);

		setConfirmAndCreateSaleImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
			operation: 'create_sale',
			result_id: 'sale-f4b1',
			pending_consumed: true,
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
				pendingWrite: {
					tool: 'create_sale',
					product: 'poulets',
					quantity: 2,
					unitPrice: 10,
					amountPaid: 20,
				},
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-f4b1-sale',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });

		assert.equal(result.toolResults[0]?.success, true);
		assert.equal(result.toolResults[0]?.summary?.saleId, 'sale-f4b1');
	});

	test('F4-B1-6 — sale rollback preserves pending', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);

		setConfirmAndCreateSaleImplForTests(async () => {
			const err = new Error('stock insuffisant pour vente poulets (1 < 2)');
			err.code = 'INSUFFICIENT_STOCK';
			err.available = 1;
			err.requested = 2;
			throw err;
		});

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				topic: 'sales',
				intent: 'create_sale',
				pendingWrite: {
					tool: 'create_sale',
					product: 'poulets',
					quantity: 2,
					unitPrice: 10,
					amountPaid: 20,
				},
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-f4b1-sale',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });

		assert.equal(result.toolResults[0]?.success, false);
		assert.equal(result.toolResults[0]?.error?.code, 'INSUFFICIENT_STOCK');
		const stored = getConversationState(USER_A.id, SESSION, USER_A.activeActivityId);
		assert.equal(stored.pendingWrite?.product, 'poulets');
	});

	test('F4-B1-7 — legacy path when flag disabled', async () => {
		setIsTransactionalConfirmEnabledForTests(false);

		setConsumeAgentPendingImplForTests(async () => ({
			status: CONSUME_PENDING_STATUS.CONSUMED,
		}));

		let expenseCalls = 0;
		setCreateExpenseImplForTests(async () => {
			expenseCalls += 1;
			return { expenseId: 'exp-legacy', label: 'transport', amount: 500 };
		});

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: { tool: 'create_expense', label: 'transport', amount: 500 },
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-f4b1',
			}),
		});

		const agent = createAshyAgent();
		const result = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });

		assert.equal(result.toolResults[0]?.success, true);
		assert.equal(expenseCalls, 1);
	});

	test('F4-B1-8 — tenant isolation uses user clientId only', async () => {
		const store = { draft: null, pending: null };
		wireDbStore(store);

		let seenClientId = null;
		setConfirmAndCreateExpenseImplForTests(async (scope) => {
			seenClientId = scope.clientId;
			return {
				success: true,
				status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
				result_id: 'exp-tenant',
				pending_consumed: true,
				label: 'loyer',
				amount: 100,
			};
		});

		await persistConversationState({
			user: USER_B,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: { tool: 'create_expense', label: 'loyer', amount: 100 },
				pendingSessionVersion: 2,
				pendingConsumeToken: 'tok-b',
			}),
			requirePendingDb: true,
		});

		const agent = createAshyAgent();
		await agent.run({ message: 'oui', user: USER_B, sessionId: SESSION });

		assert.equal(seenClientId, CLIENT_B);
		assert.notEqual(seenClientId, CLIENT_A);
	});
});

describe('Phase 5.8-F4-B1 — env cleanup', () => {
	test('restore transactional env', () => {
		if (originalTransactional === undefined) {
			delete process.env.AGENT_SESSION_TRANSACTIONAL_CONFIRM;
		} else {
			process.env.AGENT_SESSION_TRANSACTIONAL_CONFIRM = originalTransactional;
		}
	});
});
