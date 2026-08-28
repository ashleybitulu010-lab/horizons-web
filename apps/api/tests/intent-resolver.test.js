import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveIntent } from '../src/agent/intent-resolver.js';

test('resolves current month sales query', () => {
	const resolved = resolveIntent('Combien ai-je vendu ce mois-ci ?');
	assert.equal(resolved.intent, 'query_sales');
	assert.equal(resolved.topic, 'sales');
	assert.equal(resolved.filters.period, 'current_month');
	assert.equal(resolved.needsTool, true);
	assert.equal(resolved.resolver, 'regex');
});

test('resolves previous month follow-up from conversation topic', () => {
	const resolved = resolveIntent('Et le mois dernier ?', {
		topic: 'sales',
		filters: { period: 'current_month' },
		references: { lastPeriod: 'current_month' },
	});
	assert.equal(resolved.intent, 'query_sales');
	assert.equal(resolved.filters.period, 'previous_month');
});

test('resolves compare intent with conversation references', () => {
	const resolved = resolveIntent('Compare les deux.', {
		topic: 'sales',
		references: {
			lastPeriod: 'previous_month',
			previousPeriod: 'current_month',
		},
	});
	assert.equal(resolved.intent, 'compare_sales');
	assert.deepEqual(resolved.filters.periods, ['current_month', 'previous_month']);
});

test('resolves compare intent with defaults when references are missing', () => {
	const resolved = resolveIntent('Compare les deux.', {
		topic: 'sales',
		filters: { period: 'previous_month' },
	});
	assert.equal(resolved.intent, 'compare_sales');
	assert.deepEqual(resolved.filters.periods, ['previous_month', 'current_month']);
});

test('resolves best product intent', () => {
	const resolved = resolveIntent('Quel produit s\'est le mieux vendu ?', {
		topic: 'sales',
		filters: { period: 'current_month' },
		references: { lastPeriod: 'current_month' },
	});
	assert.equal(resolved.intent, 'best_product');
	assert.equal(resolved.filters.period, 'current_month');
});

test('resolves generic sales query without prior context', () => {
	const resolved = resolveIntent('Combien ai-je vendu ?');
	assert.equal(resolved.intent, 'query_sales');
	assert.equal(resolved.filters.period, 'current_month');
	assert.equal(resolved.needsTool, true);
});

test('switches topic to expenses without sales follow-up', () => {
	const resolved = resolveIntent('Combien ai-je dépensé ?', {
		topic: 'sales',
		filters: { period: 'current_month' },
		references: { lastPeriod: 'current_month' },
	});
	assert.equal(resolved.intent, 'query_expenses');
	assert.equal(resolved.topic, 'expenses');
	assert.equal(resolved.needsTool, false);
});
