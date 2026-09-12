import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
	saveConversationState,
	clearConversationSessionsForTests,
} from '../src/agent/conversation-state.js';
import {
	setCreateExpenseImplForTests,
	resetCreateExpenseImplForTests,
} from '../src/services/expenses-write-service.js';
import {
	getAgentSessionState,
	mapSessionToAgentState,
	getAgentSessionReadMetricsForTests,
	resetAgentSessionReaderForTests,
	READ_SOURCES,
	READ_MODES,
	comparePendingFreshness,
	resolvePendingFromDbAndRam,
} from '../src/services/agent-session-reader.js';
import {
	AgentSessionServiceError,
	CONSUME_PENDING_STATUS,
	resetAgentSessionServiceImplForTests,
	setConsumeAgentPendingImplForTests,
	setGetSessionsPairImplForTests,
} from '../src/services/agent-session-service.js';

const CLIENT_A = '11111111-1111-4111-8111-111111111111';
const CLIENT_B = '22222222-2222-4222-8222-222222222222';
const ACTIVITY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const ACTIVITY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';

const USER_A = {
	id: 'pb-user-a',
	clientId: CLIENT_A,
	activeActivityId: ACTIVITY_A,
	businessUserId: 'rec-user-a',
};

const USER_B = {
	id: 'pb-user-b',
	clientId: CLIENT_B,
	activeActivityId: ACTIVITY_B,
	businessUserId: 'rec-user-b',
};

const SESSION = 'sess-reader';

function setGetSessionImplForTests(handler) {
	setGetSessionsPairImplForTests(async (scope) => {
		if (typeof handler === 'function') {
			const draft = await handler(scope.clientId, 'draft');
			const pending = await handler(scope.clientId, 'pending');
			return { draft, pending };
		}
		return { draft: null, pending: null };
	});
}

function sessionRow(clientId, stateType, payload, extras = {}) {
	return {
		id: `sess-${stateType}`,
		clientId,
		stateType,
		payload,
		intention: extras.intention ?? null,
		awaiting: extras.awaiting ?? null,
		createdAt: '2026-09-05T00:00:00.000Z',
		updatedAt: extras.updatedAt ?? '2026-09-05T01:00:00.000Z',
		stateVersion: extras.stateVersion ?? 1,
	};
}

afterEach(() => {
	resetAgentSessionReaderForTests();
	resetAgentSessionServiceImplForTests();
	resetCreateExpenseImplForTests();
	clearConversationSessionsForTests();
});

describe('Phase 5.8-C agent-session-reader — mapping (unit)', () => {
	test('mapSessionToAgentState — draft payload compatible', () => {
		const draft = sessionRow(CLIENT_A, 'draft', {
			topic: 'ventes',
			filters: { period: '2026-09' },
			references: { lastPeriod: '2026-08' },
		});

		const state = mapSessionToAgentState(draft, null);
		assert.equal(state.topic, 'ventes');
		assert.equal(state.filters.period, '2026-09');
		assert.equal(state.references.lastPeriod, '2026-08');
	});

	test('mapSessionToAgentState — pending pendingWrite + awaiting + intention', () => {
		const pending = sessionRow(
			CLIENT_A,
			'pending',
			{
				pendingWrite: {
					tool: 'create_expense',
					label: 'Transport',
					amount: 5000,
				},
			},
			{ awaiting: 'confirm', intention: 'create_expense' },
		);

		const state = mapSessionToAgentState(null, pending);
		assert.equal(state.pendingWrite.tool, 'create_expense');
		assert.equal(state.pendingWrite.amount, 5000);
		assert.equal(state.intent, 'create_expense');
	});

	test('mapSessionToAgentState — draft + pending merged', () => {
		const draft = sessionRow(CLIENT_A, 'draft', { topic: 'depense', filters: {} });
		const pending = sessionRow(
			CLIENT_A,
			'pending',
			{ pendingWrite: { tool: 'create_expense', label: 'x', amount: 1 } },
			{ awaiting: 'confirm' },
		);

		const state = mapSessionToAgentState(draft, pending);
		assert.equal(state.topic, 'depense');
		assert.equal(state.pendingWrite.tool, 'create_expense');
	});
});

