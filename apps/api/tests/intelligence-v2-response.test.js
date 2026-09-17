import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyGoal } from '../src/agent/intelligence-v2/goal-contract.js';
import { analyzeFinancialResults } from '../src/agent/intelligence-v2/financial/financial-analyzer.js';
import { buildGoldenStepResults } from '../src/agent/intelligence-v2/financial/golden-dataset.js';
import { FINANCIAL_ANALYSIS_STATUS, FINANCIAL_ANALYSIS_TYPES } from '../src/agent/intelligence-v2/financial/financial-contract.js';
import { RESPONSE_SOURCE, RESPONSE_STATUS, RESPONSE_STRATEGY } from '../src/agent/intelligence-v2/response/response-contract.js';
import { formatMoneyV2, formatPercentV2 } from '../src/agent/intelligence-v2/response/response-formatter-v2.js';
import {
	generateResponse,
	selectResponseStrategy,
	sanitizeResponseForLog,
} from '../src/agent/intelligence-v2/response/response-generator.js';
import {
	formulateResponseWithLlm,
	parseLlmResponseJson,
	resetLlmFormulateImplForTests,
	setLlmFormulateImplForTests,
} from '../src/agent/intelligence-v2/response/response-llm.js';
import { detectUnsafeResponseContent, sanitizeResponseText } from '../src/agent/intelligence-v2/response/response-sanitizer.js';
import {
	selectTemplate,
	templateError,
	templateExpensesRetrieve,
	templateNoData,
	templateProfitExplanation,
	templateSalesRetrieve,
	templateDebtsRetrieve,
	templateStockRetrieve,
	templateWriteDeferred,
} from '../src/agent/intelligence-v2/response/response-templates.js';
import {
	extractFinancialNumbers,
	validateClaimsAgainstAnalysis,
	validateGeneratedResponseText,
	validateNumericClaims,
} from '../src/agent/intelligence-v2/response/response-validator.js';

function profitGoal(objective = 'EXPLAIN') {
	return createEmptyGoal({ type: 'ANALYSIS', domain: 'PROFIT', objective });
}

function buildProfitAnalysis() {
	return analyzeFinancialResults({
		goal: profitGoal(),
		stepResults: buildGoldenStepResults(),
	}).financialAnalysis;
}

// Templates
test('template: profit explanation contains profit down and drivers', () => {
	const analysis = buildProfitAnalysis();
	const text = templateProfitExplanation(analysis);
	assert.match(text, /baiss/i);
	assert.match(text, /20\s*%/);
	assert.match(text, /400/);
	assert.match(text, /500/);
	assert.match(text, /dépenses/i);
});

test('template: sales retrieve', () => {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' }),
		stepResults: [{
			stepId: 'sales_current', tool: 'get_sales', status: 'SUCCESS',
			arguments: { period: 'current_month' },
			summary: { count: 3, totalRevenue: 500, totalCollected: 500 },
			toolResult: { data: { summary: { count: 3, totalRevenue: 500, totalCollected: 500 } }, meta: { period: 'current_month' } },
		}],
	}).financialAnalysis;
	const text = templateSalesRetrieve(analysis);
	assert.match(text, /3 ventes/);
	assert.match(text, /500/);
});

test('template: expenses retrieve', () => {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'EXPENSES', objective: 'RETRIEVE' }),
		stepResults: [{
			stepId: 'expenses_current', tool: 'get_expenses', status: 'SUCCESS',
			arguments: { period: 'current_month' },
			summary: { count: 2, totalAmount: 300 },
			toolResult: { data: { summary: { count: 2, totalAmount: 300 } }, meta: { period: 'current_month' } },
		}],
	}).financialAnalysis;
	const text = templateExpensesRetrieve(analysis);
	assert.match(text, /2 dépenses/);
	assert.match(text, /300/);
});

