import { validateAnalysisResult } from '../analysis-result-contract.js';
import { compareMetric } from './financial-comparison.js';
import { buildProfitDrivers } from './financial-contribution.js';
import {
	createEmptyFinancialAnalysis,
	FINANCIAL_ANALYSIS_STATUS,
	FINANCIAL_ANALYSIS_TYPES,
	MISSING_DATA_STATE,
} from './financial-contract.js';
import { computeProfit } from './financial-metrics.js';
import {
	normalizeStepResults,
	resolveCollectedValue,
	resolveExpenseValue,
	resolveRevenueValue,
} from './financial-normalizer.js';
import { roundMoney } from './financial-precision.js';
import { computeExpenseToRevenueRatio, computeProfitMargin } from './financial-ratios.js';
import {
	validateCurrencyCompatibility,
	validatePeriodCompatibility,
} from './financial-validation.js';

function hasExecutionFailure(stepResults) {
	return stepResults.some((s) => (
		s.status === 'EXECUTION_ERROR'
		|| s.status === 'TIMEOUT'
		|| s.status === 'BLOCKED'
		|| s.status === 'PLAN_TIMEOUT'
	));
}

function buildLegacyMetrics(currentCollected, currentExpenses, currentRevenue, previousCollected, previousExpenses, previousRevenue) {
	const currentProfit = computeProfit(currentCollected, currentExpenses);
	const previousProfit = computeProfit(previousCollected, previousExpenses);

	return {
		revenue: currentRevenue,
		totalCollected: currentCollected,
		expenses: currentExpenses,
		profit: currentProfit,
		previousRevenue: previousRevenue,
		previousCollected: previousCollected,
		previousExpenses,
		previousProfit,
	};
}

function toAnalysisDrivers(financialDrivers) {
	return financialDrivers.map((d) => ({
		type: d.type,
		label: d.label,
		currentValue: d.currentValue,
		previousValue: d.previousValue,
		delta: d.delta,
		contribution: d.contribution,
	}));
}

