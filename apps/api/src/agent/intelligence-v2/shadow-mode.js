import logger from '../../utils/logger.js';
import { planToolExecution } from '../tool-planner.js';
import { getShadowConfig, isIntelligenceV2ShadowEnabled } from './config.js';
import { sanitizeMetricsForLog } from './plan-execution-metrics.js';
import { STEP_STATUS } from './plan-execution-states.js';
import { classifyGoal } from './goal-classifier.js';
import { mapLegacyIntentToGoal } from './legacy-intent-mapper.js';
import { buildAnalysisPlanFromGoal } from './plan-builder.js';
import { executeAnalysisPlan } from './plan-executor.js';
import { sanitizeFinancialAnalysisForLog } from './financial/financial-analyzer.js';
import { sanitizeActionProposalForLog } from './action/action-observability.js';
import {
	buildActionProposalFromGoal,
	buildActionProposalFromPendingWrite,
} from './action/action-proposal-builder.js';
import { detectUserActionIntent, USER_ACTION_INTENT } from './action/action-confirmation-handler.js';
import { toUserFacingActionProposal } from './action/action-proposal-contract.js';
import { generateResponse, sanitizeResponseForLog } from './response/response-generator.js';
import { SHADOW_STATUS } from './shadow/shadow-contract.js';
import { createShadowRunId } from './shadow/shadow-run-id.js';
import { runShadowWithTimeout } from './shadow/shadow-runner.js';
import {
	normalizeLegacySide,
	normalizeV2Side,
} from './shadow/shadow-normalizer.js';
import {
	buildShadowComparisonResult,
	compareShadowSides,
} from './shadow/shadow-comparator.js';
import { mergeIntoGlobalShadowMetrics } from './shadow/shadow-metrics.js';
import { hasWriteTools } from './shadow/shadow-write-guard.js';

function sanitizeGoalForLog(goal) {
	if (!goal) return null;
	return {
		type: goal.type,
		domain: goal.domain,
		objective: goal.objective,
		periodType: goal.period?.type || null,
		comparisonEnabled: goal.comparison?.enabled ?? false,
		comparisonMetric: goal.comparison?.metric || null,
		hasActivityReference: Boolean(goal.activityReference),
		parameterKeys: Object.keys(goal.parameters || {}),
	};
}

function sanitizePlanForLog(planResult) {
	if (!planResult?.success || !planResult.plan) {
		return {
			planSuccess: false,
			reason: planResult?.reason || 'NO_PLAN',
		};
	}

	return {
		planSuccess: true,
		v2StepCount: planResult.plan.steps.length,
		v2Tools: planResult.plan.steps.map((step) => step.tool),
		requiresConfirmation: planResult.plan.requiresConfirmation,
		evidence: planResult.evidence || [],
	};
}

function sanitizeExecutionForLog(execution) {
	if (!execution) return null;
	return {
		code: execution.code,
		partial: execution.partial,
		v2DurationMs: execution.metrics?.planDurationMs ?? null,
		v2Statuses: (execution.stepResults || []).map((r) => r.status),
		v2MaxConcurrency: execution.metrics?.maxConcurrency ?? null,
		actualMaxConcurrency: execution.metrics?.actualMaxConcurrency ?? null,
		v2AnalysisType: execution.financialAnalysis?.analysisType ?? null,
		v2AnalysisStatus: execution.financialAnalysis?.status ?? null,
		v2AnalysisPartial: execution.financialAnalysis?.partial ?? null,
		v2MetricCount: execution.financialAnalysis?.diagnostics?.metricCount ?? null,
		v2DriverCount: execution.financialAnalysis?.diagnostics?.driverCount ?? null,
		v2AnalysisDurationMs: execution.financialAnalysis?.diagnostics?.analysisDurationMs ?? null,
	};
}

async function runShadowV2Execution(planResult, executionContext, options = {}) {
	if (!planResult?.success || !planResult.plan) {
		return null;
	}

	if (planResult.plan.requiresConfirmation || hasWriteTools(planResult.plan.steps)) {
		return {
			code: 'WRITE_EXECUTION_DEFERRED',
			partial: false,
			stepResults: planResult.plan.steps.map((step) => ({
				stepId: step.id,
				status: STEP_STATUS.WRITE_DEFERRED,
			})),
			metrics: null,
			shadow_write_guard: { blocked: true, reason: 'WRITE_DEFERRED' },
		};
	}

	if (!executionContext?.user?.clientId || !executionContext?.user?.activeActivityId) {
		return {
			code: 'SHADOW_EXECUTION_SKIPPED',
			reason: 'MISSING_EXECUTION_CONTEXT',
		};
	}

	return executeAnalysisPlan(planResult.plan, executionContext, options);
}

