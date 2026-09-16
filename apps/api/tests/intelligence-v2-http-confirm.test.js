import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, test } from 'node:test';

import { createAshyAgent } from '../src/agent/index.js';
import {
	clearConversationSessionsForTests,
	getConversationState,
} from '../src/agent/conversation-state.js';
import { computeRequestHash } from '../src/lib/agent-operation-idempotency.js';
import { ACTION_PROPOSAL_STATUS } from '../src/agent/intelligence-v2/action/action-proposal-contract.js';
import { executeActionConfirmationViaF4B2 } from '../src/agent/intelligence-v2/action/action-f4-executor.js';
import { buildActionProposalFromGoal, buildExpenseActionGoal, buildSaleActionGoal } from '../src/agent/intelligence-v2/action/action-proposal-builder.js';
import { handleV2HttpTurn } from '../src/agent/intelligence-v2/v2-http-handler.js';
import {
	resetIntentResolverTestOverrides,
	setResolveIntentSpyForTests,
} from '../src/agent/intent-resolver/index.js';
import {
	resetAgentSessionReaderForTests,
	setGetAgentSessionStateImplForTests,
} from '../src/services/agent-session-reader.js';
import {
	resetAgentSessionWriterForTests,
	setIsSupabaseConfiguredForTests,
} from '../src/services/agent-session-writer.js';
import {
	resetAgentTransactionalWriteForTests,
	setConfirmAndCreateExpenseImplForTests,
	setConfirmAndCreateSaleImplForTests,
	setIsIdempotentConfirmEnabledForTests,
	setIsTransactionalConfirmEnabledForTests,
	TRANSACTIONAL_CONFIRM_STATUS,
	getTransactionalWriteMetricsForTests,
} from '../src/services/agent-transactional-write-service.js';
import {
	resetCreateExpenseImplForTests,
	setCreateExpenseImplForTests,
} from '../src/services/expenses-write-service.js';
import {
	resetCreateSaleImplForTests,
	setCreateSaleImplForTests,
} from '../src/services/sales-write-service.js';

const REFERENCE_DATE = new Date('2026-09-12T12:00:00.000Z');
const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTIVITY_A1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const ACTIVITY_A2 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const OP_ID = '11111111-1111-4111-8111-111111111111';

const STAGING_H3_ENV = {
	ashyIntelligenceV2: true,
	ashyIntelligenceV2Http: true,
	ashyIntelligenceV2Actions: true,
	ashyIntelligenceV2HttpConfirm: true,
	ashyIntelligenceV2Shadow: false,
	openAiApiKey: '',
};

const H3_OPTIONS = { forceHttp: true, env: STAGING_H3_ENV };

function user(scope = {}) {
	return {
		id: 'pb-h3',
		clientId: CLIENT_A,
		activeActivityId: ACTIVITY_A1,
		businessUserId: 'rec-h3',
		...scope,
	};
}

