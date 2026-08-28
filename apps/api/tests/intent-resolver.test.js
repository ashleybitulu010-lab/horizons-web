import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveIntent } from '../src/agent/intent-resolver.js';

test('resolves current month sales query', () => {
	const resolved = resolveIntent('Combien ai-je vendu ce mois-ci ?');
	assert.equal(resolved.intent, 'query_sales');
	assert.equal(resolved.filters.period, 'current_month');
});

test('resolves previous month follow-up from conversation topic', () => {
	const resolved = resolveIntent('Et le mois dernier ?', {
		topic: 'sales',
		filters: { period: 'current_month' },
	});
	assert.equal(resolved.intent, 'query_sales');
	assert.equal(resolved.filters.period, 'previous_month');
});

test('resolves compare intent', () => {
	const resolved = resolveIntent('Compare les deux.', {
		topic: 'sales',
		filters: { period: 'previous_month' },
	});
	assert.equal(resolved.intent, 'compare_sales');
	assert.deepEqual(resolved.filters.periods, ['current_month', 'previous_month']);
});

test('resolves best product intent', () => {
	const resolved = resolveIntent('Quel produit s\'est le mieux vendu ?', {
		topic: 'sales',
		filters: { period: 'current_month' },
	});
	assert.equal(resolved.intent, 'best_product');
});
