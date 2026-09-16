import {
	isDependencyFailure,
	isDependencySatisfied,
	isTerminalStatus,
	STEP_STATUS,
} from './plan-execution-states.js';
import { executePlanStep } from './plan-step-executor.js';

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function createBlockedResult(step, reason, startedAt) {
	const finishedAt = Date.now();
	return {
		stepId: step.id,
		tool: step.tool,
		arguments: { ...(step.arguments || {}) },
		status: reason === STEP_STATUS.PLAN_TIMEOUT ? STEP_STATUS.PLAN_TIMEOUT : STEP_STATUS.BLOCKED,
		data: null,
		summary: null,
		error: { code: reason, message: `Step blocked: ${reason}` },
		durationMs: 0,
		startedAt,
		finishedAt,
		toolResult: null,
	};
}

function evaluateDependencies(step, resultsById) {
	for (const depId of step.dependsOn || []) {
		const dep = resultsById.get(depId);
		if (!dep) {
			return { ready: false, blocked: true, reason: 'UNKNOWN_DEPENDENCY' };
		}
		if (!isTerminalStatus(dep.status)) {
			return { ready: false, blocked: false };
		}
		if (isDependencyFailure(dep.status)) {
			return { ready: false, blocked: true, reason: 'DEPENDENCY_FAILED' };
		}
		if (!isDependencySatisfied(dep.status)) {
			return { ready: false, blocked: true, reason: 'DEPENDENCY_UNSATISFIED' };
		}
	}
	return { ready: true, blocked: false };
}

function computePartial(stepResults) {
	return stepResults.some((r) => (
		r.status === STEP_STATUS.EXECUTION_ERROR
		|| r.status === STEP_STATUS.TIMEOUT
		|| r.status === STEP_STATUS.BLOCKED
		|| r.status === STEP_STATUS.PLAN_TIMEOUT
	));
}

function computeSuccess(stepResults) {
	return stepResults.every((r) => (
		r.status === STEP_STATUS.SUCCESS
		|| r.status === STEP_STATUS.NO_DATA
	));
}

/**
 * Dependency-aware scheduler with concurrency limit and timeouts.
 */
export async function scheduleAnalysisPlan(steps, executionContext, options = {}) {
	const maxConcurrency = Math.max(1, options.maxConcurrency ?? 4);
	const stepTimeoutMs = options.stepTimeoutMs ?? 10_000;
	const planTimeoutMs = options.planTimeoutMs ?? 30_000;
	const planStartedAt = Date.now();
	const planDeadline = planStartedAt + planTimeoutMs;

	const resultsById = new Map();
	const inFlight = new Map();

	for (const step of steps) {
		resultsById.set(step.id, {
			stepId: step.id,
			tool: step.tool,
			arguments: { ...(step.arguments || {}) },
			status: STEP_STATUS.PENDING,
			data: null,
			summary: null,
			error: null,
			durationMs: 0,
			startedAt: null,
			finishedAt: null,
			toolResult: null,
		});
	}

	function markBlockedSteps(reason) {
		for (const step of steps) {
			const current = resultsById.get(step.id);
			if (current.status !== STEP_STATUS.PENDING) continue;
			const deps = evaluateDependencies(step, resultsById);
			if (deps.blocked) {
				resultsById.set(step.id, createBlockedResult(step, reason, Date.now()));
			}
		}
	}

	function getReadySteps() {
		const ready = [];
		for (const step of steps) {
			const current = resultsById.get(step.id);
			if (current.status !== STEP_STATUS.PENDING) continue;
			const deps = evaluateDependencies(step, resultsById);
			if (deps.ready) ready.push(step);
		}
		return ready;
	}

	function allTerminal() {
		return steps.every((step) => isTerminalStatus(resultsById.get(step.id).status));
	}

	while (!allTerminal()) {
		if (Date.now() >= planDeadline) {
			for (const step of steps) {
				const current = resultsById.get(step.id);
				if (current.status === STEP_STATUS.PENDING) {
					resultsById.set(step.id, createBlockedResult(step, STEP_STATUS.PLAN_TIMEOUT, Date.now()));
				}
			}
			break;
		}

		markBlockedSteps('DEPENDENCY_FAILED');

		const readySteps = getReadySteps();
		while (inFlight.size < maxConcurrency && readySteps.length > 0) {
			if (Date.now() >= planDeadline) break;

			const step = readySteps.shift();
			const pending = resultsById.get(step.id);
			if (pending.status !== STEP_STATUS.PENDING) continue;

			resultsById.set(step.id, {
				...pending,
				status: STEP_STATUS.RUNNING,
				startedAt: Date.now(),
			});

			const promise = executePlanStep(step, executionContext, {
				executeTool: options.executeTool,
				stepTimeoutMs,
				referenceDate: options.referenceDate,
			}).then((result) => {
				resultsById.set(step.id, result);
				inFlight.delete(step.id);
			}).catch((err) => {
				resultsById.set(step.id, {
					...createBlockedResult(step, STEP_STATUS.EXECUTION_ERROR, Date.now()),
					error: {
						code: err?.code || 'EXECUTION_ERROR',
						message: err?.message || 'Unhandled scheduler error',
					},
				});
				inFlight.delete(step.id);
			});

			inFlight.set(step.id, promise);
		}

		if (inFlight.size === 0 && getReadySteps().length === 0) {
			markBlockedSteps('DEPENDENCY_FAILED');
			if (steps.every((step) => {
				const s = resultsById.get(step.id).status;
				return s !== STEP_STATUS.PENDING && s !== STEP_STATUS.RUNNING;
			})) {
				break;
			}
			await sleep(5);
			continue;
		}

		if (inFlight.size > 0) {
			await Promise.race([...inFlight.values()]);
		} else {
			await sleep(5);
		}
	}

	if (inFlight.size > 0) {
		await Promise.all([...inFlight.values()]);
	}

	const orderedResults = steps.map((step) => resultsById.get(step.id));
	const planFinishedAt = Date.now();

	return {
		stepResults: orderedResults,
		partial: computePartial(orderedResults),
		success: computeSuccess(orderedResults),
		planStartedAt,
		planFinishedAt,
		maxConcurrency,
	};
}
