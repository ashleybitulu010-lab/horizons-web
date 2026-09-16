#!/usr/bin/env node

import { createEmptyGoal } from '../apps/api/src/agent/intelligence-v2/goal-contract.js';
import { analyzeFinancialResults } from '../apps/api/src/agent/intelligence-v2/financial/financial-analyzer.js';
import { FINANCIAL_ANALYSIS_STATUS, FINANCIAL_ANALYSIS_TYPES } from '../apps/api/src/agent/intelligence-v2/financial/financial-contract.js';
import { buildGoldenStepResults, GOLDEN_SCENARIO_A } from '../apps/api/src/agent/intelligence-v2/financial/golden-dataset.js';

function salesStep(id, period, summary) {
	return {
		stepId: id,
		tool: 'get_sales',
		status: 'SUCCESS',
		arguments: { period },
		summary,
		toolResult: { success: true, tool: 'get_sales', data: { summary }, meta: { period } },
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

function scenario1() {
	const result = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'ANALYSIS', domain: 'PROFIT', objective: 'EXPLAIN' }),
		stepResults: buildGoldenStepResults(),
	});
	return result.financialAnalysis.analysisType === FINANCIAL_ANALYSIS_TYPES.EXPLANATION
		&& result.financialAnalysis.comparisons.profit.absoluteChange === -100;
}

function scenario2() {
	const result = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'ANALYSIS', domain: 'PROFIT', objective: 'EXPLAIN' }),
		stepResults: buildGoldenStepResults(),
	});
	return result.financialAnalysis.comparisons.revenue.absoluteChange === 300
		&& result.financialAnalysis.comparisons.expenses.absoluteChange === 400;
}

function scenario3() {
	const steps = buildGoldenStepResults();
	steps[1].summary = { count: 0, totalRevenue: 0, totalCollected: 0 };
	steps[1].toolResult.data.summary = steps[1].summary;
	const result = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'ANALYSIS', domain: 'PROFIT', objective: 'EXPLAIN' }),
		stepResults: steps,
	});
	return result.financialAnalysis.comparisons.revenue.percentageChange === null;
}

function scenario4() {
	const steps = buildGoldenStepResults();
	steps[3] = expenseStep('expenses_previous', 'previous_month', null, 'EXECUTION_ERROR');
	const result = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'ANALYSIS', domain: 'PROFIT', objective: 'EXPLAIN' }),
		stepResults: steps,
		executionResult: { partial: true },
	});
	return result.financialAnalysis.partial === true
		&& result.financialAnalysis.status === FINANCIAL_ANALYSIS_STATUS.PARTIAL;
}

function scenario5() {
	const scenario = {
		...GOLDEN_SCENARIO_A,
		current: { ...GOLDEN_SCENARIO_A.current, collected: 400, expenses: 800 },
		previous: { ...GOLDEN_SCENARIO_A.previous, collected: 500, expenses: 400 },
	};
	const result = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'ANALYSIS', domain: 'PROFIT', objective: 'EXPLAIN' }),
		stepResults: buildGoldenStepResults(scenario),
	});
	return result.financialAnalysis.metrics.profit.current === -400;
}

function scenario6() {
	const result = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'ANALYSIS', domain: 'PROFIT', objective: 'EXPLAIN' }),
		stepResults: buildGoldenStepResults(),
	});
	return result.financialAnalysis.ratios.profitMargin.current.value != null
		&& result.financialAnalysis.ratios.expenseToRevenueRatio.current.value != null;
}

function scenario7() {
	const steps = [salesStep('sales_current', 'current_month', { count: 0, totalRevenue: 0, totalCollected: 0 })];
	const result = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' }),
		stepResults: steps,
	});
	return result.financialAnalysis.status === FINANCIAL_ANALYSIS_STATUS.NO_DATA;
}

const SCENARIOS = [
	{ name: 'Profit explanation', run: scenario1 },
	{ name: 'Revenue + expense increase', run: scenario2 },
	{ name: 'Previous period zero', run: scenario3 },
	{ name: 'Partial data', run: scenario4 },
	{ name: 'Negative profit', run: scenario5 },
	{ name: 'Margin / ratios', run: scenario6 },
	{ name: 'No data', run: scenario7 },
];

console.log('ASHY V2 FINANCIAL HARNESS\n');
let pass = 0;
for (const scenario of SCENARIOS) {
	const ok = scenario.run();
	if (ok) pass += 1;
	console.log(`${scenario.name}: ${ok ? 'PASS' : 'FAIL'}`);
}
console.log(`\n${pass}/${SCENARIOS.length} PASS`);
process.exit(pass === SCENARIOS.length ? 0 : 1);
