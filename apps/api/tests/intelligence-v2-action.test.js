import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ACTION_PROPOSAL_STATUS,
	ACTION_TYPES,
	buildPendingWriteDraft,
	createEmptyInternalActionProposal,
	toUserFacingActionProposal,
	validateInternalActionProposal,
	validateUserFacingActionProposal,
} from '../src/agent/intelligence-v2/action/action-proposal-contract.js';
import {
	buildActionProposalFromGoal,
	buildActionProposalFromPendingWrite,
	buildActionProposalFromPlanStep,
	buildExpenseActionGoal,
	buildSaleActionGoal,
} from '../src/agent/intelligence-v2/action/action-proposal-builder.js';
import {
	assertNotFinancialAnalysis,
	canConfirmActionProposal,
	detectActionFieldChanges,
	validateActionProposalBusinessRules,
	validateActionProposalForPersistence,
} from '../src/agent/intelligence-v2/action/action-proposal-validator.js';
import {
	detectUserActionIntent,
	parseModificationChanges,
	resolveActionProposalFromContext,
	USER_ACTION_INTENT,
} from '../src/agent/intelligence-v2/action/action-confirmation-handler.js';
import { buildConversationPatchFromProposal } from '../src/agent/intelligence-v2/action/action-pending-bridge.js';
import { executeActionConfirmationViaF4B2 } from '../src/agent/intelligence-v2/action/action-f4-executor.js';
import { runV2ActionFlow } from '../src/agent/intelligence-v2/action/action-orchestrator.js';
import { buildActionResponseText } from '../src/agent/intelligence-v2/action/action-response-bridge.js';
import {
	getActionMetricsForTests,
	resetActionMetricsForTests,
	sanitizeActionProposalForLog,
} from '../src/agent/intelligence-v2/action/action-observability.js';
import { isIntelligenceV2ActionsEnabled } from '../src/agent/intelligence-v2/config.js';
import { generateResponse } from '../src/agent/intelligence-v2/response/response-generator.js';
import {
	resetAgentTransactionalWriteForTests,
	setConfirmAndCreateExpenseImplForTests,
	setIsIdempotentConfirmEnabledForTests,
	setIsTransactionalConfirmEnabledForTests,
	TRANSACTIONAL_CONFIRM_STATUS,
} from '../src/services/agent-transactional-write-service.js';
import { runV2AnalysisPlan } from '../src/agent/intelligence-v2/v2-orchestrator.js';

// Contract
test('contract: validateInternalActionProposal accepts complete expense proposal', () => {
	const result = validateInternalActionProposal(createEmptyInternalActionProposal({
		actionType: ACTION_TYPES.CREATE_EXPENSE,
		tool: 'create_expense',
		status: ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION,
		fields: { label: 'Transport', amount: 25 },
		pendingWrite: { tool: 'create_expense', label: 'Transport', amount: 25 },
		description: 'Enregistrer une dépense de 25 $ pour « Transport »',
		confirmationRequired: true,
	}));
	assert.equal(result.valid, true);
	assert.equal(result.value.fields.amount, 25);
});

test('contract: rejects UUID in fields', () => {
	const result = validateInternalActionProposal(createEmptyInternalActionProposal({
		actionType: ACTION_TYPES.CREATE_EXPENSE,
		tool: 'create_expense',
		status: ACTION_PROPOSAL_STATUS.NEEDS_CLARIFICATION,
		fields: { label: '550e8400-e29b-41d4-a716-446655440000', amount: null },
	}));
	assert.equal(result.valid, false);
	assert.equal(result.error, 'UUID_NOT_ALLOWED');
});