function analyzeProfitExplanation({ goal, normalized, stepResults, partial }) {
	const analysis = createEmptyFinancialAnalysis('PROFIT');
	analysis.analysisType = FINANCIAL_ANALYSIS_TYPES.EXPLANATION;

	const salesCurrent = normalized.buckets.sales.current;
	const salesPrevious = normalized.buckets.sales.previous;
	const expensesCurrent = normalized.buckets.expenses.current;
	const expensesPrevious = normalized.buckets.expenses.previous;
	const reportCurrent = normalized.buckets.report.current;

	const currentRevenue = resolveRevenueValue(salesCurrent, reportCurrent);
	const previousRevenue = resolveRevenueValue(salesPrevious, null);
	const currentCollected = resolveCollectedValue(salesCurrent, reportCurrent);
	const previousCollected = resolveCollectedValue(salesPrevious, null);
	const currentExpenses = resolveExpenseValue(expensesCurrent, reportCurrent);
	const previousExpenses = resolveExpenseValue(expensesPrevious, null);

	analysis.periods.current = salesCurrent?.period || expensesCurrent?.period || null;
	analysis.periods.previous = salesPrevious?.period || expensesPrevious?.period || null;

	const periodCheck = validatePeriodCompatibility(analysis.periods.current, analysis.periods.previous);
	if (periodCheck.warning) analysis.limitations.push(periodCheck.warning);
	if (periodCheck.valid === false) {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.INVALID_INPUT;
		analysis.limitations.push(periodCheck.message);
		return analysis;
	}

	const currencyCheck = validateCurrencyCompatibility(
		analysis.periods.current,
		analysis.periods.previous,
	);
	if (!currencyCheck.valid) {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.INVALID_INPUT;
		analysis.limitations.push(currencyCheck.message);
		return analysis;
	}

	const currentProfit = computeProfit(currentCollected, currentExpenses);
	const previousProfit = computeProfit(previousCollected, previousExpenses);

	analysis.metrics = {
		revenue: { current: currentRevenue, previous: previousRevenue },
		collected: { current: currentCollected, previous: previousCollected },
		expenses: { current: currentExpenses, previous: previousExpenses },
		profit: { current: currentProfit, previous: previousProfit },
	};

	const revenueComparison = compareMetric(currentRevenue, previousRevenue);
	const expenseComparison = compareMetric(currentExpenses, previousExpenses);
	const profitComparison = compareMetric(currentProfit, previousProfit);
	const collectedComparison = compareMetric(currentCollected, previousCollected);

	analysis.comparisons = {
		revenue: revenueComparison,
		expenses: expenseComparison,
		profit: profitComparison,
		collected: collectedComparison,
	};

	const marginCurrent = computeProfitMargin(currentProfit, currentRevenue);
	const marginPrevious = computeProfitMargin(previousProfit, previousRevenue);
	analysis.ratios = {
		profitMargin: {
			current: marginCurrent,
			previous: marginPrevious,
		},
		expenseToRevenueRatio: {
			current: computeExpenseToRevenueRatio(currentExpenses, currentRevenue),
			previous: computeExpenseToRevenueRatio(previousExpenses, previousRevenue),
		},
	};

	analysis.facts = [
		{ key: 'revenueChange', value: revenueComparison.absoluteChange },
		{ key: 'revenueChangePercent', value: revenueComparison.percentageChange },
		{ key: 'expenseChange', value: expenseComparison.absoluteChange },
		{ key: 'expenseChangePercent', value: expenseComparison.percentageChange },
		{ key: 'profitChange', value: profitComparison.absoluteChange },
		{ key: 'profitChangePercent', value: profitComparison.percentageChange },
	];

	const sourceSteps = {
		revenue: [
			...(normalized.stepIndex.get_sales?.current || []),
			...(normalized.stepIndex.get_sales?.previous || []),
		],
		expenses: [
			...(normalized.stepIndex.get_expenses?.current || []),
			...(normalized.stepIndex.get_expenses?.previous || []),
		],
	};

	const { drivers, interpretations } = buildProfitDrivers({
		revenueComparison,
		expenseComparison,
		profitComparison,
		sourceSteps,
	});

	analysis.drivers = drivers;
	analysis.interpretations = interpretations;
	analysis.evidence = normalized.evidence;
	analysis.sourceSteps = stepResults.map((s) => s.stepId);
	analysis.partial = partial;

	if (salesCurrent?.noData && salesPrevious?.noData) {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.NO_DATA;
		analysis.limitations.push(MISSING_DATA_STATE.NO_DATA);
	} else if (partial || hasExecutionFailure(stepResults)) {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.PARTIAL;
	} else if (
		currentCollected == null
		|| previousCollected == null
		|| currentExpenses == null
		|| previousExpenses == null
	) {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.PARTIAL;
		analysis.limitations.push(MISSING_DATA_STATE.NOT_AVAILABLE);
	} else {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.COMPLETE;
	}

	analysis.diagnostics.metricCount = Object.keys(analysis.metrics).length;
	analysis.diagnostics.driverCount = analysis.drivers.length;

	return analysis;
}

function analyzeSalesRetrieve({ normalized, stepResults, partial }) {
	const analysis = createEmptyFinancialAnalysis('SALES');
	analysis.analysisType = FINANCIAL_ANALYSIS_TYPES.RETRIEVE;
	const current = normalized.buckets.sales.current;

	if (!current) {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.UNAVAILABLE;
		analysis.limitations.push(MISSING_DATA_STATE.NOT_AVAILABLE);
		return analysis;
	}

	analysis.metrics = {
		revenue: current.revenue,
		collected: current.collected,
		salesCount: current.salesCount,
	};
	analysis.periods.current = current.period;
	analysis.evidence = normalized.evidence;
	analysis.sourceSteps = stepResults.map((s) => s.stepId);
	analysis.partial = partial;
	analysis.status = current.noData
		? FINANCIAL_ANALYSIS_STATUS.NO_DATA
		: FINANCIAL_ANALYSIS_STATUS.COMPLETE;

	if (current.products?.length) {
		const top = [...current.products].sort((a, b) => (b.revenue || 0) - (a.revenue || 0))[0];
		analysis.metrics.topProduct = top || null;
	}

	return analysis;
}

