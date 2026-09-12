import assert from 'node:assert/strict';
import { afterEach, before, describe, test } from 'node:test';

import {
	clearConversationSessionsForTests,
	getConversationState,
	persistConversationState,
	saveConversationState,
} from '../src/agent/conversation-state.js';
import {
	createAshyAgent,
	PENDING_PERSISTENCE_FAILED_REPLY,
} from '../src/agent/index.js';
import {
	getAgentSessionState,
	resetAgentSessionReaderForTests,
	READ_MODES,
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
	getAgentSessionWriteMetricsForTests,
	resetAgentSessionWriterForTests,
	setIsPendingDbRequiredForTests,
	setIsSupabaseConfiguredForTests,
} from '../src/services/agent-session-writer.js';
import {
	resetCreateExpenseImplForTests,
	setCreateExpenseImplForTests,
} from '../src/services/expenses-write-service.js';
import { setForceRegexResolverForTests } from '../src/agent/intent-resolver/index.js';

const CLIENT_A = '11111111-1111-4111-8111-111111111111';
const ACTIVITY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';

const USER_A = {
	id: 'pb-user-a',
	clientId: CLIENT_A,
	activeActivityId: ACTIVITY_A,
	businessUserId: 'rec-user-a',
};
const SESSION = 'sess-f2';

const EXPENSE_MSG = "J'ai dépensé 500 $ pour le transport";
const EXPENSE_MSG_800 = "J'ai dépensé 800 $ pour le carburant";

const originalPendingDbRequired = process.env.AGENT_SESSION_PENDING_DB_REQUIRED;
const originalMirrorAwait = process.env.AGENT_SESSION_MIRROR_AWAIT;
const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function pendingRow(pendingWrite, extras = {}) {
	return {
		id: 'sess-pending',
		clientId: CLIENT_A,
		stateType: 'pending',
		payload: {
			pendingWrite,
			consumeToken: extras.consumeToken ?? 'tok-db',
		},
		intention: extras.intention ?? 'create_expense',
		awaiting: extras.awaiting ?? 'confirm',
		createdAt: '2026-09-05T00:00:00.000Z',
		updatedAt: extras.updatedAt ?? '2026-09-05T02:00:00.000Z',
		stateVersion: extras.stateVersion ?? 1,
	};
}

function draftRow(topic = 'expenses') {
	return {
		id: 'sess-draft',
		clientId: CLIENT_A,
		stateType: 'draft',
		payload: { topic, intent: 'create_expense', filters: {}, references: {} },
		intention: null,
		awaiting: null,
		createdAt: '2026-09-05T00:00:00.000Z',
		updatedAt: '2026-09-05T01:00:00.000Z',
		stateVersion: 1,
	};
}

function createDbStore() {
	return { draft: null, pending: null };
}

function wireDbStore(store, { mirrorFail = false, omitPendingOnVerify = false } = {}) {
	setMirrorSessionsAtomicImplForTests(async (_clientId, params) => {
		if (mirrorFail) {
			throw new AgentSessionServiceError('MIRROR_ATOMIC_FAILED', 'Unable to mirror agent sessions atomically');
		}
		store.draft = draftRow(params.draftPayload?.topic || 'expenses');
		if (params.pendingPayload) {
			store.pending = pendingRow(
				params.pendingPayload.pendingWrite,
				{
					consumeToken: params.pendingPayload.consumeToken,
					stateVersion: (store.pending?.stateVersion ?? 0) + 1,
				},
			);
		} else if (params.clearPendingVersion != null) {
			store.pending = null;
		}
		return {
			draftVersion: 1,
			pendingVersion: store.pending?.stateVersion ?? null,
			pendingCleared: params.pendingPayload ? 0 : 1,
		};
	});

	setGetSessionsPairImplForTests(async () => ({
		draft: store.draft,
		pending: omitPendingOnVerify ? null : store.pending,
	}));
}

before(() => {
	process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
	setIsSupabaseConfiguredForTests(true);
	setForceRegexResolverForTests(true);
});

