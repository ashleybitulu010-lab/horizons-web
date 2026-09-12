import assert from 'node:assert/strict';
import test from 'node:test';

import { runCreateSale, validateCreateSaleInput } from '../src/tools/create-sale.js';
import {
	normalizeCreateSaleInput,
	refuseVenteStockMessage,
	setCreateSaleImplForTests,
	resetCreateSaleImplForTests,
} from '../src/services/sales-write-service.js';

const USER = {
	id: 'pb_user',
	clientId: 'client_1',
	activeActivityId: 'activity_1',
	businessUserId: 'rec_user',
};

const SALE_RESULT = {
	saleId: 'sale-abc',
	product: 'Poulet',
	productId: 'prod-1',
	quantity: 2,
	unitPrice: 10,
	amountPaid: 20,
	total: 20,
	stockRemaining: 8,
	stockThreshold: 5,
	stockAlert: '',
};

test.afterEach(() => {
	resetCreateSaleImplForTests();
});

test('valid confirmed sale returns success summary', async () => {
	setCreateSaleImplForTests(async (scope, input) => {
		assert.equal(scope.clientId, 'client_1');
		assert.equal(scope.activityId, 'activity_1');
		assert.equal(input.product, 'Poulet');
		assert.equal(input.quantity, 2);
		assert.equal(input.unitPrice, 10);
		assert.equal(input.amountPaid, 20);
		assert.equal(input.confirmed, true);
		return SALE_RESULT;
	});

	const result = await runCreateSale(
		{ user: USER },
		{
			product: 'Poulet',
			quantity: 2,
			unitPrice: 10,
			amountPaid: 20,
			confirmed: true,
		},
	);

	assert.equal(result.success, true);
	assert.equal(result.tool, 'create_sale');
	assert.equal(result.data.summary.saleId, 'sale-abc');
	assert.equal(result.data.summary.total, 20);
	assert.equal(result.data.summary.stockRemaining, 8);
});

test('unconfirmed sale returns NEEDS_CONFIRMATION with preview', async () => {
	const result = await runCreateSale(
		{ user: USER },
		{
			product: 'Poulet',
			quantity: 2,
			unitPrice: 10,
			amountPaid: 20,
			confirmed: false,
		},
	);

	assert.equal(result.success, false);
	assert.equal(result.error.code, 'NEEDS_CONFIRMATION');
	assert.equal(result.meta.requiresConfirmation, true);
	assert.equal(result.meta.preview.product, 'Poulet');
	assert.equal(result.meta.preview.quantity, 2);
	assert.equal(result.meta.preview.unitPrice, 10);
	assert.equal(result.meta.preview.amountPaid, 20);
	assert.equal(result.data, null);
});

test('invalid quantity is rejected', async () => {
	const result = await runCreateSale(
		{ user: USER },
		{ product: 'Poulet', quantity: 0, unitPrice: 10, amountPaid: 0, confirmed: true },
	);
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'INVALID_PARAMETER');
});

test('missing product is rejected', async () => {
	const result = await runCreateSale(
		{ user: USER },
		{ quantity: 1, unitPrice: 10, amountPaid: 10, confirmed: true },
	);
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'MISSING_PRODUCT');
});

test('insufficient stock returns structured refusal message', async () => {
	setCreateSaleImplForTests(async () => {
		const error = new Error('stock insuffisant pour vente Poulet (1 < 2)');
		error.code = 'INSUFFICIENT_STOCK';
		error.available = 1;
		error.requested = 2;
		throw error;
	});

	const result = await runCreateSale(
		{ user: USER },
		{
			product: 'Poulet',
			quantity: 2,
			unitPrice: 10,
			amountPaid: 20,
			confirmed: true,
		},
	);

	assert.equal(result.success, false);
	assert.equal(result.error.code, 'INSUFFICIENT_STOCK');
	assert.match(result.error.message, /Il ne reste que 1 Poulet/i);
});

test('product not found returns PRODUCT_NOT_FOUND', async () => {
	setCreateSaleImplForTests(async () => {
		const error = new Error('vente product not found: Inconnu');
		error.code = 'PRODUCT_NOT_FOUND';
		throw error;
	});

	const result = await runCreateSale(
		{ user: USER },
		{
			product: 'Inconnu',
			quantity: 1,
			unitPrice: 10,
			amountPaid: 10,
			confirmed: true,
		},
	);

	assert.equal(result.success, false);
	assert.equal(result.error.code, 'PRODUCT_NOT_FOUND');
});

test('forbidden clientId parameter is rejected', async () => {
	const result = await runCreateSale(
		{ user: USER },
		{
			product: 'Poulet',
			quantity: 1,
			unitPrice: 10,
			amountPaid: 10,
			confirmed: true,
			clientId: 'other_client',
		},
	);
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'FORBIDDEN_PARAMETER');
});

test('missing client scope returns structured error', async () => {
	const result = await runCreateSale(
		{ user: { id: 'pb_x' } },
		{
			product: 'Poulet',
			quantity: 1,
			unitPrice: 10,
			amountPaid: 10,
			confirmed: true,
		},
	);
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'CLIENT_SCOPE_MISSING');
});

test('partial payment is accepted when confirmed', async () => {
	setCreateSaleImplForTests(async (_clientId, input) => ({
		...SALE_RESULT,
		amountPaid: input.amountPaid,
		total: 20,
	}));

	const result = await runCreateSale(
		{ user: USER },
		{
			product: 'Poulet',
			quantity: 2,
			unitPrice: 10,
			amountPaid: 5,
			confirmed: true,
		},
	);

	assert.equal(result.success, true);
	assert.equal(result.data.summary.amountPaid, 5);
});

test('normalizeCreateSaleInput accepts French aliases', () => {
	const normalized = normalizeCreateSaleInput({
		produit: 'Savon',
		quantite: 3,
		prix_unitaire: 800,
		montant_paye: 2400,
	});
	assert.deepEqual(normalized, {
		product: 'Savon',
		quantity: 3,
		unitPrice: 800,
		amountPaid: 2400,
		confirmed: false,
	});
});

test('validateCreateSaleInput rejects userId', () => {
	assert.throws(
		() => validateCreateSaleInput({ userId: 'x', product: 'Poulet', quantity: 1 }),
		/Forbidden parameter for create_sale: userId/,
	);
});

test('refuseVenteStockMessage handles zero stock', () => {
	const message = refuseVenteStockMessage('Poulet', 0, 2);
	assert.match(message, /Tu n'as plus de Poulet en stock/i);
});

test('error result never exposes data payload', async () => {
	setCreateSaleImplForTests(async () => {
		const error = new Error('db down');
		error.code = 'SUPABASE_RPC_FAILED';
		throw error;
	});

	const result = await runCreateSale(
		{ user: USER },
		{
			product: 'Poulet',
			quantity: 1,
			unitPrice: 10,
			amountPaid: 10,
			confirmed: true,
		},
	);

	assert.equal(result.success, false);
	assert.equal(result.data, null);
});
