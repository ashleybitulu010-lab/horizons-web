import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveIntent } from '../src/agent/intent-resolver.js';
import {
	setChatCompletionImplForTests,
	setForceLlmResolverForTests,
	setForceRegexResolverForTests,
	resetIntentResolverTestOverrides,
} from '../src/agent/intent-resolver/index.js';

test.beforeEach(() => {
	resetIntentResolverTestOverrides();
	setForceRegexResolverForTests(true);
});

test.afterEach(() => {
	resetIntentResolverTestOverrides();
});

test('regex resolves generic products catalogue query', async () => {
	const resolved = await resolveIntent('Quels sont mes produits ?');
	assert.equal(resolved.intent, 'query_products');
	assert.equal(resolved.topic, 'products');
	assert.equal(resolved.needsTool, true);
});

test('regex resolves list products query', async () => {
	const resolved = await resolveIntent('Liste mes produits');
	assert.equal(resolved.intent, 'query_products');
});

test('regex resolves give me products query', async () => {
	const resolved = await resolveIntent('Donne-moi mes produits');
	assert.equal(resolved.intent, 'query_products');
});

test('regex resolves products I sell query as catalogue', async () => {
	const resolved = await resolveIntent('Quels produits je vends ?');
	assert.equal(resolved.intent, 'query_products');
	assert.notEqual(resolved.intent, 'best_product');
});

test('regex resolves product count catalogue query', async () => {
	const resolved = await resolveIntent('Combien de produits ?');
	assert.equal(resolved.intent, 'query_products');
});

test('regex resolves product search filter', async () => {
	const resolved = await resolveIntent('Mes produits savon');
	assert.equal(resolved.intent, 'query_products');
	assert.equal(resolved.filters.product, 'savon');
});

test('regex resolves category filter', async () => {
	const resolved = await resolveIntent('Quels sont mes produits de la catégorie Hygiène ?');
	assert.equal(resolved.intent, 'query_products');
	assert.equal(resolved.filters.category, 'Hygiène');
});

test('regex keeps stock routing for remaining quantity', async () => {
	const resolved = await resolveIntent('Combien me reste-t-il de savon ?');
	assert.equal(resolved.intent, 'query_stock');
	assert.equal(resolved.filters.product, 'savon');
});

test('regex keeps stock routing for generic stock question', async () => {
	const resolved = await resolveIntent('Quel est mon stock ?');
	assert.equal(resolved.intent, 'query_stock');
});

test('regex keeps stock routing for low stock question', async () => {
	const resolved = await resolveIntent('Quels produits sont presque épuisés ?');
	assert.equal(resolved.intent, 'query_stock');
	assert.equal(resolved.filters.lowStockOnly, true);
});

test('regex keeps best product routing for sales ranking', async () => {
	const resolved = await resolveIntent('Quel est mon meilleur produit ?');
	assert.equal(resolved.intent, 'best_product');
});

test('regex resolves products follow-up', async () => {
	const resolved = await resolveIntent('Et mes produits ?');
	assert.equal(resolved.intent, 'query_products');
});

test('regex inherits products filters on follow-up topic', async () => {
	const resolved = await resolveIntent('Et en Hygiène ?', {
		topic: 'products',
		filters: { category: 'Hygiène' },
		references: { lastEntity: 'products' },
	});
	assert.equal(resolved.intent, 'query_products');
	assert.equal(resolved.filters.category, 'Hygiène');
});

test('LLM resolver returns query_products when mock succeeds', async () => {
	setForceRegexResolverForTests(false);
	setForceLlmResolverForTests(true);
	setChatCompletionImplForTests(async () => JSON.stringify({
		intent: 'query_products',
		topic: 'products',
		filters: { product: 'Savon' },
		references: {},
		needsTool: true,
		needsClarification: false,
	}));

	const resolved = await resolveIntent('Montre-moi mes produits savon');
	assert.equal(resolved.resolver, 'llm');
	assert.equal(resolved.intent, 'query_products');
	assert.equal(resolved.filters.product, 'Savon');
});

test('LLM invalid JSON falls back to regex products routing', async () => {
	setForceRegexResolverForTests(false);
	setForceLlmResolverForTests(true);
	setChatCompletionImplForTests(async () => 'not-json');

	const resolved = await resolveIntent('Quels sont mes produits ?');
	assert.equal(resolved.resolver, 'regex');
	assert.equal(resolved.intent, 'query_products');
	assert.equal(resolved.resolverMeta?.fallback, true);
});
