import { computeRequestHash } from '../lib/agent-operation-idempotency.js';
import { requireClientScope } from './supabase-scoped.js';
import {
	buildExpenseToolResultFromTransactional,
	buildSaleToolResultFromTransactional,
	isIdempotentConfirmEnabled,
	isTransactionalConfirmEnabled,
	TRANSACTIONAL_CONFIRM_STATUS,
} from './agent-transactional-write-service.js';
import logger from '../utils/logger.js';

export const IDEMPOTENT_REPLAY_ERROR = Object.freeze({
	OPERATION_ID_MISSING: 'OPERATION_ID_MISSING',
});

const replayMetrics = {
	idempotent_replay_success: 0,
	idempotent_replay_blocked: 0,
};

export function resetIdempotentReplayMetricsForTests() {
	replayMetrics.idempotent_replay_success = 0;
	replayMetrics.idempotent_replay_blocked = 0;
}

export function getIdempotentReplayMetricsForTests() {
	return { ...replayMetrics };
}

export function isTransactionalSuccessStatus(status) {
	return status === TRANSACTIONAL_CONFIRM_STATUS.COMMITTED
		|| status === TRANSACTIONAL_CONFIRM_STATUS.ALREADY_COMPLETED;
}

export function isIdempotentReplayStatus(status) {
	return status === TRANSACTIONAL_CONFIRM_STATUS.ALREADY_COMPLETED;
}

/**
 * Build RPC idempotency params for a confirmed pending write.
 * When idempotent confirm is enabled, operation_id must already exist — never mint on confirm.
 */
export function buildIdempotentRpcParams(user, previousState, pendingWrite) {
	if (!isIdempotentConfirmEnabled() || !isTransactionalConfirmEnabled()) {
		return { operationId: null, requestHash: null, ready: true };
	}

	const clientId = requireClientScope(user);
	const operationId = previousState?.pendingOperationId ?? null;

	if (!operationId) {
		return {
			operationId: null,
			requestHash: null,
			ready: false,
			errorCode: IDEMPOTENT_REPLAY_ERROR.OPERATION_ID_MISSING,
		};
	}

	return {
		operationId,
		requestHash: computeRequestHash(clientId, pendingWrite),
		ready: true,
	};
}

/**
 * Map transactional RPC outcome to agent confirmation result (commit or durable replay).
 */
export function resolveTransactionalToolOutcome(rpcResult, pendingWrite) {
	if (!rpcResult?.success || !isTransactionalSuccessStatus(rpcResult.status)) {
		return { success: false, replay: false, toolResult: null };
	}

	const replay = isIdempotentReplayStatus(rpcResult.status);
	if (replay) {
		replayMetrics.idempotent_replay_success += 1;
		logger.info('idempotent_replay', {
			tool: pendingWrite?.tool ?? rpcResult.operation,
			status: rpcResult.status,
			resultId: rpcResult.result_id ?? null,
		});
	} else if (rpcResult.status === TRANSACTIONAL_CONFIRM_STATUS.COMMITTED) {
		logger.info('transactional_write_committed', {
			tool: pendingWrite?.tool ?? rpcResult.operation,
			status: rpcResult.status,
			resultId: rpcResult.result_id ?? null,
		});
	}

	let toolResult;
	if (pendingWrite?.tool === 'create_expense' || rpcResult.operation === 'create_expense') {
		toolResult = buildExpenseToolResultFromTransactional(rpcResult);
	} else {
		toolResult = buildSaleToolResultFromTransactional(rpcResult, pendingWrite);
	}

	return { success: true, replay, toolResult };
}

export function recordIdempotentReplayBlocked(reason) {
	replayMetrics.idempotent_replay_blocked += 1;
	logger.warn('idempotent_replay_blocked', { reason });
}
