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

test('query_expenses produces a generic read step', () => {
	const plan = planToolExecution({
		intent: 'query_expenses',
		topic: 'expenses',
		filters: { period: 'current_month' },
	});
	assert.equal(plan.steps.length, 1);
	assert.equal(plan.steps[0].tool, 'get_expenses');
	assert.deepEqual(plan.steps[0].input, { period: 'current_month' });
	assert.equal(plan.responseKind, 'query_expenses');
	assert.equal(plan.referenceUpdate.entity, 'expenses');
});

test('query_stock produces a generic read step', () => {
	const plan = planToolExecution({
		intent: 'query_stock',
		topic: 'stock',
		filters: { product: 'Cahiers' },
	});
	assert.equal(plan.steps.length, 1);
	assert.equal(plan.steps[0].tool, 'get_stock');
	assert.deepEqual(plan.steps[0].input, { product: 'Cahiers' });
	assert.equal(plan.responseKind, 'query_stock');
});

test('query_stock lowStockOnly uses low_stock response kind', () => {
	const plan = planToolExecution({
		intent: 'query_stock',
		topic: 'stock',
		filters: { lowStockOnly: true },
	});
	assert.equal(plan.steps[0].input.lowStockOnly, true);
	assert.equal(plan.responseKind, 'low_stock');
});

test('query_debts produces a generic read step', () => {
	const plan = planToolExecution({
		intent: 'query_debts',
		topic: 'debts',
		filters: { status: 'unpaid' },
	});
	assert.equal(plan.steps.length, 1);
	assert.equal(plan.steps[0].tool, 'get_debts');
	assert.deepEqual(plan.steps[0].input, { status: 'unpaid' });
	assert.equal(plan.responseKind, 'query_debts');
	assert.equal(plan.referenceUpdate.entity, 'debts');
});

test('query_products produces a generic read step', () => {
	const plan = planToolExecution({
		intent: 'query_products',
		topic: 'products',
		filters: { product: 'Savon', category: 'Hygiène' },
	});
	assert.equal(plan.steps.length, 1);
	assert.equal(plan.steps[0].tool, 'get_products');
	assert.deepEqual(plan.steps[0].input, { product: 'Savon', category: 'Hygiène' });
	assert.equal(plan.responseKind, 'query_products');
	assert.equal(plan.referenceUpdate.entity, 'products');
});

test('generate_report produces a single read step', () => {
	const plan = planToolExecution({
		intent: 'generate_report',
		topic: 'report',
		filters: { period: 'current_month' },
	});
	assert.equal(plan.steps.length, 1);
	assert.equal(plan.steps[0].tool, 'generate_report');
	assert.deepEqual(plan.steps[0].input, { period: 'current_month' });
	assert.equal(plan.responseKind, 'generate_report');
	assert.equal(plan.referenceUpdate.entity, 'report');
});

test('compare_expenses produces one step per period', () => {
	const plan = planToolExecution({
		intent: 'compare_expenses',
		topic: 'expenses',
		filters: { periods: ['previous_month', 'current_month'] },
	});
	assert.equal(plan.steps.length, 2);
	assert.deepEqual(plan.steps.map((step) => step.tool), ['get_expenses', 'get_expenses']);
	assert.equal(plan.responseKind, 'compare_expenses');
});

test('compare_sales_expenses produces sales and expenses steps', () => {
	const plan = planToolExecution({
		intent: 'compare_sales_expenses',
		topic: 'mixed',
		filters: { period: 'current_month' },
	});
	assert.equal(plan.steps.length, 2);
	assert.deepEqual(plan.steps.map((step) => step.tool), ['get_sales', 'get_expenses']);
	assert.equal(plan.responseKind, 'compare_sales_expenses');
});

test('future read intents return unimplemented plans without steps', () => {
	for (const intent of Object.keys(PLANNED_READ_TOOLS)) {
		const plan = planToolExecution({ intent, topic: intent.replace('query_', ''), filters: {} });
		assert.equal(plan.steps.length, 0);
		assert.equal(plan.unimplementedTool, PLANNED_READ_TOOLS[intent]);
	}
});

test('create_sale produces a write step with confirmation flag', () => {
	const plan = planToolExecution({
		intent: 'create_sale',
		topic: 'sales',
		filters: {
			product: 'Poulet',
			quantity: 2,
			unitPrice: 10,
			amountPaid: 20,
			confirmed: false,
		},
	});
	assert.equal(plan.steps.length, 1);
	assert.equal(plan.steps[0].tool, 'create_sale');
	assert.deepEqual(plan.steps[0].input, {
		product: 'Poulet',
		quantity: 2,
		unitPrice: 10,
		amountPaid: 20,
		confirmed: false,
	});
	assert.equal(plan.responseKind, 'create_sale');
});

test('create_expense produces a write step with confirmation flag', () => {
	const plan = planToolExecution({
		intent: 'create_expense',
		topic: 'expenses',
		filters: {
			label: 'transport',
			amount: 20,
			confirmed: false,
		},
	});
	assert.equal(plan.steps.length, 1);
	assert.equal(plan.steps[0].tool, 'create_expense');
	assert.deepEqual(plan.steps[0].input, {
		label: 'transport',
		amount: 20,
		confirmed: false,
	});
	assert.equal(plan.responseKind, 'create_expense');
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
	assert.equal(primaryToolForIntent('query_stock'), 'get_stock');
	assert.equal(primaryToolForIntent('query_debts'), 'get_debts');
	assert.equal(primaryToolForIntent('query_products'), 'get_products');
	assert.equal(primaryToolForIntent('generate_report'), 'generate_report');
	assert.equal(primaryToolForIntent('compare_expenses'), 'get_expenses');
	assert.equal(primaryToolForIntent('create_sale'), 'create_sale');
	assert.equal(primaryToolForIntent('create_expense'), 'create_expense');
});
