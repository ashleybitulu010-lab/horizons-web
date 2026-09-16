import { STEP_STATUS } from './plan-execution-states.js';

export function classifyToolOutcome(toolResult) {
	if (!toolResult) {
		return { status: STEP_STATUS.EXECUTION_ERROR, code: 'UNKNOWN_ERROR' };
	}
	if (!toolResult.success) {
		return {
			status: STEP_STATUS.EXECUTION_ERROR,
			code: toolResult.error?.code || 'EXECUTION_ERROR',
		};
	}

	const summary = toolResult.data?.summary;
	if (summary?.count === 0) {
		return { status: STEP_STATUS.NO_DATA, code: null };
	}

	return { status: STEP_STATUS.SUCCESS, code: null };
}

function buildStepResultBase(step, startedAt) {
	return {
		stepId: step.id,
		tool: step.tool,
		arguments: { ...(step.arguments || {}) },
		status: STEP_STATUS.RUNNING,
		data: null,
		summary: null,
		error: null,
		durationMs: 0,
		startedAt,
		finishedAt: null,
	};
}

/**
 * Execute a single plan step with individual timeout.
 * Late results after timeout are ignored.
 */
export async function executePlanStep(step, executionContext, options = {}) {
	const startedAt = Date.now();
	const stepTimeoutMs = options.stepTimeoutMs ?? 10_000;
	const referenceDate = options.referenceDate || new Date();
	const runTool = options.executeTool;
	let settled = false;

	const base = buildStepResultBase(step, startedAt);

	if (!runTool) {
		return {
			...base,
			status: STEP_STATUS.EXECUTION_ERROR,
			error: { code: 'EXECUTOR_MISSING', message: 'executeTool is required' },
			durationMs: Date.now() - startedAt,
			finishedAt: Date.now(),
		};
	}

	const execPromise = (async () => {
		try {
			const toolResult = await runTool(
				step.tool,
				executionContext,
				step.arguments,
				referenceDate,
			);
			if (settled) return null;
			settled = true;

			const outcome = classifyToolOutcome(toolResult);
			const finishedAt = Date.now();
			return {
				...base,
				status: outcome.status,
				data: toolResult?.data ?? null,
				summary: toolResult?.data?.summary ?? null,
				error: outcome.status === STEP_STATUS.EXECUTION_ERROR
					? (toolResult?.error || { code: outcome.code, message: 'Tool failed' })
					: null,
				durationMs: finishedAt - startedAt,
				finishedAt,
				toolResult,
			};
		} catch (err) {
			if (settled) return null;
			settled = true;
			const finishedAt = Date.now();
			return {
				...base,
				status: STEP_STATUS.EXECUTION_ERROR,
				error: {
					code: err?.code || 'EXECUTION_ERROR',
					message: err?.message || 'Tool execution failed',
				},
				durationMs: finishedAt - startedAt,
				finishedAt,
				toolResult: {
					success: false,
					tool: step.tool,
					data: null,
					meta: {},
					error: {
						code: err?.code || 'EXECUTION_ERROR',
						message: err?.message || 'Tool execution failed',
					},
				},
			};
		}
	})();

	const timeoutPromise = new Promise((resolve) => {
		setTimeout(() => {
			if (settled) {
				resolve(null);
				return;
			}
			settled = true;
			const finishedAt = Date.now();
			resolve({
				...base,
				status: STEP_STATUS.TIMEOUT,
				error: { code: 'STEP_TIMEOUT', message: `Step timed out after ${stepTimeoutMs}ms` },
				durationMs: finishedAt - startedAt,
				finishedAt,
				toolResult: {
					success: false,
					tool: step.tool,
					data: null,
					meta: {},
					error: { code: 'STEP_TIMEOUT', message: `Step timed out after ${stepTimeoutMs}ms` },
				},
			});
		}, stepTimeoutMs);
	});

	const result = await Promise.race([execPromise, timeoutPromise]);
	if (result) return result;

	const finishedAt = Date.now();
	return {
		...base,
		status: STEP_STATUS.TIMEOUT,
		error: { code: 'STEP_TIMEOUT', message: `Step timed out after ${stepTimeoutMs}ms` },
		durationMs: finishedAt - startedAt,
		finishedAt,
		toolResult: {
			success: false,
			tool: step.tool,
			data: null,
			meta: {},
			error: { code: 'STEP_TIMEOUT', message: `Step timed out after ${stepTimeoutMs}ms` },
		},
	};
}
