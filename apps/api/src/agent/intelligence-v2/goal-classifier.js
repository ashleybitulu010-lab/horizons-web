import { resolveIntentRegex } from '../intent-resolver/regex-resolver.js';
import { getIntelligenceV2Config } from './config.js';
import { classifyGoalLlm } from './goal-classifier-llm.js';
import { classifyGoalRules } from './goal-classifier-rules.js';
import { createEmptyGoal, validateGoal } from './goal-contract.js';
import { mapLegacyIntentToGoal } from './legacy-intent-mapper.js';

function normalizeMessage(message) {
	return String(message || '').trim().replace(/\s+/g, ' ');
}

function sanitizeConversationContext(context = {}) {
	return {
		topic: context.topic || null,
		intent: context.intent || null,
		filters: context.filters || {},
		references: context.references || {},
		pendingWrite: context.pendingWrite
			? {
				tool: context.pendingWrite.tool,
				label: context.pendingWrite.label ?? null,
				amount: context.pendingWrite.amount ?? null,
				product: context.pendingWrite.product ?? null,
				quantity: context.pendingWrite.quantity ?? null,
			}
			: null,
	};
}

/**
 * Classify a user message into a normalized Goal.
 * Does NOT execute tools or writes.
 */
export async function classifyGoal(message, conversationContext = {}, options = {}) {
	const normalizedMessage = normalizeMessage(message);
	const context = sanitizeConversationContext(conversationContext);
	const referenceDate = options.referenceDate || new Date();
	const config = options.config || getIntelligenceV2Config(options.env);

	const rulesResult = classifyGoalRules(normalizedMessage, context, referenceDate);
	if (rulesResult?.valid) {
		return {
			goal: rulesResult.value,
			source: 'rules',
			valid: true,
		};
	}

	if (config.llmClassifierEnabled && !options.forceRules) {
		try {
			const llmResult = await classifyGoalLlm(normalizedMessage, context, {
				referenceDate,
				config: options.llmConfig,
			});
			return {
				goal: llmResult.goal,
				source: 'llm',
				valid: true,
				meta: llmResult.meta,
			};
		} catch (err) {
			if (options.strictLlm) {
				return {
					goal: null,
					source: 'llm',
					valid: false,
					error: err.code || 'GOAL_LLM_ERROR',
				};
			}
		}
	}

	const legacyResolved = options.legacyResolved
		|| resolveIntentRegex(normalizedMessage, context);
	const mapped = mapLegacyIntentToGoal(legacyResolved, referenceDate);

	if (mapped.valid) {
		return {
			goal: mapped.value,
			source: 'legacy_intent',
			valid: true,
			legacyIntent: legacyResolved.intent,
		};
	}

	const fallback = validateGoal(createEmptyGoal(), { rejectWriteExecution: true });
	return {
		goal: fallback.valid ? fallback.value : null,
		source: 'fallback',
		valid: fallback.valid,
		legacyIntent: legacyResolved.intent,
	};
}

export { normalizeMessage, sanitizeConversationContext };
