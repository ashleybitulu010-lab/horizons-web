import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildAnalysisResultFromToolSummaries,
	validateAnalysisResult,
} from '../src/agent/intelligence-v2/analysis-result-contract.js';
import { validateAnalysisPlan } from '../src/agent/intelligence-v2/analysis-plan-contract.js';
import { buildPeriodComparison, validateComparisonSpec } from '../src/agent/intelligence-v2/comparison-contract.js';
import {
	assertGoalIsNotFinancialTruth,
	createEmptyGoal,
	validateGoal,
} from '../src/agent/intelligence-v2/goal-contract.js';
import { classifyGoal } from '../src/agent/intelligence-v2/goal-classifier.js';
import { mapLegacyIntentToGoal } from '../src/agent/intelligence-v2/legacy-intent-mapper.js';
import {
	buildPeriodSpecFromLegacyId,
	validatePeriodSpec,
} from '../src/agent/intelligence-v2/period-contract.js';
import { validatePlanStep, validatePlanSteps } from '../src/agent/intelligence-v2/plan-step-contract.js';
import { runShadowGoalDiagnostic } from '../src/agent/intelligence-v2/shadow-mode.js';

const REFERENCE_DATE = new Date('2026-09-12T12:00:00.000Z');

function currentMonthPeriod() {
	return buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE);
}

function previousMonthPeriod() {
	return buildPeriodSpecFromLegacyId('previous_month', REFERENCE_DATE);
}

test('validatePeriodSpec accepts normalized current month period', () => {
	const period = currentMonthPeriod();
	const result = validatePeriodSpec(period);
	assert.equal(result.valid, true);
	assert.equal(result.value.type, 'CURRENT_MONTH');
	assert.match(result.value.start, /^\d{4}-\d{2}-\d{2}$/);
});

test('validateComparisonSpec accepts period comparison', () => {
	const result = validateComparisonSpec({
		enabled: true,
		leftPeriod: currentMonthPeriod(),
		rightPeriod: previousMonthPeriod(),
		metric: 'PROFIT',
	});
	assert.equal(result.valid, true);
	assert.equal(result.value.metric, 'PROFIT');
});

test('validateComparisonSpec accepts activity comparison', () => {
	const result = validateComparisonSpec({
		enabled: true,
		leftActivityReference: 'boutique',
		rightActivityReference: 'pressing',
		metric: 'PROFIT',
	});
	assert.equal(result.valid, true);
	assert.equal(result.value.leftActivityReference, 'boutique');
});

test('validateGoal rejects forbidden identity keys', () => {
	const result = validateGoal({
		type: 'QUESTION',
		domain: 'SALES',
		objective: 'RETRIEVE',
		clientId: 'abc',
	});
	assert.equal(result.valid, false);
});

test('validateGoal rejects activity UUID as activityReference', () => {
	const result = validateGoal({
		type: 'QUESTION',
		domain: 'GENERAL',
		objective: 'RETRIEVE',
		activityReference: '550e8400-e29b-41d4-a716-446655440000',
	});
	assert.equal(result.valid, false);
	assert.equal(result.error, 'ACTIVITY_UUID_NOT_ALLOWED');
});

test('validatePlanStep rejects write without plan confirmation gate', () => {
	const result = validatePlanStep({
		id: 'step_1',
		tool: 'create_expense',
		arguments: { label: 'transport', amount: 15 },
		readOnly: false,
	}, { planRequiresConfirmation: false });
	assert.equal(result.valid, false);
	assert.equal(result.error, 'STEP_WRITE_REQUIRES_CONFIRMATION');
});

test('validatePlanSteps accepts read plan', () => {
	const result = validatePlanSteps([
		{
			id: 'step_1',
			tool: 'get_sales',
			arguments: { period: 'current_month' },
			dependsOn: [],
			purpose: 'retrieve_current_sales',
			readOnly: true,
		},
		{
			id: 'step_2',
			tool: 'get_expenses',
			arguments: { period: 'current_month' },
			dependsOn: [],
			purpose: 'retrieve_current_expenses',
			readOnly: true,
		},
	], { planRequiresConfirmation: false });
	assert.equal(result.valid, true);
	assert.equal(result.value.length, 2);
});

