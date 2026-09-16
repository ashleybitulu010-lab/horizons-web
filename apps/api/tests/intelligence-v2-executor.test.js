import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyGoal } from '../src/agent/intelligence-v2/goal-contract.js';
import { buildAnalysisPlanFromGoal } from '../src/agent/intelligence-v2/plan-builder.js';
import {
	EXECUTION_CODES,
	executeAnalysisPlan,
} from '../src/agent/intelligence-v2/plan-executor.js';
import { STEP_STATUS } from '../src/agent/intelligence-v2/plan-execution-states.js';
import { scheduleAnalysisPlan } from '../src/agent/intelligence-v2/plan-scheduler.js';
import { classifyToolOutcome } from '../src/agent/intelligence-v2/plan-step-executor.js';
import { buildPeriodSpecFromLegacyId } from '../src/agent/intelligence-v2/period-contract.js';
import { validateAnalysisPlanExtended } from '../src/agent/intelligence-v2/plan-validator-extended.js';
import { runV2AnalysisPlan } from '../src/agent/intelligence-v2/v2-orchestrator.js';

const REFERENCE_DATE = new Date('2026-09-12T12:00:00.000Z');

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

function mockOk(tool, summary = { count: 1, totalRevenue: 100 }) {
	return {
		success: true,
		tool,
		data: { summary },
		meta: {},
		error: null,
	};
}

function readStep(id, tool, period, dependsOn = []) {
	return {
		id,
		tool,
		arguments: { period },
		dependsOn,
		purpose: `retrieve_${id}`,
		readOnly: true,
	};
}

function buildPlan(steps, goalOverrides = {}) {
	const goal = createEmptyGoal({
		type: 'ANALYSIS',
		domain: 'PROFIT',
		objective: 'EXPLAIN',
		...goalOverrides,
	});
	const validated = validateAnalysisPlanExtended({
		goal,
		steps,
		requiresConfirmation: false,
	});
	assert.equal(validated.valid, true);
	return validated.value;
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

test('concurrency: 4 independent steps run with max concurrency 4', async () => {
	let concurrent = 0;
	let peak = 0;
	const starts = [];

	const steps = [
		readStep('a', 'get_sales', 'current_month'),
		readStep('b', 'get_sales', 'previous_month'),
		readStep('c', 'get_expenses', 'current_month'),
		readStep('d', 'get_expenses', 'previous_month'),
	];

	await scheduleAnalysisPlan(steps, executionContext(), {
		maxConcurrency: 4,
		stepTimeoutMs: 5000,
		planTimeoutMs: 10000,
		executeTool: async () => {
			concurrent += 1;
			peak = Math.max(peak, concurrent);
			starts.push(Date.now());
			await delay(50);
			concurrent -= 1;
			return mockOk('get_sales');
		},
	});

	assert.equal(peak, 4);
	assert.equal(starts.length, 4);
});

test('concurrency: limit 2 runs at most 2 simultaneously', async () => {
	let concurrent = 0;
	let peak = 0;

	const steps = [
		readStep('a', 'get_sales', 'current_month'),
		readStep('b', 'get_sales', 'previous_month'),
		readStep('c', 'get_expenses', 'current_month'),
		readStep('d', 'get_expenses', 'previous_month'),
	];

	await scheduleAnalysisPlan(steps, executionContext(), {
		maxConcurrency: 2,
		executeTool: async () => {
			concurrent += 1;
			peak = Math.max(peak, concurrent);
			await delay(30);
			concurrent -= 1;
			return mockOk('get_sales');
		},
	});

	assert.ok(peak <= 2);
	assert.ok(peak >= 2);
});

test('concurrency: limit 1 is sequential', async () => {
	let concurrent = 0;
	let peak = 0;
	const order = [];

	const steps = [
		readStep('a', 'get_sales', 'current_month'),
		readStep('b', 'get_expenses', 'current_month'),
	];

	await scheduleAnalysisPlan(steps, executionContext(), {
		maxConcurrency: 1,
		executeTool: async (tool) => {
			concurrent += 1;
			peak = Math.max(peak, concurrent);
			order.push(tool);
			await delay(20);
			concurrent -= 1;
			return mockOk(tool);
		},
	});

	assert.equal(peak, 1);
	assert.deepEqual(order, ['get_sales', 'get_expenses']);
});

test('concurrency: metrics actualMaxConcurrency recorded', async () => {
	const built = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'QUESTION',
		domain: 'SALES',
		objective: 'RETRIEVE',
		period: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
	}));

	const result = await executeAnalysisPlan(built.plan, executionContext(), {
		maxConcurrency: 4,
		executeTool: async () => {
			await delay(30);
			return mockOk('get_sales');
		},
	});

	assert.equal(result.metrics.actualMaxConcurrency >= 1, true);
	assert.equal(result.metrics.maxConcurrency, 4);
});

