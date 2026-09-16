import {
	mergeConversationState,
	persistConversationState,
} from '../conversation-state.js';
import { classifyGoal } from './goal-classifier.js';
import { runV2ActionFlow } from './action/action-orchestrator.js';
import { ACTION_PROPOSAL_STATUS } from './action/action-proposal-contract.js';
import {
	detectUserActionIntent,
	parseClarificationFollowUp,
	USER_ACTION_INTENT,
} from './action/action-confirmation-handler.js';
import {
	isIntelligenceV2HttpEnabled,
	isIntelligenceV2ActionsEnabled,
	isIntelligenceV2HttpConfirmEnabled,
} from './config.js';
import { buildAnalysisPlanFromGoal } from './plan-builder.js';
import { executeAnalysisPlan } from './plan-executor.js';
import { generateResponse } from './response/response-generator.js';
import { specTypeToLegacyPeriodId } from './period-contract.js';
import { attachFallbackPolicyToV2Http } from './v2-fallback-policy.js';

export const V2_HTTP_READ_GOAL_TYPES = Object.freeze(['QUESTION', 'ANALYSIS', 'MIXED']);

export const V2_HTTP_ACTION_DEFERRED_REPLY =
	'Les enregistrements de dépenses et ventes via ce canal seront activés dans une prochaine étape. '
	+ 'Pour l’instant, seules les questions et analyses sont disponibles ici.';

const DOMAIN_TO_TOPIC = Object.freeze({
	SALES: 'sales',
	EXPENSES: 'expenses',
	STOCK: 'stock',
	PRODUCTS: 'products',
	DEBTS: 'debts',
	PROFIT: 'profit',
	GENERAL: 'general',
});

function inferIntentLabel(goal) {
	if (!goal) return null;
	if (goal.type === 'QUESTION' && goal.domain === 'SALES') return 'query_sales';
	if (goal.type === 'QUESTION' && goal.domain === 'EXPENSES') return 'query_expenses';
	if (goal.type === 'QUESTION' && goal.domain === 'STOCK') return 'query_stock';
	if (goal.type === 'QUESTION' && goal.domain === 'PRODUCTS') return 'query_products';
	if (goal.type === 'QUESTION' && goal.domain === 'DEBTS') return 'query_debts';
	if (goal.objective === 'COMPARE' && goal.domain === 'PROFIT') return 'compare_sales_expenses';
	if (goal.objective === 'COMPARE' && goal.domain === 'SALES') return 'compare_sales';
	if (goal.objective === 'COMPARE' && goal.domain === 'EXPENSES') return 'compare_expenses';
	if (goal.objective === 'EXPLAIN' && goal.domain === 'PROFIT') return 'explain_profit';
	if (goal.objective === 'EXPLAIN' && goal.domain === 'EXPENSES') return 'explain_expenses';
	return `${goal.type}_${goal.domain}`.toLowerCase();
}

function resolvePeriodFilter(goal, previousState = {}) {
	if (goal.period?.legacyPeriodId) {
		return goal.period.legacyPeriodId;
	}
	if (goal.period?.type) {
		return specTypeToLegacyPeriodId(goal.period.type) || previousState.filters?.period || 'current_month';
	}
	if (goal.comparison?.leftPeriod?.legacyPeriodId) {
		return goal.comparison.leftPeriod.legacyPeriodId;
	}
	return previousState.filters?.period || 'current_month';
}

/**
 * Build conversation-state patch from a read/analysis Goal (no pending writes).
 */