test('template: expenses compare', () => {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'ANALYSIS', domain: 'EXPENSES', objective: 'COMPARE' }),
		stepResults: [
			{ stepId: 'expenses_current', tool: 'get_expenses', status: 'SUCCESS', arguments: { period: 'current_month' }, summary: { count: 2, totalAmount: 800 }, toolResult: { data: { summary: { count: 2, totalAmount: 800 } }, meta: { period: 'current_month' } } },
			{ stepId: 'expenses_previous', tool: 'get_expenses', status: 'SUCCESS', arguments: { period: 'previous_month' }, summary: { count: 1, totalAmount: 400 }, toolResult: { data: { summary: { count: 1, totalAmount: 400 } }, meta: { period: 'previous_month' } } },
		],
	}).financialAnalysis;
	const text = selectTemplate(analysis, createEmptyGoal({ type: 'ANALYSIS', domain: 'EXPENSES', objective: 'COMPARE' }));
	assert.match(text, /augmentation/i);
	assert.match(text, /100\s*%/);
});

test('template: stock retrieve', () => {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'STOCK', objective: 'RETRIEVE' }),
		stepResults: [{
			stepId: 'stock_current', tool: 'get_stock', status: 'SUCCESS',
			arguments: {},
			summary: { count: 2, totalQuantity: 15, lowStockCount: 0, outOfStockCount: 0 },
			toolResult: { data: { summary: { count: 2, totalQuantity: 15, lowStockCount: 0, outOfStockCount: 0 } }, meta: {} },
		}],
	}).financialAnalysis;
	const text = templateStockRetrieve(analysis);
	assert.match(text, /2 produits/);
	assert.match(text, /15 unit/);
});

test('template: stock no data', () => {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'STOCK', objective: 'RETRIEVE' }),
		stepResults: [{
			stepId: 'stock_current', tool: 'get_stock', status: 'SUCCESS',
			arguments: {},
			summary: { count: 0, totalQuantity: 0, lowStockCount: 0, outOfStockCount: 0 },
			toolResult: { data: { summary: { count: 0, totalQuantity: 0, lowStockCount: 0, outOfStockCount: 0 } }, meta: {} },
		}],
	}).financialAnalysis;
	const text = selectTemplate(analysis, createEmptyGoal({ type: 'QUESTION', domain: 'STOCK', objective: 'RETRIEVE' }));
	assert.match(text, /aucun stock/i);
});

test('template: debts retrieve', () => {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'DEBTS', objective: 'RETRIEVE' }),
		stepResults: [{
			stepId: 'debts_current', tool: 'get_debts', status: 'SUCCESS',
			arguments: {},
			summary: { count: 2, unpaidCount: 2, totalRemaining: 150 },
			toolResult: { data: { summary: { count: 2, unpaidCount: 2, totalRemaining: 150 } }, meta: {} },
		}],
	}).financialAnalysis;
	const text = templateDebtsRetrieve(analysis);
	assert.match(text, /2 dettes impay/);
	assert.match(text, /150/);
});

test('template: debts no data', () => {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'DEBTS', objective: 'RETRIEVE' }),
		stepResults: [{
			stepId: 'debts_current', tool: 'get_debts', status: 'SUCCESS',
			arguments: {},
			summary: { count: 0, unpaidCount: 0, totalRemaining: 0 },
			toolResult: { data: { summary: { count: 0, unpaidCount: 0, totalRemaining: 0 } }, meta: {} },
		}],
	}).financialAnalysis;
	const text = selectTemplate(analysis, createEmptyGoal({ type: 'QUESTION', domain: 'DEBTS', objective: 'RETRIEVE' }));
	assert.match(text, /aucune dette impay/i);
});

test('template: no data sales', () => {
	const analysis = { domain: 'SALES', status: FINANCIAL_ANALYSIS_STATUS.NO_DATA, periods: { current: { label: 'current_month' } } };
	assert.match(templateNoData(analysis), /aucune vente/i);
});

test('template: partial notice', async () => {
	const steps = buildGoldenStepResults();
	steps[3] = { ...steps[3], status: 'EXECUTION_ERROR' };
	const analysis = analyzeFinancialResults({ goal: profitGoal(), stepResults: steps, executionResult: { partial: true } }).financialAnalysis;
	const response = await generateResponse({ goal: profitGoal(), financialAnalysis: analysis });
	assert.match(response.text, /partielle|incomplète|manque/i);
});

test('template: error', () => {
	assert.match(templateError(), /pas pu récupérer/i);
});

