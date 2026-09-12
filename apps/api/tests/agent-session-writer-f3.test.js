import assert from 'node:assert/strict';
import { afterEach, before, describe, test } from 'node:test';

import {
	clearConversationSessionsForTests,
	getConversationState,
	persistConversationState,
} from '../src/agent/conversation-state.js';
import { setConversationStore, resetConversationStoreForTests } from '../src/agent/conversation-store.js';
import {
	createAshyAgent,
	PENDING_PERSISTENCE_FAILED_REPLY,
} from '../src/agent/index.js';
import { setForceRegexResolverForTests } from '../src/agent/intent-resolver/index.js';
import {
	getAgentSessionState,
	resetAgentSessionReaderForTests,
} from '../src/services/agent-session-reader.js';
import {
	AgentSessionServiceError,
	CONSUME_PENDING_STATUS,
	resetAgentSessionServiceImplForTests,
	setConsumeAgentPendingImplForTests,
	setGetSessionsPairImplForTests,
	setMirrorSessionsAtomicImplForTests,
} from '../src/services/agent-session-service.js';
import {
	compareDbStateToIntent,
	getAgentSessionWriteMetricsForTests,
	resetAgentSessionWriterForTests,
	setIsPendingDbRequiredForTests,
	setIsRamFallbackEnabledForTests,
	setIsSupabaseConfiguredForTests,
	setIsWriteDbFirstForTests,
	WRITE_OUTCOMES,
} from '../src/services/agent-session-writer.js';
import {
	resetCreateExpenseImplForTests,
	setCreateExpenseImplForTests,
} from '../src/services/expenses-write-service.js';

const CLIENT_A = '11111111-1111-4111-8111-111111111111';
const ACTIVITY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';

const USER_A = {
	id: 'pb-user-f3',
	clientId: CLIENT_A,
	activeActivityId: ACTIVITY_A,
	businessUserId: 'rec-user-f3',
};
const SESSION = 'sess-f3';

const EXPENSE_MSG = "J'ai dépensé 500 $ pour le transport";

const originalWriteDbFirst = process.env.AGENT_SESSION_WRITE_DB_FIRST;
const originalRamFallback = process.env.AGENT_SESSION_RAM_FALLBACK;
const originalPendingDbRequired = process.env.AGENT_SESSION_PENDING_DB_REQUIRED;
const originalMirrorAwait = process.env.AGENT_SESSION_MIRROR_AWAIT;
const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
		id: 'draft-f3',
		clientId: CLIENT_A,
		stateType: 'draft',
		payload,
		intention: null,
		awaiting: null,
		stateVersion: version,
		updatedAt: '2026-09-08T00:00:00.000Z',
	};
}

function pendingRow(pendingWrite, extras = {}) {
	return {
		id: 'pending-f3',
		clientId: CLIENT_A,
		stateType: 'pending',
		payload: {
			pendingWrite,
			consumeToken: extras.consumeToken ?? 'tok-f3',
		},
		intention: 'create_expense',
		awaiting: 'confirm',
		stateVersion: extras.stateVersion ?? 2,
		updatedAt: '2026-09-08T01:00:00.000Z',
	};
}

function wireDbStore(store, { mirrorFail = false, mirrorErrorCode = 'MIRROR_ATOMIC_FAILED' } = {}) {
	const callOrder = [];
	setMirrorSessionsAtomicImplForTests(async (_clientId, params) => {
		callOrder.push('mirror');
		if (mirrorFail) {
			throw new AgentSessionServiceError(mirrorErrorCode, 'Unable to mirror agent sessions atomically');
		}
		store.draft = draftRow(params.draftPayload, (store.draft?.stateVersion ?? 0) + 1);
		if (params.pendingPayload) {
			store.pending = pendingRow(
				params.pendingPayload.pendingWrite,
				{
					consumeToken: params.pendingPayload.consumeToken,
					stateVersion: (store.pending?.stateVersion ?? 0) + 1,
				},
			);
		} else if (params.clearPendingVersion != null) {
			if (store.pending?.stateVersion === params.clearPendingVersion) {
				store.pending = null;
			}
		} else {
			store.pending = null;
		}
		return {
			draftVersion: store.draft.stateVersion,
			pendingVersion: store.pending?.stateVersion ?? null,
			pendingCleared: params.pendingPayload ? 0 : 1,
		};
	});
	setGetSessionsPairImplForTests(async () => ({
		draft: store.draft,
		pending: store.pending,
	}));
	return callOrder;
}

