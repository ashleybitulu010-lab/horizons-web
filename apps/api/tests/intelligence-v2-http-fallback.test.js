import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { ACTION_PROPOSAL_STATUS } from '../src/agent/intelligence-v2/action/action-proposal-contract.js';
import {
	attachFallbackPolicyToV2Http,
	resolveV2FallbackPolicy,
	V2_FALLBACK_POLICY,
} from '../src/agent/intelligence-v2/v2-fallback-policy.js';
import { handleV2HttpTurn } from '../src/agent/intelligence-v2/v2-http-handler.js';
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
	setIsIdempotentConfirmEnabledForTests,
	setIsTransactionalConfirmEnabledForTests,
	TRANSACTIONAL_CONFIRM_STATUS,
} from '../src/services/agent-transactional-write-service.js';

const H3_ENV = {
	ashyIntelligenceV2: true,
	ashyIntelligenceV2Http: true,
	ashyIntelligenceV2Actions: true,
	ashyIntelligenceV2HttpConfirm: true,
	ashyIntelligenceV2Shadow: false,
};

function user() {
	return {
		id: 'pb-h4',
		clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		activeActivityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
		businessUserId: 'rec-h4',
	};
}

function emptyState(overrides = {}) {
	return {
		topic: null,
		intent: null,
		filters: {},
		references: {},
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

afterEach(() => {
	resetAgentSessionReaderForTests();
	resetAgentSessionWriterForTests();
	resetAgentTransactionalWriteForTests();
	setIsSupabaseConfiguredForTests(false);
});

describe('H4 fallback policy — READ', () => {
	test('READ question → SAFE_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'QUESTION',
			goalDomain: 'SALES',
		});
		assert.equal(r.policy, V2_FALLBACK_POLICY.SAFE_FALLBACK);
		assert.equal(r.noN8nFallback, false);
	});

	test('ANALYSIS → SAFE_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({ handled: true, goalType: 'ANALYSIS' });
		assert.equal(r.policy, V2_FALLBACK_POLICY.SAFE_FALLBACK);
	});

	test('MIXED → SAFE_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({ handled: true, goalType: 'MIXED' });
		assert.equal(r.policy, V2_FALLBACK_POLICY.SAFE_FALLBACK);
	});

	test('not handled → SAFE_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({ handled: false });
		assert.equal(r.policy, V2_FALLBACK_POLICY.SAFE_FALLBACK);
	});
});

