import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyGoal } from '../src/agent/intelligence-v2/goal-contract.js';
import { analyzeFinancialResults } from '../src/agent/intelligence-v2/financial/financial-analyzer.js';
import { compareMetric, CHANGE_DIRECTION, PERCENTAGE_REASON } from '../src/agent/intelligence-v2/financial/financial-comparison.js';
import { buildProfitDrivers } from '../src/agent/intelligence-v2/financial/financial-contribution.js';
import { FINANCIAL_ANALYSIS_STATUS, FINANCIAL_ANALYSIS_TYPES } from '../src/agent/intelligence-v2/financial/financial-contract.js';
import { buildGoldenStepResults, GOLDEN_SCENARIO_A } from '../src/agent/intelligence-v2/financial/golden-dataset.js';
import { computeProfit, buildSalesMetrics, buildExpenseMetrics } from '../src/agent/intelligence-v2/financial/financial-metrics.js';
import { normalizeStepResults } from '../src/agent/intelligence-v2/financial/financial-normalizer.js';
import { roundMoney } from '../src/agent/intelligence-v2/financial/financial-precision.js';
import { computeProfitMargin, computeExpenseToRevenueRatio, RATIO_REASON } from '../src/agent/intelligence-v2/financial/financial-ratios.js';
import { validateCurrencyCompatibility, validatePeriodCompatibility } from '../src/agent/intelligence-v2/financial/financial-validation.js';

function profitGoal(objective = 'EXPLAIN') {
	return createEmptyGoal({ type: 'ANALYSIS', domain: 'PROFIT', objective });
}

function salesStep(id, period, summary, status = 'SUCCESS') {
	return {
		stepId: id,
		tool: 'get_sales',
		status,
		arguments: { period },
		summary,
		toolResult: { success: status === 'SUCCESS', tool: 'get_sales', data: { summary }, meta: { period } },
	};
}

function expenseStep(id, period, summary, status = 'SUCCESS') {
	return {
		stepId: id,
		tool: 'get_expenses',
		status,
		arguments: { period },
		summary,
		toolResult: { success: status === 'SUCCESS', tool: 'get_expenses', data: { summary }, meta: { period } },
	};
}

// BASIC METRICS
test('metrics: revenue from sales summary', () => {
	const m = buildSalesMetrics({ count: 2, totalRevenue: 1200, totalCollected: 1100 });
	assert.equal(m.revenue, 1200);
	assert.equal(m.collected, 1100);
});

test('metrics: expenses from summary', () => {
	const m = buildExpenseMetrics({ count: 3, totalAmount: 400 });
	assert.equal(m.expenseTotal, 400);
});

test('metrics: profit = collected - expenses', () => {
	assert.equal(computeProfit(900, 400), 500);
});

test('metrics: negative profit preserved', () => {
	assert.equal(computeProfit(300, 500), -200);
});

test('metrics: zero revenue', () => {
	const m = buildSalesMetrics({ count: 0, totalRevenue: 0, totalCollected: 0 });
	assert.equal(m.noData, true);
});

test('metrics: zero expenses', () => {
	const m = buildExpenseMetrics({ count: 0, totalAmount: 0 });
	assert.equal(m.noData, true);
});

// COMPARISON
test('comparison: positive change', () => {
	const c = compareMetric(1200, 900);
	assert.equal(c.absoluteChange, 300);
	assert.equal(c.percentageChange, 33.33);
	assert.equal(c.direction, CHANGE_DIRECTION.UP);
});

test('comparison: negative change', () => {
	const c = compareMetric(400, 500);
	assert.equal(c.absoluteChange, -100);
	assert.equal(c.direction, CHANGE_DIRECTION.DOWN);
});

test('comparison: unchanged', () => {
	const c = compareMetric(500, 500);
	assert.equal(c.direction, CHANGE_DIRECTION.UNCHANGED);
});

test('comparison: previous zero gives null percentage', () => {
	const c = compareMetric(1200, 0);
	assert.equal(c.percentageChange, null);
	assert.equal(c.percentageReason, PERCENTAGE_REASON.NO_BASELINE);
});

