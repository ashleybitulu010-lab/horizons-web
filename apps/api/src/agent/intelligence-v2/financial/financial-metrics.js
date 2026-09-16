import { isFiniteNumber, roundMoney } from './financial-precision.js';

/**
 * Canonical Ashy profit definition (cash-basis):
 * profit = totalCollected - expenses
 * Same as report-service buildActivitySummary / analysis-result-contract.
 */
export function computeProfit(totalCollected, expenses) {
	if (!isFiniteNumber(totalCollected) || !isFiniteNumber(expenses)) {
		return null;
	}
	return roundMoney(totalCollected - expenses);
}

export function buildSalesMetrics(summary) {
	if (!summary) {
		return {
			revenue: null,
			collected: null,
			salesCount: null,
			outstanding: null,
			hasData: false,
		};
	}

	const salesCount = summary.count ?? null;
	const revenue = summary.totalRevenue ?? null;
	const collected = summary.totalCollected ?? null;
	const outstanding = summary.totalOutstanding ?? null;
	const hasData = salesCount === 0
		? false
		: (isFiniteNumber(revenue) || isFiniteNumber(collected));

	return {
		revenue: isFiniteNumber(revenue) ? roundMoney(revenue) : null,
		collected: isFiniteNumber(collected) ? roundMoney(collected) : null,
		salesCount: isFiniteNumber(salesCount) ? salesCount : null,
		outstanding: isFiniteNumber(outstanding) ? roundMoney(outstanding) : null,
		hasData,
		noData: salesCount === 0,
	};
}

export function buildExpenseMetrics(summary) {
	if (!summary) {
		return {
			expenseTotal: null,
			expenseCount: null,
			hasData: false,
		};
	}

	const expenseCount = summary.count ?? null;
	const expenseTotal = summary.totalAmount ?? summary.totalExpenses ?? null;
	const hasData = expenseCount === 0
		? false
		: isFiniteNumber(expenseTotal);

	return {
		expenseTotal: isFiniteNumber(expenseTotal) ? roundMoney(expenseTotal) : null,
		expenseCount: isFiniteNumber(expenseCount) ? expenseCount : null,
		hasData,
		noData: expenseCount === 0,
	};
}

export function buildDebtMetrics(summary) {
	if (!summary) {
		return {
			totalRemaining: null,
			unpaidCount: null,
			hasData: false,
		};
	}

	return {
		totalRemaining: isFiniteNumber(summary.totalRemaining)
			? roundMoney(summary.totalRemaining)
			: null,
		unpaidCount: isFiniteNumber(summary.unpaidCount) ? summary.unpaidCount : null,
		hasData: isFiniteNumber(summary.totalRemaining),
	};
}

export function buildStockMetrics(summary) {
	if (!summary) {
		return { hasData: false };
	}

	return {
		count: summary.count ?? null,
		totalQuantity: summary.totalQuantity ?? null,
		lowStockCount: summary.lowStockCount ?? null,
		outOfStockCount: summary.outOfStockCount ?? null,
		hasData: isFiniteNumber(summary.count),
	};
}