export function conversationPatchFromGoal(goal, plan, previousState = {}) {
	const period = resolvePeriodFilter(goal, previousState);
	/** @type {Record<string, unknown>} */
	const filters = {
		...(previousState.filters || {}),
		period,
	};

	if (goal.parameters?.product) {
		filters.product = goal.parameters.product;
	}
	if (goal.parameters?.category) {
		filters.category = goal.parameters.category;
	}
	if (goal.parameters?.lowStockOnly) {
		filters.lowStockOnly = true;
	}

	const references = {
		...(previousState.references || {}),
		lastPeriod: period,
	};

	if (goal.comparison?.enabled && goal.comparison.rightPeriod) {
		references.previousPeriod = goal.comparison.rightPeriod.legacyPeriodId
			|| specTypeToLegacyPeriodId(goal.comparison.rightPeriod.type)
			|| references.previousPeriod;
	}

	return {
		topic: DOMAIN_TO_TOPIC[goal.domain] || 'general',
		intent: inferIntentLabel(goal),
		filters,
		references,
		lastTool: plan?.steps?.[plan.steps.length - 1]?.tool || null,
		lastAction: inferIntentLabel(goal),
		pendingWrite: null,
		pendingSessionVersion: null,
		pendingConsumeToken: null,
		pendingOperationId: null,
	};
}

function buildV2HttpDiagnostics({
	goal,
	classifierSource,
	plan,
	execution,
	response,
	actionFlow = null,
}) {
	return {
		handled: true,
		source: 'v2_http',
		goalType: goal?.type || null,
		goalDomain: goal?.domain || null,
		goalObjective: goal?.objective || null,
		classifierSource: classifierSource || null,
		planStepCount: plan?.steps?.length ?? 0,
		executionCode: execution?.code || null,
		responseStatus: response?.status || null,
		responseStrategy: response?.diagnostics?.responseStrategy || null,
		actionStatus: actionFlow?.code || null,
		actionTool: actionFlow?.proposal?.tool || null,
		hasPending: Boolean(actionFlow?.conversationState?.pendingWrite),
	};
}

function buildV2HttpActionDiagnostics({ goal, classified, actionFlow }) {
	return {
		...buildV2HttpDiagnostics({
			goal,
			classifierSource: classified?.source,
			actionFlow,
		}),
		mode: 'action_proposal',
	};
}

/** H5 — snapshot for shadow comparison without re-running V2. */
function buildShadowSnapshot({
	goal,
	classified,
	plan = null,
	execution = null,
	actionProposal = null,
}) {
	return {
		goal: goal || null,
		classifierSource: classified?.source || null,
		plan: plan || null,
		execution: execution || null,
		financialAnalysis: execution?.financialAnalysis || null,
		actionProposal: actionProposal || null,
	};
}

function shouldRunV2ActionFlow(goal, previousState, env, message = '') {
	if (!isIntelligenceV2ActionsEnabled(env)) {
		return false;
	}
	if (goal?.type === 'ACTION') {
		return true;
	}
	if (previousState?.pendingWrite) {
		return true;
	}
	const userIntent = detectUserActionIntent(message, previousState);
	if (userIntent.intent === USER_ACTION_INTENT.CONFIRM
		|| userIntent.intent === USER_ACTION_INTENT.REJECT
		|| userIntent.intent === USER_ACTION_INTENT.MODIFY) {
		return true;
	}
	if (parseClarificationFollowUp(message, previousState?.pendingWrite)) {
		return true;
	}
	return false;
}

