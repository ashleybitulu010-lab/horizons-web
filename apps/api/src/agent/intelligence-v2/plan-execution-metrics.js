import { STEP_STATUS } from './plan-execution-states.js';

export function createEmptyPlanMetrics(maxConcurrency = 4) {
	return {
		planDurationMs: 0,
		stepCount: 0,
		completedCount: 0,
		successCount: 0,
		noDataCount: 0,
		errorCount: 0,
		timeoutCount: 0,
		blockedCount: 0,
		maxConcurrency,
		actualMaxConcurrency: 0,
		stepMetrics: [],
	};
}

export function buildPlanMetrics(stepResults, planStartedAt, planFinishedAt, maxConcurrency) {
	const metrics = createEmptyPlanMetrics(maxConcurrency);
	metrics.planDurationMs = Math.max(0, planFinishedAt - planStartedAt);
	metrics.stepCount = stepResults.length;
	metrics.completedCount = stepResults.filter((r) => r.status !== STEP_STATUS.PENDING
		&& r.status !== STEP_STATUS.READY
		&& r.status !== STEP_STATUS.RUNNING).length;

	let peak = 0;
	let current = 0;
	const timeline = stepResults
		.flatMap((r) => [
			{ t: r.startedAt, delta: 1 },
			{ t: r.finishedAt, delta: -1 },
		])
		.filter((e) => e.t != null)
		.sort((a, b) => a.t - b.t);

	for (const event of timeline) {
		current += event.delta;
		if (current > peak) peak = current;
	}

	metrics.actualMaxConcurrency = peak;

	for (const result of stepResults) {
		if (result.status === STEP_STATUS.SUCCESS) metrics.successCount += 1;
		if (result.status === STEP_STATUS.NO_DATA) metrics.noDataCount += 1;
		if (result.status === STEP_STATUS.EXECUTION_ERROR) metrics.errorCount += 1;
		if (result.status === STEP_STATUS.TIMEOUT) metrics.timeoutCount += 1;
		if (result.status === STEP_STATUS.BLOCKED || result.status === STEP_STATUS.PLAN_TIMEOUT) {
			metrics.blockedCount += 1;
		}

		metrics.stepMetrics.push({
			stepId: result.stepId,
			tool: result.tool,
			durationMs: result.durationMs ?? 0,
			status: result.status,
		});
	}

	return metrics;
}

export function sanitizeMetricsForLog(metrics) {
	if (!metrics) return null;
	return {
		planDurationMs: metrics.planDurationMs,
		stepCount: metrics.stepCount,
		completedCount: metrics.completedCount,
		successCount: metrics.successCount,
		noDataCount: metrics.noDataCount,
		errorCount: metrics.errorCount,
		timeoutCount: metrics.timeoutCount,
		blockedCount: metrics.blockedCount,
		maxConcurrency: metrics.maxConcurrency,
		actualMaxConcurrency: metrics.actualMaxConcurrency,
	};
}