test('comparison: current zero with previous positive', () => {
	const c = compareMetric(0, 500);
	assert.equal(c.percentageChange, -100);
	assert.equal(c.direction, CHANGE_DIRECTION.DOWN);
});

test('comparison: null input unavailable', () => {
	const c = compareMetric(null, 100);
	assert.equal(c.direction, CHANGE_DIRECTION.UNAVAILABLE);
});

test('comparison: invalid input unavailable', () => {
	const c = compareMetric('x', 100);
	assert.equal(c.direction, CHANGE_DIRECTION.UNAVAILABLE);
});

// PROFIT
test('profit: golden current profit', () => {
	const steps = buildGoldenStepResults();
	const result = analyzeFinancialResults({ goal: profitGoal(), stepResults: steps });
	assert.equal(result.financialAnalysis.metrics.profit.current, GOLDEN_SCENARIO_A.expected.currentProfit);
});

test('profit: golden previous profit', () => {
	const steps = buildGoldenStepResults();
	const result = analyzeFinancialResults({ goal: profitGoal(), stepResults: steps });
	assert.equal(result.financialAnalysis.metrics.profit.previous, GOLDEN_SCENARIO_A.expected.previousProfit);
});

test('profit: golden profit delta', () => {
	const steps = buildGoldenStepResults();
	const result = analyzeFinancialResults({ goal: profitGoal(), stepResults: steps });
	assert.equal(result.financialAnalysis.comparisons.profit.absoluteChange, -100);
});

test('profit: golden profit percentage', () => {
	const steps = buildGoldenStepResults();
	const result = analyzeFinancialResults({ goal: profitGoal(), stepResults: steps });
	assert.equal(result.financialAnalysis.comparisons.profit.percentageChange, -20);
});

test('profit: revenue delta golden', () => {
	const steps = buildGoldenStepResults();
	const result = analyzeFinancialResults({ goal: profitGoal(), stepResults: steps });
	assert.equal(result.financialAnalysis.comparisons.revenue.absoluteChange, 300);
});

test('profit: expense delta golden', () => {
	const steps = buildGoldenStepResults();
	const result = analyzeFinancialResults({ goal: profitGoal(), stepResults: steps });
	assert.equal(result.financialAnalysis.comparisons.expenses.absoluteChange, 400);
});

test('profit: margin current', () => {
	const steps = buildGoldenStepResults();
	const result = analyzeFinancialResults({ goal: profitGoal(), stepResults: steps });
	assert.equal(result.financialAnalysis.ratios.profitMargin.current.value, 33.33);
});

test('profit: expense/revenue ratio', () => {
	const steps = buildGoldenStepResults();
	const result = analyzeFinancialResults({ goal: profitGoal(), stepResults: steps });
	assert.equal(result.financialAnalysis.ratios.expenseToRevenueRatio.current.value, 66.67);
});

// DRIVERS
test('drivers: revenue positive driver', () => {
	const { drivers } = buildProfitDrivers({
		revenueComparison: compareMetric(1200, 900),
		expenseComparison: compareMetric(800, 400),
		profitComparison: compareMetric(400, 500),
	});
	assert.equal(drivers[0].type, 'EXPENSE_INCREASE');
	assert.equal(drivers[0].absoluteImpact, -400);
});

test('drivers: expense negative driver impact on profit', () => {
	const { drivers } = buildProfitDrivers({
		revenueComparison: compareMetric(1200, 900),
		expenseComparison: compareMetric(800, 400),
		profitComparison: compareMetric(400, 500),
	});
	const expenseDriver = drivers.find((d) => d.metric === 'expenses');
	assert.equal(expenseDriver.contribution, -400);
});

test('drivers: revenue decline', () => {
	const { interpretations } = buildProfitDrivers({
		revenueComparison: compareMetric(700, 900),
		expenseComparison: compareMetric(400, 400),
		profitComparison: compareMetric(300, 500),
	});
	assert.ok(interpretations.length > 0);
});

test('drivers: expense decline', () => {
	const { drivers } = buildProfitDrivers({
		revenueComparison: compareMetric(900, 900),
		expenseComparison: compareMetric(300, 400),
		profitComparison: compareMetric(600, 500),
	});
	const exp = drivers.find((d) => d.metric === 'expenses');
	assert.equal(exp.contribution, 100);
});

