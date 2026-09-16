import {
	FORBIDDEN_GOAL_KEYS,
	UUID_PATTERN,
} from '../constants.js';

/** V2 action kinds — distinct from FinancialAnalysisResult. */
export const ACTION_TYPES = Object.freeze({
	CREATE_EXPENSE: 'CREATE_EXPENSE',
	CREATE_SALE: 'CREATE_SALE',
});

/** Legacy tool names used by F4-B2 / pendingWrite. */
export const ACTION_TOOLS = Object.freeze({
	CREATE_EXPENSE: 'create_expense',
	CREATE_SALE: 'create_sale',
});

export const ACTION_TYPE_TO_TOOL = Object.freeze({
	[ACTION_TYPES.CREATE_EXPENSE]: ACTION_TOOLS.CREATE_EXPENSE,
	[ACTION_TYPES.CREATE_SALE]: ACTION_TOOLS.CREATE_SALE,
});

export const ACTION_TOOL_TO_TYPE = Object.freeze({
	[ACTION_TOOLS.CREATE_EXPENSE]: ACTION_TYPES.CREATE_EXPENSE,
	[ACTION_TOOLS.CREATE_SALE]: ACTION_TYPES.CREATE_SALE,
});

/** Business fields allowed in action proposals (no scope IDs). */
export const ACTION_FIELD_KEYS = Object.freeze({
	[ACTION_TYPES.CREATE_EXPENSE]: ['label', 'amount'],
	[ACTION_TYPES.CREATE_SALE]: ['product', 'quantity', 'unitPrice', 'amountPaid'],
});

/** Fields mirrored into agent_sessions.pending / pendingWrite. */
export const PENDING_WRITE_FIELD_KEYS = Object.freeze({
	[ACTION_TOOLS.CREATE_EXPENSE]: ['tool', 'label', 'amount'],
	[ACTION_TOOLS.CREATE_SALE]: ['tool', 'product', 'quantity', 'unitPrice', 'amountPaid'],
});

export const ACTION_PROPOSAL_STATUS = Object.freeze({
	NEEDS_CLARIFICATION: 'NEEDS_CLARIFICATION',
	READY_FOR_CONFIRMATION: 'READY_FOR_CONFIRMATION',
	CONFIRMATION_ACCEPTED: 'CONFIRMATION_ACCEPTED',
	CONFIRMATION_REJECTED: 'CONFIRMATION_REJECTED',
	MODIFICATION_DETECTED: 'MODIFICATION_DETECTED',
	CONFIRMED: 'CONFIRMED',
	COMPLETED: 'COMPLETED',
	ALREADY_COMPLETED: 'ALREADY_COMPLETED',
	REJECTED: 'REJECTED',
	FAILED: 'FAILED',
	DEFERRED: 'DEFERRED',
	INVALID: 'INVALID',
});

/** Internal-only keys — never exposed via UserFacingActionProposal. */
export const INTERNAL_ACTION_KEYS = Object.freeze([
	'pendingConsumeToken',
	'pendingOperationId',
	'operationId',
	'requestHashPreview',
	'clientId',
	'client_id',
	'activityId',
	'activity_id',
	'userId',
	'user_id',
]);

const FORBIDDEN_USER_FACING_KEYS = Object.freeze([
	...FORBIDDEN_GOAL_KEYS,
	...INTERNAL_ACTION_KEYS,
	'pendingWrite',
	'tool',
	'confirmed',
]);

export function createEmptyInternalActionProposal(overrides = {}) {
	return {
		actionType: null,
		tool: null,
		status: ACTION_PROPOSAL_STATUS.INVALID,
		fields: {},
		pendingWrite: null,
		missingFields: [],
		warnings: [],
		description: '',
		confirmationRequired: false,
		clarificationPrompt: null,
		pendingConsumeToken: null,
		pendingOperationId: null,
		operationId: null,
		requestHashPreview: null,
		diagnostics: {},
		...overrides,
	};
}

export function createEmptyUserFacingActionProposal(overrides = {}) {
	return {
		actionType: null,
		status: ACTION_PROPOSAL_STATUS.INVALID,
		description: '',
		fields: {},
		missingFields: [],
		warnings: [],
		confirmationRequired: false,
		clarificationPrompt: null,
		...overrides,
	};
}