test('contract: toUserFacingActionProposal strips internal keys', () => {
	const internal = createEmptyInternalActionProposal({
		actionType: ACTION_TYPES.CREATE_SALE,
		tool: 'create_sale',
		status: ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION,
		fields: {
			product: 'Poulet',
			quantity: 2,
			unitPrice: 10,
			amountPaid: 20,
		},
		pendingWrite: {
			tool: 'create_sale',
			product: 'Poulet',
			quantity: 2,
			unitPrice: 10,
			amountPaid: 20,
		},
		description: 'Enregistrer 2 Poulet à 10 $ encaissé 20 $',
		confirmationRequired: true,
		pendingOperationId: 'op-123',
		pendingConsumeToken: 'tok-456',
	});

	const facing = toUserFacingActionProposal(internal);
	assert.equal(facing.valid, true);
	assert.equal(facing.value.actionType, ACTION_TYPES.CREATE_SALE);
	assert.equal(facing.value.confirmationRequired, true);
	assert.equal('pendingOperationId' in facing.value, false);
	assert.equal('pendingConsumeToken' in facing.value, false);
	assert.equal('tool' in facing.value, false);
});

test('contract: buildPendingWriteDraft matches conversation-state shape', () => {
	const proposal = createEmptyInternalActionProposal({
		actionType: ACTION_TYPES.CREATE_EXPENSE,
		tool: 'create_expense',
		status: ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION,
		fields: { label: 'Loyer', amount: 300 },
	});
	const draft = buildPendingWriteDraft(proposal);
	assert.equal(draft.valid, true);
	assert.deepEqual(draft.value, {
		tool: 'create_expense',
		label: 'Loyer',
		amount: 300,
	});
});

test('contract: user-facing rejects forbidden scope keys', () => {
	const result = validateUserFacingActionProposal({
		actionType: ACTION_TYPES.CREATE_EXPENSE,
		status: ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION,
		description: 'test',
		fields: { label: 'x', amount: 1 },
		clientId: 'secret',
	});
	assert.equal(result.valid, false);
	assert.equal(result.error, 'USER_FACING_FORBIDDEN_KEY');
});

// Builder — expense
test('builder: expense complete → READY_FOR_CONFIRMATION + pendingWrite', () => {
	const goal = buildExpenseActionGoal({ label: 'Essence', amount: 40 });
	const result = buildActionProposalFromGoal(goal);
	assert.equal(result.valid, true);
	assert.equal(result.value.status, ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION);
	assert.equal(result.value.confirmationRequired, true);
	assert.deepEqual(result.value.pendingWrite, {
		tool: 'create_expense',
		label: 'Essence',
		amount: 40,
	});
	assert.match(result.value.description, /Essence/);
});

test('builder: expense missing amount → NEEDS_CLARIFICATION', () => {
	const goal = buildExpenseActionGoal({ label: 'Essence' });
	const result = buildActionProposalFromGoal(goal);
	assert.equal(result.valid, true);
	assert.equal(result.value.status, ACTION_PROPOSAL_STATUS.NEEDS_CLARIFICATION);
	assert.deepEqual(result.value.missingFields, ['amount']);
	assert.equal(result.value.pendingWrite, null);
	assert.match(result.value.clarificationPrompt, /montant/i);
});

test('builder: expense confirmed → CONFIRMATION_ACCEPTED', () => {
	const goal = buildExpenseActionGoal({ label: 'Essence', amount: 40, confirmed: true });
	const result = buildActionProposalFromGoal(goal);
	assert.equal(result.valid, true);
	assert.equal(result.value.status, ACTION_PROPOSAL_STATUS.CONFIRMATION_ACCEPTED);
});

// Builder — sale
test('builder: sale complete → READY_FOR_CONFIRMATION', () => {
	const goal = buildSaleActionGoal({
		product: 'Poisson',
		quantity: 3,
		unitPrice: 5,
		amountPaid: 15,
	});
	const result = buildActionProposalFromGoal(goal);
	assert.equal(result.valid, true);
	assert.equal(result.value.status, ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION);
	assert.deepEqual(result.value.fields.product, 'Poisson');
	assert.deepEqual(result.value.pendingWrite?.amountPaid, 15);
});

