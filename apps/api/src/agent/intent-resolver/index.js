import { resolveIntentRegex } from './regex-resolver.js';

/**
 * Intent resolution layer.
 * Phase 2.1: regex fallback only.
 * Phase future: try LLM resolver first, fallback to regex.
 */
export function resolveIntent(message, conversationState = {}) {
	return resolveIntentRegex(message, conversationState);
}

export { conversationPatchFromIntent } from './regex-resolver.js';
