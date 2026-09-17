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

const PDF_REQUEST_PATTERN = /\b(pdf|document|fichier|export(?:e)?|t[eé]l[eé]charg(?:e|er)|g[eé]n[eè]re|envoie[- ]?moi)\b/i;
const PDF_REPORT_CONTEXT_PATTERN = /\b(bilan|rapport|synth[eè]se|r[eé]sum[eé]|r[eé]cap(?:itulatif)?)\b/i;

const AMBIGUOUS_PERIOD_PATTERN = /\b(r[eé]cemment|derni[eè]rement|depuis\s+peu)\b/i;

const REPORT_PATTERNS = [
	/\bbilan\b/i,
	/\br[eé]cap(?:itulatif)?\b/i,
	/\br[eé]sum[eé]/i,
	/\br[eé]sumer\b/i,
	/\bsynth[eè]se\b/i,
	/\bo[uù]\s+en\s+suis[- ]?je\b/i,
	/\bo[uù]\s+est\s+mon\s+r[eé]sum[eé]/i,
	/\bcombien\s+j['’]?ai\s+gagn[eé]/i,
	/\bcombien\s+j['’]?ai\s+dans\s+mon\s+activit[eé]/i,
	/\bquel\s+est\s+mon\s+b[eé]n[eé]fice/i,
	/^(?:donne[- ]?moi|fais[- ]?(?:moi)?)\s+(?:le\s+)?(?:total|r[eé]cap)/i,
	/\br[eé]sum[eé]\s+(?:de\s+)?(?:mon\s+)?activit[eé]/i,
];

const REPORT_HOW_TO_PATTERN = /comment\s+(?:g[eé]n[eé]rer|faire|obtenir).*(?:bilan|rapport|pdf)/i;

const CREATE_SALE_PREFIX = /^j['']?ai vendu\b/i;
const CONFIRMATION_PATTERN = /^(?:oui|yes|ok|confirme(?:r|z)?|je confirme|c['']est bon|vas[- ]?y)\b[!?.]*$/i;

function isConfirmationMessage(text) {
	return CONFIRMATION_PATTERN.test(String(text || '').trim());
}

function toNumber(value) {
	if (value == null || value === '') return null;
	const num = Number(String(value).replace(',', '.'));
	return Number.isFinite(num) ? num : null;
}

export function parseCreateSaleFromText(text) {
	const raw = String(text || '').trim();
	if (!CREATE_SALE_PREFIX.test(raw) || /^combien/i.test(raw)) {
		return null;
	}

	const paidMatch = raw.match(/(?:pay[eé]|encaiss[eé])\s+(\d+(?:[.,]\d+)?)\s*\$?/i);
	const amountPaid = paidMatch ? toNumber(paidMatch[1]) : null;

	const withUnitPrice = raw.match(
		/^j['']?ai vendu\s+(\d+(?:[.,]\d+)?)\s+(.+?)\s+[àa@]\s*(\d+(?:[.,]\d+)?)\s*\$?(?:.*)?$/i,
	);
	if (withUnitPrice) {
		let product = String(withUnitPrice[2] || '').trim();
		product = product.replace(/,\s*(?:pay[eé]|encaiss[eé]).*$/i, '').trim();
		return {
			product: product || null,
			quantity: toNumber(withUnitPrice[1]),
			unitPrice: toNumber(withUnitPrice[3]),
			amountPaid,
		};
	}

	const withQuantity = raw.match(
		/^j['']?ai vendu\s+(\d+(?:[.,]\d+)?)\s+(.+?)(?:,\s*(?:pay[eé]|encaiss[eé])|$)/i,
	);
	if (withQuantity) {
		let product = String(withQuantity[2] || '').trim();
		product = product.replace(/,\s*(?:pay[eé]|encaiss[eé]).*$/i, '').trim();
		return {
			product: product || null,
			quantity: toNumber(withQuantity[1]),
			unitPrice: null,
			amountPaid,
		};
	}

	const tail = raw.replace(/^j['']?ai vendu\s+/i, '').trim();
	return {
		product: tail || null,
		quantity: null,
		unitPrice: null,
		amountPaid,
	};
}

function resolveCreateSaleIntent(text, conversationState = {}) {
	if (isConfirmationMessage(text) && conversationState.pendingWrite?.tool === 'create_sale') {
		const pending = conversationState.pendingWrite;
		return withRegexMeta({
			intent: 'create_sale',
			topic: 'sales',
			filters: {
				product: pending.product,
				quantity: pending.quantity,
				unitPrice: pending.unitPrice ?? null,
				amountPaid: pending.amountPaid ?? null,
				confirmed: true,
			},
			references: {},
			needsTool: true,
		});
	}

	const draft = parseCreateSaleFromText(text);
	if (!draft) {
		return null;
	}

	if (!draft.product) {
		return withRegexMeta({
			intent: 'unknown',
			topic: 'sales',
			filters: {},
			references: {},
			needsTool: false,
			needsClarification: true,
			clarificationQuestion: 'Quel produit as-tu vendu ?',
		});
	}

	if (!draft.quantity || draft.quantity <= 0) {
		return withRegexMeta({
			intent: 'unknown',
			topic: 'sales',
			filters: { product: draft.product },
			references: {},
			needsTool: false,
			needsClarification: true,
			clarificationQuestion: `D'accord 😊 Combien de ${draft.product} as-tu vendus ?`,
		});
	}

	if (draft.amountPaid == null) {
		return withRegexMeta({
			intent: 'unknown',
			topic: 'sales',
			filters: {
				product: draft.product,
				quantity: draft.quantity,
				unitPrice: draft.unitPrice ?? null,
			},
			references: {},
			needsTool: false,
			needsClarification: true,
			clarificationQuestion: draft.unitPrice
				? `Combien as-tu encaissé pour ${draft.quantity} ${draft.product} à ${draft.unitPrice} $ ?`
				: `Combien as-tu encaissé pour cette vente de ${draft.product} ?`,
		});
	}

	return withRegexMeta({
		intent: 'create_sale',
		topic: 'sales',
		filters: {
			product: draft.product,
			quantity: draft.quantity,
			unitPrice: draft.unitPrice ?? null,
			amountPaid: draft.amountPaid,
			confirmed: false,
		},
		references: {},
		needsTool: true,
	});
}

const CREATE_EXPENSE_PREFIX = /^j['']?ai d[eé]pens[eé]/i;

function normalizeExpenseLabel(label) {
	return String(label || '').trim().replace(/^(?:le|la|les|l[''])\s+/i, '');
}

export function parseCreateExpenseFromText(text) {
	const raw = String(text || '').trim();
	if (!CREATE_EXPENSE_PREFIX.test(raw) || /^combien/i.test(raw)) {
		return null;
	}

	const amountPourLabel = raw.match(
		/^j['']?ai d[eé]pens[eé]\s+(\d+(?:[.,]\d+)?)\s*\$?\s*(?:pour|en|de|dans)\s+(.+)$/i,
	);
	if (amountPourLabel) {
		return {
			amount: toNumber(amountPourLabel[1]),
			label: normalizeExpenseLabel(amountPourLabel[2]),
		};
	}

	const amountOnly = raw.match(/^j['']?ai d[eé]pens[eé]\s+(\d+(?:[.,]\d+)?)\s*\$?\s*$/i);
	if (amountOnly) {
		return {
			amount: toNumber(amountOnly[1]),
			label: null,
		};
	}

	const labelOnly = raw.match(/^j['']?ai d[eé]pens[eé]\s+(?:pour|en|de|dans)\s+(.+)$/i);
	if (labelOnly) {
		return {
			amount: null,
			label: normalizeExpenseLabel(labelOnly[1]),
		};
	}

	return {
		amount: null,
		label: normalizeExpenseLabel(raw.replace(/^j['']?ai d[eé]pens[eé]\s+/i, '').trim()) || null,
	};
}

function looksLikeProductCatalogMessage(text) {
	if (/\bd[eé]pense/i.test(text)) {
		return false;
	}
	return /^(?:quels?|liste(?:r|z)?|montre(?:-|\s)?moi|donne(?:-|\s)?moi|affiche|mes).*\bproduits?\b/i.test(text)
		|| /\bproduits?\s+enregistr/i.test(text);
}

function parseExpenseFollowUp(text, conversationState = {}) {
	const trimmed = String(text || '').trim();
	if (!trimmed || CREATE_EXPENSE_PREFIX.test(trimmed) || isConfirmationMessage(trimmed)) {
		return null;
	}

	if (looksLikeProductCatalogMessage(trimmed)) {
		return null;
	}

	if (isDebtRelatedText(trimmed)) {
		return null;
	}

	const filters = conversationState.filters || {};
	const hasPartialDraft = Boolean(filters.label) || filters.amount != null;
	if (!hasPartialDraft) {
		return null;
	}

	let label = filters.label || null;
	let amount = filters.amount ?? null;

	if (/^\d+([.,]\d+)?\s*[$€]?$/i.test(trimmed)) {
		amount = toNumber(trimmed);
	} else {
		label = normalizeExpenseLabel(trimmed.replace(/^pour\s+/i, '')) || label;
	}

	return { label, amount };
}

function resolveCreateExpenseIntent(text, conversationState = {}) {
	if (isConfirmationMessage(text) && conversationState.pendingWrite?.tool === 'create_expense') {
		const pending = conversationState.pendingWrite;
		return withRegexMeta({
			intent: 'create_expense',
			topic: 'expenses',
			filters: {
				label: pending.label,
				amount: pending.amount,
				confirmed: true,
			},
			references: {},
			needsTool: true,
		});
	}

	const followUp = parseExpenseFollowUp(text, conversationState);
	if (followUp) {
		if (!followUp.label) {
			return withRegexMeta({
				intent: 'unknown',
				topic: 'expenses',
				filters: { amount: followUp.amount ?? null },
				references: {},
				needsTool: false,
				needsClarification: true,
				clarificationQuestion: 'D\'accord. C\'était pour quoi ?',
			});
		}
		if (followUp.amount == null || followUp.amount <= 0) {
			return withRegexMeta({
				intent: 'unknown',
				topic: 'expenses',
				filters: { label: followUp.label },
				references: {},
				needsTool: false,
				needsClarification: true,
				clarificationQuestion: 'Quel montant as-tu dépensé ?',
			});
		}
		return withRegexMeta({
			intent: 'create_expense',
			topic: 'expenses',
			filters: {
				label: followUp.label,
				amount: followUp.amount,
				confirmed: false,
			},
			references: {},
			needsTool: true,
		});
	}

	const draft = parseCreateExpenseFromText(text);
	if (!draft) {
		return null;
	}

	if (!draft.label) {
		return withRegexMeta({
			intent: 'unknown',
			topic: 'expenses',
			filters: { amount: draft.amount ?? null },
			references: {},
			needsTool: false,
			needsClarification: true,
			clarificationQuestion: draft.amount != null
				? 'D\'accord. C\'était pour quoi ?'
				: 'D\'accord. Combien as-tu dépensé, et c\'était pour quoi ?',
		});
	}

	if (draft.amount == null || draft.amount <= 0) {
		return withRegexMeta({
			intent: 'unknown',
			topic: 'expenses',
			filters: { label: draft.label },
			references: {},
			needsTool: false,
			needsClarification: true,
			clarificationQuestion: 'Quel montant as-tu dépensé ?',
		});
	}

	return withRegexMeta({
		intent: 'create_expense',
		topic: 'expenses',
		filters: {
			label: draft.label,
			amount: draft.amount,
			confirmed: false,
		},
		references: {},
		needsTool: true,
	});
}

const REPORT_PERIOD_PATTERNS = [
	{ pattern: /\b(ce|cette)\s+mois\b/i, period: 'current_month' },
	{ pattern: /\bmois\s+(dernier|pass[eé])\b/i, period: 'previous_month' },
	{ pattern: /\bcette\s+semaine\b/i, period: 'current_week' },
	{ pattern: /\bsemaine\s+(derni[eè]re|pass[eé]e)\b/i, period: 'previous_week' },
	{ pattern: /\baujourd['’]?hui\b/i, period: 'today' },
	{ pattern: /\bhier\b/i, period: 'yesterday' },
	{ pattern: /\bcette\s+ann[eé]e\b/i, period: 'current_year' },
];

function extractReportPeriod(text, conversationState = {}) {
	for (const entry of REPORT_PERIOD_PATTERNS) {
		if (entry.pattern.test(text)) {
			return entry.period;
		}
	}
	return inheritPeriodFromContext(conversationState);
}

function isPdfReportRequest(text) {
	return PDF_REQUEST_PATTERN.test(text) && PDF_REPORT_CONTEXT_PATTERN.test(text);
}

function isAmbiguousReportPeriod(text) {
	return AMBIGUOUS_PERIOD_PATTERN.test(text)
		&& !REPORT_PERIOD_PATTERNS.some((entry) => entry.pattern.test(text));
}

function isSingleDomainDataQuery(text) {
	if (CURRENT_MONTH_SALES_PATTERNS.some((pattern) => pattern.test(text))) return true;
	if (CURRENT_MONTH_EXPENSE_PATTERNS.some((pattern) => pattern.test(text))) return true;
	if (/combien.*(vendu|ventes)/i.test(text)) return true;
	if (/combien.*(d[eé]pens[eé]|d[eé]pens)/i.test(text)) return true;
	if (GENERIC_DEBT_PATTERNS.some((pattern) => pattern.test(text))) return true;
	if (isDebtRelatedText(text)) return true;
	if (GENERIC_STOCK_PATTERNS.some((pattern) => pattern.test(text))) return true;
	if (LOW_STOCK_PATTERNS.some((pattern) => pattern.test(text))) return true;
	if (isProductCatalogQuery(text)) return true;
	if (BEST_PRODUCT_PATTERNS.some((pattern) => pattern.test(text))) return true;
	if (MULTI_COMPARE_PATTERNS.some((pattern) => pattern.test(text))) return true;
	return false;
}

function looksLikeReportQuery(text, conversationState = {}) {
	if (REPORT_HOW_TO_PATTERN.test(text)) {
		return false;
	}
	if (isSingleDomainDataQuery(text)) {
		return false;
	}
	if (conversationState.topic === 'report' && /(?:\bbilan\b|r[eé]sum[eé]|synth[eè]se|\brecap\b)/i.test(text)) {
		return true;
	}
	return REPORT_PATTERNS.some((pattern) => pattern.test(text));
}

function resolveReportIntent(text, conversationState = {}) {
	if (REPORT_HOW_TO_PATTERN.test(text)) {
		return withRegexMeta({
			intent: 'unknown',
			topic: 'report',
			filters: {},
			references: {},
			needsTool: false,
			needsClarification: true,
			clarificationQuestion: 'Tu peux me demander directement un résumé, par exemple « Quel est mon bénéfice ce mois-ci ? » ou « Fais-moi un bilan ».',
		});
	}

	if (isAmbiguousReportPeriod(text)) {
		return withRegexMeta({
			intent: 'unknown',
			topic: 'report',
			filters: {},
			references: {},
			needsTool: false,
			needsClarification: true,
			clarificationQuestion: 'Sur quelle période veux-tu ce résumé ? Par exemple ce mois-ci, la semaine dernière ou cette année.',
		});
	}

	return withRegexMeta({
		intent: 'generate_report',
		topic: 'report',
		filters: {
			period: extractReportPeriod(text, conversationState),
		},
		references: {},
		needsTool: true,
	});
}

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

	const createSaleIntent = resolveCreateSaleIntent(text, conversationState);
	if (createSaleIntent) {
		return createSaleIntent;
	}

	const createExpenseIntent = resolveCreateExpenseIntent(text, conversationState);
	if (createExpenseIntent) {
		return createExpenseIntent;
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

	if (isPdfReportRequest(text)) {
		return withRegexMeta({
			intent: 'unknown',
			topic: 'report',
			filters: {},
			references: {},
			needsTool: false,
			needsClarification: true,
			clarificationQuestion: 'Je peux te faire un résumé texte de ton activité sur une période. Pour recevoir un document PDF, demande « Génère mon bilan PDF » dans le chat principal.',
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

	if (looksLikeReportQuery(text, conversationState)) {
		return resolveReportIntent(text, conversationState);
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

	if (looksLikeReportQuery(text, conversationState)) {
		return resolveReportIntent(text, conversationState);
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