test('builder: sale missing unitPrice → clarification prompt', () => {
	const goal = buildSaleActionGoal({
		product: 'Poulet',
		quantity: 2,
		amountPaid: 20,
	});
	const result = buildActionProposalFromGoal(goal);
	assert.equal(result.valid, true);
	assert.equal(result.value.status, ACTION_PROPOSAL_STATUS.NEEDS_CLARIFICATION);
	assert.deepEqual(result.value.missingFields, ['unitPrice']);
	assert.match(result.value.clarificationPrompt, /prix/i);
});

test('builder: sale missing amountPaid defaults to quantity × unitPrice', () => {
	const goal = buildSaleActionGoal({
		product: 'Poulet',
		quantity: 2,
		unitPrice: 10,
	});
	const result = buildActionProposalFromGoal(goal);
	assert.equal(result.valid, true);
	assert.equal(result.value.status, ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION);
	assert.deepEqual(result.value.missingFields, []);
	assert.equal(result.value.fields.amountPaid, 20);
});

test('builder: from plan step mirrors goal builder', () => {
	const step = {
		id: 'sale_proposal',
		tool: 'create_sale',
		arguments: {
			product: 'Riz',
			quantity: 1,
			unitPrice: 8,
			amountPaid: 8,
			confirmed: false,
		},
	};
	const result = buildActionProposalFromPlanStep(step);
	assert.equal(result.valid, true);
	assert.equal(result.value.status, ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION);
	assert.equal(result.value.diagnostics.stepId, 'sale_proposal');
});

test('builder: from pendingWrite with confirmed flag', () => {
	const result = buildActionProposalFromPendingWrite({
		tool: 'create_expense',
		label: 'Eau',
		amount: 5,
	}, { confirmed: true });
	assert.equal(result.valid, true);
	assert.equal(result.value.status, ACTION_PROPOSAL_STATUS.CONFIRMATION_ACCEPTED);
});

test('builder: deferred flag → DEFERRED without pendingWrite', () => {
	const goal = buildExpenseActionGoal({ label: 'Eau', amount: 5 });
	const result = buildActionProposalFromGoal(goal, { deferred: true });
	assert.equal(result.valid, true);
	assert.equal(result.value.status, ACTION_PROPOSAL_STATUS.DEFERRED);
	assert.equal(result.value.pendingWrite, null);
});

test('builder: rejects non-action goal', () => {
	const result = buildActionProposalFromGoal({
		type: 'ANALYSIS',
		domain: 'PROFIT',
		objective: 'EXPLAIN',
		parameters: {},
	});
	assert.equal(result.valid, false);
	assert.equal(result.error, 'GOAL_NOT_ACTION_CREATE');
});

// Validator
test('validator: complete expense passes business rules', () => {
	const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau', amount: 5 }));
	const result = validateActionProposalBusinessRules(built.value);
	assert.equal(result.valid, true);
});

test('validator: clarification requires prompt', () => {
	const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau' }));
	const broken = { ...built.value, clarificationPrompt: null };
	const result = validateActionProposalBusinessRules(broken);
	assert.equal(result.valid, false);
	assert.equal(result.error, 'CLARIFICATION_PROMPT_REQUIRED');
});

test('validator: canConfirmActionProposal allows READY and CONFIRMATION_ACCEPTED', () => {
	const ready = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau', amount: 5 }));
	assert.equal(canConfirmActionProposal(ready.value).allowed, true);

	const accepted = buildActionProposalFromGoal(buildExpenseActionGoal({
		label: 'Eau',
		amount: 5,
		confirmed: true,
	}));
	assert.equal(canConfirmActionProposal(accepted.value).allowed, true);
});

test('validator: canConfirmActionProposal rejects NEEDS_CLARIFICATION', () => {
	const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau' }));
	assert.equal(canConfirmActionProposal(built.value).allowed, false);
});

test('validator: detectActionFieldChanges flags amount modification', () => {
	const change = detectActionFieldChanges(
		{ label: 'Eau', amount: 5 },
		{ label: 'Eau', amount: 30 },
		ACTION_TYPES.CREATE_EXPENSE,
	);
	assert.equal(change.isModification, true);
	assert.deepEqual(change.changed, ['amount']);
});

