import assert from 'node:assert/strict';
import test from 'node:test';

import { runGetProducts, validateGetProductsInput } from '../src/tools/get-products.js';
import { assertToolResultShape } from '../src/utils/tool-result.js';
import {
	setProductsQueryImplForTests,
	resetProductsQueryImplForTests,
	summarizeProducts,
} from '../src/services/products-service.js';

const USER_A = {
	id: 'pb_a',
	clientId: 'client_a',
	businessUserId: 'rec_a',
};

const USER_B = {
	id: 'pb_b',
	clientId: 'client_b',
	businessUserId: 'rec_b',
};

const PRODUCTS_A = [
	{
		id: 'prod-a-1',
		client_id: 'client_a',
		nom_produit: 'Savon',
		categorie: 'Hygiène',
		prix_achat_unitaire: 500,
		prix_vente_unitaire: 800,
		created_at: '2026-08-01T10:00:00.000Z',
	},
	{
		id: 'prod-a-2',
		client_id: 'client_a',
		nom_produit: 'Cahiers',
		categorie: 'Fournitures',
		prix_achat_unitaire: 200,
		prix_vente_unitaire: 350,
		created_at: '2026-08-02T10:00:00.000Z',
	},
];

const PRODUCTS_B = [
	{
		id: 'prod-b-1',
		client_id: 'client_b',
		nom_produit: 'Poisson',
		categorie: 'Alimentaire',
		prix_achat_unitaire: 1000,
		prix_vente_unitaire: 1500,
		created_at: '2026-08-03T10:00:00.000Z',
	},
];

test.beforeEach(() => {
	setProductsQueryImplForTests(async (clientId, input) => {
		const rows = clientId === 'client_a' ? PRODUCTS_A : clientId === 'client_b' ? PRODUCTS_B : [];
		let filtered = [...rows];

		if (input.product) {
			const needle = input.product.toLowerCase();
			filtered = filtered.filter((row) => String(row.nom_produit).toLowerCase().includes(needle));
		}
		if (input.category) {
			const needle = input.category.toLowerCase();
			filtered = filtered.filter((row) => String(row.categorie || '').toLowerCase().includes(needle));
		}

		return filtered.slice(0, input.limit);
	});
});

test.afterEach(() => {
	resetProductsQueryImplForTests();
});

test('user A gets only products A', async () => {
	const result = await runGetProducts({ user: USER_A }, {});
	assert.equal(result.success, true);
	assert.equal(result.data.summary.count, 2);
	assert.equal(result.data.products[0].name, 'Savon');
});

test('user B gets only products B', async () => {
	const result = await runGetProducts({ user: USER_B }, {});
	assert.equal(result.success, true);
	assert.equal(result.data.summary.count, 1);
	assert.equal(result.data.products[0].name, 'Poisson');
});

test('product filter returns matching catalogue rows only', async () => {
	const result = await runGetProducts({ user: USER_A }, { product: 'Savon' });
	assert.equal(result.success, true);
	assert.equal(result.data.summary.count, 1);
	assert.equal(result.data.products[0].name, 'Savon');
	assert.equal(result.meta.product, 'Savon');
});

test('category filter returns matching catalogue rows only', async () => {
	const result = await runGetProducts({ user: USER_A }, { category: 'Fournitures' });
	assert.equal(result.success, true);
	assert.equal(result.data.summary.count, 1);
	assert.equal(result.data.products[0].name, 'Cahiers');
	assert.equal(result.meta.category, 'Fournitures');
});

test('limit is normalized through service input', async () => {
	const result = await runGetProducts({ user: USER_A }, { limit: 1 });
	assert.equal(result.success, true);
	assert.equal(result.data.summary.count, 1);
});

test('order meta is returned', async () => {
	const result = await runGetProducts({ user: USER_A }, { order: 'created_desc' });
	assert.equal(result.success, true);
	assert.equal(result.meta.order, 'created_desc');
});

test('forbidden clientId parameter is rejected', async () => {
	const result = await runGetProducts({ user: USER_A }, { clientId: 'client_b' });
	assert.equal(result.success, false);
	assert.equal(result.data, null);
	assert.equal(result.error.code, 'FORBIDDEN_PARAMETER');
});

test('forbidden businessUserId parameter is rejected', async () => {
	const result = await runGetProducts({ user: USER_A }, { businessUserId: 'rec_b' });
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'FORBIDDEN_PARAMETER');
});

test('missing client scope returns structured error', async () => {
	const result = await runGetProducts({ user: { id: 'pb_x' } }, {});
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'CLIENT_SCOPE_MISSING');
});

test('validateGetProductsInput rejects userId', () => {
	assert.throws(
		() => validateGetProductsInput({ userId: 'x' }),
		/Forbidden parameter for get_products: userId/,
	);
});

test('empty catalogue returns success with zero count', async () => {
	setProductsQueryImplForTests(async () => []);
	const result = await runGetProducts({ user: USER_A }, {});
	assert.equal(result.success, true);
	assert.equal(result.data.summary.count, 0);
	assert.deepEqual(result.data.products, []);
});

test('supabase query failure returns structured error', async () => {
	setProductsQueryImplForTests(async () => {
		const error = new Error('db down');
		error.code = 'SUPABASE_QUERY_FAILED';
		throw error;
	});
	const result = await runGetProducts({ user: USER_A }, {});
	assert.equal(result.success, false);
	assert.equal(result.data, null);
	assert.equal(result.error.code, 'SUPABASE_ERROR');
	assert.match(result.error.message, /products|catalogue|produits|data/i);
});

test('ToolResult shape is normalized', async () => {
	const result = assertToolResultShape(await runGetProducts({ user: USER_A }, {}));
	assert.equal(result.tool, 'get_products');
});

test('unauthenticated context is rejected', async () => {
	const result = await runGetProducts({ user: null }, {});
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'UNAUTHENTICATED');
});

test('summarizeProducts maps catalogue fields', () => {
	const summary = summarizeProducts(PRODUCTS_A);
	assert.equal(summary.count, 2);
	assert.equal(summary.categoryCount, 2);
	assert.equal(summary.products[0].purchasePrice, 500);
	assert.equal(summary.products[0].salePrice, 800);
});
