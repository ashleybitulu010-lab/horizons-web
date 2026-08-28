import {
	getConversationStore,
	resetConversationStoreForTests,
} from './conversation-store.js';

export function createEmptyConversationState() {
	return {
		topic: null,
		intent: null,
		filters: {},
		references: {
			lastPeriod: null,
			previousPeriod: null,
			lastProduct: null,
			lastEntity: null,
		},
		lastTool: null,
		lastAction: null,
		updatedAt: null,
	};
}

export function getConversationState(userId, sessionId) {
	const stored = getConversationStore().getConversationState(userId, sessionId);
	return stored || createEmptyConversationState();
}

export function saveConversationState(userId, sessionId, state) {
	getConversationStore().saveConversationState(userId, sessionId, {
		...state,
		updatedAt: new Date().toISOString(),
	});
}

export function clearConversationState(userId, sessionId) {
	getConversationStore().clearConversationState(userId, sessionId);
}

export function clearConversationSessionsForTests() {
	resetConversationStoreForTests();
}

export function mergeConversationState(current, patch) {
	return {
		...current,
		...patch,
		filters: {
			...current.filters,
			...(patch.filters || {}),
		},
		references: {
			...current.references,
			...(patch.references || {}),
		},
		updatedAt: new Date().toISOString(),
	};
}

export function updateReferencesAfterSalesQuery(current, period, product = null) {
	const references = { ...current.references };

	if (period && references.lastPeriod && references.lastPeriod !== period) {
		references.previousPeriod = references.lastPeriod;
	}
	if (period) {
		references.lastPeriod = period;
	}
	if (product) {
		references.lastProduct = product;
	}
	references.lastEntity = 'sales';

	return references;
}
