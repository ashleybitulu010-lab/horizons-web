import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyGoal } from '../src/agent/intelligence-v2/goal-classifier.js';
import { buildAnalysisPlanFromGoal } from '../src/agent/intelligence-v2/plan-builder.js';
import { analyzeFinancialResults } from '../src/agent/intelligence-v2/financial/financial-analyzer.js';
import { createEmptyGoal } from '../src/agent/intelligence-v2/goal-contract.js';
import { FINANCIAL_ANALYSIS_STATUS } from '../src/agent/intelligence-v2/financial/financial-contract.js';
import { generateResponse } from '../src/agent/intelligence-v2/response/response-generator.js';
import { RESPONSE_STATUS } from '../src/agent/intelligence-v2/response/response-contract.js';

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

function assertPlan(goal, expectedTools) {
	const plan = buildAnalysisPlanFromGoal(goal, {});
	assert.equal(plan.success, true);
	assert.deepEqual(plan.plan.steps.map((step) => step.tool), expectedTools);
}

test('H7.8 PRODUCT READ — Lister mes produits', async () => {
	const result = await classify('Lister mes produits');
	assertGoal(result, {
		label: 'Lister mes produits',
		type: 'QUESTION',
		domain: 'PRODUCTS',
		objective: 'RETRIEVE',
	});
	assert.equal(result.source, 'rules');
});

test('H7.8 PRODUCT READ — Liste mes produits', async () => {
	const result = await classify('Liste mes produits');
	assertGoal(result, {
		label: 'Liste mes produits',
		type: 'QUESTION',
		domain: 'PRODUCTS',
		objective: 'RETRIEVE',
	});
});

test('H7.8 PRODUCT READ — Quels sont mes produits ?', async () => {
	const result = await classify('Quels sont mes produits ?');
	assertGoal(result, {
		label: 'Quels sont mes produits ?',
		type: 'QUESTION',
		domain: 'PRODUCTS',
		objective: 'RETRIEVE',
	});
});

test('H7.8 PRODUCT READ — Montre-moi mes produits', async () => {
	const result = await classify('Montre-moi mes produits');
	assertGoal(result, {
		label: 'Montre-moi mes produits',
		type: 'QUESTION',
		domain: 'PRODUCTS',
		objective: 'RETRIEVE',
	});
});

test('H7.8 PRODUCT READ — Quels produits ai-je ?', async () => {
	const result = await classify('Quels produits ai-je ?');
	assertGoal(result, {
		label: 'Quels produits ai-je ?',
		type: 'QUESTION',
		domain: 'PRODUCTS',
		objective: 'RETRIEVE',
	});
});

test('H7.8 PRODUCT READ — resists stale expense draft hijack', async () => {
	const result = await classify('Liste mes produits enregistrés', {
		filters: { label: 'produits enregistrés', amount: 20 },
	});
	assertGoal(result, {
		label: 'Liste mes produits enregistrés with stale draft',
		type: 'QUESTION',
		domain: 'PRODUCTS',
		objective: 'RETRIEVE',
	});
	assert.equal(result.source, 'rules');
});

test('H7.8 PRODUCT WRITE — Ajoute un produit', async () => {
	const result = await classify('Ajoute le produit Savon');
	assertGoal(result, {
		label: 'Ajoute le produit Savon',
		type: 'ACTION',
		domain: 'PRODUCTS',
		objective: 'CREATE',
	});
});

test('H7.8 PRODUCT WRITE — Crée un produit', async () => {
	const result = await classify('Crée le produit Pain');
	assertGoal(result, {
		label: 'Crée le produit Pain',
		type: 'ACTION',
		domain: 'PRODUCTS',
		objective: 'CREATE',
	});
});

test('H7.8 PRODUCT WRITE — Modifie un produit', async () => {
	const result = await classify('Modifie le produit Savon');
	assertGoal(result, {
		label: 'Modifie le produit Savon',
		type: 'ACTION',
		domain: 'PRODUCTS',
		objective: 'UPDATE',
	});
});

