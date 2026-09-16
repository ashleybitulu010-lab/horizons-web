import { FINANCIAL_ANALYSIS_STATUS, FINANCIAL_ANALYSIS_TYPES } from '../financial/financial-contract.js';
import {
	directionNoun,
	directionVerb,
	formatMoneyV2,
	formatPercentV2,
	formatPeriodLabel,
} from './response-formatter-v2.js';

function activityPrefix(context) {
	const name = context?.activityName || context?.activityReference;
	return name ? `Pour ${name}, ` : '';
}

function buildPartialNotice(analysis) {
	if (!analysis?.partial) return '';
	const limitations = analysis.limitations || [];
	if (limitations.includes('NOT_AVAILABLE') || limitations.includes('MISSING_DATA')) {
		return ' Certaines données n’ont pas pu être récupérées, donc cette analyse reste incomplète.';
	}
	return ' Cette analyse est partielle car certaines sources n’ont pas pu être consultées.';
}

export function templateNoData(analysis, context = {}) {
	const domain = analysis?.domain || 'GENERAL';
	const period = formatPeriodLabel(analysis?.periods?.current);
	if (domain === 'SALES') {
		return `${activityPrefix(context)}Je n’ai trouvé aucune vente ${period}.`;
	}
	if (domain === 'EXPENSES') {
		return `${activityPrefix(context)}Je n’ai trouvé aucune dépense ${period}.`;
	}
	return `${activityPrefix(context)}Je n’ai trouvé aucune donnée financière ${period}.`;
}

export function templateError() {
	return 'Je n’ai pas pu récupérer les données nécessaires pour faire cette analyse.';
}

export function templateTimeout() {
	return 'J’ai récupéré une partie des données, mais une des sources a pris trop de temps à répondre. Je ne peux donc pas confirmer complètement l’analyse.';
}

export function templateWriteDeferred() {
	return 'Cette action nécessite une confirmation avant exécution. Je ne l’ai pas encore enregistrée.';
}

export function templateSalesRetrieve(analysis, context = {}) {
	const metrics = analysis.metrics || {};
	const period = formatPeriodLabel(analysis.periods?.current);
	const prefix = activityPrefix(context);

	if (analysis.status === FINANCIAL_ANALYSIS_STATUS.NO_DATA) {
		return templateNoData(analysis, context);
	}

	const count = metrics.salesCount;
	const revenue = metrics.revenue ?? metrics.collected;
	const revenueText = formatMoneyV2(revenue);

	if (count != null && revenueText) {
		return `${prefix}Tu as réalisé ${count} vente${count > 1 ? 's' : ''} pour un chiffre d’affaires de ${revenueText} ${period}.`.trim();
	}
	if (revenueText) {
		return `${prefix}Tu as réalisé un chiffre d’affaires de ${revenueText} ${period}.`.trim();
	}
	return templateError();
}

export function templateExpensesRetrieve(analysis, context = {}) {
	const metrics = analysis.metrics || {};
	const period = formatPeriodLabel(analysis.periods?.current);
	const prefix = activityPrefix(context);

	if (analysis.status === FINANCIAL_ANALYSIS_STATUS.NO_DATA) {
		return templateNoData(analysis, context);
	}

	const count = metrics.expenseCount;
	const total = metrics.expenses?.current ?? metrics.expenses;
	const totalText = formatMoneyV2(total);

	if (count != null && totalText) {
		return `${prefix}Tu as enregistré ${count} dépense${count > 1 ? 's' : ''} pour un total de ${totalText} ${period}.`.trim();
	}
	if (totalText) {
		return `${prefix}Tes dépenses s’élèvent à ${totalText} ${period}.`.trim();
	}
	return templateError();
}

export function templateExpensesCompare(analysis, context = {}) {
	const comparison = analysis.comparisons?.expenses;
	const prefix = activityPrefix(context);

	if (!comparison || comparison.current == null) {
		return templateError();
	}

	const currentText = formatMoneyV2(comparison.current);
	const previousText = formatMoneyV2(comparison.previous);
	const deltaText = formatMoneyV2(Math.abs(comparison.absoluteChange ?? 0));
	const direction = directionNoun(comparison.direction, 'augmentation', 'baisse', 'stagnation');

	if (comparison.previous === 0 || comparison.percentageChange == null) {
		return `${prefix}Tes dépenses sont passées de ${previousText ?? '0 $'} à ${currentText}. Il n’y a pas de base précédente permettant de calculer un pourcentage.`.trim();
	}

	const pct = formatPercentV2(comparison.percentageChange);
	return `${prefix}Tes dépenses ont connu une ${direction} de ${deltaText}, soit ${pct} par rapport à la période précédente (${previousText} → ${currentText}).`.trim();
}