test('validator: assertNotFinancialAnalysis rejects mixed payload', () => {
	const result = assertNotFinancialAnalysis({
		domain: 'PROFIT',
		metrics: {},
	});
	assert.equal(result.valid, false);
	assert.equal(result.error, 'FINANCIAL_ANALYSIS_MIXED_WITH_ACTION');
});

test('validator: validateActionProposalForPersistence checks pendingWrite sync', () => {
	const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau', amount: 5 }));
	const result = validateActionProposalForPersistence(built.value);
	assert.equal(result.valid, true);
});

// Confirmation handler
test('confirmation: detect confirm intent', () => {
	const intent = detectUserActionIntent('oui', {
		pendingWrite: { tool: 'create_expense', label: 'Eau', amount: 5 },
	});
	assert.equal(intent.intent, USER_ACTION_INTENT.CONFIRM);
});

test('confirmation: detect reject intent', () => {
	const intent = detectUserActionIntent('annule', {
		pendingWrite: { tool: 'create_expense', label: 'Eau', amount: 5 },
	});
	assert.equal(intent.intent, USER_ACTION_INTENT.REJECT);
});

test('confirmation: detect modification intent on expense amount', () => {
	const intent = detectUserActionIntent('Finalement c\'était 30$', {
		pendingWrite: { tool: 'create_expense', label: 'Eau', amount: 5 },
	});
	assert.equal(intent.intent, USER_ACTION_INTENT.MODIFY);
	assert.equal(intent.changes.amount, 30);
});

test('confirmation: parse sale amountPaid modification', () => {
	const changes = parseModificationChanges(
		'Finalement j\'ai encaissé 25$',
		ACTION_TYPES.CREATE_SALE,
		{ product: 'Poulet', quantity: 2, unitPrice: 10, amountPaid: 20 },
	);
	assert.equal(changes.amountPaid, 25);
});

test('confirmation: resolve confirm from pending', () => {
	const resolved = resolveActionProposalFromContext({
		message: 'oui',
		conversationContext: {
			pendingWrite: { tool: 'create_expense', label: 'Eau', amount: 5 },
		},
	});
	assert.equal(resolved.valid, true);
	assert.equal(resolved.value.status, ACTION_PROPOSAL_STATUS.CONFIRMATION_ACCEPTED);
});

test('confirmation: resolve reject clears pending flag', () => {
	const resolved = resolveActionProposalFromContext({
		message: 'non',
		conversationContext: {
			pendingWrite: { tool: 'create_expense', label: 'Eau', amount: 5 },
		},
	});
	assert.equal(resolved.valid, true);
	assert.equal(resolved.value.status, ACTION_PROPOSAL_STATUS.CONFIRMATION_REJECTED);
	assert.equal(resolved.shouldClearPending, true);
});

test('confirmation: reject without pending fails', () => {
	const resolved = resolveActionProposalFromContext({ message: 'non', conversationContext: {} });
	assert.equal(resolved.valid, false);
	assert.equal(resolved.error, 'NO_PENDING_TO_REJECT');
});

test('confirmation: modification rebuilds proposal', () => {
	const resolved = resolveActionProposalFromContext({
		message: 'Finalement c\'était 30$',
		conversationContext: {
			pendingWrite: { tool: 'create_expense', label: 'Eau', amount: 5 },
		},
	});
	assert.equal(resolved.valid, true);
	assert.equal(resolved.value.fields.amount, 30);
	assert.equal(resolved.invalidatePendingTokens, true);
});

// Pending bridge
test('pending bridge: patch ready proposal includes pendingWrite', () => {
	const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau', amount: 5 }));
	const patch = buildConversationPatchFromProposal(built.value, {});
	assert.equal(patch.valid, true);
	assert.deepEqual(patch.value.pendingWrite, {
		tool: 'create_expense',
		label: 'Eau',
		amount: 5,
	});
});

