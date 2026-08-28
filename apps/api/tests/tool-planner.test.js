import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PLANNED_READ_TOOLS,
	PLANNED_WRITE_TOOLS,
	planToolExecution,
	primaryToolForIntent,
} from '../src/agent/tool-planner.js';

test('query_sales produces a generic read step', () => {
	const plan = planToolExecution({
		intent: 'query_sales',
		topic: 'sales',
		filters: { period: 'current_month' },
	});
	assert.equal(plan.steps.length, 1);
	assert.equal(plan.steps[0].tool, 'get_sales');
	assert.deepEqual(plan.steps[0].input, { period: 'current_month' });
	assert.equal(plan.responseKind, 'query_sales');
	assert.equal(plan.referenceUpdate.type, 'period');
});

test('compare_sales produces one step per period', () => {
	const plan = planToolExecution({
		intent: 'compare_sales',
		topic: 'sales',
		filters: { periods: ['previous_month', 'current_month'] },
	});
	assert.equal(plan.steps.length, 2);
	assert.deepEqual(plan.steps.map((step) => step.input.period), ['previous_month', 'current_month']);
	assert.equal(plan.responseKind, 'compare_sales');
});

test('best_product keeps postProcess metadata on the step', () => {
	const plan = planToolExecution({
		intent: 'best_product',
		topic: 'sales',
		filters: { period: 'current_month' },
	});
	assert.equal(plan.steps[0].postProcess, 'best_product');
	assert.equal(plan.responseKind, 'best_product');
});

test('future read intents return unimplemented plans without steps', () => {
	for (const intent of Object.keys(PLANNED_READ_TOOLS)) {
		const plan = planToolExecution({ intent, topic: intent.replace('query_', ''), filters: {} });
		assert.equal(plan.steps.length, 0);
		assert.equal(plan.unimplementedTool, PLANNED_READ_TOOLS[intent]);
	}
});

test('future write intents return unimplemented write plans', () => {
	for (const intent of Object.keys(PLANNED_WRITE_TOOLS)) {
		const plan = planToolExecution({ intent, topic: 'sales', filters: {} });
		assert.equal(plan.steps.length, 0);
		assert.equal(plan.responseKind, 'unimplemented_write');
		assert.equal(plan.unimplementedTool, PLANNED_WRITE_TOOLS[intent]);
	}
});

test('primaryToolForIntent maps intents to tool names', () => {
	assert.equal(primaryToolForIntent('query_sales'), 'get_sales');
	assert.equal(primaryToolForIntent('query_expenses'), 'get_expenses');
	assert.equal(primaryToolForIntent('create_sale'), 'create_sale');
});