test('template: write deferred', () => {
	assert.match(templateWriteDeferred(), /confirmation/i);
});

// Number fidelity
test('numeric: valid profit numbers allowed', () => {
	const analysis = buildProfitAnalysis();
	const text = templateProfitExplanation(analysis);
	const result = validateNumericClaims(text, analysis);
	assert.equal(result.valid, true);
});

test('numeric: unauthorized number rejected', () => {
	const analysis = buildProfitAnalysis();
	const result = validateNumericClaims('Ton bénéfice est de 9999 $ avec 73 % de baisse.', analysis);
	assert.equal(result.valid, false);
});

test('numeric: percentage comma format', () => {
	const nums = extractFinancialNumbers('Une baisse de 33,33 %');
	assert.equal(nums[0].value, 33.33);
});

test('numeric: currency format', () => {
	const nums = extractFinancialNumbers('Total de 1 200 $');
	assert.equal(nums[0].value, 1200);
});

test('numeric: zero baseline no percent in template', () => {
	const analysis = buildProfitAnalysis();
	analysis.comparisons.revenue.percentageChange = null;
	analysis.comparisons.revenue.previous = 0;
	const text = templateProfitExplanation(analysis);
	assert.equal(text.includes('Infinity'), false);
});

test('numeric: negative number preserved', () => {
	const analysis = buildProfitAnalysis();
	analysis.comparisons.profit.current = -200;
	analysis.comparisons.profit.previous = 100;
	analysis.comparisons.profit.absoluteChange = -300;
	analysis.comparisons.profit.direction = 'DOWN';
	const text = templateProfitExplanation(analysis);
	assert.match(text, /-200|200/);
});

test('numeric: decimal formatting', () => {
	assert.equal(formatPercentV2(33.333), '33,33 %');
});

// Claim validation
test('claims: profit direction mismatch detected', () => {
	const analysis = buildProfitAnalysis();
	const result = validateClaimsAgainstAnalysis('Ton bénéfice a augmenté ce mois-ci.', analysis);
	assert.equal(result.valid, false);
});

test('claims: revenue direction mismatch detected', () => {
	const analysis = buildProfitAnalysis();
	const result = validateClaimsAgainstAnalysis('Tes ventes ont baissé fortement.', analysis);
	assert.equal(result.valid, false);
});

test('claims: expense direction ok in template', () => {
	const analysis = buildProfitAnalysis();
	const text = templateProfitExplanation(analysis);
	const result = validateClaimsAgainstAnalysis(text, analysis);
	assert.equal(result.valid, true);
});

test('claims: write claim forbidden', () => {
	const result = validateClaimsAgainstAnalysis("J'ai ajouté ta dépense.", buildProfitAnalysis());
	assert.equal(result.valid, false);
});

// Causality
test('causality: observed driver wording in template', () => {
	const text = templateProfitExplanation(buildProfitAnalysis());
	assert.match(text, /facteur observé/i);
});

test('causality: certain cause forbidden', () => {
	const result = validateClaimsAgainstAnalysis('La cause certaine est les dépenses.', buildProfitAnalysis());
	assert.equal(result.valid, false);
});

// LLM
test('llm: valid JSON parsed', () => {
	const text = parseLlmResponseJson('{"text":"Ton bénéfice a baissé."}');
	assert.match(text, /baissé/);
});

test('llm: invalid JSON throws', () => {
	assert.throws(() => parseLlmResponseJson('not json'), /JSON|text/i);
});

test('llm: empty response throws', () => {
	assert.throws(() => parseLlmResponseJson('{"text":""}'), /text/i);
});

test('llm: timeout falls back to template', async () => {
	setLlmFormulateImplForTests(async () => {
		const err = new Error('timeout');
		err.code = 'LLM_TIMEOUT';
		throw err;
	});
	const analysis = buildProfitAnalysis();
	const response = await generateResponse({
		goal: profitGoal(),
		financialAnalysis: analysis,
		options: { useLlm: true, env: { ashyIntelligenceV2Llm: true, openAiApiKey: 'test' } },
	});
	assert.equal(response.source, RESPONSE_SOURCE.TEMPLATE);
	assert.equal(response.status, RESPONSE_STATUS.FALLBACK);
	resetLlmFormulateImplForTests();
});

