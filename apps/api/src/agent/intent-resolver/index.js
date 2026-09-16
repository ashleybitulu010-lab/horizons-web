import {
	conversationPatchFromIntent,
	validateAndNormalizeResolvedIntent,
} from './intent-contract.js';
import {
	getLlmResolverConfig,
	isLlmResolverEnabled,
	resetChatCompletionImplForTests,
	setChatCompletionImplForTests,
} from './llm-client.js';
import { resolveIntentLlm } from './llm-resolver.js';
import { resolveIntentRegex } from './regex-resolver.js';

const READ_QUERY_INTENTS = new Set([
	'query_sales',
	'query_expenses',
	'query_stock',
	'query_debts',
	'query_products',
	'compare_sales',
	'compare_expenses',
	'compare_sales_expenses',
	'best_product',
	'generate_report',
]);

function reconcileMisclassifiedReadIntent(message, resolved, conversationState) {
	if (resolved?.intent !== 'create_expense') {
		return resolved;
	}
	const regexResolved = resolveIntentRegex(message, conversationState);
	if (READ_QUERY_INTENTS.has(regexResolved.intent) && regexResolved.needsTool) {
		return {
			...regexResolved,
			resolver: resolved.resolver || 'llm',
			resolverMeta: {
				...(resolved.resolverMeta || {}),
				reconciledFrom: 'create_expense',
			},
		};
	}
	return resolved;
}

let forceRegexForTests = true;
let forceLlmForTests = false;
/** @type {((message: string, state: object, options?: object) => void) | null} */
let resolveIntentSpyForTests = null;

export function setForceRegexResolverForTests(value = true) {
	forceRegexForTests = value;
}

export function setForceLlmResolverForTests(value = true) {
	forceLlmForTests = value;
}

export function resetIntentResolverTestOverrides() {
	forceRegexForTests = true;
	forceLlmForTests = false;
	resolveIntentSpyForTests = null;
	resetChatCompletionImplForTests();
}

export function setResolveIntentSpyForTests(spy) {
	resolveIntentSpyForTests = spy;
}

/**
 * Intent resolution layer.
 * Phase 3.3: LLM primary when configured, regex fallback always available.
 */
export async function resolveIntent(message, conversationState = {}, options = {}) {
	if (resolveIntentSpyForTests) {
		resolveIntentSpyForTests(message, conversationState, options);
	}

	const config = getLlmResolverConfig();
	const useLlm = !options.forceRegex
		&& !forceRegexForTests
		&& (options.forceLlm || forceLlmForTests || isLlmResolverEnabled(config));

	if (!useLlm) {
		return resolveIntentRegex(message, conversationState);
	}

	const startedAt = Date.now();
	try {
		const llmResolved = await resolveIntentLlm(message, conversationState, config);
		return reconcileMisclassifiedReadIntent(message, llmResolved, conversationState);
	} catch (err) {
		const fallback = resolveIntentRegex(message, conversationState);
		return {
			...fallback,
			resolverMeta: {
				fallback: true,
				reason: err?.code || 'LLM_ERROR',
				durationMs: Date.now() - startedAt,
			},
		};
	}
}

export { reconcileMisclassifiedReadIntent };

export {
	conversationPatchFromIntent,
	setChatCompletionImplForTests,
	validateAndNormalizeResolvedIntent,
};
