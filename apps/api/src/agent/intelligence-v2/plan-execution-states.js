/** Normalized step execution states for the V2 orchestrator. */
export const STEP_STATUS = Object.freeze({
	PENDING: 'PENDING',
	READY: 'READY',
	RUNNING: 'RUNNING',
	SUCCESS: 'SUCCESS',
	NO_DATA: 'NO_DATA',
	EXECUTION_ERROR: 'EXECUTION_ERROR',
	TIMEOUT: 'TIMEOUT',
	BLOCKED: 'BLOCKED',
	WRITE_DEFERRED: 'WRITE_DEFERRED',
	PLAN_TIMEOUT: 'PLAN_TIMEOUT',
});

export const TERMINAL_STEP_STATUSES = Object.freeze([
	STEP_STATUS.SUCCESS,
	STEP_STATUS.NO_DATA,
	STEP_STATUS.EXECUTION_ERROR,
	STEP_STATUS.TIMEOUT,
	STEP_STATUS.BLOCKED,
	STEP_STATUS.WRITE_DEFERRED,
	STEP_STATUS.PLAN_TIMEOUT,
]);

export const DEPENDENCY_SATISFIED_STATUSES = Object.freeze([
	STEP_STATUS.SUCCESS,
	STEP_STATUS.NO_DATA,
]);

export const DEPENDENCY_FAILURE_STATUSES = Object.freeze([
	STEP_STATUS.EXECUTION_ERROR,
	STEP_STATUS.TIMEOUT,
	STEP_STATUS.BLOCKED,
	STEP_STATUS.PLAN_TIMEOUT,
]);

export function isTerminalStatus(status) {
	return TERMINAL_STEP_STATUSES.includes(status);
}

export function isDependencySatisfied(status) {
	return DEPENDENCY_SATISFIED_STATUSES.includes(status);
}

export function isDependencyFailure(status) {
	return DEPENDENCY_FAILURE_STATUSES.includes(status);
}
