import { assertAshyContract } from './contract.js';
import {
	getConversationState,
	mergeConversationState,
	saveConversationState,
} from './conversation-state.js';
import { conversationPatchFromIntent, resolveIntent } from './intent-resolver.js';
import { formatAshyReply } from './response-formatter.js';
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
			const nextState = mergeConversationState(
				previousState,
				conversationPatchFromIntent(resolved),
			);

			if (!resolved.needsTool) {
				saveConversationState(user.id, sessionId, nextState);
				return {
					reply: formatAshyReply('unknown'),
					conversation: sanitizeConversationForClient(nextState),
					toolResults: [],
				};
			}

			const context = createToolExecutionContext({ user });
			const toolResults = [];

			if (resolved.intent === 'compare_sales') {
				const [currentPeriod, previousPeriod] = resolved.filters.periods;
				const current = await executeTool('get_sales', context, { period: currentPeriod }, referenceDate);
				const previous = await executeTool('get_sales', context, { period: previousPeriod }, referenceDate);
				toolResults.push(current, previous);

				saveConversationState(user.id, sessionId, mergeConversationState(nextState, {
					filters: {
						periods: [currentPeriod, previousPeriod],
						period: currentPeriod,
					},
					lastTool: 'get_sales',
				}));

				return {
					reply: formatAshyReply('compare_sales', toolResults),
					conversation: sanitizeConversationForClient(getConversationState(user.id, sessionId)),
					toolResults: toolResults.map(sanitizeToolResultForClient),
				};
			}

			const toolInput = {
				period: resolved.filters.period || 'current_month',
				...(resolved.filters.product ? { product: resolved.filters.product } : {}),
			};

			const toolResult = await executeTool('get_sales', context, toolInput, referenceDate);
			toolResults.push(toolResult);

			saveConversationState(user.id, sessionId, mergeConversationState(nextState, {
				filters: toolInput,
				lastTool: 'get_sales',
			}));

			return {
				reply: formatAshyReply(resolved.intent, toolResult),
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
		lastTool: state.lastTool,
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