test('llm: unavailable falls back', async () => {
	setLlmFormulateImplForTests(async () => {
		throw new Error('down');
	});
	const response = await generateResponse({
		goal: profitGoal(),
		financialAnalysis: buildProfitAnalysis(),
		options: { useLlm: true, env: { ashyIntelligenceV2Llm: true, openAiApiKey: 'test' } },
	});
	assert.equal(response.source, RESPONSE_SOURCE.TEMPLATE);
	resetLlmFormulateImplForTests();
});

test('llm: invalid response falls back', async () => {
	setLlmFormulateImplForTests(async () => 'Ton bénéfice a augmenté de 9999 $.');
	const response = await generateResponse({
		goal: profitGoal(),
		financialAnalysis: buildProfitAnalysis(),
		options: { useLlm: true, env: { ashyIntelligenceV2Llm: true, openAiApiKey: 'test' } },
	});
	assert.equal(response.source, RESPONSE_SOURCE.TEMPLATE);
	resetLlmFormulateImplForTests();
});

test('llm: valid formulation accepted', async () => {
	const template = templateProfitExplanation(buildProfitAnalysis());
	setLlmFormulateImplForTests(async () => template);
	const response = await generateResponse({
		goal: profitGoal(),
		financialAnalysis: buildProfitAnalysis(),
		options: { useLlm: true, env: { ashyIntelligenceV2Llm: true, openAiApiKey: 'test' } },
	});
	assert.equal(response.source, RESPONSE_SOURCE.LLM);
	resetLlmFormulateImplForTests();
});

test('llm: fallback template deterministic path', async () => {
	const response = await generateResponse({ goal: profitGoal(), financialAnalysis: buildProfitAnalysis() });
	assert.equal(response.source, RESPONSE_SOURCE.TEMPLATE);
});

// Security
test('security: UUID leakage blocked', () => {
	const result = detectUnsafeResponseContent('client 550e8400-e29b-41d4-a716-446655440000');
	assert.equal(result.safe, false);
});

test('security: clientId blocked', () => {
	const sanitized = sanitizeResponseText('clientId=abc');
	assert.equal(sanitized.includes('clientId'), false);
});

test('security: SQL blocked', () => {
	const result = detectUnsafeResponseContent('select * from ventes');
	assert.equal(result.safe, false);
});

test('security: stack trace blocked', () => {
	const result = detectUnsafeResponseContent('Error: fail\n    at foo (file.js:1:1)');
	assert.equal(result.safe, false);
});

test('security: secret pattern blocked', () => {
	const result = detectUnsafeResponseContent('Bearer sk-123456789012345678901234567890');
	assert.equal(result.safe, false);
});

// Partial
test('partial: missing previous expenses communicated', async () => {
	const steps = buildGoldenStepResults().slice(0, 3);
	const analysis = analyzeFinancialResults({ goal: profitGoal(), stepResults: steps }).financialAnalysis;
	const response = await generateResponse({ goal: profitGoal(), financialAnalysis: analysis });
	assert.match(response.text, /bénéfice|partielle|données/i);
});

test('partial: missing sales', async () => {
	const steps = buildGoldenStepResults().filter((s) => !s.stepId.startsWith('sales'));
	const analysis = analyzeFinancialResults({ goal: profitGoal(), stepResults: steps }).financialAnalysis;
	const response = await generateResponse({ goal: profitGoal(), financialAnalysis: analysis });
	assert.ok(response.text.length > 0);
});

test('partial: timeout limitation template', () => {
	const analysis = buildProfitAnalysis();
	analysis.limitations = ['TIMEOUT'];
	const text = selectTemplate(analysis, profitGoal());
	assert.match(text, /trop de temps/i);
});

// Currency
test('currency: valid money formatting', () => {
	assert.equal(formatMoneyV2(1200), '1\u202f200 $');
});

test('currency: missing currency uses default', () => {
	assert.equal(formatMoneyV2(100), '100 $');
});