describe('H4 fallback policy — ACTION', () => {
	test('proposal → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			goalType: 'ACTION',
			actionProposalStatus: ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION,
		});
		assert.equal(r.policy, V2_FALLBACK_POLICY.NO_FALLBACK);
		assert.equal(r.noN8nFallback, true);
	});

	test('clarification → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			actionProposalStatus: ACTION_PROPOSAL_STATUS.NEEDS_CLARIFICATION,
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('rejected → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			actionProposalStatus: ACTION_PROPOSAL_STATUS.CONFIRMATION_REJECTED,
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('COMMITTED → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			f4Committed: true,
			f4Status: 'COMMITTED',
			actionProposalStatus: ACTION_PROPOSAL_STATUS.COMPLETED,
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('ALREADY_COMPLETED → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			f4Committed: true,
			actionProposalStatus: ACTION_PROPOSAL_STATUS.ALREADY_COMPLETED,
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('TRANSACTIONAL_FAILED → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			actionProposalStatus: 'TRANSACTIONAL_FAILED',
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('hash mismatch → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			actionProposalStatus: 'REQUEST_HASH_MISMATCH',
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('pending flag → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			hasPending: true,
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('missing scope → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			code: 'MISSING_SCOPE',
			goalType: 'ACTION',
			mode: 'action_proposal',
		});
		assert.equal(r.noN8nFallback, true);
	});
});

describe('H4 attachFallbackPolicyToV2Http', () => {
	test('enriches v2Http with noN8nFallback and fallbackPolicy', () => {
		const enriched = attachFallbackPolicyToV2Http({
			handled: true,
			mode: 'action_proposal',
			actionProposalStatus: 'READY_FOR_CONFIRMATION',
		});
		assert.equal(enriched.noN8nFallback, true);
		assert.equal(enriched.fallbackPolicy, V2_FALLBACK_POLICY.NO_FALLBACK);
		assert.ok(enriched.fallbackReason);
	});
});

describe('H4 HTTP handler exposes fallback contract', () => {
	test('action proposal includes noN8nFallback on agentResponse', async () => {
		setGetAgentSessionStateImplForTests(async () => ({ state: emptyState(), source: 'test' }));
		const result = await handleV2HttpTurn({
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			user: user(),
			sessionId: 's-h4-prop',
			previousState: emptyState(),
			options: { forceHttp: true, env: { ...H3_ENV, ashyIntelligenceV2HttpConfirm: true } },
		});
		assert.equal(result.handled, true);
		assert.equal(result.agentResponse.noN8nFallback, true);
		assert.equal(result.agentResponse.fallbackPolicy, V2_FALLBACK_POLICY.NO_FALLBACK);
	});

	test('read question includes consistent fallback policy (H6 NO_DATA/PARTIAL → NO_FALLBACK)', async () => {
		setGetAgentSessionStateImplForTests(async () => ({ state: emptyState(), source: 'test' }));
		const result = await handleV2HttpTurn({
			message: 'Combien ai-je vendu ce mois-ci ?',
			user: user(),
			sessionId: 's-h4-read',
			previousState: emptyState(),
			options: { forceHttp: true, env: H3_ENV },
		});
		assert.equal(result.handled, true);
		assert.equal(
			result.agentResponse.noN8nFallback,
			result.agentResponse.v2Http?.noN8nFallback,
		);
		assert.equal(
			result.agentResponse.fallbackPolicy,
			result.agentResponse.v2Http?.fallbackPolicy,
		);
		const execCode = result.agentResponse.v2Http?.executionCode;
		if (execCode === 'NO_DATA' || execCode === 'PARTIAL') {
			assert.equal(result.agentResponse.fallbackPolicy, V2_FALLBACK_POLICY.NO_FALLBACK);
		}
	});

	const ACTION_STATUSES = [
		'NO_PENDING_TO_CONFIRM',
		'NO_PENDING_TO_REJECT',
		'VERSION_MISMATCH',
		'ALREADY_CONSUMED',
		'PENDING_NOT_FOUND',
		'OPERATION_ID_MISSING',
		'F4_B2_UNAVAILABLE',
		ACTION_PROPOSAL_STATUS.MODIFICATION_DETECTED,
		ACTION_PROPOSAL_STATUS.CONFIRMED,
	];

	for (const status of ACTION_STATUSES) {
		test(`action status ${status} → NO_FALLBACK`, () => {
			const r = resolveV2FallbackPolicy({
				handled: true,
				mode: 'action_proposal',
				actionProposalStatus: status,
			});
			assert.equal(r.noN8nFallback, true);
		});
	}

	test('confirm COMMITTED includes noN8nFallback', async () => {
		setIsSupabaseConfiguredForTests(true);
		setIsTransactionalConfirmEnabledForTests(true);
		setIsIdempotentConfirmEnabledForTests(true);
		setConfirmAndCreateExpenseImplForTests(async () => ({
			success: true,
			status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
			result_id: 'exp-h4',
			pending_consumed: true,
		}));
		setGetAgentSessionStateImplForTests(async () => ({ state: emptyState(), source: 'test' }));
		await handleV2HttpTurn({
			message: 'Ajoute une dépense de 30 dollars pour le transport',
			user: user(),
			sessionId: 's-h4-c',
			previousState: emptyState(),
			options: { forceHttp: true, env: H3_ENV },
		});
		const confirm = await handleV2HttpTurn({
			message: 'Oui',
			user: user(),
			sessionId: 's-h4-c',
			previousState: emptyState({
				pendingWrite: { tool: 'create_expense', label: 'transport', amount: 30 },
				pendingOperationId: '11111111-1111-4111-8111-111111111111',
				pendingConsumeToken: 'tok',
				pendingSessionVersion: 1,
			}),
			options: { forceHttp: true, env: H3_ENV },
		});
		assert.equal(confirm.agentResponse.noN8nFallback, true);
		assert.equal(confirm.agentResponse.v2Http?.f4Committed, true);
	});
});

describe('H4 policy matrix — f4 statuses', () => {
	for (const f4Status of ['COMMITTED', 'ALREADY_COMPLETED']) {
		test(`f4Status ${f4Status} → NO_FALLBACK`, () => {
			const r = resolveV2FallbackPolicy({
				handled: true,
				mode: 'action_proposal',
				f4Status,
			});
			assert.equal(r.noN8nFallback, true);
		});
	}
});

describe('H4 policy reasons', () => {
	test('attach null returns null', () => {
		assert.equal(attachFallbackPolicyToV2Http(null), null);
	});

	test('action default without status still NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			mode: 'action_proposal',
			goalType: 'ACTION',
		});
		assert.equal(r.noN8nFallback, true);
		assert.equal(r.reason, 'action_v2');
	});

	test('read reason is read_v2', () => {
		const r = resolveV2FallbackPolicy({ handled: true, goalType: 'QUESTION' });
		assert.equal(r.reason, 'read_v2');
	});
});

