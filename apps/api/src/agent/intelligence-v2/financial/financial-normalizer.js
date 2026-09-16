import { buildDebtMetrics, buildExpenseMetrics, buildSalesMetrics, buildStockMetrics } from './financial-metrics.js';
import { MISSING_DATA_STATE } from './financial-contract.js';

const PERIOD_SUFFIXES = Object.freeze({
	current: ['current', '_current'],
	previous: ['previous', '_previous'],
});

function detectPeriodSide(stepId, metaPeriod) {
	const id = String(stepId || '').toLowerCase();
	if (id.includes('previous') || metaPeriod === 'previous_month' || metaPeriod === 'previous_week') {
		return 'previous';
	}
	if (id.includes('current') || metaPeriod === 'current_month' || metaPeriod === 'current_week') {
		return 'current';
	}
	return 'current';
}

function buildPeriodInfo(stepResult) {
	const meta = stepResult?.toolResult?.meta || stepResult?.meta || {};
	return {
		label: stepResult?.arguments?.period || meta.period || null,
		start: meta.startDate || null,
		end: meta.endDate || null,
		timeZone: meta.timeZone || null,
	};
}

/**
 * Normalize stepResults into period-scoped financial records.
 * Works from executor stepResults — no DB access.
 */
export function normalizeStepResults(stepResults = []) {
	const buckets = {
		sales: { current: null, previous: null },
		expenses: { current: null, previous: null },
		debts: { current: null, previous: null },
		stock: { current: null, previous: null },
		products: { current: null, previous: null },
		report: { current: null, previous: null },
	};

	const evidence = [];
	const stepIndex = {};

	for (const step of stepResults) {
		const side = detectPeriodSide(step.stepId, step.arguments?.period);
		const period = buildPeriodInfo(step);
		const status = step.status;
		const tool = step.tool;
		const summary = step.summary || step.data?.summary || step.toolResult?.data?.summary || null;

		evidence.push({
			stepId: step.stepId,
			tool,
			status,
			period,
		});

		if (!stepIndex[tool]) stepIndex[tool] = {};
		if (!stepIndex[tool][side]) stepIndex[tool][side] = [];
		stepIndex[tool][side].push(step.stepId);

		if (status !== 'SUCCESS' && status !== 'NO_DATA') {
			continue;
		}

		if (tool === 'get_sales') {
			buckets.sales[side] = {
				...buildSalesMetrics(summary),
				period,
				stepId: step.stepId,
				products: summary?.byProduct || [],
				dataState: summary?.count === 0 ? MISSING_DATA_STATE.NO_DATA : null,
			};
		}

		if (tool === 'get_expenses') {
			buckets.expenses[side] = {
				...buildExpenseMetrics(summary),
				period,
				stepId: step.stepId,
				categories: summary?.byCategory || [],
				dataState: summary?.count === 0 ? MISSING_DATA_STATE.NO_DATA : null,
			};
		}

		if (tool === 'get_debts') {
			buckets.debts[side] = {
				...buildDebtMetrics(summary),
				period,
				stepId: step.stepId,
			};
		}

		if (tool === 'get_stock') {
			buckets.stock[side] = {
				...buildStockMetrics(summary),
				period,
				stepId: step.stepId,
			};
		}

		if (tool === 'get_products') {
			const productList = step.data?.products || summary?.products || [];
			const count = summary?.count ?? (Array.isArray(productList) ? productList.length : null);
			buckets.products[side] = {
				count,
				products: productList,
				period,
				stepId: step.stepId,
				noData: count === 0,
			};
		}

		if (tool === 'generate_report') {
			buckets.report[side] = {
				revenue: summary?.totalRevenue ?? null,
				collected: summary?.totalCollected ?? null,
				expenseTotal: summary?.totalExpenses ?? null,
				profit: summary?.estimatedProfit ?? null,
				unpaidDebtTotal: summary?.unpaidDebtTotal ?? null,
				period,
				stepId: step.stepId,
			};
		}
	}

	return {
		buckets,
		evidence,
		stepIndex,
	};
}

export function resolveCollectedValue(salesBucket, reportBucket) {
	if (salesBucket?.collected != null) return salesBucket.collected;
	if (reportBucket?.collected != null) return reportBucket.collected;
	return null;
}

export function resolveExpenseValue(expensesBucket, reportBucket) {
	if (expensesBucket?.expenseTotal != null) return expensesBucket.expenseTotal;
	if (reportBucket?.expenseTotal != null) return reportBucket.expenseTotal;
	return null;
}

export function resolveRevenueValue(salesBucket, reportBucket) {
	if (salesBucket?.revenue != null) return salesBucket.revenue;
	if (reportBucket?.revenue != null) return reportBucket.revenue;
	return null;
}