test('drivers: ranking by absolute impact', () => {
	const { drivers } = buildProfitDrivers({
		revenueComparison: compareMetric(1200, 900),
		expenseComparison: compareMetric(800, 400),
		profitComparison: compareMetric(400, 500),
	});
	assert.ok(Math.abs(drivers[0].absoluteImpact) >= Math.abs(drivers[1].absoluteImpact));
});

test('drivers: no false causality percentage field', () => {
	const steps = buildGoldenStepResults();
	const result = analyzeFinancialResults({ goal: profitGoal(), stepResults: steps });
	for (const d of result.financialAnalysis.drivers) {
		assert.equal(d.causalPercent, undefined);
		assert.equal(d.explainsPercent, undefined);
	}
});

// PARTIAL
test('partial: one failed step marks partial', () => {
	const steps = buildGoldenStepResults();
	steps[3] = expenseStep('expenses_previous', 'previous_month', null, 'EXECUTION_ERROR');
	const result = analyzeFinancialResults({
		goal: profitGoal(),
		stepResults: steps,
		executionResult: { partial: true },
	});
	assert.equal(result.financialAnalysis.partial, true);
	assert.equal(result.financialAnalysis.status, FINANCIAL_ANALYSIS_STATUS.PARTIAL);
});

test('partial: two failed steps', () => {
	const steps = [
		salesStep('sales_current', 'current_month', { count: 1, totalRevenue: 100, totalCollected: 100 }),
		expenseStep('expenses_current', 'current_month', null, 'TIMEOUT'),
		salesStep('sales_previous', 'previous_month', null, 'EXECUTION_ERROR'),
	];
	const result = analyzeFinancialResults({
		goal: profitGoal(),
		stepResults: steps,
		executionResult: { partial: true },
	});
	assert.equal(result.financialAnalysis.status, FINANCIAL_ANALYSIS_STATUS.PARTIAL);
});

test('partial: missing previous expenses unavailable comparison', () => {
	const steps = [
		salesStep('sales_current', 'current_month', { count: 1, totalRevenue: 100, totalCollected: 100 }),
		salesStep('sales_previous', 'previous_month', { count: 1, totalRevenue: 80, totalCollected: 80 }),
		expenseStep('expenses_current', 'current_month', { count: 1, totalAmount: 40 }),
	];
	const result = analyzeFinancialResults({ goal: profitGoal(), stepResults: steps });
	assert.equal(result.financialAnalysis.comparisons.expenses.previous, null);
});

test('partial: missing current sales', () => {
	const steps = [
		expenseStep('expenses_current', 'current_month', { count: 1, totalAmount: 40 }),
		expenseStep('expenses_previous', 'previous_month', { count: 1, totalAmount: 30 }),
	];
	const result = analyzeFinancialResults({ goal: profitGoal(), stepResults: steps });
	assert.equal(result.financialAnalysis.metrics.profit.current, null);
});

// NO DATA
test('no data: current sales empty', () => {
	const steps = [salesStep('sales_current', 'current_month', { count: 0, totalRevenue: 0, totalCollected: 0 })];
	const normalized = normalizeStepResults(steps);
	assert.equal(normalized.buckets.sales.current.noData, true);
});

test('no data: previous sales empty', () => {
	const steps = [salesStep('sales_previous', 'previous_month', { count: 0, totalRevenue: 0, totalCollected: 0 })];
	const normalized = normalizeStepResults(steps);
	assert.equal(normalized.buckets.sales.previous.noData, true);
});

test('no data: no expenses', () => {
	const steps = [expenseStep('expenses_current', 'current_month', { count: 0, totalAmount: 0 })];
	const normalized = normalizeStepResults(steps);
	assert.equal(normalized.buckets.expenses.current.noData, true);
});

test('no data: no baseline percentage', () => {
	const c = compareMetric(1200, 0);
	assert.equal(c.percentageReason, PERCENTAGE_REASON.NO_BASELINE);
});

