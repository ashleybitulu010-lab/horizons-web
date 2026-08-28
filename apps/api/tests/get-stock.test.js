import assert from 'node:assert/strict';
import test from 'node:test';

import { runGetStock, validateGetStockInput } from '../src/tools/get-stock.js';
import { assertToolResultShape } from '../src/utils/tool-result.js';
import {
	setStockQueryImplForTests,
	resetStockQueryImplForTests,
	summarizeStock,
} from '../src/services/stock-service.js';

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

const STOCKS_A = [
	{
		numero: 1,
		client_id: 'client_a',
		produit_id: 'prod-a-1',
		nom_article: 'Cahiers',
		stock_initial: 0,
		entrees: 20,
		sorties: 5,
		stock_actuel: 15,
		seuil_alerte: 5,
	},
	{
		numero: 2,
		client_id: 'client_a',
		produit_id: 'prod-a-2',
		nom_article: 'Stylos',
		stock_initial: 0,
		entrees: 3,
		sorties: 1,
		stock_actuel: 2,
		seuil_alerte: 5,
	},
];

const STOCKS_B = [
	{
		numero: 3,
		client_id: 'client_b',
		produit_id: 'prod-b-1',
		nom_article: 'Poisson',
		stock_initial: 0,
		entrees: 10,
		sorties: 0,
		stock_actuel: 10,
		seuil_alerte: 2,
	},
];

const PRODUCTS_A = [
	{ id: 'prod-a-1', client_id: 'client_a', nom_produit: 'Cahiers', categorie: 'Fournitures' },
	{ id: 'prod-a-2', client_id: 'client_a', nom_produit: 'Stylos', categorie: 'Fournitures' },
];

test.beforeEach(() => {
	setStockQueryImplForTests(async (clientId) => {
		if (clientId === 'client_a') return { stocks: STOCKS_A, products: PRODUCTS_A };
		if (clientId === 'client_b') return { stocks: STOCKS_B, products: [] };
		return { stocks: [], products: [] };
	});
});

test.afterEach(() => {
	resetStockQueryImplForTests();
});

test('user A gets only stock A', async () => {
	const result = await runGetStock({ user: USER_A }, {});
	assert.equal(result.success, true);
	assert.equal(result.data.summary.count, 2);
	assert.equal(result.data.summary.totalQuantity, 17);
});

test('user B gets only stock B', async () => {
	const result = await runGetStock({ user: USER_B }, {});
	assert.equal(result.success, true);
	assert.equal(result.data.summary.count, 1);
	assert.equal(result.data.summary.totalQuantity, 10);
});

test('forbidden clientId parameter is rejected', async () => {
	const result = await runGetStock({ user: USER_A }, { clientId: 'client_b' });
	assert.equal(result.success, false);
	assert.equal(result.data, null);
	assert.equal(result.error.code, 'FORBIDDEN_PARAMETER');
});

test('missing client scope returns structured error', async () => {
	const result = await runGetStock({ user: { id: 'pb_x' } }, {});
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'CLIENT_SCOPE_MISSING');
});

test('product filter returns matching stock only', async () => {
	const result = await runGetStock({ user: USER_A }, { product: 'Cahiers' });
	assert.equal(result.success, true);
	assert.equal(result.data.summary.count, 1);
	assert.equal(result.data.items[0].name, 'Cahiers');
	assert.equal(result.data.items[0].quantity, 15);
});

test('lowStockOnly returns only low items', async () => {
	const result = await runGetStock({ user: USER_A }, { lowStockOnly: true });
	assert.equal(result.success, true);
	assert.equal(result.data.summary.lowStockCount, result.data.summary.count);
	assert.ok(result.data.items.every((item) => item.isLow));
});

test('empty stock returns success with zero count', async () => {
	setStockQueryImplForTests(async () => ({ stocks: [], products: [] }));
	const result = await runGetStock({ user: USER_A }, {});
	assert.equal(result.success, true);
	assert.equal(result.data.summary.count, 0);
});

test('supabase query failure returns structured error', async () => {
	setStockQueryImplForTests(async () => {
		const error = new Error('db down');
		error.code = 'SUPABASE_QUERY_FAILED';
		throw error;
	});
	const result = await runGetStock({ user: USER_A }, {});
	assert.equal(result.success, false);
	assert.equal(result.data, null);
	assert.equal(result.error.code, 'SUPABASE_ERROR');
	assert.match(result.error.message, /stock/i);
});

test('validateGetStockInput rejects userId', () => {
	assert.throws(
		() => validateGetStockInput({ userId: 'x' }),
		/Forbidden parameter for get_stock: userId/,
	);
});

test('ToolResult shape is normalized', async () => {
	const result = assertToolResultShape(await runGetStock({ user: USER_A }, {}));
	assert.equal(result.tool, 'get_stock');
});

test('summarizeStock uses default threshold when seuil_alerte is missing', () => {
	const summary = summarizeStock([
		{
			produit_id: 'p1',
			nom_article: 'Test',
			stock_actuel: 3,
			seuil_alerte: 0,
		},
	], []);
	assert.equal(summary.items[0].threshold, 5);
	assert.equal(summary.items[0].isLow, true);
});