function containsForbiddenKey(value, forbiddenKeys) {
	if (value == null || typeof value !== 'object') {
		return null;
	}

	for (const key of Object.keys(value)) {
		if (forbiddenKeys.includes(key)) {
			return key;
		}
		if (typeof value[key] === 'object' && value[key] !== null) {
			const nested = containsForbiddenKey(value[key], forbiddenKeys);
			if (nested) return nested;
		}
	}

	return null;
}

function containsUuid(value) {
	if (value == null) {
		return null;
	}

	if (typeof value === 'string' && UUID_PATTERN.test(value.trim())) {
		return value.trim();
	}

	if (typeof value !== 'object') {
		return null;
	}

	for (const nested of Object.values(value)) {
		const found = containsUuid(nested);
		if (found) {
			return found;
		}
	}

	return null;
}

const FORBIDDEN_SCOPE_KEYS = Object.freeze([
	'clientId',
	'client_id',
	'userId',
	'user_id',
	'businessUserId',
	'activityId',
	'activity_id',
	'tenantId',
	'tenant_id',
	'operationId',
	'pendingOperationId',
	'pendingConsumeToken',
	'requestHashPreview',
]);

function validateActionType(actionType) {
	if (!Object.values(ACTION_TYPES).includes(actionType)) {
		return { valid: false, error: 'ACTION_TYPE_INVALID' };
	}
	return { valid: true, value: actionType };
}

function validateStatus(status) {
	if (!Object.values(ACTION_PROPOSAL_STATUS).includes(status)) {
		return { valid: false, error: 'ACTION_STATUS_INVALID' };
	}
	return { valid: true, value: status };
}

function sanitizeBusinessFields(actionType, rawFields = {}) {
	const allowed = ACTION_FIELD_KEYS[actionType] || [];
	/** @type {Record<string, unknown>} */
	const fields = {};

	for (const key of allowed) {
		fields[key] = rawFields[key] ?? null;
	}

	return fields;
}

/**
 * Validate backend-only InternalActionProposal.
 * Does not perform business completeness checks (see action-proposal-validator).
 */
export function validateInternalActionProposal(raw) {
	if (!raw || typeof raw !== 'object') {
		return { valid: false, error: 'ACTION_PROPOSAL_INVALID' };
	}

	const forbidden = containsForbiddenKey(raw.fields, FORBIDDEN_GOAL_KEYS);
	if (forbidden) {
		return { valid: false, error: 'FORBIDDEN_FIELD' };
	}

	const uuid = containsUuid({
		fields: raw.fields,
		description: raw.description,
		missingFields: raw.missingFields,
		warnings: raw.warnings,
		clarificationPrompt: raw.clarificationPrompt,
		pendingWrite: raw.pendingWrite,
	});
	if (uuid) {
		return { valid: false, error: 'UUID_NOT_ALLOWED' };
	}

	const actionTypeResult = validateActionType(raw.actionType);
	if (!actionTypeResult.valid) {
		return actionTypeResult;
	}

	const statusResult = validateStatus(raw.status);
	if (!statusResult.valid) {
		return statusResult;
	}

	const expectedTool = ACTION_TYPE_TO_TOOL[actionTypeResult.value];
	if (raw.tool && raw.tool !== expectedTool) {
		return { valid: false, error: 'ACTION_TOOL_MISMATCH' };
	}

	if (raw.pendingWrite != null) {
		const pendingForbidden = containsForbiddenKey(raw.pendingWrite, [
			...FORBIDDEN_SCOPE_KEYS,
			'confirmed',
		]);
		if (pendingForbidden) {
			return { valid: false, error: 'PENDING_WRITE_FORBIDDEN_KEY' };
		}

		const allowedPending = PENDING_WRITE_FIELD_KEYS[expectedTool];
		if (!allowedPending) {
			return { valid: false, error: 'PENDING_WRITE_TOOL_INVALID' };
		}

		if (raw.pendingWrite.tool !== expectedTool) {
			return { valid: false, error: 'PENDING_WRITE_TOOL_MISMATCH' };
		}

		for (const key of Object.keys(raw.pendingWrite)) {
			if (!allowedPending.includes(key)) {
				return { valid: false, error: 'PENDING_WRITE_UNEXPECTED_KEY' };
			}
		}
	}

	return {
		valid: true,
		value: {
			actionType: actionTypeResult.value,
			tool: raw.tool || expectedTool,
			status: statusResult.value,
			fields: sanitizeBusinessFields(actionTypeResult.value, raw.fields),
			pendingWrite: raw.pendingWrite ?? null,
			missingFields: Array.isArray(raw.missingFields) ? raw.missingFields.map(String) : [],
			warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
			description: String(raw.description || '').trim(),
			confirmationRequired: Boolean(raw.confirmationRequired),
			clarificationPrompt: raw.clarificationPrompt != null
				? String(raw.clarificationPrompt).trim()
				: null,
			pendingConsumeToken: raw.pendingConsumeToken ?? null,
			pendingOperationId: raw.pendingOperationId ?? null,
			operationId: raw.operationId ?? null,
			requestHashPreview: raw.requestHashPreview ?? null,
			diagnostics: raw.diagnostics && typeof raw.diagnostics === 'object'
				? { ...raw.diagnostics }
				: {},
		},
	};
}

