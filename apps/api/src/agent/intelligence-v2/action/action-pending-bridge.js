import {
	mergeConversationState,
	persistConversationState,
} from '../../conversation-state.js';
import { computeRequestHash } from '../../../lib/agent-operation-idempotency.js';
import { requireClientScope } from '../../../services/supabase-scoped.js';
import {
	ACTION_PROPOSAL_STATUS,
	ACTION_TOOL_TO_TYPE,
} from './action-proposal-contract.js';
import { detectActionFieldChanges, validateActionProposalForPersistence } from './action-proposal-validator.js';
import { recordActionObservability } from './action-observability.js';

const PENDING_PERSISTENCE_FAILED_REPLY = 'Je n’ai pas pu sécuriser cette confirmation. Réessaie dans un instant.';

/**
 * Build a partial pendingWrite draft for NEEDS_CLARIFICATION follow-ups.
 */
export function buildPartialPendingWrite(proposal) {
	if (!proposal?.tool || !proposal.fields) {
		return null;
	}

	if (proposal.tool === 'create_expense') {
		if (!proposal.fields.label && proposal.fields.amount == null) {
			return null;
		}
		/** @type {Record<string, unknown>} */
		const draft = { tool: 'create_expense' };
		if (proposal.fields.label) {
			draft.label = proposal.fields.label;
		}
		if (proposal.fields.amount != null) {
			draft.amount = proposal.fields.amount;
		}
		return draft;
	}

	if (proposal.tool === 'create_sale') {
		if (!proposal.fields.product) {
			return null;
		}
		/** @type {Record<string, unknown>} */
		const draft = {
			tool: 'create_sale',
			product: proposal.fields.product,
		};
		if (proposal.fields.quantity != null) {
			draft.quantity = proposal.fields.quantity;
		}
		if (proposal.fields.unitPrice != null) {
			draft.unitPrice = proposal.fields.unitPrice;
		}
		if (proposal.fields.amountPaid != null) {
			draft.amountPaid = proposal.fields.amountPaid;
		}
		return draft;
	}

	return null;
}

function resolveLastAction(proposal) {
	if (proposal.tool === 'create_expense') return 'create_expense';
	if (proposal.tool === 'create_sale') return 'create_sale';
	return proposal.actionType || null;
}

/**
 * Build conversation-state patch for a validated action proposal.
 */
export function buildConversationPatchFromProposal(proposal, previousState = {}, options = {}) {
	if (proposal?.status === ACTION_PROPOSAL_STATUS.CONFIRMATION_REJECTED) {
		return {
			valid: true,
			value: {
				pendingWrite: null,
				pendingSessionVersion: null,
				pendingConsumeToken: null,
				pendingOperationId: null,
				lastAction: null,
			},
		};
	}

	const validated = validateActionProposalForPersistence(proposal);
	if (!validated.valid) {
		return { valid: false, error: validated.error, issues: validated.issues };
	}

	const value = validated.value;

	if (value.status === ACTION_PROPOSAL_STATUS.CONFIRMATION_REJECTED) {
		return {
			valid: true,
			value: {
				pendingWrite: null,
				pendingSessionVersion: null,
				pendingConsumeToken: null,
				pendingOperationId: null,
				lastAction: null,
			},
		};
	}

	if (!value.pendingWrite) {
		return {
			valid: true,
			value: {
				lastAction: resolveLastAction(value),
			},
		};
	}

	const previousPending = previousState.pendingWrite ?? null;
	const actionType = ACTION_TOOL_TO_TYPE[value.tool];
	const modification = previousPending
		? detectActionFieldChanges(previousPending, value.pendingWrite, actionType).isModification
		: false;
	const invalidateTokens = options.invalidatePendingTokens || modification;

	/** @type {Record<string, unknown>} */
	const patch = {
		pendingWrite: value.pendingWrite,
		lastAction: resolveLastAction(value),
	};

	if (invalidateTokens) {
		patch.pendingConsumeToken = null;
		patch.pendingOperationId = null;
		patch.pendingSessionVersion = null;
	}

	return { valid: true, value: patch, modification };
}

/**
 * Persist pendingWrite to RAM + agent_sessions via existing conversation-state bridge.
 */
export async function persistActionProposalPending({
	user,
	sessionId,
	conversationState = {},
	proposal,
	invalidatePendingTokens = false,
	requirePendingDb = true,
}) {
	const patchResult = buildConversationPatchFromProposal(
		proposal,
		conversationState,
		{ invalidatePendingTokens },
	);
	if (!patchResult.valid) {
		recordActionObservability('pending_persist_rejected', {
			error: patchResult.error,
			status: proposal?.status,
		});
		return {
			success: false,
			error: patchResult.error,
			blockedConfirmation: false,
		};
	}

	if (patchResult.value.pendingWrite == null) {
		const nextState = mergeConversationState(conversationState, patchResult.value);
		await persistConversationState({ user, sessionId, state: nextState });
		return { success: true, state: nextState, blockedConfirmation: false };
	}

	const nextState = mergeConversationState(conversationState, patchResult.value);
	const persistResult = await persistConversationState({
		user,
		sessionId,
		state: nextState,
		requirePendingDb,
	});

	if (persistResult.blockedConfirmation) {
		recordActionObservability('pending_persist_blocked', {
			status: proposal?.status,
			outcome: persistResult.outcome,
		});
		const cleared = mergeConversationState(nextState, {
			pendingWrite: null,
			pendingSessionVersion: null,
			pendingConsumeToken: null,
			pendingOperationId: null,
		});
		await persistConversationState({ user, sessionId, state: cleared });
		return {
			success: false,
			blockedConfirmation: true,
			error: 'PENDING_PERSISTENCE_FAILED',
			reply: PENDING_PERSISTENCE_FAILED_REPLY,
			state: cleared,
		};
	}

	let requestHashPreview = null;
	try {
		const clientId = requireClientScope(user);
		requestHashPreview = computeRequestHash(clientId, nextState.pendingWrite);
	} catch {
		requestHashPreview = null;
	}

	recordActionObservability('pending_persist_success', {
		status: proposal?.status,
		tool: proposal?.tool,
		modification: patchResult.modification,
	});

	return {
		success: true,
		state: persistResult.syncedState || nextState,
		blockedConfirmation: false,
		requestHashPreview,
		pendingOperationId: (persistResult.syncedState || nextState).pendingOperationId,
		pendingConsumeToken: (persistResult.syncedState || nextState).pendingConsumeToken,
	};
}

export async function clearActionPending({ user, sessionId, conversationState = {} }) {
	const cleared = mergeConversationState(conversationState, {
		pendingWrite: null,
		pendingSessionVersion: null,
		pendingConsumeToken: null,
		pendingOperationId: null,
	});
	await persistConversationState({ user, sessionId, state: cleared });
	recordActionObservability('pending_cleared', {});
	return { success: true, state: cleared };
}
