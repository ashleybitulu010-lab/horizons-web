import { buildActivityComparison, buildPeriodComparison } from './comparison-contract.js';
import { buildPeriodSpecFromLegacyId } from './period-contract.js';
import { sanitizeBusinessFieldValue } from './business-field-sanitizer.js';
import { validateGoal } from './goal-contract.js';

const CONFIRMATION_PATTERN = /^(?:oui|yes|ok|confirme(?:r|z)?|je confirme|c['']est bon|vas[- ]?y)\b[!?.]*$/i;
const PREVIOUS_MONTH_PATTERN = /(?:mois\s+(?:dernier|pass[eé])|le\s+mois\s+pass[eé])/i;

function inheritLegacyPeriod(conversationContext = {}) {
	return conversationContext.references?.lastPeriod
		|| conversationContext.filters?.period
		|| 'current_month';
}

function periodFromText(text, conversationContext = {}, referenceDate = new Date()) {
	if (/\bcette\s+semaine\b/i.test(text)) {
		return buildPeriodSpecFromLegacyId('current_week', referenceDate);
	}
	if (/\bsemaine\s+(?:derni[eè]re|pass[eé]e)\b/i.test(text)) {
		return buildPeriodSpecFromLegacyId('previous_week', referenceDate);
	}
	if (/(?:ce|cette)\s+mois/i.test(text)) {
		return buildPeriodSpecFromLegacyId('current_month', referenceDate);
	}
	if (PREVIOUS_MONTH_PATTERN.test(text)) {
		return buildPeriodSpecFromLegacyId('previous_month', referenceDate);
	}
	if (/\baujourd['']?hui\b/i.test(text)) {
		return buildPeriodSpecFromLegacyId('today', referenceDate);
	}
	if (/\bhier\b/i.test(text)) {
		return buildPeriodSpecFromLegacyId('yesterday', referenceDate);
	}

	const inherited = inheritLegacyPeriod(conversationContext);
	return buildPeriodSpecFromLegacyId(inherited, referenceDate);
}

function profitComparison(referenceDate = new Date()) {
	const current = buildPeriodSpecFromLegacyId('current_month', referenceDate);
	const previous = buildPeriodSpecFromLegacyId('previous_month', referenceDate);
	return buildPeriodComparison(current, previous, 'PROFIT');
}

function expenseComparison(referenceDate = new Date()) {
	const current = buildPeriodSpecFromLegacyId('current_month', referenceDate);
	const previous = buildPeriodSpecFromLegacyId('previous_month', referenceDate);
	return buildPeriodComparison(current, previous, 'EXPENSES');
}

function salesComparison(referenceDate = new Date()) {
	const current = buildPeriodSpecFromLegacyId('current_month', referenceDate);
	const previous = buildPeriodSpecFromLegacyId('previous_month', referenceDate);
	return buildPeriodComparison(current, previous, 'REVENUE');
}

function isCompareCue(text) {
	return /compare(?:r|z)?/i.test(text)
		|| /\bvs\.?\b/i.test(text)
		|| /par rapport/i.test(text)
		|| /compar[eé]/i.test(text);
}

function isExplainCue(text) {
	return /\bpourquoi\b/i.test(text)
		|| /\bexplique(?:r|z)?\b/i.test(text)
		|| /\banalyse(?:r|z)?\b/i.test(text);
}

function isEvolutionCue(text) {
	return /comment [eé]volue/i.test(text)
		|| /[eé]volution/i.test(text);
}

function parseBareExpenseAction(text) {
	if (/^(?:ajoute(?:r|z)?|enregistr(?:e|er|é))\s+(?:une\s+)?d[eé]pense\.?$/i.test(text)) {
		return { amount: null, label: null };
	}
	return null;
}

