import {
	buildIdempotentRpcParams,
	IDEMPOTENT_REPLAY_ERROR,
	recordIdempotentReplayBlocked,
	resolveTransactionalToolOutcome,
} from '../../../services/agent-idempotent-replay-service.js';
import {
	confirmAndCreateExpense,
	confirmAndCreateSale,
	isTransactionalConfirmEnabled,
	TRANSACTIONAL_CONFIRM_STATUS,
} from '../../../services/agent-transactional-write-service.js';
import { ACTION_PROPOSAL_STATUS, ACTION_TOOLS } from './action-proposal-contract.js';
import { canConfirmActionProposal } from './action-proposal-validator.js';
import { clearActionPending } from './action-pending-bridge.js';
import { recordActionObservability } from './action-observability.js';

/**
 * Execute confirmed action via F4-B2 transactional RPC — single V2 write path.
 */
export async function executeActionConfirmationViaF4B2({
	user,
	sessionId,
	conversationState = {},
	proposal,
	persistConversationStateFn = null,
}) {
	const eligibility = canConfirmActionProposal(proposal);
	if (!eligibility.allowed) {
		recordActionObservability('f4_confirm_rejected', { reason: eligibility.reason });
		return {
			success: false,
			code: eligibility.reason,
			status: ACTION_PROPOSAL_STATUS.FAILED,
		};
	}

	const pending = conversationState.pendingWrite ?? proposal.pendingWrite;
	if (!pending) {
		return {
			success: false,
			code: 'NO_PENDING_WRITE',
			status: ACTION_PROPOSAL_STATUS.FAILED,
		};
	}

	if (!isTransactionalConfirmEnabled()) {
		recordActionObservability('f4_confirm_unavailable', {});
		return {
			success: false,
			code: 'F4_B2_UNAVAILABLE',
			status: ACTION_PROPOSAL_STATUS.DEFERRED,
		};
	}

	const idempotency = buildIdempotentRpcParams(user, conversationState, pending);
	if (!idempotency.ready) {
		recordIdempotentReplayBlocked(idempotency.errorCode);
		recordActionObservability('f4_confirm_blocked', { reason: idempotency.errorCode });
		return {
			success: false,
			code: idempotency.errorCode || IDEMPOTENT_REPLAY_ERROR.OPERATION_ID_MISSING,
			conflict: true,
			status: ACTION_PROPOSAL_STATUS.FAILED,
		};
	}

	const params = {
		user,
		expectedVersion: conversationState.pendingSessionVersion,
		consumeToken: conversationState.pendingConsumeToken,
		operationId: idempotency.operationId,
		requestHash: idempotency.requestHash,
	};

	let rpcResult;
	try {
		if (pending.tool === ACTION_TOOLS.CREATE_EXPENSE) {
			rpcResult = await confirmAndCreateExpense(params);
		} else if (pending.tool === ACTION_TOOLS.CREATE_SALE) {
			rpcResult = await confirmAndCreateSale(params);
		} else {
			return {
				success: false,
				code: 'UNSUPPORTED_TOOL',
				status: ACTION_PROPOSAL_STATUS.FAILED,
			};
		}
	} catch (err) {
		recordActionObservability('f4_confirm_error', {
			tool: pending.tool,
			code: err?.code || 'RPC_ERROR',
		});
		return {
			success: false,
			code: err?.code || 'RPC_ERROR',
			message: err?.message || 'Transactional confirmation failed',
			status: ACTION_PROPOSAL_STATUS.FAILED,
			error: err,
		};
	}

	if (rpcResult.status === TRANSACTIONAL_CONFIRM_STATUS.ALREADY_CONSUMED
		|| rpcResult.status === TRANSACTIONAL_CONFIRM_STATUS.VERSION_MISMATCH
		|| rpcResult.status === TRANSACTIONAL_CONFIRM_STATUS.REQUEST_HASH_MISMATCH) {
		recordActionObservability('f4_confirm_conflict', { status: rpcResult.status });
		return {
			success: false,
			conflict: true,
			code: rpcResult.status,
			status: ACTION_PROPOSAL_STATUS.FAILED,
			rpcResult,
		};
	}

	const resolvedOutcome = resolveTransactionalToolOutcome(rpcResult, pending);
	if (!resolvedOutcome.success) {
		recordActionObservability('f4_confirm_failed', { status: rpcResult?.status });
		return {
			success: false,
			code: 'TRANSACTIONAL_FAILED',
			status: ACTION_PROPOSAL_STATUS.FAILED,
			rpcResult,
		};
	}

	const cleared = await clearActionPending({ user, sessionId, conversationState });
	const finalStatus = resolvedOutcome.replay
		? ACTION_PROPOSAL_STATUS.ALREADY_COMPLETED
		: ACTION_PROPOSAL_STATUS.COMPLETED;

	recordActionObservability('f4_confirm_success', {
		tool: pending.tool,
		replay: resolvedOutcome.replay,
		status: rpcResult.status,
	});

	return {
		success: true,
		replay: resolvedOutcome.replay,
		code: rpcResult.status,
		status: finalStatus,
		toolResult: resolvedOutcome.toolResult,
		state: cleared.state,
		rpcResult,
	};
}
