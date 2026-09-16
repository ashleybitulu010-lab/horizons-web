/**
 * Evidence-first planning — maps Goals to required data fetches.
 * The planner asks "what evidence do I need?" before choosing tools.
 */

export const EVIDENCE_TYPES = Object.freeze([
	'sales_period',
	'sales_comparison',
	'expenses_period',
	'expenses_comparison',
	'stock_snapshot',
	'products_catalog',
	'debts_snapshot',
	'activity_summary',
	'expense_write_proposal',
	'sale_write_proposal',
]);

const PREVIOUS_PERIOD_MAP = Object.freeze({
	current_month: 'previous_month',
	current_week: 'previous_week',
	today: 'yesterday',
	current_year: 'previous_month',
});

export function inferPreviousLegacyPeriod(legacyPeriodId) {
	return PREVIOUS_PERIOD_MAP[legacyPeriodId] || 'previous_month';
}

/**
 * Determine required evidence keys for a normalized Goal.
 * Returns null when the goal cannot be planned.
 */
export function requiredEvidenceForGoal(goal) {
	if (!goal?.type || !goal?.domain || !goal?.objective) {
		return null;
	}

	const { type, domain, objective, parameters } = goal;

	if (type === 'ACTION' && objective === 'CREATE') {
		if (domain === 'EXPENSES') return ['expense_write_proposal'];
		if (domain === 'SALES') return ['sale_write_proposal'];
		return null;
	}

	if (type === 'MIXED') {
		return null;
	}

	if (type === 'QUESTION' && objective === 'RETRIEVE') {
		if (domain === 'SALES') return ['sales_period'];
		if (domain === 'EXPENSES') return ['expenses_period'];
		if (domain === 'STOCK') return ['stock_snapshot'];
		if (domain === 'PRODUCTS') {
			if (parameters?.ranking === 'best_seller') return ['sales_period'];
			return ['products_catalog'];
		}
		if (domain === 'DEBTS') return ['debts_snapshot'];
		if (domain === 'PROFIT') return ['sales_period', 'expenses_period'];
		if (domain === 'GENERAL') return null;
		return null;
	}

	if (type === 'ANALYSIS' && objective === 'SUMMARIZE') {
		if (domain === 'PROFIT' || domain === 'GENERAL') return ['activity_summary'];
		return null;
	}

	if (type === 'ANALYSIS' && objective === 'COMPARE') {
		if (domain === 'SALES') return ['sales_period', 'sales_comparison'];
		if (domain === 'EXPENSES') return ['expenses_period', 'expenses_comparison'];
		if (domain === 'PROFIT') {
			if (goal.comparison?.enabled && goal.comparison.leftPeriod && goal.comparison.rightPeriod) {
				return [
					'sales_period',
					'sales_comparison',
					'expenses_period',
					'expenses_comparison',
				];
			}
			return ['sales_period', 'expenses_period'];
		}
		if (domain === 'GENERAL' && goal.comparison?.leftActivityReference) {
			return null;
		}
		return null;
	}

	if (type === 'ANALYSIS' && objective === 'EXPLAIN') {
		if (domain === 'PROFIT') {
			return [
				'sales_period',
				'sales_comparison',
				'expenses_period',
				'expenses_comparison',
			];
		}
		if (domain === 'EXPENSES') {
			return ['expenses_period', 'expenses_comparison'];
		}
		if (domain === 'SALES') {
			return ['sales_period', 'sales_comparison'];
		}
		return null;
	}

	return null;
}