/**
 * Validate user-safe ActionProposal slice for Response Generator.
 */
export function validateUserFacingActionProposal(raw) {
	if (!raw || typeof raw !== 'object') {
		return { valid: false, error: 'USER_ACTION_PROPOSAL_INVALID' };
	}

	const forbidden = containsForbiddenKey(raw, FORBIDDEN_USER_FACING_KEYS);
	if (forbidden) {
		return { valid: false, error: 'USER_FACING_FORBIDDEN_KEY' };
	}

	const uuid = containsUuid(raw);
	if (uuid) {
		return { valid: false, error: 'UUID_NOT_ALLOWED' };
	}

	const actionTypeResult = validateActionType(raw.actionType);
	if (!actionTypeResult.valid) {
		return actionTypeResult;
	}

	const statusResult = validateStatus(raw.status);
	if (!statusResult.valid) {
		return statusResult;
	}

	return {
		valid: true,
		value: {
			actionType: actionTypeResult.value,
			status: statusResult.value,
			description: String(raw.description || '').trim(),
			fields: sanitizeBusinessFields(actionTypeResult.value, raw.fields),
			missingFields: Array.isArray(raw.missingFields) ? raw.missingFields.map(String) : [],
			warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
			confirmationRequired: Boolean(raw.confirmationRequired),
			clarificationPrompt: raw.clarificationPrompt != null
				? String(raw.clarificationPrompt).trim()
				: null,
		},
	};
}

/**
 * Strip internal metadata before handing off to Response Generator.
 */
export function toUserFacingActionProposal(internal) {
	const validated = validateInternalActionProposal(internal);
	if (!validated.valid) {
		return validated;
	}

	const proposal = validated.value;
	return validateUserFacingActionProposal({
		actionType: proposal.actionType,
		status: proposal.status,
		description: proposal.description,
		fields: proposal.fields,
		missingFields: proposal.missingFields,
		warnings: proposal.warnings,
		confirmationRequired: proposal.confirmationRequired,
		clarificationPrompt: proposal.clarificationPrompt,
	});
}

/**
 * Build pendingWrite draft compatible with conversation-state.js assertions.
 */
export function buildPendingWriteDraft(proposal) {
	const validated = validateInternalActionProposal(proposal);
	if (!validated.valid) {
		return validated;
	}

	const { actionType, fields, tool } = validated.value;
	const allowed = PENDING_WRITE_FIELD_KEYS[tool];
	if (!allowed) {
		return { valid: false, error: 'PENDING_WRITE_TOOL_INVALID' };
	}

	/** @type {Record<string, unknown>} */
	const pendingWrite = { tool };
	for (const key of allowed) {
		if (key === 'tool') continue;
		pendingWrite[key] = fields[key] ?? null;
	}

	return { valid: true, value: pendingWrite };
}