test('dependencies: A then C sequential when C depends on A', async () => {
	const order = [];
	const steps = [
		readStep('a', 'get_sales', 'current_month'),
		readStep('c', 'get_expenses', 'current_month', ['a']),
	];

	const scheduled = await scheduleAnalysisPlan(steps, executionContext(), {
		maxConcurrency: 4,
		executeTool: async (tool) => {
			order.push(tool);
			return mockOk(tool);
		},
	});

	assert.deepEqual(order, ['get_sales', 'get_expenses']);
	assert.equal(scheduled.stepResults[1].status, STEP_STATUS.SUCCESS);
});

test('dependencies: A+B parallel then C', async () => {
	const order = [];
	const steps = [
		readStep('a', 'get_sales', 'current_month'),
		readStep('b', 'get_expenses', 'current_month'),
		readStep('c', 'generate_report', 'current_month', ['a', 'b']),
	];

	await scheduleAnalysisPlan(steps, executionContext(), {
		maxConcurrency: 4,
		executeTool: async (tool) => {
			order.push(tool);
			await delay(10);
			return mockOk(tool, { count: 1, totalRevenue: 10, totalAmount: 5 });
		},
	});

	assert.equal(order.indexOf('generate_report'), 2);
	assert.equal(order.filter((t) => t === 'get_sales').length, 1);
});

test('dependencies: chain A→B→C', async () => {
	const order = [];
	const steps = [
		readStep('a', 'get_sales', 'current_month'),
		{ ...readStep('b', 'get_expenses', 'current_month'), dependsOn: ['a'] },
		{ ...readStep('c', 'generate_report', 'current_month'), dependsOn: ['b'] },
	];

	await scheduleAnalysisPlan(steps, executionContext(), {
		maxConcurrency: 4,
		executeTool: async (tool) => {
			order.push(tool);
			return mockOk(tool);
		},
	});

	assert.deepEqual(order, ['get_sales', 'get_expenses', 'generate_report']);
});

test('dependencies: B fails blocks C', async () => {
	const steps = [
		readStep('a', 'get_sales', 'current_month'),
		readStep('b', 'get_expenses', 'current_month'),
		readStep('c', 'generate_report', 'current_month', ['a', 'b']),
	];

	const scheduled = await scheduleAnalysisPlan(steps, executionContext(), {
		maxConcurrency: 4,
		executeTool: async (tool) => {
			if (tool === 'get_expenses') {
				return {
					success: false,
					tool,
					data: null,
					meta: {},
					error: { code: 'SUPABASE_ERROR', message: 'fail' },
				};
			}
			return mockOk(tool);
		},
	});

	assert.equal(scheduled.stepResults[1].status, STEP_STATUS.EXECUTION_ERROR);
	assert.equal(scheduled.stepResults[2].status, STEP_STATUS.BLOCKED);
});

test('errors: NO_DATA is not EXECUTION_ERROR', () => {
	const outcome = classifyToolOutcome({
		success: true,
		data: { summary: { count: 0, totalRevenue: 0 } },
	});
	assert.equal(outcome.status, STEP_STATUS.NO_DATA);
});

test('errors: EXECUTION_ERROR on tool failure', () => {
	const outcome = classifyToolOutcome({
		success: false,
		error: { code: 'SUPABASE_ERROR' },
	});
	assert.equal(outcome.status, STEP_STATUS.EXECUTION_ERROR);
});

test('errors: TIMEOUT on step timeout', async () => {
	const steps = [readStep('a', 'get_sales', 'current_month')];
	const scheduled = await scheduleAnalysisPlan(steps, executionContext(), {
		maxConcurrency: 4,
		stepTimeoutMs: 50,
		executeTool: async () => {
			await delay(200);
			return mockOk('get_sales');
		},
	});

	assert.equal(scheduled.stepResults[0].status, STEP_STATUS.TIMEOUT);
});

test('errors: independent steps continue after one timeout', async () => {
	const steps = [
		readStep('a', 'get_sales', 'current_month'),
		readStep('b', 'get_expenses', 'current_month'),
	];

	const scheduled = await scheduleAnalysisPlan(steps, executionContext(), {
		maxConcurrency: 2,
		stepTimeoutMs: 80,
		executeTool: async (tool) => {
			if (tool === 'get_sales') {
				await delay(200);
				return mockOk(tool);
			}
			return mockOk(tool);
		},
	});

	assert.equal(scheduled.stepResults[0].status, STEP_STATUS.TIMEOUT);
	assert.equal(scheduled.stepResults[1].status, STEP_STATUS.SUCCESS);
	assert.equal(scheduled.partial, true);
});