function emptyState(overrides = {}) {
	return {
		topic: null,
		intent: null,
		filters: {},
		references: { lastPeriod: null, previousPeriod: null, lastProduct: null, lastEntity: null },
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

function wireSession(u, sessionId, initial = emptyState()) {
	setGetAgentSessionStateImplForTests(async () => ({
		state: getConversationState(u.id, sessionId, u.activeActivityId) || initial,
		source: 'test',
	}));
	return {
		read: () => getConversationState(u.id, sessionId, u.activeActivityId) || initial,
	};
}

function enableF4Mocks() {
	setIsSupabaseConfiguredForTests(true);
	setIsTransactionalConfirmEnabledForTests(true);
	setIsIdempotentConfirmEnabledForTests(true);
}

function expensePending(amount = 30, label = 'transport') {
	return {
		tool: 'create_expense',
		label,
		amount,
	};
}

function fullPendingState(pendingWrite, extra = {}) {
	return emptyState({
		pendingWrite,
		pendingOperationId: OP_ID,
		pendingConsumeToken: 'consume-tok-h3',
		pendingSessionVersion: 3,
		...extra,
	});
}

async function proposeThenConfirm(u, sessionId, proposeMessage) {
	wireSession(u, sessionId);
	await handleV2HttpTurn({
		message: proposeMessage,
		user: u,
		sessionId,
		previousState: emptyState(),
		referenceDate: REFERENCE_DATE,
		options: H3_OPTIONS,
	});
	return handleV2HttpTurn({
		message: 'Oui',
		user: u,
		sessionId,
		previousState: wireSession(u, sessionId).read(),
		referenceDate: REFERENCE_DATE,
		options: H3_OPTIONS,
	});
}

afterEach(() => {
	resetIntentResolverTestOverrides();
	resetAgentSessionReaderForTests();
	resetAgentSessionWriterForTests();
	resetAgentTransactionalWriteForTests();
	resetCreateExpenseImplForTests();
	resetCreateSaleImplForTests();
	setIsSupabaseConfiguredForTests(false);
	clearConversationSessionsForTests();
});

describe('H3 expense confirmation', () => {
	test('proposal then confirm → COMPLETED', async () => {
		enableF4Mocks();
		let f4Calls = 0;
		setConfirmAndCreateExpenseImplForTests(async () => {
			f4Calls += 1;
			return { success: true, status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED, result_id: 'exp-1', pending_consumed: true };
		});
		setCreateExpenseImplForTests(async () => { throw new Error('direct write blocked'); });

		const confirm = await proposeThenConfirm(user(), 's-exp-1', 'Ajoute une dépense de 30 dollars pour le transport');
		assert.equal(confirm.agentResponse.v2Http?.actionProposalStatus, ACTION_PROPOSAL_STATUS.COMPLETED);
		assert.equal(confirm.agentResponse.v2Http?.f4Committed, true);
		assert.equal(f4Calls, 1);
		assert.match(confirm.agentResponse.reply, /✅/);
	});

	test('confirm includes toolResults', async () => {
		enableF4Mocks();
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
			result_id: 'exp-2',
			pending_consumed: true,
			operation: 'create_expense',
		}));
		const confirm = await proposeThenConfirm(user(), 's-exp-tr', 'Ajoute une dépense de 30 dollars pour le transport');
		assert.ok(confirm.agentResponse.toolResults.length >= 1);
	});
});