test('validateAnalysisPlan rejects write steps without confirmation flag', () => {
	const goal = createEmptyGoal({
		type: 'ACTION',
		domain: 'EXPENSES',
		objective: 'CREATE',
	});
	const result = validateAnalysisPlan({
		goal,
		requiresConfirmation: false,
		steps: [{
			id: 'step_1',
			tool: 'create_expense',
			arguments: { label: 'transport', amount: 15 },
			readOnly: false,
		}],
	});
	assert.equal(result.valid, false);
});

test('buildAnalysisResultFromToolSummaries uses backend tool summaries only', () => {
	const result = buildAnalysisResultFromToolSummaries({
		domain: 'PROFIT',
		toolResults: [
			{
				success: true,
				tool: 'get_sales',
				data: { summary: { totalRevenue: 1000, totalCollected: 900, count: 5 } },
			},
			{
				success: true,
				tool: 'get_expenses',
				data: { summary: { totalAmount: 400, count: 3 } },
			},
		],
	});
	assert.equal(result.valid, true);
	assert.equal(result.value.metrics.revenue, 1000);
	assert.equal(result.value.metrics.expenses, 400);
	assert.equal(result.value.metrics.profit, 500);
	assert.deepEqual(result.value.sourceSteps, ['get_sales', 'get_expenses']);
});

test('Goal is never financial truth', () => {
	const goal = createEmptyGoal({
		type: 'ANALYSIS',
		domain: 'PROFIT',
		objective: 'EXPLAIN',
	});
	assert.equal(assertGoalIsNotFinancialTruth(goal), true);
});

test('AnalysisResult validation rejects non-numeric metrics', () => {
	const result = validateAnalysisResult({
		success: true,
		domain: 'PROFIT',
		metrics: { revenue: '1000' },
	});
	assert.equal(result.valid, false);
});

test('legacy intent query_sales maps to QUESTION/SALES/RETRIEVE', () => {
	const mapped = mapLegacyIntentToGoal({
		intent: 'query_sales',
		filters: { period: 'current_month' },
	});
	assert.equal(mapped.valid, true);
	assert.equal(mapped.value.type, 'QUESTION');
	assert.equal(mapped.value.domain, 'SALES');
	assert.equal(mapped.value.objective, 'RETRIEVE');
});

test('legacy intent compare_sales_expenses maps to ANALYSIS/PROFIT/COMPARE', () => {
	const mapped = mapLegacyIntentToGoal({
		intent: 'compare_sales_expenses',
		filters: { period: 'current_month' },
	});
	assert.equal(mapped.valid, true);
	assert.equal(mapped.value.type, 'ANALYSIS');
	assert.equal(mapped.value.domain, 'PROFIT');
	assert.equal(mapped.value.objective, 'COMPARE');
});

