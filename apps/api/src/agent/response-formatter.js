import { listToolDefinitions } from '../tools/registry.js';

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
	const [first, second] = results;
	if (!first?.success || !second?.success) {
		return 'Je n’ai pas pu comparer tes ventes sur les deux périodes demandées.';
	}

	const firstSummary = first.data.summary;
	const secondSummary = second.data.summary;
	const delta = Number((secondSummary.totalRevenue - firstSummary.totalRevenue).toFixed(2));
	const direction = delta > 0 ? 'augmentation' : delta < 0 ? 'baisse' : 'stagnation';

	return `Comparaison des ventes : ${formatMoney(firstSummary.totalRevenue)} ${periodLabel(first.meta)} contre ${formatMoney(secondSummary.totalRevenue)} ${periodLabel(second.meta)}. C’est une ${direction} de ${formatMoney(Math.abs(delta))}.`;
}

export function formatToolErrorReply(toolResult) {
	return toolResult?.error?.message
		|| 'Je n’ai pas pu récupérer tes données depuis Supabase. Réessaie dans un instant.';
}

export function formatUnimplementedTopicReply(toolName) {
	const labels = {
		get_expenses: 'tes dépenses',
		get_stock: 'ton stock',
		get_debts: 'tes dettes',
	};
	const subject = labels[toolName] || 'cette information';
	return `Je peux bientôt consulter ${subject} depuis Supabase. Pour l’instant, seules les ventes sont disponibles.`;
}

export function formatCapabilitiesReply() {
	const readable = listToolDefinitions()
		.filter((tool) => tool.access === 'read' && tool.implemented)
		.map((tool) => tool.name.replace(/^get_/, ''));
	const upcoming = ['dépenses', 'stock', 'dettes'];
	return `Je peux consulter tes ${readable.join(', ')} depuis Supabase. Bientôt aussi : ${upcoming.join(', ')}. Que veux-tu vérifier ?`;
}

const REPLY_FORMATTERS = {
	query_sales: formatSalesQueryReply,
	best_product: formatBestProductReply,
	compare_sales: formatCompareReply,
	tool_error: formatToolErrorReply,
	unimplemented_topic: (_payload, toolName) => formatUnimplementedTopicReply(toolName),
	unknown: formatCapabilitiesReply,
};

export function formatAshyReply(responseKind, payload, meta = {}) {
	const formatter = REPLY_FORMATTERS[responseKind] || REPLY_FORMATTERS.unknown;
	if (responseKind === 'unimplemented_topic') {
		return formatter(payload, meta.unimplementedTool);
	}
	return formatter(payload);
}
