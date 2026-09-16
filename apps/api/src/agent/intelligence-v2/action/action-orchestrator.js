import {
	mergeConversationState,
	persistConversationState,
} from '../../conversation-state.js';
import { isIntelligenceV2ActionsEnabled } from '../config.js';
import { ACTION_PROPOSAL_STATUS, toUserFacingActionProposal } from './action-proposal-contract.js';
import { buildActionProposalFromGoal } from './action-proposal-builder.js';
import { validateActionProposalBusinessRules } from './action-proposal-validator.js';
import { resolveActionProposalFromContext } from './action-confirmation-handler.js';
import { executeActionConfirmationViaF4B2 } from './action-f4-executor.js';
import {
	buildPartialPendingWrite,
	clearActionPending,
	persistActionProposalPending,
} from './action-pending-bridge.js';
import { buildActionResponseText } from './action-response-bridge.js';
import {
	recordActionObservability,
	sanitizeActionProposalForLog,
} from './action-observability.js';

function attachInternalMetadata(proposal, persistMeta = {}) {
	return {
		...proposal,
		pendingOperationId: persistMeta.pendingOperationId ?? proposal.pendingOperationId ?? null,
		pendingConsumeToken: persistMeta.pendingConsumeToken ?? proposal.pendingConsumeToken ?? null,
		requestHashPreview: persistMeta.requestHashPreview ?? proposal.requestHashPreview ?? null,
	};
}

/**
 * V2 action orchestrator — proposal, pending bridge, F4-B2 confirm.
 * Does not replace legacy createAshyAgent().run() default path.
 */