const CLASSIFIER_SCENARIOS = [
	{
		name: 'current month sales',
		message: 'Combien ai-je vendu ce mois-ci ?',
		expect: { type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' },
	},
	{
		name: 'current week sales',
		message: 'Combien ai-je vendu cette semaine ?',
		expect: { type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' },
		periodType: 'CURRENT_WEEK',
	},
	{
		name: 'previous month follow-up',
		message: 'Et le mois passé ?',
		context: { topic: 'sales', filters: { period: 'current_month' } },
		expect: { type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' },
		periodType: 'PREVIOUS_MONTH',
	},
	{
		name: 'profit decrease why',
		message: 'Pourquoi mon bénéfice a baissé ?',
		expect: { type: 'ANALYSIS', domain: 'PROFIT', objective: 'EXPLAIN' },
	},
	{
		name: 'profit lower despite more sales',
		message: 'Pourquoi mon bénéfice est plus faible ce mois-ci alors que j\'ai vendu plus ?',
		expect: { type: 'ANALYSIS', domain: 'PROFIT', objective: 'EXPLAIN' },
	},
	{
		name: 'expenses increased why',
		message: 'Pourquoi mes dépenses ont augmenté ?',
		expect: { type: 'ANALYSIS', domain: 'EXPENSES', objective: 'EXPLAIN' },
	},
	{
		name: 'best product',
		message: 'Qu\'est-ce qui me rapporte le plus ?',
		expect: { type: 'QUESTION', domain: 'PRODUCTS', objective: 'RETRIEVE' },
	},
	{
		name: 'stock low savon',
		message: 'Mon stock de savon est-il bientôt épuisé ?',
		expect: { type: 'QUESTION', domain: 'STOCK', objective: 'RETRIEVE' },
	},
	{
		name: 'add expense action',
		message: 'Ajoute une dépense de 15$ pour le transport.',
		expect: { type: 'ACTION', domain: 'EXPENSES', objective: 'CREATE' },
	},
	{
		name: 'add sale action',
		message: 'Ajoute 5 cartons de Coca-Cola vendus à 20$.',
		expect: { type: 'ACTION', domain: 'SALES', objective: 'CREATE' },
	},
	{
		name: 'compare sales and expenses',
		message: 'Compare mes ventes et mes dépenses.',
		expect: { type: 'ANALYSIS', domain: 'PROFIT', objective: 'COMPARE' },
	},
	{
		name: 'mixed explain profit',
		message: 'Regarde mes ventes et mes dépenses et explique-moi pourquoi mon bénéfice baisse.',
		expect: { type: 'ANALYSIS', domain: 'PROFIT', objective: 'EXPLAIN' },
	},
	{
		name: 'other activity',
		message: 'Et dans mon autre activité ?',
		expect: { type: 'MIXED', domain: 'GENERAL', objective: 'RETRIEVE' },
	},
	{
		name: 'compare two activities',
		message: 'Compare ma boutique et mon pressing.',
		expect: { type: 'ANALYSIS', domain: 'GENERAL', objective: 'COMPARE' },
	},
	{
		name: 'confirmation with pending expense',
		message: 'Oui',
		context: {
			pendingWrite: { tool: 'create_expense', label: 'transport', amount: 15 },
		},
		expect: { type: 'ACTION', domain: 'EXPENSES', objective: 'CREATE' },
	},
];

for (const scenario of CLASSIFIER_SCENARIOS) {
	test(`goal classifier: ${scenario.name}`, async () => {
		const result = await classifyGoal(
			scenario.message,
			scenario.context || {},
			{ referenceDate: REFERENCE_DATE, forceRules: true },
		);

		assert.equal(result.valid, true, `classifier failed for: ${scenario.name}`);
		assert.equal(result.goal.type, scenario.expect.type);
		assert.equal(result.goal.domain, scenario.expect.domain);
		assert.equal(result.goal.objective, scenario.expect.objective);

		if (scenario.periodType) {
			assert.equal(result.goal.period?.type, scenario.periodType);
		}

		if (scenario.expect.objective === 'CREATE') {
			assert.equal(result.goal.parameters._classifierOnly, true);
		}
	});
}

test('classifier action goals never execute writes', async () => {
	const result = await classifyGoal(
		'Ajoute une dépense de 15$ pour le transport.',
		{},
		{ referenceDate: REFERENCE_DATE, forceRules: true },
	);
	assert.equal(result.goal.type, 'ACTION');
	assert.equal(result.goal.parameters.confirmed, false);
	assert.equal(result.goal.parameters._classifierOnly, true);
});

test('shadow diagnostic compares legacy intent and goal without side effects', async () => {
	const diagnostic = await runShadowGoalDiagnostic({
		message: 'Combien ai-je vendu ce mois-ci ?',
		conversationContext: {},
		legacyResolved: {
			intent: 'query_sales',
			filters: { period: 'current_month' },
		},
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(diagnostic.legacyIntent, 'query_sales');
	assert.equal(diagnostic.goal.type, 'QUESTION');
	assert.equal(diagnostic.aligned, true);
});

test('security: goal rejects SQL injection attempt', () => {
	const result = validateGoal({
		type: 'QUESTION',
		domain: 'GENERAL',
		objective: 'RETRIEVE',
		parameters: {
			note: 'select * from users',
		},
	});
	assert.equal(result.valid, false);
});

test('security: plan step rejects clientId in arguments', () => {
	const result = validatePlanStep({
		id: 'step_1',
		tool: 'get_sales',
		arguments: { clientId: 'x' },
		readOnly: true,
	}, { planRequiresConfirmation: false });
	assert.equal(result.valid, false);
});

test('financial truth: analysis plan has no embedded totals', () => {
	const period = currentMonthPeriod();
	const plan = validateAnalysisPlan({
		goal: createEmptyGoal({
			type: 'ANALYSIS',
			domain: 'PROFIT',
			objective: 'EXPLAIN',
			period,
		}),
		steps: [{
			id: 'step_1',
			tool: 'get_sales',
			arguments: { period: 'current_month' },
			readOnly: true,
		}],
		requiresConfirmation: false,
	});
	assert.equal(plan.valid, true);
	const serialized = JSON.stringify(plan.value).toLowerCase();
	assert.equal(serialized.includes('totalrevenue'), false);
});
