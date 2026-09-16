#!/usr/bin/env node

import { createEmptyGoal } from '../apps/api/src/agent/intelligence-v2/goal-contract.js';
import { analyzeFinancialResults } from '../apps/api/src/agent/intelligence-v2/financial/financial-analyzer.js';
import { buildGoldenStepResults } from '../apps/api/src/agent/intelligence-v2/financial/golden-dataset.js';
import { generateResponse } from '../apps/api/src/agent/intelligence-v2/response/response-generator.js';
import { RESPONSE_SOURCE } from '../apps/api/src/agent/intelligence-v2/response/response-contract.js';
import {
	resetLlmFormulateImplForTests,
	setLlmFormulateImplForTests,
} from '../apps/api/src/agent/intelligence-v2/response/response-llm.js';
import { templateProfitExplanation } from '../apps/api/src/agent/intelligence-v2/response/response-templates.js';
import { validateNumericClaims } from '../apps/api/src/agent/intelligence-v2/response/response-validator.js';

function profitGoal() {
	return createEmptyGoal({ type: 'ANALYSIS', domain: 'PROFIT', objective: 'EXPLAIN' });
}

async function scenario1() {
	const analysis = analyzeFinancialResults({ goal: profitGoal(), stepResults: buildGoldenStepResults() }).financialAnalysis;
	const response = await generateResponse({ goal: profitGoal(), financialAnalysis: analysis });
	return /baiss/i.test(response.text) && /dépenses/i.test(response.text);
}

async function scenario2() {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' }),
		stepResults: [{
			stepId: 'sales_current', tool: 'get_sales', status: 'SUCCESS',
			arguments: { period: 'current_month' },
			summary: { count: 4, totalRevenue: 800, totalCollected: 800 },
			toolResult: { data: { summary: { count: 4, totalRevenue: 800, totalCollected: 800 } }, meta: { period: 'current_month' } },
		}],
	}).financialAnalysis;
	const response = await generateResponse({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' }),
		financialAnalysis: analysis,
	});
	return /4 ventes/.test(response.text);
}

async function scenario3() {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'EXPENSES', objective: 'RETRIEVE' }),
		stepResults: [{
			stepId: 'expenses_current', tool: 'get_expenses', status: 'SUCCESS',
			arguments: { period: 'current_month' },
			summary: { count: 2, totalAmount: 250 },
			toolResult: { data: { summary: { count: 2, totalAmount: 250 } }, meta: { period: 'current_month' } },
		}],
	}).financialAnalysis;
	const response = await generateResponse({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'EXPENSES', objective: 'RETRIEVE' }),
		financialAnalysis: analysis,
	});
	return /250/.test(response.text);
}

async function scenario4() {
	const analysis = { domain: 'SALES', status: 'NO_DATA', periods: { current: { label: 'current_month' } } };
	const response = await generateResponse({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' }),
		financialAnalysis: analysis,
	});
	return /aucune vente/i.test(response.text);
}

async function scenario5() {
	const steps = buildGoldenStepResults();
	steps[3] = { ...steps[3], status: 'EXECUTION_ERROR' };
	const analysis = analyzeFinancialResults({ goal: profitGoal(), stepResults: steps, executionResult: { partial: true } }).financialAnalysis;
	const response = await generateResponse({ goal: profitGoal(), financialAnalysis: analysis });
	return /partielle|incomplète|manque/i.test(response.text);
}

async function scenario6() {
	const analysis = analyzeFinancialResults({ goal: profitGoal(), stepResults: buildGoldenStepResults() }).financialAnalysis;
	const template = templateProfitExplanation(analysis);
	setLlmFormulateImplForTests(async () => JSON.stringify({ text: template }));
	const response = await generateResponse({
		goal: profitGoal(),
		financialAnalysis: analysis,
		options: { useLlm: true, env: { ashyIntelligenceV2Llm: true, openAiApiKey: 'test' } },
	});
	resetLlmFormulateImplForTests();
	return response.source === RESPONSE_SOURCE.LLM;
}

async function scenario7() {
	const analysis = analyzeFinancialResults({ goal: profitGoal(), stepResults: buildGoldenStepResults() }).financialAnalysis;
	setLlmFormulateImplForTests(async () => 'Profit up 9999 $.');
	const response = await generateResponse({
		goal: profitGoal(),
		financialAnalysis: analysis,
		options: { useLlm: true, env: { ashyIntelligenceV2Llm: true, openAiApiKey: 'test' } },
	});
	resetLlmFormulateImplForTests();
	return response.source === RESPONSE_SOURCE.TEMPLATE;
}

async function scenario8() {
	const analysis = analyzeFinancialResults({ goal: profitGoal(), stepResults: buildGoldenStepResults() }).financialAnalysis;
	const bad = validateNumericClaims('Profit 9999 $', analysis);
	return bad.valid === false;
}

const SCENARIOS = [
	{ name: 'Profit explanation', run: scenario1 },
	{ name: 'Sales retrieve', run: scenario2 },
	{ name: 'Expense retrieve', run: scenario3 },
	{ name: 'No data', run: scenario4 },
	{ name: 'Partial', run: scenario5 },
	{ name: 'LLM valid', run: scenario6 },
	{ name: 'LLM invalid fallback', run: scenario7 },
	{ name: 'Unauthorized number rejected', run: scenario8 },
];

console.log('ASHY V2 RESPONSE HARNESS\n');
let pass = 0;
for (const scenario of SCENARIOS) {
	const ok = await scenario.run();
	if (ok) pass += 1;
	console.log(`${scenario.name}: ${ok ? 'PASS' : 'FAIL'}`);
}
console.log(`\n${pass}/${SCENARIOS.length} PASS`);
process.exit(pass === SCENARIOS.length ? 0 : 1);
