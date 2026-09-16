import { isIntelligenceV2Enabled } from './config.js';
import { runV2ActionFlow } from './action/action-orchestrator.js';
import { buildAnalysisPlanFromGoal } from './plan-builder.js';
import { executeAnalysisPlan } from './plan-executor.js';
import { generateResponse } from './response/response-generator.js';

/**
 * Feature-flagged V2 orchestrator entry point.
 * Independent from createAshyAgent().run() — does not replace pipeline 1.x.
 */
export async function runV2AnalysisPlan({
	goal,
	message = '',
	conversationContext = {},
	conversationState = {},
	executionContext,
	context = {},
	sessionId = null,
	options = {},
}) {
	if (!options.force && !isIntelligenceV2Enabled(options.env)) {
		return {
			enabled: false,
			success: false,
			code: 'V2_DISABLED',
		};
	}

	if (goal?.type === 'ACTION') {
		const actionFlow = await runV2ActionFlow({
			goal,
			message,
			conversationContext,
			conversationState,
			executionContext,
			sessionId,
			options,
		});

		const response = await generateResponse({
			goal,
			financialAnalysis: null,
			actionProposal: actionFlow.userFacing,
			context: {
				activityName: context?.activityName || null,
				activityReference: goal?.activityReference || null,
				language: context?.language || 'fr',
				errorMessage: actionFlow.confirmResult?.message || null,
			},
			options,
		});

		return {
			enabled: actionFlow.enabled,
			success: actionFlow.success,
			code: actionFlow.code,
			actionFlow,
			actionProposal: actionFlow.proposal,
			userFacingActionProposal: actionFlow.userFacing,
			conversationState: actionFlow.conversationState,
			response,
		};
	}

	const planResult = buildAnalysisPlanFromGoal(goal, conversationContext, options);
	if (!planResult.success) {
		return {
			enabled: true,
			success: false,
			code: planResult.reason || 'PLAN_BUILD_FAILED',
			error: planResult.error || null,
		};
	}

	const execution = await executeAnalysisPlan(planResult.plan, executionContext, options);

	const response = await generateResponse({
		goal: planResult.plan?.goal || goal,
		financialAnalysis: execution.financialAnalysis,
		context: {
			activityName: context?.activityName || null,
			activityReference: goal?.activityReference || null,
			language: context?.language || 'fr',
		},
		options,
	});

	return {
		enabled: true,
		success: execution.success,
		partial: execution.partial,
		code: execution.code,
		plan: planResult.plan,
		evidence: planResult.evidence,
		execution,
		analysisResult: execution.analysisResult,
		financialAnalysis: execution.financialAnalysis,
		response,
		metrics: execution.metrics,
	};
}