export async function runV2ActionFlow({
	goal = null,
	message = '',
	conversationContext = {},
	conversationState = {},
	executionContext = null,
	sessionId = null,
	options = {},
}) {
	if (!options.forceActions && !isIntelligenceV2ActionsEnabled(options.env)) {
		const deferred = goal?.type === 'ACTION'
			? buildActionProposalFromGoal(goal, { deferred: true })
			: { valid: false, error: 'ACTIONS_DISABLED' };
		recordActionObservability('deferred', { reason: 'ACTIONS_FLAG_OFF' });
		const userFacing = deferred.valid
			? toUserFacingActionProposal(deferred.value)
			: null;
		return {
			enabled: false,
			success: false,
			code: 'V2_ACTIONS_DISABLED',
			proposal: deferred.valid ? deferred.value : null,
			userFacing: userFacing?.valid ? userFacing.value : null,
			responseText: buildActionResponseText(
				userFacing?.valid ? userFacing.value : null,
			),
		};
	}

	const user = executionContext?.user;
	if (!user?.id || !sessionId) {
		return {
			enabled: true,
			success: false,
			code: 'MISSING_EXECUTION_CONTEXT',
		};
	}

	const resolved = resolveActionProposalFromContext({
		goal,
		message,
		conversationContext: {
			...conversationContext,
			pendingWrite: conversationState.pendingWrite ?? conversationContext.pendingWrite ?? null,
		},
		options,
	});

	if (!resolved.valid) {
		return {
			enabled: true,
			success: false,
			code: resolved.error || 'ACTION_RESOLVE_FAILED',
			userIntent: resolved.userIntent,
		};
	}

	let proposal = resolved.value;
	recordActionObservability('proposal_created', {
		status: proposal.status,
		tool: proposal.tool,
	});

	const business = validateActionProposalBusinessRules(proposal, {
		requireUserFacingSafe: proposal.status !== ACTION_PROPOSAL_STATUS.CONFIRMATION_REJECTED,
	});
	if (!business.valid && proposal.status !== ACTION_PROPOSAL_STATUS.CONFIRMATION_REJECTED) {
		return {
			enabled: true,
			success: false,
			code: business.error,
			proposal,
			userIntent: resolved.userIntent,
		};
	}
	proposal = business.valid ? business.value : proposal;

	let conversationAfter = conversationState;
	let persistResult = null;
	let confirmResult = null;

	if (resolved.shouldClearPending) {
		recordActionObservability('user_rejected', {});
		const cleared = await clearActionPending({ user, sessionId, conversationState });
		conversationAfter = cleared.state;
	}

	if (proposal.status === ACTION_PROPOSAL_STATUS.NEEDS_CLARIFICATION) {
		recordActionObservability('clarification_requested', {
			missingFields: proposal.missingFields,
		});
		const partialPending = buildPartialPendingWrite(proposal);
		if (partialPending) {
			conversationAfter = mergeConversationState(conversationAfter, {
				pendingWrite: partialPending,
				lastAction: proposal.tool === 'create_expense' ? 'create_expense' : 'create_sale',
				topic: proposal.tool === 'create_expense' ? 'expenses' : 'sales',
				intent: proposal.tool === 'create_expense' ? 'create_expense' : 'create_sale',
			});
			await persistConversationState({ user, sessionId, state: conversationAfter });
		}
	}

	if (proposal.status === ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION
		|| proposal.status === ACTION_PROPOSAL_STATUS.MODIFICATION_DETECTED) {
		recordActionObservability(proposal.status === ACTION_PROPOSAL_STATUS.MODIFICATION_DETECTED
			? 'modification_detected'
			: 'ready_for_confirmation', {
			tool: proposal.tool,
		});
		persistResult = await persistActionProposalPending({
			user,
			sessionId,
			conversationState: conversationAfter,
			proposal,
			invalidatePendingTokens: resolved.invalidatePendingTokens,
			requirePendingDb: options.requirePendingDb !== false,
		});

		if (!persistResult.success) {
			return {
				enabled: true,
				success: false,
				code: persistResult.error || 'PENDING_PERSIST_FAILED',
				proposal,
				persistResult,
				responseText: persistResult.reply,
				userIntent: resolved.userIntent,
			};
		}

		conversationAfter = persistResult.state;
		proposal = attachInternalMetadata(proposal, persistResult);

		if (proposal.status === ACTION_PROPOSAL_STATUS.MODIFICATION_DETECTED) {
			proposal = {
				...proposal,
				status: ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION,
			};
		}
	}

	if (proposal.status === ACTION_PROPOSAL_STATUS.CONFIRMATION_ACCEPTED) {
		if (options.skipFinancialExecution) {
			recordActionObservability('h2_confirm_acknowledged', {
				tool: proposal.tool,
			});
			proposal = {
				...proposal,
				status: ACTION_PROPOSAL_STATUS.CONFIRMED,
				confirmationRequired: false,
			};
		} else {
			confirmResult = await executeActionConfirmationViaF4B2({
				user,
				sessionId,
				conversationState: conversationAfter,
				proposal,
			});
		}

		if (confirmResult && !confirmResult.success) {
			const userFacing = toUserFacingActionProposal({
				...proposal,
				status: ACTION_PROPOSAL_STATUS.FAILED,
			});
			return {
				enabled: true,
				success: false,
				code: confirmResult.code,
				conflict: confirmResult.conflict,
				proposal: {
					...proposal,
					status: ACTION_PROPOSAL_STATUS.FAILED,
				},
				userFacing: userFacing.valid ? userFacing.value : null,
				confirmResult,
				responseText: buildActionResponseText(userFacing.valid ? userFacing.value : null, {
					errorMessage: confirmResult.message,
				}),
				userIntent: resolved.userIntent,
			};
		}

		if (confirmResult?.success) {
			conversationAfter = confirmResult.state || conversationAfter;
			proposal = {
				...proposal,
				status: confirmResult.status,
				fields: proposal.fields,
			};
		}
	}

	const userFacing = toUserFacingActionProposal(proposal);
	const responseText = buildActionResponseText(
		userFacing.valid ? userFacing.value : null,
		{ errorMessage: confirmResult?.message },
	);

	return {
		enabled: true,
		success: proposal.status === ACTION_PROPOSAL_STATUS.COMPLETED
			|| proposal.status === ACTION_PROPOSAL_STATUS.ALREADY_COMPLETED
			|| proposal.status === ACTION_PROPOSAL_STATUS.CONFIRMED
			|| proposal.status === ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION
			|| proposal.status === ACTION_PROPOSAL_STATUS.NEEDS_CLARIFICATION
			|| proposal.status === ACTION_PROPOSAL_STATUS.CONFIRMATION_REJECTED
			|| proposal.status === ACTION_PROPOSAL_STATUS.MODIFICATION_DETECTED,
		code: proposal.status,
		proposal,
		userFacing: userFacing.valid ? userFacing.value : null,
		persistResult,
		confirmResult,
		conversationState: conversationAfter,
		responseText,
		userIntent: resolved.userIntent,
		diagnostics: {
			proposal: sanitizeActionProposalForLog(proposal),
		},
	};
}
