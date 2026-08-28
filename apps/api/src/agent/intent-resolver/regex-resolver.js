/**
 * Deterministic intent resolver (Phase 2.1 fallback).
 * A future LLM resolver must return the same ResolvedIntent shape.
 */

const CURRENT_MONTH_PATTERNS = [
	/combien.*vendu.*(ce|cette)\s+mois/i,
	/ventes.*(ce|cette)\s+mois/i,
	/chiffre.*(ce|cette)\s+mois/i,
];

const PREVIOUS_MONTH_PATTERNS = [
	/(et\s+)?(le|cette)\s+mois\s+(dernier|pass[eé])/i,
	/mois\s+(dernier|pass[eé])/i,
];

const COMPARE_PATTERNS = [
	/^compare\.?$/i,
	/compare(r|z)?\s*(les\s+deux|mois|p[eé]riodes?)?/i,
];

const BEST_PRODUCT_PATTERNS = [
	/quel\s+produit.*(mieux|plus).*vendu/i,
	/meilleur\s+produit/i,
	/produit.*(mieux|plus).*vendu/i,
	/quel\s+est\s+mon\s+meilleur\s+produit/i,
];

const EXPENSE_PATTERNS = [
	/combien.*(d[eé]pens[eé]|d[eé]pens)/i,
	/mes d[eé]penses/i,
	/total.*d[eé]penses/i,
];

export function resolveIntentRegex(message, conversationState = createFallbackState()) {
	const text = String(message || '').trim();
	const lower = text.toLowerCase();

	if (!text) {
		return emptyResolved(conversationState);
	}

	if (EXPENSE_PATTERNS.some((pattern) => pattern.test(text))) {
		return {
			intent: 'query_expenses',
			topic: 'expenses',
			filters: {},
			references: {},
			needsTool: false,
			resolver: 'regex',
		};
	}

	if (BEST_PRODUCT_PATTERNS.some((pattern) => pattern.test(text))) {
		return {
			intent: 'best_product',
			topic: 'sales',
			filters: {
				period: conversationState.references?.lastPeriod
					|| conversationState.filters?.period
					|| 'current_month',
			},
			references: {},
			needsTool: true,
			resolver: 'regex',
		};
	}

	if (COMPARE_PATTERNS.some((pattern) => pattern.test(text))) {
		const last = conversationState.references?.lastPeriod || 'current_month';
		const previous = conversationState.references?.previousPeriod || 'previous_month';
		return {
			intent: 'compare_sales',
			topic: 'sales',
			filters: {
				periods: [previous, last],
			},
			references: {
				lastPeriod: last,
				previousPeriod: previous,
			},
			needsTool: true,
			resolver: 'regex',
		};
	}

	if (PREVIOUS_MONTH_PATTERNS.some((pattern) => pattern.test(text))) {
		return {
			intent: 'query_sales',
			topic: 'sales',
			filters: { period: 'previous_month' },
			references: {},
			needsTool: true,
			resolver: 'regex',
		};
	}

	if (CURRENT_MONTH_PATTERNS.some((pattern) => pattern.test(text))
		|| (conversationState.topic === 'sales' && /combien.*vendu/i.test(text))) {
		return {
			intent: 'query_sales',
			topic: 'sales',
			filters: { period: 'current_month' },
			references: {},
			needsTool: true,
			resolver: 'regex',
		};
	}

	if (conversationState.topic === 'sales' && /combien|total|ventes|vendu/i.test(lower)) {
		return {
			intent: 'query_sales',
			topic: 'sales',
			filters: {
				period: conversationState.references?.lastPeriod
					|| conversationState.filters?.period
					|| 'current_month',
			},
			references: {},
			needsTool: true,
			resolver: 'regex',
		};
	}

	return {
		intent: 'unknown',
		topic: conversationState.topic || null,
		filters: { ...conversationState.filters },
		references: { ...conversationState.references },
		needsTool: false,
		resolver: 'regex',
	};
}

function createFallbackState() {
	return {
		topic: null,
		filters: {},
		references: {},
	};
}

function emptyResolved(conversationState) {
	return {
		intent: 'unknown',
		topic: conversationState.topic || null,
		filters: { ...conversationState.filters },
		references: { ...conversationState.references },
		needsTool: false,
		resolver: 'regex',
	};
}

export function conversationPatchFromIntent(resolved) {
	return {
		topic: resolved.topic,
		intent: resolved.intent,
		filters: resolved.filters || {},
		references: resolved.references || {},
		lastTool: resolved.needsTool ? toolForIntent(resolved.intent) : null,
		lastAction: resolved.intent,
	};
}

function toolForIntent(intent) {
	switch (intent) {
	case 'query_sales':
	case 'compare_sales':
	case 'best_product':
		return 'get_sales';
	default:
		return null;
	}
}