// CURRENCY
test('currency: compatible when both absent', () => {
	assert.equal(validateCurrencyCompatibility({}, {}).valid, true);
});

test('currency: incompatible currencies rejected', () => {
	const r = validateCurrencyCompatibility({ currency: 'USD' }, { currency: 'CDF' });
	assert.equal(r.valid, false);
});

// PERIOD
test('period: valid distinct periods', () => {
	const r = validatePeriodCompatibility(
		{ label: 'current_month', start: '2026-09-01', end: '2026-09-30' },
		{ label: 'previous_month', start: '2026-08-01', end: '2026-08-31' },
	);
	assert.equal(r.valid, true);
});

test('period: identical labels invalid', () => {
	const r = validatePeriodCompatibility({ label: 'current_month' }, { label: 'current_month' });
	assert.equal(r.valid, false);
});

test('period: mismatched length warns', () => {
	const r = validatePeriodCompatibility(
		{ label: 'a', start: '2026-09-01', end: '2026-09-30' },
		{ label: 'b', start: '2026-09-01', end: '2026-09-07' },
	);
	assert.equal(r.warning, 'PERIOD_LENGTH_MISMATCH');
});

// NEGATIVE
test('negative: negative profit allowed', () => {
	assert.equal(computeProfit(200, 500), -300);
});

test('negative: negative expense delta preserved', () => {
	const c = compareMetric(200, 500);
	assert.equal(c.absoluteChange, -300);
});

// PRODUCTS
test('products: top product ranking when data available', () => {
	const steps = [salesStep('sales_current', 'current_month', {
		count: 2,
		totalRevenue: 100,
		totalCollected: 100,
		byProduct: [
			{ product: 'Coca', revenue: 60, quantity: 3 },
			{ product: 'Eau', revenue: 40, quantity: 2 },
		],
	})];
	const result = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' }),
		stepResults: steps,
	});
	assert.equal(result.financialAnalysis.metrics.topProduct.product, 'Coca');
});

test('products: missing product data no ranking', () => {
	const steps = [salesStep('sales_current', 'current_month', { count: 1, totalRevenue: 50, totalCollected: 50 })];
	const result = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' }),
		stepResults: steps,
	});
	assert.equal(result.financialAnalysis.metrics.topProduct, undefined);
});

// STOCK
test('stock: available metrics', () => {
	const steps = [{
		stepId: 'stock_current',
		tool: 'get_stock',
		status: 'SUCCESS',
		arguments: { period: 'current_month' },
		summary: { count: 5, totalQuantity: 100, lowStockCount: 1, outOfStockCount: 0 },
		toolResult: { success: true, data: { summary: { count: 5, totalQuantity: 100, lowStockCount: 1, outOfStockCount: 0 } } },
	}];
	const result = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'STOCK', objective: 'RETRIEVE' }),
		stepResults: steps,
	});
	assert.equal(result.financialAnalysis.metrics.count, 5);
});

test('stock: unavailable without data', () => {
	const result = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'STOCK', objective: 'RETRIEVE' }),
		stepResults: [],
	});
	assert.equal(result.financialAnalysis.status, FINANCIAL_ANALYSIS_STATUS.UNAVAILABLE);
});

// DEBTS
test('debts: available metric', () => {
	const steps = [{
		stepId: 'debts_current',
		tool: 'get_debts',
		status: 'SUCCESS',
		arguments: {},
		summary: { count: 2, unpaidCount: 2, totalRemaining: 150 },
		toolResult: { success: true, data: { summary: { count: 2, unpaidCount: 2, totalRemaining: 150 } } },
	}];
	const result = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'DEBTS', objective: 'RETRIEVE' }),
		stepResults: steps,
	});
	assert.equal(result.financialAnalysis.metrics.totalRemaining, 150);
});

test('debts: unavailable without data', () => {
	const result = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'DEBTS', objective: 'RETRIEVE' }),
		stepResults: [],
	});
	assert.equal(result.financialAnalysis.status, FINANCIAL_ANALYSIS_STATUS.UNAVAILABLE);
});