test('pending bridge: modification invalidates tokens', () => {
	const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau', amount: 30 }));
	const patch = buildConversationPatchFromProposal(built.value, {
		pendingWrite: { tool: 'create_expense', label: 'Eau', amount: 5 },
		pendingConsumeToken: 'old-token',
		pendingOperationId: 'old-op',
	});
	assert.equal(patch.valid, true);
	assert.equal(patch.modification, true);
	assert.equal(patch.value.pendingConsumeToken, null);
	assert.equal(patch.value.pendingOperationId, null);
});

test('pending bridge: reject patch clears pending', () => {
	const patch = buildConversationPatchFromProposal({
		actionType: ACTION_TYPES.CREATE_EXPENSE,
		tool: 'create_expense',
		status: ACTION_PROPOSAL_STATUS.CONFIRMATION_REJECTED,
		fields: {},
		pendingWrite: null,
		missingFields: [],
		warnings: [],
		description: '',
		confirmationRequired: false,
	}, {});
	assert.equal(patch.valid, true);
	assert.equal(patch.value.pendingWrite, null);
});

// Response bridge
test('response: expense confirmation text', () => {
	const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Essence', amount: 40 }));
	const facing = toUserFacingActionProposal(built.value);
	const text = buildActionResponseText(facing.value);
	assert.match(text, /Essence/);
	assert.match(text, /confirme \?/i);
});

test('response: sale confirmation text', () => {
	const built = buildActionProposalFromGoal(buildSaleActionGoal({
		product: 'Poisson',
		quantity: 2,
		unitPrice: 10,
		amountPaid: 20,
	}));
	const facing = toUserFacingActionProposal(built.value);
	const text = buildActionResponseText(facing.value);
	assert.match(text, /Poisson/);
	assert.match(text, /encaiss/i);
});

test('response: clarification text', () => {
	const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Essence' }));
	const facing = toUserFacingActionProposal(built.value);
	const text = buildActionResponseText(facing.value);
	assert.match(text, /montant/i);
});

test('response: rejected text', () => {
	const text = buildActionResponseText({
		actionType: ACTION_TYPES.CREATE_EXPENSE,
		status: ACTION_PROPOSAL_STATUS.CONFIRMATION_REJECTED,
		fields: {},
		missingFields: [],
		warnings: [],
		confirmationRequired: false,
	});
	assert.match(text, /annule/i);
});

test('response: completed expense text', () => {
	const text = buildActionResponseText({
		actionType: ACTION_TYPES.CREATE_EXPENSE,
		status: ACTION_PROPOSAL_STATUS.COMPLETED,
		fields: { label: 'Eau', amount: 5 },
		missingFields: [],
		warnings: [],
		confirmationRequired: false,
	});
	assert.match(text, /✅/);
	assert.match(text, /Eau/);
});

// F4-B2 executor
test('f4: confirm expense via transactional RPC mock', async () => {
	resetAgentTransactionalWriteForTests();
	setIsTransactionalConfirmEnabledForTests(true);
	setIsIdempotentConfirmEnabledForTests(true);
	setConfirmAndCreateExpenseImplForTests(async () => ({
		success: true,
		status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
		pending_consumed: true,
		result_id: 'exp-1',
	}));

	const built = buildActionProposalFromGoal(buildExpenseActionGoal({
		label: 'Eau',
		amount: 5,
		confirmed: true,
	}));

	const result = await executeActionConfirmationViaF4B2({
		user: {
			id: 'u1',
			clientId: '22222222-2222-4222-8222-222222222222',
			activeActivityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
		},
		sessionId: 'sess-1',
		conversationState: {
			pendingWrite: built.value.pendingWrite,
			pendingConsumeToken: 'tok-1',
			pendingOperationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			pendingSessionVersion: 2,
		},
		proposal: built.value,
	});

	assert.equal(result.success, true);
	assert.equal(result.status, ACTION_PROPOSAL_STATUS.COMPLETED);
});

