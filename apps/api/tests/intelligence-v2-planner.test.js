import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAnalysisPlan } from '../src/agent/intelligence-v2/analysis-plan-contract.js';
import { buildPeriodComparison } from '../src/agent/intelligence-v2/comparison-contract.js';
import { createEmptyGoal } from '../src/agent/intelligence-v2/goal-contract.js';
import { buildAnalysisPlanFromGoal } from '../src/agent/intelligence-v2/plan-builder.js';
import {
	EXECUTION_CODES,
	executeAnalysisPlan,
} from '../src/agent/intelligence-v2/plan-executor.js';
import {
	DEFAULT_MAX_PLAN_STEPS,
	validateAnalysisPlanExtended,
} from '../src/agent/intelligence-v2/plan-validator-extended.js';
import {
	buildPeriodSpecFromLegacyId,
} from '../src/agent/intelligence-v2/period-contract.js';

const REFERENCE_DATE = new Date('2026-09-12T12:00:00.000Z');

function profitExplainGoal() {
	const current = buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE);
	const previous = buildPeriodSpecFromLegacyId('previous_month', REFERENCE_DATE);
	return createEmptyGoal({
		type: 'ANALYSIS',
		domain: 'PROFIT',
		objective: 'EXPLAIN',
		period: current,
		comparison: buildPeriodComparison(current, previous, 'PROFIT'),
	});
}

function executionContext(overrides = {}) {
	return {
		user: {
			id: 'user-1',
			clientId: 'client-1',
			activeActivityId: 'activity-1',
			...overrides.user,
		},
	};
}

function mockSalesResult(period, revenue = 1000) {
	return {
		success: true,
		tool: 'get_sales',
		data: { summary: { count: 2, totalRevenue: revenue, totalCollected: revenue - 100 } },
		meta: { period },
		error: null,
	};
}

function mockExpensesResult(period, amount = 400) {
	return {
		success: true,
		tool: 'get_expenses',
		data: { summary: { count: 1, totalAmount: amount } },
		meta: { period },
		error: null,
	};
}

test('planner: QUESTION SALES → 1 step', () => {
	const result = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'QUESTION',
		domain: 'SALES',
		objective: 'RETRIEVE',
		period: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
	}));
	assert.equal(result.success, true);
	assert.equal(result.plan.steps.length, 1);
	assert.equal(result.plan.steps[0].tool, 'get_sales');
	assert.equal(result.plan.requiresConfirmation, false);
});

test('planner: QUESTION EXPENSES → 1 step', () => {
	const result = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'QUESTION',
		domain: 'EXPENSES',
		objective: 'RETRIEVE',
		period: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
	}));
	assert.equal(result.success, true);
	assert.equal(result.plan.steps[0].tool, 'get_expenses');
});

test('planner: QUESTION STOCK → 1 step', () => {
	const result = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'QUESTION',
		domain: 'STOCK',
		objective: 'RETRIEVE',
		parameters: { product: 'savon', lowStockOnly: true },
	}));
	assert.equal(result.success, true);
	assert.equal(result.plan.steps[0].tool, 'get_stock');
});

test('planner: QUESTION PRODUCTS → 1 step', () => {
	const result = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'QUESTION',
		domain: 'PRODUCTS',
		objective: 'RETRIEVE',
	}));
	assert.equal(result.success, true);
	assert.equal(result.plan.steps[0].tool, 'get_products');
});

test('planner: QUESTION DEBTS → 1 step', () => {
	const result = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'QUESTION',
		domain: 'DEBTS',
		objective: 'RETRIEVE',
	}));
	assert.equal(result.success, true);
	assert.equal(result.plan.steps[0].tool, 'get_debts');
});

test('planner: best product → get_sales', () => {
	const result = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'QUESTION',
		domain: 'PRODUCTS',
		objective: 'RETRIEVE',
		period: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
		parameters: { ranking: 'best_seller' },
	}));
	assert.equal(result.success, true);
	assert.equal(result.plan.steps[0].tool, 'get_sales');
});

test('planner: COMPARE SALES → 2 steps', () => {
	const current = buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE);
	const previous = buildPeriodSpecFromLegacyId('previous_month', REFERENCE_DATE);
	const result = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'ANALYSIS',
		domain: 'SALES',
		objective: 'COMPARE',
		comparison: buildPeriodComparison(current, previous, 'REVENUE'),
	}));
	assert.equal(result.success, true);
	assert.equal(result.plan.steps.length, 2);
	assert.ok(result.plan.steps.every((step) => step.tool === 'get_sales'));
});

test('planner: COMPARE EXPENSES → 2 steps', () => {
	const current = buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE);
	const previous = buildPeriodSpecFromLegacyId('previous_month', REFERENCE_DATE);
	const result = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'ANALYSIS',
		domain: 'EXPENSES',
		objective: 'COMPARE',
		comparison: buildPeriodComparison(current, previous, 'EXPENSES'),
	}));
	assert.equal(result.success, true);
	assert.equal(result.plan.steps.length, 2);
	assert.ok(result.plan.steps.every((step) => step.tool === 'get_expenses'));
});

