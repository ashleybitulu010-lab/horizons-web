import { executeTool } from '../../tools/registry.js';
import { analyzeFinancialResults } from './financial/financial-analyzer.js';
import { getExecutorConfig } from './config.js';
import { buildPlanMetrics } from './plan-execution-metrics.js';
import { STEP_STATUS } from './plan-execution-states.js';
import { scheduleAnalysisPlan } from './plan-scheduler.js';
import { validateAnalysisPlanExtended } from './plan-validator-extended.js';
import { isWriteToolName } from './plan-step-contract.js';

export const EXECUTION_CODES = Object.freeze({
	SUCCESS: 'SUCCESS',
	PARTIAL: 'PARTIAL',
	EXECUTION_ERROR: 'EXECUTION_ERROR',
	INVALID_PLAN: 'INVALID_PLAN',
	WRITE_EXECUTION_DEFERRED: 'WRITE_EXECUTION_DEFERRED',
	MISSING_EXECUTION_CONTEXT: 'MISSING_EXECUTION_CONTEXT',
	PLAN_TIMEOUT: 'PLAN_TIMEOUT',
});

function assertExecutionContext(executionContext) {
	if (!executionContext?.user?.id) {
		return { valid: false, error: EXECUTION_CODES.MISSING_EXECUTION_CONTEXT };
	}
	if (!executionContext.user.clientId || !executionContext.user.activeActivityId) {
		return { valid: false, error: EXECUTION_CODES.MISSING_EXECUTION_CONTEXT };
	}
	return { valid: true };
}

function mapStepResultsToLegacy(stepResults) {
	const toolResults = stepResults
		.map((r) => r.toolResult)
		.filter(Boolean);

	const stepOutcomes = stepResults.map((r) => ({
		stepId: r.stepId,
		tool: r.tool,
		status: r.status,
		code: r.error?.code || null,
	}));

	return { toolResults, stepOutcomes };
}

function resolveExecutionCode(scheduled) {
	if (scheduled.stepResults.some((r) => r.status === STEP_STATUS.PLAN_TIMEOUT)) {
		return EXECUTION_CODES.PLAN_TIMEOUT;
	}
	const hasInterpretableOutcome = scheduled.stepResults.some((r) => (
		r.status === STEP_STATUS.SUCCESS || r.status === STEP_STATUS.NO_DATA
	));
	if (scheduled.partial && hasInterpretableOutcome) {
		return EXECUTION_CODES.PARTIAL;
	}
	if (scheduled.success) {
		return EXECUTION_CODES.SUCCESS;
	}
	return EXECUTION_CODES.EXECUTION_ERROR;
}

/**
 * Execute a validated AnalysisPlan with parallel read scheduling.
 * Writes return WRITE_EXECUTION_DEFERRED without execution.
 */
export async function executeAnalysisPlan(plan, executionContext, options = {}) {
	const contextCheck = assertExecutionContext(executionContext);
	if (!contextCheck.valid) {
		return {
			success: false,
			code: contextCheck.error,
			partial: false,
			toolResults: [],
			stepOutcomes: [],
			stepResults: [],
			metrics: null,
		};
	}

	const validated = validateAnalysisPlanExtended(plan, options);
	if (!validated.valid) {
		return {
			success: false,
			code: EXECUTION_CODES.INVALID_PLAN,
			error: validated.error,
			partial: false,
			toolResults: [],
			stepOutcomes: [],
			stepResults: [],
			metrics: null,
		};
	}

	const normalizedPlan = validated.value;
	const writeSteps = normalizedPlan.steps.filter((step) => isWriteToolName(step.tool));
	if (writeSteps.length > 0) {
		return {
			success: false,
			code: EXECUTION_CODES.WRITE_EXECUTION_DEFERRED,
			partial: false,
			deferredSteps: writeSteps.map((step) => step.id),
			toolResults: [],
			stepOutcomes: writeSteps.map((step) => ({
				stepId: step.id,
				tool: step.tool,
				status: STEP_STATUS.WRITE_DEFERRED,
				code: EXECUTION_CODES.WRITE_EXECUTION_DEFERRED,
			})),
			stepResults: writeSteps.map((step) => ({
				stepId: step.id,
				tool: step.tool,
				arguments: { ...(step.arguments || {}) },
				status: STEP_STATUS.WRITE_DEFERRED,
				data: null,
				summary: null,
				error: { code: EXECUTION_CODES.WRITE_EXECUTION_DEFERRED, message: 'Write deferred to F4-B2' },
				durationMs: 0,
				startedAt: null,
				finishedAt: null,
				toolResult: null,
			})),
			metrics: null,
		};
	}

	const executorConfig = getExecutorConfig(options.env);
	const scheduled = await scheduleAnalysisPlan(normalizedPlan.steps, executionContext, {
		executeTool: options.executeTool || executeTool,
		maxConcurrency: options.maxConcurrency ?? executorConfig.maxConcurrency,
		stepTimeoutMs: options.stepTimeoutMs ?? executorConfig.stepTimeoutMs,
		planTimeoutMs: options.planTimeoutMs ?? executorConfig.planTimeoutMs,
		referenceDate: options.referenceDate || new Date(),
	});

	const metrics = buildPlanMetrics(
		scheduled.stepResults,
		scheduled.planStartedAt,
		scheduled.planFinishedAt,
		scheduled.maxConcurrency,
	);

	const { toolResults, stepOutcomes } = mapStepResultsToLegacy(scheduled.stepResults);
	const code = resolveExecutionCode(scheduled);

	let analysisResult = null;
	let financialAnalysis = null;

	if (scheduled.stepResults.length > 0) {
		const analyzed = analyzeFinancialResults({
			goal: normalizedPlan.goal || null,
			executionResult: {
				partial: scheduled.partial,
				success: scheduled.success,
				code,
			},
			stepResults: scheduled.stepResults,
		});
		financialAnalysis = analyzed.financialAnalysis;
		analysisResult = analyzed.analysisResult;
	}

	return {
		success: scheduled.success && code === EXECUTION_CODES.SUCCESS,
		partial: scheduled.partial,
		code,
		toolResults,
		stepOutcomes,
		stepResults: scheduled.stepResults,
		metrics,
		analysisResult,
		financialAnalysis,
	};
}