function analyzeProfitRetrieve({ normalized, stepResults, partial }) {
	const analysis = createEmptyFinancialAnalysis('PROFIT');
	analysis.analysisType = FINANCIAL_ANALYSIS_TYPES.RETRIEVE;

	const salesCurrent = normalized.buckets.sales.current;
	const expensesCurrent = normalized.buckets.expenses.current;
	const reportCurrent = normalized.buckets.report.current;

	const currentCollected = resolveCollectedValue(salesCurrent, reportCurrent);
	const currentExpenses = resolveExpenseValue(expensesCurrent, reportCurrent);
	const currentRevenue = resolveRevenueValue(salesCurrent, reportCurrent);
	const currentProfit = reportCurrent?.profit != null
		? roundMoney(reportCurrent.profit)
		: computeProfit(currentCollected, currentExpenses);

	analysis.periods.current = salesCurrent?.period
		|| expensesCurrent?.period
		|| reportCurrent?.period
		|| null;
	analysis.evidence = normalized.evidence;
	analysis.sourceSteps = stepResults.map((s) => s.stepId);
	analysis.partial = partial;

	const salesEmpty = salesCurrent?.noData || (salesCurrent == null && reportCurrent == null);
	const expensesEmpty = expensesCurrent?.noData || (expensesCurrent == null && reportCurrent == null);

	if (salesEmpty && expensesEmpty) {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.NO_DATA;
		analysis.limitations.push(MISSING_DATA_STATE.NO_DATA);
		return analysis;
	}

	analysis.metrics = {
		revenue: currentRevenue,
		collected: currentCollected,
		expenses: currentExpenses,
		profit: currentProfit,
	};

	if (partial || hasExecutionFailure(stepResults)) {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.PARTIAL;
	} else if (currentProfit == null && currentCollected == null && currentExpenses == null) {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.NO_DATA;
		analysis.limitations.push(MISSING_DATA_STATE.NO_DATA);
	} else {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.COMPLETE;
	}

	analysis.diagnostics.metricCount = Object.keys(analysis.metrics).length;
	return analysis;
}

function analyzeActivitySummary({ goal, normalized, stepResults, partial }) {
	const analysis = createEmptyFinancialAnalysis(goal?.domain || 'GENERAL');
	analysis.analysisType = FINANCIAL_ANALYSIS_TYPES.SUMMARY;

	const reportCurrent = normalized.buckets.report.current;
	const salesCurrent = normalized.buckets.sales.current;
	const expensesCurrent = normalized.buckets.expenses.current;

	const collected = resolveCollectedValue(salesCurrent, reportCurrent);
	const expenses = resolveExpenseValue(expensesCurrent, reportCurrent);
	const revenue = resolveRevenueValue(salesCurrent, reportCurrent);
	const profit = reportCurrent?.profit != null
		? roundMoney(reportCurrent.profit)
		: computeProfit(collected, expenses);

	analysis.periods.current = reportCurrent?.period
		|| salesCurrent?.period
		|| expensesCurrent?.period
		|| null;
	analysis.evidence = normalized.evidence;
	analysis.sourceSteps = stepResults.map((s) => s.stepId);
	analysis.partial = partial;

	if (!reportCurrent && !salesCurrent && !expensesCurrent) {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.UNAVAILABLE;
		analysis.limitations.push(MISSING_DATA_STATE.NOT_AVAILABLE);
		return analysis;
	}

	analysis.metrics = {
		revenue,
		collected,
		expenses,
		profit,
	};

	const noFinancialData = (collected == null || collected === 0)
		&& (expenses == null || expenses === 0)
		&& (revenue == null || revenue === 0)
		&& profit == null;

	if (noFinancialData) {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.NO_DATA;
		analysis.limitations.push(MISSING_DATA_STATE.NO_DATA);
	} else if (partial || hasExecutionFailure(stepResults)) {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.PARTIAL;
	} else {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.COMPLETE;
	}

	analysis.diagnostics.metricCount = Object.keys(analysis.metrics).length;
	return analysis;
}