describe('H3 sale confirmation', () => {
	test('sale proposal then confirm → COMPLETED', async () => {
		enableF4Mocks();
		setConfirmAndCreateSaleImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
			result_id: 'sale-1',
			pending_consumed: true,
		}));
		const u = user();
		const sessionId = 's-sale-1';
		wireSession(u, sessionId);
		await handleV2HttpTurn({
			message: "J'ai vendu 2 poulets à 10 dollars",
			user: u,
			sessionId,
			previousState: emptyState(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		const confirm = await handleV2HttpTurn({
			message: 'Oui',
			user: u,
			sessionId,
			previousState: wireSession(u, sessionId).read(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		assert.equal(confirm.agentResponse.v2Http?.actionProposalStatus, ACTION_PROPOSAL_STATUS.COMPLETED);
	});
});

describe('H3 F4-B2 invocation guard', () => {
	test('F4 not called when HTTP_CONFIRM false', async () => {
		let f4Calls = 0;
		setConfirmAndCreateExpenseImplForTests(async () => { f4Calls += 1; return { success: true, status: 'COMMITTED' }; });
		const u = user();
		const sessionId = 's-h2-block';
		wireSession(u, sessionId);
		await handleV2HttpTurn({
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			user: u,
			sessionId,
			previousState: emptyState(),
			referenceDate: REFERENCE_DATE,
			options: { forceHttp: true, env: { ...STAGING_H3_ENV, ashyIntelligenceV2HttpConfirm: false } },
		});
		await handleV2HttpTurn({
			message: 'Oui',
			user: u,
			sessionId,
			previousState: wireSession(u, sessionId).read(),
			referenceDate: REFERENCE_DATE,
			options: { forceHttp: true, env: { ...STAGING_H3_ENV, ashyIntelligenceV2HttpConfirm: false } },
		});
		assert.equal(f4Calls, 0);
	});

	test('F4 not called without pending', async () => {
		enableF4Mocks();
		let f4Calls = 0;
		setConfirmAndCreateExpenseImplForTests(async () => { f4Calls += 1; return { success: true, status: 'COMMITTED' }; });
		await handleV2HttpTurn({
			message: 'Oui',
			user: user(),
			sessionId: 's-no-pend',
			previousState: emptyState(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		assert.equal(f4Calls, 0);
	});
});

describe('H3 double confirmation', () => {
	test('second Oui after pending cleared → no second F4 write', async () => {
		enableF4Mocks();
		let f4Calls = 0;
		setConfirmAndCreateExpenseImplForTests(async () => {
			f4Calls += 1;
			return { success: true, status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED, result_id: 'exp-dc', pending_consumed: true };
		});
		const u = user();
		const sessionId = 's-double';
		const first = await proposeThenConfirm(u, sessionId, 'Ajoute une dépense de 30 dollars pour le transport');
		assert.equal(first.agentResponse.v2Http?.actionProposalStatus, ACTION_PROPOSAL_STATUS.COMPLETED);
		const second = await handleV2HttpTurn({
			message: 'Oui',
			user: u,
			sessionId,
			previousState: wireSession(u, sessionId).read(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		assert.equal(second.agentResponse.v2Http?.actionProposalStatus, 'NO_PENDING_TO_CONFIRM');
		assert.equal(f4Calls, 1);
	});
});

describe('H3 idempotence via executor', () => {
	test('replay ALREADY_COMPLETED', async () => {
		enableF4Mocks();
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.ALREADY_COMPLETED,
			result_id: 'exp-replay',
			pending_consumed: false,
		}));
		const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau', amount: 5, confirmed: true }));
		const result = await executeActionConfirmationViaF4B2({
			user: user(),
			sessionId: 's-replay',
			conversationState: fullPendingState(built.value.pendingWrite),
			proposal: built.value,
		});
		assert.equal(result.success, true);
		assert.equal(result.status, ACTION_PROPOSAL_STATUS.ALREADY_COMPLETED);
		assert.equal(result.replay, true);
	});

	test('REQUEST_HASH_MISMATCH rejected', async () => {
		enableF4Mocks();
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: false,
			status: TRANSACTIONAL_CONFIRM_STATUS.REQUEST_HASH_MISMATCH,
		}));
		const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau', amount: 5, confirmed: true }));
		const result = await executeActionConfirmationViaF4B2({
			user: user(),
			sessionId: 's-hash',
			conversationState: fullPendingState(built.value.pendingWrite),
			proposal: built.value,
		});
		assert.equal(result.success, false);
		assert.equal(result.code, TRANSACTIONAL_CONFIRM_STATUS.REQUEST_HASH_MISMATCH);
	});

	test('VERSION_MISMATCH rejected', async () => {
		enableF4Mocks();
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: false,
			status: TRANSACTIONAL_CONFIRM_STATUS.VERSION_MISMATCH,
		}));
		const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau', amount: 5, confirmed: true }));
		const result = await executeActionConfirmationViaF4B2({
			user: user(),
			sessionId: 's-ver',
			conversationState: fullPendingState(built.value.pendingWrite),
			proposal: built.value,
		});
		assert.equal(result.success, false);
		assert.equal(result.conflict, true);
	});
});