// Context
test('context: period label in sales template', () => {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' }),
		stepResults: [{
			stepId: 'sales_current', tool: 'get_sales', status: 'SUCCESS',
			arguments: { period: 'current_month' },
			summary: { count: 1, totalRevenue: 100, totalCollected: 100 },
			toolResult: { data: { summary: { count: 1, totalRevenue: 100, totalCollected: 100 } }, meta: { period: 'current_month' } },
		}],
	}).financialAnalysis;
	assert.match(templateSalesRetrieve(analysis), /mois-ci/i);
});

test('context: activity name prefix', () => {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' }),
		stepResults: [{
			stepId: 'sales_current', tool: 'get_sales', status: 'SUCCESS',
			arguments: { period: 'current_month' },
			summary: { count: 1, totalRevenue: 100, totalCollected: 100 },
			toolResult: { data: { summary: { count: 1, totalRevenue: 100, totalCollected: 100 } }, meta: { period: 'current_month' } },
		}],
	}).financialAnalysis;
	const text = templateSalesRetrieve(analysis, { activityName: 'ta boutique' });
	assert.match(text, /ta boutique/i);
});

test('context: no activity name when absent', () => {
	const text = templateSalesRetrieve({
		domain: 'SALES', status: FINANCIAL_ANALYSIS_STATUS.COMPLETE,
		metrics: { salesCount: 1, revenue: 100 },
		periods: { current: { label: 'current_month' } },
	});
	assert.equal(text.startsWith('Pour'), false);
});

// Formatting
test('formatting: french number', () => {
	assert.match(formatMoneyV2(1500), /1/);
});

test('formatting: french percentage', () => {
	assert.match(formatPercentV2(20), /%/);
});

test('formatting: negative profit text', () => {
	const analysis = buildProfitAnalysis();
	analysis.comparisons.profit.current = -100;
	analysis.comparisons.profit.previous = 200;
	analysis.comparisons.profit.absoluteChange = -300;
	analysis.comparisons.profit.percentageChange = -150;
	analysis.comparisons.profit.direction = 'DOWN';
	const text = templateProfitExplanation(analysis);
	assert.match(text, /baiss/i);
});

test('formatting: zero profit', () => {
	const analysis = buildProfitAnalysis();
	analysis.comparisons.profit.current = 0;
	analysis.comparisons.profit.previous = 0;
	analysis.comparisons.profit.absoluteChange = 0;
	analysis.comparisons.profit.percentageChange = null;
	analysis.comparisons.profit.direction = 'UNCHANGED';
	const text = templateProfitExplanation(analysis);
	assert.match(text, /stagn/i);
});

// Strategy
test('strategy: template for profit explain', () => {
	assert.equal(selectResponseStrategy(profitGoal(), buildProfitAnalysis()), RESPONSE_STRATEGY.DETERMINISTIC);
});

test('strategy: llm for complex when enabled', () => {
	const analysis = buildProfitAnalysis();
	assert.equal(
		selectResponseStrategy(profitGoal(), analysis, { useLlm: true, env: { ashyIntelligenceV2Llm: true, openAiApiKey: 'x' } }),
		RESPONSE_STRATEGY.LLM,
	);
});

test('strategy: no-data deterministic', () => {
	const analysis = { status: FINANCIAL_ANALYSIS_STATUS.NO_DATA, domain: 'SALES' };
	assert.equal(selectResponseStrategy(createEmptyGoal({ domain: 'SALES', objective: 'RETRIEVE' }), analysis), RESPONSE_STRATEGY.DETERMINISTIC);
});

test('strategy: error deterministic', () => {
	const analysis = { status: FINANCIAL_ANALYSIS_STATUS.UNAVAILABLE };
	assert.equal(selectResponseStrategy(profitGoal(), analysis), RESPONSE_STRATEGY.DETERMINISTIC);
});

test('strategy: partial deterministic', () => {
	const analysis = { status: FINANCIAL_ANALYSIS_STATUS.PARTIAL, partial: true };
	assert.equal(selectResponseStrategy(profitGoal(), analysis), RESPONSE_STRATEGY.DETERMINISTIC);
});

