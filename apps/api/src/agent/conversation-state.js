import {
	getConversationStore,
	resetConversationStoreForTests,
} from './conversation-store.js';

export const ALLOWED_STATE_KEYS = Object.freeze([
	'topic',
	'intent',
	'filters',
	'references',
	'lastTool',
	'lastAction',
	'updatedAt',
]);

export const ALLOWED_REFERENCE_KEYS = Object.freeze([
	'lastPeriod',
	'previousPeriod',
	'lastProduct',
	'lastEntity',
]);

export const ALLOWED_FILTER_KEYS = Object.freeze([
	'period',
	'periods',
	'product',
	'category',
	'lowStockOnly',
	'status',
	'debtor',
]);


const FORBIDDEN_FINANCIAL_KEYS = Object.freeze([
	'totalRevenue',
	'totalCollected',
	'total',
	'amount',
	'montant',
	'balance',
	'solde',
	'stock',
	'count',
	'sales',
	'expenses',
	'debts',
	'summary',
]);

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
	assertConversationStateIsContextOnly(state);
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
	const merged = {
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
	assertConversationStateIsContextOnly(merged);
	return merged;
}

export function updateReferencesAfterPeriodQuery(
	current,
	period,
	product = null,
	entity = null,
) {
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
	if (entity) {
		references.lastEntity = entity;
	}

	return references;
}

export function updateReferencesAfterStockQuery(current, product = null) {
	const references = { ...current.references, lastEntity: 'stock' };
	if (product) {
		references.lastProduct = product;
	}
	return references;
}

export function updateReferencesAfterDebtsQuery(current) {
	return {
		...current.references,
		lastEntity: 'debts',
	};
}

export function updateReferencesAfterProductsQuery(current, product = null) {
	const references = {
		...current.references,
		lastEntity: 'products',
	};
	if (product) {
		references.lastProduct = product;
	}
	return references;
}

export function updateReferencesAfterReportQuery(current, period = null) {
	const references = {
		...current.references,
		lastEntity: 'report',
	};
	if (period && references.lastPeriod && references.lastPeriod !== period) {
		references.previousPeriod = references.lastPeriod;
	}
	if (period) {
		references.lastPeriod = period;
	}
	return references;
}

export function applyReferenceUpdateFromPlan(plan, currentState, toolResults) {
	if (!plan?.referenceUpdate || toolResults.length !== 1 || !toolResults[0]?.success) {
		return currentState.references;
	}

	const { type, entity } = plan.referenceUpdate;
	if (type === 'period') {
		return updateReferencesAfterPeriodQuery(
			currentState,
			toolResults[0].meta?.period || null,
			toolResults[0].meta?.product || null,
			entity || null,
		);
	}
	if (type === 'stock') {
		return updateReferencesAfterStockQuery(
			currentState,
			toolResults[0].meta?.product || null,
		);
	}
	if (type === 'debts') {
		return updateReferencesAfterDebtsQuery(currentState);
	}
	if (type === 'products') {
		return updateReferencesAfterProductsQuery(
			currentState,
			toolResults[0].meta?.product || null,
		);
	}
	if (type === 'report') {
		return updateReferencesAfterReportQuery(
			currentState,
			toolResults[0].meta?.period || null,
		);
	}

	return currentState.references;
}


function assertFiltersAreContextOnly(filters, path = 'filters') {
	if (!filters || typeof filters !== 'object') return;

	for (const key of Object.keys(filters)) {
		if (!ALLOWED_FILTER_KEYS.includes(key)) {
			const normalized = key.toLowerCase();
			if (FORBIDDEN_FINANCIAL_KEYS.some((forbidden) => normalized.includes(forbidden.toLowerCase()))) {
				throw new Error(`Conversation state must not store financial truth at ${path}.${key}`);
			}
			throw new Error(`Unexpected conversation filter key: ${key}`);
		}
	}

	for (const [key, value] of Object.entries(filters)) {
		if (value == null) continue;
		if (key === 'periods') {
			if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
				throw new Error(`Conversation filter ${path}.${key} must be a string array`);
			}
			continue;
		}
		if (typeof value === 'boolean' || typeof value === 'string') continue;
		throw new Error(`Conversation filter ${path}.${key} must be a primitive context value`);
	}
}

function assertNoFinancialKeys(value, path) {
	if (value == null || typeof value !== 'object') return;

	for (const [key, nested] of Object.entries(value)) {
		const normalized = key.toLowerCase();
		if (FORBIDDEN_FINANCIAL_KEYS.some((forbidden) => normalized.includes(forbidden.toLowerCase()))) {
			throw new Error(`Conversation state must not store financial truth at ${path}.${key}`);
		}
		if (nested && typeof nested === 'object') {
			assertNoFinancialKeys(nested, `${path}.${key}`);
		}
	}
}

export function assertConversationStateIsContextOnly(state) {
	if (!state || typeof state !== 'object') return;

	for (const key of Object.keys(state)) {
		if (!ALLOWED_STATE_KEYS.includes(key)) {
			throw new Error(`Unexpected conversation state key: ${key}`);
		}
	}

	if (state.references) {
		for (const key of Object.keys(state.references)) {
			if (!ALLOWED_REFERENCE_KEYS.includes(key)) {
				throw new Error(`Unexpected conversation reference key: ${key}`);
			}
		}
	}

	assertFiltersAreContextOnly(state.filters);
	assertNoFinancialKeys(state.references, 'references');
}

/** @deprecated use updateReferencesAfterPeriodQuery */
export function updateReferencesAfterSalesQuery(current, period, product = null) {
	return updateReferencesAfterPeriodQuery(current, period, product, 'sales');
}
