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

export function formatExpensesQueryReply(toolResult) {
	if (!toolResult.success) {
		return toolResult.error?.message || 'Je n’ai pas pu récupérer tes dépenses.';
	}

	const summary = toolResult.data.summary;
	const label = periodLabel(toolResult.meta);

	if (!summary.count) {
		return `Je n’ai trouvé aucune dépense ${label}.`;
	}

	return `Sur ${label}, tu as enregistré ${summary.count} dépense${summary.count > 1 ? 's' : ''} pour un total de ${formatMoney(summary.totalAmount)}.`;
}

export function formatCompareExpensesReply(results) {
	const [first, second] = results;
	if (!first?.success || !second?.success) {
		return 'Je n’ai pas pu comparer tes dépenses sur les deux périodes demandées.';
	}

	const firstSummary = first.data.summary;
	const secondSummary = second.data.summary;
	const delta = Number((secondSummary.totalAmount - firstSummary.totalAmount).toFixed(2));
	const direction = delta > 0 ? 'augmentation' : delta < 0 ? 'baisse' : 'stagnation';

	return `Comparaison des dépenses : ${formatMoney(firstSummary.totalAmount)} ${periodLabel(first.meta)} contre ${formatMoney(secondSummary.totalAmount)} ${periodLabel(second.meta)}. C’est une ${direction} de ${formatMoney(Math.abs(delta))}.`;
}

export function formatCompareSalesExpensesReply(results) {
	const [sales, expenses] = results;
	if (!sales?.success || !expenses?.success) {
		return 'Je n’ai pas pu comparer tes ventes et tes dépenses sur la période demandée.';
	}

	const salesTotal = sales.data.summary.totalRevenue;
	const expensesTotal = expenses.data.summary.totalAmount;
	const label = periodLabel(sales.meta);

	return `Sur ${label}, tu as ${formatMoney(salesTotal)} de ventes et ${formatMoney(expensesTotal)} de dépenses.`;
}

export function formatDebtsQueryReply(toolResult) {
	if (!toolResult.success) {
		return toolResult.error?.message || 'Je n’ai pas pu récupérer tes dettes.';
	}

	const summary = toolResult.data.summary;
	const label = periodLabel(toolResult.meta);
	const status = toolResult.meta?.status || 'unpaid';

	if (!summary.count) {
		if (status === 'settled') {
			return label && toolResult.meta?.period
				? `Je n’ai trouvé aucune dette réglée ${label}.`
				: 'Je n’ai trouvé aucune dette réglée.';
		}
		if (status === 'all') {
			return 'Je n’ai trouvé aucune dette enregistrée.';
		}
		return label && toolResult.meta?.period
			? `Je n’ai trouvé aucune dette impayée ${label}.`
			: 'Tu n’as aucune dette impayée enregistrée.';
	}

	if (status === 'settled') {
		return `Tu as ${summary.count} dette${summary.count > 1 ? 's' : ''} réglée${summary.count > 1 ? 's' : ''}${toolResult.meta?.period ? ` ${label}` : ''}.`;
	}

	if (status === 'all') {
		const periodSuffix = toolResult.meta?.period ? ` ${label}` : '';
		return `Tu as ${summary.count} dette${summary.count > 1 ? 's' : ''} enregistrée${summary.count > 1 ? 's' : ''}${periodSuffix}, dont ${summary.unpaidCount || 0} impayée${(summary.unpaidCount || 0) > 1 ? 's' : ''} pour ${formatMoney(summary.totalRemaining)}.`;
	}

	const periodSuffix = toolResult.meta?.period ? ` ${label}` : '';
	return `Tu as ${summary.unpaidCount || summary.count} dette${(summary.unpaidCount || summary.count) > 1 ? 's' : ''} impayée${(summary.unpaidCount || summary.count) > 1 ? 's' : ''}${periodSuffix}, pour un total de ${formatMoney(summary.totalRemaining)}.`;
}

export function formatClarificationReply(resolved) {
	return resolved?.clarificationQuestion || 'Peux-tu préciser ce que tu veux consulter ?';
}