async function handleV2HttpActionTurn({
	message,
	user,
	sessionId,
	previousState,
	goal,
	classified,
	options,
}) {
	const actionFlow = await runV2ActionFlow({
		goal: goal?.type === 'ACTION' ? goal : null,
		message,
		conversationContext: previousState,
		conversationState: previousState,
		executionContext: { user },
		sessionId,
		options: {
			...options,
			forceActions: options.forceActions ?? isIntelligenceV2ActionsEnabled(options.env),
			skipFinancialExecution: options.skipFinancialExecution
				?? !isIntelligenceV2HttpConfirmEnabled(options.env),
			requirePendingDb: options.requirePendingDb !== false,
		},
	});

	if (!actionFlow.success && actionFlow.code && actionFlow.code !== 'V2_ACTIONS_DISABLED') {
		return {
			handled: true,
			agentResponse: buildAgentResponse({
				reply: actionFlow.responseText
					|| 'Je n’ai pas pu traiter cette action dans ce contexte.',
				conversationState: actionFlow.conversationState || previousState,
				diagnostics: {
					...buildV2HttpActionDiagnostics({ goal, classified, actionFlow }),
					actionProposalStatus: actionFlow.code,
				},
			}),
		};
	}

	if (!actionFlow.enabled && actionFlow.code === 'V2_ACTIONS_DISABLED') {
		const actionState = mergeConversationState(
			previousState,
			{
				topic: goal?.domain === 'SALES' ? 'sales' : 'expenses',
				intent: goal?.domain === 'SALES' ? 'create_sale' : 'create_expense',
				lastAction: goal?.domain === 'SALES' ? 'create_sale' : 'create_expense',
				pendingWrite: null,
				pendingSessionVersion: null,
				pendingConsumeToken: null,
				pendingOperationId: null,
			},
		);
		await persistConversationState({ user, sessionId, state: actionState });

		return {
			handled: true,
			agentResponse: buildAgentResponse({
				reply: V2_HTTP_ACTION_DEFERRED_REPLY,
				conversationState: actionState,
				diagnostics: buildV2HttpActionDiagnostics({ goal, classified, actionFlow }),
			}),
		};
	}

	const conversationState = actionFlow.conversationState || previousState;
	const reply = actionFlow.responseText
		|| 'Je n’ai pas pu traiter cette action.';

	const toolResults = actionFlow.confirmResult?.toolResult
		? [actionFlow.confirmResult.toolResult]
		: [];

	return {
		handled: true,
		agentResponse: buildAgentResponse({
			reply,
			conversationState,
			toolResults,
			diagnostics: {
				...buildV2HttpActionDiagnostics({ goal, classified, actionFlow }),
				actionProposalStatus: actionFlow.code,
				confirmationRequired: actionFlow.proposal?.confirmationRequired === true
					|| actionFlow.code === ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION,
				f4Status: actionFlow.confirmResult?.code || null,
				f4Replay: actionFlow.confirmResult?.replay ?? null,
				f4Committed: actionFlow.code === ACTION_PROPOSAL_STATUS.COMPLETED
					|| actionFlow.code === ACTION_PROPOSAL_STATUS.ALREADY_COMPLETED,
			},
		}),
		shadowSnapshot: buildShadowSnapshot({
			goal,
			classified,
			actionProposal: actionFlow.proposal || null,
		}),
	};
}

function sanitizeConversationForClient(state) {
	return {
		topic: state.topic,
		intent: state.intent,
		filters: state.filters,
		references: state.references,
		lastTool: state.lastTool,
		lastAction: state.lastAction,
		updatedAt: state.updatedAt,
	};
}

function sanitizeToolResultForClient(result) {
	return {
		success: result.success,
		tool: result.tool,
		meta: result.meta,
		error: result.error || null,
		summary: result.success ? result.data?.summary || null : null,
	};
}

function buildAgentResponse({
	reply,
	conversationState,
	toolResults = [],
	diagnostics = null,
}) {
	const v2Http = attachFallbackPolicyToV2Http(diagnostics);
	return {
		reply,
		conversation: sanitizeConversationForClient(conversationState),
		toolResults: toolResults.map(sanitizeToolResultForClient),
		intentDiagnostics: null,
		v2Http,
		noN8nFallback: v2Http?.noN8nFallback === true,
		fallbackPolicy: v2Http?.fallbackPolicy || null,
	};
}

function isReadAnalysisGoal(goal) {
	return V2_HTTP_READ_GOAL_TYPES.includes(goal?.type);
}

/**
 * Handle one HTTP turn via Intelligence V2 READ/ANALYSIS only.
 * Returns { handled: false } when Legacy should run.
 */
const ACTION_AMBIGUOUS_REPLY =
	'Je n’ai pas pu confirmer le résultat de cette opération. '
	+ 'Elle peut avoir été enregistrée — vérifie ton historique avant de réessayer.';

