#!/usr/bin/env node

import { createEmptyGoal } from '../apps/api/src/agent/intelligence-v2/goal-contract.js';
import { buildAnalysisPlanFromGoal } from '../apps/api/src/agent/intelligence-v2/plan-builder.js';
import { EXECUTION_CODES, executeAnalysisPlan } from '../apps/api/src/agent/intelligence-v2/plan-executor.js';
import { STEP_STATUS } from '../apps/api/src/agent/intelligence-v2/plan-execution-states.js';
import { scheduleAnalysisPlan } from '../apps/api/src/agent/intelligence-v2/plan-scheduler.js';

function ctx() {
	return { user: { id: 'u1', clientId: 'c1', activeActivityId: 'a1' } };
}

function delay(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

function mockTool() {
	return { success: true, tool: 'get_sales', data: { summary: { count: 1 } }, meta: {}, error: null };
}

function readStep(id, tool, period, dependsOn = []) {
	return { id, tool, arguments: { period }, dependsOn, purpose: id, readOnly: true };
}

async function scenario1() {
	let peak = 0;
	let concurrent = 0;
	const steps = [
		readStep('sales_current', 'get_sales', 'current_month'),
		readStep('sales_previous', 'get_sales', 'previous_month'),
		readStep('expenses_current', 'get_expenses', 'current_month'),
		readStep('expenses_previous', 'get_expenses', 'previous_month'),
	];
	await scheduleAnalysisPlan(steps, ctx(), {
		maxConcurrency: 4,
		executeTool: async () => {
			concurrent += 1;
			peak = Math.max(peak, concurrent);
			await delay(40);
			concurrent -= 1;
			return mockTool();
		},
	});
	return peak === 4;
}

async function scenario2() {
	let peak = 0;
	let concurrent = 0;
	const steps = [
		readStep('sales_current', 'get_sales', 'current_month'),
		readStep('sales_previous', 'get_sales', 'previous_month'),
		readStep('expenses_current', 'get_expenses', 'current_month'),
		readStep('expenses_previous', 'get_expenses', 'previous_month'),
	];
	await scheduleAnalysisPlan(steps, ctx(), {
		maxConcurrency: 2,
		executeTool: async () => {
			concurrent += 1;
			peak = Math.max(peak, concurrent);
			await delay(40);
			concurrent -= 1;
			return mockTool();
		},
	});
	return peak <= 2 && peak >= 2;
}

async function scenario3() {
	const order = [];
	const steps = [
		readStep('a', 'get_sales', 'current_month'),
		readStep('b', 'get_expenses', 'current_month'),
		readStep('c', 'generate_report', 'current_month', ['a', 'b']),
	];
	await scheduleAnalysisPlan(steps, ctx(), {
		maxConcurrency: 4,
		executeTool: async (tool) => {
			order.push(tool);
			return mockTool();
		},
	});
	return order.indexOf('generate_report') === 2;
}

async function scenario4() {
	const steps = [
		readStep('a', 'get_sales', 'current_month'),
		readStep('b', 'get_expenses', 'current_month'),
	];
	const scheduled = await scheduleAnalysisPlan(steps, ctx(), {
		maxConcurrency: 2,
		stepTimeoutMs: 50,
		executeTool: async (tool) => {
			if (tool === 'get_sales') {
				await delay(150);
				return mockTool();
			}
			return mockTool();
		},
	});
	return scheduled.stepResults[0].status === STEP_STATUS.TIMEOUT
		&& scheduled.stepResults[1].status === STEP_STATUS.SUCCESS;
}

async function scenario5() {
	const built = buildAnalysisPlanFromGoal(createEmptyGoal({
		type: 'ACTION',
		domain: 'EXPENSES',
		objective: 'CREATE',
		parameters: { amount: 15, label: 'transport' },
	}));
	const result = await executeAnalysisPlan(built.plan, ctx());
	return result.code === EXECUTION_CODES.WRITE_EXECUTION_DEFERRED;
}

const SCENARIOS = [
	{ name: '4 reads concurrency 4', run: scenario1 },
	{ name: '4 reads concurrency 2', run: scenario2 },
	{ name: 'A+B→C dependencies', run: scenario3 },
	{ name: 'timeout isolation', run: scenario4 },
	{ name: 'write deferred', run: scenario5 },
];

console.log('ASHY V2 ORCHESTRATOR HARNESS\n');
let pass = 0;
for (const scenario of SCENARIOS) {
	const ok = await scenario.run();
	if (ok) pass += 1;
	console.log(`${scenario.name}: ${ok ? 'PASS' : 'FAIL'}`);
}
console.log(`\n${pass}/${SCENARIOS.length} PASS`);