// Integration
test('integration: financial analysis to response', async () => {
	const response = await generateResponse({ goal: profitGoal(), financialAnalysis: buildProfitAnalysis() });
	assert.ok(response.text.length > 20);
	assert.equal(response.analysisType, FINANCIAL_ANALYSIS_TYPES.EXPLANATION);
});

test('integration: action write deferred response', async () => {
	const response = await generateResponse({
		goal: createEmptyGoal({ type: 'ACTION', domain: 'EXPENSES', objective: 'CREATE' }),
		financialAnalysis: null,
	});
	assert.match(response.text, /confirmation/i);
});

test('integration: sanitize response log', () => {
	const log = sanitizeResponseForLog({ text: 'hello', source: 'TEMPLATE', status: 'COMPLETE', factsUsed: ['a'] });
	assert.equal(log.textLength, 5);
	assert.equal(log.source, 'TEMPLATE');
});

test('integration: deterministic no-LLM path fast', async () => {
	const start = Date.now();
	await generateResponse({ goal: profitGoal(), financialAnalysis: buildProfitAnalysis() });
	assert.ok(Date.now() - start < 500);
});

// Golden
test('golden 1: profit down sales up expenses up', async () => {
	const response = await generateResponse({ goal: profitGoal(), financialAnalysis: buildProfitAnalysis() });
	assert.match(response.text, /baiss/i);
	assert.match(response.text, /ventes|33/i);
	assert.match(response.text, /dépenses|100/i);
	assert.match(response.text, /facteur observé/i);
});

test('golden 2: simple sales retrieval', async () => {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' }),
		stepResults: [{
			stepId: 'sales_current', tool: 'get_sales', status: 'SUCCESS',
			arguments: { period: 'current_month' },
			summary: { count: 5, totalRevenue: 1000, totalCollected: 900 },
			toolResult: { data: { summary: { count: 5, totalRevenue: 1000, totalCollected: 900 } }, meta: { period: 'current_month' } },
		}],
	}).financialAnalysis;
	const response = await generateResponse({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' }),
		financialAnalysis: analysis,
	});
	assert.match(response.text, /5 ventes/);
	assert.match(response.text, /1/);
});

test('golden 3: no previous baseline', () => {
	const analysis = buildProfitAnalysis();
	analysis.comparisons.expenses.previous = 0;
	analysis.comparisons.expenses.percentageChange = null;
	const text = templateProfitExplanation(analysis);
	assert.equal(text.includes('Infinity'), false);
});

test('golden 4: partial explicitly mentioned', async () => {
	const steps = buildGoldenStepResults();
	steps[2] = { ...steps[2], status: 'TIMEOUT' };
	const analysis = analyzeFinancialResults({ goal: profitGoal(), stepResults: steps, executionResult: { partial: true } }).financialAnalysis;
	const response = await generateResponse({ goal: profitGoal(), financialAnalysis: analysis });
	assert.match(response.text, /partielle|incomplète|manque/i);
});

test('golden 5: negative profit not abs', () => {
	const analysis = buildProfitAnalysis();
	analysis.comparisons.profit.current = -500;
	analysis.comparisons.profit.previous = 100;
	analysis.comparisons.profit.absoluteChange = -600;
	analysis.comparisons.profit.percentageChange = null;
	analysis.comparisons.profit.direction = 'DOWN';
	const text = templateProfitExplanation(analysis);
	assert.match(text, /baiss/i);
	assert.equal(text.includes('500 $'), true);
});

// Adversarial
test('adversarial: huge numbers not invented', () => {
	const result = validateNumericClaims('Montant de 999999999 $', buildProfitAnalysis());
	assert.equal(result.valid, false);
});

test('adversarial: missing metrics yields error template', async () => {
	const response = await generateResponse({ goal: profitGoal(), financialAnalysis: null });
	assert.match(response.text, /pas pu récupérer/i);
});

test('adversarial: validateGeneratedResponseText rejects empty', () => {
	assert.equal(validateGeneratedResponseText('', buildProfitAnalysis()).valid, false);
});

test('adversarial: no internal tool names in template', async () => {
	const response = await generateResponse({ goal: profitGoal(), financialAnalysis: buildProfitAnalysis() });
	assert.equal(response.text.includes('get_sales'), false);
});