export function formatStockQueryReply(toolResult) {
	if (!toolResult.success) {
		return toolResult.error?.message || 'Je n’ai pas pu récupérer ton stock.';
	}

	const summary = toolResult.data.summary;
	const product = toolResult.meta?.product;

	if (product) {
		const match = summary.items.find((item) => item.name.toLowerCase().includes(product.toLowerCase()));
		if (!match) {
			return `Je n’ai trouvé aucun stock pour « ${product} ».`;
		}
		return `Il te reste ${match.quantity} ${match.name}${match.quantity > 1 ? '' : ''} en stock.`;
	}

	if (!summary.count) {
		return 'Je n’ai trouvé aucun stock enregistré pour ton activité.';
	}

	return `Tu as ${summary.count} produit${summary.count > 1 ? 's' : ''} en stock pour un total de ${summary.totalQuantity} unité${summary.totalQuantity > 1 ? 's' : ''}.`;
}

export function formatLowStockReply(toolResult) {
	if (!toolResult.success) {
		return toolResult.error?.message || 'Je n’ai pas pu analyser ton stock.';
	}

	const summary = toolResult.data.summary;
	if (!summary.lowStockCount) {
		return 'Aucun produit n’est presque épuisé selon les seuils enregistrés.';
	}

	const names = summary.items
		.filter((item) => item.isLow)
		.slice(0, 5)
		.map((item) => `${item.name} (${item.quantity})`)
		.join(', ');

	return `${summary.lowStockCount} produit${summary.lowStockCount > 1 ? 's' : ''} ${summary.lowStockCount > 1 ? 'sont' : 'est'} presque épuisé${summary.lowStockCount > 1 ? 's' : ''} : ${names}.`;
}

export function formatToolErrorReply(toolResult) {
	return toolResult?.error?.message
		|| 'Je n’ai pas pu récupérer tes données depuis Supabase. Réessaie dans un instant.';
}

export function formatUnimplementedTopicReply(toolName) {
	const labels = {
		get_products: 'ton catalogue produits',
	};
	const subject = labels[toolName] || 'cette information';
	return `Je peux bientôt consulter ${subject} depuis Supabase. Pour l’instant, les ventes, les dépenses, le stock et les dettes sont disponibles.`;
}

export function formatUnimplementedWriteReply(toolName) {
	return `Je pourrai bientôt exécuter ${toolName} dans Supabase après validation. Cette action d’écriture n’est pas encore disponible.`;
}

export function formatCapabilitiesReply() {
	const readable = listToolDefinitions()
		.filter((tool) => tool.access === 'read' && tool.implemented)
		.map((tool) => tool.name.replace(/^get_/, ''));
	return `Je peux consulter tes ${readable.join(', ')} depuis Supabase. Que veux-tu vérifier ?`;
}

const REPLY_FORMATTERS = {
	query_sales: formatSalesQueryReply,
	query_expenses: formatExpensesQueryReply,
	query_stock: formatStockQueryReply,
	query_debts: formatDebtsQueryReply,
	low_stock: formatLowStockReply,
	best_product: formatBestProductReply,
	compare_sales: formatCompareReply,
	compare_expenses: formatCompareExpensesReply,
	compare_sales_expenses: formatCompareSalesExpensesReply,
	clarification: formatClarificationReply,
	tool_error: formatToolErrorReply,
	unimplemented_topic: (_payload, toolName) => formatUnimplementedTopicReply(toolName),
	unimplemented_write: (_payload, toolName) => formatUnimplementedWriteReply(toolName),
	unknown: formatCapabilitiesReply,
};

export function formatAshyReply(responseKind, payload, meta = {}) {
	const formatter = REPLY_FORMATTERS[responseKind] || REPLY_FORMATTERS.unknown;
	if (responseKind === 'unimplemented_topic' || responseKind === 'unimplemented_write') {
		return formatter(payload, meta.unimplementedTool);
	}
	if (responseKind === 'clarification') {
		return formatter(payload);
	}
	return formatter(payload);
}
