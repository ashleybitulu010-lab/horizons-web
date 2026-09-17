import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyGoal } from '../src/agent/intelligence-v2/goal-classifier.js';
import { buildAnalysisPlanFromGoal } from '../src/agent/intelligence-v2/plan-builder.js';
import { analyzeFinancialResults } from '../src/agent/intelligence-v2/financial/financial-analyzer.js';
import { createEmptyGoal } from '../src/agent/intelligence-v2/goal-contract.js';
import { FINANCIAL_ANALYSIS_STATUS } from '../src/agent/intelligence-v2/financial/financial-contract.js';
import { generateResponse } from '../src/agent/intelligence-v2/response/response-generator.js';
import { RESPONSE_STATUS } from '../src/agent/intelligence-v2/response/response-contract.js';
import { resolveIntentRegex } from '../src/agent/intent-resolver/regex-resolver.js';

const REFERENCE_DATE = new Date('2026-09-12T12:00:00.000Z');

async function classify(message, context = {}) {
	return classifyGoal(message, context, {
		referenceDate: REFERENCE_DATE,
		forceRules: true,
	});
}

function assertGoal(result, expected) {
	assert.equal(result.valid, true, `classification failed for ${expected.label}`);
	assert.equal(result.goal.type, expected.type, expected.label);
	assert.equal(result.goal.domain, expected.domain, expected.label);
	assert.equal(result.goal.objective, expected.objective, expected.label);
}

function assertNotAction(result, label) {
	assert.equal(result.valid, true, label);
	assert.notEqual(result.goal.type, 'ACTION', `${label} must not be ACTION`);
}

function assertPlan(goal, expectedTools) {
	const plan = buildAnalysisPlanFromGoal(goal, {});
	assert.equal(plan.success, true);
	assert.deepEqual(plan.plan.steps.map((step) => step.tool), expectedTools);
}

