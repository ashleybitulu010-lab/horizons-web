/**
 * Deterministic intent resolver (Phase 2.1 fallback).
 * A future LLM resolver must return the same ResolvedIntent shape.
 */

import { inheritPeriodFromContext } from './intent-contract.js';

const CURRENT_MONTH_SALES_PATTERNS = [
	/combien.*vendu.*(ce|cette)\s+mois/i,
	/ventes.*(ce|cette)\s+mois/i,
	/chiffre.*(ce|cette)\s+mois/i,
];

const CURRENT_MONTH_EXPENSE_PATTERNS = [
	/combien.*(d[eé]pens[eé]|d[eé]pens).*(ce|cette)\s+mois/i,
	/(ce|cette)\s+mois.*(d[eé]pens[eé]|d[eé]pens)/i,
	/total.*d[eé]penses.*(ce|cette)\s+mois/i,
	/d[eé]penses.*(ce|cette)\s+mois/i,
	/quel est le total de mes d[eé]penses.*(ce|cette)\s+mois/i,
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

const GENERIC_EXPENSE_PATTERNS = [
	/combien.*(d[eé]pens[eé]|d[eé]pens)/i,
	/mes d[eé]penses/i,
	/total.*d[eé]penses/i,
];

const GENERIC_SALES_PATTERNS = [
	/combien.*(vendu|ventes)/i,
	/total.*ventes/i,
	/chiffre.*affaires/i,
];

const LOW_STOCK_PATTERNS = [
	/produits.*(presque )?(épuis|epuis)/i,
	/quels produits sont presque/i,
	/stock.*(faible|bas)/i,
];

const GENERIC_STOCK_PATTERNS = [
	/et mon stock/i,
	/quel est mon stock/i,
	/mon stock actuel/i,
	/état de mon stock/i,
	/etat de mon stock/i,
	/donne[- ]?moi l['’]état de mon stock/i,
	/combien de produits me reste/i,
	/^(?:quel est|donne[- ]?moi).*(?:mon )?stock/i,
];

const STOCK_PRODUCT_PATTERNS = [
	/combien me reste[- ]?t[- ]?il de (.+?)\??$/i,
	/reste[- ]?t[- ]?il de (.+?)\??$/i,
	/combien .* reste .* de (.+?)\??$/i,
];

const TOPIC_FOLLOWUP_PATTERNS = [
	{ pattern: /^(et\s+)?(mes\s+|les\s+)?ventes\s*\??$/i, intent: 'query_sales', topic: 'sales' },
	{ pattern: /^(et\s+)?(mes\s+|les\s+)?d[eé]penses\s*\??$/i, intent: 'query_expenses', topic: 'expenses' },
	{ pattern: /^(et\s+)?(mes\s+|les\s+)?dettes\s*\??$/i, intent: 'query_debts', topic: 'debts' },
	{ pattern: /^(et\s+)?mon stock\s*\??$/i, intent: 'query_stock', topic: 'stock' },
];

const UNPAID_DEBT_PATTERNS = [
	/impay/i,
	/encore.*(dette|due|doiv)/i,
	/en cours/i,
	/celles.*impay/i,
];

const GENERIC_DEBT_PATTERNS = [
	/quelles.*(sont\s+)?mes dettes/i,
	/combien.*me\s+doiv/i,
	/montre.*mes dettes/i,
	/^mes dettes/i,
	/qui me doit/i,
	/dettes.*(client|encore|impay|en cours)/i,
	/ai-je des dettes/i,
	/combien dois-je/i,
];

const MULTI_COMPARE_PATTERNS = [
	/compare.*ventes.*d[eé]penses/i,
	/compare.*d[eé]penses.*ventes/i,
	/ventes.*et.*d[eé]penses.*(ce|cette)\s+mois/i,
];

function extractStockProduct(text) {
	for (const pattern of STOCK_PRODUCT_PATTERNS) {
		const match = text.match(pattern);
		if (match?.[1]) {
			return match[1].trim();
		}
	}
	return null;
}

export function resolveIntentRegex(message, conversationState = createFallbackState()) {
	const text = String(message || '').trim();
	const lower = text.toLowerCase();

	if (!text) {
		return emptyResolved(conversationState);
	}

	if (BEST_PRODUCT_PATTERNS.some((pattern) => pattern.test(text))) {
		return withRegexMeta({
			intent: 'best_product',
			topic: 'sales',
			filters: {
				period: inheritPeriodFromContext(conversationState),
			},
			references: {},
			needsTool: true,
		});
	}

	if (MULTI_COMPARE_PATTERNS.some((pattern) => pattern.test(text))) {
		return withRegexMeta({
			intent: 'compare_sales_expenses',
			topic: 'mixed',
			filters: {
				period: inheritPeriodFromContext(conversationState),
			},
			references: {},
			needsTool: true,
		});
	}

	if (COMPARE_PATTERNS.some((pattern) => pattern.test(text))) {
		const last = conversationState.references?.lastPeriod || 'current_month';
		const previous = conversationState.references?.previousPeriod || 'previous_month';
		const isExpenses = conversationState.topic === 'expenses';
		return withRegexMeta({
			intent: isExpenses ? 'compare_expenses' : 'compare_sales',
			topic: isExpenses ? 'expenses' : 'sales',
			filters: {
				periods: [previous, last],
			},
			references: {
				lastPeriod: last,
				previousPeriod: previous,
			},
			needsTool: true,
		});
	}

	for (const followUp of TOPIC_FOLLOWUP_PATTERNS) {
		if (followUp.pattern.test(text)) {
			return withRegexMeta({
				intent: followUp.intent,
				topic: followUp.topic,
				filters: followUp.intent === 'query_sales' || followUp.intent === 'query_expenses'
					? { period: inheritPeriodFromContext(conversationState) }
					: {},
				references: {},
				needsTool: true,
			});
		}
	}

	if (conversationState.topic === 'debts' && UNPAID_DEBT_PATTERNS.some((pattern) => pattern.test(text))) {
		return withRegexMeta({
			intent: 'query_debts',
			topic: 'debts',
			filters: { status: 'unpaid' },
			references: {},
			needsTool: true,
		});
	}

	if (GENERIC_DEBT_PATTERNS.some((pattern) => pattern.test(text))) {
		const unpaid = UNPAID_DEBT_PATTERNS.some((pattern) => pattern.test(text));
		return withRegexMeta({
			intent: 'query_debts',
			topic: 'debts',
			filters: { status: unpaid ? 'unpaid' : 'unpaid' },
			references: {},
			needsTool: true,
		});
	}

	if (PREVIOUS_MONTH_PATTERNS.some((pattern) => pattern.test(text))) {
		if (conversationState.topic === 'expenses') {
			return withRegexMeta({
				intent: 'query_expenses',
				topic: 'expenses',
				filters: { period: 'previous_month' },
				references: {},
				needsTool: true,
			});
		}
		return withRegexMeta({
			intent: 'query_sales',
			topic: 'sales',
			filters: { period: 'previous_month' },
			references: {},
			needsTool: true,
		});
	}

	if (CURRENT_MONTH_SALES_PATTERNS.some((pattern) => pattern.test(text))
		|| (conversationState.topic === 'sales' && /combien.*vendu/i.test(text))) {
		return withRegexMeta({
			intent: 'query_sales',
			topic: 'sales',
			filters: { period: 'current_month' },
			references: {},
			needsTool: true,
		});
	}

	if (CURRENT_MONTH_EXPENSE_PATTERNS.some((pattern) => pattern.test(text))) {
		return withRegexMeta({
			intent: 'query_expenses',
			topic: 'expenses',
			filters: { period: 'current_month' },
			references: {},
			needsTool: true,
		});
	}

	const stockProduct = extractStockProduct(text);
	if (stockProduct) {
		return withRegexMeta({
			intent: 'query_stock',
			topic: 'stock',
			filters: { product: stockProduct },
			references: {},
			needsTool: true,
		});
	}

	if (LOW_STOCK_PATTERNS.some((pattern) => pattern.test(text))) {
		return withRegexMeta({
			intent: 'query_stock',
			topic: 'stock',
			filters: { lowStockOnly: true },
			references: {},
			needsTool: true,
		});
	}

	if (GENERIC_STOCK_PATTERNS.some((pattern) => pattern.test(text))) {
		return withRegexMeta({
			intent: 'query_stock',
			topic: 'stock',
			filters: {},
			references: {},
			needsTool: true,
		});
	}

	if (GENERIC_SALES_PATTERNS.some((pattern) => pattern.test(text))) {
		return withRegexMeta({
			intent: 'query_sales',
			topic: 'sales',
			filters: { period: 'current_month' },
			references: {},
			needsTool: true,
		});
	}

	if (GENERIC_EXPENSE_PATTERNS.some((pattern) => pattern.test(text))) {
		return withRegexMeta({
			intent: 'query_expenses',
			topic: 'expenses',
			filters: { period: 'current_month' },
			references: {},
			needsTool: true,
		});
	}

	if (conversationState.topic === 'sales' && /combien|total|ventes|vendu/i.test(lower)) {
		return withRegexMeta({
			intent: 'query_sales',
			topic: 'sales',
			filters: {
				period: inheritPeriodFromContext(conversationState),
			},
			references: {},
			needsTool: true,
		});
	}

	if (conversationState.topic === 'expenses' && /combien|total|d[eé]pens/i.test(lower)) {
		return withRegexMeta({
			intent: 'query_expenses',
			topic: 'expenses',
			filters: {
				period: inheritPeriodFromContext(conversationState),
			},
			references: {},
			needsTool: true,
		});
	}

	if (conversationState.topic === 'stock' && /stock|reste|inventaire|produits/i.test(lower)) {
		return withRegexMeta({
			intent: 'query_stock',
			topic: 'stock',
			filters: {
				...(conversationState.references?.lastProduct
					? { product: conversationState.references.lastProduct }
					: {}),
			},
			references: {},
			needsTool: true,
		});
	}

	if (conversationState.topic === 'debts' && /combien|total|dette|doiv|impay/i.test(lower)) {
		return withRegexMeta({
			intent: 'query_debts',
			topic: 'debts',
			filters: {
				status: UNPAID_DEBT_PATTERNS.some((pattern) => pattern.test(text)) ? 'unpaid' : 'unpaid',
			},
			references: {},
			needsTool: true,
		});
	}

	return withRegexMeta({
		intent: 'unknown',
		topic: conversationState.topic || null,
		filters: { ...conversationState.filters },
		references: { ...conversationState.references },
		needsTool: false,
	});
}

function withRegexMeta(result) {
	return {
		...result,
		needsClarification: false,
		clarificationQuestion: null,
		resolver: 'regex',
		resolverMeta: null,
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
	return withRegexMeta({
		intent: 'unknown',
		topic: conversationState.topic || null,
		filters: { ...conversationState.filters },
		references: { ...conversationState.references },
		needsTool: false,
	});
}