describe('Phase 5.8-C agent-session-reader — read priority (unit)', () => {
	test('TEST 1 — DB contient draft → retourne DB', async () => {
		setGetSessionImplForTests(async (_clientId, stateType) => {
			if (stateType === 'draft') {
				return sessionRow(CLIENT_A, 'draft', { topic: 'ventes' });
			}
			return null;
		});

		const result = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(result.source, READ_SOURCES.AGENT_SESSIONS);
		assert.equal(result.state.topic, 'ventes');
		assert.equal(getAgentSessionReadMetricsForTests().dbHit, 1);
	});

	test('TEST 2 — DB contient pending → retourne DB', async () => {
		setGetSessionImplForTests(async (_clientId, stateType) => {
			if (stateType === 'pending') {
				return sessionRow(
					CLIENT_A,
					'pending',
					{ pendingWrite: { tool: 'create_sale', product: 'poulet', quantity: 2, unitPrice: 3500, amountPaid: 7000 } },
					{ awaiting: 'confirm', intention: 'create_sale' },
				);
			}
			return null;
		});

		const result = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(result.source, READ_SOURCES.AGENT_SESSIONS);
		assert.equal(result.awaiting, 'confirm');
		assert.equal(result.state.pendingWrite.product, 'poulet');
	});

	test('TEST 3 — DB absent, RAM draft → retourne RAM', async () => {
		setGetSessionImplForTests(async () => null);
		saveConversationState(USER_A.id, SESSION, {
			topic: 'stock',
			intent: null,
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
		});

		const result = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(result.source, READ_SOURCES.CONVERSATION_STORE_FALLBACK);
		assert.equal(result.state.topic, 'stock');
		assert.equal(getAgentSessionReadMetricsForTests().fallbackHit, 1);
	});

	test('TEST 4 — DB absent, RAM pending → retourne RAM', async () => {
		setGetSessionImplForTests(async () => null);
		saveConversationState(USER_A.id, SESSION, {
			topic: 'depense',
			intent: 'create_expense',
			filters: { label: 'transport', amount: 20 },
			references: {
				lastPeriod: null,
				previousPeriod: null,
				lastProduct: null,
				lastEntity: null,
			},
			lastTool: null,
			lastAction: null,
			updatedAt: null,
			pendingWrite: { tool: 'create_expense', label: 'transport', amount: 20 },
		});

		const result = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(result.source, READ_SOURCES.CONVERSATION_STORE_FALLBACK);
		assert.equal(result.state.pendingWrite.tool, 'create_expense');
	});

	test('TEST 5 — Supabase erreur, RAM présent → retourne RAM', async () => {
		setGetSessionImplForTests(async () => {
			throw new AgentSessionServiceError('SELECT_FAILED', 'Unable to retrieve agent session');
		});
		saveConversationState(USER_A.id, SESSION, {
			topic: 'debts',
			intent: null,
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
		});

		const result = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(result.source, READ_SOURCES.AGENT_SESSIONS_ERROR_FALLBACK);
		assert.equal(result.state.topic, 'debts');
		assert.equal(getAgentSessionReadMetricsForTests().errorFallbackHit, 1);
	});

	test('TEST 6 — Supabase erreur, RAM vide → comportement legacy', async () => {
		setGetSessionImplForTests(async () => {
			throw new AgentSessionServiceError('SELECT_FAILED', 'Unable to retrieve agent session');
		});

		const result = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(result.source, READ_SOURCES.AGENT_SESSIONS_ERROR_FALLBACK);
		assert.equal(result.state.topic, null);
		assert.equal(result.state.pendingWrite, null);
	});

	test('TEST 12 — DB prioritaire même si RAM différente', async () => {
		setGetSessionImplForTests(async (_clientId, stateType) => {
			if (stateType === 'draft') {
				return sessionRow(CLIENT_A, 'draft', { topic: 'ventes' });
			}
			return null;
		});
		saveConversationState(USER_A.id, SESSION, {
			topic: 'depenses',
			intent: null,
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
		});

		const result = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(result.source, READ_SOURCES.AGENT_SESSIONS);
		assert.equal(result.state.topic, 'ventes');
	});

	test('NOT FOUND ≠ ERROR — DB absent sans erreur → fallback sans errorFallback', async () => {
		setGetSessionImplForTests(async () => null);

		await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		const metrics = getAgentSessionReadMetricsForTests();
		assert.equal(metrics.fallbackHit, 1);
		assert.equal(metrics.errorFallbackHit, 0);
	});
});