export function templateProfitExplanation(analysis, context = {}) {
	if (!analysis?.comparisons) {
		return templateError();
	}

	const prefix = activityPrefix(context);
	const profit = analysis.comparisons?.profit;
	const revenue = analysis.comparisons?.revenue;
	const expenses = analysis.comparisons?.expenses;

	if (!profit || profit.current == null || profit.previous == null) {
		return `${prefix}${templateError()}${buildPartialNotice(analysis)}`.trim();
	}

	const profitPct = profit.percentageChange != null ? formatPercentV2(profit.percentageChange) : null;
	const profitVerb = directionVerb(profit.direction, 'augmenté', 'baissé', 'stagné');
	const currentProfit = formatMoneyV2(profit.current);
	const previousProfit = formatMoneyV2(profit.previous);

	let text = `${prefix}Ton bénéfice a ${profitVerb}`;
	if (profitPct) text += ` de ${profitPct}`;
	text += `, passant de ${previousProfit} à ${currentProfit}.`;

	if (revenue?.absoluteChange != null) {
		const revVerb = directionVerb(revenue.direction, 'augmenté', 'baissé', 'stagné');
		if (revenue.percentageChange != null) {
			text += ` Tes ventes ont ${revVerb} de ${formatPercentV2(revenue.percentageChange)}.`;
		} else if (revenue.previous === 0) {
			text += ` Tes ventes sont passées de ${formatMoneyV2(revenue.previous)} à ${formatMoneyV2(revenue.current)}.`;
		} else {
			text += ` Tes ventes ont ${revVerb} de ${formatMoneyV2(Math.abs(revenue.absoluteChange))}.`;
		}
	}

	if (expenses?.absoluteChange != null) {
		const expVerb = directionVerb(expenses.direction, 'augmenté', 'baissé', 'stagné');
		if (expenses.percentageChange != null) {
			text += ` Tes dépenses ont ${expVerb} de ${formatPercentV2(expenses.percentageChange)}.`;
		} else if (expenses.previous === 0) {
			text += ` Tes dépenses sont passées de ${formatMoneyV2(expenses.previous)} à ${formatMoneyV2(expenses.current)}.`;
		} else {
			text += ` Tes dépenses ont ${expVerb} de ${formatMoneyV2(Math.abs(expenses.absoluteChange))}.`;
		}
	}

	const topDriver = analysis.drivers?.[0];
	if (topDriver) {
		if (topDriver.type === 'EXPENSE_INCREASE') {
			text += ' Le principal facteur observé est l’augmentation de tes dépenses.';
		} else if (topDriver.type === 'REVENUE_DECREASE') {
			text += ' Le principal facteur observé est la baisse de tes ventes.';
		} else if (topDriver.type === 'EXPENSE_DECREASE') {
			text += ' Le principal facteur observé est la baisse de tes dépenses.';
		} else if (topDriver.type === 'REVENUE_INCREASE') {
			text += ' Le principal facteur observé est l’augmentation de tes ventes.';
		}
	}

	if (revenue?.absoluteChange > 0 && expenses?.absoluteChange > 0 && profit?.direction === 'DOWN') {
		text += ` La hausse de ${formatMoneyV2(revenue.absoluteChange)} des ventes n’a pas compensé les ${formatMoneyV2(expenses.absoluteChange)} de dépenses supplémentaires.`;
	}

	return `${text}${buildPartialNotice(analysis)}`.trim();
}

export function templatePartial(analysis, context = {}) {
	const prefix = activityPrefix(context);
	if (analysis?.domain === 'PROFIT') {
		return `${prefix}J’ai pu analyser une partie de tes données, mais il me manque des informations pour conclure précisément sur l’évolution de ton bénéfice.${buildPartialNotice(analysis)}`.trim();
	}
	return `${prefix}Je n’ai pu analyser qu’une partie des données demandées.${buildPartialNotice(analysis)}`.trim();
}

export function selectTemplate(analysis, goal, context = {}) {
	if (goal?.type === 'ACTION') {
		return templateWriteDeferred();
	}

	if (analysis?.status === FINANCIAL_ANALYSIS_STATUS.NO_DATA) {
		return templateNoData(analysis, context);
	}

	if (analysis?.status === FINANCIAL_ANALYSIS_STATUS.UNAVAILABLE
		|| analysis?.status === FINANCIAL_ANALYSIS_STATUS.INVALID_INPUT) {
		return templateError();
	}

	if (analysis?.partial || analysis?.status === FINANCIAL_ANALYSIS_STATUS.PARTIAL) {
		if (goal?.domain === 'PROFIT' && goal?.objective === 'EXPLAIN') {
			const full = templateProfitExplanation(analysis, context);
			if (full && !full.startsWith('Je n’ai pas pu')) return full;
		}
		return templatePartial(analysis, context);
	}

	if (analysis?.limitations?.includes('TIMEOUT')) {
		return templateTimeout();
	}

	if (goal?.domain === 'SALES' && goal?.objective === 'RETRIEVE') {
		return templateSalesRetrieve(analysis, context);
	}

	if (goal?.domain === 'EXPENSES' && goal?.objective === 'RETRIEVE') {
		return templateExpensesRetrieve(analysis, context);
	}

	if (goal?.domain === 'EXPENSES' && goal?.objective === 'COMPARE') {
		return templateExpensesCompare(analysis, context);
	}

	if (analysis?.analysisType === FINANCIAL_ANALYSIS_TYPES.EXPLANATION
		|| (goal?.domain === 'PROFIT' && goal?.objective === 'EXPLAIN')) {
		return templateProfitExplanation(analysis, context);
	}

	return templateError();
}
