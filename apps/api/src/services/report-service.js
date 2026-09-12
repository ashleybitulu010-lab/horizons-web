import {
	fetchDebtsForUser,
	summarizeDebts,
} from './debts-service.js';
import {
	fetchExpensesForUser,
	summarizeExpenses,
} from './expenses-service.js';
import {
	fetchSalesForUser,
	summarizeSales,
} from './sales-service.js';
import {
	fetchStockForUser,
	summarizeStock,
} from './stock-service.js';
import { getBusinessScope } from './supabase-scoped.js';
import { resolveDateRange } from '../utils/periods.js';

export const REPORT_TYPE = 'activity_summary';

let composeReportImpl = null;

export function setComposeReportImplForTests(impl) {
	composeReportImpl = impl;
}

export function resetComposeReportImplForTests() {
	composeReportImpl = null;
}

function normalizeInput(input = {}) {
	return {
		period: input.period || null,
		startDate: input.startDate || null,
		endDate: input.endDate || null,
	};
}

function resolvePeriodInput(input) {
	const normalized = normalizeInput(input);
	if (normalized.period || (normalized.startDate && normalized.endDate)) {
		return normalized;
	}
	return { period: 'current_month' };
}

export function buildActivitySummary(salesSummary, expensesSummary, debtsSummary, stockSummary) {
	const totalCollected = salesSummary.totalCollected;
	const totalExpenses = expensesSummary.totalAmount;
	const estimatedProfit = Number((totalCollected - totalExpenses).toFixed(2));

	return {
		summary: {
			reportType: REPORT_TYPE,
			salesCount: salesSummary.count,
			totalRevenue: salesSummary.totalRevenue,
			totalCollected,
			expenseCount: expensesSummary.count,
			totalExpenses,
			estimatedProfit,
			unpaidDebtTotal: debtsSummary.totalRemaining,
			unpaidDebtCount: debtsSummary.unpaidCount,
			stockItemCount: stockSummary.count,
			lowStockCount: stockSummary.lowStockCount,
			outOfStockCount: stockSummary.outOfStockCount,
		},
		sections: {
			sales: {
				count: salesSummary.count,
				totalRevenue: salesSummary.totalRevenue,
				totalCollected,
			},
			expenses: {
				count: expensesSummary.count,
				totalAmount: expensesSummary.totalAmount,
			},
			debts: {
				unpaidCount: debtsSummary.unpaidCount,
				totalRemaining: debtsSummary.totalRemaining,
			},
			stock: {
				count: stockSummary.count,
				lowStockCount: stockSummary.lowStockCount,
				outOfStockCount: stockSummary.outOfStockCount,
			},
		},
	};
}

async function defaultComposeReport(user, rawInput = {}, referenceDate = new Date()) {
	getBusinessScope(user);
	const input = resolvePeriodInput(rawInput);
	const range = resolveDateRange(input, referenceDate);

	const [salesResult, expensesResult, debtsResult, stockResult] = await Promise.all([
		fetchSalesForUser(user, input, referenceDate),
		fetchExpensesForUser(user, input, referenceDate),
		fetchDebtsForUser(user, { status: 'unpaid' }, referenceDate),
		fetchStockForUser(user, {}),
	]);

	const salesSummary = summarizeSales(salesResult.rows);
	const expensesSummary = summarizeExpenses(expensesResult.rows);
	const debtsSummary = summarizeDebts(debtsResult.rows, 'unpaid');
	const stockSummary = summarizeStock(
		stockResult.rows,
		stockResult.products,
		stockResult.input,
	);

	return {
		...buildActivitySummary(salesSummary, expensesSummary, debtsSummary, stockSummary),
		range,
		input,
	};
}

export async function generateActivityReport(user, rawInput = {}, referenceDate = new Date()) {
	const compose = composeReportImpl || defaultComposeReport;
	return compose(user, rawInput, referenceDate);
}
