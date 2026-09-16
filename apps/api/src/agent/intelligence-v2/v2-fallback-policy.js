import { ACTION_PROPOSAL_STATUS } from './action/action-proposal-contract.js';

export const V2_FALLBACK_POLICY = Object.freeze({
	SAFE_FALLBACK: 'SAFE_FALLBACK',
	NO_FALLBACK: 'NO_FALLBACK',
	AMBIGUOUS_WRITE: 'AMBIGUOUS_WRITE',
});

const NO_FALLBACK_ACTION_STATUSES = new Set([
	ACTION_PROPOSAL_STATUS.NEEDS_CLARIFICATION,
	ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION,
	ACTION_PROPOSAL_STATUS.CONFIRMATION_REJECTED,
	ACTION_PROPOSAL_STATUS.CONFIRMATION_ACCEPTED,
	ACTION_PROPOSAL_STATUS.CONFIRMED,
	ACTION_PROPOSAL_STATUS.COMPLETED,
	ACTION_PROPOSAL_STATUS.ALREADY_COMPLETED,
	ACTION_PROPOSAL_STATUS.MODIFICATION_DETECTED,
	ACTION_PROPOSAL_STATUS.FAILED,
	'NO_PENDING_TO_CONFIRM',
	'NO_PENDING_TO_REJECT',
	'TRANSACTIONAL_FAILED',
	'REQUEST_HASH_MISMATCH',
	'VERSION_MISMATCH',
	'ALREADY_CONSUMED',
	'PENDING_NOT_FOUND',
	'OPERATION_ID_MISSING',
	'F4_B2_UNAVAILABLE',
]);

const COMMITTED_F4_STATUSES = new Set([
	'COMMITTED',
	'ALREADY_COMPLETED',
]);

const READ_GOAL_TYPES = new Set(['QUESTION', 'ANALYSIS', 'MIXED']);
const PRIMARY_SAFE_FALLBACK_MODE = 'V2_PRIMARY_SAFE_FALLBACK';

function isReadGoal(v2Http) {
	return READ_GOAL_TYPES.has(v2Http?.goalType);
}

function resolvePrimaryUnhandledFallback(v2Http, cutoverMode) {
	const isAction = v2Http?.goalType === 'ACTION' || v2Http?.mode === 'action_proposal';
	if (isAction) {
		return {
			policy: V2_FALLBACK_POLICY.NO_FALLBACK,
			noN8nFallback: true,
			reason: 'primary_unhandled_action',
		};
	}
	if (cutoverMode === PRIMARY_SAFE_FALLBACK_MODE) {
		return {
			policy: V2_FALLBACK_POLICY.SAFE_FALLBACK,
			noN8nFallback: false,
			reason: 'primary_unhandled_read_safe',
		};
	}
	return {
		policy: V2_FALLBACK_POLICY.NO_FALLBACK,
		noN8nFallback: true,
		reason: 'primary_unhandled_read',
	};
}

function resolveExecutionCodeFallback(v2Http, cutoverMode) {
	const execCode = v2Http.executionCode || v2Http.responseStatus;
	if (execCode === 'NO_DATA') {
		return {
			policy: V2_FALLBACK_POLICY.NO_FALLBACK,
			noN8nFallback: true,
			reason: 'read_no_data',
		};
	}
	if (execCode === 'PARTIAL') {
		return {
			policy: V2_FALLBACK_POLICY.NO_FALLBACK,
			noN8nFallback: true,
			reason: 'read_partial',
		};
	}
	if (execCode === 'TIMEOUT' || execCode === 'EXECUTION_ERROR' || execCode === 'PLAN_BUILD_FAILED') {
		if (isReadGoal(v2Http) && cutoverMode === PRIMARY_SAFE_FALLBACK_MODE) {
			return {
				policy: V2_FALLBACK_POLICY.SAFE_FALLBACK,
				noN8nFallback: false,
				reason: `read_${String(execCode).toLowerCase()}_safe`,
			};
		}
		return {
			policy: V2_FALLBACK_POLICY.NO_FALLBACK,
			noN8nFallback: true,
			reason: `read_${String(execCode).toLowerCase()}`,
		};
	}
	return null;
}

/**
 * Resolve whether the HTTP client may fall back to n8n for this V2 turn.
 */
export function resolveV2FallbackPolicy(v2Http = null, options = {}) {
	const cutoverMode = options.cutoverMode || v2Http?.cutoverMode || null;

	if (!v2Http?.handled) {
		if (v2Http?.primaryPath === 'V2_PRIMARY_UNHANDLED') {
			return resolvePrimaryUnhandledFallback(v2Http, cutoverMode);
		}
		return {
			policy: V2_FALLBACK_POLICY.SAFE_FALLBACK,
			noN8nFallback: false,
			reason: 'not_v2',
		};
	}

	const executionFallback = resolveExecutionCodeFallback(v2Http, cutoverMode);
	if (executionFallback) {
		return executionFallback;
	}

	if (v2Http.mode === 'action_proposal' || v2Http.goalType === 'ACTION') {
		if (v2Http.f4Committed === true) {
			return {
				policy: V2_FALLBACK_POLICY.NO_FALLBACK,
				noN8nFallback: true,
				reason: 'action_committed',
			};
		}

		if (v2Http.f4Status && COMMITTED_F4_STATUSES.has(v2Http.f4Status)) {
			return {
				policy: V2_FALLBACK_POLICY.NO_FALLBACK,
				noN8nFallback: true,
				reason: 'f4_committed',
			};
		}

		if (v2Http.actionProposalStatus && NO_FALLBACK_ACTION_STATUSES.has(v2Http.actionProposalStatus)) {
			return {
				policy: V2_FALLBACK_POLICY.NO_FALLBACK,
				noN8nFallback: true,
				reason: `action_${v2Http.actionProposalStatus}`,
			};
		}

		if (v2Http.hasPending === true) {
			return {
				policy: V2_FALLBACK_POLICY.NO_FALLBACK,
				noN8nFallback: true,
				reason: 'action_pending',
			};
		}

		return {
			policy: V2_FALLBACK_POLICY.NO_FALLBACK,
			noN8nFallback: true,
			reason: 'action_v2',
		};
	}

	if (v2Http.goalType === 'QUESTION' || v2Http.goalType === 'ANALYSIS' || v2Http.goalType === 'MIXED') {
		return {
			policy: V2_FALLBACK_POLICY.SAFE_FALLBACK,
			noN8nFallback: false,
			reason: 'read_v2',
		};
	}

	if (v2Http.code === 'MISSING_SCOPE') {
		return {
			policy: V2_FALLBACK_POLICY.NO_FALLBACK,
			noN8nFallback: true,
			reason: 'missing_scope',
		};
	}

	return {
		policy: V2_FALLBACK_POLICY.SAFE_FALLBACK,
		noN8nFallback: false,
		reason: 'v2_default_read',
	};
}

export function attachFallbackPolicyToV2Http(v2Http, options = {}) {
	if (!v2Http) return null;
	const resolved = resolveV2FallbackPolicy(v2Http, options);
	return {
		...v2Http,
		noN8nFallback: resolved.noN8nFallback,
		fallbackPolicy: resolved.policy,
		fallbackReason: resolved.reason,
	};
}