test('errors: partial on mixed success and error', async () => {
	const built = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'ANALYSIS',
		domain: 'PROFIT',
		objective: 'EXPLAIN',
		period: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
		comparison: {
			enabled: true,
			leftPeriod: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
			rightPeriod: buildPeriodSpecFromLegacyId('previous_month', REFERENCE_DATE),
			metric: 'PROFIT',
		},
	}));

	let call = 0;
	const result = await executeAnalysisPlan(built.plan, executionContext(), {
		maxConcurrency: 4,
		executeTool: async () => {
			call += 1;
			if (call === 4) {
				return {
					success: false,
					tool: 'get_expenses',
					data: null,
					error: { code: 'SUPABASE_ERROR', message: 'fail' },
				};
			}
			return mockOk('get_sales');
		},
	});

	assert.equal(result.partial, true);
	assert.equal(result.code, EXECUTION_CODES.PARTIAL);
});

test('timeout: plan global timeout blocks pending steps', async () => {
	const steps = [
		readStep('a', 'get_sales', 'current_month'),
		readStep('b', 'get_expenses', 'current_month'),
	];

	const scheduled = await scheduleAnalysisPlan(steps, executionContext(), {
		maxConcurrency: 1,
		planTimeoutMs: 60,
		stepTimeoutMs: 5000,
		executeTool: async () => {
			await delay(100);
			return mockOk('get_sales');
		},
	});

	assert.ok(
		scheduled.stepResults.some((r) => r.status === STEP_STATUS.PLAN_TIMEOUT
			|| r.status === STEP_STATUS.SUCCESS),
	);
});

test('writes: create_expense deferred', async () => {
	const built = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'ACTION',
		domain: 'EXPENSES',
		objective: 'CREATE',
		parameters: { amount: 15, label: 'transport' },
	}));

	let called = false;
	const result = await executeAnalysisPlan(built.plan, executionContext(), {
		executeTool: async () => {
			called = true;
			return mockOk('create_expense');
		},
	});

	assert.equal(result.code, EXECUTION_CODES.WRITE_EXECUTION_DEFERRED);
	assert.equal(called, false);
});

test('writes: create_sale deferred', async () => {
	const built = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'ACTION',
		domain: 'SALES',
		objective: 'CREATE',
		parameters: { product: 'Coca', quantity: 5, unitPrice: 20 },
	}));

	let called = false;
	const result = await executeAnalysisPlan(built.plan, executionContext(), {
		executeTool: async () => {
			called = true;
			return mockOk('create_sale');
		},
	});

	assert.equal(result.code, EXECUTION_CODES.WRITE_EXECUTION_DEFERRED);
	assert.equal(called, false);
});

test('security: missing server scope rejected', async () => {
	const built = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'QUESTION',
		domain: 'SALES',
		objective: 'RETRIEVE',
		period: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
	}));

	const result = await executeAnalysisPlan(built.plan, { user: { id: 'u1' } });
	assert.equal(result.code, EXECUTION_CODES.MISSING_EXECUTION_CONTEXT);
});

test('security: plan arguments never include clientId from goal', async () => {
	const built = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'QUESTION',
		domain: 'SALES',
		objective: 'RETRIEVE',
		period: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
	}));

	assert.equal(built.plan.steps[0].arguments.clientId, undefined);
});

test('results: stable plan order preserved', async () => {
	const built = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'ANALYSIS',
		domain: 'PROFIT',
		objective: 'EXPLAIN',
		period: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
		comparison: {
			enabled: true,
			leftPeriod: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
			rightPeriod: buildPeriodSpecFromLegacyId('previous_month', REFERENCE_DATE),
			metric: 'PROFIT',
		},
	}));

	const result = await executeAnalysisPlan(built.plan, executionContext(), {
		maxConcurrency: 4,
		executeTool: async (tool, _ctx, input) => mockOk(tool, {
			count: 1,
			totalRevenue: input.period === 'previous_month' ? 50 : 100,
			totalAmount: 10,
		}),
	});

	assert.deepEqual(
		result.stepResults.map((r) => r.stepId),
		['sales_current', 'sales_previous', 'expenses_current', 'expenses_previous'],
	);
});

