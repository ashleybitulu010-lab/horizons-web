import { assertAshyContract } from './contract.js';
import {
	applyReferenceUpdateFromPlan,
	getConversationState,
	mergeConversationState,
	saveConversationState,
} from './conversation-state.js';
import { conversationPatchFromIntent, resolveIntent } from './intent-resolver.js';
import { formatAshyReply } from './response-formatter.js';
import { planToolExecution } from './tool-planner.js';
import { createToolExecutionContext } from '../tools/context.js';
import { executeTool } from '../tools/registry.js';

const MULTI_RESULT_KINDS = new Set([
	'compare_sales',
	'compare_expenses',
	'compare_sales_expenses',
]);

function buildIntentDiagnostics(resolved) {
	return {
		resolver: resolved.resolver,
		intent: resolved.intent,
		topic: resolved.topic,
		fallback: Boolean(resolved.resolverMeta?.fallback),
		durationMs: resolved.resolverMeta?.durationMs ?? null,
	};
}

export function createAshyAgent() {
	const contract = assertAshyContract();

	return {
		contract,
		async run({ message, user, sessionId = 'default', referenceDate = new Date() }) {
			if (!user?.id) {
				return {
					reply: 'Tu dois être connecté pour que je consulte tes données.',
					conversation: null,
					toolResults: [],
					intentDiagnostics: null,
				};
			}

			const previousState = getConversationState(user.id, sessionId);
			const resolved = await resolveIntent(message, previousState);
			const plan = planToolExecution(resolved);
			const nextState = mergeConversationState(
				previousState,
				conversationPatchFromIntent(resolved),
			);
			const intentDiagnostics = buildIntentDiagnostics(resolved);

			if (resolved.needsClarification) {
				saveConversationState(user.id, sessionId, nextState);
				return {
					reply: formatAshyReply('clarification', resolved),
					conversation: sanitizeConversationForClient(nextState),
					toolResults: [],
					intentDiagnostics,
				};
			}

			if (plan.responseKind === 'unimplemented_topic' || plan.responseKind === 'unimplemented_write') {
				saveConversationState(user.id, sessionId, nextState);
				return {
					reply: formatAshyReply(plan.responseKind, null, { unimplementedTool: plan.unimplementedTool }),
					conversation: sanitizeConversationForClient(nextState),
					toolResults: [],
					intentDiagnostics,
				};
			}

			if (plan.steps.length === 0) {
				saveConversationState(user.id, sessionId, nextState);
				return {
					reply: formatAshyReply('unknown'),
					conversation: sanitizeConversationForClient(nextState),
					toolResults: [],
					intentDiagnostics,
				};
			}

			const context = createToolExecutionContext({ user });
			const toolResults = [];

			for (const step of plan.steps) {
				const result = await executeTool(step.tool, context, step.input, referenceDate);
				toolResults.push(result);
				if (!result.success) {
					saveConversationState(user.id, sessionId, mergeConversationState(nextState, {
						lastTool: step.tool,
						lastAction: resolved.intent,
					}));
					return {
						reply: formatAshyReply('tool_error', result),
						conversation: sanitizeConversationForClient(getConversationState(user.id, sessionId)),
						toolResults: toolResults.map(sanitizeToolResultForClient),
						intentDiagnostics,
					};
				}
			}

			const statePatch = {
				lastTool: plan.steps[plan.steps.length - 1]?.tool || null,
				lastAction: resolved.intent,
				filters: resolved.filters || {},
				references: applyReferenceUpdateFromPlan(plan, nextState, toolResults),
			};

			saveConversationState(user.id, sessionId, mergeConversationState(nextState, statePatch));

			const payload = MULTI_RESULT_KINDS.has(plan.responseKind)
				? toolResults
				: toolResults[0];

			return {
				reply: formatAshyReply(plan.responseKind, payload),
				conversation: sanitizeConversationForClient(getConversationState(user.id, sessionId)),
				toolResults: toolResults.map(sanitizeToolResultForClient),
				intentDiagnostics,
			};
		},
	};
}

export function sanitizeConversationForClient(state) {
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

export function sanitizeToolResultForClient(result) {
	return {
		success: result.success,
		tool: result.tool,
		meta: result.meta,
		error: result.error || null,
		summary: result.success ? result.data?.summary || null : null,
	};
}

/** @deprecated use createAshyAgent */
export function createAshyAgentStub() {
	return createAshyAgent();
}
