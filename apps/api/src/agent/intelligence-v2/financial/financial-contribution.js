import { roundMoney } from './financial-precision.js';

export const DRIVER_DIRECTION = Object.freeze({
	POSITIVE: 'POSITIVE',
	NEGATIVE: 'NEGATIVE',
	NEUTRAL: 'NEUTRAL',
});

export const INTERPRETATION_TYPES = Object.freeze({
	EXPENSE_INCREASE_OUTWEIGHED_REVENUE_INCREASE: 'EXPENSE_INCREASE_OUTWEIGHED_REVENUE_INCREASE',
	REVENUE_INCREASE_OUTWEIGHED_EXPENSE_INCREASE: 'REVENUE_INCREASE_OUTWEIGHED_EXPENSE_INCREASE',
	REVENUE_DECLINE: 'REVENUE_DECLINE',
	EXPENSE_DECLINE: 'EXPENSE_DECLINE',
	MIXED_CHANGES: 'MIXED_CHANGES',
	INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
});

function resolveDriverType(metric, delta) {
	if (metric === 'revenue') {
		return delta >= 0 ? 'REVENUE_INCREASE' : 'REVENUE_DECREASE';
	}
	if (metric === 'expenses') {
		return delta >= 0 ? 'EXPENSE_INCREASE' : 'EXPENSE_DECREASE';
	}
	if (metric === 'profit') {
		return delta >= 0 ? 'PROFIT_INCREASE' : 'PROFIT_DECREASE';
	}
	return 'OTHER';
}

function resolveDirection(impact) {
	if (impact > 0) return DRIVER_DIRECTION.POSITIVE;
	if (impact < 0) return DRIVER_DIRECTION.NEGATIVE;
	return DRIVER_DIRECTION.NEUTRAL;
}

/**
 * Build deterministic profit drivers from observed metric changes.
 * Uses accounting identity: Δprofit ≈ Δrevenue - Δexpenses (cash profit basis uses collected).
 * Does NOT assign causal percentages.
 */
export function buildProfitDrivers({
	revenueComparison,
	expenseComparison,
	profitComparison,
	sourceSteps = {},
}) {
	const drivers = [];

	if (revenueComparison?.absoluteChange != null) {
		const impact = roundMoney(revenueComparison.absoluteChange);
		drivers.push({
			type: resolveDriverType('revenue', impact),
			metric: 'revenue',
			label: impact >= 0 ? 'Revenue increase' : 'Revenue decrease',
			direction: resolveDirection(impact),
			absoluteImpact: impact,
			currentValue: revenueComparison.current,
			previousValue: revenueComparison.previous,
			delta: impact,
			contribution: impact,
			sourceSteps: sourceSteps.revenue || [],
		});
	}

	if (expenseComparison?.absoluteChange != null) {
		const expenseDelta = roundMoney(expenseComparison.absoluteChange);
		const impact = roundMoney(-expenseDelta);
		drivers.push({
			type: resolveDriverType('expenses', expenseDelta),
			metric: 'expenses',
			label: expenseDelta >= 0 ? 'Expense increase' : 'Expense decrease',
			direction: resolveDirection(impact),
			absoluteImpact: impact,
			currentValue: expenseComparison.current,
			previousValue: expenseComparison.previous,
			delta: expenseDelta,
			contribution: impact,
			sourceSteps: sourceSteps.expenses || [],
		});
	}

	drivers.sort((a, b) => Math.abs(b.absoluteImpact) - Math.abs(a.absoluteImpact));

	const interpretations = [];
	if (revenueComparison && expenseComparison && profitComparison) {
		const revUp = (revenueComparison.absoluteChange ?? 0) > 0;
		const expUp = (expenseComparison.absoluteChange ?? 0) > 0;
		const profitDown = (profitComparison.absoluteChange ?? 0) < 0;

		if (revUp && expUp && profitDown) {
			interpretations.push(INTERPRETATION_TYPES.EXPENSE_INCREASE_OUTWEIGHED_REVENUE_INCREASE);
		} else if (revUp && !expUp && (profitComparison.absoluteChange ?? 0) > 0) {
			interpretations.push(INTERPRETATION_TYPES.REVENUE_INCREASE_OUTWEIGHED_EXPENSE_INCREASE);
		} else if ((revenueComparison.absoluteChange ?? 0) < 0) {
			interpretations.push(INTERPRETATION_TYPES.REVENUE_DECLINE);
		} else if ((expenseComparison.absoluteChange ?? 0) < 0) {
			interpretations.push(INTERPRETATION_TYPES.EXPENSE_DECLINE);
		} else {
			interpretations.push(INTERPRETATION_TYPES.MIXED_CHANGES);
		}
	}

	return { drivers, interpretations };
}