describe('Phase 5.8-C agent-session-reader — tenant isolation (unit)', () => {
	test('TEST 7 — Client A ne lit jamais session Client B', async () => {
		setGetSessionImplForTests(async (clientId, stateType) => {
			if (clientId === CLIENT_A && stateType === 'draft') {
				return sessionRow(CLIENT_A, 'draft', { topic: 'A-only' });
			}
			if (clientId === CLIENT_B && stateType === 'draft') {
				return sessionRow(CLIENT_B, 'draft', { topic: 'B-only' });
			}
			return null;
		});

		const a = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		const b = await getAgentSessionState({ user: USER_B, sessionId: SESSION });
		assert.equal(a.state.topic, 'A-only');
		assert.equal(b.state.topic, 'B-only');
	});

	test('TEST 8 — clientId externe ignoré', async () => {
		let capturedClientId = null;
		setGetSessionImplForTests(async (clientId) => {
			capturedClientId = clientId;
			return sessionRow(clientId, 'draft', { topic: 'scoped' });
		});

		await getAgentSessionState({
			user: USER_A,
			clientId: CLIENT_B,
			sessionId: SESSION,
		});
		assert.equal(capturedClientId, CLIENT_A);
	});

	test('isolation pending — A et B séparés', async () => {
		setGetSessionImplForTests(async (clientId, stateType) => {
			if (stateType !== 'pending') return null;
			if (clientId === CLIENT_A) {
				return sessionRow(CLIENT_A, 'pending', {
					pendingWrite: { tool: 'create_expense', label: 'A', amount: 1 },
				}, { awaiting: 'confirm' });
			}
			if (clientId === CLIENT_B) {
				return sessionRow(CLIENT_B, 'pending', {
					pendingWrite: { tool: 'create_expense', label: 'B', amount: 2 },
				}, { awaiting: 'confirm' });
			}
			return null;
		});

		const a = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		const b = await getAgentSessionState({ user: USER_B, sessionId: SESSION });
		assert.equal(a.state.pendingWrite.label, 'A');
		assert.equal(b.state.pendingWrite.label, 'B');
	});
});

describe('Phase 5.8-C agent-session-reader — pendingWrite read-only (unit)', () => {
	test('TEST 9 — pendingWrite DB correctement mappé', async () => {
		const pendingWrite = {
			tool: 'create_sale',
			product: 'poisson',
			quantity: 3,
			unitPrice: 2000,
			amountPaid: 6000,
		};
		setGetSessionImplForTests(async (_clientId, stateType) => {
			if (stateType === 'pending') {
				return sessionRow(CLIENT_A, 'pending', { pendingWrite }, { awaiting: 'confirm' });
			}
			return null;
		});

		const result = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.deepEqual(result.state.pendingWrite, pendingWrite);
	});

	test('TEST 10 — awaiting DB correctement mappé', async () => {
		setGetSessionImplForTests(async (_clientId, stateType) => {
			if (stateType === 'pending') {
				return sessionRow(CLIENT_A, 'pending', {}, { awaiting: 'price_choice' });
			}
			return null;
		});

		const result = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(result.awaiting, 'price_choice');
	});

	test('TEST 11 — intention correctement mappée', async () => {
		setGetSessionImplForTests(async (_clientId, stateType) => {
			if (stateType === 'pending') {
				return sessionRow(CLIENT_A, 'pending', {}, { intention: 'create_sale' });
			}
			return null;
		});

		const result = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(result.state.intent, 'create_sale');
	});
});