describe('H4 ACTION goalType without mode', () => {
	test('goalType ACTION alone → NO_FALLBACK', () => {
		const r = resolveV2FallbackPolicy({ handled: true, goalType: 'ACTION' });
		assert.equal(r.noN8nFallback, true);
	});
});

describe('H4 attachFallbackPolicy preserves fields', () => {
	test('preserves existing diagnostics', () => {
		const enriched = attachFallbackPolicyToV2Http({
			handled: true,
			goalType: 'QUESTION',
			goalDomain: 'SALES',
			executionCode: 'OK',
		});
		assert.equal(enriched.goalDomain, 'SALES');
		assert.equal(enriched.executionCode, 'OK');
		assert.equal(enriched.fallbackPolicy, V2_FALLBACK_POLICY.SAFE_FALLBACK);
	});
});

describe('H4 clarification proposal', () => {
	test('NEEDS_CLARIFICATION HTTP turn blocks n8n fallback', async () => {
		setGetAgentSessionStateImplForTests(async () => ({ state: emptyState(), source: 'test' }));
		const result = await handleV2HttpTurn({
			message: 'Ajoute une dépense pour le transport',
			user: user(),
			sessionId: 's-h4-clar',
			previousState: emptyState(),
			options: { forceHttp: true, env: H3_ENV },
		});
		assert.equal(result.agentResponse.noN8nFallback, true);
		assert.equal(result.agentResponse.v2Http?.actionProposalStatus, 'NEEDS_CLARIFICATION');
	});
});

describe('H4 rejection path', () => {
	test('Non with pending blocks n8n fallback', async () => {
		setGetAgentSessionStateImplForTests(async () => ({ state: emptyState(), source: 'test' }));
		const state = emptyState({
			pendingWrite: { tool: 'create_expense', label: 'transport', amount: 30 },
		});
		setGetAgentSessionStateImplForTests(async () => ({ state, source: 'test' }));
		const result = await handleV2HttpTurn({
			message: 'Non',
			user: user(),
			sessionId: 's-h4-rej',
			previousState: state,
			options: { forceHttp: true, env: H3_ENV },
		});
		assert.equal(result.agentResponse.noN8nFallback, true);
	});
});