test('planner: PROFIT EXPLAIN → 4 steps', () => {
	const result = buildAnalysisPlanFromGoal(profitExplainGoal());
	assert.equal(result.success, true);
	assert.equal(result.plan.steps.length, 4);
	const tools = result.plan.steps.map((step) => step.tool);
	assert.deepEqual(tools, ['get_sales', 'get_sales', 'get_expenses', 'get_expenses']);
	assert.ok(result.plan.steps.every((step) => step.readOnly === true));
});

test('planner: PROFIT COMPARE cross-period → 4 steps', () => {
	const current = buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE);
	const previous = buildPeriodSpecFromLegacyId('previous_month', REFERENCE_DATE);
	const result = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'ANALYSIS',
		domain: 'PROFIT',
		objective: 'COMPARE',
		comparison: buildPeriodComparison(current, previous, 'PROFIT'),
	}));
	assert.equal(result.success, true);
	assert.equal(result.plan.steps.length, 4);
});

test('planner: PROFIT COMPARE same period → 2 steps', () => {
	const result = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'ANALYSIS',
		domain: 'PROFIT',
		objective: 'COMPARE',
		period: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
	}));
	assert.equal(result.success, true);
	assert.equal(result.plan.steps.length, 2);
	assert.deepEqual(
		result.plan.steps.map((step) => step.tool),
		['get_sales', 'get_expenses'],
	);
});

test('planner: CREATE EXPENSE → write proposal + confirmation', () => {
	const result = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'ACTION',
		domain: 'EXPENSES',
		objective: 'CREATE',
		parameters: { amount: 15, label: 'transport' },
	}));
	assert.equal(result.success, true);
	assert.equal(result.plan.requiresConfirmation, true);
	assert.equal(result.plan.steps[0].tool, 'create_expense');
	assert.equal(result.plan.steps[0].readOnly, false);
});

test('planner: CREATE SALE → write proposal + confirmation', () => {
	const result = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'ACTION',
		domain: 'SALES',
		objective: 'CREATE',
		parameters: { product: 'Coca-Cola', quantity: 5, unitPrice: 20 },
	}));
	assert.equal(result.success, true);
	assert.equal(result.plan.requiresConfirmation, true);
	assert.equal(result.plan.steps[0].tool, 'create_sale');
});

test('planner: MIXED goal → unsupported', () => {
	const result = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'MIXED',
		domain: 'GENERAL',
		objective: 'RETRIEVE',
	}));
	assert.equal(result.success, false);
	assert.equal(result.reason, 'UNSUPPORTED_GOAL');
});

test('validation: unknown tool → reject', () => {
	const goal = profitExplainGoal();
	const result = validateAnalysisPlanExtended({
		goal,
		requiresConfirmation: false,
		steps: [{
			id: 'bad_step',
			tool: 'nonexistent_tool',
			arguments: {},
			readOnly: true,
		}],
	});
	assert.equal(result.valid, false);
});

test('validation: clientId in arguments → reject', () => {
	const goal = profitExplainGoal();
	const result = validateAnalysisPlan({
		goal,
		requiresConfirmation: false,
		steps: [{
			id: 'step_1',
			tool: 'get_sales',
			arguments: { clientId: 'x', period: 'current_month' },
			readOnly: true,
		}],
	});
	assert.equal(result.valid, false);
});

test('validation: write without confirmation → reject', () => {
	const goal = createEmptyGoal({
		type: 'ACTION',
		domain: 'EXPENSES',
		objective: 'CREATE',
		parameters: { amount: 15, label: 'transport' },
	});
	const result = validateAnalysisPlan({
		goal,
		requiresConfirmation: false,
		steps: [{
			id: 'expense_proposal',
			tool: 'create_expense',
			arguments: { amount: 15, label: 'transport' },
			readOnly: false,
		}],
	});
	assert.equal(result.valid, false);
});

test('validation: duplicate step → reject', () => {
	const goal = profitExplainGoal();
	const result = validateAnalysisPlanExtended({
		goal,
		requiresConfirmation: false,
		steps: [
			{ id: 'a', tool: 'get_sales', arguments: { period: 'current_month' }, readOnly: true },
			{ id: 'b', tool: 'get_sales', arguments: { period: 'current_month' }, readOnly: true },
		],
	});
	assert.equal(result.valid, false);
	assert.equal(result.error, 'PLAN_DUPLICATE_STEP');
});

test('validation: dependency cycle → reject', () => {
	const goal = profitExplainGoal();
	const result = validateAnalysisPlanExtended({
		goal,
		requiresConfirmation: false,
		steps: [
			{ id: 'a', tool: 'get_sales', arguments: { period: 'current_month' }, dependsOn: ['b'], readOnly: true },
			{ id: 'b', tool: 'get_expenses', arguments: { period: 'current_month' }, dependsOn: ['a'], readOnly: true },
		],
	});
	assert.equal(result.valid, false);
	assert.equal(result.error, 'INVALID_PLAN_CYCLE');
});

