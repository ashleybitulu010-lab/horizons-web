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

let forceRegexForTests = true;
let forceLlmForTests = false;

export function setForceRegexResolverForTests(value = true) {
	forceRegexForTests = value;
}

export function setForceLlmResolverForTests(value = true) {
	forceLlmForTests = value;
}

export function resetIntentResolverTestOverrides() {
	forceRegexForTests = true;
	forceLlmForTests = false;
	resetChatCompletionImplForTests();
}

/**
 * Intent resolution layer.
 * Phase 3.3: LLM primary when configured, regex fallback always available.
 */
export async function resolveIntent(message, conversationState = {}, options = {}) {
	const config = getLlmResolverConfig();
	const useLlm = !options.forceRegex
		&& !forceRegexForTests
		&& (options.forceLlm || forceLlmForTests || isLlmResolverEnabled(config));

	if (!useLlm) {
		return resolveIntentRegex(message, conversationState);
	}

	const startedAt = Date.now();
	try {
		return await resolveIntentLlm(message, conversationState, config);
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

export {
	conversationPatchFromIntent,
	setChatCompletionImplForTests,
	validateAndNormalizeResolvedIntent,
};