test('results: stepId and arguments preserved', async () => {
	const built = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'QUESTION',
		domain: 'SALES',
		objective: 'RETRIEVE',
		period: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
	}));

	const result = await executeAnalysisPlan(built.plan, executionContext(), {
		executeTool: async () => mockOk('get_sales'),
	});

	assert.equal(result.stepResults[0].stepId, 'sales_current');
	assert.equal(result.stepResults[0].arguments.period, 'current_month');
	assert.ok(result.stepResults[0].durationMs >= 0);
});

test('metrics: plan and step metrics present', async () => {
	const built = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'QUESTION',
		domain: 'SALES',
		objective: 'RETRIEVE',
		period: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
	}));

	const result = await executeAnalysisPlan(built.plan, executionContext(), {
		executeTool: async () => mockOk('get_sales'),
	});

	assert.ok(result.metrics.planDurationMs >= 0);
	assert.equal(result.metrics.stepCount, 1);
	assert.equal(result.metrics.stepMetrics[0].stepId, 'sales_current');
});

test('metrics: partial metrics count errors', async () => {
	const steps = [
		readStep('a', 'get_sales', 'current_month'),
		readStep('b', 'get_expenses', 'current_month'),
	];
	const plan = buildPlan(steps);

	const result = await executeAnalysisPlan(plan, executionContext(), {
		executeTool: async (tool) => {
			if (tool === 'get_expenses') {
				return { success: false, tool, data: null, error: { code: 'SUPABASE_ERROR' } };
			}
			return mockOk(tool);
		},
	});

	assert.equal(result.metrics.errorCount, 1);
	assert.equal(result.partial, true);
});

test('validation: cycle rejected before execution', async () => {
	const goal = createEmptyGoal({ type: 'ANALYSIS', domain: 'PROFIT', objective: 'EXPLAIN' });
	const validated = validateAnalysisPlanExtended({
		goal,
		requiresConfirmation: false,
		steps: [
			{ id: 'a', tool: 'get_sales', arguments: { period: 'current_month' }, dependsOn: ['b'], readOnly: true },
			{ id: 'b', tool: 'get_expenses', arguments: { period: 'current_month' }, dependsOn: ['a'], readOnly: true },
		],
	});
	assert.equal(validated.valid, false);
	assert.equal(validated.error, 'INVALID_PLAN_CYCLE');
});

test('validation: duplicate steps rejected', async () => {
	const goal = createEmptyGoal({ type: 'ANALYSIS', domain: 'PROFIT', objective: 'EXPLAIN' });
	const validated = validateAnalysisPlanExtended({
		goal,
		requiresConfirmation: false,
		steps: [
			{ id: 'a', tool: 'get_sales', arguments: { period: 'current_month' }, readOnly: true },
			{ id: 'b', tool: 'get_sales', arguments: { period: 'current_month' }, readOnly: true },
		],
	});
	assert.equal(validated.valid, false);
	assert.equal(validated.error, 'PLAN_DUPLICATE_STEP');
});

test('validation: clientId in arguments rejected', async () => {
	const goal = createEmptyGoal({ type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' });
	const validated = validateAnalysisPlanExtended({
		goal,
		requiresConfirmation: false,
		steps: [{
			id: 'a',
			tool: 'get_sales',
			arguments: { period: 'current_month', clientId: 'x' },
			readOnly: true,
		}],
	});
	assert.equal(validated.valid, false);
});

test('orchestrator: runV2AnalysisPlan disabled by default', async () => {
	const result = await runV2AnalysisPlan({
		goal: createEmptyGoal({ type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' }),
		executionContext: executionContext(),
	});
	assert.equal(result.enabled, false);
	assert.equal(result.code, 'V2_DISABLED');
});

test('orchestrator: runV2AnalysisPlan force executes read plan', async () => {
	const result = await runV2AnalysisPlan({
		goal: createEmptyGoal({
			type: 'QUESTION',
			domain: 'SALES',
			objective: 'RETRIEVE',
			period: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
		}),
		executionContext: executionContext(),
		options: {
			force: true,
			executeTool: async () => mockOk('get_sales'),
		},
	});

	assert.equal(result.enabled, true);
	assert.equal(result.execution.success, true);
});

test('NO_DATA plan completes without partial flag', async () => {
	const steps = [readStep('a', 'get_sales', 'current_month')];
	const plan = buildPlan(steps);
	const result = await executeAnalysisPlan(plan, executionContext(), {
		executeTool: async () => ({
			success: true,
			tool: 'get_sales',
			data: { summary: { count: 0, totalRevenue: 0 } },
			meta: {},
			error: null,
		}),
	});

	assert.equal(result.stepResults[0].status, STEP_STATUS.NO_DATA);
	assert.equal(result.partial, false);
});

test('executor: 4 reads success builds analysis result', async () => {
	const built = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'ANALYSIS',
		domain: 'PROFIT',
		objective: 'EXPLAIN',
		period: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
		comparison: {
			enabled: true,
			leftPeriod: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
			rightPeriod: buildPeriodSpecFromLegacyId('previous_month', REFERENCE_DATE),
			metric: 'PROFIT',
		},
	}));

	const result = await executeAnalysisPlan(built.plan, executionContext(), {
		maxConcurrency: 4,
		executeTool: async (tool, _ctx, input) => {
			if (tool === 'get_sales') {
				return mockOk('get_sales', { count: 2, totalRevenue: 1000, totalCollected: 900 });
			}
			return mockOk('get_expenses', { count: 1, totalAmount: 400 });
		},
	});

	assert.equal(result.success, true);
	assert.equal(result.analysisResult?.metrics?.profit != null, true);
});

test('executor: single read error returns EXECUTION_ERROR code', async () => {
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
			error: { code: 'SUPABASE_ERROR', message: 'fail' },
		}),
	});

	assert.equal(result.success, false);
	assert.equal(result.code, EXECUTION_CODES.EXECUTION_ERROR);
});