afterEach(() => {
	process.env.AGENT_SESSION_PENDING_DB_REQUIRED = originalPendingDbRequired;
	process.env.AGENT_SESSION_MIRROR_AWAIT = originalMirrorAwait;
	setIsPendingDbRequiredForTests(null);
	setForceRegexResolverForTests(true);
	resetAgentSessionWriterForTests();
	resetAgentSessionServiceImplForTests();
	resetAgentSessionReaderForTests();
	resetCreateExpenseImplForTests();
	clearConversationSessionsForTests();
});

describe('Phase 5.8-F2 — pending DB required before NEEDS_CONFIRMATION', () => {
	test('F2-1 — pendingWrite + mirror OK → NEEDS_CONFIRMATION autorisé', async () => {
		setIsPendingDbRequiredForTests(true);
		const store = createDbStore();
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
		assert.equal(getAgentSessionWriteMetricsForTests().pending_persistence_success, 1);
	});

	test('F2-2 — mirror DB échoue → NEEDS_CONFIRMATION interdit', async () => {
		setIsPendingDbRequiredForTests(true);
		const store = createDbStore();
		wireDbStore(store, { mirrorFail: true });

		const agent = createAshyAgent();
		const result = await agent.run({
			message: EXPENSE_MSG,
			user: USER_A,
			sessionId: SESSION,
		});

		assert.equal(result.reply, PENDING_PERSISTENCE_FAILED_REPLY);
		assert.equal(getConversationState(USER_A.id, SESSION, USER_A.activeActivityId).pendingWrite, null);
		assert.equal(getAgentSessionWriteMetricsForTests().pending_persistence_blocked_confirmation, 1);
	});

	test('F2-3 — mirror OK mais pending row absent → NEEDS_CONFIRMATION interdit', async () => {
		setIsPendingDbRequiredForTests(true);
		const store = createDbStore();
		wireDbStore(store, { omitPendingOnVerify: true });

		const agent = createAshyAgent();
		const result = await agent.run({
			message: EXPENSE_MSG,
			user: USER_A,
			sessionId: SESSION,
		});

		assert.equal(result.reply, PENDING_PERSISTENCE_FAILED_REPLY);
		assert.equal(getAgentSessionWriteMetricsForTests().pending_persistence_blocked_confirmation, 1);
	});

	test('F2-4 — pending DB + bon token → confirmation tour suivant OK', async () => {
		setIsPendingDbRequiredForTests(true);
		const store = createDbStore();
		wireDbStore(store);
		setConsumeAgentPendingImplForTests(async () => ({
			status: CONSUME_PENDING_STATUS.CONSUMED,
		}));
		setCreateExpenseImplForTests(async (_clientId, input) => ({
			expenseId: 'exp-f2',
			label: input.label,
			amount: input.amount,
		}));

		const agent = createAshyAgent();
		await agent.run({
			message: EXPENSE_MSG,
			user: USER_A,
			sessionId: SESSION,
		});

		const confirm = await agent.run({
			message: 'oui',
			user: USER_A,
			sessionId: SESSION,
		});

		assert.equal(confirm.toolResults[0]?.success, true);
		assert.match(confirm.reply, /Dépense enregistrée/i);
	});

	test('F2-5 — restart RAM vide, pending DB → confirmation OK', async () => {
		setIsPendingDbRequiredForTests(true);
		const pw = { tool: 'create_expense', label: 'fuel', amount: 50 };
		const store = createDbStore();
		store.draft = draftRow('expenses');
		store.pending = pendingRow(pw, { consumeToken: 'tok-restart', stateVersion: 2 });
		wireDbStore(store);
		setConsumeAgentPendingImplForTests(async () => ({
			status: CONSUME_PENDING_STATUS.CONSUMED,
		}));
		setCreateExpenseImplForTests(async () => ({
			expenseId: 'exp-restart',
			label: 'fuel',
			amount: 50,
		}));

		clearConversationSessionsForTests();

		const { state } = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(state.pendingWrite.label, 'fuel');

		const agent = createAshyAgent();
		const confirm = await agent.run({
			message: 'oui',
			user: USER_A,
			sessionId: SESSION,
		});
		assert.equal(confirm.toolResults[0]?.success, true);
	});

	test('F2-6 — RAM pending seul ne suffit pas pour nouveau NEEDS_CONFIRMATION si mirror échoue', async () => {
		setIsPendingDbRequiredForTests(true);
		saveConversationState(USER_A.id, SESSION, {
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
			pendingWrite: { tool: 'create_expense', label: 'ram-only', amount: 1 },
			pendingSessionVersion: 1,
			pendingConsumeToken: 'tok-ram-only',
		});

		const store = createDbStore();
		store.draft = draftRow('expenses');
		wireDbStore(store, { mirrorFail: true });

		const agent = createAshyAgent();
		const result = await agent.run({
			message: EXPENSE_MSG_800,
			user: USER_A,
			sessionId: SESSION,
		});

		assert.equal(result.reply, PENDING_PERSISTENCE_FAILED_REPLY);
	});

	test('F2-7 — erreur DB pendant sauvegarde pending → pas de NEEDS_CONFIRMATION', async () => {
		setIsPendingDbRequiredForTests(true);
		const store = createDbStore();
		wireDbStore(store, { mirrorFail: true });

		let writeCount = 0;
		setCreateExpenseImplForTests(async () => {
			writeCount += 1;
			return { expenseId: 'x', label: 'x', amount: 1 };
		});

		const agent = createAshyAgent();
		const result = await agent.run({
			message: EXPENSE_MSG,
			user: USER_A,
			sessionId: SESSION,
		});

		assert.equal(result.reply, PENDING_PERSISTENCE_FAILED_REPLY);
		assert.equal(writeCount, 0);
	});

	test('F2-8 — deux confirmations simultanées → une seule consommation (P0)', async () => {
		setIsPendingDbRequiredForTests(true);
		const store = createDbStore();
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
		await agent.run({
			message: EXPENSE_MSG,
			user: USER_A,
			sessionId: SESSION,
		});

		const [a, b] = await Promise.all([
			agent.run({ message: 'oui', user: USER_A, sessionId: SESSION }),
			agent.run({ message: 'oui', user: USER_A, sessionId: SESSION }),
		]);

		const successes = [a, b].filter((r) => r.toolResults[0]?.success).length;
		assert.equal(successes, 1);
		assert.equal(consumeCount, 2);
	});

	test('F2-9 — pending DB valide + RAM pending différent → DB prioritaire au read', async () => {
		const dbPending = { tool: 'create_expense', label: 'DB-truth', amount: 99 };
		const store = createDbStore();
		store.draft = draftRow('expenses');
		store.pending = pendingRow(dbPending, { stateVersion: 3, consumeToken: 'tok-db-truth' });
		wireDbStore(store);

		saveConversationState(USER_A.id, SESSION, {
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
			updatedAt: '2026-09-06T04:00:00.000Z',
			pendingWrite: { tool: 'create_expense', label: 'RAM-stale', amount: 1 },
			pendingSessionVersion: 1,
			pendingConsumeToken: 'tok-ram-stale',
		});

		const { state, readMode } = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(readMode, READ_MODES.DB_PENDING_PRIMARY);
		assert.equal(state.pendingWrite.label, 'DB-truth');
		assert.equal(state.pendingSessionVersion, 3);
	});

	test('flag disabled — mirror fail still allows NEEDS_CONFIRMATION (legacy)', async () => {
		setIsPendingDbRequiredForTests(false);
		const store = createDbStore();
		wireDbStore(store, { mirrorFail: true });

		const agent = createAshyAgent();
		const result = await agent.run({
			message: EXPENSE_MSG,
			user: USER_A,
			sessionId: SESSION,
		});

		assert.equal(result.toolResults[0]?.error?.code, 'NEEDS_CONFIRMATION');
		assert.notEqual(result.reply, PENDING_PERSISTENCE_FAILED_REPLY);
	});
});