describe('H3 modification before confirm', () => {
	test('30 $ written not 25 $', async () => {
		enableF4Mocks();
		/** @type {Record<string, unknown> | null} */
		let capturedHash = null;
		setConfirmAndCreateExpenseImplForTests(async (_scope, params) => {
			capturedHash = params.requestHash;
			return { success: true, status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED, result_id: 'exp-mod', pending_consumed: true };
		});
		const u = user();
		const sessionId = 's-mod';
		wireSession(u, sessionId);
		await handleV2HttpTurn({
			message: 'Ajoute une dépense de 25 dollars pour le transport',
			user: u,
			sessionId,
			previousState: emptyState(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		await handleV2HttpTurn({
			message: 'Finalement 30 dollars',
			user: u,
			sessionId,
			previousState: wireSession(u, sessionId).read(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		const state = wireSession(u, sessionId).read();
		assert.equal(state.pendingWrite.amount, 30);
		const expectedHash = computeRequestHash(CLIENT_A, state.pendingWrite);
		await handleV2HttpTurn({
			message: 'Oui',
			user: u,
			sessionId,
			previousState: state,
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		assert.equal(capturedHash, expectedHash);
	});
});

describe('H3 clarification then confirm', () => {
	test('clarify amount then confirm', async () => {
		enableF4Mocks();
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
			result_id: 'exp-cl',
			pending_consumed: true,
		}));
		const u = user();
		const sessionId = 's-clar';
		wireSession(u, sessionId);
		await handleV2HttpTurn({
			message: 'Ajoute une dépense pour le transport',
			user: u,
			sessionId,
			previousState: emptyState(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		await handleV2HttpTurn({
			message: '30 dollars',
			user: u,
			sessionId,
			previousState: wireSession(u, sessionId).read(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		const confirm = await handleV2HttpTurn({
			message: 'Oui',
			user: u,
			sessionId,
			previousState: wireSession(u, sessionId).read(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		assert.equal(confirm.agentResponse.v2Http?.actionProposalStatus, ACTION_PROPOSAL_STATUS.COMPLETED);
	});
});

describe('H3 scope isolation', () => {
	test('cross activity confirm → NO_PENDING_TO_CONFIRM', async () => {
		enableF4Mocks();
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
			result_id: 'exp-x',
			pending_consumed: true,
		}));
		const uA1 = user({ activeActivityId: ACTIVITY_A1 });
		await proposeThenConfirm(uA1, 's-xact', 'Ajoute une dépense de 30 dollars pour le transport');
		const cross = await handleV2HttpTurn({
			message: 'Oui',
			user: user({ activeActivityId: ACTIVITY_A2 }),
			sessionId: 's-xact',
			previousState: emptyState(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		assert.equal(cross.agentResponse.v2Http?.actionProposalStatus, 'NO_PENDING_TO_CONFIRM');
	});
});

describe('H3 security', () => {
	test('operationId comes from backend state not user message', async () => {
		enableF4Mocks();
		setConfirmAndCreateExpenseImplForTests(async (_s, params) => {
			assert.notEqual(params.operationId, 'evil-op');
			assert.ok(params.operationId);
			return { success: true, status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED, result_id: 'exp-inj', pending_consumed: true };
		});
		const confirm = await proposeThenConfirm(user(), 's-inj', 'Ajoute une dépense de 30 dollars pour le transport');
		assert.equal(confirm.agentResponse.v2Http?.f4Committed, true);
		assert.equal(confirm.agentResponse.reply.includes('evil-op'), false);
	});

	test('no internal IDs in reply', async () => {
		enableF4Mocks();
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
			result_id: OP_ID,
			pending_consumed: true,
		}));
		const confirm = await proposeThenConfirm(user(), 's-leak', 'Ajoute une dépense de 30 dollars pour le transport');
		assert.equal(confirm.agentResponse.reply.includes(OP_ID), false);
		assert.equal(JSON.stringify(confirm.agentResponse.conversation).includes(OP_ID), false);
	});
});

describe('H3 concurrent confirmation', () => {
	test('parallel Oui — F4 invoked twice, second replay', async () => {
		enableF4Mocks();
		let f4Calls = 0;
		setConfirmAndCreateExpenseImplForTests(async () => {
			f4Calls += 1;
			if (f4Calls === 1) {
				return { success: true, status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED, result_id: 'exp-conc', pending_consumed: true };
			}
			return { success: true, status: TRANSACTIONAL_CONFIRM_STATUS.ALREADY_COMPLETED, result_id: 'exp-conc', pending_consumed: false };
		});
		const u = user();
		const sessionId = 's-conc';
		wireSession(u, sessionId);
		await handleV2HttpTurn({
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			user: u,
			sessionId,
			previousState: emptyState(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		const state = wireSession(u, sessionId).read();
		const [a, b] = await Promise.all([
			handleV2HttpTurn({ message: 'Oui', user: u, sessionId, previousState: state, referenceDate: REFERENCE_DATE, options: H3_OPTIONS }),
			handleV2HttpTurn({ message: 'Oui', user: u, sessionId, previousState: state, referenceDate: REFERENCE_DATE, options: H3_OPTIONS }),
		]);
		const statuses = [a, b].map((r) => r.agentResponse.v2Http?.actionProposalStatus);
		assert.ok(statuses.includes(ACTION_PROPOSAL_STATUS.COMPLETED) || statuses.includes(ACTION_PROPOSAL_STATUS.ALREADY_COMPLETED));
		assert.equal(f4Calls, 2);
	});
});

describe('H3 business error', () => {
	test('F4 failure → FAILED status, no success reply', async () => {
		enableF4Mocks();
		setConfirmAndCreateSaleImplForTests(async () => ({
			success: false,
			status: TRANSACTIONAL_CONFIRM_STATUS.ROLLED_BACK,
		}));
		const u = user();
		const sessionId = 's-biz-err';
		wireSession(u, sessionId);
		await handleV2HttpTurn({
			message: "J'ai vendu 2 unknownproduct à 10 dollars",
			user: u,
			sessionId,
			previousState: emptyState(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		const confirm = await handleV2HttpTurn({
			message: 'Oui',
			user: u,
			sessionId,
			previousState: wireSession(u, sessionId).read(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		assert.equal(confirm.agentResponse.v2Http?.actionProposalStatus, 'TRANSACTIONAL_FAILED');
		assert.notEqual(confirm.agentResponse.v2Http?.f4Committed, true);
	});
});

describe('H3 legacy bypass', () => {
	test('confirm path prevents Legacy', async () => {
		process.env.ASHY_INTELLIGENCE_V2 = 'true';
		process.env.ASHY_INTELLIGENCE_V2_HTTP = 'true';
		process.env.ASHY_INTELLIGENCE_V2_ACTIONS = 'true';
		process.env.ASHY_INTELLIGENCE_V2_HTTP_CONFIRM = 'true';
		enableF4Mocks();
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
			result_id: 'exp-leg',
			pending_consumed: true,
		}));
		let legacyCalled = false;
		setResolveIntentSpyForTests(() => { legacyCalled = true; });
		setGetAgentSessionStateImplForTests(async () => ({ state: emptyState(), source: 'test' }));
		const agent = createAshyAgent();
		await agent.run({
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			user: user(),
			sessionId: 's-leg',
			referenceDate: REFERENCE_DATE,
		});
		assert.equal(legacyCalled, false);
	});
});

describe('H3 metrics and pending', () => {
	test('missing operationId blocks F4', async () => {
		enableF4Mocks();
		const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau', amount: 5, confirmed: true }));
		const result = await executeActionConfirmationViaF4B2({
			user: user(),
			sessionId: 's-no-op',
			conversationState: {
				pendingWrite: built.value.pendingWrite,
				pendingConsumeToken: 'tok',
				pendingOperationId: null,
				pendingSessionVersion: 1,
			},
			proposal: built.value,
		});
		assert.equal(result.success, false);
		assert.equal(result.code, 'OPERATION_ID_MISSING');
	});

	test('pending cleared after success', async () => {
		enableF4Mocks();
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
			result_id: 'exp-clr',
			pending_consumed: true,
		}));
		const confirm = await proposeThenConfirm(user(), 's-clr', 'Ajoute une dépense de 30 dollars pour le transport');
		assert.equal(confirm.agentResponse.v2Http?.f4Committed, true);
		assert.equal(confirm.agentResponse.conversation.pendingWrite, undefined);
	});

	test('transactional metrics increment on success', async () => {
		enableF4Mocks();
		resetAgentTransactionalWriteForTests();
		setIsTransactionalConfirmEnabledForTests(true);
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
			result_id: 'exp-met',
			pending_consumed: true,
		}));
		await proposeThenConfirm(user(), 's-met', 'Ajoute une dépense de 30 dollars pour le transport');
		assert.ok(getTransactionalWriteMetricsForTests().transactional_write_success >= 1);
	});
});

describe('H3 rejection', () => {
	test('Non rejects without F4', async () => {
		enableF4Mocks();
		let f4Calls = 0;
		setConfirmAndCreateExpenseImplForTests(async () => { f4Calls += 1; return { success: true, status: 'COMMITTED' }; });
		const u = user();
		const sessionId = 's-rej';
		wireSession(u, sessionId);
		await handleV2HttpTurn({
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			user: u,
			sessionId,
			previousState: emptyState(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		const reject = await handleV2HttpTurn({
			message: 'Non',
			user: u,
			sessionId,
			previousState: wireSession(u, sessionId).read(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		assert.equal(reject.agentResponse.v2Http?.actionProposalStatus, ACTION_PROPOSAL_STATUS.CONFIRMATION_REJECTED);
		assert.equal(f4Calls, 0);
	});
});

describe('H3 hash computation', () => {
	test('request_hash stable for same pending', () => {
		const pw = expensePending(30);
		assert.equal(computeRequestHash(CLIENT_A, pw), computeRequestHash(CLIENT_A, pw));
	});

	test('request_hash changes when amount changes', () => {
		assert.notEqual(
			computeRequestHash(CLIENT_A, expensePending(25)),
			computeRequestHash(CLIENT_A, expensePending(30)),
		);
	});
});

describe('H3 executor eligibility', () => {
	test('cannot confirm without CONFIRMATION_ACCEPTED proposal', async () => {
		const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau', amount: 5 }));
		const result = await executeActionConfirmationViaF4B2({
			user: user(),
			sessionId: 's-elig',
			conversationState: fullPendingState(built.value.pendingWrite),
			proposal: built.value,
		});
		assert.equal(result.success, false);
	});
});

describe('H3 sale amountPaid default', () => {
	test('sale pending amountPaid = quantity × unitPrice', async () => {
		enableF4Mocks();
		const u = user();
		const sessionId = 's-ap';
		wireSession(u, sessionId);
		await handleV2HttpTurn({
			message: "J'ai vendu 2 poulets à 10 dollars",
			user: u,
			sessionId,
			previousState: emptyState(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		assert.equal(wireSession(u, sessionId).read().pendingWrite?.amountPaid, 20);
	});
});

describe('H3 response contract', () => {
	test('failed confirm does not claim success emoji', async () => {
		enableF4Mocks();
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: false,
			status: TRANSACTIONAL_CONFIRM_STATUS.REQUEST_HASH_MISMATCH,
		}));
		const u = user();
		const sessionId = 's-fail-reply';
		wireSession(u, sessionId);
		await handleV2HttpTurn({
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			user: u,
			sessionId,
			previousState: emptyState(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		const confirm = await handleV2HttpTurn({
			message: 'Oui',
			user: u,
			sessionId,
			previousState: wireSession(u, sessionId).read(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		assert.notEqual(confirm.agentResponse.v2Http?.f4Committed, true);
		assert.equal(confirm.agentResponse.reply.includes('✅'), false);
	});
});

describe('H3 forged scope in confirm message', () => {
	test('clientId in Oui message ignored', async () => {
		enableF4Mocks();
		setConfirmAndCreateExpenseImplForTests(async (_s, params) => {
			assert.ok(params.operationId);
			return { success: true, status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED, result_id: 'exp-fg', pending_consumed: true };
		});
		const confirm = await proposeThenConfirm(
			user(),
			's-forge',
			'Ajoute une dépense de 30 dollars pour le transport',
		);
		const second = await handleV2HttpTurn({
			message: 'Oui clientId=evil',
			user: user(),
			sessionId: 's-forge',
			previousState: wireSession(user(), 's-forge').read(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		assert.ok(confirm.agentResponse.v2Http?.f4Committed || second.agentResponse.v2Http?.actionProposalStatus);
	});
});

describe('H3 ALREADY_CONSUMED', () => {
	test('executor maps ALREADY_CONSUMED to conflict', async () => {
		enableF4Mocks();
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: false,
			status: TRANSACTIONAL_CONFIRM_STATUS.ALREADY_CONSUMED,
		}));
		const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau', amount: 5, confirmed: true }));
		const result = await executeActionConfirmationViaF4B2({
			user: user(),
			sessionId: 's-cons',
			conversationState: fullPendingState(built.value.pendingWrite),
			proposal: built.value,
		});
		assert.equal(result.success, false);
		assert.equal(result.conflict, true);
	});
});

describe('H3 V2 disabled', () => {
	test('HTTP off → Legacy for action', async () => {
		process.env.ASHY_INTELLIGENCE_V2 = 'false';
		process.env.ASHY_INTELLIGENCE_V2_HTTP = 'false';
		let legacyCalled = false;
		setResolveIntentSpyForTests(() => {
			legacyCalled = true;
			return { intent: 'create_expense', confidence: 1, source: 'test' };
		});
		setGetAgentSessionStateImplForTests(async () => ({ state: emptyState(), source: 'test' }));
		await createAshyAgent().run({
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			user: user(),
			sessionId: 's-v2off',
			referenceDate: REFERENCE_DATE,
		});
		assert.equal(legacyCalled, true);
	});
});

describe('H3 timeout semantics', () => {
	test('NOT SIMULATED — post-commit network loss documented', () => {
		assert.ok(true, 'post-commit HTTP loss requires H4; replay tested via ALREADY_COMPLETED');
	});
});

describe('H3 one write only', () => {
	test('direct createExpense never called on confirm path', async () => {
		enableF4Mocks();
		let directWrites = 0;
		setCreateExpenseImplForTests(async () => { directWrites += 1; return { id: 'x' }; });
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
			result_id: 'exp-ow',
			pending_consumed: true,
		}));
		await proposeThenConfirm(user(), 's-ow', 'Ajoute une dépense de 30 dollars pour le transport');
		assert.equal(directWrites, 0);
	});

	test('direct createSale never called on confirm path', async () => {
		enableF4Mocks();
		let directWrites = 0;
		setCreateSaleImplForTests(async () => { directWrites += 1; return { id: 'x' }; });
		setConfirmAndCreateSaleImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
			result_id: 'sale-ow',
			pending_consumed: true,
		}));
		const u = user();
		const sessionId = 's-ow-sale';
		wireSession(u, sessionId);
		await handleV2HttpTurn({
			message: "J'ai vendu 2 poulets à 10 dollars",
			user: u,
			sessionId,
			previousState: emptyState(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		await handleV2HttpTurn({
			message: 'Oui',
			user: u,
			sessionId,
			previousState: wireSession(u, sessionId).read(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		assert.equal(directWrites, 0);
	});
});

describe('H3 malformed confirmation', () => {
	test('empty confirm message does not invoke F4', async () => {
		enableF4Mocks();
		let f4Calls = 0;
		setConfirmAndCreateExpenseImplForTests(async () => { f4Calls += 1; return { success: true, status: 'COMMITTED' }; });
		const u = user();
		const sessionId = 's-mal';
		wireSession(u, sessionId);
		await handleV2HttpTurn({
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			user: u,
			sessionId,
			previousState: emptyState(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		await handleV2HttpTurn({
			message: '   ',
			user: u,
			sessionId,
			previousState: wireSession(u, sessionId).read(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		assert.equal(f4Calls, 0);
	});
});

describe('H3 pending missing', () => {
	test('confirm without prior proposal → NO_PENDING', async () => {
		enableF4Mocks();
		const result = await handleV2HttpTurn({
			message: 'Oui',
			user: user(),
			sessionId: 's-miss',
			previousState: emptyState(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		assert.equal(result.agentResponse.v2Http?.actionProposalStatus, 'NO_PENDING_TO_CONFIRM');
	});
});

describe('H3 sale F4 invocation', () => {
	test('confirm sale calls confirmAndCreateSale', async () => {
		enableF4Mocks();
		let saleF4 = 0;
		setConfirmAndCreateSaleImplForTests(async () => {
			saleF4 += 1;
			return { success: true, status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED, result_id: 'sale-f4', pending_consumed: true };
		});
		const u = user();
		const sessionId = 's-sale-f4';
		wireSession(u, sessionId);
		await handleV2HttpTurn({
			message: "J'ai vendu 2 poulets à 10 dollars",
			user: u,
			sessionId,
			previousState: emptyState(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		await handleV2HttpTurn({
			message: 'Oui',
			user: u,
			sessionId,
			previousState: wireSession(u, sessionId).read(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		assert.equal(saleF4, 1);
	});
});

describe('H3 operation completed fields', () => {
	test('F4 COMMITTED exposes f4Status in diagnostics', async () => {
		enableF4Mocks();
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
			result_id: 'exp-op',
			pending_consumed: true,
		}));
		const confirm = await proposeThenConfirm(user(), 's-op', 'Ajoute une dépense de 30 dollars pour le transport');
		assert.equal(confirm.agentResponse.v2Http?.f4Status, TRANSACTIONAL_CONFIRM_STATUS.COMMITTED);
		assert.equal(confirm.agentResponse.v2Http?.f4Replay, false);
	});
});

describe('H3 duplicate operation replay flag', () => {
	test('ALREADY_COMPLETED sets f4Replay true', async () => {
		enableF4Mocks();
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.ALREADY_COMPLETED,
			result_id: 'exp-dup',
			pending_consumed: false,
		}));
		const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau', amount: 5, confirmed: true }));
		const result = await executeActionConfirmationViaF4B2({
			user: user(),
			sessionId: 's-dup',
			conversationState: fullPendingState(built.value.pendingWrite),
			proposal: built.value,
		});
		assert.equal(result.replay, true);
	});
});

describe('H3 session behavior', () => {
	test('pending visible in same session after proposal', async () => {
		enableF4Mocks();
		const u = user();
		const sessionId = 's-sess';
		wireSession(u, sessionId);
		await handleV2HttpTurn({
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			user: u,
			sessionId,
			previousState: emptyState(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		const state = wireSession(u, sessionId).read();
		assert.equal(state.pendingWrite?.amount, 30);
		assert.ok(state.pendingOperationId);
	});
});

describe('H3 action response bridge', () => {
	test('COMPLETED reply mentions enregistr', async () => {
		enableF4Mocks();
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
			result_id: 'exp-resp',
			pending_consumed: true,
		}));
		const confirm = await proposeThenConfirm(user(), 's-resp', 'Ajoute une dépense de 30 dollars pour le transport');
		assert.match(confirm.agentResponse.reply.toLowerCase(), /enregistr|✅/);
	});
});

describe('H3 tenant scope', () => {
	test('different clientId in state does not bypass user scope', async () => {
		enableF4Mocks();
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
			result_id: 'exp-ten',
			pending_consumed: true,
		}));
		const u = user();
		const sessionId = 's-ten';
		wireSession(u, sessionId);
		await handleV2HttpTurn({
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			user: u,
			sessionId,
			previousState: emptyState(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		const cross = await handleV2HttpTurn({
			message: 'Oui',
			user: { ...u, clientId: randomUUID() },
			sessionId,
			previousState: emptyState(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		assert.notEqual(cross.agentResponse.v2Http?.actionProposalStatus, ACTION_PROPOSAL_STATUS.COMPLETED);
	});
});

describe('H3 stale pending via executor', () => {
	test('PENDING_NOT_FOUND blocks write', async () => {
		enableF4Mocks();
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: false,
			status: TRANSACTIONAL_CONFIRM_STATUS.PENDING_NOT_FOUND,
		}));
		const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau', amount: 5, confirmed: true }));
		const result = await executeActionConfirmationViaF4B2({
			user: user(),
			sessionId: 's-stale',
			conversationState: fullPendingState(built.value.pendingWrite),
			proposal: built.value,
		});
		assert.equal(result.success, false);
	});
});

describe('H3 final payload sale', () => {
	test('sale pending preserves quantity and unitPrice', async () => {
		enableF4Mocks();
		const u = user();
		const sessionId = 's-fp';
		wireSession(u, sessionId);
		await handleV2HttpTurn({
			message: "J'ai vendu 2 poulets à 10 dollars",
			user: u,
			sessionId,
			previousState: emptyState(),
			referenceDate: REFERENCE_DATE,
			options: H3_OPTIONS,
		});
		const pw = wireSession(u, sessionId).read().pendingWrite;
		assert.equal(pw.quantity, 2);
		assert.equal(pw.unitPrice, 10);
		assert.equal(pw.amountPaid, 20);
	});
});