test('H7.8 PROFIT — Quel est mon bénéfice ?', async () => {
	const result = await classify('Quel est mon bénéfice ?');
	assertGoal(result, {
		label: 'Quel est mon bénéfice ?',
		type: 'QUESTION',
		domain: 'PROFIT',
		objective: 'RETRIEVE',
	});
	assertPlan(result.goal, ['get_sales', 'get_expenses']);
});

test('H7.8 PROFIT — Quel est mon profit ?', async () => {
	const result = await classify('Quel est mon profit ?');
	assertGoal(result, {
		label: 'Quel est mon profit ?',
		type: 'QUESTION',
		domain: 'PROFIT',
		objective: 'RETRIEVE',
	});
});

test('H7.8 PROFIT — Quelle est ma marge ?', async () => {
	const result = await classify('Quelle est ma marge ?');
	assertGoal(result, {
		label: 'Quelle est ma marge ?',
		type: 'QUESTION',
		domain: 'PROFIT',
		objective: 'RETRIEVE',
	});
});

test('H7.8 PROFIT — Comment évolue mon bénéfice ?', async () => {
	const result = await classify('Comment évolue mon bénéfice ?');
	assertGoal(result, {
		label: 'Comment évolue mon bénéfice ?',
		type: 'ANALYSIS',
		domain: 'PROFIT',
		objective: 'COMPARE',
	});
});

test('H7.8 PROFIT — Compare mon bénéfice', async () => {
	const result = await classify('Compare mon bénéfice');
	assertGoal(result, {
		label: 'Compare mon bénéfice',
		type: 'ANALYSIS',
		domain: 'PROFIT',
		objective: 'COMPARE',
	});
});

test('H7.8 GENERAL — Comment va mon activité ?', async () => {
	const result = await classify('Comment va mon activité ?');
	assertGoal(result, {
		label: 'Comment va mon activité ?',
		type: 'ANALYSIS',
		domain: 'GENERAL',
		objective: 'SUMMARIZE',
	});
	assertPlan(result.goal, ['generate_report']);
});

test('H7.8 GENERAL — Quelle est ma situation ?', async () => {
	const result = await classify('Quelle est ma situation ?');
	assertGoal(result, {
		label: 'Quelle est ma situation ?',
		type: 'ANALYSIS',
		domain: 'GENERAL',
		objective: 'SUMMARIZE',
	});
});

test('H7.8 GENERAL — Fais-moi le point', async () => {
	const result = await classify('Fais-moi le point');
	assertGoal(result, {
		label: 'Fais-moi le point',
		type: 'ANALYSIS',
		domain: 'GENERAL',
		objective: 'SUMMARIZE',
	});
});

test('H7.8 GENERAL — résumé de situation', async () => {
	const result = await classify('Fais-moi un résumé de ma situation.');
	assertGoal(result, {
		label: 'Fais-moi un résumé de ma situation.',
		type: 'ANALYSIS',
		domain: 'GENERAL',
		objective: 'SUMMARIZE',
	});
	assertPlan(result.goal, ['generate_report']);
});

test('H7.8 PLANNER — PRODUCT READ uses get_products', async () => {
	const result = await classify('Liste mes produits');
	assertPlan(result.goal, ['get_products']);
});

test('H7.8 NO_DATA — sales retrieve analysis status', async () => {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' }),
		stepResults: [{
			stepId: 'sales_current',
			tool: 'get_sales',
			status: 'SUCCESS',
			arguments: { period: 'current_month' },
			summary: { count: 0, totalRevenue: 0, totalCollected: 0 },
			toolResult: {
				data: { summary: { count: 0, totalRevenue: 0, totalCollected: 0 } },
				meta: { period: 'current_month' },
			},
		}],
	}).financialAnalysis;

	assert.equal(analysis.status, FINANCIAL_ANALYSIS_STATUS.NO_DATA);
});