before(() => {
	process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
	setIsSupabaseConfiguredForTests(true);
	setForceRegexResolverForTests(true);
});

afterEach(() => {
	process.env.AGENT_SESSION_WRITE_DB_FIRST = originalWriteDbFirst;
	process.env.AGENT_SESSION_RAM_FALLBACK = originalRamFallback;
	process.env.AGENT_SESSION_PENDING_DB_REQUIRED = originalPendingDbRequired;
	process.env.AGENT_SESSION_MIRROR_AWAIT = originalMirrorAwait;
	setIsWriteDbFirstForTests(null);
	setIsRamFallbackEnabledForTests(null);
	setIsPendingDbRequiredForTests(null);
	resetAgentSessionWriterForTests();
	resetAgentSessionServiceImplForTests();
	resetAgentSessionReaderForTests();
	resetCreateExpenseImplForTests();
	clearConversationSessionsForTests();
	resetConversationStoreForTests();
});

describe('Phase 5.8-F3 — DB-first writer', () => {
	test('F3-1 — DB success → RAM cache', async () => {
		setIsWriteDbFirstForTests(true);
		setIsPendingDbRequiredForTests(true);
		const store = { draft: null, pending: null };
		wireDbStore(store);

		const state = baseState({
			pendingWrite: { tool: 'create_expense', label: 'transport', amount: 500 },
			pendingConsumeToken: 'tok-f3-1',
		});

		const result = await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state,
			requirePendingDb: true,
		});

		assert.equal(result.ok, true);
		assert.equal(result.dbSuccess, true);
		assert.equal(result.outcome, WRITE_OUTCOMES.SUCCESS);
		assert.ok(store.pending);
		assert.equal(getConversationState(USER_A.id, SESSION, USER_A.activeActivityId).pendingWrite?.label, 'transport');
		assert.equal(getAgentSessionWriteMetricsForTests().writer_db_success, 1);
		assert.equal(getAgentSessionWriteMetricsForTests().writer_ram_cache_success, 1);
	});

	test('F3-2 — DB failure + CAT 2 + RAM fallback → succès contrôlé', async () => {
		setIsWriteDbFirstForTests(true);
		setIsRamFallbackEnabledForTests(true);
		const store = { draft: null, pending: null };
		wireDbStore(store, { mirrorFail: true });

		const state = baseState({ topic: 'expenses', intent: 'unknown', filters: { label: 'x' } });
		const result = await persistConversationState({ user: USER_A, sessionId: SESSION, state });

		assert.equal(result.ok, true);
		assert.equal(result.ramFallback, true);
		assert.equal(result.outcome, WRITE_OUTCOMES.RAM_FALLBACK);
		assert.equal(getConversationState(USER_A.id, SESSION, USER_A.activeActivityId).topic, 'expenses');
		assert.equal(getAgentSessionWriteMetricsForTests().writer_db_primary_fallback, 1);
	});

	test('F3-3 — DB failure + pending → fail-closed', async () => {
		setIsWriteDbFirstForTests(true);
		setIsPendingDbRequiredForTests(true);
		const store = { draft: null, pending: null };
		wireDbStore(store, { mirrorFail: true });

		const state = baseState({
			pendingWrite: { tool: 'create_expense', label: 'transport', amount: 500 },
			pendingConsumeToken: 'tok-f3-3',
		});

		const result = await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state,
			requirePendingDb: true,
		});

		assert.equal(result.blockedConfirmation, true);
		assert.equal(result.outcome, WRITE_OUTCOMES.BLOCKED_CONFIRMATION);
		assert.equal(store.pending, null);
	});

	test('F3-4 — DB success + RAM cache throw → opération succès', async () => {
		setIsWriteDbFirstForTests(true);
		const store = { draft: null, pending: null };
		wireDbStore(store);

		setConversationStore({
			getConversationState: () => null,
			saveConversationState: () => {
				throw new Error('RAM_CACHE_FAILED');
			},
			clearConversationState: () => {},
			clearAllForTests: () => {},
		});

		const state = baseState({ topic: 'sales', intent: 'query_sales' });
		const result = await persistConversationState({ user: USER_A, sessionId: SESSION, state });

		assert.equal(result.ok, true);
		assert.equal(result.dbSuccess, true);
		assert.equal(getAgentSessionWriteMetricsForTests().writer_ram_cache_failure, 1);
		assert.ok(store.draft);
	});

	test('F3-5 — DB timeout + read-back confirme état → succès', async () => {
		setIsWriteDbFirstForTests(true);
		const pw = { tool: 'create_expense', label: 'transport', amount: 500 };
		const store = {
			draft: draftRow({ topic: 'expenses', intent: 'create_expense', filters: {}, references: emptyReferences() }),
			pending: pendingRow(pw, { consumeToken: 'tok-readback', stateVersion: 3 }),
		};
		wireDbStore(store, { mirrorFail: true });

		const state = baseState({
			pendingWrite: pw,
			pendingConsumeToken: 'tok-readback',
		});

		const result = await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state,
			requirePendingDb: true,
		});

		assert.equal(result.ok, true);
		assert.equal(result.dbSuccess, true);
	});

	test('F3-6 — DB timeout + read-back absent → DB failure', async () => {
		setIsWriteDbFirstForTests(true);
		setIsRamFallbackEnabledForTests(false);
		const store = { draft: null, pending: null };
		wireDbStore(store, { mirrorFail: true });

		const state = baseState({ topic: 'debts', intent: 'query_debts' });
		const result = await persistConversationState({ user: USER_A, sessionId: SESSION, state });

		assert.equal(result.ok, false);
		assert.equal(result.outcome, WRITE_OUTCOMES.DB_FAILURE);
	});

	test('F3-7 — DB timeout + read-back divergence → pas overwrite', async () => {
		setIsWriteDbFirstForTests(true);
		const store = {
			draft: draftRow({ topic: 'expenses', intent: 'create_expense', filters: {}, references: emptyReferences() }),
			pending: pendingRow({ tool: 'create_expense', label: 'OTHER', amount: 999 }, { stateVersion: 5 }),
		};
		wireDbStore(store, { mirrorFail: true });

		const readBack = await compareDbStateToIntent({
			user: USER_A,
			state: baseState({
				pendingWrite: { tool: 'create_expense', label: 'transport', amount: 500 },
				pendingConsumeToken: 'tok-x',
			}),
		});
		assert.equal(readBack.status, 'diverged');

		const result = await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: { tool: 'create_expense', label: 'transport', amount: 500 },
				pendingConsumeToken: 'tok-x',
			}),
			requirePendingDb: true,
		});
		assert.equal(result.blockedConfirmation, true);
		assert.equal(store.pending.payload.pendingWrite.label, 'OTHER');
	});

	test('F3-8 — DB-first + pending DB required → NEEDS_CONFIRMATION sécurisé', async () => {
		setIsWriteDbFirstForTests(true);
		setIsPendingDbRequiredForTests(true);
		const store = { draft: null, pending: null };
		wireDbStore(store);

		const agent = createAshyAgent();
		const result = await agent.run({
			message: EXPENSE_MSG,
			user: USER_A,
			sessionId: SESSION,
		});

		assert.equal(result.toolResults[0]?.error?.code, 'NEEDS_CONFIRMATION');
		assert.notEqual(result.reply, PENDING_PERSISTENCE_FAILED_REPLY);
		assert.ok(store.pending);
	});

	test('F3-9 — DB-first + clarification', async () => {
		setIsWriteDbFirstForTests(true);
		const store = { draft: null, pending: null };
		wireDbStore(store);

		const agent = createAshyAgent();
		const result = await agent.run({
			message: "j'ai dépensé pour le transport",
			user: USER_A,
			sessionId: SESSION,
		});

		assert.match(result.reply, /montant/i);
		assert.ok(store.draft);
	});

	test('F3-10 — DB-first + tool error state', async () => {
		setIsWriteDbFirstForTests(true);
		const store = { draft: null, pending: null };
		wireDbStore(store);

		const state = baseState({
			lastTool: 'get_stock',
			lastAction: 'query_stock',
			topic: 'stock',
		});
		const result = await persistConversationState({ user: USER_A, sessionId: SESSION, state });

		assert.equal(result.ok, true);
		assert.equal(result.dbSuccess, true);
		assert.ok(store.draft);
	});

	test('F3-11 — DB-first + post-business-write state', async () => {
		setIsWriteDbFirstForTests(true);
		setIsPendingDbRequiredForTests(true);
		const store = { draft: null, pending: null };
		wireDbStore(store);
		setConsumeAgentPendingImplForTests(async () => ({
			status: CONSUME_PENDING_STATUS.CONSUMED,
		}));
		setCreateExpenseImplForTests(async () => ({
			expenseId: 'exp-f3',
			label: 'transport',
			amount: 500,
		}));

		const agent = createAshyAgent();
		await agent.run({ message: EXPENSE_MSG, user: USER_A, sessionId: SESSION });
		const confirm = await agent.run({ message: 'oui', user: USER_A, sessionId: SESSION });

		assert.equal(confirm.toolResults[0]?.success, true);
		assert.equal(store.pending, null);
		assert.ok(store.draft);
	});

	test('F3-12 — WRITE_DB_FIRST=false → legacy inchangé', async () => {
		setIsWriteDbFirstForTests(false);
		const store = { draft: null, pending: null };
		const callOrder = wireDbStore(store);

		const state = baseState({ topic: 'sales' });
		await persistConversationState({ user: USER_A, sessionId: SESSION, state });

		assert.equal(getConversationState(USER_A.id, SESSION, USER_A.activeActivityId).topic, 'sales');
		assert.equal(getAgentSessionWriteMetricsForTests().writer_db_primary, 0);
	});

	test('F3-13 — P0 consume concurrency inchangé', async () => {
		setIsWriteDbFirstForTests(true);
		setIsPendingDbRequiredForTests(true);
		const store = { draft: null, pending: null };
		wireDbStore(store);

		let consumeCount = 0;
		setConsumeAgentPendingImplForTests(async () => {
			consumeCount += 1;
			if (consumeCount === 1) {
				store.pending = null;
				return { status: CONSUME_PENDING_STATUS.CONSUMED };
			}
			return { status: CONSUME_PENDING_STATUS.ALREADY_CONSUMED };
		});
		setCreateExpenseImplForTests(async () => ({
			expenseId: 'exp-par',
			label: 'transport',
			amount: 500,
		}));

		const agent = createAshyAgent();
		await agent.run({ message: EXPENSE_MSG, user: USER_A, sessionId: SESSION });
		const [a, b] = await Promise.all([
			agent.run({ message: 'oui', user: USER_A, sessionId: SESSION }),
			agent.run({ message: 'oui', user: USER_A, sessionId: SESSION }),
		]);
		const successes = [a, b].filter((r) => r.toolResults[0]?.success).length;
		assert.equal(successes, 1);
	});

	test('F3-14 — versions/token propagés depuis mirror', async () => {
		setIsWriteDbFirstForTests(true);
		setIsPendingDbRequiredForTests(true);
		const store = { draft: null, pending: null };
		wireDbStore(store);

		const state = baseState({
			pendingWrite: { tool: 'create_expense', label: 'transport', amount: 500 },
			pendingConsumeToken: 'tok-versions',
		});

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state,
			requirePendingDb: true,
		});

		const cached = getConversationState(USER_A.id, SESSION, USER_A.activeActivityId);
		assert.equal(cached.pendingSessionVersion, store.pending.stateVersion);
		assert.equal(cached.pendingConsumeToken, 'tok-versions');
	});

	test('F3-15 — aucun secret dans metrics', () => {
		const metrics = getAgentSessionWriteMetricsForTests();
		const json = JSON.stringify(metrics);
		assert.equal(json.includes('tok-versions'), false);
		assert.equal(json.includes('transport'), false);
		assert.equal(json.includes('consumeToken'), false);
		assert.ok(typeof metrics.writer_db_primary === 'number');
	});

	test('F3 — restart: reader DB après RAM reset', async () => {
		setIsWriteDbFirstForTests(true);
		setIsPendingDbRequiredForTests(true);
		const store = { draft: null, pending: null };
		wireDbStore(store);

		await persistConversationState({
			user: USER_A,
			sessionId: SESSION,
			state: baseState({
				pendingWrite: { tool: 'create_expense', label: 'fuel', amount: 50 },
				pendingConsumeToken: 'tok-restart-f3',
			}),
			requirePendingDb: true,
		});

		clearConversationSessionsForTests();
		resetAgentSessionReaderForTests();

		const { state, source } = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(source, 'agent_sessions');
		assert.equal(state.pendingWrite?.label, 'fuel');
	});
});