function analyzeExpensesRetrieve({ normalized, stepResults, partial }) {
	const analysis = createEmptyFinancialAnalysis('EXPENSES');
	analysis.analysisType = FINANCIAL_ANALYSIS_TYPES.RETRIEVE;
	const current = normalized.buckets.expenses.current;

	if (!current) {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.UNAVAILABLE;
		analysis.limitations.push(MISSING_DATA_STATE.NOT_AVAILABLE);
		return analysis;
	}

	analysis.metrics = {
		expenses: current.expenseTotal,
		expenseCount: current.expenseCount,
	};
	analysis.periods.current = current.period;
	analysis.evidence = normalized.evidence;
	analysis.sourceSteps = stepResults.map((s) => s.stepId);
	analysis.partial = partial;
	analysis.status = current.noData
		? FINANCIAL_ANALYSIS_STATUS.NO_DATA
		: FINANCIAL_ANALYSIS_STATUS.COMPLETE;

	return analysis;
}

function analyzeSalesCompare({ normalized, stepResults, partial }) {
	const analysis = createEmptyFinancialAnalysis('SALES');
	analysis.analysisType = FINANCIAL_ANALYSIS_TYPES.COMPARISON;

	const current = normalized.buckets.sales.current;
	const previous = normalized.buckets.sales.previous;

	if (!current && !previous) {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.UNAVAILABLE;
		analysis.limitations.push(MISSING_DATA_STATE.NOT_AVAILABLE);
		return analysis;
	}

	const currentEmpty = current?.noData || current?.salesCount === 0;
	const previousEmpty = previous?.noData || previous?.salesCount === 0;

	if (currentEmpty && previousEmpty) {
		analysis.periods.current = current?.period || null;
		analysis.periods.previous = previous?.period || null;
		analysis.evidence = normalized.evidence;
		analysis.sourceSteps = stepResults.map((s) => s.stepId);
		analysis.partial = partial;
		analysis.status = FINANCIAL_ANALYSIS_STATUS.NO_DATA;
		analysis.limitations.push(MISSING_DATA_STATE.NO_DATA);
		return analysis;
	}

	const currentRevenue = current?.revenue ?? current?.collected ?? null;
	const previousRevenue = previous?.revenue ?? previous?.collected ?? null;

	analysis.metrics = {
		revenue: { current: currentRevenue, previous: previousRevenue },
		salesCount: {
			current: current?.salesCount ?? null,
			previous: previous?.salesCount ?? null,
		},
	};
	analysis.comparisons = {
		revenue: compareMetric(currentRevenue, previousRevenue),
	};
	analysis.periods.current = current?.period || null;
	analysis.periods.previous = previous?.period || null;
	analysis.evidence = normalized.evidence;
	analysis.sourceSteps = stepResults.map((s) => s.stepId);
	analysis.partial = partial;
	analysis.status = partial
		? FINANCIAL_ANALYSIS_STATUS.PARTIAL
		: FINANCIAL_ANALYSIS_STATUS.COMPLETE;

	return analysis;
}

function analyzeExpensesCompare({ normalized, stepResults, partial }) {
	const analysis = createEmptyFinancialAnalysis('EXPENSES');
	analysis.analysisType = FINANCIAL_ANALYSIS_TYPES.COMPARISON;

	const current = normalized.buckets.expenses.current;
	const previous = normalized.buckets.expenses.previous;

	if (!current && !previous) {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.UNAVAILABLE;
		return analysis;
	}

	const currentTotal = current?.expenseTotal ?? null;
	const previousTotal = previous?.expenseTotal ?? null;

	analysis.metrics = {
		expenses: { current: currentTotal, previous: previousTotal },
	};
	analysis.comparisons = {
		expenses: compareMetric(currentTotal, previousTotal),
	};
	analysis.periods.current = current?.period || null;
	analysis.periods.previous = previous?.period || null;
	analysis.evidence = normalized.evidence;
	analysis.sourceSteps = stepResults.map((s) => s.stepId);
	analysis.partial = partial;
	analysis.status = partial
		? FINANCIAL_ANALYSIS_STATUS.PARTIAL
		: FINANCIAL_ANALYSIS_STATUS.COMPLETE;

	return analysis;
}