describe('Phase 5.8-C agent-session-reader — Ashy integration (unit)', () => {
	test('createAshyAgent utilise DB pendingWrite pour confirmation', async () => {
		setGetSessionImplForTests(async (clientId, stateType) => {
			if (clientId !== CLIENT_A || stateType !== 'pending') return null;
			return sessionRow(
				CLIENT_A,
				'pending',
				{
					pendingWrite: {
						tool: 'create_expense',
						label: 'carburant',
						amount: 15000,
					},
					consumeToken: 'tok-db-read',
				},
				{ awaiting: 'confirm', intention: 'create_expense', stateVersion: 3 },
			);
		});
		setConsumeAgentPendingImplForTests(async () => ({
			status: CONSUME_PENDING_STATUS.CONSUMED,
		}));
		process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

		setCreateExpenseImplForTests(async (scope, input) => {
			assert.equal(scope.clientId, CLIENT_A);
			assert.equal(input.confirmed, true);
			assert.equal(input.label, 'carburant');
			assert.equal(input.amount, 15000);
			return {
				expenseId: 'expense-db-read',
				label: input.label,
				amount: input.amount,
			};
		});

		const { createAshyAgent } = await import('../src/agent/index.js');
		const agent = createAshyAgent();
		const result = await agent.run({
			message: 'oui',
			user: USER_A,
			sessionId: SESSION,
		});

		assert.equal(result.toolResults[0]?.success, true);
		assert.equal(result.toolResults[0]?.tool, 'create_expense');
		assert.match(result.reply, /Dépense enregistrée/i);
	});
});

