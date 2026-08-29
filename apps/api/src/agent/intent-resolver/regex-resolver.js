/**
 * Deterministic intent resolver (Phase 2.1 fallback).
 * A future LLM resolver must return the same ResolvedIntent shape.
 */

import {
	buildDebtQueryFilters,
	isDebtRelatedText,
} from './debt-resolver-helpers.js';
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

const GENERIC_PRODUCTS_PATTERNS = [
	/^(?:quels?|liste|montre|donne[- ]?moi|affiche).*(?:mes\s+)?produits/i,
	/^mes produits/i,
	/(?:quels?|liste).*(?:mes\s+)?produits\s*\??$/i,
	/mon catalogue/i,
	/mes articles/i,
	/quels produits (?:ai-je|je vends)/i,
	/\bcombien de produits\b/i,
];

const PRODUCT_CATALOG_EXCLUSION = /\b(vendu|vente|d[eé]pens|b[eé]n[eé]f|stock|reste|[eé]puis|mieux|plus vendu|presque)\b/i;

const PRODUCT_SEARCH_PATTERNS = [
	/(?:mes produits|produits correspondant à|produits contenant)\s+(?!de la cat[eé]gorie)(.+?)\??$/i,
	/produits\s+comme\s+(.+?)\??$/i,
];

const STOCK_PRODUCT_PATTERNS = [
	/combien me reste[- ]?t[- ]?il de (.+?)\??$/i,
	/reste[- ]?t[- ]?il de (.+?)\??$/i,
	/combien .* reste .* de (.+?)\??$/i,
];

const TOPIC_FOLLOWUP_PATTERNS = [
	{ pattern: /^(et\s+)?(mes\s+|les\s+)?ventes\s*\??$/i, intent: 'query_sales', topic: 'sales' },
	{ pattern: /^(et\s+)?(mes\s+|les\s+)?d[eé]penses\s*\??$/i, intent: 'query_expenses', topic: 'expenses' },
	{ pattern: /^(et\s+)?(mes\s+|les\s+)?dettes\s*\??$/i, intent: 'query_debts', topic: 'debts', isDebtFollowUp: true },
	{ pattern: /^(et\s+)?(mes\s+|les\s+)?produits\s*\??$/i, intent: 'query_products', topic: 'products' },
	{ pattern: /^(et\s+)?mon stock\s*\??$/i, intent: 'query_stock', topic: 'stock' },
];

const DEBT_STATUS_FOLLOWUP_PATTERNS = [
	/^(?:et\s+)?(?:les\s+)?dettes?\s+(?:r[eé]gl[eé]e?s?|pay[eé]e?s?)/i,
	/^(?:et\s+)?(?:celles?\s+)?(?:qui\s+sont\s+)?(?:encore\s+)?impay/i,
	/^(?:et\s+)?toutes?\s+(?:les\s+)?dettes/i,
];

const GENERIC_DEBT_PATTERNS = [
	/quelles.*(sont\s+)?mes dettes/i,
	/combien.*me\s+doiv/i,
	/montre.*mes dettes/i,
	/^mes dettes/i,
	/qui me doit/i,
	/dettes.*client/i,
	/ai-je des dettes/i,
	/montre.*dettes/i,
	/combien me doit/i,
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

function extractCategoryFromText(text) {
	const match = text.match(/(?:produits\s+(?:de la\s+)?|(?:de la\s+)?)cat[eé]gorie\s+(.+?)(?:\?|$)/i);
	if (!match?.[1]) {
		return null;
	}
	return match[1].trim().replace(/\?+$/, '').trim();
}

function extractProductCatalogSearch(text) {
	for (const pattern of PRODUCT_SEARCH_PATTERNS) {
		const match = text.match(pattern);
		if (match?.[1]) {
			const value = match[1].trim().replace(/\?+$/, '').trim();
			if (
				value
				&& !/^(cat[eé]gorie|de la)$/i.test(value)
				&& !/^de la cat[eé]gorie/i.test(value)
			) {
				return value;
			}
		}
	}
	return null;
}

function isProductCatalogQuery(text) {
	if (PRODUCT_CATALOG_EXCLUSION.test(text)) {
		return false;
	}
	return GENERIC_PRODUCTS_PATTERNS.some((pattern) => pattern.test(text));
}

function buildProductsFilters(text, conversationState = {}) {
	const category = extractCategoryFromText(text);
	const product = category ? null : extractProductCatalogSearch(text);
	const filters = {};

	if (category) {
		filters.category = category;
	}
	if (product) {
		filters.product = product;
	}
	if (!category && !product && conversationState.topic === 'products') {
		if (conversationState.filters?.category) {
			filters.category = conversationState.filters.category;
		}
		if (conversationState.filters?.product) {
			filters.product = conversationState.filters.product;
		}
	}

	return filters;
}

function resolveDebtIntent(text, conversationState) {
	const debtQuery = buildDebtQueryFilters(text, conversationState);

	if (debtQuery.needsClarification) {
		return withRegexMeta({
			intent: 'unknown',
			topic: 'debts',
			filters: {},
			references: {},
			needsTool: false,
			needsClarification: true,
			clarificationQuestion: debtQuery.clarificationQuestion,
		});
	}

	return withRegexMeta({
		intent: 'query_debts',
		topic: 'debts',
		filters: debtQuery.filters,
		references: {},
		needsTool: true,
	});
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

	if (DEBT_STATUS_FOLLOWUP_PATTERNS.some((pattern) => pattern.test(text))) {
		return resolveDebtIntent(text, conversationState);
	}

	if (conversationState.topic === 'debts' && isDebtRelatedText(text)) {
		return resolveDebtIntent(text, conversationState);
	}

	for (const followUp of TOPIC_FOLLOWUP_PATTERNS) {
		if (followUp.pattern.test(text)) {
			if (followUp.isDebtFollowUp) {
				return resolveDebtIntent(text, conversationState);
			}
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

	if (GENERIC_DEBT_PATTERNS.some((pattern) => pattern.test(text)) || isDebtRelatedText(text)) {
		return resolveDebtIntent(text, conversationState);
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

	if (isProductCatalogQuery(text)) {
		return withRegexMeta({
			intent: 'query_products',
			topic: 'products',
			filters: buildProductsFilters(text, conversationState),
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

	if (conversationState.topic === 'products') {
		const filters = buildProductsFilters(text, conversationState);
		const categoryFollowUp = text.match(/^et en (.+?)\??$/i);
		if (categoryFollowUp?.[1]) {
			filters.category = categoryFollowUp[1].trim();
		}

		if (
			/produits?|catalogue|articles?|cat[eé]gorie/i.test(lower)
			|| categoryFollowUp
			|| Object.keys(filters).length > 0
		) {
			return withRegexMeta({
				intent: 'query_products',
				topic: 'products',
				filters,
				references: {},
				needsTool: true,
			});
		}
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
		needsClarification: Boolean(result.needsClarification),
		clarificationQuestion: result.clarificationQuestion || null,
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