function analyzeDebts({ normalized, stepResults, partial }) {
	const analysis = createEmptyFinancialAnalysis('DEBTS');
	analysis.analysisType = FINANCIAL_ANALYSIS_TYPES.SUMMARY;
	const current = normalized.buckets.debts.current;

	if (!current?.hasData) {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.UNAVAILABLE;
		analysis.limitations.push(MISSING_DATA_STATE.NOT_AVAILABLE);
		return analysis;
	}

	analysis.metrics = {
		totalRemaining: current.totalRemaining,
		unpaidCount: current.unpaidCount,
	};
	analysis.evidence = normalized.evidence;
	analysis.sourceSteps = stepResults.map((s) => s.stepId);
	analysis.partial = partial;
	analysis.status = FINANCIAL_ANALYSIS_STATUS.COMPLETE;
	return analysis;
}

function analyzeProductsRetrieve({ normalized, stepResults, partial }) {
	const analysis = createEmptyFinancialAnalysis('PRODUCTS');
	analysis.analysisType = FINANCIAL_ANALYSIS_TYPES.RETRIEVE;
	const current = normalized.buckets.products.current;

	if (!current) {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.UNAVAILABLE;
		analysis.limitations.push(MISSING_DATA_STATE.NOT_AVAILABLE);
		return analysis;
	}

	analysis.metrics = {
		productCount: current.count,
		products: current.products || [],
	};
	analysis.evidence = normalized.evidence;
	analysis.sourceSteps = stepResults.map((s) => s.stepId);
	analysis.partial = partial;
	analysis.status = current.noData
		? FINANCIAL_ANALYSIS_STATUS.NO_DATA
		: FINANCIAL_ANALYSIS_STATUS.COMPLETE;

	return analysis;
}

function analyzeStock({ normalized, stepResults, partial }) {
	const analysis = createEmptyFinancialAnalysis('STOCK');
	analysis.analysisType = FINANCIAL_ANALYSIS_TYPES.SUMMARY;
	const current = normalized.buckets.stock.current;

	if (!current?.hasData) {
		analysis.status = FINANCIAL_ANALYSIS_STATUS.UNAVAILABLE;
		analysis.limitations.push(MISSING_DATA_STATE.NOT_AVAILABLE);
		return analysis;
	}

	analysis.metrics = {
		count: current.count,
		totalQuantity: current.totalQuantity,
		lowStockCount: current.lowStockCount,
		outOfStockCount: current.outOfStockCount,
	};
	analysis.evidence = normalized.evidence;
	analysis.sourceSteps = stepResults.map((s) => s.stepId);
	analysis.partial = partial;
	analysis.status = current.count === 0
		? FINANCIAL_ANALYSIS_STATUS.NO_DATA
		: FINANCIAL_ANALYSIS_STATUS.COMPLETE;
	if (current.count === 0) {
		analysis.limitations.push(MISSING_DATA_STATE.NO_DATA);
	}
	return analysis;
}

function buildCompatibleAnalysisResult(financialAnalysis) {
	const m = financialAnalysis.metrics;
	const legacyMetrics = {};

	if (m.revenue?.current != null || typeof m.revenue === 'number') {
		legacyMetrics.revenue = m.revenue?.current ?? m.revenue;
	}
	if (m.collected?.current != null || typeof m.collected === 'number') {
		legacyMetrics.totalCollected = m.collected?.current ?? m.collected;
	}
	if (m.expenses?.current != null || typeof m.expenses === 'number') {
		legacyMetrics.expenses = m.expenses?.current ?? m.expenses;
	}
	if (m.profit?.current != null) {
		legacyMetrics.profit = m.profit.current;
	} else if (legacyMetrics.totalCollected != null && legacyMetrics.expenses != null) {
		legacyMetrics.profit = computeProfit(legacyMetrics.totalCollected, legacyMetrics.expenses);
	}

	return validateAnalysisResult({
		success: financialAnalysis.status === FINANCIAL_ANALYSIS_STATUS.COMPLETE,
		domain: financialAnalysis.domain,
		metrics: legacyMetrics,
		drivers: toAnalysisDrivers(financialAnalysis.drivers || []),
		warnings: financialAnalysis.limitations || [],
		sourceSteps: financialAnalysis.sourceSteps || [],
	});
}