test('validation: too many steps → reject', () => {
	const goal = profitExplainGoal();
	const steps = Array.from({ length: DEFAULT_MAX_PLAN_STEPS + 1 }, (_, index) => ({
		id: `step_${index}`,
		tool: 'get_sales',
		arguments: { period: `period_${index}` },
		readOnly: true,
	}));
	const result = validateAnalysisPlanExtended({ goal, requiresConfirmation: false, steps });
	assert.equal(result.valid, false);
	assert.equal(result.error, 'PLAN_TOO_MANY_STEPS');
});

test('executor: single read success', async () => {
	const built = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'QUESTION',
		domain: 'SALES',
		objective: 'RETRIEVE',
		period: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
	}));
	const result = await executeAnalysisPlan(built.plan, executionContext(), {
		executeTool: async () => mockSalesResult('current_month'),
	});
	assert.equal(result.success, true);
	assert.equal(result.code, EXECUTION_CODES.SUCCESS);
	assert.equal(result.toolResults.length, 1);
});

test('executor: single read empty data', async () => {
	const built = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'QUESTION',
		domain: 'SALES',
		objective: 'RETRIEVE',
		period: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
	}));
	const result = await executeAnalysisPlan(built.plan, executionContext(), {
		executeTool: async () => ({
			success: true,
			tool: 'get_sales',
			data: { summary: { count: 0, totalRevenue: 0, totalCollected: 0 } },
			meta: { period: 'current_month' },
			error: null,
		}),
	});
	assert.equal(result.success, true);
	assert.equal(result.stepOutcomes[0].status, 'NO_DATA');
});

test('executor: single read error', async () => {
	const built = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'QUESTION',
		domain: 'SALES',
		objective: 'RETRIEVE',
		period: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
	}));
	const result = await executeAnalysisPlan(built.plan, executionContext(), {
		executeTool: async () => ({
			success: false,
			tool: 'get_sales',
			data: null,
			meta: {},
			error: { code: 'SUPABASE_ERROR', message: 'Unable to retrieve sales data' },
		}),
	});
	assert.equal(result.success, false);
	assert.equal(result.stepOutcomes[0].status, 'EXECUTION_ERROR');
	assert.equal(result.stepOutcomes[0].code, 'SUPABASE_ERROR');
});

test('executor: 4 reads success', async () => {
	const built = buildAnalysisPlanFromGoal(profitExplainGoal());
	const result = await executeAnalysisPlan(built.plan, executionContext(), {
		executeTool: async (_tool, _ctx, input) => {
			if (_tool === 'get_sales') return mockSalesResult(input.period);
			return mockExpensesResult(input.period);
		},
	});
	assert.equal(result.success, true);
	assert.equal(result.toolResults.length, 4);
	assert.equal(result.analysisResult?.metrics?.profit != null, true);
});

test('executor: partial execution', async () => {
	const built = buildAnalysisPlanFromGoal(profitExplainGoal());
	let call = 0;
	const result = await executeAnalysisPlan(built.plan, executionContext(), {
		executeTool: async () => {
			call += 1;
			if (call === 4) {
				return {
					success: false,
					tool: 'get_expenses',
					data: null,
					meta: {},
					error: { code: 'SUPABASE_ERROR', message: 'fail' },
				};
			}
			return mockSalesResult('current_month');
		},
	});
	assert.equal(result.partial, true);
	assert.equal(result.code, EXECUTION_CODES.PARTIAL);
});

test('executor: write execution deferred', async () => {
	const built = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'ACTION',
		domain: 'EXPENSES',
		objective: 'CREATE',
		parameters: { amount: 15, label: 'transport' },
	}));
	const result = await executeAnalysisPlan(built.plan, executionContext());
	assert.equal(result.code, EXECUTION_CODES.WRITE_EXECUTION_DEFERRED);
	assert.deepEqual(result.deferredSteps, ['expense_proposal']);
});

test('security: executionContext must provide scope', async () => {
	const built = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'QUESTION',
		domain: 'SALES',
		objective: 'RETRIEVE',
		period: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
	}));
	const result = await executeAnalysisPlan(built.plan, { user: { id: 'u1' } });
	assert.equal(result.code, EXECUTION_CODES.MISSING_EXECUTION_CONTEXT);
});

test('security: goal cannot override executionContext scope', async () => {
	const built = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'QUESTION',
		domain: 'SALES',
		objective: 'RETRIEVE',
		period: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
	}));
	assert.equal(built.plan.steps[0].arguments.clientId, undefined);
	const result = await executeAnalysisPlan(built.plan, executionContext(), {
		executeTool: async (_tool, ctx) => {
			assert.equal(ctx.user.clientId, 'client-1');
			assert.equal(ctx.user.activeActivityId, 'activity-1');
			return mockSalesResult('current_month');
		},
	});
	assert.equal(result.success, true);
});