function parseRecordSaleAction(text) {
	const match = text.match(
		/enregistr(?:e|er|é)\s+(?:une\s+)?vente\s+(?:de\s+)?(\d+(?:[.,]\d+)?)\s*(?:\$|dollars?)?\.?$/i,
	);
	if (!match) {
		return null;
	}
	return {
		unitPrice: Number(String(match[1]).replace(',', '.')),
		quantity: null,
		product: null,
	};
}

function parsePendingModification(text, conversationContext = {}) {
	const pending = conversationContext.pendingWrite;
	if (!pending) {
		return null;
	}

	const mod = text.match(
		/^(?:finalement|plut[oô]t|en fait|c['']est)\s+(\d+(?:[.,]\d+)?)\s*(?:\$|dollars?)?\.?$/i,
	);
	if (!mod) {
		return null;
	}

	const amount = Number(String(mod[1]).replace(',', '.'));

	if (pending.tool === 'create_expense') {
		return validateGoal({
			type: 'ACTION',
			domain: 'EXPENSES',
			objective: 'CREATE',
			period: null,
			comparison: null,
			activityReference: null,
			parameters: {
				amount,
				label: pending.label ?? null,
				confirmed: false,
			},
		}, { rejectWriteExecution: true });
	}

	return null;
}

function classifyDomainSwitchFollowUp(text, conversationContext = {}, referenceDate = new Date()) {
	const trimmed = text.trim();
	if (/^et\s+(?:pour\s+)?(?:les\s+)?d[eé]penses?\s*\??$/i.test(trimmed)) {
		return validateGoal({
			type: 'QUESTION',
			domain: 'EXPENSES',
			objective: 'RETRIEVE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: null,
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (/^et\s+(?:pour\s+)?(?:le\s+)?stock\s*\??$/i.test(trimmed)) {
		return validateGoal({
			type: 'QUESTION',
			domain: 'STOCK',
			objective: 'RETRIEVE',
			period: null,
			comparison: null,
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	return null;
}

function parseExpenseAction(text) {
	const amountLabel = text.match(
		/(?:ajoute(?:r|z)?|enregistr(?:e|er|é))\s+(?:une\s+)?d[eé]pense\s+(?:de\s+)?(\d+(?:[.,]\d+)?)\s*(?:\$|dollars?)?\s*(?:pour|en|de|dans)\s+(.+?)\.?$/i,
	);
	if (amountLabel) {
		return {
			amount: Number(String(amountLabel[1]).replace(',', '.')),
			label: sanitizeBusinessFieldValue(amountLabel[2].trim()),
		};
	}

	const jaiDepense = text.match(
		/^j['']?ai d[eé]pens[eé]\s+(\d+(?:[.,]\d+)?)\s*\$?\s*(?:pour|en|de|dans)\s+(.+)$/i,
	);
	if (jaiDepense) {
		return {
			amount: Number(String(jaiDepense[1]).replace(',', '.')),
			label: sanitizeBusinessFieldValue(jaiDepense[2].trim()),
		};
	}

	return null;
}

function parseSaleAction(text) {
	const match = text.match(
		/(?:ajoute(?:r|z)?|enregistr(?:e|er|é))\s+(\d+(?:[.,]\d+)?)\s+(.+?)\s+vendu[s]?\s+[àa@]\s+(\d+(?:[.,]\d+)?)\s*(?:\$|dollars?)?/i,
	);
	if (!match) {
		return null;
	}

	return {
		quantity: Number(match[1]),
		product: sanitizeBusinessFieldValue(match[2].trim()),
		unitPrice: Number(String(match[3]).replace(',', '.')),
	};
}

function parsePastTenseSaleAction(text) {
	const match = text.match(
		/^j['']?ai\s+vendu\s+(\d+(?:[.,]\d+)?)\s+(.+?)\s+[àa@]\s+(\d+(?:[.,]\d+)?)\s*(?:\$|dollars?)?\.?$/i,
	);
	if (!match) {
		return null;
	}

	return {
		quantity: Number(match[1]),
		product: sanitizeBusinessFieldValue(match[2].trim()),
		unitPrice: Number(String(match[3]).replace(',', '.')),
	};
}

function parseIncompleteExpenseAction(text) {
	const match = text.match(
		/(?:ajoute(?:r|z)?|enregistr(?:e|er|é))\s+(?:une\s+)?d[eé]pense\s+(?:pour|en|de|dans)\s+(.+?)\.?$/i,
	);
	if (!match) {
		return null;
	}

	const label = sanitizeBusinessFieldValue(match[1].trim());
	if (!label) {
		return null;
	}

	return { label, amount: null };
}

function extractActivityReference(text) {
	const otherActivity = text.match(/(?:dans\s+)?(?:mon|ma)\s+(?:autre\s+)?activit[eé]/i);
	if (otherActivity) {
		return 'other activity';
	}

	const compareActivities = text.match(
		/compare\s+(?:ma|mon)\s+(.+?)\s+(?:et|avec)\s+(?:mon|ma)\s+(.+?)\.?$/i,
	);
	if (compareActivities) {
		return null;
	}

	return null;
}

function extractActivityComparison(text) {
	const match = text.match(
		/compare\s+(?:ma|mon)\s+(.+?)\s+(?:et|avec)\s+(?:mon|ma)\s+(.+?)\.?$/i,
	);
	if (!match) {
		return null;
	}

	return buildActivityComparison(match[1].trim(), match[2].trim(), 'PROFIT');
}

const PRODUCT_CATALOG_READ_EXCLUSION = /\b(vendu|vente|d[eé]pens|b[eé]n[eé]f|stock|reste|[eé]puis|mieux|plus vendu|presque)\b/i;

function isProductCatalogReadQuery(text) {
	if (PRODUCT_CATALOG_READ_EXCLUSION.test(text)) {
		return false;
	}
	return /^(?:quels?|liste(?:r|z)?|montre(?:-|\s)?moi|donne(?:-|\s)?moi|affiche).*(?:mes\s+)?produits/i.test(text)
		|| /^mes produits/i.test(text)
		|| /(?:quels?|liste).*(?:mes\s+)?produits\s*\??$/i.test(text)
		|| /mon catalogue/i.test(text)
		|| /mes articles/i.test(text)
		|| /quels produits (?:ai-je|je vends)/i.test(text)
		|| /\bcombien de produits\b/i.test(text);
}

function parseProductWriteAction(text) {
	const createMatch = text.match(
		/^(?:ajoute(?:r|z)?|cr[eé][eé](?:r|z)?|nouveau)\s+(?:le\s+|un\s+)?produit\s+(.+?)\.?$/i,
	);
	if (createMatch) {
		return {
			action: 'create',
			product: sanitizeBusinessFieldValue(createMatch[1].trim()),
		};
	}

	const updateMatch = text.match(/^modifi(?:e|er|é)\s+(?:le\s+)?produit\s+(.+?)\.?$/i);
	if (updateMatch) {
		return {
			action: 'update',
			product: sanitizeBusinessFieldValue(updateMatch[1].trim()),
		};
	}

	return null;
}

function isGeneralActivitySummaryQuery(text) {
	return /comment va(?:ient)?\s+(?:mon|ma|mes)\s+(?:activit[eé]|commerce|boutique)/i.test(text)
		|| /quelle est ma situation/i.test(text)
		|| /^fais(?:-|\s)?moi le point\.?$/i.test(text)
		|| /comment se porte/i.test(text)
		|| /(?:bilan|point)\s+(?:de\s+)?(?:mon|ma)\s+(?:activit[eé]|commerce|situation)/i.test(text);
}

/**
 * Deterministic goal classification from message + conversation context.
 * Returns null when no rule matches.
 */
export function classifyGoalRules(message, conversationContext = {}, referenceDate = new Date()) {
	const text = String(message || '').trim();
	if (!text) {
		return null;
	}

	if (CONFIRMATION_PATTERN.test(text) && conversationContext.pendingWrite) {
		const pending = conversationContext.pendingWrite;
		if (pending.tool === 'create_expense') {
			return validateGoal({
				type: 'ACTION',
				domain: 'EXPENSES',
				objective: 'CREATE',
				period: null,
				comparison: null,
				activityReference: null,
				parameters: {
					label: pending.label ?? null,
					amount: pending.amount ?? null,
					confirmed: true,
				},
			}, { rejectWriteExecution: true });
		}
		if (pending.tool === 'create_sale') {
			return validateGoal({
				type: 'ACTION',
				domain: 'SALES',
				objective: 'CREATE',
				period: null,
				comparison: null,
				activityReference: null,
				parameters: {
					product: pending.product ?? null,
					quantity: pending.quantity ?? null,
					unitPrice: pending.unitPrice ?? null,
					amountPaid: pending.amountPaid ?? null,
					confirmed: true,
				},
			}, { rejectWriteExecution: true });
		}
	}

	const pendingModification = parsePendingModification(text, conversationContext);
	if (pendingModification?.valid) {
		return pendingModification;
	}

	const domainSwitch = classifyDomainSwitchFollowUp(text, conversationContext, referenceDate);
	if (domainSwitch?.valid) {
		return domainSwitch;
	}

	const activityComparison = extractActivityComparison(text);
	if (activityComparison) {
		return validateGoal({
			type: 'ANALYSIS',
			domain: 'GENERAL',
			objective: 'COMPARE',
			period: null,
			comparison: activityComparison,
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (/autre\s+activit[eé]/i.test(text)) {
		return validateGoal({
			type: 'MIXED',
			domain: 'GENERAL',
			objective: 'RETRIEVE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: null,
			activityReference: 'other activity',
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (isProductCatalogReadQuery(text)) {
		return validateGoal({
			type: 'QUESTION',
			domain: 'PRODUCTS',
			objective: 'RETRIEVE',
			period: null,
			comparison: null,
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	const productWriteAction = parseProductWriteAction(text);
	if (productWriteAction) {
		return validateGoal({
			type: 'ACTION',
			domain: 'PRODUCTS',
			objective: productWriteAction.action === 'update' ? 'UPDATE' : 'CREATE',
			period: null,
			comparison: null,
			activityReference: null,
			parameters: {
				product: productWriteAction.product,
				confirmed: false,
			},
		}, { rejectWriteExecution: true });
	}

	if (isGeneralActivitySummaryQuery(text)) {
		return validateGoal({
			type: 'ANALYSIS',
			domain: 'GENERAL',
			objective: 'SUMMARIZE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: null,
			activityReference: null,
			parameters: { summary: true },
		}, { rejectWriteExecution: true });
	}

	const expenseAction = parseExpenseAction(text);
	if (expenseAction) {
		return validateGoal({
			type: 'ACTION',
			domain: 'EXPENSES',
			objective: 'CREATE',
			period: null,
			comparison: null,
			activityReference: null,
			parameters: {
				amount: expenseAction.amount,
				label: expenseAction.label,
				confirmed: false,
			},
		}, { rejectWriteExecution: true });
	}

	const incompleteExpense = parseIncompleteExpenseAction(text);
	if (incompleteExpense) {
		return validateGoal({
			type: 'ACTION',
			domain: 'EXPENSES',
			objective: 'CREATE',
			period: null,
			comparison: null,
			activityReference: null,
			parameters: {
				amount: incompleteExpense.amount,
				label: incompleteExpense.label,
				confirmed: false,
			},
		}, { rejectWriteExecution: true });
	}

	const pastTenseSale = parsePastTenseSaleAction(text);
	if (pastTenseSale) {
		return validateGoal({
			type: 'ACTION',
			domain: 'SALES',
			objective: 'CREATE',
			period: null,
			comparison: null,
			activityReference: null,
			parameters: {
				...pastTenseSale,
				confirmed: false,
			},
		}, { rejectWriteExecution: true });
	}

	const saleAction = parseSaleAction(text);
	if (saleAction) {
		return validateGoal({
			type: 'ACTION',
			domain: 'SALES',
			objective: 'CREATE',
			period: null,
			comparison: null,
			activityReference: null,
			parameters: {
				...saleAction,
				confirmed: false,
			},
		}, { rejectWriteExecution: true });
	}

	const bareExpense = parseBareExpenseAction(text);
	if (bareExpense) {
		return validateGoal({
			type: 'ACTION',
			domain: 'EXPENSES',
			objective: 'CREATE',
			period: null,
			comparison: null,
			activityReference: null,
			parameters: {
				amount: bareExpense.amount,
				label: bareExpense.label,
				confirmed: false,
			},
		}, { rejectWriteExecution: true });
	}

	const recordSale = parseRecordSaleAction(text);
	if (recordSale) {
		return validateGoal({
			type: 'ACTION',
			domain: 'SALES',
			objective: 'CREATE',
			period: null,
			comparison: null,
			activityReference: null,
			parameters: {
				...recordSale,
				confirmed: false,
			},
		}, { rejectWriteExecution: true });
	}

	if (isCompareCue(text) && conversationContext.topic === 'sales' && !/d[eé]pense|b[eé]n[eé]f|profit/i.test(text)) {
		return validateGoal({
			type: 'ANALYSIS',
			domain: 'SALES',
			objective: 'COMPARE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: salesComparison(referenceDate),
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (isCompareCue(text) && conversationContext.topic === 'expenses') {
		return validateGoal({
			type: 'ANALYSIS',
			domain: 'EXPENSES',
			objective: 'COMPARE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: expenseComparison(referenceDate),
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (isExplainCue(text) && /ventes?.*d[eé]penses?|d[eé]penses?.*ventes?/i.test(text)
		&& /b[eé]n[eé]f|profit|pourquoi|explique|regarde/i.test(text)) {
		return validateGoal({
			type: 'ANALYSIS',
			domain: 'PROFIT',
			objective: 'EXPLAIN',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: profitComparison(referenceDate),
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (/compare.*ventes.*d[eé]penses|compare.*d[eé]penses.*ventes|ventes.*et.*d[eé]penses/i.test(text)) {
		return validateGoal({
			type: 'ANALYSIS',
			domain: 'PROFIT',
			objective: 'COMPARE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: null,
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (isCompareCue(text) && /encaiss[eé]/i.test(text) && /d[eé]penses?/i.test(text)) {
		return validateGoal({
			type: 'ANALYSIS',
			domain: 'PROFIT',
			objective: 'COMPARE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: profitComparison(referenceDate),
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (isCompareCue(text) && /b[eé]n[eé]f|profit/i.test(text)) {
		return validateGoal({
			type: 'ANALYSIS',
			domain: 'PROFIT',
			objective: 'COMPARE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: profitComparison(referenceDate),
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (isCompareCue(text) && /d[eé]penses?/i.test(text)) {
		return validateGoal({
			type: 'ANALYSIS',
			domain: 'EXPENSES',
			objective: 'COMPARE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: expenseComparison(referenceDate),
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if ((isCompareCue(text) || isEvolutionCue(text)) && /ventes?/i.test(text)) {
		return validateGoal({
			type: 'ANALYSIS',
			domain: 'SALES',
			objective: 'COMPARE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: salesComparison(referenceDate),
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (isExplainCue(text) && /encaissement/i.test(text)) {
		return validateGoal({
			type: 'ANALYSIS',
			domain: 'PROFIT',
			objective: 'EXPLAIN',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: profitComparison(referenceDate),
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (isExplainCue(text) && /ventes?/i.test(text)) {
		return validateGoal({
			type: 'ANALYSIS',
			domain: 'SALES',
			objective: 'EXPLAIN',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: salesComparison(referenceDate),
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (isExplainCue(text) && /marge/i.test(text)) {
		return validateGoal({
			type: 'ANALYSIS',
			domain: 'PROFIT',
			objective: 'EXPLAIN',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: profitComparison(referenceDate),
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (/pourquoi.*d[eé]penses?.*(?:augment|plus|[eé]lev)/i.test(text)
		|| /pourquoi.*(?:augment|plus).*d[eé]penses?/i.test(text)) {
		return validateGoal({
			type: 'ANALYSIS',
			domain: 'EXPENSES',
			objective: 'EXPLAIN',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: expenseComparison(referenceDate),
			activityReference: extractActivityReference(text),
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (/pourquoi.*b[eé]n[eé]f/i.test(text)
		|| /explique.*b[eé]n[eé]f/i.test(text)
		|| /qu['']est-ce qui a fait (?:baisser|augmenter|changer|diminuer).*b[eé]n[eé]f/i.test(text)
		|| /(?:baisser|diminuer|augmenter).*b[eé]n[eé]f/i.test(text)
		|| (/regarde.*ventes.*d[eé]penses/i.test(text) && /pourquoi|explique/i.test(text))) {
		return validateGoal({
			type: 'ANALYSIS',
			domain: 'PROFIT',
			objective: 'EXPLAIN',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: profitComparison(referenceDate),
			activityReference: extractActivityReference(text),
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (/meilleur\s+produit|rapporte\s+le\s+plus|mieux\s+vendu/i.test(text)) {
		return validateGoal({
			type: 'QUESTION',
			domain: 'PRODUCTS',
			objective: 'RETRIEVE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: null,
			activityReference: null,
			parameters: { ranking: 'best_seller' },
		}, { rejectWriteExecution: true });
	}

	if (/produit.*(?:se vend|vend).*(?:mieux|plus)|se vend(?:ent)?\s+le\s+(?:mieux|plus)/i.test(text)) {
		return validateGoal({
			type: 'QUESTION',
			domain: 'SALES',
			objective: 'RETRIEVE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: null,
			activityReference: null,
			parameters: { ranking: 'best_seller' },
		}, { rejectWriteExecution: true });
	}

	if (/cat[eé]gorie.*d[eé]pense|d[eé]pense.*cat[eé]gorie|quelle.*d[eé]pense.*(?:p[eè]se|plus)/i.test(text)) {
		return validateGoal({
			type: 'QUESTION',
			domain: 'EXPENSES',
			objective: 'RETRIEVE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: null,
			activityReference: null,
			parameters: { ranking: 'top_category' },
		}, { rejectWriteExecution: true });
	}

	if (/r[eé]sum[eé]|fais(?:-|\s)?moi un r[eé]sum[eé]|synth[eè]se|donne(?:-|\s)?moi un r[eé]sum[eé]/i.test(text)) {
		const activitySummary = /activit[eé]|financ|b[eé]n[eé]f|global|situation|commerce|point/i.test(text);
		return validateGoal({
			type: activitySummary ? 'ANALYSIS' : 'QUESTION',
			domain: 'GENERAL',
			objective: activitySummary ? 'SUMMARIZE' : 'RETRIEVE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: null,
			activityReference: null,
			parameters: { summary: true },
		}, { rejectWriteExecution: true });
	}

	if (/ratio.*d[eé]pense|ratio.*revenu|d[eé]penses?\/revenus?/i.test(text)) {
		return validateGoal({
			type: 'QUESTION',
			domain: 'PROFIT',
			objective: 'RETRIEVE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: null,
			activityReference: null,
			parameters: { metric: 'expense_ratio' },
		}, { rejectWriteExecution: true });
	}

	if ((isCompareCue(text) || isEvolutionCue(text)) && /b[eé]n[eé]f|profit|marge/i.test(text)) {
		return validateGoal({
			type: 'ANALYSIS',
			domain: 'PROFIT',
			objective: 'COMPARE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: profitComparison(referenceDate),
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (/marge|profit\s*=\s*encaiss|encaiss[eé].*-\s*d[eé]pense|b[eé]n[eé]f|profit/i.test(text)) {
		return validateGoal({
			type: 'QUESTION',
			domain: 'PROFIT',
			objective: 'RETRIEVE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: null,
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (/encaiss[eé]/i.test(text)) {
		return validateGoal({
			type: 'QUESTION',
			domain: 'SALES',
			objective: 'RETRIEVE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: null,
			activityReference: null,
			parameters: { metric: 'collected' },
		}, { rejectWriteExecution: true });
	}

	if (/combien.*(?:en|de)\s+stock|il me reste.*stock|(?:mon|mes)\s+stock/i.test(text)) {
		return validateGoal({
			type: 'QUESTION',
			domain: 'STOCK',
			objective: 'RETRIEVE',
			period: null,
			comparison: null,
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (/qui me doit|me doivent|doit encore|doivent encore/i.test(text)) {
		return validateGoal({
			type: 'QUESTION',
			domain: 'DEBTS',
			objective: 'RETRIEVE',
			period: null,
			comparison: null,
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (/rupture|en rupture|stock faible|articles.*rupture|(?:quels?|quelles?).*articles?.*(?:rupture|[eé]puis)/i.test(text)) {
		return validateGoal({
			type: 'QUESTION',
			domain: 'STOCK',
			objective: 'RETRIEVE',
			period: null,
			comparison: null,
			activityReference: null,
			parameters: { lowStockOnly: true },
		}, { rejectWriteExecution: true });
	}

	const stockProduct = text.match(/stock\s+(?:de\s+)?(.+?)\s+(?:bient[oô]t|[eé]puis)/i)
		|| text.match(/(?:de\s+)(.+?)\s+(?:bient[oô]t|[eé]puis|[eé]puis[eé])/i);
	if (stockProduct?.[1]) {
		return validateGoal({
			type: 'QUESTION',
			domain: 'STOCK',
			objective: 'RETRIEVE',
			period: null,
			comparison: null,
			activityReference: null,
			parameters: { product: sanitizeBusinessFieldValue(stockProduct[1].trim()), lowStockOnly: true },
		}, { rejectWriteExecution: true });
	}

	if (/combien.*vendu|(?:mes|mon)\s+ventes|j['']?ai vendu|tu peux me dire.*ventes|je veux savoir.*vendu|qu['']est-ce que j['']ai vendu|chiffre d['']affaires|\bventes\b/i.test(text)) {
		return validateGoal({
			type: 'QUESTION',
			domain: 'SALES',
			objective: 'RETRIEVE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: null,
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (/combien.*d[eé]pens|(?:mes|mon)\s+d[eé]penses|j['']?ai (?:beaucoup )?d[eé]pens|mes d[eé]penses c['']est combien|\bd[eé]penses\b/i.test(text)) {
		return validateGoal({
			type: 'QUESTION',
			domain: 'EXPENSES',
			objective: 'RETRIEVE',
			period: periodFromText(text, conversationContext, referenceDate),
			comparison: null,
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (PREVIOUS_MONTH_PATTERN.test(text) && conversationContext.topic === 'sales') {
		return validateGoal({
			type: 'QUESTION',
			domain: 'SALES',
			objective: 'RETRIEVE',
			period: buildPeriodSpecFromLegacyId('previous_month', referenceDate),
			comparison: null,
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (PREVIOUS_MONTH_PATTERN.test(text) && conversationContext.topic === 'expenses') {
		return validateGoal({
			type: 'QUESTION',
			domain: 'EXPENSES',
			objective: 'RETRIEVE',
			period: buildPeriodSpecFromLegacyId('previous_month', referenceDate),
			comparison: null,
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	if (PREVIOUS_MONTH_PATTERN.test(text)) {
		return validateGoal({
			type: 'QUESTION',
			domain: 'SALES',
			objective: 'RETRIEVE',
			period: buildPeriodSpecFromLegacyId('previous_month', referenceDate),
			comparison: null,
			activityReference: null,
			parameters: {},
		}, { rejectWriteExecution: true });
	}

	return null;
}