/**
 * Deterministic financial analysis engine.
 * No DB, no HTTP, no LLM — analyzes stepResults only.
 */
export function analyzeFinancialResults({
	goal = null,
	executionResult = null,
	stepResults = [],
	context = {},
}) {
	const startedAt = Date.now();
	const partial = Boolean(executionResult?.partial);
	const normalized = normalizeStepResults(stepResults);

	let financialAnalysis;

	const domain = goal?.domain || 'GENERAL';
	const objective = goal?.objective || 'SUMMARIZE';

	if (domain === 'PROFIT' && objective === 'RETRIEVE') {
		financialAnalysis = analyzeProfitRetrieve({ normalized, stepResults, partial });
	} else if (domain === 'PROFIT' && (objective === 'EXPLAIN' || objective === 'COMPARE')) {
		financialAnalysis = analyzeProfitExplanation({
			goal,
			normalized,
			stepResults,
			partial,
		});
	} else if ((domain === 'PROFIT' || domain === 'GENERAL') && objective === 'SUMMARIZE') {
		financialAnalysis = analyzeActivitySummary({ goal, normalized, stepResults, partial });
	} else if (domain === 'SALES' && objective === 'RETRIEVE') {
		financialAnalysis = analyzeSalesRetrieve({ normalized, stepResults, partial });
	} else if (domain === 'SALES' && objective === 'COMPARE') {
		financialAnalysis = analyzeSalesCompare({ normalized, stepResults, partial });
	} else if (domain === 'EXPENSES' && objective === 'RETRIEVE') {
		financialAnalysis = analyzeExpensesRetrieve({ normalized, stepResults, partial });
	} else if (domain === 'EXPENSES' && objective === 'COMPARE') {
		financialAnalysis = analyzeExpensesCompare({ normalized, stepResults, partial });
	} else if (domain === 'DEBTS') {
		financialAnalysis = analyzeDebts({ normalized, stepResults, partial });
	} else if (domain === 'STOCK') {
		financialAnalysis = analyzeStock({ normalized, stepResults, partial });
	} else if (domain === 'PRODUCTS' && objective === 'RETRIEVE') {
		financialAnalysis = analyzeProductsRetrieve({ normalized, stepResults, partial });
	} else {
		financialAnalysis = createEmptyFinancialAnalysis(domain);
		financialAnalysis.status = FINANCIAL_ANALYSIS_STATUS.UNAVAILABLE;
		financialAnalysis.limitations.push(MISSING_DATA_STATE.NOT_AVAILABLE);
	}

	financialAnalysis.diagnostics.analysisDurationMs = Date.now() - startedAt;
	financialAnalysis.diagnostics.domain = domain;
	financialAnalysis.diagnostics.analysisType = financialAnalysis.analysisType;

	const legacyResult = buildCompatibleAnalysisResult(financialAnalysis);

	return {
		financialAnalysis,
		analysisResult: legacyResult.valid ? legacyResult.value : null,
		analysisResultValidation: legacyResult,
	};
}

export function sanitizeFinancialAnalysisForLog(analysis) {
	if (!analysis) return null;
	return {
		domain: analysis.domain,
		analysisType: analysis.analysisType,
		status: analysis.status,
		partial: analysis.partial,
		metricCount: analysis.diagnostics?.metricCount ?? 0,
		driverCount: analysis.diagnostics?.driverCount ?? 0,
		analysisDurationMs: analysis.diagnostics?.analysisDurationMs ?? 0,
		limitationCount: (analysis.limitations || []).length,
	};
}