test('H7.8 NO_DATA — expenses retrieve analysis status', async () => {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'EXPENSES', objective: 'RETRIEVE' }),
		stepResults: [{
			stepId: 'expenses_current',
			tool: 'get_expenses',
			status: 'SUCCESS',
			arguments: { period: 'current_month' },
			summary: { count: 0, totalAmount: 0 },
			toolResult: {
				data: { summary: { count: 0, totalAmount: 0 } },
				meta: { period: 'current_month' },
			},
		}],
	}).financialAnalysis;

	assert.equal(analysis.status, FINANCIAL_ANALYSIS_STATUS.NO_DATA);
});

test('H7.8 NO_DATA — response status is NO_DATA not ERROR', async () => {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' }),
		stepResults: [{
			stepId: 'sales_current',
			tool: 'get_sales',
			status: 'SUCCESS',
			arguments: { period: 'current_month' },
			summary: { count: 0, totalRevenue: 0, totalCollected: 0 },
			toolResult: {
				data: { summary: { count: 0, totalRevenue: 0, totalCollected: 0 } },
				meta: { period: 'current_month' },
			},
		}],
	}).financialAnalysis;

	const response = await generateResponse({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' }),
		financialAnalysis: analysis,
	});

	assert.equal(response.status, RESPONSE_STATUS.NO_DATA);
	assert.match(response.text, /aucune vente/i);
});

test('H7.8 NO_DATA — products empty catalog', async () => {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'PRODUCTS', objective: 'RETRIEVE' }),
		stepResults: [{
			stepId: 'products_catalog',
			tool: 'get_products',
			status: 'NO_DATA',
			arguments: {},
			summary: { count: 0 },
			data: { products: [], summary: { count: 0 } },
			toolResult: {
				success: true,
				data: { products: [], summary: { count: 0 } },
			},
		}],
	}).financialAnalysis;

	assert.equal(analysis.status, FINANCIAL_ANALYSIS_STATUS.NO_DATA);
});

test('H7.8 NO_DATA — profit retrieve with empty buckets', async () => {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'PROFIT', objective: 'RETRIEVE' }),
		stepResults: [
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
				stepId: 'expenses_current',
				tool: 'get_expenses',
				status: 'SUCCESS',
				arguments: { period: 'current_month' },
				summary: { count: 0, totalAmount: 0 },
				toolResult: {
					data: { summary: { count: 0, totalAmount: 0 } },
					meta: { period: 'current_month' },
				},
			},
		],
	}).financialAnalysis;

	assert.equal(analysis.status, FINANCIAL_ANALYSIS_STATUS.NO_DATA);
});

test('H7.8 RESPONSE — products empty catalog returns NO_DATA', async () => {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'PRODUCTS', objective: 'RETRIEVE' }),
		stepResults: [{
			stepId: 'products_catalog',
			tool: 'get_products',
			status: 'NO_DATA',
			arguments: {},
			summary: { count: 0 },
			data: { products: [], summary: { count: 0 } },
			toolResult: {
				success: true,
				data: { products: [], summary: { count: 0 } },
			},
		}],
	}).financialAnalysis;

	const response = await generateResponse({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'PRODUCTS', objective: 'RETRIEVE' }),
		financialAnalysis: analysis,
	});

	assert.equal(response.status, RESPONSE_STATUS.NO_DATA);
	assert.match(response.text, /aucun produit/i);
});

