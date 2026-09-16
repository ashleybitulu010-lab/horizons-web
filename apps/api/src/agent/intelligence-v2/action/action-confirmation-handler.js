import {
	ACTION_PROPOSAL_STATUS,
	ACTION_TOOLS,
	ACTION_TYPES,
} from './action-proposal-contract.js';
import {
	buildActionProposalFromGoal,
	buildActionProposalFromPendingWrite,
} from './action-proposal-builder.js';
import { detectActionFieldChanges } from './action-proposal-validator.js';

export const USER_ACTION_INTENT = Object.freeze({
	CONFIRM: 'CONFIRM',
	REJECT: 'REJECT',
	MODIFY: 'MODIFY',
	PROPOSE: 'PROPOSE',
	NONE: 'NONE',
});

const CONFIRMATION_PATTERN = /^(?:oui|yes|ok|confirme(?:r|z)?|je confirme|c['']est bon|vas[- ]?y)\b[!?.]*$/i;
const REJECTION_PATTERN = /^(?:non|no|annule(?:r|z)?|cancel|stop)\b[!?.]*$/i;
const MODIFICATION_CUE_PATTERN = /(?:finalement|plut[oô]t|en fait|c['']?était|corrige(?:r|z)?|change(?:r|z)?|modifie(?:r|z)?)/i;

function parseNumber(value) {
	if (value == null) return null;
	const num = Number(String(value).replace(',', '.'));
	return Number.isFinite(num) ? num : null;
}

function resolveActionTypeFromPending(pendingWrite) {
	if (pendingWrite?.tool === ACTION_TOOLS.CREATE_EXPENSE) {
		return ACTION_TYPES.CREATE_EXPENSE;
	}
	if (pendingWrite?.tool === ACTION_TOOLS.CREATE_SALE) {
		return ACTION_TYPES.CREATE_SALE;
	}
	return null;
}

/**
 * Detect whether the user message is confirming, rejecting, or modifying a pending action.
 */
export function detectUserActionIntent(message, conversationContext = {}) {
	const text = String(message || '').trim();
	if (!text) {
		return { intent: USER_ACTION_INTENT.NONE };
	}

	const pendingWrite = conversationContext.pendingWrite ?? null;

	if (CONFIRMATION_PATTERN.test(text)) {
		return { intent: USER_ACTION_INTENT.CONFIRM, pendingWrite };
	}

	if (REJECTION_PATTERN.test(text)) {
		return { intent: USER_ACTION_INTENT.REJECT, pendingWrite };
	}

	if (pendingWrite && MODIFICATION_CUE_PATTERN.test(text)) {
		const actionType = resolveActionTypeFromPending(pendingWrite);
		const changes = parseModificationChanges(text, actionType, pendingWrite);
		if (changes && Object.keys(changes).length > 0) {
			return {
				intent: USER_ACTION_INTENT.MODIFY,
				pendingWrite,
				changes,
				actionType,
			};
		}
	}

	if (pendingWrite) {
		return { intent: USER_ACTION_INTENT.NONE, pendingWrite };
	}

	return { intent: USER_ACTION_INTENT.PROPOSE };
}

/**
 * Parse field overrides from a modification message (no FX conversion).
 */
export function parseModificationChanges(message, actionType, currentFields = {}) {
	const text = String(message || '').trim();
	if (!text || !MODIFICATION_CUE_PATTERN.test(text)) {
		return null;
	}

	/** @type {Record<string, unknown>} */
	const changes = {};

	const amountMatch = text.match(/(\d+(?:[.,]\d+)?)\s*\$?/);
	if (!amountMatch) {
		return null;
	}

	const parsedAmount = parseNumber(amountMatch[1]);
	if (parsedAmount == null) {
		return null;
	}

	if (actionType === ACTION_TYPES.CREATE_EXPENSE) {
		if (/\b(?:montant|d[eé]pense)\b/i.test(text) || currentFields.amount != null) {
			changes.amount = parsedAmount;
		}
		return Object.keys(changes).length > 0 ? changes : { amount: parsedAmount };
	}

	if (actionType === ACTION_TYPES.CREATE_SALE) {
		if (/encaiss|pay[eé]|re[cç]u/i.test(text)) {
			changes.amountPaid = parsedAmount;
		} else if (/prix|unitaire|[àa@]/i.test(text)) {
			changes.unitPrice = parsedAmount;
		} else if (/\b(?:quantit[eé]|vendu)\b/i.test(text)) {
			changes.quantity = parsedAmount;
		} else if (currentFields.amountPaid != null && currentFields.unitPrice == null) {
			changes.amountPaid = parsedAmount;
		} else if (currentFields.unitPrice != null) {
			changes.unitPrice = parsedAmount;
		} else {
			changes.amountPaid = parsedAmount;
		}
		return changes;
	}

	return null;
}

export function mergePendingWriteChanges(pendingWrite, changes = {}) {
	if (!pendingWrite) {
		return null;
	}
	return {
		...pendingWrite,
		...changes,
		tool: pendingWrite.tool,
	};
}

