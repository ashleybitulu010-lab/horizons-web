const PERIOD_LABELS = {
	today: 'aujourd’hui',
	yesterday: 'hier',
	current_week: 'cette semaine',
	previous_week: 'la semaine dernière',
	current_month: 'ce mois-ci',
	previous_month: 'le mois dernier',
	current_year: 'cette année',
};

function formatMoney(value) {
	return `${Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} $`;
}

function periodLabel(meta = {}) {
	if (meta.period && PERIOD_LABELS[meta.period]) return PERIOD_LABELS[meta.period];
	if (meta.startDate && meta.endDate) return `du ${meta.startDate} au ${meta.endDate}`;
	return 'sur la période demandée';
}

export function formatSalesQueryReply(toolResult) {
	if (!toolResult.success) {
		return toolResult.error?.message || 'Je n’ai pas pu récupérer tes ventes.';
	}

	const summary = toolResult.data.summary;
	const label = periodLabel(toolResult.meta);

	if (!summary.count) {
		return `Je n’ai trouvé aucune vente ${label}.`;
	}

	return `Sur ${label}, tu as enregistré ${summary.count} vente${summary.count > 1 ? 's' : ''} pour un total de ${formatMoney(summary.totalRevenue)} (encaissé ${formatMoney(summary.totalCollected)}).`;
}

export function formatBestProductReply(toolResult) {
	if (!toolResult.success) {
		return toolResult.error?.message || 'Je n’ai pas pu analyser tes produits vendus.';
	}

	const best = toolResult.data.summary.byProduct?.[0];
	const label = periodLabel(toolResult.meta);

	if (!best) {
		return `Je n’ai trouvé aucune vente ${label} pour identifier un produit leader.`;
	}

	return `${best.product} est ton produit le mieux vendu ${label}, avec ${formatMoney(best.revenue)} de chiffre d’affaires (${best.saleCount} vente${best.saleCount > 1 ? 's' : ''}).`;
}

export function formatCompareReply(results) {
	const [current, previous] = results;
	if (!current?.success || !previous?.success) {
		return 'Je n’ai pas pu comparer tes ventes sur les deux périodes demandées.';
	}

	const currentSummary = current.data.summary;
	const previousSummary = previous.data.summary;
	const delta = Number((currentSummary.totalRevenue - previousSummary.totalRevenue).toFixed(2));
	const direction = delta > 0 ? 'augmentation' : delta < 0 ? 'baisse' : 'stagnation';

	return `Comparaison des ventes : ${formatMoney(currentSummary.totalRevenue)} ${PERIOD_LABELS.current_month} contre ${formatMoney(previousSummary.totalRevenue)} ${PERIOD_LABELS.previous_month}. C’est une ${direction} de ${formatMoney(Math.abs(delta))}.`;
}

export function formatUnknownReply() {
	return 'Je peux t’aider sur tes ventes. Par exemple : « Combien ai-je vendu ce mois-ci ? »';
}

export function formatAshyReply(intent, payload) {
	switch (intent) {
	case 'query_sales':
		return formatSalesQueryReply(payload);
	case 'best_product':
		return formatBestProductReply(payload);
	case 'compare_sales':
		return formatCompareReply(payload);
	default:
		return formatUnknownReply();
	}
}