test('H7.8 RESPONSE — profit retrieve uses financial truth', async () => {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'PROFIT', objective: 'RETRIEVE' }),
		stepResults: [
			{
				stepId: 'sales_current',
				tool: 'get_sales',
				status: 'SUCCESS',
				arguments: { period: 'current_month' },
				summary: { count: 2, totalRevenue: 500, totalCollected: 500 },
				toolResult: {
					data: { summary: { count: 2, totalRevenue: 500, totalCollected: 500 } },
					meta: { period: 'current_month' },
				},
			},
			{
				stepId: 'expenses_current',
				tool: 'get_expenses',
				status: 'SUCCESS',
				arguments: { period: 'current_month' },
				summary: { count: 1, totalAmount: 150 },
				toolResult: {
					data: { summary: { count: 1, totalAmount: 150 } },
					meta: { period: 'current_month' },
				},
			},
		],
	}).financialAnalysis;

	const response = await generateResponse({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'PROFIT', objective: 'RETRIEVE' }),
		financialAnalysis: analysis,
	});

	assert.equal(response.status, RESPONSE_STATUS.COMPLETE);
	assert.match(response.text, /350/);
	assert.match(response.text, /bénéfice/i);
});

test('H7.8 RESPONSE — general summary uses calculated metrics', async () => {
	const analysis = analyzeFinancialResults({
		goal: createEmptyGoal({ type: 'ANALYSIS', domain: 'GENERAL', objective: 'SUMMARIZE' }),
		stepResults: [{
			stepId: 'activity_summary',
			tool: 'generate_report',
			status: 'SUCCESS',
			arguments: { period: 'current_month' },
			summary: {
				totalRevenue: 1000,
				totalCollected: 900,
				totalExpenses: 400,
				estimatedProfit: 500,
			},
			toolResult: {
				data: {
					summary: {
						totalRevenue: 1000,
						totalCollected: 900,
						totalExpenses: 400,
						estimatedProfit: 500,
					},
				},
				meta: { period: 'current_month' },
			},
		}],
	}).financialAnalysis;

	const response = await generateResponse({
		goal: createEmptyGoal({ type: 'ANALYSIS', domain: 'GENERAL', objective: 'SUMMARIZE' }),
		financialAnalysis: analysis,
	});

	assert.equal(response.status, RESPONSE_STATUS.COMPLETE);
	assert.match(response.text, /1[\s\u00a0]?000/);
	assert.match(response.text, /500/);
});

test('H7.8 SECURITY — rejects clientId in message', async () => {
	const result = await classify('Liste mes produits clientId=abc123');
	assert.equal(result.valid, true);
	assert.equal(result.goal.parameters.clientId, undefined);
	assert.notEqual(result.goal.type, 'ACTION');
});

test('H7.8 SECURITY — rejects activityId in message', async () => {
	const result = await classify('Montre mes produits activityId=deadbeef');
	assert.equal(result.valid, true);
	assert.equal(result.goal.parameters.activityId, undefined);
});

test('H7.8 SECURITY — rejects userId in profit query', async () => {
	const result = await classify('Quel est mon bénéfice userId=abc');
	assert.equal(result.valid, true);
	assert.equal(result.goal.parameters.userId, undefined);
});

test('H7.8 SECURITY — rejects productId injection in add product', async () => {
	const result = await classify('Ajoute productId=evil');
	assert.equal(result.valid, true);
	assert.equal(result.goal.parameters.productId, undefined);
});

test('H7.8 SECURITY — rejects bearer token in catalogue query', async () => {
	const result = await classify('Liste mes produits Bearer secret-token');
	assertGoal(result, {
		label: 'Bearer in products query',
		type: 'QUESTION',
		domain: 'PRODUCTS',
		objective: 'RETRIEVE',
	});
});

test('H7.8 REGRESSION — real expense action still works', async () => {
	const result = await classify('Ajoute une dépense de 15$ pour le transport.');
	assertGoal(result, {
		label: 'Ajoute une dépense de 15$ pour le transport.',
		type: 'ACTION',
		domain: 'EXPENSES',
		objective: 'CREATE',
	});
});

test('H7.8 REGRESSION — sales retrieve still works', async () => {
	const result = await classify('Combien ai-je vendu ce mois-ci ?');
	assertGoal(result, {
		label: 'Combien ai-je vendu ce mois-ci ?',
		type: 'QUESTION',
		domain: 'SALES',
		objective: 'RETRIEVE',
	});
});
