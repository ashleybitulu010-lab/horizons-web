import {
	ACTION_FIELD_KEYS,
	ACTION_PROPOSAL_STATUS,
	ACTION_TYPES,
	validateInternalActionProposal,
	validateUserFacingActionProposal,
} from './action-proposal-contract.js';

const TERMINAL_STATUSES = Object.freeze([
	ACTION_PROPOSAL_STATUS.COMPLETED,
	ACTION_PROPOSAL_STATUS.ALREADY_COMPLETED,
	ACTION_PROPOSAL_STATUS.REJECTED,
	ACTION_PROPOSAL_STATUS.FAILED,
]);

const CONFIRM_ELIGIBLE_STATUSES = Object.freeze([
	ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION,
	ACTION_PROPOSAL_STATUS.CONFIRMATION_ACCEPTED,
	ACTION_PROPOSAL_STATUS.CONFIRMED,
]);

function fieldIsPresent(actionType, key, fields) {
	const value = fields?.[key];
	if (value == null || value === '') {
		return false;
	}

	if (key === 'label' || key === 'product') {
		return String(value).trim().length > 0;
	}

	const num = Number(value);
	if (!Number.isFinite(num)) {
		return false;
	}

	if (key === 'amountPaid') {
		return num >= 0;
	}

	return num > 0;
}

function computeExpectedMissingFields(actionType, fields) {
	const required = ACTION_FIELD_KEYS[actionType] || [];
	return required.filter((key) => !fieldIsPresent(actionType, key, fields));
}

function statusRequiresCompleteFields(status) {
	return [
		ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION,
		ACTION_PROPOSAL_STATUS.CONFIRMATION_ACCEPTED,
		ACTION_PROPOSAL_STATUS.CONFIRMED,
		ACTION_PROPOSAL_STATUS.COMPLETED,
		ACTION_PROPOSAL_STATUS.ALREADY_COMPLETED,
	].includes(status);
}

function statusRequiresPendingWrite(status) {
	return [
		ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION,
		ACTION_PROPOSAL_STATUS.CONFIRMATION_ACCEPTED,
		ACTION_PROPOSAL_STATUS.CONFIRMED,
	].includes(status);
}

/**
 * Validate business completeness and status coherence for InternalActionProposal.
 */
export function validateActionProposalBusinessRules(raw, options = {}) {
	const structural = validateInternalActionProposal(raw);
	if (!structural.valid) {
		return structural;
	}

	const proposal = structural.value;
	const issues = [];
	const expectedMissing = computeExpectedMissingFields(proposal.actionType, proposal.fields);

	if (proposal.missingFields.length !== expectedMissing.length
		|| proposal.missingFields.some((key) => !expectedMissing.includes(key))) {
		issues.push('MISSING_FIELDS_MISMATCH');
	}

	if (statusRequiresCompleteFields(proposal.status) && expectedMissing.length > 0) {
		issues.push('INCOMPLETE_FOR_STATUS');
	}

	if (proposal.status === ACTION_PROPOSAL_STATUS.NEEDS_CLARIFICATION) {
		if (expectedMissing.length === 0) {
			issues.push('CLARIFICATION_WITHOUT_MISSING_FIELDS');
		}
		if (!proposal.clarificationPrompt) {
			issues.push('CLARIFICATION_PROMPT_REQUIRED');
		}
	}

	if (statusRequiresPendingWrite(proposal.status)) {
		if (!proposal.pendingWrite) {
			issues.push('PENDING_WRITE_REQUIRED');
		}
		if (!proposal.confirmationRequired && proposal.status === ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION) {
			issues.push('CONFIRMATION_FLAG_REQUIRED');
		}
	}

	if (proposal.status === ACTION_PROPOSAL_STATUS.DEFERRED && proposal.pendingWrite != null) {
		issues.push('DEFERRED_MUST_NOT_HAVE_PENDING');
	}

	if (TERMINAL_STATUSES.includes(proposal.status) && proposal.confirmationRequired) {
		issues.push('TERMINAL_STATUS_CANNOT_REQUIRE_CONFIRMATION');
	}

	if (options.requireUserFacingSafe !== false) {
		const facing = validateUserFacingActionProposal({
			actionType: proposal.actionType,
			status: proposal.status,
			description: proposal.description,
			fields: proposal.fields,
			missingFields: expectedMissing,
			warnings: proposal.warnings,
			confirmationRequired: proposal.confirmationRequired,
			clarificationPrompt: proposal.clarificationPrompt,
		});
		if (!facing.valid) {
			issues.push(`USER_FACING_${facing.error}`);
		}
	}

	if (issues.length > 0) {
		return {
			valid: false,
			error: issues[0],
			issues,
			value: proposal,
		};
	}

	return {
		valid: true,
		value: proposal,
		issues: [],
	};
}

/**
 * Check whether proposal can enter F4-B2 confirmation (backend-only).
 */
export function canConfirmActionProposal(raw) {
	const result = validateActionProposalBusinessRules(raw);
	if (!result.valid) {
		return { allowed: false, reason: result.error, issues: result.issues || [result.error] };
	}

	const { status } = result.value;
	if (!CONFIRM_ELIGIBLE_STATUSES.includes(status)) {
		return { allowed: false, reason: 'STATUS_NOT_CONFIRM_ELIGIBLE' };
	}

	return { allowed: true, proposal: result.value };
}

/**
 * Ensure ActionProposal stays separate from FinancialAnalysisResult.
 */
export function assertNotFinancialAnalysis(candidate) {
	if (!candidate || typeof candidate !== 'object') {
		return { valid: true };
	}

	const financialKeys = [
		'financialAnalysis',
		'metrics',
		'comparisons',
		'ratios',
		'drivers',
		'analysisType',
	];
	for (const key of financialKeys) {
		if (key in candidate) {
			return { valid: false, error: 'FINANCIAL_ANALYSIS_MIXED_WITH_ACTION' };
		}
	}

	if (candidate.domain && !candidate.actionType) {
		return { valid: false, error: 'FINANCIAL_ANALYSIS_MIXED_WITH_ACTION' };
	}

	return { valid: true };
}

/**
 * Compare two field sets to detect user modifications (invalidates old pending).
 */
export function detectActionFieldChanges(previousFields = {}, nextFields = {}, actionType) {
	const keys = ACTION_FIELD_KEYS[actionType] || [];
	/** @type {string[]} */
	const changed = [];

	for (const key of keys) {
		const prev = previousFields[key];
		const next = nextFields[key];
		const prevNorm = prev == null ? null : (typeof prev === 'string' ? prev.trim() : Number(prev));
		const nextNorm = next == null ? null : (typeof next === 'string' ? next.trim() : Number(next));

		if (prevNorm !== nextNorm) {
			changed.push(key);
		}
	}

	return {
		changed,
		isModification: changed.length > 0,
	};
}

export function validateActionProposalForPersistence(raw) {
	const business = validateActionProposalBusinessRules(raw);
	if (!business.valid) {
		return business;
	}

	const proposal = business.value;
	if (proposal.pendingWrite && proposal.status === ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION) {
		for (const key of ACTION_FIELD_KEYS[proposal.actionType]) {
			if (proposal.pendingWrite[key] !== proposal.fields[key]) {
				return {
					valid: false,
					error: 'PENDING_WRITE_FIELDS_MISMATCH',
					value: proposal,
				};
			}
		}
	}

	return business;
}