function buildConfirmationShadowProposal(message, conversationContext) {
	const userIntent = detectUserActionIntent(message, conversationContext);
	if (userIntent.intent !== USER_ACTION_INTENT.CONFIRM || !conversationContext?.pendingWrite) {
		return null;
	}

	const built = buildActionProposalFromPendingWrite(conversationContext.pendingWrite, {
		deferred: true,
		confirmed: true,
		diagnostics: { shadowConfirmationOnly: true, noF4B2: true, noPendingConsume: true },
	});

	if (!built.valid) return null;
	return sanitizeActionProposalForLog(built.value);
}

/**
 * Shadow diagnostic — read-only V2 observation with structured Legacy vs V2 comparison.
 */
export async function runShadowGoalDiagnostic({
	message,
	conversationContext = {},
	legacyResolved,
	referenceDate = new Date(),
	executionContext = null,
	executorOptions = {},
	primaryPath = 'LEGACY',
	primaryV2Snapshot = null,
	shadowRunId = createShadowRunId(),
	env,
}) {
	let shadowWritesDetected = 0;
	const shadowWriteGuard = { blocked: false, reason: null };

	const classifierResult = await classifyGoal(message, conversationContext, {
		referenceDate,
		legacyResolved,
		env,
	});

	const legacyGoal = mapLegacyIntentToGoal(legacyResolved, referenceDate);
	const legacyPlan = planToolExecution(legacyResolved);

	const confirmationProposal = buildConfirmationShadowProposal(message, conversationContext);

	let classifierGoal = classifierResult.goal;
	let v2Plan = classifierGoal
		? buildAnalysisPlanFromGoal(classifierGoal, conversationContext, executorOptions)
		: { success: false, reason: 'NO_GOAL' };

	let v2Execution = null;
	let v2ActionProposal = null;
	let v2ActionResponse = null;
	let v2FinancialAnalysis = null;
	let v2Response = null;

	if (primaryPath === 'V2_HTTP' && primaryV2Snapshot) {
		classifierGoal = primaryV2Snapshot.goal || classifierGoal;
		v2Plan = primaryV2Snapshot.plan
			? { success: true, plan: primaryV2Snapshot.plan }
			: v2Plan;
		v2Execution = primaryV2Snapshot.execution || null;
		v2FinancialAnalysis = primaryV2Snapshot.financialAnalysis || v2Execution?.financialAnalysis || null;
		v2ActionProposal = primaryV2Snapshot.actionProposal
			? sanitizeActionProposalForLog(primaryV2Snapshot.actionProposal)
			: null;
	} else {
		if (v2Plan?.plan?.steps && hasWriteTools(v2Plan.plan.steps)) {
			shadowWriteGuard.blocked = true;
			shadowWriteGuard.reason = 'WRITE_TOOLS_DEFERRED';
		}

		v2Execution = await runShadowV2Execution(
			v2Plan,
			executionContext,
			{ referenceDate, ...executorOptions },
		);

		if (v2Execution?.shadow_write_guard?.blocked) {
			shadowWriteGuard.blocked = true;
			shadowWriteGuard.reason = v2Execution.shadow_write_guard.reason;
		}

		v2FinancialAnalysis = v2Execution?.financialAnalysis || null;

		v2Response = v2FinancialAnalysis
			? await generateResponse({
				goal: classifierGoal,
				financialAnalysis: v2FinancialAnalysis,
				context: {
					activityReference: classifierGoal?.activityReference || null,
					language: 'fr',
				},
				options: executorOptions,
			})
			: null;

		if (classifierGoal?.type === 'ACTION') {
			const built = buildActionProposalFromGoal(classifierGoal, { deferred: true });
			if (built.valid) {
				v2ActionProposal = sanitizeActionProposalForLog(built.value);
				const facing = toUserFacingActionProposal(built.value);
				if (facing.valid) {
					v2ActionResponse = await generateResponse({
						goal: classifierGoal,
						financialAnalysis: null,
						actionProposal: facing.value,
						context: { language: 'fr' },
						options: executorOptions,
					});
				}
			}
		}
	}

	if (confirmationProposal) {
		v2ActionProposal = confirmationProposal;
	}

	const legacySide = normalizeLegacySide({
		legacyResolved,
		legacyGoal,
		legacyPlan,
	});

	const v2Side = normalizeV2Side({
		classifierGoal,
		v2Plan,
		v2Execution,
		v2ActionProposal,
	});

	const comparison = compareShadowSides({
		legacySide,
		v2Side,
		v2FinancialAnalysis,
		v2Execution,
		shadowStatus: SHADOW_STATUS.SUCCESS,
	});

	const structured = buildShadowComparisonResult({
		legacy: legacySide,
		v2: v2Side,
		comparison,
	});

	return {
		shadowRunId,
		status: SHADOW_STATUS.SUCCESS,
		primaryPath,
		legacyIntent: legacyResolved?.intent || null,
		goalSource: classifierResult.source,
		goal: classifierGoal,
		legacyGoal: legacyGoal.valid ? legacyGoal.value : null,
		aligned: comparison.intentMatch,
		comparisonReason: comparison.classification,
		comparison,
		structured,
		legacyPlan: {
			responseKind: legacyPlan.responseKind,
			stepCount: legacyPlan.steps?.length || 0,
			tools: (legacyPlan.steps || []).map((step) => step.tool),
		},
		v2Plan: sanitizePlanForLog(v2Plan),
		v2Execution: sanitizeExecutionForLog(v2Execution),
		v2Metrics: sanitizeMetricsForLog(v2Execution?.metrics),
		v2FinancialAnalysis: sanitizeFinancialAnalysisForLog(v2FinancialAnalysis),
		v2Response: sanitizeResponseForLog(v2Response),
		v2ActionProposal,
		v2ActionResponse: sanitizeResponseForLog(v2ActionResponse),
		confirmationShadow: Boolean(confirmationProposal),
		shadow_write_guard: shadowWriteGuard,
		shadowWritesDetected,
	};
}