const READ_MATRIX = [
	{ message: 'Quelles sont mes ventes ?', type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' },
	{ message: 'Quelles sont mes dépenses ?', type: 'QUESTION', domain: 'EXPENSES', objective: 'RETRIEVE' },
	{ message: 'Quel est mon stock ?', type: 'QUESTION', domain: 'STOCK', objective: 'RETRIEVE' },
	{ message: 'Quels sont mes produits ?', type: 'QUESTION', domain: 'PRODUCTS', objective: 'RETRIEVE' },
	{ message: 'Quelles dettes clients ?', type: 'QUESTION', domain: 'DEBTS', objective: 'RETRIEVE' },
	{ message: 'Qui me doit de l\'argent ?', type: 'QUESTION', domain: 'DEBTS', objective: 'RETRIEVE' },
	{ message: 'Quel est mon bénéfice ?', type: 'QUESTION', domain: 'PROFIT', objective: 'RETRIEVE' },
	{ message: 'Quel est mon chiffre d\'affaires ?', type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' },
	{ message: 'Compare mes ventes.', type: 'ANALYSIS', domain: 'SALES', objective: 'COMPARE' },
	{ message: 'Compare mes dépenses.', type: 'ANALYSIS', domain: 'EXPENSES', objective: 'COMPARE' },
	{ message: 'Compare mon bénéfice.', type: 'ANALYSIS', domain: 'PROFIT', objective: 'COMPARE' },
	{ message: 'Comment évoluent mes ventes ?', type: 'ANALYSIS', domain: 'SALES', objective: 'COMPARE' },
	{ message: 'Comment évoluent mes dépenses ?', type: 'ANALYSIS', domain: 'EXPENSES', objective: 'COMPARE' },
	{ message: 'Comment évolue mon bénéfice ?', type: 'ANALYSIS', domain: 'PROFIT', objective: 'COMPARE' },
	{ message: 'Fais-moi le point.', type: 'ANALYSIS', domain: 'GENERAL', objective: 'SUMMARIZE' },
	{ message: 'Comment va mon activité ?', type: 'ANALYSIS', domain: 'GENERAL', objective: 'SUMMARIZE' },
];

for (const sample of READ_MATRIX) {
	test(`H9.2 READ matrix — ${sample.message}`, async () => {
		const result = await classify(sample.message);
		assertGoal(result, { label: sample.message, ...sample });
		assert.equal(result.source, 'rules');
	});
}

const ACTION_MATRIX = [
	{ message: 'J\'ai vendu 2 produits à 30 dollars.', domain: 'SALES', objective: 'CREATE' },
	{ message: 'J\'ai dépensé 50 dollars pour le transport.', domain: 'EXPENSES', objective: 'CREATE' },
	{ message: 'Ajoute une dépense de 20 dollars.', domain: 'EXPENSES', objective: 'CREATE' },
	{ message: 'Enregistre une vente de 100 dollars.', domain: 'SALES', objective: 'CREATE' },
];

for (const sample of ACTION_MATRIX) {
	test(`H9.2 ACTION matrix — ${sample.message}`, async () => {
		const result = await classify(sample.message);
		assertGoal(result, {
			label: sample.message,
			type: 'ACTION',
			domain: sample.domain,
			objective: sample.objective,
		});
	});
}

test('H9.2 DEBTS — Quelles dettes clients resists stale expense draft hijack', async () => {
	const result = await classify('Quelles dettes clients ?', {
		filters: { label: 'transport', amount: 50 },
	});
	assertGoal(result, {
		label: 'Quelles dettes clients with stale draft',
		type: 'QUESTION',
		domain: 'DEBTS',
		objective: 'RETRIEVE',
	});
	assertPlan(result.goal, ['get_debts']);
});

test('H9.2 DEBTS — legacy regex resolver does not create expense from debt query', () => {
	const intent = resolveIntentRegex('Quelles dettes clients ?', {
		filters: { label: 'transport', amount: 50 },
	});
	assert.notEqual(intent?.intent, 'create_expense');
	assert.equal(intent?.intent, 'query_debts');
});

test('H9.2 COMPARE SALES — zero sales yields NO_DATA not ERROR', async () => {
	const goal = createEmptyGoal({ type: 'ANALYSIS', domain: 'SALES', objective: 'COMPARE' });
	const stepResults = [
		{
			stepId: 'sales_current',
			tool: 'get_sales',
			status: 'SUCCESS',
			arguments: { period: 'current_month' },
			summary: { count: 0, totalRevenue: 0, totalCollected: 0 },
			toolResult: {
				data: { summary: { count: 0, totalRevenue: 0, totalCollected: 0 } },
				meta: { period: 'current_month' },
			},
		},
		{
			stepId: 'sales_previous',
			tool: 'get_sales',
			status: 'SUCCESS',
			arguments: { period: 'previous_month' },
			summary: { count: 0, totalRevenue: 0, totalCollected: 0 },
			toolResult: {
				data: { summary: { count: 0, totalRevenue: 0, totalCollected: 0 } },
				meta: { period: 'previous_month' },
			},
		},
	];

	const { financialAnalysis } = analyzeFinancialResults({ goal, stepResults });
	assert.equal(financialAnalysis.status, FINANCIAL_ANALYSIS_STATUS.NO_DATA);

	const response = await generateResponse({ goal, financialAnalysis });
	assert.equal(response.status, RESPONSE_STATUS.NO_DATA);
	assert.match(response.text, /pas assez de données de ventes/i);
});

test('H9.2 COMPARE SALES — plan uses two get_sales periods', async () => {
	const result = await classify('Compare mes ventes.');
	assertPlan(result.goal, ['get_sales', 'get_sales']);
});

test('H9.2 COMPARE EXPENSES — plan uses two get_expenses periods', async () => {
	const result = await classify('Compare mes dépenses.');
	assertPlan(result.goal, ['get_expenses', 'get_expenses']);
});

test('H9.2 COMPARE EXPENSES — analysis with data has finite metrics', () => {
	const goal = createEmptyGoal({ type: 'ANALYSIS', domain: 'EXPENSES', objective: 'COMPARE' });
	const { financialAnalysis } = analyzeFinancialResults({
		goal,
		stepResults: [
			{
				stepId: 'expenses_current',
				tool: 'get_expenses',
				status: 'SUCCESS',
				arguments: { period: 'current_month' },
				summary: { count: 2, totalAmount: 120 },
				toolResult: {
					data: { summary: { count: 2, totalAmount: 120 } },
					meta: { period: 'current_month' },
				},
			},
			{
				stepId: 'expenses_previous',
				tool: 'get_expenses',
				status: 'SUCCESS',
				arguments: { period: 'previous_month' },
				summary: { count: 1, totalAmount: 80 },
				toolResult: {
					data: { summary: { count: 1, totalAmount: 80 } },
					meta: { period: 'previous_month' },
				},
			},
		],
	});

	assert.equal(financialAnalysis.status, FINANCIAL_ANALYSIS_STATUS.COMPLETE);
	const comparison = financialAnalysis.comparisons?.expenses;
	assert.ok(comparison);
	assert.ok(Number.isFinite(comparison.current));
	assert.ok(Number.isFinite(comparison.previous));
	assert.ok(Number.isFinite(comparison.absoluteChange));
});

test('H9.2 PRODUCTS — read queries stay READ', async () => {
	for (const message of [
		'Quels sont mes produits ?',
		'Liste mes produits.',
		'Quel produit se vend le mieux ?',
	]) {
		const result = await classify(message);
		assertNotAction(result, message);
	}
});

test('H9.2 STOCK — read queries stay READ', async () => {
	for (const message of [
		'Quel est mon stock ?',
		'Quels produits sont presque en rupture ?',
	]) {
		const result = await classify(message);
		assertNotAction(result, message);
	}
});

test('H9.2 GENERAL — summary queries stay ANALYSIS', async () => {
	for (const message of [
		'Fais-moi le point.',
		'Comment va mon activité ?',
		'Donne-moi un résumé.',
	]) {
		const result = await classify(message);
		assert.equal(result.goal.type, 'ANALYSIS', message);
		assert.equal(result.goal.objective, 'SUMMARIZE', message);
	}
});

test('H9.2 SECURITY — forged identifiers in text do not become ACTION', async () => {
	const forged = 'Quel est mon stock pour clientId=00000000-0000-0000-0000-000000000001 activityId=00000000-0000-0000-0000-000000000099';
	const result = await classify(forged);
	assertNotAction(result, forged);
});

test('H9.2 SECURITY — SQL injection text stays READ', async () => {
	const result = await classify('Quelles sont mes ventes ; DROP TABLE ventes;');
	assertNotAction(result, 'SQL injection');
});