export async function handleV2HttpTurn({
	message,
	user,
	sessionId,
	previousState = {},
	referenceDate = new Date(),
	options = {},
}) {
	if (!options.forceHttp && !isIntelligenceV2HttpEnabled(options.env)) {
		return { handled: false };
	}

	try {
		return await handleV2HttpTurnInner({
			message,
			user,
			sessionId,
			previousState,
			referenceDate,
			options,
		});
	} catch (err) {
		const actionContext = shouldRunV2ActionFlow(null, previousState, options.env, message);
		if (actionContext) {
			return {
				handled: true,
				agentResponse: buildAgentResponse({
					reply: ACTION_AMBIGUOUS_REPLY,
					conversationState: previousState,
					diagnostics: {
						handled: true,
						source: 'v2_http',
						mode: 'action_proposal',
						goalType: 'ACTION',
						actionProposalStatus: 'ACTION_AMBIGUOUS',
						code: err?.code || 'V2_ACTION_ERROR',
					},
				}),
			};
		}
		throw err;
	}
}

async function handleV2HttpTurnInner({
	message,
	user,
	sessionId,
	previousState = {},
	referenceDate = new Date(),
	options = {},
}) {

	if (!user?.clientId || !user?.activeActivityId) {
		return {
			handled: true,
			agentResponse: buildAgentResponse({
				reply: 'Je n’ai pas pu déterminer ton activité. Réessaie dans un instant.',
				conversationState: previousState,
				diagnostics: {
					handled: true,
					source: 'v2_http',
					code: 'MISSING_SCOPE',
					goalType: 'ACTION',
					mode: 'action_proposal',
				},
			}),
		};
	}

	const classified = await classifyGoal(message, previousState, {
		referenceDate,
		forceRules: options.forceRules ?? true,
		env: options.env,
	});

	const goal = classified?.valid ? classified.goal : null;

	if (shouldRunV2ActionFlow(goal, previousState, options.env, message)) {
		return handleV2HttpActionTurn({
			message,
			user,
			sessionId,
			previousState,
			goal,
			classified,
			options,
		});
	}

	if (!goal) {
		return { handled: false };
	}

	if (goal.type === 'ACTION') {
		return handleV2HttpActionTurn({
			message,
			user,
			sessionId,
			previousState,
			goal,
			classified,
			options,
		});
	}

	if (!isReadAnalysisGoal(goal)) {
		return { handled: false };
	}

	const planResult = buildAnalysisPlanFromGoal(goal, previousState, options);
	if (!planResult.success) {
		const errorState = mergeConversationState(
			previousState,
			conversationPatchFromGoal(goal, null, previousState),
		);
		await persistConversationState({ user, sessionId, state: errorState });

		return {
			handled: true,
			agentResponse: buildAgentResponse({
				reply: 'Je n’ai pas pu préparer cette analyse. Reformule ta question.',
				conversationState: errorState,
				diagnostics: buildV2HttpDiagnostics({
					goal,
					classifierSource: classified.source,
					response: { status: 'PLAN_BUILD_FAILED' },
				}),
			}),
		};
	}

	const execution = await executeAnalysisPlan(
		planResult.plan,
		{ user },
		options,
	);

	const response = await generateResponse({
		goal: planResult.plan?.goal || goal,
		financialAnalysis: execution.financialAnalysis,
		context: {
			activityName: user.activeActivity?.name || null,
			activityReference: goal.activityReference || null,
			language: 'fr',
		},
		options,
	});

	const nextState = mergeConversationState(
		previousState,
		conversationPatchFromGoal(goal, planResult.plan, previousState),
	);
	await persistConversationState({ user, sessionId, state: nextState });

	const reply = response?.text
		|| 'Je n’ai pas pu formuler de réponse pour cette demande.';

	return {
		handled: true,
		agentResponse: buildAgentResponse({
			reply,
			conversationState: nextState,
			toolResults: execution.toolResults || [],
			diagnostics: buildV2HttpDiagnostics({
				goal,
				classifierSource: classified.source,
				plan: planResult.plan,
				execution,
				response,
			}),
		}),
		shadowSnapshot: buildShadowSnapshot({
			goal,
			classified,
			plan: planResult.plan,
			execution,
		}),
	};
}