describe('Phase 5.8-F1 agent-session-reader — partial pending merge (unit)', () => {
	function ramPendingState(label, extras = {}) {
		return {
			topic: 'depense',
			intent: 'create_expense',
			filters: {},
			references: {
				lastPeriod: null,
				previousPeriod: null,
				lastProduct: null,
				lastEntity: null,
			},
			lastTool: null,
			lastAction: 'create_expense',
			updatedAt: extras.updatedAt ?? '2026-09-06T02:00:00.000Z',
			pendingWrite: {
				tool: 'create_expense',
				label,
				amount: extras.amount ?? 100,
			},
			pendingSessionVersion: extras.pendingSessionVersion ?? null,
			pendingConsumeToken: extras.pendingConsumeToken ?? `tok-ram-${label}`,
		};
	}

	test('F1-1 — DB empty + RAM pending → RAM pending used', async () => {
		setGetSessionImplForTests(async () => null);
		saveConversationState(USER_A.id, SESSION, ramPendingState('transport'));

		const result = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(result.source, READ_SOURCES.CONVERSATION_STORE_FALLBACK);
		assert.equal(result.readMode, READ_MODES.RAM_FALLBACK);
		assert.equal(result.state.pendingWrite.label, 'transport');
		assert.equal(getAgentSessionReadMetricsForTests().ramFallback, 1);
	});

	test('F1-2 — DB draft only + RAM pending → draft DB + pending RAM preserved', async () => {
		setGetSessionImplForTests(async (_clientId, stateType) => {
			if (stateType === 'draft') {
				return sessionRow(CLIENT_A, 'draft', { topic: 'ventes' }, {
					updatedAt: '2026-09-05T01:00:00.000Z',
				});
			}
			return null;
		});
		saveConversationState(USER_A.id, SESSION, ramPendingState('fuel', {
			pendingSessionVersion: 2,
		}));

		const result = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(result.source, READ_SOURCES.AGENT_SESSIONS);
		assert.equal(result.readMode, READ_MODES.RAM_PENDING_MERGE);
		assert.equal(result.state.topic, 'ventes');
		assert.equal(result.state.pendingWrite.label, 'fuel');
		assert.equal(result.state.pendingSessionVersion, 2);
		assert.equal(getAgentSessionReadMetricsForTests().ramPendingMerge, 1);
	});

	test('F1-3 — DB pending A + RAM pending B → newer metadata wins', async () => {
		setGetSessionImplForTests(async (_clientId, stateType) => {
			if (stateType === 'draft') {
				return sessionRow(CLIENT_A, 'draft', { topic: 'depense' });
			}
			if (stateType === 'pending') {
				return sessionRow(
					CLIENT_A,
					'pending',
					{ pendingWrite: { tool: 'create_expense', label: 'A', amount: 1 }, consumeToken: 'tok-db-a' },
					{
						awaiting: 'confirm',
						stateVersion: 1,
						updatedAt: '2026-09-05T01:00:00.000Z',
					},
				);
			}
			return null;
		});
		saveConversationState(USER_A.id, SESSION, ramPendingState('B', {
			pendingSessionVersion: 2,
			updatedAt: '2026-09-06T03:00:00.000Z',
		}));

		const newerRam = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(newerRam.readMode, READ_MODES.RAM_PENDING_MERGE);
		assert.equal(newerRam.state.pendingWrite.label, 'B');
		assert.equal(newerRam.state.pendingSessionVersion, 2);

		clearConversationSessionsForTests();
		setGetSessionImplForTests(async (_clientId, stateType) => {
			if (stateType === 'draft') {
				return sessionRow(CLIENT_A, 'draft', { topic: 'depense' });
			}
			if (stateType === 'pending') {
				return sessionRow(
					CLIENT_A,
					'pending',
					{ pendingWrite: { tool: 'create_expense', label: 'A', amount: 1 }, consumeToken: 'tok-db-a' },
					{
						awaiting: 'confirm',
						stateVersion: 2,
						updatedAt: '2026-09-06T01:00:00.000Z',
					},
				);
			}
			return null;
		});
		saveConversationState(USER_A.id, SESSION, ramPendingState('B-old', {
			pendingSessionVersion: 1,
		}));

		const newerDb = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(newerDb.readMode, READ_MODES.DB_PENDING_PRIMARY);
		assert.equal(newerDb.state.pendingWrite.label, 'A');
		assert.equal(newerDb.state.pendingSessionVersion, 2);
	});

	test('F1-3b — ambiguous pending freshness → conservative DB pending', () => {
		const dbState = mapSessionToAgentState(
			sessionRow(CLIENT_A, 'draft', { topic: 'depense' }),
			sessionRow(
				CLIENT_A,
				'pending',
				{ pendingWrite: { tool: 'create_expense', label: 'A', amount: 1 }, consumeToken: 'tok-db' },
				{ stateVersion: 1, updatedAt: '2026-09-05T01:00:00.000Z' },
			),
		);
		const ramState = ramPendingState('B', {
			pendingSessionVersion: 1,
			updatedAt: '2026-09-05T01:00:00.000Z',
		});

		assert.equal(
			comparePendingFreshness(
				{ stateVersion: 1, updatedAt: '2026-09-05T01:00:00.000Z' },
				{ stateVersion: 1, updatedAt: '2026-09-05T01:00:00.000Z' },
			),
			'ambiguous',
		);

		const resolved = resolvePendingFromDbAndRam(
			dbState,
			sessionRow(
				CLIENT_A,
				'pending',
				{ pendingWrite: { tool: 'create_expense', label: 'A', amount: 1 }, consumeToken: 'tok-db' },
				{ stateVersion: 1, updatedAt: '2026-09-05T01:00:00.000Z' },
			),
			ramState,
		);
		assert.equal(resolved.readMode, READ_MODES.PENDING_DIVERGENCE);
		assert.equal(resolved.state.pendingWrite.label, 'A');
	});

	test('F1-4 — DB draft + DB pending → DB pending primary, RAM ignored', async () => {
		setGetSessionImplForTests(async (_clientId, stateType) => {
			if (stateType === 'draft') {
				return sessionRow(CLIENT_A, 'draft', { topic: 'depense' });
			}
			if (stateType === 'pending') {
				return sessionRow(
					CLIENT_A,
					'pending',
					{ pendingWrite: { tool: 'create_expense', label: 'DB-valid', amount: 5 }, consumeToken: 'tok-db' },
					{ awaiting: 'confirm', stateVersion: 3, updatedAt: '2026-09-06T01:00:00.000Z' },
				);
			}
			return null;
		});
		saveConversationState(USER_A.id, SESSION, ramPendingState('RAM-stale', {
			pendingSessionVersion: 1,
			updatedAt: '2026-09-04T01:00:00.000Z',
		}));

		const result = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(result.readMode, READ_MODES.DB_PENDING_PRIMARY);
		assert.equal(result.state.pendingWrite.label, 'DB-valid');
		assert.equal(result.state.pendingSessionVersion, 3);
		assert.equal(getAgentSessionReadMetricsForTests().dbPendingPrimary, 1);
	});

	test('F1-5 — DB unavailable + RAM pending → RAM fallback', async () => {
		setGetSessionImplForTests(async () => {
			throw new AgentSessionServiceError('SELECT_FAILED', 'Unable to retrieve agent session');
		});
		saveConversationState(USER_A.id, SESSION, ramPendingState('offline'));

		const result = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(result.source, READ_SOURCES.AGENT_SESSIONS_ERROR_FALLBACK);
		assert.equal(result.readMode, READ_MODES.RAM_FALLBACK);
		assert.equal(result.state.pendingWrite.label, 'offline');
		assert.equal(getAgentSessionReadMetricsForTests().errorFallbackHit, 1);
	});

	test('F1-6 — DB draft only + RAM without pending → DB primary', async () => {
		setGetSessionImplForTests(async (_clientId, stateType) => {
			if (stateType === 'draft') {
				return sessionRow(CLIENT_A, 'draft', { topic: 'stock' });
			}
			return null;
		});
		saveConversationState(USER_A.id, SESSION, {
			topic: 'ignored',
			intent: null,
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
		});

		const result = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(result.readMode, READ_MODES.DB_PRIMARY);
		assert.equal(result.state.topic, 'stock');
		assert.equal(result.state.pendingWrite, null);
	});

	test('F1-7 — DB pending only → pending DB preserved without draft', async () => {
		setGetSessionImplForTests(async (_clientId, stateType) => {
			if (stateType === 'pending') {
				return sessionRow(
					CLIENT_A,
					'pending',
					{
						pendingWrite: { tool: 'create_expense', label: 'solo-pending', amount: 9 },
						consumeToken: 'tok-solo',
					},
					{ awaiting: 'confirm', intention: 'create_expense', stateVersion: 4 },
				);
			}
			return null;
		});

		const result = await getAgentSessionState({ user: USER_A, sessionId: SESSION });
		assert.equal(result.source, READ_SOURCES.AGENT_SESSIONS);
		assert.equal(result.readMode, READ_MODES.DB_PENDING_PRIMARY);
		assert.equal(result.state.pendingWrite.label, 'solo-pending');
		assert.equal(result.state.pendingSessionVersion, 4);
		assert.equal(result.state.intent, 'create_expense');
		assert.equal(result.awaiting, 'confirm');
	});
});