/**
 * Parse a short follow-up answer when a clarification draft is pending (e.g. "30 dollars").
 */
export function parseClarificationFollowUp(message, pendingWrite) {
	if (!pendingWrite?.tool) {
		return null;
	}

	const text = String(message || '').trim();
	if (!text || CONFIRMATION_PATTERN.test(text) || REJECTION_PATTERN.test(text)) {
		return null;
	}

	const amountMatch = text.match(/^(\d+(?:[.,]\d+)?)\s*(?:\$|dollars?)?\.?$/i);
	if (!amountMatch) {
		return null;
	}

	const parsedAmount = parseNumber(amountMatch[1]);
	if (parsedAmount == null || parsedAmount <= 0) {
		return null;
	}

	if (pendingWrite.tool === ACTION_TOOLS.CREATE_EXPENSE) {
		if (pendingWrite.label && pendingWrite.amount == null) {
			return { amount: parsedAmount };
		}
		return null;
	}

	if (pendingWrite.tool === ACTION_TOOLS.CREATE_SALE) {
		/** @type {Record<string, unknown>} */
		const changes = {};
		if (pendingWrite.product && pendingWrite.quantity != null && pendingWrite.unitPrice != null
			&& pendingWrite.amountPaid == null) {
			changes.amountPaid = parsedAmount;
			return changes;
		}
		if (pendingWrite.product && pendingWrite.quantity == null) {
			changes.quantity = parsedAmount;
			return changes;
		}
		if (pendingWrite.product && pendingWrite.unitPrice == null) {
			changes.unitPrice = parsedAmount;
			return changes;
		}
	}

	return null;
}

/**
 * Resolve an InternalActionProposal from goal + user intent + conversation context.
 */
export function resolveActionProposalFromContext({
	goal = null,
	message = '',
	conversationContext = {},
	options = {},
}) {
	const userIntent = detectUserActionIntent(message, conversationContext);

	if (userIntent.intent === USER_ACTION_INTENT.REJECT) {
		if (!userIntent.pendingWrite) {
			return {
				valid: false,
				error: 'NO_PENDING_TO_REJECT',
				userIntent,
			};
		}
		return {
			valid: true,
			value: {
				actionType: resolveActionTypeFromPending(userIntent.pendingWrite),
				tool: userIntent.pendingWrite?.tool ?? null,
				status: ACTION_PROPOSAL_STATUS.CONFIRMATION_REJECTED,
				fields: {},
				pendingWrite: null,
				missingFields: [],
				warnings: [],
				description: 'Action annulée',
				confirmationRequired: false,
				clarificationPrompt: null,
				diagnostics: { source: 'user_reject' },
			},
			userIntent,
			shouldClearPending: true,
		};
	}

	if (userIntent.intent === USER_ACTION_INTENT.CONFIRM) {
		if (!userIntent.pendingWrite) {
			return {
				valid: false,
				error: 'NO_PENDING_TO_CONFIRM',
				userIntent,
			};
		}
		const built = buildActionProposalFromPendingWrite(userIntent.pendingWrite, {
			confirmed: true,
			diagnostics: { source: 'user_confirm' },
		});
		return { ...built, userIntent, shouldClearPending: false };
	}

	if (userIntent.intent === USER_ACTION_INTENT.MODIFY) {
		const merged = mergePendingWriteChanges(userIntent.pendingWrite, userIntent.changes);
		const actionType = userIntent.actionType;
		const fieldChange = detectActionFieldChanges(
			userIntent.pendingWrite,
			merged,
			actionType,
		);
		const built = buildActionProposalFromPendingWrite(merged, {
			confirmed: false,
			diagnostics: {
				source: 'user_modification',
				changedFields: fieldChange.changed,
			},
		});
		if (!built.valid) {
			return { ...built, userIntent };
		}
		const proposal = {
			...built.value,
			status: built.value.status === ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION
				? ACTION_PROPOSAL_STATUS.MODIFICATION_DETECTED
				: built.value.status,
		};
		return {
			valid: true,
			value: proposal,
			userIntent,
			shouldClearPending: false,
			invalidatePendingTokens: fieldChange.isModification,
		};
	}

	if (userIntent.intent === USER_ACTION_INTENT.NONE && userIntent.pendingWrite) {
		const clarificationChanges = parseClarificationFollowUp(message, userIntent.pendingWrite);
		if (clarificationChanges) {
			const merged = mergePendingWriteChanges(userIntent.pendingWrite, clarificationChanges);
			const built = buildActionProposalFromPendingWrite(merged, {
				confirmed: false,
				diagnostics: { source: 'clarification_follow_up' },
			});
			return { ...built, userIntent, shouldClearPending: false };
		}
	}

	if (goal?.type === 'ACTION') {
		const built = buildActionProposalFromGoal(goal, options);
		return { ...built, userIntent, shouldClearPending: false };
	}

	return {
		valid: false,
		error: 'NO_ACTION_CONTEXT',
		userIntent,
	};
}
