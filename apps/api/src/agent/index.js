import { assertAshyContract } from './contract.js';
import {
	getConversationState,
	mergeConversationState,
	saveConversationState,
	updateReferencesAfterSalesQuery,
} from './conversation-state.js';
import { conversationPatchFromIntent, resolveIntent } from './intent-resolver.js';
import { formatAshyReply } from './response-formatter.js';
import { planToolExecution } from './tool-planner.js';
import { createToolExecutionContext } from '../tools/context.js';
import { executeTool } from '../tools/registry.js';

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
				};
			}

			const previousState = getConversationState(user.id, sessionId);
			const resolved = resolveIntent(message, previousState);
			const plan = planToolExecution(resolved);
			const nextState = mergeConversationState(
				previousState,
				conversationPatchFromIntent(resolved),
			);

			if (plan.responseKind === 'unimplemented_topic') {
				saveConversationState(user.id, sessionId, nextState);
				return {
					reply: formatAshyReply('unimplemented_topic', null, { unimplementedTool: plan.unimplementedTool }),
					conversation: sanitizeConversationForClient(nextState),
					toolResults: [],
				};
			}

			if (plan.steps.length === 0) {
				saveConversationState(user.id, sessionId, nextState);
				return {
					reply: formatAshyReply('unknown'),
					conversation: sanitizeConversationForClient(nextState),
					toolResults: [],
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
					};
				}
			}

			const statePatch = {
				lastTool: plan.steps[plan.steps.length - 1]?.tool || null,
				lastAction: resolved.intent,
				filters: resolved.filters || {},
			};

			if (resolved.topic === 'sales' && plan.steps.length === 1 && toolResults[0]?.success) {
				statePatch.references = updateReferencesAfterSalesQuery(
					nextState,
					toolResults[0].meta?.period || resolved.filters?.period,
				);
			}

			saveConversationState(user.id, sessionId, mergeConversationState(nextState, statePatch));

			const payload = plan.responseKind === 'compare_sales'
				? toolResults
				: toolResults[0];

			return {
				reply: formatAshyReply(plan.responseKind, payload),
				conversation: sanitizeConversationForClient(getConversationState(user.id, sessionId)),
				toolResults: toolResults.map(sanitizeToolResultForClient),
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