test('debts: no unpaid returns NO_DATA', () => {
	const steps = [{
		stepId: 'debts_current',
		tool: 'get_debts',
		status: 'SUCCESS',
		arguments: {},
		summary: { count: 0, unpaidCount: 0, totalRemaining: 0 },
		toolResult: { success: true, data: { summary: { count: 0, unpaidCount: 0, totalRemaining: 0 } } },
	}];
	const result = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'DEBTS', objective: 'RETRIEVE' }),
		stepResults: steps,
	});
	assert.equal(result.financialAnalysis.status, FINANCIAL_ANALYSIS_STATUS.NO_DATA);
});

// TRACEABILITY
test('traceability: sourceSteps preserved', () => {
	const steps = buildGoldenStepResults();
	const result = analyzeFinancialResults({ goal: profitGoal(), stepResults: steps });
	assert.deepEqual(result.financialAnalysis.sourceSteps, [
		'sales_current', 'sales_previous', 'expenses_current', 'expenses_previous',
	]);
	assert.ok(result.financialAnalysis.drivers[0].sourceSteps.length > 0);
});

// GOLDEN
test('golden 1: profit explain scenario', () => {
	const result = analyzeFinancialResults({
		goal: profitGoal('EXPLAIN'),
		stepResults: buildGoldenStepResults(),
	});
	assert.equal(result.financialAnalysis.domain, 'PROFIT');
	assert.equal(result.financialAnalysis.analysisType, FINANCIAL_ANALYSIS_TYPES.EXPLANATION);
	assert.equal(result.financialAnalysis.status, FINANCIAL_ANALYSIS_STATUS.COMPLETE);
	assert.equal(result.financialAnalysis.evidence.length, 4);
});

test('golden 2: expenses compare', () => {
	const steps = [
		expenseStep('expenses_current', 'current_month', { count: 2, totalAmount: 800 }),
		expenseStep('expenses_previous', 'previous_month', { count: 1, totalAmount: 400 }),
	];
	const result = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'ANALYSIS', domain: 'EXPENSES', objective: 'COMPARE' }),
		stepResults: steps,
	});
	assert.equal(result.financialAnalysis.domain, 'EXPENSES');
	assert.equal(result.financialAnalysis.comparisons.expenses.absoluteChange, 400);
});

test('golden 3: sales retrieve no comparison', () => {
	const steps = [salesStep('sales_current', 'current_month', { count: 3, totalRevenue: 500, totalCollected: 500 })];
	const result = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' }),
		stepResults: steps,
	});
	assert.equal(result.financialAnalysis.analysisType, FINANCIAL_ANALYSIS_TYPES.RETRIEVE);
	assert.equal(result.financialAnalysis.comparisons?.revenue, undefined);
});

// PROPERTY
test('property: deltaProfit equals deltaRevenue minus deltaExpenses on collected basis', () => {
	const rev = compareMetric(1200, 900);
	const exp = compareMetric(800, 400);
	const profit = compareMetric(computeProfit(1200, 800), computeProfit(900, 400));
	assert.equal(profit.absoluteChange, roundMoney(rev.absoluteChange - exp.absoluteChange));
});

test('property: no NaN or Infinity in outputs', () => {
	const steps = buildGoldenStepResults();
	const result = analyzeFinancialResults({ goal: profitGoal(), stepResults: steps });
	const json = JSON.stringify(result.financialAnalysis);
	assert.equal(json.includes('NaN'), false);
	assert.equal(json.includes('Infinity'), false);
});

test('ratios: zero denominator margin', () => {
	const r = computeProfitMargin(100, 0);
	assert.equal(r.value, null);
	assert.equal(r.reason, RATIO_REASON.ZERO_DENOMINATOR);
});

test('ratios: zero denominator expense ratio', () => {
	const r = computeExpenseToRevenueRatio(100, 0);
	assert.equal(r.value, null);
});

test('legacy analysisResult compatibility', () => {
	const result = analyzeFinancialResults({
		goal: profitGoal(),
		stepResults: buildGoldenStepResults(),
	});
	assert.equal(result.analysisResult.metrics.profit, 400);
	assert.equal(result.analysisResult.metrics.totalCollected, 1200);
});