/**
 * Fire-and-forget shadow observation — never throws, never mutates state.
 */
export function emitShadowGoalDiagnostic(params) {
	if (!isIntelligenceV2ShadowEnabled(params.env)) {
		return Promise.resolve(null);
	}

	const shadowConfig = getShadowConfig(params.env);

	return runShadowWithTimeout(
		({ shadowRunId }) => runShadowGoalDiagnostic({ ...params, shadowRunId }),
		{ timeoutMs: shadowConfig.shadowTimeoutMs, env: params.env },
	)
		.then((diagnostic) => {
			if (diagnostic?.status === SHADOW_STATUS.TIMEOUT) {
				diagnostic.comparison = compareShadowSides({
					legacySide: {},
					v2Side: {},
					shadowStatus: SHADOW_STATUS.TIMEOUT,
				});
			}

			mergeIntoGlobalShadowMetrics(diagnostic);

			logger.info('ashy_intelligence_v2_shadow', {
				shadowRunId: diagnostic.shadowRunId,
				status: diagnostic.status,
				primaryPath: diagnostic.primaryPath || params.primaryPath || 'LEGACY',
				durationMs: diagnostic.durationMs,
				legacyIntent: diagnostic.legacyIntent,
				goalSource: diagnostic.goalSource,
				aligned: diagnostic.aligned ?? diagnostic.comparison?.intentMatch,
				comparisonReason: diagnostic.comparisonReason || diagnostic.comparison?.classification,
				comparison: diagnostic.comparison,
				structured: diagnostic.structured,
				goal: sanitizeGoalForLog(diagnostic.goal),
				legacyGoal: sanitizeGoalForLog(diagnostic.legacyGoal),
				legacyPlanStepCount: diagnostic.legacyPlan?.stepCount ?? 0,
				legacyPlanTools: diagnostic.legacyPlan?.tools || [],
				v2Plan: diagnostic.v2Plan,
				v2Execution: diagnostic.v2Execution,
				v2Metrics: diagnostic.v2Metrics,
				v2FinancialAnalysis: diagnostic.v2FinancialAnalysis,
				v2Response: diagnostic.v2Response,
				v2ActionProposal: diagnostic.v2ActionProposal,
				v2ActionResponse: diagnostic.v2ActionResponse,
				confirmationShadow: diagnostic.confirmationShadow,
				shadow_write_guard: diagnostic.shadow_write_guard,
				shadowWritesDetected: diagnostic.shadowWritesDetected ?? 0,
			});

			return diagnostic;
		})
		.catch((err) => {
			logger.warn('ashy_intelligence_v2_shadow_error', {
				code: err?.code || 'SHADOW_ERROR',
			});
			return null;
		});
}