describe('H4 ambiguous action error path', () => {
	test('pending confirm path sets NO_FALLBACK on reject without pending', async () => {
		setGetAgentSessionStateImplForTests(async () => ({ state: emptyState(), source: 'test' }));
		const result = await handleV2HttpTurn({
			message: 'Oui',
			user: user(),
			sessionId: 's-h4-nop',
			previousState: emptyState(),
			options: { forceHttp: true, env: H3_ENV },
		});
		assert.equal(result.agentResponse.noN8nFallback, true);
		assert.equal(result.agentResponse.v2Http?.actionProposalStatus, 'NO_PENDING_TO_CONFIRM');
	});
});

describe('H4 exhaustive policy coverage', () => {
	const readTypes = ['QUESTION', 'ANALYSIS', 'MIXED'];
	for (const goalType of readTypes) {
		test(`READ ${goalType} never sets noN8nFallback true`, () => {
			const r = resolveV2FallbackPolicy({ handled: true, goalType });
			assert.equal(r.noN8nFallback, false);
		});
	}

	const actionStatuses = [
		ACTION_PROPOSAL_STATUS.COMPLETED,
		ACTION_PROPOSAL_STATUS.ALREADY_COMPLETED,
		ACTION_PROPOSAL_STATUS.FAILED,
		ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION,
	];
	for (const status of actionStatuses) {
		test(`policy blocks fallback for ${status}`, () => {
			assert.equal(resolveV2FallbackPolicy({
				handled: true,
				mode: 'action_proposal',
				actionProposalStatus: status,
			}).noN8nFallback, true);
		});
	}

	test('f4Committed overrides read-shaped goalType', () => {
		const r = resolveV2FallbackPolicy({
			handled: true,
			goalType: 'QUESTION',
			mode: 'action_proposal',
			f4Committed: true,
		});
		assert.equal(r.noN8nFallback, true);
	});

	test('attachFallbackPolicy adds fallbackReason', () => {
		const e = attachFallbackPolicyToV2Http({ handled: true, goalType: 'QUESTION' });
		assert.equal(e.fallbackReason, 'read_v2');
	});

	test('null v2Http handled false', () => {
		assert.equal(resolveV2FallbackPolicy(null).reason, 'not_v2');
	});

	test('empty object handled false', () => {
		assert.equal(resolveV2FallbackPolicy({}).policy, V2_FALLBACK_POLICY.SAFE_FALLBACK);
	});
});

describe('H4 sale action proposal fallback', () => {
	test('sale proposal blocks n8n fallback', async () => {
		setGetAgentSessionStateImplForTests(async () => ({ state: emptyState(), source: 'test' }));
		const result = await handleV2HttpTurn({
			message: "J'ai vendu 2 poulets à 10 dollars",
			user: user(),
			sessionId: 's-h4-sale',
			previousState: emptyState(),
			options: { forceHttp: true, env: H3_ENV },
		});
		assert.equal(result.agentResponse.noN8nFallback, true);
	});
});

describe('H4 v2Http nested contract', () => {
	test('top-level noN8nFallback mirrors v2Http for READ', async () => {
		setGetAgentSessionStateImplForTests(async () => ({ state: emptyState(), source: 'test' }));
		const result = await handleV2HttpTurn({
			message: 'Combien ai-je vendu ce mois-ci ?',
			user: user(),
			sessionId: 's-h4-top',
			previousState: emptyState(),
			options: { forceHttp: true, env: H3_ENV },
		});
		assert.equal(
			result.agentResponse.noN8nFallback,
			result.agentResponse.v2Http?.noN8nFallback,
		);
	});

	test('v2Http carries noN8nFallback mirror', async () => {
		setGetAgentSessionStateImplForTests(async () => ({ state: emptyState(), source: 'test' }));
		const result = await handleV2HttpTurn({
			message: 'Combien ai-je dépensé ce mois-ci ?',
			user: user(),
			sessionId: 's-h4-nested',
			previousState: emptyState(),
			options: { forceHttp: true, env: H3_ENV },
		});
		assert.equal(
			result.agentResponse.v2Http?.noN8nFallback,
			result.agentResponse.noN8nFallback,
		);
		assert.ok(result.agentResponse.v2Http?.fallbackPolicy);
	});
});