test('f4: conflict returns failed status', async () => {
	resetAgentTransactionalWriteForTests();
	setIsTransactionalConfirmEnabledForTests(true);
	setIsIdempotentConfirmEnabledForTests(true);
	setConfirmAndCreateExpenseImplForTests(async () => ({
		success: false,
		status: TRANSACTIONAL_CONFIRM_STATUS.VERSION_MISMATCH,
	}));

	const built = buildActionProposalFromGoal(buildExpenseActionGoal({
		label: 'Eau',
		amount: 5,
		confirmed: true,
	}));

	const result = await executeActionConfirmationViaF4B2({
		user: {
			id: 'u1',
			clientId: '22222222-2222-4222-8222-222222222222',
			activeActivityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
		},
		sessionId: 'sess-1',
		conversationState: {
			pendingWrite: built.value.pendingWrite,
			pendingConsumeToken: 'tok-1',
			pendingOperationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		},
		proposal: built.value,
	});

	assert.equal(result.success, false);
	assert.equal(result.conflict, true);
});

test('f4: missing operation id blocked when idempotent enabled', async () => {
	resetAgentTransactionalWriteForTests();
	setIsTransactionalConfirmEnabledForTests(true);
	setIsIdempotentConfirmEnabledForTests(true);

	const built = buildActionProposalFromGoal(buildExpenseActionGoal({
		label: 'Eau',
		amount: 5,
		confirmed: true,
	}));

	const result = await executeActionConfirmationViaF4B2({
		user: {
			id: 'u1',
			clientId: '22222222-2222-4222-8222-222222222222',
			activeActivityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
		},
		sessionId: 'sess-1',
		conversationState: {
			pendingWrite: built.value.pendingWrite,
			pendingConsumeToken: 'tok-1',
			pendingOperationId: null,
		},
		proposal: built.value,
	});

	assert.equal(result.success, false);
	assert.equal(result.code, 'OPERATION_ID_MISSING');
});

// Orchestrator + flags
test('config: actions flag default off', () => {
	assert.equal(isIntelligenceV2ActionsEnabled({ ashyIntelligenceV2: true, ashyIntelligenceV2Actions: false }), false);
	assert.equal(isIntelligenceV2ActionsEnabled({ ashyIntelligenceV2: true, ashyIntelligenceV2Actions: true }), true);
});

test('orchestrator: disabled flag returns deferred', async () => {
	resetActionMetricsForTests();
	const result = await runV2ActionFlow({
		goal: buildExpenseActionGoal({ label: 'Eau', amount: 5 }),
		message: 'ajoute dépense',
		conversationContext: {},
		conversationState: {},
		executionContext: { user: { id: 'u1', clientId: 'c1', activeActivityId: 'a1' } },
		sessionId: 's1',
		options: { env: { ashyIntelligenceV2: true, ashyIntelligenceV2Actions: false } },
	});
	assert.equal(result.enabled, false);
	assert.equal(result.code, 'V2_ACTIONS_DISABLED');
	assert.match(result.responseText, /confirmation/i);
});

test('orchestrator: missing session returns error', async () => {
	const result = await runV2ActionFlow({
		goal: buildExpenseActionGoal({ label: 'Eau', amount: 5 }),
		message: '',
		conversationContext: {},
		conversationState: {},
		executionContext: { user: { id: 'u1', clientId: 'c1', activeActivityId: 'a1' } },
		sessionId: null,
		options: {
			force: true,
			env: { ashyIntelligenceV2: true, ashyIntelligenceV2Actions: true },
		},
	});
	assert.equal(result.success, false);
	assert.equal(result.code, 'MISSING_EXECUTION_CONTEXT');
});

test('observability: sanitize proposal hides internal ids', () => {
	const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau', amount: 5 }));
	const log = sanitizeActionProposalForLog({
		...built.value,
		pendingOperationId: 'secret-op',
	});
	assert.equal(log.hasOperationId, true);
	assert.equal(log.userFacingValid, true);
});

