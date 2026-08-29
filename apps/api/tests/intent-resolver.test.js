import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveIntent } from '../src/agent/intent-resolver.js';

test('resolves current month sales query', async () => {
	const resolved = await resolveIntent('Combien ai-je vendu ce mois-ci ?');
	assert.equal(resolved.intent, 'query_sales');
	assert.equal(resolved.topic, 'sales');
	assert.equal(resolved.filters.period, 'current_month');
	assert.equal(resolved.needsTool, true);
	assert.equal(resolved.resolver, 'regex');
});

test('resolves previous month follow-up from conversation topic', async () => {
	const resolved = await resolveIntent('Et le mois dernier ?', {
		topic: 'sales',
		filters: { period: 'current_month' },
		references: { lastPeriod: 'current_month' },
	});
	assert.equal(resolved.intent, 'query_sales');
	assert.equal(resolved.filters.period, 'previous_month');
});

test('resolves compare intent with conversation references', async () => {
	const resolved = await resolveIntent('Compare les deux.', {
		topic: 'sales',
		references: {
			lastPeriod: 'previous_month',
			previousPeriod: 'current_month',
		},
	});
	assert.equal(resolved.intent, 'compare_sales');
	assert.deepEqual(resolved.filters.periods, ['current_month', 'previous_month']);
});

test('resolves compare intent with defaults when references are missing', async () => {
	const resolved = await resolveIntent('Compare les deux.', {
		topic: 'sales',
		filters: { period: 'previous_month' },
	});
	assert.equal(resolved.intent, 'compare_sales');
	assert.deepEqual(resolved.filters.periods, ['previous_month', 'current_month']);
});

test('resolves best product intent', async () => {
	const resolved = await resolveIntent('Quel produit s\'est le mieux vendu ?', {
		topic: 'sales',
		filters: { period: 'current_month' },
		references: { lastPeriod: 'current_month' },
	});
	assert.equal(resolved.intent, 'best_product');
	assert.equal(resolved.filters.period, 'current_month');
});

test('resolves generic sales query without prior context', async () => {
	const resolved = await resolveIntent('Combien ai-je vendu ?');
	assert.equal(resolved.intent, 'query_sales');
	assert.equal(resolved.filters.period, 'current_month');
	assert.equal(resolved.needsTool, true);
});

test('switches topic to expenses without sales follow-up', async () => {
	const resolved = await resolveIntent('Combien ai-je dépensé ?', {
		topic: 'sales',
		filters: { period: 'current_month' },
		references: { lastPeriod: 'current_month' },
	});
	assert.equal(resolved.intent, 'query_expenses');
	assert.equal(resolved.topic, 'expenses');
	assert.equal(resolved.needsTool, true);
	assert.equal(resolved.filters.period, 'current_month');
});

test('resolves expense current month query', async () => {
	const resolved = await resolveIntent('Combien ai-je dépensé ce mois-ci ?');
	assert.equal(resolved.intent, 'query_expenses');
	assert.equal(resolved.filters.period, 'current_month');
	assert.equal(resolved.needsTool, true);
});

test('resolves expense previous month follow-up from topic', async () => {
	const resolved = await resolveIntent('Et le mois dernier ?', {
		topic: 'expenses',
		references: { lastPeriod: 'current_month' },
	});
	assert.equal(resolved.intent, 'query_expenses');
	assert.equal(resolved.filters.period, 'previous_month');
});

test('resolves compare expenses from topic', async () => {
	const resolved = await resolveIntent('Compare les deux.', {
		topic: 'expenses',
		references: {
			lastPeriod: 'previous_month',
			previousPeriod: 'current_month',
		},
	});
	assert.equal(resolved.intent, 'compare_expenses');
	assert.deepEqual(resolved.filters.periods, ['current_month', 'previous_month']);
});

test('switches from expenses topic to sales query', async () => {
	const resolved = await resolveIntent('Combien ai-je vendu ?', {
		topic: 'expenses',
		references: { lastPeriod: 'current_month' },
	});
	assert.equal(resolved.intent, 'query_sales');
	assert.equal(resolved.topic, 'sales');
});

test('follow-up sales after expenses inherits period', async () => {
	const resolved = await resolveIntent('Et mes ventes ?', {
		topic: 'expenses',
		references: { lastPeriod: 'current_month' },
	});
	assert.equal(resolved.intent, 'query_sales');
	assert.equal(resolved.filters.period, 'current_month');
});

test('resolves generic stock query', async () => {
	const resolved = await resolveIntent('Quel est mon stock ?');
	assert.equal(resolved.intent, 'query_stock');
	assert.equal(resolved.topic, 'stock');
	assert.equal(resolved.needsTool, true);
});

test('resolves stock product filter', async () => {
	const resolved = await resolveIntent('Combien me reste-t-il de cahiers ?');
	assert.equal(resolved.intent, 'query_stock');
	assert.equal(resolved.filters.product, 'cahiers');
});

test('resolves low stock query', async () => {
	const resolved = await resolveIntent('Quels produits sont presque épuisés ?');
	assert.equal(resolved.intent, 'query_stock');
	assert.equal(resolved.filters.lowStockOnly, true);
});

test('switches from stock topic to sales query', async () => {
	const resolved = await resolveIntent('Combien ai-je vendu ?', {
		topic: 'stock',
		references: { lastProduct: 'Cahiers' },
	});
	assert.equal(resolved.intent, 'query_sales');
	assert.equal(resolved.topic, 'sales');
});

test('follow-up stock after expenses uses stock tool intent', async () => {
	const resolved = await resolveIntent('Et mon stock ?', {
		topic: 'expenses',
		references: { lastPeriod: 'current_month' },
	});
	assert.equal(resolved.intent, 'query_stock');
	assert.equal(resolved.topic, 'stock');
});