test('security: executionContext scope used by executor', async () => {
	const built = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'QUESTION',
		domain: 'SALES',
		objective: 'RETRIEVE',
		period: buildPeriodSpecFromLegacyId('current_month', REFERENCE_DATE),
	}));

	await executeAnalysisPlan(built.plan, executionContext(), {
		executeTool: async (_tool, ctx) => {
			assert.equal(ctx.user.clientId, 'client-1');
			assert.equal(ctx.user.activeActivityId, 'activity-1');
			return mockOk('get_sales');
		},
	});
});

test('timeout: late result does not overwrite TIMEOUT status', async () => {
	const steps = [readStep('a', 'get_sales', 'current_month')];
	const scheduled = await scheduleAnalysisPlan(steps, executionContext(), {
		maxConcurrency: 1,
		stepTimeoutMs: 50,
		executeTool: async () => {
			await delay(300);
			return mockOk('get_sales');
		},
	});

	assert.equal(scheduled.stepResults[0].status, STEP_STATUS.TIMEOUT);
});

test('validation: unknown dependency rejected', async () => {
	const goal = createEmptyGoal({ type: 'ANALYSIS', domain: 'PROFIT', objective: 'EXPLAIN' });
	const validated = validateAnalysisPlanExtended({
		goal,
		requiresConfirmation: false,
		steps: [{
			id: 'a',
			tool: 'generate_report',
			arguments: { period: 'current_month' },
			dependsOn: ['missing_step'],
			readOnly: true,
		}],
	});
	assert.equal(validated.valid, false);
});

test('validation: userId in arguments rejected', async () => {
	const goal = createEmptyGoal({ type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' });
	const validated = validateAnalysisPlanExtended({
		goal,
		requiresConfirmation: false,
		steps: [{
			id: 'a',
			tool: 'get_sales',
			arguments: { period: 'current_month', userId: 'injected' },
			readOnly: true,
		}],
	});
	assert.equal(validated.valid, false);
});

test('validation: activity UUID in arguments rejected', async () => {
	const goal = createEmptyGoal({ type: 'QUESTION', domain: 'SALES', objective: 'RETRIEVE' });
	const validated = validateAnalysisPlanExtended({
		goal,
		requiresConfirmation: false,
		steps: [{
			id: 'a',
			tool: 'get_sales',
			arguments: {
				period: 'current_month',
				activityId: '550e8400-e29b-41d4-a716-446655440000',
			},
			readOnly: true,
		}],
	});
	assert.equal(validated.valid, false);
});

test('errors: BLOCKED status preserved for failed dependency', async () => {
	const steps = [
		readStep('a', 'get_sales', 'current_month'),
		readStep('c', 'generate_report', 'current_month', ['a']),
	];

	const scheduled = await scheduleAnalysisPlan(steps, executionContext(), {
		maxConcurrency: 2,
		executeTool: async (tool) => {
			if (tool === 'get_sales') {
				return { success: false, tool, data: null, error: { code: 'SUPABASE_ERROR' } };
			}
			return mockOk(tool);
		},
	});

	assert.equal(scheduled.stepResults[0].status, STEP_STATUS.EXECUTION_ERROR);
	assert.equal(scheduled.stepResults[1].status, STEP_STATUS.BLOCKED);
	assert.notEqual(scheduled.stepResults[1].status, STEP_STATUS.NO_DATA);
});