test('observability: metrics increment on deferred', async () => {
	resetActionMetricsForTests();
	await runV2ActionFlow({
		goal: buildExpenseActionGoal({ label: 'Eau', amount: 5 }),
		message: '',
		conversationContext: {},
		conversationState: {},
		executionContext: { user: { id: 'u1' } },
		sessionId: 's1',
		options: { env: { ashyIntelligenceV2: true, ashyIntelligenceV2Actions: false } },
	});
	assert.equal(getActionMetricsForTests().action_deferred, 1);
});

test('response generator: uses action proposal not financial analysis', async () => {
	const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Essence', amount: 40 }));
	const facing = toUserFacingActionProposal(built.value);
	const response = await generateResponse({
		goal: buildExpenseActionGoal({ label: 'Essence', amount: 40 }),
		financialAnalysis: null,
		actionProposal: facing.value,
	});
	assert.match(response.text, /Essence/);
	assert.equal(response.diagnostics.validationStatus, 'ACTION_PROPOSAL');
});

test('builder: invalid amount ignored for expense', () => {
	const goal = buildExpenseActionGoal({ label: 'Eau', amount: -5 });
	const result = buildActionProposalFromGoal(goal);
	assert.equal(result.valid, true);
	assert.deepEqual(result.value.missingFields, ['amount']);
});

test('builder: zero amountPaid allowed for sale', () => {
	const goal = buildSaleActionGoal({
		product: 'Riz',
		quantity: 1,
		unitPrice: 10,
		amountPaid: 0,
	});
	const result = buildActionProposalFromGoal(goal);
	assert.equal(result.valid, true);
	assert.equal(result.value.status, ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION);
});

test('validator: terminal status cannot require confirmation', () => {
	const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau', amount: 5 }));
	const broken = {
		...built.value,
		status: ACTION_PROPOSAL_STATUS.COMPLETED,
		confirmationRequired: true,
	};
	const result = validateActionProposalBusinessRules(broken);
	assert.equal(result.valid, false);
	assert.equal(result.error, 'TERMINAL_STATUS_CANNOT_REQUIRE_CONFIRMATION');
});

test('contract: sale pending write draft', () => {
	const built = buildActionProposalFromGoal(buildSaleActionGoal({
		product: 'Riz',
		quantity: 1,
		unitPrice: 8,
		amountPaid: 8,
	}));
	const draft = buildPendingWriteDraft(built.value);
	assert.deepEqual(draft.value, {
		tool: 'create_sale',
		product: 'Riz',
		quantity: 1,
		unitPrice: 8,
		amountPaid: 8,
	});
});

test('confirmation: confirm without pending fails', () => {
	const resolved = resolveActionProposalFromContext({ message: 'oui', conversationContext: {} });
	assert.equal(resolved.valid, false);
	assert.equal(resolved.error, 'NO_PENDING_TO_CONFIRM');
});

test('security: internal proposal never exposes operationId to user facing', () => {
	const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau', amount: 5 }));
	const internal = {
		...built.value,
		pendingOperationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		pendingConsumeToken: 'consume-token',
		operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
	};
	const facing = toUserFacingActionProposal(internal);
	assert.equal(facing.valid, true);
	assert.equal(JSON.stringify(facing.value).includes('aaaaaaaa'), false);
});

test('idempotence: f4 replay maps to ALREADY_COMPLETED', async () => {
	resetAgentTransactionalWriteForTests();
	setIsTransactionalConfirmEnabledForTests(true);
	setIsIdempotentConfirmEnabledForTests(true);
	setConfirmAndCreateExpenseImplForTests(async () => ({
		success: true,
		status: TRANSACTIONAL_CONFIRM_STATUS.ALREADY_COMPLETED,
		pending_consumed: false,
		result_id: 'exp-existing',
	}));

	const built = buildActionProposalFromGoal(buildExpenseActionGoal({
		label: 'Eau',
		amount: 5,
		confirmed: true,
	}));

	const result = await executeActionConfirmationViaF4B2({
		user: {
			id: 'u1',
			clientId: '22222222-2222-4222-8222-222222222222',
			activeActivityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
		},
		sessionId: 'sess-1',
		conversationState: {
			pendingWrite: built.value.pendingWrite,
			pendingConsumeToken: 'tok-1',
			pendingOperationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		},
		proposal: built.value,
	});

	assert.equal(result.success, true);
	assert.equal(result.status, ACTION_PROPOSAL_STATUS.ALREADY_COMPLETED);
	assert.equal(result.replay, true);
});

