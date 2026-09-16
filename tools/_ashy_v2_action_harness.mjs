#!/usr/bin/env node

import { ACTION_PROPOSAL_STATUS, ACTION_TYPES } from '../apps/api/src/agent/intelligence-v2/action/action-proposal-contract.js';
import {
	buildActionProposalFromGoal,
	buildExpenseActionGoal,
	buildSaleActionGoal,
} from '../apps/api/src/agent/intelligence-v2/action/action-proposal-builder.js';
import {
	detectUserActionIntent,
	resolveActionProposalFromContext,
	USER_ACTION_INTENT,
} from '../apps/api/src/agent/intelligence-v2/action/action-confirmation-handler.js';
import { buildConversationPatchFromProposal } from '../apps/api/src/agent/intelligence-v2/action/action-pending-bridge.js';
import { buildActionResponseText } from '../apps/api/src/agent/intelligence-v2/action/action-response-bridge.js';
import { toUserFacingActionProposal } from '../apps/api/src/agent/intelligence-v2/action/action-proposal-contract.js';
import { runV2ActionFlow } from '../apps/api/src/agent/intelligence-v2/action/action-orchestrator.js';
import { isIntelligenceV2ActionsEnabled } from '../apps/api/src/agent/intelligence-v2/config.js';

function scenario1() {
	const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Essence', amount: 40 }));
	return built.valid
		&& built.value.status === ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION
		&& built.value.pendingWrite?.amount === 40;
}

function scenario2() {
	const built = buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Essence' }));
	return built.value.status === ACTION_PROPOSAL_STATUS.NEEDS_CLARIFICATION;
}

function scenario3() {
	const intent = detectUserActionIntent('oui', {
		pendingWrite: { tool: 'create_expense', label: 'Eau', amount: 5 },
	});
	return intent.intent === USER_ACTION_INTENT.CONFIRM;
}

function scenario4() {
	const resolved = resolveActionProposalFromContext({
		message: 'Finalement c\'était 30$',
		conversationContext: {
			pendingWrite: { tool: 'create_expense', label: 'Eau', amount: 5 },
		},
	});
	return resolved.valid && resolved.value.fields.amount === 30;
}

function scenario5() {
	const built = buildActionProposalFromGoal(buildSaleActionGoal({
		product: 'Poulet',
		quantity: 2,
		unitPrice: 10,
		amountPaid: 20,
	}));
	const facing = toUserFacingActionProposal(built.value);
	const text = buildActionResponseText(facing.value);
	return /Poulet/.test(text) && /confirme/i.test(text);
}

function scenario6() {
	const patch = buildConversationPatchFromProposal(
		buildActionProposalFromGoal(buildExpenseActionGoal({ label: 'Eau', amount: 5 })).value,
		{},
	);
	return patch.valid && patch.value.pendingWrite?.tool === 'create_expense';
}

async function scenario7() {
	const result = await runV2ActionFlow({
		goal: buildExpenseActionGoal({ label: 'Eau', amount: 5 }),
		message: '',
		conversationContext: {},
		conversationState: {},
		executionContext: { user: { id: 'u1' } },
		sessionId: 's1',
		options: { env: { ashyIntelligenceV2: true, ashyIntelligenceV2Actions: false } },
	});
	return result.code === 'V2_ACTIONS_DISABLED';
}

function scenario8() {
	return isIntelligenceV2ActionsEnabled({ ashyIntelligenceV2: true, ashyIntelligenceV2Actions: false }) === false
		&& isIntelligenceV2ActionsEnabled({ ashyIntelligenceV2: true, ashyIntelligenceV2Actions: true }) === true;
}

function scenario9() {
	const facing = toUserFacingActionProposal({
		actionType: ACTION_TYPES.CREATE_EXPENSE,
		tool: 'create_expense',
		status: ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION,
		fields: { label: 'Eau', amount: 5 },
		pendingWrite: { tool: 'create_expense', label: 'Eau', amount: 5 },
		pendingOperationId: 'secret',
		description: 'test',
		confirmationRequired: true,
	});
	return facing.valid && !('pendingOperationId' in facing.value);
}

const scenarios = [
	['expense ready + pendingWrite', scenario1],
	['expense clarification', scenario2],
	['confirm intent', scenario3],
	['modification amount', scenario4],
	['sale confirmation text', scenario5],
	['pending patch', scenario6],
	['actions flag off deferred', scenario7],
	['config flags', scenario8],
	['user facing sanitization', scenario9],
];

let passed = 0;
for (const [name, fn] of scenarios) {
	const ok = await fn();
	console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}`);
	if (ok) passed += 1;
}

console.log(`\n${passed}/${scenarios.length} harness scenarios passed`);
process.exit(passed === scenarios.length ? 0 : 1);
