import logger from '../../../utils/logger.js';
import { toUserFacingActionProposal } from './action-proposal-contract.js';

const actionMetrics = {
	action_proposal_created: 0,
	action_clarification_requested: 0,
	action_ready_for_confirmation: 0,
	action_pending_persist_success: 0,
	action_pending_persist_blocked: 0,
	action_confirm_success: 0,
	action_confirm_conflict: 0,
	action_confirm_failed: 0,
	action_rejected: 0,
	action_modification_detected: 0,
	action_deferred: 0,
};

export function resetActionMetricsForTests() {
	for (const key of Object.keys(actionMetrics)) {
		actionMetrics[key] = 0;
	}
}

export function getActionMetricsForTests() {
	return { ...actionMetrics };
}

export function sanitizeActionProposalForLog(proposal) {
	if (!proposal) return null;
	const facing = toUserFacingActionProposal(proposal);
	return {
		actionType: proposal.actionType,
		status: proposal.status,
		tool: proposal.tool ?? null,
		missingFields: proposal.missingFields || [],
		confirmationRequired: proposal.confirmationRequired,
		hasPendingWrite: proposal.pendingWrite != null,
		hasOperationId: proposal.pendingOperationId != null || proposal.operationId != null,
		diagnostics: proposal.diagnostics || {},
		userFacingValid: facing.valid,
	};
}

export function recordActionObservability(event, data = {}) {
	switch (event) {
		case 'proposal_created':
			actionMetrics.action_proposal_created += 1;
			break;
		case 'clarification_requested':
			actionMetrics.action_clarification_requested += 1;
			break;
		case 'ready_for_confirmation':
			actionMetrics.action_ready_for_confirmation += 1;
			break;
		case 'pending_persist_success':
			actionMetrics.action_pending_persist_success += 1;
			break;
		case 'pending_persist_blocked':
			actionMetrics.action_pending_persist_blocked += 1;
			break;
		case 'f4_confirm_success':
			actionMetrics.action_confirm_success += 1;
			break;
		case 'f4_confirm_conflict':
			actionMetrics.action_confirm_conflict += 1;
			break;
		case 'f4_confirm_failed':
		case 'f4_confirm_error':
		case 'f4_confirm_rejected':
		case 'f4_confirm_blocked':
			actionMetrics.action_confirm_failed += 1;
			break;
		case 'user_rejected':
			actionMetrics.action_rejected += 1;
			break;
		case 'modification_detected':
			actionMetrics.action_modification_detected += 1;
			break;
		case 'deferred':
			actionMetrics.action_deferred += 1;
			break;
		default:
			break;
	}

	logger.info('ashy_v2_action', {
		event,
		...data,
	});
}