test('double confirmation: second confirm without pending fails gracefully', () => {
	const first = resolveActionProposalFromContext({
		message: 'oui',
		conversationContext: {
			pendingWrite: { tool: 'create_expense', label: 'Eau', amount: 5 },
		},
	});
	assert.equal(first.valid, true);
	const second = resolveActionProposalFromContext({
		message: 'oui',
		conversationContext: {},
	});
	assert.equal(second.valid, false);
});

test('validator: deferred must not carry pendingWrite', () => {
	const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau', amount: 5 }), { deferred: true });
	const broken = { ...built.value, pendingWrite: { tool: 'create_expense', label: 'Eau', amount: 5 } };
	const result = validateActionProposalBusinessRules(broken);
	assert.equal(result.valid, false);
	assert.equal(result.error, 'DEFERRED_MUST_NOT_HAVE_PENDING');
});

test('builder: comma decimal normalized', () => {
	const goal = buildExpenseActionGoal({ label: 'Eau', amount: '12,5' });
	const result = buildActionProposalFromGoal(goal);
	assert.equal(result.value.fields.amount, 12.5);
});

test('confirmation: vas-y triggers confirm', () => {
	const intent = detectUserActionIntent('vas-y', {
		pendingWrite: { tool: 'create_expense', label: 'Eau', amount: 5 },
	});
	assert.equal(intent.intent, USER_ACTION_INTENT.CONFIRM);
});

test('response: deferred template text', () => {
	const text = buildActionResponseText({
		actionType: ACTION_TYPES.CREATE_EXPENSE,
		status: ACTION_PROPOSAL_STATUS.DEFERRED,
		fields: {},
		missingFields: [],
		warnings: [],
		confirmationRequired: false,
	});
	assert.match(text, /confirmation/i);
});

test('v2 orchestrator: action goal with actions disabled stays deferred', async () => {
	const result = await runV2AnalysisPlan({
		goal: buildExpenseActionGoal({ label: 'Essence', amount: 40 }),
		message: 'ajoute dépense',
		executionContext: { user: { id: 'u1', clientId: 'c1', activeActivityId: 'a1' } },
		sessionId: 's1',
		options: {
			force: true,
			env: { ashyIntelligenceV2: true, ashyIntelligenceV2Actions: false },
		},
	});
	assert.equal(result.actionFlow?.code, 'V2_ACTIONS_DISABLED');
	assert.match(result.response?.text || '', /confirmation/i);
});

test('observability: metrics track confirm success', async () => {
	resetActionMetricsForTests();
	resetAgentTransactionalWriteForTests();
	setIsTransactionalConfirmEnabledForTests(true);
	setIsIdempotentConfirmEnabledForTests(true);
	setConfirmAndCreateExpenseImplForTests(async () => ({
		success: true,
		status: TRANSACTIONAL_CONFIRM_STATUS.COMMITTED,
		pending_consumed: true,
	}));

	const built = buildActionProposalFromGoal(buildExpenseActionGoal({
		label: 'Eau',
		amount: 5,
		confirmed: true,
	}));

	await executeActionConfirmationViaF4B2({
		user: {
			id: 'u1',
			clientId: '22222222-2222-4222-8222-222222222222',
			activeActivityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
		},
		sessionId: 'sess-1',
		conversationState: {
			pendingWrite: built.value.pendingWrite,
			pendingConsumeToken: 'tok-1',
			pendingOperationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		},
		proposal: built.value,
	});

	assert.equal(getActionMetricsForTests().action_confirm_success, 1);
});
