import { buildPeriodComparison } from './comparison-contract.js';
import { buildPeriodSpecFromLegacyId } from './period-contract.js';
import { createEmptyGoal, validateGoal } from './goal-contract.js';

function comparisonFromLegacyPeriods(periods, metric) {
	if (!Array.isArray(periods) || periods.length < 2) {
		return null;
	}

	const left = buildPeriodSpecFromLegacyId(periods[0]);
	const right = buildPeriodSpecFromLegacyId(periods[1]);
	if (!left || !right) {
		return null;
	}

	return buildPeriodComparison(left, right, metric);
}

/**
 * Map a legacy ResolvedIntent (Ashy 1.x) to a normalized Goal.
 * Pure function — no side effects.
 */
export function mapLegacyIntentToGoal(resolved, referenceDate = new Date()) {
	if (!resolved?.intent) {
		return validateGoal(createEmptyGoal());
	}

	const intent = resolved.intent;
	const filters = resolved.filters || {};
	const references = resolved.references || {};

	let goalDraft = createEmptyGoal();

	switch (intent) {
	case 'query_sales':
		goalDraft = {
			type: 'QUESTION',
			domain: 'SALES',
			objective: 'RETRIEVE',
			period: filters.period
				? buildPeriodSpecFromLegacyId(filters.period, referenceDate)
				: null,
			comparison: null,
			activityReference: references.activityReference || null,
			parameters: filters.product ? { product: filters.product } : {},
		};
		break;

	case 'query_expenses':
		goalDraft = {
			type: 'QUESTION',
			domain: 'EXPENSES',
			objective: 'RETRIEVE',
			period: filters.period
				? buildPeriodSpecFromLegacyId(filters.period, referenceDate)
				: null,
			comparison: null,
			activityReference: references.activityReference || null,
			parameters: filters.category ? { category: filters.category } : {},
		};
		break;

	case 'query_stock':
		goalDraft = {
			type: 'QUESTION',
			domain: 'STOCK',
			objective: 'RETRIEVE',
			period: null,
			comparison: null,
			activityReference: references.activityReference || null,
			parameters: {
				...(filters.product ? { product: filters.product } : {}),
				...(filters.lowStockOnly ? { lowStockOnly: true } : {}),
			},
		};
		break;

	case 'query_debts':
		goalDraft = {
			type: 'QUESTION',
			domain: 'DEBTS',
			objective: 'RETRIEVE',
			period: filters.period
				? buildPeriodSpecFromLegacyId(filters.period, referenceDate)
				: null,
			comparison: null,
			activityReference: references.activityReference || null,
			parameters: {
				...(filters.status ? { status: filters.status } : {}),
				...(filters.debtor ? { debtor: filters.debtor } : {}),
			},
		};
		break;

	case 'query_products':
		goalDraft = {
			type: 'QUESTION',
			domain: 'PRODUCTS',
			objective: 'RETRIEVE',
			period: null,
			comparison: null,
			activityReference: references.activityReference || null,
			parameters: {
				...(filters.product ? { product: filters.product } : {}),
				...(filters.category ? { category: filters.category } : {}),
			},
		};
		break;

	case 'compare_sales':
		goalDraft = {
			type: 'ANALYSIS',
			domain: 'SALES',
			objective: 'COMPARE',
			period: null,
			comparison: comparisonFromLegacyPeriods(filters.periods, 'REVENUE'),
			activityReference: references.activityReference || null,
			parameters: {},
		};
		break;

	case 'compare_expenses':
		goalDraft = {
			type: 'ANALYSIS',
			domain: 'EXPENSES',
			objective: 'COMPARE',
			period: null,
			comparison: comparisonFromLegacyPeriods(filters.periods, 'EXPENSES'),
			activityReference: references.activityReference || null,
			parameters: {},
		};
		break;

	case 'compare_sales_expenses':
		goalDraft = {
			type: 'ANALYSIS',
			domain: 'PROFIT',
			objective: 'COMPARE',
			period: filters.period
				? buildPeriodSpecFromLegacyId(filters.period, referenceDate)
				: null,
			comparison: null,
			activityReference: references.activityReference || null,
			parameters: {},
		};
		break;

	case 'best_product':
		goalDraft = {
			type: 'QUESTION',
			domain: 'PRODUCTS',
			objective: 'RETRIEVE',
			period: filters.period
				? buildPeriodSpecFromLegacyId(filters.period, referenceDate)
				: null,
			comparison: null,
			activityReference: references.activityReference || null,
			parameters: { ranking: 'best_seller' },
		};
		break;

	case 'generate_report':
		goalDraft = {
			type: 'ANALYSIS',
			domain: 'PROFIT',
			objective: 'SUMMARIZE',
			period: filters.period
				? buildPeriodSpecFromLegacyId(filters.period, referenceDate)
				: null,
			comparison: null,
			activityReference: references.activityReference || null,
			parameters: {},
		};
		break;

	case 'create_sale':
		goalDraft = {
			type: 'ACTION',
			domain: 'SALES',
			objective: 'CREATE',
			period: null,
			comparison: null,
			activityReference: references.activityReference || null,
			parameters: {
				product: filters.product ?? null,
				quantity: filters.quantity ?? null,
				unitPrice: filters.unitPrice ?? null,
				amountPaid: filters.amountPaid ?? null,
				confirmed: Boolean(filters.confirmed),
			},
		};
		break;

	case 'create_expense':
		goalDraft = {
			type: 'ACTION',
			domain: 'EXPENSES',
			objective: 'CREATE',
			period: null,
			comparison: null,
			activityReference: references.activityReference || null,
			parameters: {
				label: filters.label ?? null,
				amount: filters.amount ?? null,
				confirmed: Boolean(filters.confirmed),
			},
		};
		break;

	case 'unknown':
	default:
		goalDraft = {
			type: 'QUESTION',
			domain: 'GENERAL',
			objective: 'RETRIEVE',
			period: null,
			comparison: null,
			activityReference: references.activityReference || null,
			parameters: {},
		};
		break;
	}

	return validateGoal(goalDraft, { rejectWriteExecution: true });
}
