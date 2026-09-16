#!/usr/bin/env node

import { scheduleAnalysisPlan } from '../apps/api/src/agent/intelligence-v2/plan-scheduler.js';

const DELAYS = {
	sales_current: 100,
	sales_previous: 200,
	expenses_current: 300,
	expenses_previous: 400,
};

function ctx() {
	return { user: { id: 'u1', clientId: 'c1', activeActivityId: 'a1' } };
}

function delay(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

const steps = [
	{ id: 'sales_current', tool: 'get_sales', arguments: { period: 'current_month' }, dependsOn: [], readOnly: true },
	{ id: 'sales_previous', tool: 'get_sales', arguments: { period: 'previous_month' }, dependsOn: [], readOnly: true },
	{ id: 'expenses_current', tool: 'get_expenses', arguments: { period: 'current_month' }, dependsOn: [], readOnly: true },
	{ id: 'expenses_previous', tool: 'get_expenses', arguments: { period: 'previous_month' }, dependsOn: [], readOnly: true },
];

async function runSequential() {
	const start = Date.now();
	for (const step of steps) {
		await delay(DELAYS[step.id]);
	}
	return Date.now() - start;
}

async function runParallel() {
	const start = Date.now();
	await scheduleAnalysisPlan(steps, ctx(), {
		maxConcurrency: 4,
		executeTool: async (_tool, _ctx, input) => {
			const key = Object.entries(steps.find((s) => s.arguments.period === input.period)?.id
				? { [steps.find((s) => s.arguments.period === input.period).id]: 0 }
				: {}).length ? steps.find((s) => s.arguments.period === input.period).id : 'sales_current';
			const step = steps.find((s) => s.arguments.period === input.period);
			await delay(DELAYS[step.id]);
			return { success: true, tool: step.tool, data: { summary: { count: 1 } }, meta: {}, error: null };
		},
	});
	return Date.now() - start;
}

async function runParallelFixed() {
	const start = Date.now();
	await scheduleAnalysisPlan(steps, ctx(), {
		maxConcurrency: 4,
		executeTool: async (tool, _ctx, input) => {
			const step = steps.find((s) => s.tool === tool && s.arguments.period === input.period);
			await delay(DELAYS[step.id]);
			return { success: true, tool, data: { summary: { count: 1 } }, meta: {}, error: null };
		},
	});
	return Date.now() - start;
}

const sequentialDuration = await runSequential();
const parallelDuration = await runParallelFixed();
const theoreticalMaximum = Math.max(...Object.values(DELAYS));
const speedup = Number((sequentialDuration / parallelDuration).toFixed(2));

console.log('ASHY V2 PARALLEL BENCHMARK\n');
console.log(`Sequential: ${sequentialDuration} ms`);
console.log(`Parallel:   ${parallelDuration} ms`);
console.log(`Theoretical max step: ${theoreticalMaximum} ms`);
console.log(`Speedup: ${speedup}x`);

if (parallelDuration < sequentialDuration * 0.7) {
	console.log('\nBENCHMARK PASS');
	process.exit(0);
}

console.log('\nBENCHMARK FAIL');
process.exit(1);
