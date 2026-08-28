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
];

export function resolveIntent(message, conversationState = {}) {
	const text = String(message || '').trim();
	const lower = text.toLowerCase();

	if (!text) {
		return {
			intent: 'unknown',
			topic: conversationState.topic || null,
			filters: { ...conversationState.filters },
			needsTool: false,
		};
	}

	if (BEST_PRODUCT_PATTERNS.some((pattern) => pattern.test(text))) {
		return {
			intent: 'best_product',
			topic: 'sales',
			filters: {
				period: conversationState.filters?.period || 'current_month',
			},
			needsTool: true,
		};
	}

	if (COMPARE_PATTERNS.some((pattern) => pattern.test(text))) {
		return {
			intent: 'compare_sales',
			topic: 'sales',
			filters: {
				periods: ['current_month', 'previous_month'],
			},
			needsTool: true,
		};
	}

	if (PREVIOUS_MONTH_PATTERNS.some((pattern) => pattern.test(text))) {
		return {
			intent: 'query_sales',
			topic: 'sales',
			filters: { period: 'previous_month' },
			needsTool: true,
		};
	}

	if (CURRENT_MONTH_PATTERNS.some((pattern) => pattern.test(text))
		|| (conversationState.topic === 'sales' && /combien.*vendu/i.test(text))) {
		return {
			intent: 'query_sales',
			topic: 'sales',
			filters: { period: 'current_month' },
			needsTool: true,
		};
	}

	if (conversationState.topic === 'sales' && /combien|total|ventes|vendu/i.test(lower)) {
		return {
			intent: 'query_sales',
			topic: 'sales',
			filters: {
				period: conversationState.filters?.period || 'current_month',
			},
			needsTool: true,
		};
	}

	return {
		intent: 'unknown',
		topic: conversationState.topic || null,
		filters: { ...conversationState.filters },
		needsTool: false,
	};
}

export function conversationPatchFromIntent(resolved) {
	return {
		topic: resolved.topic,
		intent: resolved.intent,
		filters: resolved.filters,
		lastTool: resolved.needsTool ? 'get_sales' : null,
	};
}
